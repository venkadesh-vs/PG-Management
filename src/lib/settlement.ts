/**
 * Checkout settlement arithmetic (PRD §25, §29). Pure — no database — so the
 * same numbers drive the live preview, the checkout transaction and the tests.
 *
 *   owed    = open invoice balances + unbilled utilities + deductions
 *             + unbilled one-time charges (joining, notice, fines...)
 *             + pro-rata charge for the exit month (when not yet invoiced):
 *               rent at the rate in force on each day (rent revisions),
 *               maintenance, food and the resident's recurring charges,
 *               less the standing discount and recurring discounts
 *   credits = deposit collected + unallocated advance
 *             + unused-days credit (when the exit month was already invoiced)
 *
 * Credits are consumed in a fixed order — unused-days credit, then advance,
 * then deposit — so the deposit is touched only when the other money runs out.
 * Whatever is left is the refund; whatever is not covered is payable.
 */

export type SettlementDeduction = { label: string; amount: number }

/** A run of days in the exit month at one monthly rent (see rentSegments in billing-calc). */
export type RentSegmentInput = { fromDay: number; toDay: number; monthlyRent: number }

/**
 * A recurring charge or discount (ResidentCharge) as a monthly amount, active
 * from `fromDay` to `toDay` of the exit month (defaults: the whole month).
 */
export type RecurringChargeInput = {
  label: string
  category: string
  amount: number
  discount?: boolean
  fromDay?: number
  toDay?: number
}

export type OneTimeChargeInput = { label: string; category?: string; amount: number }

export type ExitMonthInput = {
  /** Days in the exit month. */
  totalDays: number
  /** First billable day of the month: 1, or the joining day if they joined that month. */
  fromDay: number
  /** Day of the month the resident leaves (the last day they stay). */
  exitDay: number
  /** Monthly amounts from the resident's plan. */
  monthly: { rent: number; maintenance: number; food: number; discount: number }
  /**
   * Rent by day when a revision changes it inside the month. When given, the
   * rent line is priced from these runs instead of `monthly.rent`.
   */
  rentSegments?: RentSegmentInput[]
  /** Recurring charges and discounts active in the exit month. */
  recurring?: RecurringChargeInput[]
  /**
   * Net amount already invoiced for the exit month (rent + maintenance + food
   * − discount, excluding late fees), or null when the month is not invoiced.
   */
  invoicedCharge: number | null
}

export type SettlementInput = {
  openBalances: number
  utilities: number
  deductions: SettlementDeduction[]
  exitMonth: ExitMonthInput | null
  /** One-time charges not billed on any invoice yet - billed in full. */
  oneTimeCharges?: OneTimeChargeInput[]
  depositCollected: number
  advance: number
}

export type ExitMonthLine = {
  kind: 'RENT' | 'MAINTENANCE' | 'FOOD' | 'DISCOUNT' | 'CHARGE'
  amount: number
  /** Set for recurring charges and discounts (their own name). */
  label?: string
  category?: string
}

export type SettlementResult = {
  usedDays: number
  unusedDays: number
  /** Pro-rata lines for an exit month that was not invoiced (discount negative). */
  exitMonthLines: ExitMonthLine[]
  exitMonthCharge: number
  unusedDaysCredit: number
  oneTimeCharges: { label: string; category: string; amount: number }[]
  oneTimeTotal: number
  deductions: SettlementDeduction[]
  deductionsTotal: number
  owed: number
  credits: number
  applied: { unusedCredit: number; advance: number; deposit: number }
  depositReturned: number
  advanceReturned: number
  refundable: number
  payable: number
}

const whole = (n: number) => Math.max(0, Math.round(Number.isFinite(n) ? n : 0))

export function computeSettlement(input: SettlementInput): SettlementResult {
  const deductions = input.deductions
    .map((d) => ({ label: d.label.trim() || 'Deduction', amount: whole(d.amount) }))
    .filter((d) => d.amount > 0)
  const deductionsTotal = deductions.reduce((s, d) => s + d.amount, 0)

  let usedDays = 0
  let unusedDays = 0
  let exitMonthLines: ExitMonthLine[] = []
  let exitMonthCharge = 0
  let unusedDaysCredit = 0

  const m = input.exitMonth
  if (m && m.totalDays > 0) {
    const fromDay = Math.min(Math.max(1, m.fromDay), m.totalDays)
    const exitDay = Math.min(Math.max(0, m.exitDay), m.totalDays)
    const billedDays = m.totalDays - fromDay + 1
    usedDays = Math.max(0, exitDay - fromDay + 1)
    unusedDays = Math.max(0, Math.min(billedDays, m.totalDays - exitDay))

    if (m.invoicedCharge == null) {
      const days = (from: number, to: number) => Math.max(0, Math.min(to, exitDay) - Math.max(from, fromDay) + 1)
      const priced = (monthly: number, from = 1, to = m.totalDays) =>
        Math.round((whole(monthly) * days(from, to)) / m.totalDays)
      const rent = m.rentSegments?.length
        ? m.rentSegments.reduce((sum, seg) => sum + priced(seg.monthlyRent, seg.fromDay, seg.toDay), 0)
        : priced(m.monthly.rent)
      const maintenance = priced(m.monthly.maintenance)
      const food = priced(m.monthly.food)
      const recurring = m.recurring ?? []
      const chargeLines: ExitMonthLine[] = recurring
        .filter((c) => !c.discount)
        .map((c) => ({
          kind: 'CHARGE' as const,
          label: c.label,
          category: c.category,
          amount: priced(c.amount, c.fromDay ?? 1, c.toDay ?? m.totalDays),
        }))
        .filter((l) => l.amount > 0)
      const gross = rent + maintenance + food + chargeLines.reduce((sum, l) => sum + l.amount, 0)

      // Discounts bring the month to zero at most: the standing discount first.
      let room = gross
      const clamp = (amount: number) => {
        const used = Math.min(amount, room)
        room -= used
        return used
      }
      const standing = clamp(priced(m.monthly.discount))
      const discountLines: ExitMonthLine[] = recurring
        .filter((c) => c.discount)
        .map((c) => ({
          kind: 'DISCOUNT' as const,
          label: c.label,
          category: c.category,
          amount: -clamp(priced(c.amount, c.fromDay ?? 1, c.toDay ?? m.totalDays)),
        }))
        .filter((l) => l.amount !== 0)

      exitMonthLines = [
        ...(
          [
            { kind: 'RENT', amount: rent },
            { kind: 'MAINTENANCE', amount: maintenance },
            { kind: 'FOOD', amount: food },
          ] as ExitMonthLine[]
        ).filter((l) => l.amount !== 0),
        ...chargeLines,
        ...(standing > 0 ? [{ kind: 'DISCOUNT', amount: -standing } as ExitMonthLine] : []),
        ...discountLines,
      ]
      exitMonthCharge = exitMonthLines.reduce((sum, l) => sum + l.amount, 0)
      unusedDays = 0
    } else if (billedDays > 0) {
      unusedDaysCredit = Math.round((whole(m.invoicedCharge) * unusedDays) / billedDays)
    }
  }

  const openBalances = whole(input.openBalances)
  const utilities = whole(input.utilities)
  const deposit = whole(input.depositCollected)
  const advance = whole(input.advance)

  const oneTimeCharges = (input.oneTimeCharges ?? [])
    .map((c) => ({ label: c.label.trim() || 'Charge', category: c.category ?? 'OTHER', amount: whole(c.amount) }))
    .filter((c) => c.amount > 0)
  const oneTimeTotal = oneTimeCharges.reduce((s, c) => s + c.amount, 0)

  const owed = openBalances + utilities + deductionsTotal + exitMonthCharge + oneTimeTotal
  const credits = deposit + advance + unusedDaysCredit

  let need = owed
  const take = (available: number) => {
    const used = Math.min(available, need)
    need -= used
    return used
  }
  const applied = {
    unusedCredit: take(unusedDaysCredit),
    advance: take(advance),
    deposit: take(deposit),
  }

  return {
    usedDays,
    unusedDays,
    exitMonthLines,
    exitMonthCharge,
    unusedDaysCredit,
    oneTimeCharges,
    oneTimeTotal,
    deductions,
    deductionsTotal,
    owed,
    credits,
    applied,
    depositReturned: deposit - applied.deposit,
    advanceReturned: advance - applied.advance,
    refundable: Math.max(0, credits - owed),
    payable: need,
  }
}

// --------------------------------------------------------------------------
// Invoices after the exit, charges in the exit month
// --------------------------------------------------------------------------

/** First day of the month after the exit month - invoices from here on are cancelled. */
export function firstDayAfterExitMonth(exitDate: Date) {
  return new Date(exitDate.getFullYear(), exitDate.getMonth() + 1, 1)
}

/**
 * Invoices raised for periods that start after the exit month (bills made in
 * advance). They are cancelled at checkout rather than left outstanding; what
 * was paid on them becomes advance and goes back into the settlement.
 */
export function invoicesAfterExit<T extends { periodStart: Date; status: string }>(invoices: T[], exitDate: Date): T[] {
  const cutoff = firstDayAfterExitMonth(exitDate).getTime()
  return invoices.filter(
    (i) => i.periodStart.getTime() >= cutoff && i.status !== 'CANCELLED' && i.status !== 'WAIVED',
  )
}

/**
 * The days of the exit month a recurring charge covers, or null when it does
 * not apply to that month (ended before it, or starting after the exit day).
 */
export function chargeDaysInExitMonth(
  charge: { startDate: Date; endDate: Date | null },
  exitDate: Date,
): { fromDay: number; toDay: number } | null {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const exit = day(exitDate)
  const monthStart = new Date(exit.getFullYear(), exit.getMonth(), 1)
  const totalDays = new Date(exit.getFullYear(), exit.getMonth() + 1, 0).getDate()
  const start = day(charge.startDate)
  const end = charge.endDate ? day(charge.endDate) : null
  if (start > exit) return null
  if (end && end < monthStart) return null
  const fromDay = start < monthStart ? 1 : start.getDate()
  const sameMonth = end && end.getFullYear() === exit.getFullYear() && end.getMonth() === exit.getMonth()
  const toDay = sameMonth ? end!.getDate() : totalDays
  return toDay >= fromDay ? { fromDay, toDay } : null
}
