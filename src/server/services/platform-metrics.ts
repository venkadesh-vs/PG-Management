import 'server-only'

import type { BillingCycle, SubscriptionStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { CYCLE_MONTHS, cyclePrice } from '@/lib/subscription-math'
import { addDays, addMonths, endOfDay, endOfMonth, startOfDay, startOfMonth } from '@/lib/utils'
import { CLOSED_LEAD_STATUSES, followUpState, type FollowUpState } from '@/app/(admin)/admin/leads/lead-meta'

/**
 * SaaS control-centre metrics for the Super Admin: MRR/ARR, churn, trials,
 * pipeline. The maths is pure (and unit-tested); `getPlatformKpis` only
 * gathers rows and hands them to it.
 */

export { followUpState }
export type { FollowUpState }

// --------------------------------------------------------------------------
// Pure maths
// --------------------------------------------------------------------------

/** What an amount billed once per `cycle` is worth per month (yearly ÷ 12, quarterly ÷ 3…). */
export function monthlyEquivalent(amountPerCycle: number, cycle: BillingCycle): number {
  const months = CYCLE_MONTHS[cycle] ?? 1
  return amountPerCycle / months
}

export type MrrSubscription = {
  status: SubscriptionStatus | string
  /** Stored monthly amount (Subscription.amount). */
  amount: number
  billingCycle: BillingCycle
  /** Plan's yearly discount; a yearly subscription bills 12 × amount less this. */
  yearlyDiscountPercent?: number | null
  startedAt?: Date
  trialEndsAt?: Date | null
  cancelledAt?: Date | null
}

/** Monthly recurring value of one subscription: its per-cycle price normalised to a month. */
export function subscriptionMrr(sub: MrrSubscription): number {
  const perCycle = cyclePrice(sub.amount, sub.billingCycle, sub.yearlyDiscountPercent ?? 0)
  return monthlyEquivalent(perCycle, sub.billingCycle)
}

/** MRR = sum of ACTIVE subscriptions' monthly-equivalent amounts, whole rupees. */
export function computeMrr(subs: MrrSubscription[]): number {
  return Math.round(subs.filter((s) => s.status === 'ACTIVE').reduce((sum, s) => sum + subscriptionMrr(s), 0))
}

/**
 * Best reconstruction of MRR at a past date: a subscription counts once its
 * paid period had begun (after any trial) and before it was cancelled. Ones
 * still on trial today never paid, so they never count.
 */
export function mrrAt(subs: MrrSubscription[], at: Date): number {
  let total = 0
  for (const s of subs) {
    if (s.status === 'TRIALING') continue
    const paidFrom = s.trialEndsAt ?? s.startedAt
    if (!paidFrom || paidFrom > at) continue
    if (s.cancelledAt && s.cancelledAt <= at) continue
    if (s.status === 'CANCELLED' && !s.cancelledAt) continue
    total += subscriptionMrr(s)
  }
  return Math.round(total)
}

/**
 * Churn % over a window: customers lost in the window ÷ customers active at
 * its start. 0 when there was nobody to lose. One decimal place.
 */
export function churnRate(churned: number, activeAtStart: number): number {
  if (activeAtStart <= 0) return 0
  return Math.round((churned / activeAtStart) * 1000) / 10
}

/** The last `count` month starts, oldest first, ending with the month of `now`. */
export function lastMonths(count: number, now: Date = new Date()): Date[] {
  return Array.from({ length: count }, (_, i) => startOfMonth(addMonths(startOfMonth(now), -(count - 1 - i))))
}

export function monthLabel(month: Date): string {
  return month.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
}

/** How many of `dates` fall in each month. */
export function countByMonth(dates: Date[], months: Date[]): number[] {
  return months.map((m) => {
    const end = endOfMonth(m)
    return dates.filter((d) => d >= m && d <= end).length
  })
}

/** Tally follow-up states, ignoring closed leads. */
export function followUpCounts(
  leads: { followUpAt: Date | null; status: string }[],
  now: Date = new Date(),
): Record<FollowUpState, number> {
  const out: Record<FollowUpState, number> = { overdue: 0, today: 0, upcoming: 0, none: 0 }
  for (const l of leads) out[followUpState(l.followUpAt, now, l.status)]++
  return out
}

// --------------------------------------------------------------------------
// Database
// --------------------------------------------------------------------------

export type PlatformKpis = Awaited<ReturnType<typeof getPlatformKpis>>

export async function getPlatformKpis(now: Date = new Date()) {
  const monthStart = startOfMonth(now)
  const windowStart = addDays(now, -30)
  const trendMonths = lastMonths(6, now)

  const [orgStatuses, subs, newThisMonth, failedPayments, trialSubs, trialOrgs, leadStages, openLeads, orgDates, cancelledOrgs, survivors] =
    await Promise.all([
      prisma.organization.groupBy({ by: ['status'], where: { archivedAt: null }, _count: { _all: true } }),
      prisma.subscription.findMany({
        select: {
          status: true,
          amount: true,
          billingCycle: true,
          startedAt: true,
          trialEndsAt: true,
          cancelledAt: true,
          plan: { select: { yearlyDiscountPercent: true } },
        },
      }),
      prisma.organization.count({ where: { archivedAt: null, createdAt: { gte: monthStart } } }),
      prisma.subscriptionPayment.count({ where: { status: 'FAILED', attemptedAt: { gte: windowStart } } }),
      prisma.subscription.findMany({
        where: { status: 'TRIALING', trialEndsAt: { gte: now, lte: addDays(now, 7) } },
        select: { organizationId: true },
      }),
      prisma.organization.findMany({
        where: { archivedAt: null, status: 'TRIAL', trialEndsAt: { gte: now, lte: addDays(now, 7) } },
        select: { id: true },
      }),
      prisma.lead.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.lead.findMany({
        where: { followUpAt: { not: null, lte: endOfDay(now) }, status: { notIn: CLOSED_LEAD_STATUSES as never[] } },
        select: { followUpAt: true, status: true },
      }),
      prisma.organization.findMany({
        where: { archivedAt: null, createdAt: { gte: trendMonths[0] } },
        select: { createdAt: true },
      }),
      // Customers lost in the window: cancelled now, with the cancellation
      // (latest subscription cancel, else the last update) inside it.
      prisma.organization.findMany({
        where: { status: 'CANCELLED', archivedAt: null },
        select: { updatedAt: true, createdAt: true, subscriptions: { select: { cancelledAt: true } } },
      }),
      prisma.organization.count({
        where: { archivedAt: null, createdAt: { lt: windowStart }, status: { notIn: ['CANCELLED', 'TRIAL'] } },
      }),
    ])

  const statusCount = (s: string) => orgStatuses.find((r) => r.status === s)?._count._all ?? 0
  const totalCustomers = orgStatuses.reduce((sum, r) => sum + r._count._all, 0)

  const mrrSubs: MrrSubscription[] = subs.map((s) => ({
    status: s.status,
    amount: s.amount,
    billingCycle: s.billingCycle,
    yearlyDiscountPercent: s.plan.yearlyDiscountPercent,
    startedAt: s.startedAt,
    trialEndsAt: s.trialEndsAt,
    cancelledAt: s.cancelledAt,
  }))
  const mrr = computeMrr(mrrSubs)

  const churned = cancelledOrgs.filter((o) => {
    const cancels = o.subscriptions.map((s) => s.cancelledAt).filter((d): d is Date => Boolean(d))
    const at = cancels.length ? new Date(Math.max(...cancels.map((d) => d.getTime()))) : o.updatedAt
    return at >= windowStart && o.createdAt < windowStart
  }).length

  const trialEnding = new Set([...trialSubs.map((s) => s.organizationId), ...trialOrgs.map((o) => o.id)])
  const followUps = followUpCounts(openLeads, now)

  return {
    customers: {
      total: totalCustomers,
      active: statusCount('ACTIVE'),
      trial: statusCount('TRIAL'),
      pastDue: statusCount('PAST_DUE'),
      suspended: statusCount('SUSPENDED'),
      cancelled: statusCount('CANCELLED'),
      newThisMonth,
    },
    mrr,
    arr: mrr * 12,
    activeSubscriptions: mrrSubs.filter((s) => s.status === 'ACTIVE').length,
    failedPayments30d: failedPayments,
    churn: { rate: churnRate(churned, survivors + churned), churned, activeAtStart: survivors + churned },
    trialsEndingSoon: trialEnding.size,
    leadsByStage: Object.fromEntries(leadStages.map((r) => [r.status, r._count._all])) as Record<string, number>,
    followUps: { overdue: followUps.overdue, today: followUps.today, due: followUps.overdue + followUps.today },
    trends: trendMonths.map((m, i) => ({
      month: monthLabel(m),
      // The current month shows live MRR; earlier months are reconstructed at month end.
      mrr: i === trendMonths.length - 1 ? mrr : mrrAt(mrrSubs, endOfMonth(m)),
      newCustomers: countByMonth(
        orgDates.map((o) => o.createdAt),
        [m],
      )[0],
    })),
    generatedAt: now,
    windowStart: startOfDay(windowStart),
  }
}
