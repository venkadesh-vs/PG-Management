import { describe, expect, it } from 'vitest'
import { makeReferralCode, normaliseReferralCode, pickReward, referralDiscount, referralLink, rewardWindowEnd } from '@/lib/referrals'

const d = (s: string) => new Date(`${s}T00:00:00`)

describe('referral codes', () => {
  it('uses the name and a random tail without look-alike characters', () => {
    const code = makeReferralCode('Venkat Demo PGs', () => 0)
    expect(code).toBe('VENKATAAAA')
    expect(makeReferralCode('123', () => 0.99)).toMatch(/^STAY[A-Z2-9]{4}$/)
  })
  it('normalises what people type', () => {
    expect(normaliseReferralCode(' venkat-7k2q ')).toBe('VENKAT7K2Q')
    expect(normaliseReferralCode('abc')).toBeNull()
    expect(normaliseReferralCode(undefined)).toBeNull()
  })
  it('builds a signup link', () => {
    expect(referralLink('https://x.app/', 'AB12CD')).toBe('https://x.app/signup?ref=AB12CD')
  })
})

describe('referral discount', () => {
  it('takes half of the monthly price: 8000 becomes 4000', () => {
    expect(referralDiscount(8000, 8000)).toBe(4000)
  })
  it('is half a month on a yearly bill, never half the year', () => {
    expect(referralDiscount(8000, 86400)).toBe(4000)
  })
  it('never exceeds the bill and is zero for free bills', () => {
    expect(referralDiscount(8000, 3000)).toBe(3000)
    expect(referralDiscount(0, 0)).toBe(0)
  })
})

describe('picking the reward for a bill', () => {
  const earnedA = { id: 'a', status: 'EARNED', earnedAt: d('2026-10-01'), windowEndsAt: null }
  const earnedB = { id: 'b', status: 'EARNED', earnedAt: d('2026-10-05'), windowEndsAt: null }
  it('uses the oldest earned reward', () => {
    expect(pickReward([earnedB, earnedA], new Set(), d('2026-11-01'))?.id).toBe('a')
  })
  it('finishes a reward in use for the other PGs of the same month first', () => {
    const applying = { id: 'c', status: 'APPLYING', earnedAt: d('2026-10-09'), windowEndsAt: d('2026-12-01') }
    expect(pickReward([earnedA, applying], new Set(), d('2026-11-10'))?.id).toBe('c')
  })
  it('never gives the same PG one reward twice, and lets the next one queue', () => {
    const applying = { id: 'c', status: 'APPLYING', earnedAt: d('2026-10-09'), windowEndsAt: d('2026-12-01') }
    expect(pickReward([applying, earnedA], new Set(['c']), d('2026-11-10'))?.id).toBe('a')
  })
  it('closes a reward after its month', () => {
    const applying = { id: 'c', status: 'APPLYING', earnedAt: d('2026-10-09'), windowEndsAt: d('2026-12-01') }
    expect(pickReward([applying], new Set(), d('2026-12-01'))).toBeNull()
    expect(rewardWindowEnd(d('2026-11-01'))).toEqual(d('2026-12-01'))
  })
  it('ignores pending, applied and cancelled referrals', () => {
    const rows = ['PENDING', 'APPLIED', 'CANCELLED'].map((status, i) => ({ id: String(i), status, earnedAt: null, windowEndsAt: null }))
    expect(pickReward(rows, new Set(), d('2026-11-01'))).toBeNull()
  })
})
