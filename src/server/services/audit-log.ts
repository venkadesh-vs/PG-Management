import type { EventType, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { SessionUser } from '@/lib/auth'
import type { PropertyScope } from '@/lib/tenancy'
import { EVENT_LABEL } from '@/lib/events-meta'
import { auditWhere, type AuditFilters } from '@/lib/audit-filters'
import { diffValues } from '@/lib/audit-diff'

/**
 * Read side of the audit log (ActivityLog). The log is append-only: this
 * module only reads. Writes happen through recordActivity (src/server/events.ts).
 */

export type AuditEntry = {
  id: string
  event: EventType
  summary: string
  actorName: string | null
  actorRole: string | null
  entityType: string | null
  entityId: string | null
  entityHref: string | null
  createdAt: string
  ip: string | null
  userAgent: string | null
  before: unknown
  after: unknown
  meta: unknown
  propertyName: string | null
  organizationName: string | null
}

/** Owner / manager view: their organization, limited to the PGs they may see. */
export function orgAuditWhere(user: SessionUser, scope: PropertyScope, filters: AuditFilters): Prisma.ActivityLogWhereInput {
  const propertyLimit: Prisma.ActivityLogWhereInput | null = scope.propertyId
    ? { OR: [{ propertyId: scope.propertyId }, { propertyId: null }] }
    : user.propertyIds.length
      ? { OR: [{ propertyId: { in: scope.allowedPropertyIds } }, { propertyId: null }] }
      : null
  return {
    AND: [{ organizationId: scope.organizationId }, ...(propertyLimit ? [propertyLimit] : []), auditWhere(filters)],
  }
}

/** Super Admin view: every organization, optionally one. */
export function platformAuditWhere(filters: AuditFilters): Prisma.ActivityLogWhereInput {
  return { AND: [...(filters.org ? [{ organizationId: filters.org }] : []), auditWhere(filters)] }
}

const ORG_LINKS: Record<string, (id: string) => string> = {
  Resident: (id) => `/app/residents/${id}`,
  Complaint: (id) => `/app/complaints/${id}`,
  Property: (id) => `/app/properties/${id}`,
  ResidentLead: (id) => `/app/leads/${id}`,
  RentPayment: () => `/app/payments`,
  RentInvoice: () => `/app/rent`,
  Expense: () => `/app/expenses`,
  Booking: () => `/app/bookings`,
  Staff: (id) => `/app/staff?id=${id}`,
  Visitor: () => `/app/visitors`,
}
const PLATFORM_LINKS: Record<string, (id: string) => string> = {
  Organization: (id) => `/admin/organizations/${id}`,
  Lead: () => `/admin/leads`,
  Subscription: () => `/admin/subscriptions`,
  SubscriptionInvoice: () => `/admin/payments`,
  PlatformAnnouncement: () => `/admin/announcements`,
  Plan: () => `/admin/plans`,
}

function entityHref(mode: 'org' | 'platform', type: string | null, id: string | null) {
  if (!type || !id) return null
  const link = (mode === 'org' ? ORG_LINKS : PLATFORM_LINKS)[type]
  return link ? link(id) : null
}

const PAGE_INCLUDE = {
  organization: { select: { name: true } },
} satisfies Prisma.ActivityLogInclude

async function propertyNames(ids: (string | null)[]) {
  const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))]
  if (!unique.length) return new Map<string, string>()
  const rows = await prisma.property.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } })
  return new Map(rows.map((p) => [p.id, p.name]))
}

/** One page of the log plus the facets the filter bar needs. */
export async function loadAuditPage(
  mode: 'org' | 'platform',
  where: Prisma.ActivityLogWhereInput,
  facetWhere: Prisma.ActivityLogWhereInput,
  page: number,
  pageSize: number,
) {
  const [logs, total, actors, entities] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: PAGE_INCLUDE,
    }),
    prisma.activityLog.count({ where }),
    prisma.activityLog.groupBy({
      by: ['actorId', 'actorName'],
      where: { ...facetWhere, actorId: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { actorId: 'desc' } },
      take: 50,
    }),
    prisma.activityLog.groupBy({
      by: ['entityType'],
      where: { ...facetWhere, entityType: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { entityType: 'desc' } },
      take: 40,
    }),
  ])
  const names = await propertyNames(logs.map((l) => l.propertyId))

  const entries: AuditEntry[] = logs.map((l) => ({
    id: l.id,
    event: l.event,
    summary: l.summary,
    actorName: l.actorName,
    actorRole: l.actorRole,
    entityType: l.entityType,
    entityId: l.entityId,
    entityHref: entityHref(mode, l.entityType, l.entityId),
    createdAt: l.createdAt.toISOString(),
    ip: l.ip,
    userAgent: l.userAgent,
    before: l.before ?? null,
    after: l.after ?? null,
    meta: l.meta ?? null,
    propertyName: l.propertyId ? names.get(l.propertyId) ?? null : null,
    organizationName: l.organization?.name ?? null,
  }))

  // One actor can appear under several names (renamed); keep the first.
  const actorOptions = new Map<string, string>()
  for (const a of actors) if (a.actorId && !actorOptions.has(a.actorId)) actorOptions.set(a.actorId, a.actorName ?? 'Unknown')

  return {
    entries,
    total,
    actors: [...actorOptions].map(([value, label]) => ({ value, label })),
    entities: entities.filter((e) => e.entityType).map((e) => ({ value: e.entityType!, label: e.entityType! })),
  }
}

/** Rows for the CSV export of the filtered log. Capped so one download stays small. */
export const AUDIT_EXPORT_LIMIT = 10_000

export async function auditCsvRows(where: Prisma.ActivityLogWhereInput, includeOrganization = false) {
  const logs = await prisma.activityLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: AUDIT_EXPORT_LIMIT,
    include: PAGE_INCLUDE,
  })
  const names = await propertyNames(logs.map((l) => l.propertyId))
  return logs.map((l) => {
    const changed = diffValues(l.before, l.after)
      .map((c) => c.path)
      .join('; ')
    const row: (string | number | null)[] = [
      l.createdAt.toISOString(),
      EVENT_LABEL[l.event] ?? l.event,
      l.summary,
      l.actorName ?? (l.actorId ? '' : 'System'),
      l.actorRole,
      l.entityType,
      l.entityId,
      l.propertyId ? names.get(l.propertyId) ?? l.propertyId : '',
      l.ip,
      l.userAgent,
      changed,
    ]
    return includeOrganization ? [l.organization?.name ?? '', ...row] : row
  })
}
