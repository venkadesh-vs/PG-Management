/**
 * Resident rent AutoPay — the pure rules (no database, no Razorpay).
 *
 * A resident authorises a mandate once (UPI AutoPay, bank eMandate or card) with a
 * maximum per-debit limit. Each month StayFlow debits exactly that month's invoice
 * balance, never more than the limit, and always tells the resident at least a day
 * before (RBI pre-debit notice). Every debit is an "attempt": created with the
 * notice, charged on its charge date, retried a configurable number of days.
 */

export const AUTOPAY_METHODS = ['UPI', 'EMANDATE', 'CARD'] as const
export type AutopayMethod = (typeof AUTOPAY_METHODS)[number]

export const METHOD_LABEL: Record<AutopayMethod, string> = {
  UPI: 'UPI AutoPay',
  EMANDATE: 'Bank account (eMandate)',
  CARD: 'Card',
}

/** Razorpay's `method` for the authorisation order. */
export const RAZORPAY_METHOD: Record<AutopayMethod, 'upi' | 'emandate' | 'card'> = {
  UPI: 'upi',
  EMANDATE: 'emandate',
  CARD: 'card',
}

/** Hours between the pre-debit notice and the debit (RBI asks for at least 24). */
export const MIN_NOTICE_HOURS = 24

const DAY = 86_400_000
const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

/**
 * The per-debit limit the resident authorises: their usual monthly bill times the
 * owner's percentage, rounded up to the next ₹500 so small changes (an electricity
 * share, a late fee) still fit; capped by the owner's ceiling when one is set.
 */
export function autopayMaxAmount(params: { monthlyBill: number; percent: number; cap?: number | null }) {
  const bill = Math.max(0, Math.round(params.monthlyBill))
  const percent = Math.max(100, Math.round(params.percent))
  const raw = Math.ceil((bill * percent) / 100 / 500) * 500
  const limit = Math.max(500, raw)
  return params.cap && params.cap > 0 ? Math.min(limit, Math.round(params.cap)) : limit
}

export type OpenInvoice = { id: string; dueDate: Date; balance: number; status: string }
export type AttemptSummary = { invoiceId: string; attemptNumber: number; status: string }

const OPEN_STATUSES = new Set(['PENDING', 'PARTIALLY_PAID', 'OVERDUE'])

export type NoticePlan =
  | { invoiceId: string; action: 'notify'; amount: number; chargeDate: Date }
  | { invoiceId: string; action: 'skip'; amount: number; reason: string }

/**
 * Which invoices get a pre-debit notice today. The debit is due `offsetDays` after
 * the invoice due date; the notice goes out the day before that, or today if that
 * day has already passed — in which case the debit moves to tomorrow so the
 * resident always has a full day's notice. Invoices already handled (any attempt)
 * are left to the retry rules.
 */
export function planNotices(params: {
  today: Date
  offsetDays: number
  maxAmount: number
  mandateActive: boolean
  invoices: OpenInvoice[]
  attempts: AttemptSummary[]
}): NoticePlan[] {
  if (!params.mandateActive) return []
  const today = dayStart(params.today)
  const tomorrow = addDays(today, 1)
  const handled = new Set(params.attempts.map((a) => a.invoiceId))
  const plans: NoticePlan[] = []
  for (const invoice of params.invoices) {
    if (handled.has(invoice.id)) continue
    if (invoice.balance <= 0 || !OPEN_STATUSES.has(invoice.status)) continue
    const target = addDays(dayStart(invoice.dueDate), Math.max(0, params.offsetDays))
    if (target.getTime() > tomorrow.getTime()) continue // not yet: notice goes out the day before
    if (invoice.balance > params.maxAmount) {
      plans.push({
        invoiceId: invoice.id,
        action: 'skip',
        amount: invoice.balance,
        reason: `₹${invoice.balance} is above the AutoPay limit of ₹${params.maxAmount}`,
      })
      continue
    }
    const chargeDate = target.getTime() < tomorrow.getTime() ? tomorrow : target
    plans.push({ invoiceId: invoice.id, action: 'notify', amount: invoice.balance, chargeDate })
  }
  return plans
}

/** A notified attempt can be charged once its date has come and the notice is old enough. */
export function isDueForCharge(attempt: { status: string; chargeDate: Date; notifiedAt: Date | null }, now: Date) {
  if (attempt.status !== 'NOTIFIED' || !attempt.notifiedAt) return false
  if (dayStart(attempt.chargeDate).getTime() > dayStart(now).getTime()) return false
  return now.getTime() - attempt.notifiedAt.getTime() >= MIN_NOTICE_HOURS * 3_600_000
}

/**
 * The amount to debit now: what the notice said, or less if the resident has paid
 * part of it since. Never more than the notice, and nothing if it is already paid.
 */
export function chargeAmount(noticeAmount: number, currentBalance: number) {
  return Math.max(0, Math.min(noticeAmount, currentBalance))
}

/**
 * After a failed debit: the next attempt (a fresh notice today, debit tomorrow),
 * or null once `retryDays` retries are used up and the owner should be alerted.
 */
export function nextRetry(params: { attemptNumber: number; retryDays: number; today: Date }) {
  const retries = Math.max(0, Math.round(params.retryDays))
  if (params.attemptNumber > retries) return null
  return { attemptNumber: params.attemptNumber + 1, chargeDate: addDays(dayStart(params.today), 1) }
}

/** Days between two dates (whole days, by calendar day). */
export function daysBetween(a: Date, b: Date) {
  return Math.round((dayStart(b).getTime() - dayStart(a).getTime()) / DAY)
}

/** Razorpay token status → our mandate status. */
export function mandateStatusFromToken(status: string | null | undefined) {
  switch (status) {
    case 'confirmed':
      return 'ACTIVE' as const
    case 'paused':
      return 'PAUSED' as const
    case 'cancelled':
      return 'CANCELLED' as const
    case 'rejected':
      return 'FAILED' as const
    default:
      return 'PENDING' as const
  }
}

// --------------------------------------------------------------------------
// The resident's debit day (also their rent due day)
// --------------------------------------------------------------------------

/** Days 29–31 don't exist in every month, so no window may go past 28. */
export const LATEST_DEBIT_DAY = 28

/** The owner's window: whole days, 1 <= min <= max <= 28. Returns an error message or null. */
export function dayWindowProblem(min: number, max: number) {
  if (!Number.isInteger(min) || !Number.isInteger(max)) return 'Use whole days of the month'
  if (min < 1) return 'The first day must be 1 or later'
  if (max > LATEST_DEBIT_DAY) return `The last day can be ${LATEST_DEBIT_DAY} at most, so every month has it`
  if (min > max) return 'The first day must be on or before the last day'
  return null
}

/** Whether a resident's chosen day is inside the owner's window. Returns an error message or null. */
export function dayProblem(day: number, window: { min: number; max: number }) {
  if (!Number.isInteger(day)) return 'Pick a day of the month'
  if (day < window.min || day > window.max) return `Pick a day from ${window.min} to ${window.max}`
  return null
}

/** The nearest allowed day (used to suggest a starting value, never to silently move a choice). */
export function clampDay(day: number, window: { min: number; max: number }) {
  return Math.min(window.max, Math.max(window.min, Math.round(day)))
}

/** The next debit on `day`: this month if today is on or before it, otherwise next month. */
export function nextChargeDate(day: number, today: Date) {
  const d = Math.min(LATEST_DEBIT_DAY, Math.max(1, Math.round(day)))
  const t = dayStart(today)
  const thisMonth = new Date(t.getFullYear(), t.getMonth(), d)
  return thisMonth.getTime() >= t.getTime() ? thisMonth : new Date(t.getFullYear(), t.getMonth() + 1, d)
}

/** The pre-debit notice goes out the day before the debit. */
export function noticeDate(chargeDate: Date) {
  return addDays(dayStart(chargeDate), -1)
}

/** "1st", "2nd", "3rd", "7th", "21st". */
export function ordinal(day: number) {
  const n = Math.round(day)
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`
}
