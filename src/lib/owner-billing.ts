import { addDays, daysBetween, startOfDay, toISODate } from './utils'

/**
 * StayFlow billing notices to PG owners: which reminder is due on which day,
 * the keys that make each one go out exactly once, the grace banner and the
 * paywall decision. Pure, so it is unit-tested; the service does the sending.
 */

export type OwnerBillingKind =
  | 'TRIAL_ENDING'
  | 'INVOICE_RAISED'
  | 'DUE_SOON'
  | 'GRACE_STARTED'
  | 'GRACE_REMINDER'
  | 'SUSPENDED'
  | 'PAYMENT_RECEIVED'

export type OwnerBillingChannel = 'WHATSAPP' | 'EMAIL'
export const OWNER_BILLING_CHANNELS: OwnerBillingChannel[] = ['WHATSAPP', 'EMAIL']

/** When the scheduled reminders go out. Platform setting `billing:reminder_schedule`. */
export type ReminderSchedule = {
  /** Days before the trial ends. */
  trialDaysBefore: number[]
  /** Days before the invoice due date (1 = due tomorrow, 0 = due today). */
  dueDaysBefore: number[]
  /** Days before the account is paused, during the grace period. */
  graceDaysLeft: number[]
}

export const DEFAULT_REMINDER_SCHEDULE: ReminderSchedule = {
  trialDaysBefore: [3, 1],
  dueDaysBefore: [1, 0],
  graceDaysLeft: [3, 1],
}

function dayList(value: unknown, fallback: number[]): number[] {
  if (!Array.isArray(value)) return fallback
  const days = value
    .map((v) => Number(v))
    .filter((v) => Number.isInteger(v) && v >= 0 && v <= 30)
  return [...new Set(days)].sort((a, b) => b - a)
}

/** Reads the stored setting, falling back field by field to the defaults. */
export function parseReminderSchedule(value: unknown): ReminderSchedule {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  return {
    trialDaysBefore: dayList(v.trialDaysBefore, DEFAULT_REMINDER_SCHEDULE.trialDaysBefore),
    dueDaysBefore: dayList(v.dueDaysBefore, DEFAULT_REMINDER_SCHEDULE.dueDaysBefore),
    graceDaysLeft: dayList(v.graceDaysLeft, DEFAULT_REMINDER_SCHEDULE.graceDaysLeft),
  }
}

// ---------------------------------------------------------------- keys ----

const day = (d: Date) => toISODate(startOfDay(d))

/** Exactly-once keys. Scheduled ones include the day count; events the cycle. */
export const reminderKey = {
  trialEnding: (subscriptionId: string, trialEndsAt: Date, daysBefore: number) =>
    `trial:${subscriptionId}:${day(trialEndsAt)}:${daysBefore}`,
  invoiceRaised: (invoiceId: string) => `invoice:${invoiceId}`,
  dueSoon: (invoiceId: string, daysBefore: number) => `due:${invoiceId}:${daysBefore}`,
  graceStarted: (invoiceId: string) => `grace-start:${invoiceId}`,
  graceReminder: (invoiceId: string, daysLeft: number) => `grace:${invoiceId}:${daysLeft}`,
  suspended: (subscriptionId: string, graceEndsAt: Date) => `suspended:${subscriptionId}:${day(graceEndsAt)}`,
  paymentReceived: (invoiceId: string) => `paid:${invoiceId}`,
}

// ------------------------------------------------------------ schedule ----

export type ScheduleSubscription = {
  id: string
  status: string
  trialEndsAt: Date | null
  graceEndsAt: Date | null
  autopay: boolean
}

export type ScheduleInvoice = {
  id: string
  number: string
  dueDate: Date
  /** Amount still owed. */
  balance: number
}

export type DueReminder =
  | { kind: 'TRIAL_ENDING'; key: string; daysBefore: number; trialEndsAt: Date }
  | { kind: 'DUE_SOON'; key: string; daysBefore: number; invoice: ScheduleInvoice }
  | { kind: 'GRACE_REMINDER'; key: string; daysLeft: number; invoice: ScheduleInvoice; lastActiveDay: Date }

/** The last day the account is fully usable: suspension happens on graceEndsAt. */
export function lastActiveDay(graceEndsAt: Date) {
  return addDays(startOfDay(graceEndsAt), -1)
}

/** Days until the account is paused (1 on the last active day, 0 once paused). */
export function daysUntilPause(graceEndsAt: Date, today: Date) {
  return Math.max(0, daysBetween(today, graceEndsAt))
}

/**
 * Scheduled reminders that fall on `today` for one subscription. The caller
 * records each key, so a day missed or repeated never sends twice.
 */
export function remindersDue(params: {
  today: Date
  subscription: ScheduleSubscription
  /** Unpaid invoices of this subscription. */
  invoices: ScheduleInvoice[]
  schedule: ReminderSchedule
}): DueReminder[] {
  const { subscription: sub, schedule } = params
  const today = startOfDay(params.today)
  const out: DueReminder[] = []

  if (sub.status === 'TRIALING' && sub.trialEndsAt) {
    const before = daysBetween(today, sub.trialEndsAt)
    if (schedule.trialDaysBefore.includes(before)) {
      out.push({
        kind: 'TRIAL_ENDING',
        key: reminderKey.trialEnding(sub.id, sub.trialEndsAt, before),
        daysBefore: before,
        trialEndsAt: sub.trialEndsAt,
      })
    }
  }

  for (const invoice of params.invoices) {
    if (invoice.balance <= 0) continue
    const before = daysBetween(today, invoice.dueDate)
    // AutoPay collects on its own; owners only hear about it if it fails.
    if (!sub.autopay && schedule.dueDaysBefore.includes(before)) {
      out.push({ kind: 'DUE_SOON', key: reminderKey.dueSoon(invoice.id, before), daysBefore: before, invoice })
    }
    if (sub.status === 'GRACE' && sub.graceEndsAt && startOfDay(invoice.dueDate) < today) {
      const left = daysUntilPause(sub.graceEndsAt, today)
      if (left > 0 && schedule.graceDaysLeft.includes(left)) {
        out.push({
          kind: 'GRACE_REMINDER',
          key: reminderKey.graceReminder(invoice.id, left),
          daysLeft: left,
          invoice,
          lastActiveDay: lastActiveDay(sub.graceEndsAt),
        })
      }
    }
  }
  return out
}

/** "today, 12 Oct" / "tomorrow, 12 Oct" / "on 12 Oct" — for messages. */
export function dueWhen(daysBefore: number, dateLabel: string) {
  if (daysBefore === 0) return `today, ${dateLabel}`
  if (daysBefore === 1) return `tomorrow, ${dateLabel}`
  return `on ${dateLabel}`
}

export function daysLeftLabel(days: number) {
  return days === 1 ? '1 day left' : `${days} days left`
}

// --------------------------------------------------------------- banner ----

export type GraceBanner = {
  amount: number
  invoiceNumber: string
  lastActiveDay: Date
  daysLeft: number
  tone: 'amber' | 'rose'
}

/**
 * The owner's top banner while a StayFlow payment is overdue but the account
 * is still fully active (grace). Null when nothing is overdue.
 */
export function graceBanner(params: {
  today: Date
  subscriptions: { status: string; graceEndsAt: Date | null }[]
  invoices: { number: string; dueDate: Date; balance: number }[]
}): GraceBanner | null {
  const today = startOfDay(params.today)
  const overdue = params.invoices.filter((i) => i.balance > 0 && startOfDay(i.dueDate) < today)
  if (!overdue.length) return null
  const ends = params.subscriptions
    .filter((s) => ['PAST_DUE', 'GRACE', 'ACTIVE'].includes(s.status) && s.graceEndsAt && startOfDay(s.graceEndsAt) > today)
    .map((s) => s.graceEndsAt as Date)
    .sort((a, b) => a.getTime() - b.getTime())
  if (!ends.length) return null
  const daysLeft = daysUntilPause(ends[0], today)
  return {
    amount: overdue.reduce((sum, i) => sum + i.balance, 0),
    invoiceNumber: overdue[0].number,
    lastActiveDay: lastActiveDay(ends[0]),
    daysLeft,
    tone: daysLeft <= 1 ? 'rose' : 'amber',
  }
}

// -------------------------------------------------------------- paywall ----

/** Owner pages that stay open while the account is paused, so the owner can pay. */
export const PAYWALL_OPEN_PATHS = ['/app/subscription', '/paywall'] as const

/**
 * Server-side decision for owner/manager pages. Super Admins, residents and
 * staff are handled elsewhere (never blocked / their own paused page).
 */
export function paywallDecision(params: {
  role: string
  organizationStatus: string | null
  path?: string | null
}): 'allow' | 'paywall' {
  if (params.role !== 'OWNER' && params.role !== 'MANAGER') return 'allow'
  if (params.organizationStatus !== 'SUSPENDED' && params.organizationStatus !== 'CANCELLED') return 'allow'
  const path = params.path ?? ''
  if (PAYWALL_OPEN_PATHS.some((p) => path === p || path.startsWith(`${p}/`) || path.startsWith(`${p}?`))) {
    return 'allow'
  }
  return 'paywall'
}

// ------------------------------------------------------------- payments ----

/** Platform payee details, Super Admin setting `billing:payment_details`. */
export type PlatformPaymentDetails = {
  upiId: string
  payeeName: string
  bankName: string
  accountName: string
  accountNumber: string
  ifsc: string
  supportWhatsapp: string
  supportEmail: string
}

export const EMPTY_PAYMENT_DETAILS: PlatformPaymentDetails = {
  upiId: '',
  payeeName: '',
  bankName: '',
  accountName: '',
  accountNumber: '',
  ifsc: '',
  supportWhatsapp: '',
  supportEmail: '',
}

export function parsePaymentDetails(value: unknown): PlatformPaymentDetails {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const out = { ...EMPTY_PAYMENT_DETAILS }
  for (const key of Object.keys(out) as (keyof PlatformPaymentDetails)[]) {
    if (typeof v[key] === 'string') out[key] = (v[key] as string).trim()
  }
  return out
}

/** `upi://pay` link with the exact amount, for the paywall's "Pay by UPI". */
export function upiPayLink(params: { upiId: string; payeeName: string; amount: number; note: string }) {
  if (!params.upiId) return null
  const q = new URLSearchParams({
    pa: params.upiId,
    pn: params.payeeName || 'StayFlow',
    am: String(params.amount),
    cu: 'INR',
    tn: params.note,
  })
  return `upi://pay?${q.toString()}`
}
