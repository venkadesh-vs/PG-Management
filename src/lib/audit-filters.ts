import type { EventType, Prisma } from '@prisma/client'
import { EVENT_GROUPS, EVENT_LABEL } from './events-meta'

/**
 * Filters shared by the owner Activity page, the Super Admin audit page and
 * their CSV exports, so the file always matches what is on screen.
 * Pure: builds a Prisma where-clause; tenant scoping is added by the caller.
 */

export type AuditFilters = {
  q: string
  event: EventType | null
  group: string | null
  actor: string | null
  entity: string | null
  org: string | null
  from: Date | null
  to: Date | null
  /** Days back when no explicit from/to: 7 | 30 | 90 | null (all time). */
  rangeDays: number | null
  page: number
}

type Params = Record<string, string | string[] | undefined> | URLSearchParams

function read(params: Params, key: string): string | undefined {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined
  const v = params[key]
  return Array.isArray(v) ? v[0] : v
}

/** YYYY-MM-DD at local (IST) midnight; null when malformed. */
function day(value: string | undefined, endOfDay = false): Date | null {
  const m = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  if (d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) return null
  if (endOfDay) d.setHours(23, 59, 59, 999)
  return d
}

const ID = /^[A-Za-z0-9_-]{1,64}$/

export function parseAuditFilters(params: Params): AuditFilters {
  const eventRaw = read(params, 'event')
  const event = eventRaw && eventRaw in EVENT_LABEL ? (eventRaw as EventType) : null
  const groupRaw = read(params, 'group')
  const group = groupRaw && EVENT_GROUPS.some((g) => g.label === groupRaw) ? groupRaw : null
  const actorRaw = read(params, 'actor')
  const entityRaw = read(params, 'entity')?.trim()
  const orgRaw = read(params, 'org')
  const from = day(read(params, 'from'))
  const to = day(read(params, 'to'), true)
  const range = read(params, 'range') ?? '30'
  const rangeDays = from || to || range === 'all' ? null : [7, 30, 90].includes(Number(range)) ? Number(range) : 30
  return {
    q: (read(params, 'q') ?? '').trim().slice(0, 100),
    event,
    group,
    actor: actorRaw && (actorRaw === 'system' || ID.test(actorRaw)) ? actorRaw : null,
    entity: entityRaw && /^[A-Za-z_]{1,40}$/.test(entityRaw) ? entityRaw : null,
    org: orgRaw && ID.test(orgRaw) ? orgRaw : null,
    from,
    to,
    rangeDays,
    page: Math.max(1, Math.min(10_000, Number(read(params, 'page')) || 1)),
  }
}

/** Where-clause for the filters (no tenant scope — the caller adds it). */
export function auditWhere(f: AuditFilters, now = new Date()): Prisma.ActivityLogWhereInput {
  const and: Prisma.ActivityLogWhereInput[] = []
  if (f.event) and.push({ event: f.event })
  else if (f.group) {
    const events = EVENT_GROUPS.find((g) => g.label === f.group)?.events
    if (events) and.push({ event: { in: events } })
  }
  if (f.actor === 'system') and.push({ actorId: null })
  else if (f.actor) and.push({ actorId: f.actor })
  if (f.entity) and.push({ entityType: f.entity })
  if (f.from || f.to) {
    and.push({ createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } })
  } else if (f.rangeDays) {
    const since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - f.rangeDays)
    and.push({ createdAt: { gte: since } })
  }
  if (f.q) {
    and.push({
      OR: [
        { summary: { contains: f.q, mode: 'insensitive' } },
        { actorName: { contains: f.q, mode: 'insensitive' } },
        { entityId: f.q },
        { ip: { startsWith: f.q } },
      ],
    })
  }
  return and.length ? { AND: and } : {}
}

/** Count of filters the user set (for the "Clear filters" chip). */
export function activeAuditFilterCount(f: AuditFilters, params: Params) {
  return [f.q, f.event, f.group, f.actor, f.entity, f.org, f.from, f.to, read(params, 'range')].filter(Boolean).length
}

/** Query-string keys the export button carries over. */
export const AUDIT_FILTER_KEYS = ['q', 'event', 'group', 'actor', 'entity', 'org', 'from', 'to', 'range', 'property'] as const

export const AUDIT_CSV_HEADER = [
  'Time',
  'Event',
  'Summary',
  'Actor',
  'Actor role',
  'Entity type',
  'Entity id',
  'PG',
  'IP',
  'User agent',
  'Changed fields',
]
