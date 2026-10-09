import { prorationFor } from './billing-calc'
import { clampDay, ordinal } from './autopay'

/**
 * The first month at check-in. A resident joins on any day (say the 18th); for that
 * month the owner collects whatever they decide, by hand, and the regular cycle starts
 * on the 1st of the next calendar month, due on the resident's day within the owner's
 * window. Never anniversary billing (the 18th of every month).
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export type FirstMonthInput = {
  joiningDate: Date
  rentAmount: number
  maintenanceFee?: number
  foodOptIn?: boolean
  foodCharge?: number
  discountAmount?: number
}

/**
 * The suggested first-month amount: exactly what the regular prorated invoice for the
 * joining month would be (rent, maintenance and food for the days from joining to the
 * month end, less any discount), so the owner starts from a familiar number.
 */
export function firstMonthSuggestion(input: FirstMonthInput) {
  const join = new Date(input.joiningDate.getFullYear(), input.joiningDate.getMonth(), input.joiningDate.getDate())
  const monthStart = new Date(join.getFullYear(), join.getMonth(), 1)
  const monthEnd = new Date(join.getFullYear(), join.getMonth() + 1, 0)
  const p = prorationFor(join, monthStart, monthEnd)
  const rent = Math.round((Math.max(0, input.rentAmount) * p.billableDays) / p.totalDays)
  const maintenance = input.maintenanceFee && input.maintenanceFee > 0 ? Math.round(input.maintenanceFee * p.factor) : 0
  const food = input.foodOptIn !== false && input.foodCharge && input.foodCharge > 0 ? Math.round(input.foodCharge * p.factor) : 0
  const subtotal = rent + maintenance + food
  const amount = Math.max(0, subtotal - Math.min(input.discountAmount ?? 0, subtotal))
  const fromDay = p.fromDay
  const toDay = p.totalDays
  const month = MONTHS[join.getMonth()]
  return {
    amount,
    days: p.billableDays,
    totalDays: p.totalDays,
    fromDay,
    toDay,
    /** "18–31 Oct" */
    range: fromDay === toDay ? `${fromDay} ${month}` : `${fromDay}–${toDay} ${month}`,
    /** The first regular invoice: the 1st of the next calendar month. */
    nextMonthStart: new Date(join.getFullYear(), join.getMonth() + 1, 1),
  }
}

/** The line label on the first-month invoice: "First month (18–31 Oct)". */
export function firstMonthLabel(joiningDate: Date) {
  return `First month (${firstMonthSuggestion({ joiningDate, rentAmount: 0 }).range})`
}

/** The default regular due day: the PG's own due day, moved inside the owner's window. */
export function defaultDueDay(pgDueDay: number, window: { min: number; max: number }) {
  return clampDay(pgDueDay, window)
}

const METHOD_WORDS: Record<string, string> = { CASH: 'by cash', UPI: 'by UPI', BANK_TRANSFER: 'by bank transfer' }
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/**
 * The one-line check-in summary on the resident page:
 * "First month: ₹3,613 collected by cash on 18 Oct · Advance ₹16,000 · Regular rent due on the 7th from November".
 * `money` formats rupees so the caller's currency formatting is used.
 */
export function firstMonthSummary(input: {
  joiningDate: Date
  /** The joining-month "First month" invoice total; null when the resident predates the first-month flow. */
  amount: number | null
  method?: string | null
  paidAt?: Date | null
  advance: number
  rentDueDay: number
  money: (n: number) => string
}) {
  const parts: string[] = []
  if (input.amount !== null) {
    if (input.amount <= 0) parts.push('First month: not charged')
    else {
      const how = input.method ? ` ${METHOD_WORDS[input.method] ?? `by ${input.method.toLowerCase()}`}` : ''
      const when = input.paidAt ? ` on ${input.paidAt.getDate()} ${MONTHS[input.paidAt.getMonth()]}` : ''
      parts.push(`First month: ${input.money(input.amount)} collected${how}${when}`)
    }
  }
  if (input.advance > 0) parts.push(`Advance ${input.money(input.advance)}`)
  const next = new Date(input.joiningDate.getFullYear(), input.joiningDate.getMonth() + 1, 1)
  parts.push(`Regular rent due on the ${ordinal(input.rentDueDay)} from ${MONTH_NAMES[next.getMonth()]}`)
  return parts.join(' · ')
}
