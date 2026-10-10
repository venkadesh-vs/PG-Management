import { describe, expect, it } from 'vitest'
import { foodChangeDate, foodTopUp } from '@/lib/food-choice'

const d = (s: string) => new Date(`${s}T00:00:00`)

describe('food choice', () => {
  it('applies from tomorrow', () => {
    expect(foodChangeDate(new Date(2026, 9, 10, 18, 30))).toEqual(d('2026-10-11'))
    expect(foodChangeDate(new Date(2026, 9, 31, 9))).toEqual(d('2026-11-01'))
  })

  it('charges the remaining days of a period already billed', () => {
    // Food from 11 Oct in a 1–31 Oct period: 21 of 31 days of ₹3,100.
    expect(foodTopUp(3100, d('2026-10-11'), d('2026-10-01'), d('2026-10-31'))).toEqual({ days: 21, totalDays: 31, amount: 2100 })
  })

  it('charges one day when food starts on the last day', () => {
    expect(foodTopUp(3000, d('2026-09-30'), d('2026-09-01'), d('2026-09-30')).amount).toBe(100)
  })

  it('charges nothing outside the period or for free food', () => {
    expect(foodTopUp(3000, d('2026-11-01'), d('2026-10-01'), d('2026-10-31')).amount).toBe(0)
    expect(foodTopUp(0, d('2026-10-11'), d('2026-10-01'), d('2026-10-31')).amount).toBe(0)
  })
})
