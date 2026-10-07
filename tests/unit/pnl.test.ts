import { describe, expect, it } from 'vitest'
import {
  buildPnl,
  collectionRate,
  perBed,
  revenueFromPayments,
  splitAllocation,
  vacancyLoss,
} from '@/server/services/pnl'

describe('splitAllocation', () => {
  it('shares a payment across line kinds in proportion', () => {
    const split = splitAllocation(6000, [
      { kind: 'RENT', amount: 8000 },
      { kind: 'FOOD', amount: 3000 },
      { kind: 'ELECTRICITY', amount: 1000 },
    ])
    expect(split).toEqual({ rent: 4000, food: 1500, utilities: 500, other: 0, deposit: 0 })
  })

  it('ignores discounts as weights and keeps whole rupees adding up', () => {
    const split = splitAllocation(1000, [
      { kind: 'RENT', amount: 2000 },
      { kind: 'LAUNDRY', amount: 1000 },
      { kind: 'DISCOUNT', amount: -500 },
    ])
    expect(split.rent + split.other).toBe(1000)
    expect(split.rent).toBe(667)
    expect(split.other).toBe(333)
  })

  it('puts deposit lines aside', () => {
    const split = splitAllocation(15000, [
      { kind: 'RENT', amount: 5000 },
      { kind: 'DEPOSIT', amount: 10000 },
    ])
    expect(split.deposit).toBe(10000)
    expect(split.rent).toBe(5000)
  })

  it('treats an invoice without positive lines as other income', () => {
    expect(splitAllocation(300, []).other).toBe(300)
  })
})

describe('revenueFromPayments', () => {
  it('nets refunds, keeps unapplied money as advance and excludes deposits', () => {
    const revenue = revenueFromPayments([
      {
        amount: 12000,
        refundedAmount: 1000,
        allocations: [
          { amount: 8000, lines: [{ kind: 'RENT', amount: 6000 }, { kind: 'FOOD', amount: 2000 }] },
        ],
      },
      {
        amount: 7000,
        refundedAmount: 0,
        allocations: [{ amount: 7000, lines: [{ kind: 'RENT', amount: 5000 }, { kind: 'DEPOSIT', amount: 2000 }] }],
      },
    ])
    expect(revenue.rent).toBe(6000 + 5000)
    expect(revenue.food).toBe(2000)
    expect(revenue.advance).toBe(3000) // 12000 − 1000 refund − 8000 applied
    expect(revenue.depositExcluded).toBe(2000)
    expect(revenue.total).toBe(6000 + 5000 + 2000 + 3000)
  })

  it('counts nothing for a fully refunded payment', () => {
    expect(revenueFromPayments([{ amount: 500, refundedAmount: 500, allocations: [] }]).total).toBe(0)
  })
})

describe('KPIs', () => {
  it('collection rate', () => {
    expect(collectionRate(45000, 60000)).toBe(75)
    expect(collectionRate(0, 0)).toBeNull()
  })

  it('per bed', () => {
    expect(perBed(30000, 12)).toBe(2500)
    expect(perBed(1000, 0)).toBeNull()
  })

  it('vacancy loss', () => {
    expect(vacancyLoss(10, 7, 6000, 2)).toBe(36000)
    expect(vacancyLoss(5, 6, 6000, 1)).toBe(0)
  })
})

describe('buildPnl', () => {
  it('computes totals, PG columns and the monthly trend', () => {
    const report = buildPnl({
      months: [
        { key: '2026-09', label: 'Sep' },
        { key: '2026-10', label: 'Oct' },
      ],
      properties: [
        { id: 'a', name: 'A', type: 'BOYS' },
        { id: 'b', name: 'B', type: 'GIRLS' },
      ],
      payments: [
        { propertyId: 'a', month: '2026-09', amount: 10000, refundedAmount: 0, allocations: [{ amount: 10000, lines: [{ kind: 'RENT', amount: 10000 }] }] },
        { propertyId: 'b', month: '2026-10', amount: 4000, refundedAmount: 0, allocations: [{ amount: 4000, lines: [{ kind: 'FOOD', amount: 4000 }] }] },
      ],
      expenses: [
        { propertyId: 'a', month: '2026-09', amount: 3000, category: 'Salaries' },
        { propertyId: 'b', month: '2026-10', amount: 1000, category: 'Groceries' },
      ],
      invoices: [
        { propertyId: 'a', total: 10000, amountPaid: 10000, balance: 0 },
        { propertyId: 'b', total: 8000, amountPaid: 4000, balance: 4000 },
      ],
      beds: { a: { total: 4, occupied: 2 }, b: { total: 2, occupied: 2 } },
      averageRent: { a: 5000, b: 4000 },
    })
    expect(report.total.revenue.total).toBe(14000)
    expect(report.total.expenses).toBe(4000)
    expect(report.total.net).toBe(10000)
    expect(report.total.collectionRate).toBe(78)
    expect(report.total.outstanding).toBe(4000)
    expect(report.total.profitPerBed).toBe(Math.round(10000 / 6))
    expect(report.total.revenuePerOccupiedBed).toBe(3500)
    expect(report.total.vacancyLoss).toBe(2 * 5000 * 2)
    expect(report.byProperty.find((p) => p.id === 'b')?.net).toBe(3000)
    expect(report.trend.map((t) => t.profit)).toEqual([7000, 3000])
  })
})
