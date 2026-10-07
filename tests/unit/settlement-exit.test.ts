import { describe, expect, it } from 'vitest'
import {
  chargeDaysInExitMonth,
  computeSettlement,
  firstDayAfterExitMonth,
  invoicesAfterExit,
  type SettlementInput,
} from '@/lib/settlement'
import { prorationFor, rentSegments } from '@/lib/billing-calc'
import {
  assetDeductionLabel,
  blankChecklist,
  checklistProgress,
  checklistSchema,
  openItems,
  readChecklist,
} from '@/lib/checkout-checklist'

function input(over: Partial<SettlementInput> = {}): SettlementInput {
  return {
    openBalances: 0,
    utilities: 0,
    deductions: [],
    exitMonth: null,
    depositCollected: 0,
    advance: 0,
    ...over,
  }
}

const month = (rent: number) => ({ rent, maintenance: 0, food: 0, discount: 0 })

describe('settlement — rent revisions in the exit month', () => {
  it('prices each run of days at the rent in force', () => {
    // 30-day month, rent 6000 until the 10th, 9000 from the 11th; leaves on the 20th.
    const r = computeSettlement(
      input({
        exitMonth: {
          totalDays: 30,
          fromDay: 1,
          exitDay: 20,
          monthly: month(9000),
          rentSegments: [
            { fromDay: 1, toDay: 10, monthlyRent: 6000 },
            { fromDay: 11, toDay: 30, monthlyRent: 9000 },
          ],
          invoicedCharge: null,
        },
      }),
    )
    // 10 days × 6000/30 + 10 days × 9000/30
    expect(r.exitMonthLines).toEqual([{ kind: 'RENT', amount: 5000 }])
    expect(r.exitMonthCharge).toBe(5000)
    expect(r.payable).toBe(5000)
  })

  it('ignores a revision that starts after the exit day', () => {
    const r = computeSettlement(
      input({
        exitMonth: {
          totalDays: 30,
          fromDay: 1,
          exitDay: 15,
          monthly: month(9000),
          rentSegments: [
            { fromDay: 1, toDay: 20, monthlyRent: 6000 },
            { fromDay: 21, toDay: 30, monthlyRent: 9000 },
          ],
          invoicedCharge: null,
        },
      }),
    )
    expect(r.exitMonthCharge).toBe(3000)
  })

  it('matches billing-calc segments for a revision effective mid-month', () => {
    const monthStart = new Date(2026, 10, 1) // Nov 2026, 30 days
    const proration = prorationFor(new Date(2026, 0, 1), monthStart, new Date(2026, 10, 30))
    const segments = rentSegments(monthStart, proration, 9000, [
      { oldRent: 6000, newRent: 9000, effectiveFrom: new Date(2026, 10, 16) },
    ])
    const r = computeSettlement(
      input({
        exitMonth: {
          totalDays: 30,
          fromDay: 1,
          exitDay: 30,
          monthly: month(9000),
          rentSegments: segments,
          invoicedCharge: null,
        },
      }),
    )
    expect(r.exitMonthCharge).toBe(segments.reduce((s, x) => s + x.amount, 0))
    expect(r.exitMonthCharge).toBe(3000 + 4500)
  })
})

describe('settlement — resident charges', () => {
  it('pro-rates recurring charges and discounts over the days stayed', () => {
    const r = computeSettlement(
      input({
        depositCollected: 10000,
        exitMonth: {
          totalDays: 30,
          fromDay: 1,
          exitDay: 15,
          monthly: { rent: 9000, maintenance: 0, food: 0, discount: 0 },
          recurring: [
            { label: 'Laundry', category: 'LAUNDRY', amount: 600 },
            { label: 'Loyalty discount', category: 'DISCOUNT', amount: 300, discount: true },
          ],
          invoicedCharge: null,
        },
      }),
    )
    expect(r.exitMonthLines).toEqual([
      { kind: 'RENT', amount: 4500 },
      { kind: 'CHARGE', label: 'Laundry', category: 'LAUNDRY', amount: 300 },
      { kind: 'DISCOUNT', label: 'Loyalty discount', category: 'DISCOUNT', amount: -150 },
    ])
    expect(r.exitMonthCharge).toBe(4650)
    expect(r.refundable).toBe(5350)
  })

  it('only charges a recurring charge for its own days in the month', () => {
    const r = computeSettlement(
      input({
        exitMonth: {
          totalDays: 30,
          fromDay: 1,
          exitDay: 30,
          monthly: month(0),
          recurring: [{ label: 'AC charge', category: 'ELECTRICITY', amount: 900, fromDay: 21, toDay: 30 }],
          invoicedCharge: null,
        },
      }),
    )
    expect(r.exitMonthCharge).toBe(300)
  })

  it('never lets discounts take the month below zero', () => {
    const r = computeSettlement(
      input({
        exitMonth: {
          totalDays: 30,
          fromDay: 1,
          exitDay: 30,
          monthly: { rent: 1000, maintenance: 0, food: 0, discount: 800 },
          recurring: [{ label: 'Promo', category: 'DISCOUNT', amount: 600, discount: true }],
          invoicedCharge: null,
        },
      }),
    )
    expect(r.exitMonthLines).toEqual([
      { kind: 'RENT', amount: 1000 },
      { kind: 'DISCOUNT', amount: -800 },
      { kind: 'DISCOUNT', label: 'Promo', category: 'DISCOUNT', amount: -200 },
    ])
    expect(r.exitMonthCharge).toBe(0)
  })

  it('bills unbilled one-time charges in full, even when the exit month was invoiced', () => {
    const r = computeSettlement(
      input({
        depositCollected: 10000,
        exitMonth: { totalDays: 30, fromDay: 1, exitDay: 30, monthly: month(9000), invoicedCharge: 9000 },
        oneTimeCharges: [
          { label: 'Notice shortfall', category: 'NOTICE', amount: 2000 },
          { label: 'Late night fine', category: 'FINE', amount: 500 },
          { label: 'Empty', amount: 0 },
        ],
      }),
    )
    expect(r.oneTimeCharges).toEqual([
      { label: 'Notice shortfall', category: 'NOTICE', amount: 2000 },
      { label: 'Late night fine', category: 'FINE', amount: 500 },
    ])
    expect(r.oneTimeTotal).toBe(2500)
    expect(r.owed).toBe(2500)
    expect(r.refundable).toBe(7500)
  })

  it('counts asset deductions like any other deduction', () => {
    const r = computeSettlement(
      input({
        depositCollected: 5000,
        deductions: [{ label: assetDeductionLabel('Mattress', 'DAMAGED', 'torn'), amount: 1200 }],
      }),
    )
    expect(r.deductions).toEqual([{ label: 'Damaged — Mattress (torn)', amount: 1200 }])
    expect(r.refundable).toBe(3800)
  })
})

describe('invoices after the exit', () => {
  const inv = (id: string, y: number, m: number, status = 'PENDING') => ({ id, periodStart: new Date(y, m, 1), status })

  it('cancels only invoices for months after the exit month', () => {
    const list = [inv('oct', 2026, 9), inv('nov', 2026, 10), inv('dec', 2026, 11, 'PAID'), inv('jan', 2027, 0, 'CANCELLED')]
    expect(invoicesAfterExit(list, new Date(2026, 9, 7)).map((i) => i.id)).toEqual(['nov', 'dec'])
    expect(invoicesAfterExit(list, new Date(2026, 9, 31)).map((i) => i.id)).toEqual(['nov', 'dec'])
    expect(invoicesAfterExit(list, new Date(2026, 11, 1)).map((i) => i.id)).toEqual([])
  })

  it('rolls over the year', () => {
    expect(firstDayAfterExitMonth(new Date(2026, 11, 15))).toEqual(new Date(2027, 0, 1))
  })
})

describe('chargeDaysInExitMonth', () => {
  const exit = new Date(2026, 9, 20) // 20 Oct 2026

  it('covers the whole month for a charge that started earlier and never ends', () => {
    expect(chargeDaysInExitMonth({ startDate: new Date(2026, 5, 1), endDate: null }, exit)).toEqual({ fromDay: 1, toDay: 31 })
  })
  it('starts on the charge start day inside the month', () => {
    expect(chargeDaysInExitMonth({ startDate: new Date(2026, 9, 12), endDate: null }, exit)).toEqual({ fromDay: 12, toDay: 31 })
  })
  it('stops on an end date inside the month', () => {
    expect(chargeDaysInExitMonth({ startDate: new Date(2026, 5, 1), endDate: new Date(2026, 9, 5) }, exit)).toEqual({
      fromDay: 1,
      toDay: 5,
    })
  })
  it('skips charges that ended before the month or start after the exit', () => {
    expect(chargeDaysInExitMonth({ startDate: new Date(2026, 5, 1), endDate: new Date(2026, 8, 30) }, exit)).toBeNull()
    expect(chargeDaysInExitMonth({ startDate: new Date(2026, 9, 25), endDate: null }, exit)).toBeNull()
  })
})

describe('checkout checklists', () => {
  it('starts blank and tracks progress', () => {
    const list = blankChecklist('clearance')
    expect(checklistProgress(list)).toEqual({ done: 0, total: list.items.length, complete: false })
    const done = { ...list, items: list.items.map((i) => ({ ...i, ok: true })) }
    expect(checklistProgress(done).complete).toBe(true)
    expect(openItems(done)).toEqual([])
  })

  it('reads stored JSON safely', () => {
    expect(readChecklist(null)).toBeNull()
    expect(readChecklist({ items: 'nope' })).toBeNull()
    expect(readChecklist({ items: [{ key: 'keys', label: 'Keys', ok: true }] })?.items).toHaveLength(1)
  })

  it('only accepts photos uploaded through the app', () => {
    expect(checklistSchema.safeParse({ items: [], photoUrls: ['https://evil.example/x.png'] }).success).toBe(false)
    expect(checklistSchema.safeParse({ items: [], photoUrls: ['/api/uploads/abc123'] }).success).toBe(true)
  })
})
