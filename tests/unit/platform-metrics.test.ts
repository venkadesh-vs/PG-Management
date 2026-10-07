import { describe, expect, it } from 'vitest'

import {
  churnRate,
  computeMrr,
  countByMonth,
  followUpCounts,
  followUpState,
  lastMonths,
  monthlyEquivalent,
  mrrAt,
  subscriptionMrr,
} from '@/server/services/platform-metrics'

describe('MRR normalisation by billing cycle', () => {
  it('divides a per-cycle amount by the months in the cycle', () => {
    expect(monthlyEquivalent(1000, 'MONTHLY')).toBe(1000)
    expect(monthlyEquivalent(3000, 'QUARTERLY')).toBe(1000)
    expect(monthlyEquivalent(6000, 'HALF_YEARLY')).toBe(1000)
    expect(monthlyEquivalent(12000, 'YEARLY')).toBe(1000)
  })

  it('values a yearly subscription at its discounted price ÷ 12', () => {
    // 12 × 1000 less 25% = 9000 a year → 750 a month.
    expect(subscriptionMrr({ status: 'ACTIVE', amount: 1000, billingCycle: 'YEARLY', yearlyDiscountPercent: 25 })).toBe(750)
    expect(subscriptionMrr({ status: 'ACTIVE', amount: 1000, billingCycle: 'QUARTERLY', yearlyDiscountPercent: 25 })).toBe(1000)
  })

  it('sums only ACTIVE subscriptions', () => {
    const mrr = computeMrr([
      { status: 'ACTIVE', amount: 500, billingCycle: 'MONTHLY' },
      { status: 'ACTIVE', amount: 1000, billingCycle: 'YEARLY', yearlyDiscountPercent: 10 },
      { status: 'TRIALING', amount: 9999, billingCycle: 'MONTHLY' },
      { status: 'CANCELLED', amount: 9999, billingCycle: 'MONTHLY' },
      { status: 'PAST_DUE', amount: 9999, billingCycle: 'MONTHLY' },
    ])
    expect(mrr).toBe(500 + 900)
  })

  it('reconstructs past MRR from start, trial end and cancellation dates', () => {
    const subs = [
      { status: 'ACTIVE', amount: 100, billingCycle: 'MONTHLY' as const, startedAt: new Date(2026, 0, 1), trialEndsAt: new Date(2026, 1, 1) },
      { status: 'CANCELLED', amount: 200, billingCycle: 'MONTHLY' as const, startedAt: new Date(2026, 0, 1), cancelledAt: new Date(2026, 2, 15) },
      { status: 'TRIALING', amount: 300, billingCycle: 'MONTHLY' as const, startedAt: new Date(2026, 0, 1) },
    ]
    expect(mrrAt(subs, new Date(2026, 0, 31))).toBe(200)
    expect(mrrAt(subs, new Date(2026, 1, 28))).toBe(300)
    expect(mrrAt(subs, new Date(2026, 2, 31))).toBe(100)
  })
})

describe('churn', () => {
  it('is customers lost ÷ customers active at the start, as a percent', () => {
    expect(churnRate(2, 40)).toBe(5)
    expect(churnRate(1, 3)).toBe(33.3)
  })
  it('is 0 when nobody was active', () => {
    expect(churnRate(0, 0)).toBe(0)
    expect(churnRate(3, 0)).toBe(0)
  })
})

describe('follow-up due classification', () => {
  const now = new Date(2026, 9, 7, 14, 30)

  it('splits overdue, today and upcoming by local day', () => {
    expect(followUpState(new Date(2026, 9, 6, 23, 59), now)).toBe('overdue')
    expect(followUpState(new Date(2026, 9, 7, 0, 0), now)).toBe('today')
    expect(followUpState(new Date(2026, 9, 7, 9, 0), now)).toBe('today')
    expect(followUpState(new Date(2026, 9, 7, 23, 59), now)).toBe('today')
    expect(followUpState(new Date(2026, 9, 8, 0, 0), now)).toBe('upcoming')
  })

  it('ignores missing dates and closed leads', () => {
    expect(followUpState(null, now)).toBe('none')
    expect(followUpState(new Date(2026, 9, 1), now, 'LOST')).toBe('none')
    expect(followUpState(new Date(2026, 9, 1), now, 'CONVERTED')).toBe('none')
    expect(followUpState(new Date(2026, 9, 1), now, 'FOLLOW_UP')).toBe('overdue')
    expect(followUpState(new Date(2026, 9, 1).toISOString(), now, 'NEW')).toBe('overdue')
  })

  it('tallies a list of leads', () => {
    const counts = followUpCounts(
      [
        { followUpAt: new Date(2026, 9, 1), status: 'CONTACTED' },
        { followUpAt: new Date(2026, 9, 7, 18), status: 'NEW' },
        { followUpAt: new Date(2026, 9, 7, 18), status: 'DISQUALIFIED' },
        { followUpAt: null, status: 'NEW' },
      ],
      now,
    )
    expect(counts).toEqual({ overdue: 1, today: 1, upcoming: 0, none: 2 })
  })
})

describe('monthly trend buckets', () => {
  it('returns the last N month starts ending this month', () => {
    const months = lastMonths(3, new Date(2026, 9, 7))
    expect(months.map((m) => [m.getFullYear(), m.getMonth(), m.getDate()])).toEqual([
      [2026, 7, 1],
      [2026, 8, 1],
      [2026, 9, 1],
    ])
  })
  it('counts dates per month', () => {
    const months = lastMonths(2, new Date(2026, 9, 7))
    expect(countByMonth([new Date(2026, 8, 30, 23), new Date(2026, 9, 1), new Date(2026, 9, 5), new Date(2026, 7, 31)], months)).toEqual([1, 2])
  })
})
