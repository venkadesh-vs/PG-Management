/**
 * One combined StayFlow bill per owner per month, covering every PG.
 * Pure rules, no database (tests/unit/owner-bill.test.ts).
 *
 * - The owner picks a due day from the 1st to the 10th; every PG is billed
 *   together on it.
 * - Due day + 1 and + 2: warning reminders.
 * - Due day + 3: a one-time late fee of LATE_FEE_PERCENT of the bill.
 * - Due day + PAUSE_AFTER_DAYS still unpaid: the account is paused.
 * - A referral reward is a credit: REFERRAL_CREDIT_PERCENT of what the new
 *   owner paid for their first month, taken off the next bill(s).
 */

export const DUE_DAY_MIN = 1
export const DUE_DAY_MAX = 10
export const DEFAULT_DUE_DAY = 5
export const WARNING_DAYS = [1, 2] as const
export const LATE_FEE_AFTER_DAYS = 3
export const LATE_FEE_PERCENT = 1
export const PAUSE_AFTER_DAYS = 21
export const REFERRAL_CREDIT_PERCENT = 50
/** Credit never takes more than this share off one bill: the owner always pays at least half. */
export const MAX_CREDIT_PER_BILL_PERCENT = 50

const DAY = 86_400_000
const dateOnly = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const daysBetween = (a: Date, b: Date) => Math.round((dateOnly(b).getTime() - dateOnly(a).getTime()) / DAY)

export function clampDueDay(day: number): number {
  if (!Number.isFinite(day)) return DEFAULT_DUE_DAY
  return Math.min(DUE_DAY_MAX, Math.max(DUE_DAY_MIN, Math.round(day)))
}

/** The first bill date on or after `from` that falls on the owner's due day. */
export function nextBillDate(dueDay: number, from: Date): Date {
  const day = clampDueDay(dueDay)
  const start = dateOnly(from)
  const thisMonth = new Date(start.getFullYear(), start.getMonth(), day)
  return thisMonth >= start ? thisMonth : new Date(start.getFullYear(), start.getMonth() + 1, day)
}

/**
 * Where a subscription's next bill goes when the owner's due day is applied.
 * Always counted from the date it had before any move (`alignedFrom`), so
 * changing the due day back and forth never pushes the bill months ahead.
 */
export function alignedBillDate(dueDay: number, sub: { nextBillingDate: Date; alignedFrom: Date | null }, today = new Date()): Date {
  const original = dateOnly(sub.alignedFrom ?? sub.nextBillingDate)
  // Never into the past: the days since then are charged pro rata on the first bill.
  const from = original < dateOnly(today) ? dateOnly(today) : original
  return nextBillDate(dueDay, from)
}

export type BillStage = 'upcoming' | 'due' | 'warning' | 'late' | 'paused'

/** Where an unpaid bill stands on `now`. */
export function billStage(dueDate: Date, now: Date): BillStage {
  const late = daysBetween(dueDate, now)
  if (late < 0) return 'upcoming'
  if (late === 0) return 'due'
  if (late < LATE_FEE_AFTER_DAYS) return 'warning'
  if (late < PAUSE_AFTER_DAYS) return 'late'
  return 'paused'
}

export function lateFeeDate(dueDate: Date): Date {
  return new Date(dateOnly(dueDate).getTime() + LATE_FEE_AFTER_DAYS * DAY)
}

export function pauseDate(dueDate: Date): Date {
  return new Date(dateOnly(dueDate).getTime() + PAUSE_AFTER_DAYS * DAY)
}

/** The one-time late fee on a bill's amount before GST. */
export function lateFee(taxable: number, percent = LATE_FEE_PERCENT): number {
  if (taxable <= 0 || percent <= 0) return 0
  return Math.max(1, Math.round((taxable * percent) / 100))
}

/** The referral credit earned from a new owner's first paid month. */
export function referralCredit(firstMonthTotal: number, percent = REFERRAL_CREDIT_PERCENT): number {
  if (firstMonthTotal <= 0) return 0
  return Math.round((firstMonthTotal * percent) / 100)
}

/**
 * Takes available credit off a bill, at most MAX_CREDIT_PER_BILL_PERCENT of it,
 * so the owner always pays at least half. What is left carries to the next bill.
 */
export function applyCredit(billTaxable: number, credit: number): { used: number; left: number } {
  const cap = Math.floor((Math.max(0, billTaxable) * MAX_CREDIT_PER_BILL_PERCENT) / 100)
  const used = Math.max(0, Math.min(cap, credit))
  return { used, left: Math.max(0, credit - used) }
}

/**
 * Spreads one payment over a bill's lines, oldest first, never paying a line
 * more than it owes. Returns what each line receives and anything left over.
 */
export function allocate<T extends { id: string; due: number }>(amount: number, lines: T[]) {
  let left = Math.max(0, amount)
  const parts: { id: string; amount: number }[] = []
  for (const line of lines) {
    if (left <= 0) break
    const pay = Math.min(left, Math.max(0, line.due))
    if (pay > 0) {
      parts.push({ id: line.id, amount: pay })
      left -= pay
    }
  }
  return { parts, unallocated: left }
}

/** A PG's share of a part-month: monthly price × days used / days in that billing month. */
export function prorated(monthly: number, from: Date, until: Date): number {
  const days = daysBetween(from, until)
  if (days <= 0 || monthly <= 0) return 0
  const periodStart = new Date(until.getFullYear(), until.getMonth() - 1, until.getDate())
  const periodDays = Math.max(1, daysBetween(periodStart, until))
  return Math.round((monthly * Math.min(days, periodDays)) / periodDays)
}
