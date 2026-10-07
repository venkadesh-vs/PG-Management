import type { InvoiceLineKind, InvoiceStatus } from '@prisma/client'

/**
 * Rent & charges arithmetic. Pure — no database, no clock — so invoice
 * generation, adjustments, payment allocation, reversals and the daily
 * collection report can all be tested from plain data. billing.ts does the
 * reading and writing; every number it stores comes from here.
 */

const DAY = 86400000

/** Local-midnight copy of a date (the app runs in IST; tests pin TZ). */
function dayStart(d: Date) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export type LineDraft = { kind: InvoiceLineKind; label: string; unitPrice: number; quantity?: number }

// --------------------------------------------------------------------------
// Pro-rating
// --------------------------------------------------------------------------

export type Proration = {
  totalDays: number
  /** First billable day of the month (1, or the joining day). */
  fromDay: number
  billableDays: number
  factor: number
  proRated: boolean
}

/** A resident who joins mid-month pays only from the joining day. */
export function prorationFor(joiningDate: Date, periodStart: Date, periodEnd: Date): Proration {
  const totalDays = new Date(periodStart.getFullYear(), periodStart.getMonth() + 1, 0).getDate()
  const joining = dayStart(joiningDate)
  const proRated = joining > periodStart && joining <= periodEnd
  const fromDay = proRated ? joining.getDate() : 1
  const billableDays = totalDays - fromDay + 1
  return { totalDays, fromDay, billableDays, factor: billableDays / totalDays, proRated }
}

// --------------------------------------------------------------------------
// Rent revisions
// --------------------------------------------------------------------------

export type RevisionLike = { oldRent: number; newRent: number; effectiveFrom: Date }

/**
 * The monthly rent in force on a day. `currentRent` (Resident.rentAmount) is
 * always the latest rent, including a revision scheduled for the future; a
 * day before a revision's effective date is billed at that revision's old rent.
 */
export function rentOnDay(day: Date, currentRent: number, revisions: RevisionLike[]): number {
  const d = dayStart(day).getTime()
  const later = revisions
    .filter((r) => dayStart(r.effectiveFrom).getTime() > d)
    .sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime())
  return later.length ? later[0].oldRent : currentRent
}

export type RentSegment = { fromDay: number; toDay: number; monthlyRent: number; amount: number }

/**
 * Splits the billable days of a month into runs at the same monthly rent and
 * prices each run pro-rata. One run covering the whole month is the plain rent.
 */
export function rentSegments(
  periodStart: Date,
  proration: Proration,
  currentRent: number,
  revisions: RevisionLike[],
): RentSegment[] {
  const { totalDays, fromDay } = proration
  const segments: RentSegment[] = []
  for (let day = fromDay; day <= totalDays; day++) {
    const date = new Date(periodStart.getFullYear(), periodStart.getMonth(), day)
    const rent = rentOnDay(date, currentRent, revisions)
    const last = segments[segments.length - 1]
    if (last && last.monthlyRent === rent) last.toDay = day
    else segments.push({ fromDay: day, toDay: day, monthlyRent: rent, amount: 0 })
  }
  for (const s of segments) {
    s.amount = Math.round((s.monthlyRent * (s.toDay - s.fromDay + 1)) / totalDays)
  }
  return segments
}

/** Total rent for a period — what the RENT lines add up to. */
export function rentForPeriod(
  periodStart: Date,
  proration: Proration,
  currentRent: number,
  revisions: RevisionLike[],
) {
  return rentSegments(periodStart, proration, currentRent, revisions).reduce((s, x) => s + x.amount, 0)
}

/**
 * The difference a new revision makes to an already-invoiced period: positive
 * means the resident owes more (debit note), negative means a credit note.
 */
export function revisionDelta(
  periodStart: Date,
  proration: Proration,
  currentRentBefore: number,
  revisionsBefore: RevisionLike[],
  currentRentAfter: number,
  revisionsAfter: RevisionLike[],
) {
  return (
    rentForPeriod(periodStart, proration, currentRentAfter, revisionsAfter) -
    rentForPeriod(periodStart, proration, currentRentBefore, revisionsBefore)
  )
}

// --------------------------------------------------------------------------
// Charges and discounts
// --------------------------------------------------------------------------

export type ChargeKindLike = 'RECURRING' | 'ONE_TIME' | 'DISCOUNT'

export type ChargeLike = {
  id: string
  kind: ChargeKindLike
  category: string
  label: string
  amount: number
  startDate: Date
  endDate: Date | null
  billedInvoiceId: string | null
  voidedAt: Date | null
}

export const RECURRING_CATEGORIES = ['LAUNDRY', 'MAINTENANCE', 'ELECTRICITY', 'FOOD', 'OTHER'] as const
export const ONE_TIME_CATEGORIES = ['JOINING', 'NOTICE', 'FINE', 'PENALTY', 'OTHER'] as const

/** Invoice line kind for a charge category. */
export function lineKindFor(category: string): InvoiceLineKind {
  switch (category) {
    case 'LAUNDRY':
      return 'LAUNDRY'
    case 'MAINTENANCE':
      return 'MAINTENANCE'
    case 'ELECTRICITY':
      return 'ELECTRICITY'
    case 'FOOD':
      return 'FOOD'
    case 'JOINING':
      return 'JOINING'
    case 'NOTICE':
      return 'NOTICE'
    case 'FINE':
    case 'PENALTY':
      return 'FINE'
    default:
      return 'OTHER'
  }
}

/** A recurring charge or discount applies to a period it overlaps. */
export function isActiveFor(charge: ChargeLike, periodStart: Date, periodEnd: Date) {
  if (charge.voidedAt) return false
  if (dayStart(charge.startDate) > periodEnd) return false
  if (charge.endDate && dayStart(charge.endDate) < periodStart) return false
  return true
}

export type ChargeBilling = {
  lines: LineDraft[]
  /** Sum of discount lines, as a positive number. */
  discount: number
  recurringIds: string[]
  oneTimeIds: string[]
  discountIds: string[]
}

/**
 * The charge and discount lines for one period:
 *  - recurring charges and discounts active in the period, pro-rated exactly
 *    as the base rent is (a resident joining on the 18th pays 14/30 of laundry);
 *  - one-time charges dated on or before the period end and not yet billed,
 *    billed in full once.
 */
export function chargeLinesForPeriod(
  charges: ChargeLike[],
  periodStart: Date,
  periodEnd: Date,
  proration: Proration,
): ChargeBilling {
  const out: ChargeBilling = { lines: [], discount: 0, recurringIds: [], oneTimeIds: [], discountIds: [] }
  const suffix = proration.proRated ? ` (${proration.billableDays}/${proration.totalDays} days)` : ''

  for (const c of charges) {
    if (c.voidedAt || c.amount <= 0) continue
    if (c.kind === 'RECURRING' && isActiveFor(c, periodStart, periodEnd)) {
      out.lines.push({
        kind: lineKindFor(c.category),
        label: `${c.label}${suffix}`,
        unitPrice: Math.round(c.amount * proration.factor),
      })
      out.recurringIds.push(c.id)
    } else if (c.kind === 'DISCOUNT' && isActiveFor(c, periodStart, periodEnd)) {
      const amount = Math.round(c.amount * proration.factor)
      out.lines.push({ kind: 'DISCOUNT', label: `${c.label}${suffix}`, unitPrice: -amount })
      out.discount += amount
      out.discountIds.push(c.id)
    } else if (
      c.kind === 'ONE_TIME' &&
      !c.billedInvoiceId &&
      dayStart(c.startDate) <= periodEnd
    ) {
      out.lines.push({ kind: lineKindFor(c.category), label: c.label, unitPrice: c.amount })
      out.oneTimeIds.push(c.id)
    }
  }
  return out
}

/**
 * Puts the invoice together: charges add to the subtotal, discount lines (and
 * the resident's standing discount) reduce it, never below zero.
 * Discount lines carry negative amounts so the lines always sum to the total.
 */
export function composeInvoice(
  baseLines: LineDraft[],
  billing: Pick<ChargeBilling, 'lines'>,
  standingDiscount: number,
  standingDiscountLabel = 'Discount',
) {
  const positive = [...baseLines, ...billing.lines.filter((l) => l.kind !== 'DISCOUNT')]
  const subtotal = positive.reduce((s, l) => s + l.unitPrice * (l.quantity ?? 1), 0)
  const wanted: LineDraft[] = [
    ...(standingDiscount > 0
      ? [{ kind: 'DISCOUNT' as InvoiceLineKind, label: standingDiscountLabel, unitPrice: -standingDiscount }]
      : []),
    ...billing.lines.filter((l) => l.kind === 'DISCOUNT'),
  ]
  // Clamp: discounts can bring an invoice to zero, never below.
  let room = subtotal
  const discounts: LineDraft[] = []
  for (const l of wanted) {
    const amount = Math.min(-l.unitPrice, room)
    if (amount <= 0) continue
    room -= amount
    discounts.push({ ...l, unitPrice: -amount })
  }
  const discount = discounts.reduce((s, l) => s - l.unitPrice, 0)
  return { lines: [...positive, ...discounts], subtotal, discount, total: subtotal - discount }
}

// --------------------------------------------------------------------------
// Invoice state
// --------------------------------------------------------------------------

export type InvoiceMoney = {
  total: number
  amountPaid: number
  dueDate: Date
  status: InvoiceStatus
}

/**
 * Balance and status from the money on an invoice. A cancelled invoice stays
 * cancelled; a waived one stays waived while nothing is owed on it.
 */
export function invoiceState(inv: InvoiceMoney, today: Date): { balance: number; status: InvoiceStatus } {
  const balance = Math.max(0, inv.total - inv.amountPaid)
  if (inv.status === 'CANCELLED') return { balance, status: 'CANCELLED' }
  if (balance <= 0) return { balance: 0, status: inv.status === 'WAIVED' ? 'WAIVED' : 'PAID' }
  if (dayStart(inv.dueDate) < dayStart(today)) return { balance, status: 'OVERDUE' }
  return { balance, status: inv.amountPaid > 0 ? 'PARTIALLY_PAID' : 'PENDING' }
}

export type AdjustmentResult = {
  total: number
  amountPaid: number
  balance: number
  status: InvoiceStatus
  /** Paid money a credit pushed past the new total — becomes an advance. */
  excessPaid: number
}

/**
 * Applies a credit or debit note to an invoice. A credit larger than what is
 * still owed leaves money paid above the new total: that excess is released
 * from the invoice's allocations and becomes the resident's advance.
 */
export function applyAdjustment(
  inv: InvoiceMoney,
  kind: 'CREDIT' | 'DEBIT',
  amount: number,
  today: Date,
  opts: { waiver?: boolean } = {},
): AdjustmentResult {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('Adjustment must be a positive whole amount')
  if (kind === 'CREDIT' && amount > inv.total) throw new Error('A credit cannot exceed the invoice total')
  const total = kind === 'CREDIT' ? inv.total - amount : inv.total + amount
  const excessPaid = Math.max(0, inv.amountPaid - total)
  const amountPaid = inv.amountPaid - excessPaid
  // A debit on a waived/paid invoice reopens it; a waiver closes it as WAIVED.
  const base: InvoiceStatus = opts.waiver ? 'WAIVED' : inv.status === 'WAIVED' && kind === 'DEBIT' ? 'PENDING' : inv.status
  const state = invoiceState({ ...inv, total, amountPaid, status: base === 'PAID' ? 'PENDING' : base }, today)
  return { total, amountPaid, balance: state.balance, status: state.status, excessPaid }
}

/** Which allocations to shrink (newest first) to release `excess` from an invoice. */
export function releaseAllocations(
  allocations: { id: string; amount: number; createdAt: Date }[],
  excess: number,
): { id: string; amount: number; release: number }[] {
  const out: { id: string; amount: number; release: number }[] = []
  let left = excess
  const newestFirst = [...allocations].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  for (const a of newestFirst) {
    if (left <= 0) break
    const release = Math.min(a.amount, left)
    left -= release
    out.push({ id: a.id, amount: a.amount - release, release })
  }
  return out
}

// --------------------------------------------------------------------------
// Payment allocation and reversal
// --------------------------------------------------------------------------

export type OpenInvoice = { id: string; balance: number; dueDate: Date }

/**
 * How a payment spreads over open invoices: the invoices the owner picked
 * first, in the order picked, then everything else oldest-due first. What is
 * left over is an advance for the next invoice.
 */
export function planAllocation(
  open: OpenInvoice[],
  amount: number,
  chosen?: string[],
): { allocations: { invoiceId: string; amount: number }[]; advance: number } {
  const byDue = [...open].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())
  const picked = (chosen ?? [])
    .map((id) => byDue.find((i) => i.id === id))
    .filter((i): i is OpenInvoice => Boolean(i))
  const ordered = [...picked, ...byDue.filter((i) => !picked.includes(i))]
  const allocations: { invoiceId: string; amount: number }[] = []
  let left = amount
  for (const inv of ordered) {
    if (left <= 0) break
    if (inv.balance <= 0) continue
    const applied = Math.min(left, inv.balance)
    left -= applied
    allocations.push({ invoiceId: inv.id, amount: applied })
  }
  return { allocations, advance: left }
}

/** Money on a payment not yet applied to any invoice nor refunded. */
export function unallocatedOf(p: { amount: number; refundedAmount?: number; allocations: { amount: number }[] }) {
  return p.amount - (p.refundedAmount ?? 0) - p.allocations.reduce((s, a) => s + a.amount, 0)
}

/**
 * Invoice money after a payment is reversed: each invoice it paid gets that
 * amount back as owed, and its status is recomputed.
 */
export function reverseAllocations<T extends InvoiceMoney & { id: string }>(
  invoices: T[],
  allocations: { invoiceId: string; amount: number }[],
  today: Date,
): (T & { balance: number })[] {
  return invoices.map((inv) => {
    const removed = allocations.filter((a) => a.invoiceId === inv.id).reduce((s, a) => s + a.amount, 0)
    if (!removed) return { ...inv, balance: Math.max(0, inv.total - inv.amountPaid) }
    const amountPaid = inv.amountPaid - removed
    if (amountPaid < 0) throw new Error('Reversal would make an invoice paid amount negative')
    const status = inv.status === 'PAID' ? 'PENDING' : inv.status
    const state = invoiceState({ ...inv, amountPaid, status }, today)
    return { ...inv, amountPaid, balance: state.balance, status: state.status }
  })
}

// --------------------------------------------------------------------------
// Duplicate payments
// --------------------------------------------------------------------------

/**
 * True when a payment looks like one already recorded: same resident, same
 * amount, same UTR or reference, within 24 hours. Reversed payments don't count.
 */
export function isLikelyDuplicate<
  T extends { amount: number; utr: string | null; reference: string | null; paidAt: Date; createdAt: Date; status: string },
>(
  candidate: { amount: number; utr?: string | null; reference?: string | null; paidAt: Date },
  existing: T[],
  now: Date,
): T | null {
  const norm = (s?: string | null) => (s ?? '').replace(/\s+/g, '').toUpperCase()
  const keys = [norm(candidate.utr), norm(candidate.reference)].filter(Boolean)
  if (!keys.length) return null
  return (
    existing.find((p) => {
      if (p.status === 'REVERSED' || p.status === 'FAILED') return false
      if (p.amount !== candidate.amount) return false
      const theirs = [norm(p.utr), norm(p.reference)].filter(Boolean)
      if (!theirs.some((k) => keys.includes(k))) return false
      const near =
        Math.abs(p.paidAt.getTime() - candidate.paidAt.getTime()) < DAY ||
        Math.abs(p.createdAt.getTime() - now.getTime()) < DAY
      return near
    }) ?? null
  )
}

// --------------------------------------------------------------------------
// Daily collection report
// --------------------------------------------------------------------------

export type LedgerLike = {
  id: string
  residentId: string
  entryDate: Date
  kind: string
  label: string
  debit: number
  credit: number
}

export type DailyBucket = 'INVOICED' | 'COLLECTED' | 'ADJUSTMENT'

/** Where a ledger entry lands in the day's equation. */
export function bucketOf(e: Pick<LedgerLike, 'kind' | 'debit' | 'credit'>): DailyBucket {
  if (e.kind === 'CHARGE' && e.debit > 0 && e.credit === 0) return 'INVOICED'
  if (e.kind === 'PAYMENT' && e.credit > 0 && e.debit === 0) return 'COLLECTED'
  return 'ADJUSTMENT'
}

export type DailyCollection = {
  opening: number
  invoiced: number
  collected: number
  /** Signed: positive raises what is owed (debit notes, reversals), negative lowers it. */
  adjustments: number
  closing: number
  entries: { invoiced: LedgerLike[]; collected: LedgerLike[]; adjustments: LedgerLike[] }
  openingByResident: Map<string, number>
}

/**
 * Opening + invoiced − collected ± adjustments = closing, from the resident
 * ledger (the append-only record of every rupee owed and paid). Opening is
 * everything dated before the day; closing is everything up to its end, so
 * the equation holds by construction and any mismatch is a bug.
 */
export function dailyCollection(entries: LedgerLike[], dayFrom: Date, dayTo: Date): DailyCollection {
  const before = entries.filter((e) => e.entryDate < dayFrom)
  const today = entries.filter((e) => e.entryDate >= dayFrom && e.entryDate <= dayTo)
  const openingByResident = new Map<string, number>()
  for (const e of before) {
    openingByResident.set(e.residentId, (openingByResident.get(e.residentId) ?? 0) + e.debit - e.credit)
  }
  const opening = before.reduce((s, e) => s + e.debit - e.credit, 0)
  const buckets = { invoiced: [] as LedgerLike[], collected: [] as LedgerLike[], adjustments: [] as LedgerLike[] }
  for (const e of today) {
    const b = bucketOf(e)
    if (b === 'INVOICED') buckets.invoiced.push(e)
    else if (b === 'COLLECTED') buckets.collected.push(e)
    else if (e.debit !== 0 || e.credit !== 0) buckets.adjustments.push(e)
  }
  const invoiced = buckets.invoiced.reduce((s, e) => s + e.debit, 0)
  const collected = buckets.collected.reduce((s, e) => s + e.credit, 0)
  const adjustments = buckets.adjustments.reduce((s, e) => s + e.debit - e.credit, 0)
  return {
    opening,
    invoiced,
    collected,
    adjustments,
    closing: opening + invoiced - collected + adjustments,
    entries: buckets,
    openingByResident,
  }
}
