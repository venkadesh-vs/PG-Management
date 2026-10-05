import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { route, parseQuery } from '@/lib/api-helpers'
import { formatMoney, formatDate } from '@/lib/utils'
import { resolveScope } from '@/lib/tenancy'
import type { SearchResult } from '@/components/app/global-search'

const schema = z.object({
  q: z.string().min(2).max(80),
  scope: z.enum(['org', 'platform']).default('org'),
})

/**
 * Cross-module search. Everything is filtered by the caller's organization
 * server-side — the client never supplies a tenant id.
 */
export const GET = route(
  async ({ user, request }) => {
    const { q, scope } = parseQuery(request, schema)
    const term = q.trim()
    const results: SearchResult[] = []

    if (scope === 'platform' && user.role === 'SUPER_ADMIN') {
      const [orgs, properties] = await Promise.all([
        prisma.organization.findMany({
          where: {
            OR: [
              { name: { contains: term, mode: 'insensitive' } },
              { ownerName: { contains: term, mode: 'insensitive' } },
              { contactEmail: { contains: term, mode: 'insensitive' } },
              { contactPhone: { contains: term } },
            ],
          },
          take: 6,
          include: { _count: { select: { properties: true, residents: true } } },
        }),
        prisma.property.findMany({
          where: { name: { contains: term, mode: 'insensitive' } },
          take: 6,
          include: { organization: { select: { name: true } } },
        }),
      ])

      results.push(
        ...orgs.map((o) => ({
          id: o.id,
          type: 'organization' as const,
          title: o.name,
          subtitle: `${o.ownerName} · ${o._count.properties} PGs · ${o._count.residents} residents`,
          href: `/admin/organizations/${o.id}`,
          meta: o.status,
        })),
        ...properties.map((p) => ({
          id: p.id,
          type: 'property' as const,
          title: p.name,
          subtitle: `${p.organization.name} · ${p.city}`,
          href: `/admin/properties`,
        })),
      )
      return { results }
    }

    if (!user.organizationId || user.role === 'SUPER_ADMIN') return { results: [] }
    const orgId = user.organizationId
    // Always filter to the caller's allowed PGs (restricted managers see only
    // their own; archived PGs drop out).
    const { allowedPropertyIds } = await resolveScope(user)
    const propertyFilter = { in: allowedPropertyIds }

    const [residents, properties, rooms, payments, complaints, staff, expenses] = await Promise.all([
      prisma.resident.findMany({
        where: {
          organizationId: orgId,
          propertyId: propertyFilter,
          OR: [
            { fullName: { contains: term, mode: 'insensitive' } },
            { phone: { contains: term } },
            { code: { contains: term, mode: 'insensitive' } },
            { email: { contains: term, mode: 'insensitive' } },
          ],
        },
        take: 6,
        include: { property: { select: { name: true } }, room: { select: { number: true } }, bed: true },
        orderBy: { status: 'asc' },
      }),
      prisma.property.findMany({
        where: {
          organizationId: orgId,
          archivedAt: null,
          id: propertyFilter,
          OR: [
            { name: { contains: term, mode: 'insensitive' } },
            { city: { contains: term, mode: 'insensitive' } },
            { code: { contains: term, mode: 'insensitive' } },
          ],
        },
        take: 4,
        include: { _count: { select: { beds: true, residents: true } } },
      }),
      prisma.room.findMany({
        where: {
          property: { organizationId: orgId, id: propertyFilter },
          number: { contains: term, mode: 'insensitive' },
        },
        take: 5,
        include: {
          property: { select: { id: true, name: true } },
          _count: { select: { beds: true } },
        },
      }),
      prisma.rentPayment.findMany({
        where: {
          organizationId: orgId,
          propertyId: propertyFilter,
          OR: [
            { receiptNumber: { contains: term, mode: 'insensitive' } },
            { resident: { fullName: { contains: term, mode: 'insensitive' } } },
          ],
        },
        take: 4,
        include: { resident: { select: { fullName: true } } },
        orderBy: { paidAt: 'desc' },
      }),
      prisma.complaint.findMany({
        where: {
          organizationId: orgId,
          propertyId: propertyFilter,
          OR: [
            { code: { contains: term, mode: 'insensitive' } },
            { title: { contains: term, mode: 'insensitive' } },
          ],
        },
        take: 4,
        include: { property: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.staff.findMany({
        where: {
          organizationId: orgId,
          AND: [
            { OR: [{ propertyId: propertyFilter }, { propertyId: null }] },
            {
              OR: [
                { name: { contains: term, mode: 'insensitive' } },
                { phone: { contains: term } },
                { code: { contains: term, mode: 'insensitive' } },
              ],
            },
          ],
        },
        take: 4,
        include: { property: { select: { name: true } } },
      }),
      prisma.expense.findMany({
        where: {
          organizationId: orgId,
          propertyId: propertyFilter,
          title: { contains: term, mode: 'insensitive' },
        },
        take: 3,
        include: { category: { select: { name: true } } },
        orderBy: { spentOn: 'desc' },
      }),
    ])

    results.push(
      ...residents.map((r) => ({
        id: r.id,
        type: 'resident' as const,
        title: r.fullName,
        subtitle: `${r.code} · ${r.property.name}${r.room ? ` · Room ${r.room.number}` : ''}${r.bed ? ` / ${r.bed.label}` : ''}`,
        href: `/app/residents/${r.id}`,
        meta: r.status === 'ACTIVE' ? undefined : r.status.replace('_', ' ').toLowerCase(),
      })),
      ...properties.map((p) => ({
        id: p.id,
        type: 'property' as const,
        title: p.name,
        subtitle: `${p.city} · ${p._count.beds} beds · ${p._count.residents} residents`,
        href: `/app/properties/${p.id}`,
      })),
      ...rooms.map((r) => ({
        id: r.id,
        type: 'room' as const,
        title: `Room ${r.number}`,
        subtitle: `${r.property.name} · ${r._count.beds} beds`,
        href: `/app/beds?property=${r.property.id}&room=${r.id}`,
      })),
      ...payments.map((p) => ({
        id: p.id,
        type: 'payment' as const,
        title: p.receiptNumber,
        subtitle: `${p.resident.fullName} · ${formatDate(p.paidAt)}`,
        href: `/app/payments?receipt=${p.receiptNumber}`,
        meta: formatMoney(p.amount),
      })),
      ...complaints.map((c) => ({
        id: c.id,
        type: 'complaint' as const,
        title: c.title,
        subtitle: `${c.code} · ${c.property.name}`,
        href: `/app/complaints/${c.id}`,
        meta: c.status.replace('_', ' ').toLowerCase(),
      })),
      ...staff.map((s) => ({
        id: s.id,
        type: 'staff' as const,
        title: s.name,
        subtitle: `${s.role.replace('_', ' ').toLowerCase()}${s.property ? ` · ${s.property.name}` : ''}`,
        href: `/app/staff?id=${s.id}`,
      })),
      ...expenses.map((e) => ({
        id: e.id,
        type: 'expense' as const,
        title: e.title,
        subtitle: `${e.category.name} · ${formatDate(e.spentOn)}`,
        href: `/app/expenses`,
        meta: formatMoney(e.amount),
      })),
    )

    return { results }
  },
  { roles: ['SUPER_ADMIN', 'OWNER', 'MANAGER'] },
)
