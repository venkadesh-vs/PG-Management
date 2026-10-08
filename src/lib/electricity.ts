/**
 * Electricity sub-meter maths. Pure functions, no database: the service feeds
 * them readings, the rate, and who lived in the room, and stores the result.
 *
 * Readings are kept in tenths of a unit and rates in paise so nothing is lost
 * to floating point; only the final bill is rounded, to whole rupees. Shares
 * are split with the largest-remainder method so they always add up to the
 * bill exactly.
 *
 * A room's bill is shared by the people who actually lived in it during the
 * period (from the stay history), not by the number of beds.
 */

export const SPLIT_METHODS = ['DAYS_STAYED', 'EQUAL_PRESENT'] as const
export type SplitMethod = (typeof SPLIT_METHODS)[number]

export const BILLING_MODES = ['NEXT_RENT_INVOICE', 'SEPARATE_INVOICE'] as const
export type BillingMode = (typeof BILLING_MODES)[number]

export const SPLIT_METHOD_LABEL: Record<SplitMethod, string> = {
  DAYS_STAYED: 'By days each person lived in the room',
  EQUAL_PRESENT: 'Equally among people living there on the reading date',
}

export const BILLING_MODE_LABEL: Record<BillingMode, string> = {
  NEXT_RENT_INVOICE: 'Add to each resident’s next rent invoice',
  SEPARATE_INVOICE: 'Send a separate electricity invoice',
}

export function isSplitMethod(value: unknown): value is SplitMethod {
  return typeof value === 'string' && (SPLIT_METHODS as readonly string[]).includes(value)
}

export function isBillingMode(value: unknown): value is BillingMode {
  return typeof value === 'string' && (BILLING_MODES as readonly string[]).includes(value)
}

export type ElectricityErrorCode =
  | 'INVALID_READING'
  | 'NEGATIVE_UNITS'
  | 'INVALID_RATE'
  | 'INVALID_PERIOD'
  | 'NO_OCCUPANTS'

/** A rule the inputs broke. The service turns it into a friendly 422. */
export class ElectricityError extends Error {
  constructor(
    public code: ElectricityErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ElectricityError'
  }
}

// ------------------------------------------------------------------ numbers

/** "1340.5" / 1340.5 → 13405 tenths. At most one decimal place, never negative. */
export function toTenths(value: number | string | { toString(): string }): number {
  const text = typeof value === 'number' ? String(value) : String(value).trim()
  if (!/^\d+(\.\d+)?$/.test(text)) {
    throw new ElectricityError('INVALID_READING', 'A meter reading must be a number of zero or more.')
  }
  const [whole, frac = ''] = text.split('.')
  if (frac.replace(/0+$/, '').length > 1) {
    throw new ElectricityError('INVALID_READING', 'Meter readings can have at most one decimal place.')
  }
  const tenths = Number(whole) * 10 + Number((frac + '0').slice(0, 1))
  if (!Number.isSafeInteger(tenths)) throw new ElectricityError('INVALID_READING', 'That meter reading is too large.')
  return tenths
}

/** "13.5" → 1350 paise. At most two decimal places, more than zero. */
export function toPaise(rate: number | string | { toString(): string }): number {
  const text = typeof rate === 'number' ? String(rate) : String(rate).trim()
  if (!/^\d+(\.\d+)?$/.test(text)) {
    throw new ElectricityError('INVALID_RATE', 'The rate per unit must be a number.')
  }
  const [whole, frac = ''] = text.split('.')
  if (frac.replace(/0+$/, '').length > 2) {
    throw new ElectricityError('INVALID_RATE', 'The rate per unit can have at most two decimal places (paise).')
  }
  const paise = Number(whole) * 100 + Number((frac + '00').slice(0, 2))
  if (paise <= 0) throw new ElectricityError('INVALID_RATE', 'The rate per unit must be more than zero.')
  return paise
}

export const tenthsToNumber = (tenths: number) => tenths / 10
export const paiseToNumber = (paise: number) => paise / 100

/** Units used between two readings, in tenths. A lower current reading is refused. */
export function unitsBetween(previousTenths: number, currentTenths: number): number {
  if (currentTenths < previousTenths) {
    throw new ElectricityError(
      'NEGATIVE_UNITS',
      `The new reading (${tenthsToNumber(currentTenths)}) is lower than the previous one (${tenthsToNumber(previousTenths)}). ` +
        'If the meter was replaced or reset, add the new meter with its starting reading instead.',
    )
  }
  return currentTenths - previousTenths
}

/** units × rate, rounded to whole rupees (half up). */
export function billAmount(unitsTenths: number, ratePaise: number): number {
  // tenths × paise = 1/1000 rupee
  return Math.round((unitsTenths * ratePaise) / 1000)
}

/**
 * Splits `amount` by weight so the parts add up exactly (largest remainder).
 * Ties go to the larger weight, then to input order. All weights zero → all zero.
 */
export function splitByWeight(amount: number, weights: number[]): number[] {
  const total = weights.reduce((s, w) => s + w, 0)
  if (!weights.length || total <= 0 || amount <= 0) return weights.map(() => 0)
  const exact = weights.map((w) => (amount * w) / total)
  const parts = exact.map((x) => Math.floor(x))
  let left = amount - parts.reduce((s, x) => s + x, 0)
  const order = exact
    .map((x, i) => ({ i, rem: x - Math.floor(x), w: weights[i] }))
    .sort((a, b) => b.rem - a.rem || b.w - a.w || a.i - b.i)
  for (const o of order) {
    if (left <= 0) break
    if (weights[o.i] <= 0) continue
    parts[o.i] += 1
    left -= 1
  }
  return parts
}

// -------------------------------------------------------------------- dates

/** Calendar day number of a date in the app's timezone (IST is pinned). */
export function dayNumber(date: Date): number {
  return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000)
}

export type Stay = {
  residentId: string
  /** First day in the room. */
  from: Date
  /** Day they moved out of the room (exclusive); null = still there. */
  to: Date | null
}

export type Leave = { residentId: string; from: Date; to: Date }

const MAX_PERIOD_DAYS = 400

/**
 * Days each resident lived in the room during [periodStart, periodEnd).
 * Several stays of one resident (moved beds inside the room) add up; leave
 * days are taken off when given.
 */
export function occupantDays(params: {
  stays: Stay[]
  periodStart: Date
  periodEnd: Date
  leaves?: Leave[]
}): Map<string, number> {
  const start = dayNumber(params.periodStart)
  const end = dayNumber(params.periodEnd)
  if (end <= start) {
    throw new ElectricityError('INVALID_PERIOD', 'The new reading must be dated after the previous reading.')
  }
  if (end - start > MAX_PERIOD_DAYS) {
    throw new ElectricityError('INVALID_PERIOD', 'Readings are more than a year apart. Record the missing readings first.')
  }

  const days = new Map<string, Set<number>>()
  for (const stay of params.stays) {
    const from = Math.max(start, dayNumber(stay.from))
    const to = Math.min(end, stay.to ? dayNumber(stay.to) : end)
    if (to <= from) continue
    const set = days.get(stay.residentId) ?? new Set<number>()
    for (let d = from; d < to; d++) set.add(d)
    days.set(stay.residentId, set)
  }
  for (const leave of params.leaves ?? []) {
    const set = days.get(leave.residentId)
    if (!set) continue
    // Leave dates are inclusive on both ends.
    for (let d = dayNumber(leave.from); d <= dayNumber(leave.to); d++) set.delete(d)
  }

  const out = new Map<string, number>()
  for (const [id, set] of days) if (set.size > 0) out.set(id, set.size)
  return out
}

/** Residents living in the room on the last day of the period. */
export function presentAtEnd(stays: Stay[], periodEnd: Date): Set<string> {
  const last = dayNumber(periodEnd) - 1
  const present = new Set<string>()
  for (const s of stays) {
    if (dayNumber(s.from) <= last && (!s.to || dayNumber(s.to) > last)) present.add(s.residentId)
  }
  return present
}

// ---------------------------------------------------------------- room bill

export type RoomBillInput = {
  previousReading: number | string
  currentReading: number | string
  ratePerUnit: number | string
  periodStart: Date
  periodEnd: Date
  method: SplitMethod
  stays: Stay[]
  leaves?: Leave[]
  /** Bill the room with nobody charged (empty room, or the owner pays). */
  ownerAbsorbs?: boolean
}

export type RoomBillShare = {
  residentId: string
  daysStayed: number
  weight: number
  share: number
}

export type RoomBillResult = {
  unitsTenths: number
  units: number
  ratePaise: number
  rate: number
  amount: number
  periodDays: number
  occupantCount: number
  ownerAbsorbed: boolean
  shares: RoomBillShare[]
}

/** One room's bill and each resident's share. */
export function computeRoomBill(input: RoomBillInput): RoomBillResult {
  const previous = toTenths(input.previousReading)
  const current = toTenths(input.currentReading)
  const unitsTenths = unitsBetween(previous, current)
  const ratePaise = toPaise(input.ratePerUnit)
  const amount = billAmount(unitsTenths, ratePaise)
  const days = occupantDays({ stays: input.stays, periodStart: input.periodStart, periodEnd: input.periodEnd, leaves: input.leaves })
  const periodDays = dayNumber(input.periodEnd) - dayNumber(input.periodStart)

  let people: { residentId: string; daysStayed: number; weight: number }[]
  if (input.method === 'EQUAL_PRESENT') {
    const present = presentAtEnd(input.stays, input.periodEnd)
    people = [...present].map((id) => ({ residentId: id, daysStayed: days.get(id) ?? 0, weight: 1 }))
  } else {
    people = [...days].map(([id, d]) => ({ residentId: id, daysStayed: d, weight: d }))
  }
  // Stable order: most days first, then id, so rounding is reproducible.
  people.sort((a, b) => b.weight - a.weight || a.residentId.localeCompare(b.residentId))

  const base = {
    unitsTenths,
    units: tenthsToNumber(unitsTenths),
    ratePaise,
    rate: paiseToNumber(ratePaise),
    amount,
    periodDays,
  }

  if (input.ownerAbsorbs) {
    return { ...base, occupantCount: people.length, ownerAbsorbed: true, shares: [] }
  }
  if (!people.length) {
    if (amount === 0) return { ...base, occupantCount: 0, ownerAbsorbed: false, shares: [] }
    throw new ElectricityError(
      'NO_OCCUPANTS',
      'Nobody lived in this room during the period, so there is no one to share the bill with. Choose “Owner pays” to record it.',
    )
  }

  const split = splitByWeight(amount, people.map((p) => p.weight))
  return {
    ...base,
    occupantCount: people.length,
    ownerAbsorbed: false,
    shares: people.map((p, i) => ({ ...p, share: split[i] })),
  }
}

// ------------------------------------------------------------------- labels

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-10" → "Oct 2026". */
export function billingMonthLabel(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month)
  if (!m) return month
  return `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`
}

/** "2026-10" → first day of that month (local time). */
export function monthStart(month: string): Date {
  const m = /^(\d{4})-(\d{2})$/.exec(month)
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) {
    throw new ElectricityError('INVALID_PERIOD', 'Choose the billing month as YYYY-MM.')
  }
  return new Date(Number(m[1]), Number(m[2]) - 1, 1)
}

/** Date → "2026-10". */
export function monthKeyOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

const trim = (n: number) => (Number.isInteger(n) ? String(n) : String(n))

/** The line residents see on their invoice. */
export function shareLabel(params: {
  month: string
  roomNumber: string
  units: number
  rate: number
  amount: number
  daysStayed: number
  periodDays: number
  method: SplitMethod
  occupantCount: number
  interim?: boolean
}): string {
  const head = `Electricity ${billingMonthLabel(params.month)}${params.interim ? ' (to exit date)' : ''} · Room ${params.roomNumber}`
  const bill = `${trim(params.units)} units × ₹${trim(params.rate)} = ₹${params.amount}`
  const split =
    params.method === 'EQUAL_PRESENT'
      ? `shared by ${params.occupantCount}`
      : params.daysStayed === params.periodDays && params.occupantCount > 0
        ? `${params.daysStayed} of ${params.periodDays} days, ${params.occupantCount} sharing`
        : `${params.daysStayed} of ${params.periodDays} days`
  return `${head} · ${bill}, ${split}`
}
