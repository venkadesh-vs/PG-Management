/**
 * Profit & loss — the pure calculation (no database; tests/unit/pnl.test.ts).
 *
 * Basis: CASH, on collections.
 * - Revenue is rent-purpose money received in the period (payment date),
 *   net of refunds; REVERSED payments are left out entirely, and security
 *   deposits (DEPOSIT payments and DEPOSIT invoice lines) are never revenue.
 * - Each payment's money is split by what it paid for: its allocation to an
 *   invoice is shared across that invoice's charge lines in proportion to
 *   their amounts (discounts and credit notes lower the invoice total but do
 *   not take a share). Money not yet applied to any invoice is shown as
 *   "Advance (not yet billed)".
 * - Expenses are APPROVED, not-voided expenses by spend date.
 * - Net profit = revenue − expenses.
 * KPIs: collection rate = paid ÷ billed on invoices for months in the period;
 * outstanding = unpaid balance on those invoices; profit per bed = net ÷
 * total beds; revenue per occupied bed = revenue ÷ average occupied beds;
 * vacancy loss = average empty beds × average rent × months.
 */

export const REVENUE_GROUPS = ['rent', 'food', 'utilities', 'other'] as const
export type RevenueGroup = (typeof REVENUE_GROUPS)[number]

export const REVENUE_LABEL: Record<RevenueGroup | 'advance', string> = {
  rent: 'Rent',
  food: 'Food',
  utilities: 'Electricity & water',
  other: 'Other income',
  advance: 'Advance (not yet billed)',
}

/** Which revenue bucket an invoice line feeds; 'deposit' is held money, not revenue. */
export function lineGroup(kind: string): RevenueGroup | 'deposit' {
  switch (kind) {
    case 'RENT':
    case 'NOTICE':
      return 'rent'
    case 'FOOD':
      return 'food'
    case 'ELECTRICITY':
    case 'WATER':
      return 'utilities'
    case 'DEPOSIT':
      return 'deposit'
    default:
      // MAINTENANCE, LATE_FEE, LAUNDRY, JOINING, FINE, DEBIT_NOTE, OTHER, ADJUSTMENT
      return 'other'
  }
}

export type LineLite = { kind: string; amount: number }
export type Split = Record<RevenueGroup | 'deposit', number>

const emptySplit = (): Split => ({ rent: 0, food: 0, utilities: 0, other: 0, deposit: 0 })

/**
 * Shares `amount` across the invoice's positive lines by weight. Whole
 * rupees; the rounding remainder goes to the largest share so the parts
 * always add back to `amount`. No positive lines → all 'other'.
 */
export function splitAllocation(amount: number, lines: LineLite[]): Split {
  const split = emptySplit()
  if (!amount) return split
  const weights = emptySplit()
  for (const line of lines) {
    if (line.amount > 0) weights[lineGroup(line.kind)] += line.amount
  }
  const totalWeight = Object.values(weights).reduce((s, w) => s + w, 0)
  if (totalWeight <= 0) {
    split.other = amount
    return split
  }
  let assigned = 0
  let largest: keyof Split = 'rent'
  for (const key of Object.keys(weights) as (keyof Split)[]) {
    if (!weights[key]) continue
    split[key] = Math.floor((amount * weights[key]) / totalWeight)
    assigned += split[key]
    if (weights[key] > weights[largest] || !weights[largest]) largest = key
  }
  split[largest] += amount - assigned
  return split
}

export type PaymentLite = {
  amount: number
  refundedAmount: number
  allocations: { amount: number; lines: LineLite[] }[]
}

export type RevenueBreakdown = Record<RevenueGroup | 'advance', number> & {
  total: number
  /** Deposit lines paid through rent payments — reported, not counted. */
  depositExcluded: number
}

export function emptyRevenue(): RevenueBreakdown {
  return { rent: 0, food: 0, utilities: 0, other: 0, advance: 0, total: 0, depositExcluded: 0 }
}

/** Adds one payment's money to a revenue breakdown (mutates `into`). */
export function addPayment(into: RevenueBreakdown, payment: PaymentLite) {
  const net = Math.max(0, payment.amount - payment.refundedAmount)
  if (!net) return into
  let applied = 0
  for (const allocation of payment.allocations) {
    const take = Math.min(allocation.amount, net - applied)
    if (take <= 0) break
    applied += take
    const split = splitAllocation(take, allocation.lines)
    for (const group of REVENUE_GROUPS) into[group] += split[group]
    into.depositExcluded += split.deposit
  }
  into.advance += net - applied
  into.total = REVENUE_GROUPS.reduce((s, g) => s + into[g], 0) + into.advance
  return into
}

export function revenueFromPayments(payments: PaymentLite[]): RevenueBreakdown {
  const revenue = emptyRevenue()
  for (const payment of payments) addPayment(revenue, payment)
  return revenue
}

/** Paid ÷ billed, as a whole percentage (null when nothing was billed). */
export function collectionRate(paid: number, billed: number): number | null {
  if (billed <= 0) return null
  return Math.round((paid / billed) * 100)
}

/** value ÷ beds in whole rupees (null when there are no beds). */
export function perBed(value: number, beds: number): number | null {
  if (!beds || beds <= 0) return null
  return Math.round(value / beds)
}

export function vacancyLoss(totalBeds: number, occupiedBeds: number, averageRent: number, months: number) {
  return Math.max(0, Math.round((totalBeds - occupiedBeds) * averageRent * months))
}

/* ------------------------------------------------------------------ */
/* Assembling a report from flattened records                          */
/* ------------------------------------------------------------------ */

export type PnlInput = {
  /** Months in order, key 'YYYY-MM'. */
  months: { key: string; label: string }[]
  properties: { id: string; name: string; type: string }[]
  payments: (PaymentLite & { propertyId: string; month: string })[]
  expenses: { propertyId: string; month: string; amount: number; category: string }[]
  invoices: { propertyId: string; total: number; amountPaid: number; balance: number }[]
  /** Average beds over the period, per property. */
  beds: Record<string, { total: number; occupied: number }>
  /** Average monthly rent per bed, per property. */
  averageRent: Record<string, number>
}

export type PnlFigures = {
  revenue: RevenueBreakdown
  expenses: number
  expensesByCategory: { name: string; amount: number }[]
  net: number
  billed: number
  paidOnBilled: number
  collectionRate: number | null
  outstanding: number
  beds: number
  occupiedBeds: number
  profitPerBed: number | null
  revenuePerOccupiedBed: number | null
  vacancyLoss: number
}

function figures(
  input: PnlInput,
  propertyIds: Set<string>,
): PnlFigures {
  const revenue = emptyRevenue()
  for (const p of input.payments) if (propertyIds.has(p.propertyId)) addPayment(revenue, p)

  const byCategory = new Map<string, number>()
  let expenses = 0
  for (const e of input.expenses) {
    if (!propertyIds.has(e.propertyId)) continue
    expenses += e.amount
    byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.amount)
  }

  let billed = 0
  let paidOnBilled = 0
  let outstanding = 0
  for (const i of input.invoices) {
    if (!propertyIds.has(i.propertyId)) continue
    billed += i.total
    paidOnBilled += i.amountPaid
    outstanding += i.balance
  }

  let beds = 0
  let occupied = 0
  let loss = 0
  for (const id of propertyIds) {
    const b = input.beds[id]
    if (!b) continue
    beds += b.total
    occupied += b.occupied
    loss += vacancyLoss(b.total, b.occupied, input.averageRent[id] ?? 0, input.months.length)
  }

  const net = revenue.total - expenses
  return {
    revenue,
    expenses,
    expensesByCategory: [...byCategory.entries()]
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount),
    net,
    billed,
    paidOnBilled,
    collectionRate: collectionRate(paidOnBilled, billed),
    outstanding,
    beds: Math.round(beds),
    occupiedBeds: Math.round(occupied * 10) / 10,
    profitPerBed: perBed(net, beds),
    revenuePerOccupiedBed: perBed(revenue.total, occupied),
    vacancyLoss: loss,
  }
}

export function buildPnl(input: PnlInput) {
  const all = new Set(input.properties.map((p) => p.id))
  const total = figures(input, all)
  const byProperty = input.properties.map((p) => ({
    id: p.id,
    name: p.name,
    type: p.type,
    ...figures(input, new Set([p.id])),
  }))

  const trend = input.months.map((m) => {
    const revenue = emptyRevenue()
    for (const p of input.payments) if (p.month === m.key && all.has(p.propertyId)) addPayment(revenue, p)
    const spent = input.expenses
      .filter((e) => e.month === m.key && all.has(e.propertyId))
      .reduce((s, e) => s + e.amount, 0)
    return { key: m.key, month: m.label, revenue: revenue.total, expenses: spent, profit: revenue.total - spent }
  })

  return { total, byProperty, trend }
}

export type PnlReport = ReturnType<typeof buildPnl>

export function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
