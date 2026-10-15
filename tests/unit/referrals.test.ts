import { describe, expect, it } from 'vitest'
import { makeReferralCode, normaliseReferralCode, referralLink } from '@/lib/referrals'


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

describe('referral code limit', () => {
  it('allows five new owners, then expires', async () => {
    const { referralSlots, REFERRAL_LIMIT } = await import('@/lib/referrals')
    expect(REFERRAL_LIMIT).toBe(5)
    expect(referralSlots(0)).toEqual({ used: 0, limit: 5, left: 5, expired: false })
    expect(referralSlots(4)).toMatchObject({ left: 1, expired: false })
    expect(referralSlots(5)).toMatchObject({ left: 0, expired: true })
    expect(referralSlots(7)).toMatchObject({ left: 0, expired: true })
  })
})
