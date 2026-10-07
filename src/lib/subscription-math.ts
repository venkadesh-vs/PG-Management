/**
 * Pure SaaS subscription maths and the lifecycle state machine.
 *
 * No database, no Next runtime: the services, the owner/admin pages and the
 * unit tests all compute prices, proration, retries and status changes the
 * same way.
 *
 * Spec state names map onto the stored SubscriptionStatus enum:
 *   TRIAL = TRIALING, PAYMENT_DUE = PAST_DUE, GRACE_PERIOD = GRACE.
 */

export type SubStatus = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'GRACE' | 'SUSPENDED' | 'CANCELLED'
export type Cycle = 'MONTHLY' | 'QUARTERLY' | 'HALF_YEARLY' | 'YEARLY'

const DAY = 86_400_000

// ---------------------------------------------------------------- cycles ---

export const CYCLE_MONTHS: Record<Cycle, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  HALF_YEARLY: 6,
  YEARLY: 12,
}

export const CYCLE_LABEL: Record<Cycle, string> = {
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  HALF_YEARLY: 'Half-yearly',
  YEARLY: 'Yearly',
}

/** "/month", "/year"… for a price shown per billing cycle. */
export const CYCLE_SUFFIX: Record<Cycle, string> = {
  MONTHLY: '/month',
  QUARTERLY: '/quarter',
  HALF_YEARLY: '/half-year',
  YEARLY: '/year',
}

/**
 * What one billing cycle costs (taxable value, whole rupees), given the
 * subscription's monthly amount. Yearly = 12 × monthly × (100 − discount)%;
 * quarterly / half-yearly are plain multiples.
 */
export function cyclePrice(monthly: number, cycle: Cycle, yearlyDiscountPercent = 0): number {
  const months = CYCLE_MONTHS[cycle] ?? 1
  if (cycle === 'YEARLY') {
    const discount = Math.min(100, Math.max(0, yearlyDiscountPercent))
    return Math.round((12 * monthly * (100 - discount)) / 100)
  }
  return monthly * months
}

/** How much a year upfront saves over twelve monthly payments. */
export function yearlySaving(monthly: number, yearlyDiscountPercent: number): number {
  return 12 * monthly - cyclePrice(monthly, 'YEARLY', yearlyDiscountPercent)
}

// ------------------------------------------------------------- proration ---

/**
 * Upgrade mid-period: the difference between the new and the old cycle price
 * for the days still left in the paid period. Whole days, rounded to rupees,
 * never negative (a downgrade waits for the period end instead of refunding).
 */
export function prorate(params: {
  currentCyclePrice: number
  targetCyclePrice: number
  periodStart: Date
  periodEnd: Date
  now: Date
}): { amount: number; remainingDays: number; totalDays: number } {
  const totalDays = Math.max(1, Math.round((params.periodEnd.getTime() - params.periodStart.getTime()) / DAY))
  const left = Math.ceil((params.periodEnd.getTime() - params.now.getTime()) / DAY)
  const remainingDays = Math.min(totalDays, Math.max(0, left))
  const diff = params.targetCyclePrice - params.currentCyclePrice
  if (diff <= 0 || remainingDays === 0) return { amount: 0, remainingDays, totalDays }
  return { amount: Math.round((diff * remainingDays) / totalDays), remainingDays, totalDays }
}

// ---------------------------------------------------------------- retries --

/** Our own (non-mandate) charge retries: 1, 3 and 5 days after the first failure. */
export const RETRY_DAYS = [1, 3, 5] as const

/**
 * When to try again after `failedAttempts` failures counted from the first
 * failure at `firstFailedAt`. Null once every retry has been used — the
 * subscription then moves into its grace period.
 */
export function nextRetryAt(firstFailedAt: Date, failedAttempts: number): Date | null {
  if (failedAttempts < 1) return null
  const offset = RETRY_DAYS[failedAttempts - 1]
  if (offset === undefined) return null
  return new Date(firstFailedAt.getTime() + offset * DAY)
}

export function retriesExhausted(failedAttempts: number): boolean {
  return failedAttempts > RETRY_DAYS.length
}

// -------------------------------------------------------------- lifecycle --

export type LifecycleEvent =
  /** An invoice was raised and nothing will collect it automatically. */
  | { type: 'INVOICE_UNPAID' }
  /** A charge attempt failed. `retriesLeft` = we will try again ourselves. */
  | { type: 'PAYMENT_FAILED'; retriesLeft: boolean }
  /** The invoice is past due and no retry is pending: grace starts. */
  | { type: 'GRACE_STARTED' }
  | { type: 'GRACE_EXPIRED' }
  | { type: 'PAYMENT_SUCCEEDED' }
  | { type: 'TRIAL_EXTENDED' }
  | { type: 'CANCELLED' }
  | { type: 'REACTIVATED'; paidUp: boolean }

/**
 * The subscription state machine. Pure: given the current status and an
 * event, the next status. Events that make no sense in a state leave it
 * unchanged, which is also what keeps a late or duplicated webhook from
 * moving a subscription backwards (e.g. a payment failure after the account
 * was already paid stays ACTIVE because the caller only sends PAYMENT_FAILED
 * when an invoice is still open).
 */
export function nextStatus(current: SubStatus, event: LifecycleEvent): SubStatus {
  switch (event.type) {
    case 'INVOICE_UNPAID':
      return current === 'TRIALING' || current === 'ACTIVE' ? 'PAST_DUE' : current
    case 'PAYMENT_FAILED':
      if (current === 'CANCELLED' || current === 'SUSPENDED' || current === 'GRACE') return current
      return event.retriesLeft ? 'PAST_DUE' : 'GRACE'
    case 'GRACE_STARTED':
      return current === 'PAST_DUE' || current === 'ACTIVE' ? 'GRACE' : current
    case 'GRACE_EXPIRED':
      return current === 'PAST_DUE' || current === 'GRACE' || current === 'ACTIVE' ? 'SUSPENDED' : current
    case 'PAYMENT_SUCCEEDED':
      return current === 'CANCELLED' ? 'CANCELLED' : 'ACTIVE'
    case 'TRIAL_EXTENDED':
      return current === 'CANCELLED' ? current : 'TRIALING'
    case 'CANCELLED':
      return 'CANCELLED'
    case 'REACTIVATED':
      if (current !== 'CANCELLED' && current !== 'SUSPENDED') return current
      return event.paidUp ? 'ACTIVE' : 'PAST_DUE'
  }
}

/** True when this subscription still gives access (not suspended/cancelled). */
export function isLive(status: SubStatus) {
  return status !== 'SUSPENDED' && status !== 'CANCELLED'
}

export const STATUS_WORDS: Record<SubStatus, { label: string; tone: 'ok' | 'info' | 'warn' | 'bad' }> = {
  TRIALING: { label: 'Free trial', tone: 'info' },
  ACTIVE: { label: 'Active', tone: 'ok' },
  PAST_DUE: { label: 'Payment due', tone: 'warn' },
  GRACE: { label: 'Grace period', tone: 'warn' },
  SUSPENDED: { label: 'Suspended', tone: 'bad' },
  CANCELLED: { label: 'Cancelled', tone: 'bad' },
}

/** The status in plain words for the owner. */
export function describeStatus(params: {
  status: SubStatus
  now: Date
  trialEndsAt?: Date | null
  graceEndsAt?: Date | null
  currentPeriodEnd?: Date | null
  cancelAtPeriodEnd?: boolean
  nextRetryAt?: Date | null
}): string {
  const days = (d: Date) => Math.max(0, Math.ceil((d.getTime() - params.now.getTime()) / DAY))
  const plural = (n: number) => `${n} day${n === 1 ? '' : 's'}`
  switch (params.status) {
    case 'TRIALING':
      return params.trialEndsAt
        ? `Free trial — ${plural(days(params.trialEndsAt))} left`
        : 'Free trial'
    case 'ACTIVE':
      return params.cancelAtPeriodEnd && params.currentPeriodEnd
        ? `Active — ends in ${plural(days(params.currentPeriodEnd))} (cancellation scheduled)`
        : 'Active — everything is paid up'
    case 'PAST_DUE':
      return params.nextRetryAt
        ? `Payment failed — we will try again in ${plural(days(params.nextRetryAt))}`
        : 'Payment due — please pay the open invoice'
    case 'GRACE':
      return params.graceEndsAt
        ? `Grace period — pay within ${plural(days(params.graceEndsAt))} to avoid suspension`
        : 'Grace period — please pay the open invoice'
    case 'SUSPENDED':
      return 'Suspended — pay the open invoice to restore access instantly'
    case 'CANCELLED':
      return 'Cancelled'
  }
}

// --------------------------------------------------------------- cancel ----

export const CANCEL_CATEGORIES = [
  { value: 'PRICE', label: 'Too expensive' },
  { value: 'MISSING_FEATURE', label: 'A feature I need is missing' },
  { value: 'CLOSING_PG', label: 'Closing the PG' },
  { value: 'SWITCHING', label: 'Switching to other software' },
  { value: 'OTHER', label: 'Something else' },
] as const

export type CancelCategory = (typeof CANCEL_CATEGORIES)[number]['value']

// ------------------------------------------------------ webhook ordering ---

/**
 * A failure / pending event is stale when a successful payment was recorded
 * after the event was created, or the invoice it is about is already paid.
 * Such an event must not move the subscription backwards.
 */
export function isStaleFailureEvent(params: {
  eventCreatedAt: Date | null
  lastSuccessAt: Date | null
  invoiceAlreadyPaid?: boolean
}): boolean {
  if (params.invoiceAlreadyPaid) return true
  if (params.eventCreatedAt && params.lastSuccessAt && params.lastSuccessAt > params.eventCreatedAt) return true
  return false
}
