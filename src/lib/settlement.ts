/**
 * Checkout settlement arithmetic (PRD §25, §29). Pure — no database — so the
 * same numbers drive the live preview, the checkout transaction and the tests.
 *
 *   owed    = open invoice balances + unbilled utilities + deductions
 *             + pro-rata charge for the exit month (when not yet invoiced)
 *   credits = deposit collected + unallocated advance
 *             + unused-days credit (when the exit month was already invoiced)
 *
 * Credits are consumed in a fixed order — unused-days credit, then advance,
 * then deposit — so the deposit is touched only when the other money runs out.
 * Whatever is left is the refund; whatever is not covered is payable.
 */

export type SettlementDeduction = { label: string; amount: number }

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
  depositCollected: number
  advance: number
}

export type ExitMonthLine = {
  kind: 'RENT' | 'MAINTENANCE' | 'FOOD' | 'DISCOUNT'
  amount: number
}

export type SettlementResult = {
  usedDays: number
  unusedDays: number
  /** Pro-rata lines for an exit month that was not invoiced (discount negative). */
  exitMonthLines: ExitMonthLine[]
  exitMonthCharge: number
  unusedDaysCredit: number
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
      const part = (amount: number) => Math.round((whole(amount) * usedDays) / m.totalDays)
      const rent = part(m.monthly.rent)
      const maintenance = part(m.monthly.maintenance)
      const food = part(m.monthly.food)
      const discount = Math.min(part(m.monthly.discount), rent + maintenance + food)
      exitMonthLines = (
        [
          { kind: 'RENT', amount: rent },
          { kind: 'MAINTENANCE', amount: maintenance },
          { kind: 'FOOD', amount: food },
          { kind: 'DISCOUNT', amount: -discount },
        ] as ExitMonthLine[]
      ).filter((l) => l.amount !== 0)
      exitMonthCharge = rent + maintenance + food - discount
      unusedDays = 0
    } else if (billedDays > 0) {
      unusedDaysCredit = Math.round((whole(m.invoicedCharge) * unusedDays) / billedDays)
    }
  }

  const openBalances = whole(input.openBalances)
  const utilities = whole(input.utilities)
  const deposit = whole(input.depositCollected)
  const advance = whole(input.advance)

  const owed = openBalances + utilities + deductionsTotal + exitMonthCharge
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
