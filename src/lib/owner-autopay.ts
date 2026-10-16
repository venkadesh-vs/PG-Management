/**
 * Owner AutoPay for the combined StayFlow bill — the pure rules (no database,
 * no Razorpay).
 *
 * The owner approves one mandate (UPI AutoPay, bank eMandate or card) with a
 * per-debit limit. Each month StayFlow debits exactly that month's combined
 * bill (every PG line due that day), never above the limit, with a pre-debit
 * notice at least a day before. Debit timing, retries and notices reuse the
 * resident AutoPay rules in `@/lib/autopay`.
 */

import { autopayMaxAmount, type AutopayMethod } from '@/lib/autopay'

/**
 * Highest per-debit limit each method allows without an extra approval on
 * every debit: UPI AutoPay and card e-mandates stop at ₹15,000 (RBI); a bank
 * eMandate goes far higher.
 */
export const OWNER_METHOD_CEILING: Record<AutopayMethod, number> = {
  UPI: 15_000,
  CARD: 15_000,
  EMANDATE: 1_000_000,
}

/** Headroom over today's bill, so adding a PG or a late fee still fits. */
export const OWNER_LIMIT_PERCENT = 200

/**
 * The limit the owner approves for a method: twice the next bill rounded up
 * to ₹500, capped by the method's ceiling. Null when even the bill itself is
 * above the ceiling (that method cannot pay it).
 */
export function ownerAutopayLimit(nextBill: number, method: AutopayMethod): number | null {
  const ceiling = OWNER_METHOD_CEILING[method]
  if (nextBill > ceiling) return null
  return Math.min(ceiling, autopayMaxAmount({ monthlyBill: nextBill, percent: OWNER_LIMIT_PERCENT }))
}

export type BillLine = { id: string; dueDate: Date; total: number; amountPaid: number; status: string }

const UNPAID = new Set(['PENDING', 'PARTIALLY_PAID', 'OVERDUE'])
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`

/**
 * Unpaid lines grouped into combined bills (one per due day), each shaped as an
 * open invoice for `planNotices`: id = the due day's key, balance = what is
 * still owed on all its lines.
 */
export function groupBills(lines: BillLine[]) {
  const bills = new Map<string, { id: string; dueDate: Date; balance: number; status: string; lineIds: string[] }>()
  for (const l of lines) {
    if (!UNPAID.has(l.status)) continue
    const due = Math.max(0, l.total - l.amountPaid)
    if (due <= 0) continue
    const day = new Date(l.dueDate.getFullYear(), l.dueDate.getMonth(), l.dueDate.getDate())
    const key = dayKey(day)
    const bill = bills.get(key) ?? { id: key, dueDate: day, balance: 0, status: 'PENDING', lineIds: [] }
    bill.balance += due
    bill.lineIds.push(l.id)
    bills.set(key, bill)
  }
  return [...bills.values()].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())
}

export { dayKey as billKey }
