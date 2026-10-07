import { describe, expect, it } from 'vitest'
import {
  canApproveExpenses,
  dueOccurrences,
  expenseStatus,
  initialApprovalStatus,
  occurrenceDate,
} from '@/server/services/expense-rules'
import { toISODate } from '@/lib/utils'

describe('approval', () => {
  it('owners and money sign-off holders approve', () => {
    expect(canApproveExpenses({ role: 'OWNER', permissions: [] })).toBe(true)
    expect(canApproveExpenses({ role: 'MANAGER', permissions: ['expenses.manage'] })).toBe(false)
    expect(canApproveExpenses({ role: 'MANAGER', permissions: ['expenses.manage', 'invoices.waive'] })).toBe(true)
  })

  it('large expenses by non-approvers wait for approval', () => {
    expect(initialApprovalStatus(4999, false)).toBe('APPROVED')
    expect(initialApprovalStatus(5000, false)).toBe('PENDING')
    expect(initialApprovalStatus(90000, true)).toBe('APPROVED')
  })

  it('voided wins over approval', () => {
    expect(expenseStatus({ voidedAt: new Date(), approvalStatus: 'APPROVED' })).toBe('VOIDED')
    expect(expenseStatus({ voidedAt: null, approvalStatus: 'REJECTED' })).toBe('REJECTED')
  })
})

describe('recurrence', () => {
  it('clamps month ends without drifting', () => {
    const anchor = new Date(2026, 0, 31)
    expect(toISODate(occurrenceDate(anchor, 'MONTHLY', 1))).toBe('2026-02-28')
    expect(toISODate(occurrenceDate(anchor, 'MONTHLY', 2))).toBe('2026-03-31')
    expect(toISODate(occurrenceDate(anchor, 'QUARTERLY', 1))).toBe('2026-04-30')
    expect(toISODate(occurrenceDate(new Date(2024, 1, 29), 'YEARLY', 1))).toBe('2025-02-28')
  })

  it('creates the due copy once (idempotent)', () => {
    const anchor = new Date(2026, 8, 5)
    const today = new Date(2026, 9, 7)
    const first = dueOccurrences({ anchor, recurrence: 'MONTHLY', existing: [anchor], today })
    expect(first.map(toISODate)).toEqual(['2026-10-05'])
    const again = dueOccurrences({ anchor, recurrence: 'MONTHLY', existing: [anchor, ...first], today })
    expect(again).toEqual([])
  })

  it('is not due before the day', () => {
    const anchor = new Date(2026, 8, 10)
    expect(dueOccurrences({ anchor, recurrence: 'MONTHLY', existing: [anchor], today: new Date(2026, 9, 9) })).toEqual([])
  })

  it('does not back-fill beyond the catch-up window', () => {
    const anchor = new Date(2025, 0, 1)
    const due = dueOccurrences({ anchor, recurrence: 'MONTHLY', existing: [anchor], today: new Date(2026, 9, 7) })
    expect(due.map(toISODate)).toEqual(['2026-10-01'])
  })
})
