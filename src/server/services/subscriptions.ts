import 'server-only'

import type { Plan, Prisma, Property } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { NotFoundError } from '@/lib/tenancy'
import { notifyOrgAdmins, notifySuperAdmins, recordActivity } from '../events'
import { addDays, addMonths, formatMoney, startOfDay } from '@/lib/utils'
import { simulateAutopayDebit, paymentMode } from '../integrations/payments'

/**
 * SaaS subscriptions — charged per PG property.
 *
 * The price is never hard-coded. A Plan describes how to derive it
 * (a multiple of the PG's own standard rent, a per-bed rate, or a flat fee)
 * plus floor/ceiling bounds, and the Super Admin edits those rules.
 */

export type PriceBreakdown = {
  amount: number
  basis: string
  explanation: string
  raw: number
  clampedBy: 'min' | 'max' | null
}

export async function priceForProperty(
  property: Pick<Property, 'standardRent' | 'id'>,
  plan: Plan,
): Promise<PriceBreakdown> {
  let raw = 0
  let basis = ''
  let explanation = ''

  if (plan.pricingBasis === 'STANDARD_RENT') {
    raw = Math.round((property.standardRent * plan.multiplier) / 100)
    basis = 'One standard resident rent'
    explanation = `${plan.multiplier}% of the PG's standard rent (${formatMoney(property.standardRent)})`
  } else if (plan.pricingBasis === 'PER_BED') {
    const beds = await prisma.bed.count({ where: { propertyId: property.id } })
    raw = beds * plan.perBedPrice
    basis = 'Per bed'
    explanation = `${beds} beds × ${formatMoney(plan.perBedPrice)}`
  } else {
    raw = plan.flatPrice
    basis = 'Flat fee'
    explanation = `Flat ${formatMoney(plan.flatPrice)} per PG`
  }

  let amount = raw
  let clampedBy: 'min' | 'max' | null = null
  if (amount < plan.minAmount) {
    amount = plan.minAmount
    clampedBy = 'min'
  } else if (amount > plan.maxAmount) {
    amount = plan.maxAmount
    clampedBy = 'max'
  }

  return { amount, basis, explanation, raw, clampedBy }
}

/** Creates the subscription for a newly added PG, starting its trial. */
export async function createSubscriptionForProperty(params: {
  propertyId: string
  planId?: string
  tx?: Prisma.TransactionClient
  actor?: { id?: string; name: string }
}) {
  const db = params.tx ?? prisma
  const property = await db.property.findUnique({ where: { id: params.propertyId } })
  if (!property) throw new NotFoundError('PG not found')

  const plan = params.planId
    ? await db.plan.findUnique({ where: { id: params.planId } })
    : await db.plan.findFirst({ where: { active: true }, orderBy: { isDefault: 'desc' } })
  if (!plan) throw new NotFoundError('No pricing plan configured')

  const price = await priceForProperty(property, plan)
  const now = new Date()
  const trialEndsAt = plan.trialDays > 0 ? addDays(now, plan.trialDays) : null
  const periodStart = now
  const periodEnd = addMonths(now, 1)

  const subscription = await db.subscription.create({
    data: {
      organizationId: property.organizationId,
      propertyId: property.id,
      planId: plan.id,
      status: plan.trialDays > 0 ? 'TRIALING' : 'ACTIVE',
      amount: price.amount,
      billingCycle: plan.billingCycle,
      trialEndsAt,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      nextBillingDate: trialEndsAt ?? periodEnd,
    },
  })

  await recordActivity(
    {
      organizationId: property.organizationId,
      propertyId: property.id,
      actorId: params.actor?.id,
      actorName: params.actor?.name ?? 'System',
      event: 'SUBSCRIPTION_CREATED',
      entityType: 'Subscription',
      entityId: subscription.id,
      summary: `${property.name} subscribed at ${formatMoney(price.amount)}/month (${price.explanation})`,
      meta: { amount: price.amount, plan: plan.name },
    },
    db,
  )

  return { subscription, plan, price }
}

/** Re-prices a subscription after the PG's standard rent or plan changes. */
export async function repriceSubscription(subscriptionId: string) {
  const subscription = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: { property: true, plan: true },
  })
  if (!subscription) throw new NotFoundError('Subscription not found')
  const price = await priceForProperty(subscription.property, subscription.plan)
  if (price.amount === subscription.amount) return { changed: false, price }
  await prisma.subscription.update({
    where: { id: subscription.id },
    data: { amount: price.amount },
  })
  return { changed: true, price }
}

export async function setupAutopay(params: {
  subscriptionId: string
  label: string
  maskedRef?: string
  kind?: string
  actor: { id?: string; name: string }
}) {
  const subscription = await prisma.subscription.findUnique({
    where: { id: params.subscriptionId },
    include: { property: true },
  })
  if (!subscription) throw new NotFoundError('Subscription not found')

  // In demo mode the mandate is local and clearly labelled; with a live
  // gateway this is where the mandate authorisation redirect would happen.
  const demo = paymentMode() === 'demo'

  const [updated] = await prisma.$transaction([
    prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        autopayEnabled: true,
        mandateStatus: 'ACTIVE',
        mandateRef: demo ? `demo_mandate_${subscription.id.slice(-8)}` : params.maskedRef,
        mandateSetupAt: new Date(),
      },
    }),
    prisma.paymentMethod.create({
      data: {
        subscriptionId: subscription.id,
        kind: params.kind ?? 'UPI_AUTOPAY',
        label: params.label,
        maskedRef: params.maskedRef,
        isDefault: true,
        status: 'ACTIVE',
      },
    }),
  ])

  await notifyOrgAdmins(subscription.organizationId, {
    kind: 'SUBSCRIPTION',
    title: 'AutoPay is active',
    body: `${subscription.property.name} will be charged ${formatMoney(subscription.amount)} automatically each month.`,
    link: '/app/subscription',
  })

  return updated
}

export async function cancelAutopay(subscriptionId: string) {
  await prisma.paymentMethod.updateMany({
    where: { subscriptionId },
    data: { status: 'REVOKED' },
  })
  return prisma.subscription.update({
    where: { id: subscriptionId },
    data: { autopayEnabled: false, mandateStatus: 'REVOKED' },
  })
}

async function nextSubInvoiceNumber(tx: Prisma.TransactionClient, date: Date) {
  const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`
  const count = await tx.subscriptionInvoice.count({
    where: { number: { startsWith: `SF-${stamp}` } },
  })
  return `SF-${stamp}-${String(count + 1).padStart(4, '0')}`
}

/**
 * Bills every subscription whose next billing date has arrived: raises the
 * invoice, attempts AutoPay where a mandate exists, and moves the
 * subscription into grace/suspension when payment fails.
 */
export async function runSubscriptionBilling(params?: { now?: Date; organizationId?: string }) {
  const now = params?.now ?? new Date()
  const due = await prisma.subscription.findMany({
    where: {
      status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE', 'GRACE'] },
      nextBillingDate: { lte: now },
      ...(params?.organizationId ? { organizationId: params.organizationId } : {}),
    },
    include: { property: true, plan: true, organization: true },
  })

  const results: {
    property: string
    amount: number
    outcome: 'paid' | 'failed' | 'invoiced'
    reason?: string
  }[] = []

  for (const subscription of due) {
    const periodStart = startOfDay(subscription.nextBillingDate)
    const periodEnd = addMonths(periodStart, 1)

    const invoice = await prisma.$transaction(async (tx) => {
      const number = await nextSubInvoiceNumber(tx, periodStart)
      return tx.subscriptionInvoice.create({
        data: {
          subscriptionId: subscription.id,
          number,
          periodStart,
          periodEnd,
          issueDate: periodStart,
          dueDate: addDays(periodStart, 3),
          amount: subscription.amount,
          total: subscription.amount,
          status: 'PENDING',
        },
      })
    })

    if (!subscription.autopayEnabled || subscription.mandateStatus !== 'ACTIVE') {
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          status: 'PAST_DUE',
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          nextBillingDate: periodEnd,
          graceEndsAt: addDays(periodStart, subscription.plan.graceDays),
        },
      })
      await notifyOrgAdmins(subscription.organizationId, {
        kind: 'SUBSCRIPTION',
        title: 'Subscription invoice raised',
        body: `${invoice.number} · ${formatMoney(subscription.amount)} for ${subscription.property.name}. Pay before ${addDays(periodStart, subscription.plan.graceDays).toLocaleDateString('en-IN')}.`,
        link: '/app/subscription',
      })
      results.push({ property: subscription.property.name, amount: subscription.amount, outcome: 'invoiced' })
      continue
    }

    // AutoPay attempt. In demo mode this is a labelled simulation — no money
    // moves and every row is flagged isDemo.
    const demo = paymentMode() === 'demo'
    const attempt = demo
      ? simulateAutopayDebit(invoice.id)
      : { success: false, reason: 'Live gateway debit is not configured on this deployment' }

    if (attempt.success) {
      await prisma.$transaction(async (tx) => {
        await tx.subscriptionPayment.create({
          data: {
            subscriptionId: subscription.id,
            invoiceId: invoice.id,
            amount: subscription.amount,
            status: 'SUCCESS',
            method: 'GATEWAY',
            paidAt: now,
            gatewayProvider: demo ? 'demo' : 'gateway',
            isDemo: demo,
          },
        })
        await tx.subscriptionInvoice.update({
          where: { id: invoice.id },
          data: { status: 'PAID', amountPaid: subscription.amount, paidAt: now },
        })
        await tx.subscription.update({
          where: { id: subscription.id },
          data: {
            status: 'ACTIVE',
            currentPeriodStart: periodStart,
            currentPeriodEnd: periodEnd,
            nextBillingDate: periodEnd,
            graceEndsAt: null,
          },
        })
        await tx.organization.update({
          where: { id: subscription.organizationId },
          data: { status: 'ACTIVE' },
        })
        await recordActivity(
          {
            organizationId: subscription.organizationId,
            propertyId: subscription.propertyId,
            actorName: 'AutoPay',
            event: 'SUBSCRIPTION_PAYMENT_COMPLETED',
            entityType: 'SubscriptionInvoice',
            entityId: invoice.id,
            summary: `${invoice.number} · ${formatMoney(subscription.amount)} charged for ${subscription.property.name}`,
          },
          tx,
        )
      })
      await notifyOrgAdmins(subscription.organizationId, {
        kind: 'SUBSCRIPTION',
        title: 'Subscription charged',
        body: `${formatMoney(subscription.amount)} for ${subscription.property.name}. Invoice ${invoice.number}.`,
        link: '/app/subscription',
      })
      results.push({ property: subscription.property.name, amount: subscription.amount, outcome: 'paid' })
    } else {
      const graceEndsAt = addDays(periodStart, subscription.plan.graceDays)
      await prisma.$transaction(async (tx) => {
        await tx.subscriptionPayment.create({
          data: {
            subscriptionId: subscription.id,
            invoiceId: invoice.id,
            amount: subscription.amount,
            status: 'FAILED',
            method: 'GATEWAY',
            failureReason: attempt.reason,
            gatewayProvider: demo ? 'demo' : 'gateway',
            isDemo: demo,
          },
        })
        await tx.subscription.update({
          where: { id: subscription.id },
          data: {
            status: 'GRACE',
            currentPeriodStart: periodStart,
            currentPeriodEnd: periodEnd,
            nextBillingDate: periodEnd,
            graceEndsAt,
          },
        })
        await tx.organization.update({
          where: { id: subscription.organizationId },
          data: { status: 'PAST_DUE' },
        })
        await recordActivity(
          {
            organizationId: subscription.organizationId,
            propertyId: subscription.propertyId,
            actorName: 'AutoPay',
            event: 'SUBSCRIPTION_PAYMENT_FAILED',
            entityType: 'SubscriptionInvoice',
            entityId: invoice.id,
            summary: `${invoice.number} failed — ${attempt.reason}`,
          },
          tx,
        )
      })
      await notifyOrgAdmins(subscription.organizationId, {
        kind: 'SUBSCRIPTION',
        title: 'Subscription payment failed',
        body: `${attempt.reason}. Please update your payment method before ${graceEndsAt.toLocaleDateString('en-IN')}.`,
        link: '/app/subscription',
      })
      await notifySuperAdmins({
        kind: 'SUBSCRIPTION',
        title: 'Failed subscription payment',
        body: `${subscription.organization.name} — ${subscription.property.name}: ${attempt.reason}`,
        link: '/admin/payments',
      })
      results.push({
        property: subscription.property.name,
        amount: subscription.amount,
        outcome: 'failed',
        reason: attempt.reason,
      })
    }
  }

  return results
}

/** Suspends organizations whose grace period has run out. */
export async function enforceGracePeriods(now = new Date()) {
  const expired = await prisma.subscription.findMany({
    where: { status: { in: ['GRACE', 'PAST_DUE'] }, graceEndsAt: { lt: now } },
    include: { organization: true, property: true },
  })

  for (const subscription of expired) {
    await prisma.$transaction(async (tx) => {
      await tx.subscription.update({
        where: { id: subscription.id },
        data: { status: 'SUSPENDED' },
      })
      await tx.organization.update({
        where: { id: subscription.organizationId },
        data: { status: 'SUSPENDED' },
      })
      await recordActivity(
        {
          organizationId: subscription.organizationId,
          propertyId: subscription.propertyId,
          actorName: 'Automation',
          event: 'SUBSCRIPTION_PAYMENT_FAILED',
          entityType: 'Subscription',
          entityId: subscription.id,
          summary: `${subscription.property.name} suspended — grace period ended`,
        },
        tx,
      )
    })
    await notifyOrgAdmins(subscription.organizationId, {
      kind: 'SUBSCRIPTION',
      title: 'Account restricted',
      body: `${subscription.property.name} is restricted because the subscription is unpaid. Settle the invoice to restore access.`,
      link: '/app/subscription',
    })
  }
  return { suspended: expired.length }
}

/** Marks a subscription invoice as paid manually (bank transfer, UPI, cash). */
export async function markSubscriptionInvoicePaid(params: {
  invoiceId: string
  method?: 'BANK_TRANSFER' | 'UPI' | 'CASH' | 'CARD'
  reference?: string
  actor: { id?: string; name: string }
}) {
  return prisma.$transaction(async (tx) => {
    const invoice = await tx.subscriptionInvoice.findUnique({
      where: { id: params.invoiceId },
      include: { subscription: { include: { property: true } } },
    })
    if (!invoice) throw new NotFoundError('Invoice not found')

    const now = new Date()
    await tx.subscriptionPayment.create({
      data: {
        subscriptionId: invoice.subscriptionId,
        invoiceId: invoice.id,
        amount: invoice.total - invoice.amountPaid,
        status: 'SUCCESS',
        method: params.method ?? 'BANK_TRANSFER',
        paidAt: now,
        isDemo: paymentMode() === 'demo',
      },
    })
    const updated = await tx.subscriptionInvoice.update({
      where: { id: invoice.id },
      data: { status: 'PAID', amountPaid: invoice.total, paidAt: now },
    })
    await tx.subscription.update({
      where: { id: invoice.subscriptionId },
      data: { status: 'ACTIVE', graceEndsAt: null },
    })
    await tx.organization.update({
      where: { id: invoice.subscription.organizationId },
      data: { status: 'ACTIVE' },
    })
    await recordActivity(
      {
        organizationId: invoice.subscription.organizationId,
        propertyId: invoice.subscription.propertyId,
        actorId: params.actor.id,
        actorName: params.actor.name,
        event: 'SUBSCRIPTION_PAYMENT_COMPLETED',
        entityType: 'SubscriptionInvoice',
        entityId: invoice.id,
        summary: `${invoice.number} marked paid — ${formatMoney(invoice.total)}`,
      },
      tx,
    )
    return updated
  })
}

/** Platform-wide MRR and subscription health, for the Super Admin dashboard. */
export async function platformMetrics() {
  const [orgs, activeSubs, trials, pastDue, properties, residents, beds, occupied] =
    await Promise.all([
      prisma.organization.count({ where: { archivedAt: null } }),
      prisma.subscription.findMany({
        where: { status: { in: ['ACTIVE', 'TRIALING'] } },
        select: { amount: true, status: true },
      }),
      prisma.subscription.count({ where: { status: 'TRIALING' } }),
      prisma.subscription.count({ where: { status: { in: ['PAST_DUE', 'GRACE'] } } }),
      prisma.property.count({ where: { archivedAt: null, status: 'ACTIVE' } }),
      prisma.resident.count({ where: { status: { in: ['ACTIVE', 'NOTICE'] } } }),
      prisma.bed.count(),
      prisma.bed.count({ where: { status: 'OCCUPIED' } }),
    ])

  const mrr = activeSubs
    .filter((s) => s.status === 'ACTIVE')
    .reduce((sum, s) => sum + s.amount, 0)

  const [pendingInvoices, failedPayments, expiring] = await Promise.all([
    prisma.subscriptionInvoice.aggregate({
      where: { status: { in: ['PENDING', 'OVERDUE'] } },
      _sum: { total: true },
      _count: true,
    }),
    prisma.subscriptionPayment.count({ where: { status: 'FAILED' } }),
    prisma.subscription.count({
      where: { status: 'TRIALING', trialEndsAt: { lte: addDays(new Date(), 7) } },
    }),
  ])

  return {
    organizations: orgs,
    properties,
    residents,
    beds,
    occupied,
    occupancyRate: beds ? Math.round((occupied / beds) * 100) : 0,
    mrr,
    activeSubscriptions: activeSubs.filter((s) => s.status === 'ACTIVE').length,
    trials,
    pastDue,
    pendingAmount: pendingInvoices._sum.total ?? 0,
    pendingCount: pendingInvoices._count,
    failedPayments,
    expiringTrials: expiring,
  }
}
