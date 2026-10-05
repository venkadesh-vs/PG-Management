import { describe, expect, it } from 'vitest'
import { computeSettlement, type SettlementInput } from '@/lib/settlement'

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

const plan = { rent: 9000, maintenance: 0, food: 0, discount: 0 }

describe('computeSettlement', () => {
  it('refunds what is left of the deposit after dues', () => {
    const r = computeSettlement(input({ openBalances: 3000, utilities: 500, depositCollected: 10000 }))
    expect(r.owed).toBe(3500)
    expect(r.credits).toBe(10000)
    expect(r.refundable).toBe(6500)
    expect(r.payable).toBe(0)
    expect(r.applied.deposit).toBe(3500)
    expect(r.depositReturned).toBe(6500)
  })

  it('leaves an amount payable when the deposit does not cover dues', () => {
    const r = computeSettlement(input({ openBalances: 12000, depositCollected: 5000 }))
    expect(r.refundable).toBe(0)
    expect(r.payable).toBe(7000)
    expect(r.applied.deposit).toBe(5000)
    expect(r.depositReturned).toBe(0)
  })

  it('uses unallocated advance before touching the deposit', () => {
    const r = computeSettlement(input({ openBalances: 2000, advance: 3000, depositCollected: 5000 }))
    expect(r.applied.advance).toBe(2000)
    expect(r.applied.deposit).toBe(0)
    expect(r.advanceReturned).toBe(1000)
    expect(r.refundable).toBe(6000)
  })

  it('credits unused days when the exit month was already invoiced', () => {
    // 30-day month, full month invoiced at 9000, leaves on the 10th → 20 unused days.
    const r = computeSettlement(
      input({
        openBalances: 9000,
        depositCollected: 0,
        exitMonth: { totalDays: 30, fromDay: 1, exitDay: 10, monthly: plan, invoicedCharge: 9000 },
      }),
    )
    expect(r.unusedDays).toBe(20)
    expect(r.unusedDaysCredit).toBe(6000)
    expect(r.exitMonthCharge).toBe(0)
    expect(r.payable).toBe(3000)
  })

  it('pro-rates an exit month that has not been invoiced', () => {
    const r = computeSettlement(
      input({
        depositCollected: 10000,
        exitMonth: {
          totalDays: 30,
          fromDay: 1,
          exitDay: 15,
          monthly: { rent: 9000, maintenance: 600, food: 3000, discount: 300 },
          invoicedCharge: null,
        },
      }),
    )
    expect(r.usedDays).toBe(15)
    expect(r.exitMonthLines).toEqual([
      { kind: 'RENT', amount: 4500 },
      { kind: 'MAINTENANCE', amount: 300 },
      { kind: 'FOOD', amount: 1500 },
      { kind: 'DISCOUNT', amount: -150 },
    ])
    expect(r.exitMonthCharge).toBe(6150)
    expect(r.unusedDaysCredit).toBe(0)
    expect(r.refundable).toBe(3850)
  })

  it('itemises deductions and drops empty rows', () => {
    const r = computeSettlement(
      input({
        depositCollected: 8000,
        deductions: [
          { label: 'Broken chair', amount: 1200 },
          { label: '  ', amount: 300 },
          { label: 'Nothing', amount: 0 },
        ],
      }),
    )
    expect(r.deductions).toEqual([
      { label: 'Broken chair', amount: 1200 },
      { label: 'Deduction', amount: 300 },
    ])
    expect(r.deductionsTotal).toBe(1500)
    expect(r.refundable).toBe(6500)
  })

  it('forfeits the whole deposit when dues match it exactly', () => {
    const r = computeSettlement(input({ openBalances: 4000, deductions: [{ label: 'Paint', amount: 1000 }], depositCollected: 5000 }))
    expect(r.refundable).toBe(0)
    expect(r.payable).toBe(0)
    expect(r.depositReturned).toBe(0)
  })

  it('only credits the days actually billed for a mid-month joiner', () => {
    // Joined on the 21st of a 30-day month (10 billed days for 3000), leaves on the 25th.
    const r = computeSettlement(
      input({
        exitMonth: { totalDays: 30, fromDay: 21, exitDay: 25, monthly: plan, invoicedCharge: 3000 },
      }),
    )
    expect(r.usedDays).toBe(5)
    expect(r.unusedDays).toBe(5)
    expect(r.unusedDaysCredit).toBe(1500)
    expect(r.refundable).toBe(1500)
  })
})
