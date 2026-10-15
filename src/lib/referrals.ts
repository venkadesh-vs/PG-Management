import { addMonths } from './utils'

/**
 * Refer-a-PG-owner rules. Pure, no database (tests/unit/referrals.test.ts).
 *
 * - Every owner gets a code. A new owner who signs up (or enquires) with it is
 *   linked to the referrer: a PENDING referral.
 * - When the new owner pays their first combined bill, the referrer earns a
 *   credit of REFERRAL_DISCOUNT_PERCENT of that bill (before GST). It comes off
 *   the referrer's bills, at most half of each one (MAX_CREDIT_PER_BILL_PERCENT);
 *   anything left carries to the next bill.
 *   The same credit whether the referrer has one PG or many.
 * - A code works for REFERRAL_LIMIT new owners, then expires.
 */

export const REFERRAL_DISCOUNT_PERCENT = 50

/**
 * A code works for this many new owners, then it expires. Every sign-up with
 * the code takes a slot, paid or not, so a code cannot be passed around
 * endlessly; rewards already earned are still honoured.
 */
export const REFERRAL_LIMIT = 5

/** Slots used and left on a code; `expired` once all are used. */
export function referralSlots(used: number, limit = REFERRAL_LIMIT) {
  const usedClamped = Math.max(0, used)
  return { used: usedClamped, limit, left: Math.max(0, limit - usedClamped), expired: usedClamped >= limit }
}

export type ReferralStatus = 'PENDING' | 'EARNED' | 'APPLIED' | 'CANCELLED'

export const REFERRAL_STATUS_LABEL: Record<ReferralStatus, string> = {
  PENDING: 'Signed up — waiting for their first payment',
  EARNED: 'Credit added — comes off your next bill',
  APPLIED: 'Credit used on your bills',
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

/** A signup link for sharing. */
export function referralLink(baseUrl: string, code: string): string {
  return `${baseUrl.replace(/\/$/, '')}/signup?ref=${encodeURIComponent(code)}`
}
