import { describe, expect, it } from 'vitest'
import { defaultDueDay, firstMonthLabel, firstMonthSuggestion, firstMonthSummary } from '@/lib/first-month'

const d = (s: string) => new Date(`${s}T00:00:00`)

describe('firstMonthSuggestion', () => {
  it('prorates rent from the joining day to the month end', () => {
    // 18–31 Oct = 14 of 31 days; 8,000 × 14 / 31 = 3,612.9 → 3,613
    const s = firstMonthSuggestion({ joiningDate: d('2026-10-18'), rentAmount: 8_000 })
    expect(s).toMatchObject({ amount: 3_613, days: 14, totalDays: 31, fromDay: 18, toDay: 31, range: '18–31 Oct' })
    expect(s.nextMonthStart).toEqual(d('2026-11-01'))
  })
  it('includes maintenance and food the same way the invoice does, less discount', () => {
    const s = firstMonthSuggestion({
      joiningDate: d('2026-10-18'),
      rentAmount: 8_000,
      maintenanceFee: 310,
      foodOptIn: true,
      foodCharge: 3_100,
      discountAmount: 13,
    })
    // 3,613 + round(310 × 14/31 = 140) + round(3,100 × 14/31 = 1,400) − 13
    expect(s.amount).toBe(3_613 + 140 + 1_400 - 13)
  })
  it('leaves food out when the resident is not on a food plan', () => {
    expect(firstMonthSuggestion({ joiningDate: d('2026-10-18'), rentAmount: 8_000, foodOptIn: false, foodCharge: 3_100 }).amount).toBe(3_613)
  })
  it('is the full month when joining on the 1st, and one day on the last day', () => {
    expect(firstMonthSuggestion({ joiningDate: d('2026-11-01'), rentAmount: 9_000 })).toMatchObject({ amount: 9_000, range: '1–30 Nov' })
    expect(firstMonthSuggestion({ joiningDate: d('2027-02-28'), rentAmount: 2_800 })).toMatchObject({ amount: 100, range: '28 Feb', days: 1 })
  })
  it('crosses the year end', () => {
    expect(firstMonthSuggestion({ joiningDate: d('2026-12-20'), rentAmount: 3_100 }).nextMonthStart).toEqual(d('2027-01-01'))
  })
  it('labels the first-month invoice line', () => {
    expect(firstMonthLabel(d('2026-10-18'))).toBe('First month (18–31 Oct)')
  })
})

describe('defaultDueDay', () => {
  it('keeps the PG due day when it is inside the window, otherwise moves it in', () => {
    expect(defaultDueDay(5, { min: 1, max: 10 })).toBe(5)
    expect(defaultDueDay(15, { min: 1, max: 10 })).toBe(10)
    expect(defaultDueDay(1, { min: 3, max: 10 })).toBe(3)
  })
})

describe('firstMonthSummary', () => {
  const money = (n: number) => `₹${n.toLocaleString('en-IN')}`
  it('reads like the owner would say it', () => {
    expect(
      firstMonthSummary({ joiningDate: d('2026-10-18'), amount: 3_613, method: 'CASH', paidAt: d('2026-10-18'), advance: 16_000, rentDueDay: 7, money }),
    ).toBe('First month: ₹3,613 collected by cash on 18 Oct · Advance ₹16,000 · Regular rent due on the 7th from November')
  })
  it('says when the first month was not charged, and skips what does not apply', () => {
    expect(firstMonthSummary({ joiningDate: d('2026-12-20'), amount: 0, advance: 0, rentDueDay: 1, money })).toBe(
      'First month: not charged · Regular rent due on the 1st from January',
    )
    expect(firstMonthSummary({ joiningDate: d('2026-10-18'), amount: null, advance: 0, rentDueDay: 3, money })).toBe(
      'Regular rent due on the 3rd from November',
    )
  })
})
