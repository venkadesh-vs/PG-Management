import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ValidationError } from '@/lib/tenancy'
import { formatMoney } from '@/lib/utils'
import {
  makeReferralCode,
  normaliseReferralCode,
  pickReward,
  REFERRAL_DISCOUNT_PERCENT,
  referralDiscount,
  rewardWindowEnd,
} from '@/lib/referrals'
import { notifyOrgAdmins, recordActivity } from '../events'

type Tx = Prisma.TransactionClient

/**
 * Refer-a-PG-owner: codes, linking a new owner to their referrer, unlocking
 * the reward on the new owner's first payment, and taking it off the
 * referrer's next bills. Rules: src/lib/referrals.ts.
 *
 * Everything that runs during billing or a payment takes the caller's
 * transaction, so a referral never half-applies.
 */

/** This organization's code, created the first time it is needed. */
export async function ensureReferralCode(organizationId: string): Promise<string> {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { name: true, referralCode: true },
  })
  if (org.referralCode) return org.referralCode
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = makeReferralCode(org.name)
    const taken = await prisma.organization.findUnique({ where: { referralCode: code }, select: { id: true } })
    if (taken) continue
    const set = await prisma.organization.updateMany({
      where: { id: organizationId, referralCode: null },
      data: { referralCode: code },
    })
    if (set.count === 1) return code
    // Someone else set it at the same moment: use theirs.
    const again = await prisma.organization.findUnique({ where: { id: organizationId }, select: { referralCode: true } })
    if (again?.referralCode) return again.referralCode
  }
  throw new Error('Could not create a referral code')
}

/** True when a code belongs to an organization that can refer (used by the signup form). */
export async function referrerForCode(rawCode: string | null | undefined) {
  const code = normaliseReferralCode(rawCode)
  if (!code) return null
  return prisma.organization.findFirst({
    where: { referralCode: code, status: { not: 'CANCELLED' } },
    select: { id: true, name: true, referralCode: true },
  })
}

/**
 * Links a brand-new organization to the owner whose code it came with.
 * `strict` (self sign-up) rejects an unknown code so the person can fix a
 * typo; the CRM path skips it quietly. Owners cannot refer themselves.
 */
export async function linkReferral(
  tx: Tx,
  params: { newOrgId: string; code: string | null | undefined; email: string; phone: string; strict: boolean },
) {
  const code = normaliseReferralCode(params.code)
  if (!code) {
    if (params.strict && params.code?.trim()) throw new ValidationError('referralCode: That referral code is not valid')
    return null
  }
  const referrer = await tx.organization.findFirst({
    where: { referralCode: code, status: { not: 'CANCELLED' } },
    select: {
      id: true,
      name: true,
      contactEmail: true,
      contactPhone: true,
      users: { where: { role: 'OWNER' }, select: { email: true, phone: true } },
    },
  })
  if (!referrer || referrer.id === params.newOrgId) {
    if (params.strict) throw new ValidationError('referralCode: That referral code is not valid')
    return null
  }
  const digits = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '').slice(-10)
  const emails = [referrer.contactEmail, ...referrer.users.map((u) => u.email)].map((e) => (e ?? '').toLowerCase())
  const phones = [referrer.contactPhone, ...referrer.users.map((u) => u.phone)].map(digits).filter(Boolean)
  const self = emails.includes(params.email.toLowerCase()) || phones.includes(digits(params.phone))
  if (self) {
    if (params.strict) throw new ValidationError('referralCode: You cannot use your own referral code')
    return null
  }

  const referral = await tx.referral.create({
    data: { referrerOrgId: referrer.id, referredOrgId: params.newOrgId, code, discountPercent: REFERRAL_DISCOUNT_PERCENT },
  })
  await tx.organization.update({ where: { id: params.newOrgId }, data: { referredByOrgId: referrer.id } })
  const newOrg = await tx.organization.findUniqueOrThrow({ where: { id: params.newOrgId }, select: { name: true } })
  await notifyOrgAdmins(
    referrer.id,
    {
      kind: 'SUBSCRIPTION',
      title: 'Someone joined with your referral code',
      body: `${newOrg.name} signed up with your code. When they pay their first month, you get ${REFERRAL_DISCOUNT_PERCENT}% off a month.`,
      link: '/app/referrals',
    },
    tx,
  )
  return referral
}

/**
 * Called whenever a subscription invoice is fully paid. The first paid bill
 * (with money in it) of a referred organization unlocks the referrer's reward.
 */
export async function markReferralEarned(tx: Tx, invoice: { id: string; total: number; organizationId: string }) {
  if (invoice.total <= 0) return null
  const referral = await tx.referral.findUnique({ where: { referredOrgId: invoice.organizationId } })
  if (!referral || referral.status !== 'PENDING') return null
  const earned = await tx.referral.updateMany({
    where: { id: referral.id, status: 'PENDING' },
    data: { status: 'EARNED', earnedAt: new Date(), qualifyingInvoiceId: invoice.id },
  })
  if (earned.count !== 1) return null
  const referred = await tx.organization.findUniqueOrThrow({ where: { id: invoice.organizationId }, select: { name: true } })
  await notifyOrgAdmins(
    referral.referrerOrgId,
    {
      kind: 'SUBSCRIPTION',
      title: `You earned ${referral.discountPercent}% off a month`,
      body: `${referred.name} paid their first StayFlow bill. Your next month's bills are ${referral.discountPercent}% off.`,
      link: '/app/referrals',
    },
    tx,
  )
  await recordActivity(
    {
      organizationId: referral.referrerOrgId,
      actorName: 'Billing',
      event: 'SUBSCRIPTION_CHANGED',
      entityType: 'Referral',
      entityId: referral.id,
      summary: `Referral reward earned: ${referred.name} paid their first bill (${referral.discountPercent}% off one month)`,
    },
    tx,
  )
  return referral
}

/**
 * The referral discount for a bill being raised. Picks the oldest open reward
 * this PG has not used, moves it to APPLYING (one month window from its
 * first bill) and to APPLIED when every PG has had it or the month is over.
 * Returns nothing for a PG on live AutoPay: the gateway charges it a fixed
 * amount, so the reward waits for a bill paid with Pay now.
 */
export async function referralDiscountForBill(
  tx: Tx,
  params: {
    organizationId: string
    subscriptionId: string
    monthlyAmount: number
    taxable: number
    periodStart: Date
    liveAutopay: boolean
  },
): Promise<{ discount: number; label: string; rewardId: string } | null> {
  const now = new Date()
  // Close rewards whose month is over.
  await tx.referral.updateMany({
    where: { referrerOrgId: params.organizationId, status: 'APPLYING', windowEndsAt: { lte: params.periodStart } },
    data: { status: 'APPLIED', appliedAt: now },
  })
  if (params.liveAutopay || params.taxable <= 0) return null

  const rewards = await tx.referral.findMany({
    where: { referrerOrgId: params.organizationId, status: { in: ['EARNED', 'APPLYING'] } },
    include: { referred: { select: { name: true } } },
  })
  if (!rewards.length) return null
  const used = await tx.subscriptionInvoice.findMany({
    where: { subscriptionId: params.subscriptionId, referralRewardId: { in: rewards.map((r) => r.id) } },
    select: { referralRewardId: true },
  })
  const reward = pickReward(rewards, new Set(used.map((u) => u.referralRewardId!)), params.periodStart)
  if (!reward) return null

  const discount = referralDiscount(params.monthlyAmount, params.taxable, reward.discountPercent)
  if (discount <= 0) return null

  if (reward.status === 'EARNED') {
    await tx.referral.update({
      where: { id: reward.id },
      data: { status: 'APPLYING', firstAppliedAt: now, windowEndsAt: rewardWindowEnd(params.periodStart) },
    })
  }
  return {
    discount,
    label: `Referral reward: ${reward.discountPercent}% off (${reward.referred.name} joined with your code)`,
    rewardId: reward.id,
  }
}

/** After a bill used a reward: done once every billable PG of the organization has had it. */
export async function closeRewardIfComplete(tx: Tx, rewardId: string, organizationId: string) {
  const [billable, usedBy] = await Promise.all([
    tx.subscription.count({ where: { organizationId, status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE', 'GRACE'] } } }),
    tx.subscriptionInvoice.findMany({ where: { referralRewardId: rewardId }, select: { subscriptionId: true }, distinct: ['subscriptionId'] }),
  ])
  if (usedBy.length >= billable) {
    await tx.referral.updateMany({ where: { id: rewardId, status: 'APPLYING' }, data: { status: 'APPLIED', appliedAt: new Date() } })
  }
}

/** Everything the owner's Refer & earn page shows. */
export async function referralOverview(organizationId: string) {
  const code = await ensureReferralCode(organizationId)
  const now = new Date()
  const rows = await prisma.referral.findMany({
    where: { referrerOrgId: organizationId },
    include: {
      referred: { select: { name: true, city: true, createdAt: true } },
      invoices: { select: { discount: true, number: true, subscription: { select: { property: { select: { name: true } } } } } },
    },
    orderBy: { createdAt: 'desc' },
  })
  const referrals = rows.map((r) => ({
    id: r.id,
    name: r.referred.name,
    city: r.referred.city,
    joinedAt: r.createdAt,
    // A month that has passed reads as used even before the next bill closes it.
    status: (r.status === 'APPLYING' && r.windowEndsAt && r.windowEndsAt <= now ? 'APPLIED' : r.status) as
      | 'PENDING'
      | 'EARNED'
      | 'APPLYING'
      | 'APPLIED'
      | 'CANCELLED',
    percent: r.discountPercent,
    earnedAt: r.earnedAt,
    saved: r.invoices.reduce((s, i) => s + i.discount, 0),
    bills: r.invoices.map((i) => `${i.number} · ${i.subscription.property.name} · −${formatMoney(i.discount)}`),
  }))
  return {
    code,
    percent: REFERRAL_DISCOUNT_PERCENT,
    referrals,
    totals: {
      joined: referrals.length,
      earned: referrals.filter((r) => r.status !== 'PENDING' && r.status !== 'CANCELLED').length,
      waiting: referrals.filter((r) => r.status === 'EARNED').length,
      saved: referrals.reduce((s, r) => s + r.saved, 0),
    },
  }
}
