import { addMonths } from './utils'

/**
 * Refer-a-PG-owner rules. Pure, no database (tests/unit/referrals.test.ts).
 *
 * - Every owner gets a code. A new owner who signs up (or enquires) with it is
 *   linked to the referrer: a PENDING referral.
 * - When the new owner pays their first subscription bill, the referral is
 *   EARNED: the referrer gets REFERRAL_DISCOUNT_PERCENT off one month.
 * - "One month" means the referrer's bills that start within one month of
 *   the first bill that used the reward, one bill per PG, each reduced by the
 *   percent of that PG's monthly price (never more than the bill). Then it is
 *   APPLIED. More referrals queue up for the following months; they never stack
 *   on the same bill.
 * - A PG on live AutoPay is charged a fixed amount by the gateway, so its bills
 *   are not discounted; the reward waits for a bill paid with Pay now.
 */

export const REFERRAL_DISCOUNT_PERCENT = 50

export type ReferralStatus = 'PENDING' | 'EARNED' | 'APPLYING' | 'APPLIED' | 'CANCELLED'

export const REFERRAL_STATUS_LABEL: Record<ReferralStatus, string> = {
  PENDING: 'Signed up — waiting for their first payment',
  EARNED: 'Reward earned — applies to your next bill',
  APPLYING: 'Reward on this month’s bills',
  APPLIED: 'Reward used',
  CANCELLED: 'Not eligible',
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I

/** "Venkat Demo PGs" + random → "VENKAT7K2Q". Letters from the name keep it recognisable. */
export function makeReferralCode(name: string, random: () => number = Math.random): string {
  const stem = name.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6) || 'STAY'
  let tail = ''
  for (let i = 0; i < 4; i++) tail += ALPHABET[Math.floor(random() * ALPHABET.length)]
  return stem + tail
}

/** What a person typed or pasted → the stored form, or null if it cannot be a code. */
export function normaliseReferralCode(input: string | null | undefined): string | null {
  const code = (input ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  return code.length >= 6 && code.length <= 16 ? code : null
}

/** Rupees off one bill: the percent of the PG's monthly price, capped at the bill. */
export function referralDiscount(monthlyAmount: number, billTaxable: number, percent = REFERRAL_DISCOUNT_PERCENT): number {
  if (monthlyAmount <= 0 || billTaxable <= 0 || percent <= 0) return 0
  return Math.min(billTaxable, Math.round((monthlyAmount * percent) / 100))
}

export type RewardLike = {
  id: string
  status: string
  earnedAt: Date | null
  windowEndsAt: Date | null
}

/**
 * The reward a new bill for one PG should use: the oldest one still open
 * that this PG has not used yet. APPLYING rewards stay open for bills that
 * start before their window ends; EARNED ones are next in line.
 */
export function pickReward<T extends RewardLike>(rewards: T[], usedBySubscription: Set<string>, periodStart: Date): T | null {
  const open = rewards
    .filter((r) => !usedBySubscription.has(r.id))
    .filter((r) => r.status === 'EARNED' || (r.status === 'APPLYING' && r.windowEndsAt !== null && periodStart < r.windowEndsAt))
    .sort((a, b) => {
      // Finish a reward already in use before starting the next.
      if (a.status !== b.status) return a.status === 'APPLYING' ? -1 : 1
      return (a.earnedAt?.getTime() ?? 0) - (b.earnedAt?.getTime() ?? 0)
    })
  return open[0] ?? null
}

/** The reward covers bills starting before this date (one month from its first bill). */
export function rewardWindowEnd(firstPeriodStart: Date): Date {
  return addMonths(firstPeriodStart, 1)
}

/** A signup link for sharing. */
export function referralLink(baseUrl: string, code: string): string {
  return `${baseUrl.replace(/\/$/, '')}/signup?ref=${encodeURIComponent(code)}`
}
