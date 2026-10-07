import type { Prisma } from '@prisma/client'
import { dayOfMonth, startOfDay } from '@/lib/utils'

/**
 * Pure expense rules — approval, voiding and recurrence. No database here so
 * the rules are unit-tested (tests/unit/expense-rules.test.ts).
 *
 * Approval: an expense of APPROVAL_THRESHOLD (₹5,000) or more, recorded by
 * someone who cannot approve expenses, starts PENDING. Approvers are the
 * owner, or anyone holding both expenses.manage and invoices.waive (the
 * "money sign-off" permission). PENDING and REJECTED expenses, and every
 * VOIDED one, are left out of totals, P&L and the profit estimate.
 *
 * Expenses are never deleted: a mistake is voided with a reason and stays
 * visible (struck through) with who voided it in the activity log.
 */

export const APPROVAL_THRESHOLD = 5000

export const RECURRENCES = ['MONTHLY', 'QUARTERLY', 'YEARLY'] as const
export type Recurrence = (typeof RECURRENCES)[number]

export const RECURRENCE_LABEL: Record<Recurrence, string> = {
  MONTHLY: 'Every month',
  QUARTERLY: 'Every 3 months',
  YEARLY: 'Every year',
}

const STEP_MONTHS: Record<Recurrence, number> = { MONTHLY: 1, QUARTERLY: 3, YEARLY: 12 }

/** A missed automation run is caught up for this many days, never further back. */
export const RECURRING_CATCH_UP_DAYS = 35

export type ExpenseStatus = 'APPROVED' | 'PENDING' | 'REJECTED' | 'VOIDED'

/** Only these expenses count as money spent. */
export const COUNTED_EXPENSE = {
  voidedAt: null,
  approvalStatus: 'APPROVED',
} satisfies Prisma.ExpenseWhereInput

export function isRecurrence(value: unknown): value is Recurrence {
  return typeof value === 'string' && (RECURRENCES as readonly string[]).includes(value)
}

export function canApproveExpenses(user: { role: string; permissions: string[] }) {
  if (user.role === 'OWNER') return true
  return user.permissions.includes('expenses.manage') && user.permissions.includes('invoices.waive')
}

export function initialApprovalStatus(amount: number, canApprove: boolean): 'APPROVED' | 'PENDING' {
  return canApprove || amount < APPROVAL_THRESHOLD ? 'APPROVED' : 'PENDING'
}

export function expenseStatus(e: { voidedAt: Date | null; approvalStatus: string }): ExpenseStatus {
  if (e.voidedAt) return 'VOIDED'
  if (e.approvalStatus === 'PENDING' || e.approvalStatus === 'REJECTED') return e.approvalStatus
  return 'APPROVED'
}

/**
 * The k-th occurrence after the anchor (k = 1 is the next one). Always
 * computed from the anchor's own day so a 31st stays the 31st where it can:
 * 31 Jan → 28 Feb → 31 Mar, never drifting to the 28th.
 */
export function occurrenceDate(anchor: Date, recurrence: Recurrence, k: number): Date {
  const months = STEP_MONTHS[recurrence] * k
  return dayOfMonth(anchor.getFullYear(), anchor.getMonth() + months, anchor.getDate())
}

/**
 * Which occurrences are due and not yet created. An occurrence counts as
 * created when any expense of the series falls inside its window
 * [due, next due) — so editing a copy's date a little does not duplicate it.
 * Only dues within the catch-up window are created (marking an old expense
 * as recurring does not back-fill years of entries).
 */
export function dueOccurrences(params: {
  anchor: Date
  recurrence: Recurrence
  existing: Date[]
  today: Date
  catchUpDays?: number
}): Date[] {
  const today = startOfDay(params.today)
  const earliest = startOfDay(
    new Date(today.getTime() - (params.catchUpDays ?? RECURRING_CATCH_UP_DAYS) * 86400000),
  )
  const existing = params.existing.map((d) => startOfDay(d).getTime())
  const due: Date[] = []
  for (let k = 1; k <= 1200; k++) {
    const at = occurrenceDate(params.anchor, params.recurrence, k)
    if (at > today) break
    if (at < earliest) continue
    const next = occurrenceDate(params.anchor, params.recurrence, k + 1).getTime()
    const taken = existing.some((t) => t >= at.getTime() && t < next)
    if (!taken) due.push(at)
  }
  return due
}
