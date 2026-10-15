import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ValidationError } from '@/lib/tenancy'
import { formatMoney } from '@/lib/utils'
import {
  makeReferralCode,
  normaliseReferralCode,
  REFERRAL_DISCOUNT_PERCENT,
  REFERRAL_LIMIT,
  referralSlots,
} from '@/lib/referrals'
import { applyCredit, referralCredit } from '@/lib/owner-bill'
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
  const org = await prisma.organization.findFirst({
    where: { referralCode: code, status: { not: 'CANCELLED' } },
    select: { id: true, name: true, referralCode: true },
  })
  if (!org) return null
  const used = await prisma.referral.count({ where: { referrerOrgId: org.id, status: { not: 'CANCELLED' } } })
  return { ...org, ...referralSlots(used) }
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
  // A code works for REFERRAL_LIMIT new owners. Lock the referrer while
  // counting so two sign-ups at once cannot both take the last slot.
  await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${referrer.id} FOR UPDATE`
  const used = await tx.referral.count({ where: { referrerOrgId: referrer.id, status: { not: 'CANCELLED' } } })
  if (referralSlots(used).expired) {
    if (params.strict) {
      throw new ValidationError(`referralCode: This referral code has expired. It has already been used by ${REFERRAL_LIMIT} PG owners.`)
    }
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
 * of a referred owner earns the referrer a credit: REFERRAL_CREDIT_PERCENT of
 * what the new owner's first combined bill came to (before GST), added to
 * the referrer's balance and taken off their next bill(s).
 */
export async function markReferralEarned(tx: Tx, invoice: { id: string; total: number; organizationId: string }) {
  if (invoice.total <= 0) return null
  const referral = await tx.referral.findUnique({ where: { referredOrgId: invoice.organizationId } })
  if (!referral || referral.status !== 'PENDING') return null

  // The new owner's whole first bill: every PG line due the same day.
  const paid = await tx.subscriptionInvoice.findUnique({ where: { id: invoice.id }, select: { dueDate: true } })
  const day = new Date(paid!.dueDate)
  day.setHours(0, 0, 0, 0)
  const firstBill = await tx.subscriptionInvoice.findMany({
    where: { subscription: { organizationId: invoice.organizationId }, dueDate: { gte: day, lt: new Date(day.getTime() + 86_400_000) } },
    select: { amount: true, discount: true, lateFee: true },
  })
  const firstMonth = firstBill.reduce((sum, l) => sum + l.amount - l.lateFee, 0)
  const credit = referralCredit(firstMonth, referral.discountPercent)

  const earned = await tx.referral.updateMany({
    where: { id: referral.id, status: 'PENDING' },
    data: { status: 'EARNED', earnedAt: new Date(), qualifyingInvoiceId: invoice.id, creditAmount: credit },
  })
  if (earned.count !== 1) return null
  if (credit > 0) {
    await tx.organization.update({ where: { id: referral.referrerOrgId }, data: { referralCredit: { increment: credit } } })
  }
  const referred = await tx.organization.findUniqueOrThrow({ where: { id: invoice.organizationId }, select: { name: true } })
  await notifyOrgAdmins(
    referral.referrerOrgId,
    {
      kind: 'SUBSCRIPTION',
      title: `You earned ${formatMoney(credit)} credit`,
      body: `${referred.name} paid their first StayFlow bill. ${formatMoney(credit)} comes off your next bill.`,
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
      summary: `Referral credit ${formatMoney(credit)} earned: ${referred.name} paid their first bill`,
    },
    tx,
  )
  return referral
}

/**
 * Takes referral credit off one PG line of a bill being raised (before GST).
 * Lines of the same bill draw from the balance in turn, so the credit comes
 * off the whole bill and whatever is left carries to the next one.
 */
export async function takeReferralCredit(tx: Tx, organizationId: string, lineTaxable: number): Promise<number> {
  if (lineTaxable <= 0) return 0
  const org = await tx.organization.findUnique({ where: { id: organizationId }, select: { referralCredit: true } })
  const { used } = applyCredit(lineTaxable, org?.referralCredit ?? 0)
  if (used <= 0) return 0
  // Conditional decrement: two runs can never spend the same credit twice.
  const spent = await tx.organization.updateMany({
    where: { id: organizationId, referralCredit: { gte: used } },
    data: { referralCredit: { decrement: used } },
  })
  if (spent.count !== 1) return 0
  // A referral is fully used once nothing is left on the balance.
  if ((org?.referralCredit ?? 0) - used <= 0) {
    await tx.referral.updateMany({ where: { referrerOrgId: organizationId, status: 'EARNED' }, data: { status: 'APPLIED', appliedAt: new Date() } })
  }
  return used
}

/** Everything the owner's Refer & earn page shows. */
export async function referralOverview(organizationId: string) {
  const code = await ensureReferralCode(organizationId)
  const [rows, org, savedAgg] = await Promise.all([
    prisma.referral.findMany({
      where: { referrerOrgId: organizationId },
      include: { referred: { select: { name: true, city: true, createdAt: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.organization.findUnique({ where: { id: organizationId }, select: { referralCredit: true } }),
    prisma.subscriptionInvoice.aggregate({
      where: { subscription: { organizationId }, discountLabel: 'Referral credit' },
      _sum: { discount: true },
    }),
  ])
  const referrals = rows.map((r) => ({
    id: r.id,
    name: r.referred.name,
    city: r.referred.city,
    joinedAt: r.createdAt,
    status: (r.status === 'APPLYING' ? 'EARNED' : r.status) as 'PENDING' | 'EARNED' | 'APPLIED' | 'CANCELLED',
    percent: r.discountPercent,
    earnedAt: r.earnedAt,
    credit: r.creditAmount ?? 0,
  }))
  return {
    code,
    percent: REFERRAL_DISCOUNT_PERCENT,
    slots: referralSlots(rows.filter((r) => r.status !== 'CANCELLED').length),
    referrals,
    balance: org?.referralCredit ?? 0,
    totals: {
      joined: referrals.length,
      earned: referrals.filter((r) => r.status === 'EARNED' || r.status === 'APPLIED').length,
      credit: referrals.reduce((s, r) => s + r.credit, 0),
      saved: savedAgg._sum.discount ?? 0,
    },
  }
}
