import { describe, expect, it } from 'vitest'
import { diffValues, formatDiffValue, labelForPath } from '@/lib/audit-diff'
import { auditWhere, parseAuditFilters } from '@/lib/audit-filters'

describe('diffValues', () => {
  it('reports changed, added and removed fields sorted by path', () => {
    const diff = diffValues({ rent: 6000, name: 'Ravi', notes: 'x' }, { rent: 6500, name: 'Ravi', city: 'Chennai' })
    expect(diff).toEqual([
      { path: 'city', kind: 'added', before: null, after: 'Chennai' },
      { path: 'notes', kind: 'removed', before: 'x', after: null },
      { path: 'rent', kind: 'changed', before: 6000, after: 6500 },
    ])
  })

  it('walks nested objects and compares arrays as a whole', () => {
    const diff = diffValues(
      { address: { city: 'Chennai', pin: '600001' }, tags: ['a', 'b'] },
      { address: { city: 'Madurai', pin: '600001' }, tags: ['a', 'b'] },
    )
    expect(diff).toEqual([{ path: 'address.city', kind: 'changed', before: 'Chennai', after: 'Madurai' }])
    expect(diffValues({ tags: ['a'] }, { tags: ['a', 'b'] })).toHaveLength(1)
  })

  it('ignores keys that are null or missing on both sides and identical dates', () => {
    expect(diffValues({ a: null, d: '2026-10-01T00:00:00.000Z' }, { b: undefined, d: '2026-10-01T00:00:00.000Z' })).toEqual([])
  })

  it('handles a missing before or after snapshot', () => {
    expect(diffValues(null, { status: 'ACTIVE' })).toEqual([{ path: 'status', kind: 'added', before: null, after: 'ACTIVE' }])
    expect(diffValues({ status: 'ACTIVE' }, null)).toEqual([{ path: 'status', kind: 'removed', before: 'ACTIVE', after: null }])
    expect(diffValues(null, null)).toEqual([])
  })

  it('stops at maxDepth and compares deeper values whole', () => {
    const diff = diffValues({ a: { b: { c: 1 } } }, { a: { b: { c: 2 } } }, 1)
    expect(diff).toEqual([{ path: 'a', kind: 'changed', before: { b: { c: 1 } }, after: { b: { c: 2 } } }])
  })
})

describe('formatDiffValue / labelForPath', () => {
  it('formats values for display', () => {
    expect(formatDiffValue(null)).toBe('—')
    expect(formatDiffValue(true)).toBe('Yes')
    expect(formatDiffValue(6500)).toBe('6500')
    expect(formatDiffValue({ a: 1 })).toBe('{"a":1}')
    expect(formatDiffValue('x'.repeat(200), 10)).toBe('xxxxxxxxxx…')
  })
  it('turns field paths into labels', () => {
    expect(labelForPath('rentAmount')).toBe('Rent amount')
    expect(labelForPath('address.city')).toBe('Address › City')
    expect(labelForPath('due_day')).toBe('Due day')
  })
})

describe('parseAuditFilters / auditWhere', () => {
  it('defaults to the last 30 days, page 1', () => {
    const f = parseAuditFilters({})
    expect(f.rangeDays).toBe(30)
    expect(f.page).toBe(1)
    const where = auditWhere(f, new Date(2026, 9, 7, 15))
    expect(where).toEqual({ AND: [{ createdAt: { gte: new Date(2026, 8, 7) } }] })
  })

  it('rejects unknown events, bad ids and bad dates', () => {
    const f = parseAuditFilters({ event: 'DROP_TABLE', actor: "x' OR 1=1", entity: 'Bad Entity!', from: '2026-13-99', page: '-5' })
    expect(f.event).toBeNull()
    expect(f.actor).toBeNull()
    expect(f.entity).toBeNull()
    expect(f.from).toBeNull()
    expect(f.page).toBe(1)
  })

  it('explicit dates override the range and include the whole "to" day', () => {
    const f = parseAuditFilters(new URLSearchParams('from=2026-10-01&to=2026-10-05&range=7'))
    expect(f.rangeDays).toBeNull()
    expect(f.to?.getHours()).toBe(23)
    const where = auditWhere(f) as { AND: unknown[] }
    expect(where.AND).toEqual([{ createdAt: { gte: new Date(2026, 9, 1), lte: f.to } }])
  })

  it('builds event, actor, entity and text conditions', () => {
    const f = parseAuditFilters({ event: 'PAYMENT_REVERSED', actor: 'system', entity: 'RentPayment', q: 'UTR', range: 'all' })
    const where = auditWhere(f) as { AND: unknown[] }
    expect(where.AND).toContainEqual({ event: 'PAYMENT_REVERSED' })
    expect(where.AND).toContainEqual({ actorId: null })
    expect(where.AND).toContainEqual({ entityType: 'RentPayment' })
    expect(where.AND).toHaveLength(4)
  })
})
