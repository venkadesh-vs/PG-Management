import 'server-only'

import type { PaymentMethodKind, Plan, Prisma, Property } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/tenancy'
import { notifyOrgAdmins, notifySuperAdmins, recordActivity } from '../events'
import { addDays, addMonths, formatMoney, startOfDay } from '@/lib/utils'
import { computeGst, financialYear } from '@/lib/gst'
import { platformEnv } from '@/lib/platform-env'
import {
  createOrder,
  platformRazorpay,
  simulateAutopayDebit,
  paymentMode,
  verifyPaymentSignature,
} from '../integrations/payments'
import {
  cancelSubscription as rzpCancelSubscription,
  createPlan as rzpCreatePlan,
  createSubscription as rzpCreateSubscription,
  fetchOrder as rzpFetchOrder,
  fetchPayment as rzpFetchPayment,
  fetchSubscription as rzpFetchSubscription,
  fromPaise,
  notesOf,
  toPaise,
  TERMINAL_SUBSCRIPTION_STATES,
  type RazorpayCredentials,
  type RazorpayPayment,
  type RazorpaySubscription,
  type RazorpayWebhookEvent,
} from '../integrations/razorpay'
import {
  isUniqueViolation,
  nextCounterNumber,
  recordGatewayPayment,
  retryOnUniqueConflict,
} from './billing'

type Tx = Prisma.TransactionClient

const UNPAID_INVOICE = ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] as const

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
  if (price.amount === subscription.amount) return { changed: false, price, autopayStopped: false }
  await prisma.subscription.update({
    where: { id: subscription.id },
    data: { amount: price.amount },
  })

  // Repricing with a live Razorpay mandate: the owner authorised a fixed
  // amount (a UPI AutoPay / eMandate debit cap), and Razorpay does not allow
  // plan changes on UPI/eMandate subscriptions. So we cancel the gateway
  // subscription now and ask the owner to re-authorise at the new price —
  // explicit consent for the new amount, no silent over-debit. The current
  // period is already paid; the next invoice is raised as usual and can be
  // paid with "Pay now" or a fresh AutoPay set-up.
  let autopayStopped = false
  const creds = platformRazorpay()
  if (
    creds &&
    subscription.gatewaySubscriptionId &&
    (subscription.mandateStatus === 'ACTIVE' || subscription.mandateStatus === 'PENDING')
  ) {
    await cancelGatewaySubscription(creds, subscription.gatewaySubscriptionId)
    await prisma.$transaction([
      prisma.subscription.update({
        where: { id: subscription.id },
        data: { autopayEnabled: false, mandateStatus: 'REVOKED', gatewayAuthUrl: null },
      }),
      prisma.paymentMethod.updateMany({
        where: { subscriptionId: subscription.id, status: { in: ['ACTIVE', 'PENDING'] } },
        data: { status: 'REVOKED' },
      }),
    ])
    autopayStopped = true
    await notifyOrgAdmins(subscription.organizationId, {
      kind: 'SUBSCRIPTION',
      title: 'Please re-authorise AutoPay',
      body: `${subscription.property.name}'s subscription is now ${formatMoney(price.amount)}/month. Your old AutoPay was for ${formatMoney(subscription.amount)}, so it has been stopped — set up AutoPay again to approve the new amount.`,
      link: '/app/subscription',
    })
  }
  return { changed: true, price, autopayStopped }
}

/** Cancels a Razorpay subscription unless it is already in a terminal state. */
async function cancelGatewaySubscription(creds: RazorpayCredentials, gatewaySubscriptionId: string) {
  const remote = await rzpFetchSubscription(creds, gatewaySubscriptionId)
  if (TERMINAL_SUBSCRIPTION_STATES.includes(remote.status)) return remote
  return rzpCancelSubscription(creds, gatewaySubscriptionId, { atCycleEnd: false })
}

/** Finds (or creates and caches) the Razorpay plan for a monthly amount. */
async function getOrCreateGatewayPlan(creds: RazorpayCredentials, amount: number) {
  // Plans live in one Razorpay account (and test/live are separate), so the
  // cache is keyed by key id.
  const provider = `razorpay:${creds.keyId}`
  const where = { provider_amount_period_interval: { provider, amount, period: 'monthly', interval: 1 } }
  const cached = await prisma.gatewayPlan.findUnique({ where })
  if (cached) return cached.gatewayPlanId

  const plan = await rzpCreatePlan(creds, {
    period: 'monthly',
    interval: 1,
    name: `StayFlow PG subscription — ${formatMoney(amount)}/month`,
    amountPaise: toPaise(amount),
  })
  try {
    await prisma.gatewayPlan.create({
      data: { provider, amount, period: 'monthly', interval: 1, gatewayPlanId: plan.id },
    })
    return plan.id
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    // A concurrent set-up cached one first; use it (the extra plan is harmless).
    const winner = await prisma.gatewayPlan.findUnique({ where })
    return winner?.gatewayPlanId ?? plan.id
  }
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
  if (subscription.status === 'CANCELLED') throw new ConflictError('This subscription is cancelled')

  // Live: a real Razorpay Subscription the owner authorises on Razorpay's
  // hosted page (UPI AutoPay / card / eMandate).
  const creds = platformRazorpay()
  if (creds) return setupGatewayAutopay(creds, subscription)

  // Demo: the mandate is local and clearly labelled.
  const demo = true

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

  return { mode: 'demo' as const, redirectUrl: null, subscription: updated }
}

/**
 * Creates the Razorpay subscription for AutoPay and returns the hosted
 * authorisation URL. The mandate only becomes ACTIVE when the platform
 * webhook reports subscription.authenticated / activated.
 */
async function setupGatewayAutopay(
  creds: RazorpayCredentials,
  subscription: Prisma.SubscriptionGetPayload<{ include: { property: true } }>,
) {
  if (subscription.amount < 1) throw new ValidationError('This subscription has no amount to collect')
  // The mandate collects the invoice total, GST included.
  const organization = await prisma.organization.findUnique({
    where: { id: subscription.organizationId },
    select: { gstin: true, state: true },
  })
  const gross = subscriptionGst(organization ?? {}, subscription.amount).total

  // Re-use a pending authorisation instead of creating a second subscription.
  if (subscription.gatewaySubscriptionId) {
    const remote = await rzpFetchSubscription(creds, subscription.gatewaySubscriptionId).catch(
      () => null,
    )
    if (remote && ['authenticated', 'active'].includes(remote.status)) {
      if (subscription.mandateStatus !== 'ACTIVE') await activateMandate(subscription.id, remote)
      throw new ConflictError('AutoPay is already active for this PG')
    }
    if (remote?.status === 'created' && remote.short_url && remote.plan_id === subscription.gatewayPlanId) {
      const planAmount = await prisma.gatewayPlan.findUnique({
        where: { gatewayPlanId: remote.plan_id },
        select: { amount: true },
      })
      if (planAmount?.amount === gross) {
        return { mode: 'live' as const, redirectUrl: remote.short_url, subscription }
      }
    }
    // Stale (other amount, halted, pending…): close it before starting afresh.
    if (remote && !TERMINAL_SUBSCRIPTION_STATES.includes(remote.status)) {
      await rzpCancelSubscription(creds, remote.id, { atCycleEnd: false }).catch((error) =>
        console.error('[subscriptions] could not cancel stale gateway subscription', error),
      )
    }
  }

  const planId = await getOrCreateGatewayPlan(creds, gross)
  // First charge on our next billing date (trial end / next cycle). If that is
  // already due, Razorpay charges on authorisation and the webhook settles the
  // open invoice.
  const startAt = Math.floor(subscription.nextBillingDate.getTime() / 1000)
  const remote = await rzpCreateSubscription(creds, {
    planId,
    totalCount: 120,
    customerNotify: 1,
    startAt: startAt > Math.floor(Date.now() / 1000) + 600 ? startAt : undefined,
    notes: {
      subscriptionId: subscription.id,
      organizationId: subscription.organizationId,
      property: subscription.property.name.slice(0, 200),
    },
  })
  if (!remote.short_url) throw new ValidationError('Razorpay did not return an authorisation link')

  const updated = await prisma.subscription.update({
    where: { id: subscription.id },
    data: {
      gatewaySubscriptionId: remote.id,
      gatewayPlanId: planId,
      gatewayAuthUrl: remote.short_url,
      mandateStatus: 'PENDING',
      autopayEnabled: false,
      mandateRef: null,
    },
  })
  return { mode: 'live' as const, redirectUrl: remote.short_url, subscription: updated }
}

async function activateMandate(subscriptionId: string, remote: RazorpaySubscription) {
  const subscription = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: { property: true },
  })
  if (!subscription) return
  const method = remote.payment_method ?? null
  const kind = method === 'card' ? 'CARD' : method === 'emandate' || method === 'nach' ? 'NACH' : 'UPI_AUTOPAY'
  const label =
    kind === 'CARD' ? 'Card (Razorpay AutoPay)' : kind === 'NACH' ? 'eMandate (Razorpay AutoPay)' : 'UPI AutoPay (Razorpay)'
  const wasActive = subscription.mandateStatus === 'ACTIVE' && subscription.autopayEnabled

  await prisma.$transaction(async (tx) => {
    await tx.subscription.update({
      where: { id: subscriptionId },
      data: {
        autopayEnabled: true,
        mandateStatus: 'ACTIVE',
        mandateRef: remote.id,
        mandateSetupAt: subscription.mandateSetupAt && wasActive ? subscription.mandateSetupAt : new Date(),
        gatewayAuthUrl: null,
      },
    })
    if (!wasActive) {
      await tx.paymentMethod.updateMany({
        where: { subscriptionId, status: { in: ['ACTIVE', 'PENDING'] } },
        data: { status: 'REVOKED', isDefault: false },
      })
      await tx.paymentMethod.create({
        data: { subscriptionId, kind, label, maskedRef: remote.id, isDefault: true, status: 'ACTIVE' },
      })
    }
  })

  if (!wasActive) {
    await notifyOrgAdmins(subscription.organizationId, {
      kind: 'SUBSCRIPTION',
      title: 'AutoPay is active',
      body: `${subscription.property.name} will be charged ${formatMoney(subscription.amount)} automatically each month.`,
      link: '/app/subscription',
    })
  }
}

export async function cancelAutopay(subscriptionId: string) {
  const subscription = await prisma.subscription.findUnique({ where: { id: subscriptionId } })
  if (!subscription) throw new NotFoundError('Subscription not found')

  // Stop the real mandate first: if Razorpay refuses, the owner must know
  // rather than see "off" while debits continue.
  const creds = platformRazorpay()
  if (creds && subscription.gatewaySubscriptionId) {
    await cancelGatewaySubscription(creds, subscription.gatewaySubscriptionId)
  }

  await prisma.paymentMethod.updateMany({
    where: { subscriptionId },
    data: { status: 'REVOKED' },
  })
  return prisma.subscription.update({
    where: { id: subscriptionId },
    data: { autopayEnabled: false, mandateStatus: 'REVOKED', gatewayAuthUrl: null },
  })
}

/**
 * GST invoice numbers: `SF/26-27/0001`, sequential per Indian financial year
 * (April–March) as GST requires, platform-wide (SubscriptionInvoice.number is
 * globally unique), from the race-free counter. Kept within GST's
 * 16-character limit, hence the short "26-27" form.
 */
async function nextSubInvoiceNumber(tx: Prisma.TransactionClient, date: Date) {
  const fy = financialYear(date)
  const head = `SF/${fy}/`
  return nextCounterNumber(tx, {
    key: `subscription-invoice:FY${fy}`,
    head,
    taken: async (number) =>
      Boolean(
        await tx.subscriptionInvoice.findUnique({ where: { number }, select: { id: true } }),
      ),
    used: async () =>
      (
        await tx.subscriptionInvoice.findMany({
          where: { number: { startsWith: head } },
          select: { number: true },
        })
      ).map((r) => r.number),
  })
}

/** GST on a subscription amount for an organization (see lib/gst.ts). */
export function subscriptionGst(
  organization: { gstin?: string | null; state?: string | null },
  taxable: number,
) {
  return computeGst({
    taxable,
    registered: platformEnv.gstRegistered,
    platformStateCode: platformEnv.stateCode,
    recipient: organization,
  })
}

/**
 * Lifts suspension once nothing is overdue: every subscription without an
 * overdue unpaid invoice returns to ACTIVE, and the organization returns to
 * ACTIVE when none of its subscriptions has one. A CANCELLED organization is
 * an admin decision and is left alone. Used by every path that settles an
 * invoice (Pay now, AutoPay charge, admin MARK_PAID).
 */
export async function reactivateOrganizationIfClear(tx: Tx, organizationId: string, now = new Date()) {
  const unpaid = await tx.subscriptionInvoice.findMany({
    where: { subscription: { organizationId }, status: { in: [...UNPAID_INVOICE] } },
    select: { subscriptionId: true, dueDate: true },
  })
  // A subscription keeps its PAST_DUE/GRACE state (and grace deadline) while
  // it has any unpaid invoice, so suspension still applies to that one.
  const withUnpaid = [...new Set(unpaid.map((i) => i.subscriptionId))]

  await tx.subscription.updateMany({
    where: {
      organizationId,
      OR: [
        { status: { in: ['PAST_DUE', 'GRACE', 'SUSPENDED'] } },
        { status: 'ACTIVE', graceEndsAt: { not: null } },
      ],
      id: { notIn: withUnpaid },
    },
    data: { status: 'ACTIVE', graceEndsAt: null },
  })

  if (unpaid.some((i) => i.dueDate < now)) return { reactivated: false }
  const org = await tx.organization.updateMany({
    where: { id: organizationId, status: { in: ['TRIAL', 'PAST_DUE', 'SUSPENDED'] } },
    data: { status: 'ACTIVE' },
  })
  return { reactivated: org.count > 0 }
}

/**
 * Marks a subscription invoice paid and records the payment, in the caller's
 * transaction. Idempotent on `gatewayPaymentId` (unique): a duplicate
 * delivery throws a unique violation the caller treats as "already done".
 * If the invoice was already settled by another route (e.g. Pay now raced an
 * AutoPay charge) the money is still recorded and super admins are told so
 * they can refund.
 */
export async function settleSubscriptionInvoice(
  tx: Tx,
  params: {
    invoiceId: string
    amount?: number
    method: PaymentMethodKind
    provider?: string | null
    gatewayPaymentId?: string | null
    isDemo: boolean
    actor: { id?: string; name: string }
    now?: Date
  },
) {
  const now = params.now ?? new Date()
  await tx.$queryRaw`SELECT "id" FROM "SubscriptionInvoice" WHERE "id" = ${params.invoiceId} FOR UPDATE`
  const invoice = await tx.subscriptionInvoice.findUnique({
    where: { id: params.invoiceId },
    include: { subscription: { include: { property: true } } },
  })
  if (!invoice) throw new NotFoundError('Invoice not found')

  const due = Math.max(0, invoice.total - invoice.amountPaid)
  const amount = params.amount ?? due
  const alreadyPaid = invoice.status === 'PAID' || due === 0

  await tx.subscriptionPayment.create({
    data: {
      subscriptionId: invoice.subscriptionId,
      invoiceId: invoice.id,
      amount,
      status: 'SUCCESS',
      method: params.method,
      paidAt: now,
      gatewayProvider: params.provider ?? null,
      gatewayPaymentId: params.gatewayPaymentId ?? null,
      isDemo: params.isDemo,
    },
  })

  if (alreadyPaid) {
    await notifySuperAdmins(
      {
        kind: 'SUBSCRIPTION',
        title: 'Duplicate subscription payment',
        body: `${invoice.number} was already paid; another ${formatMoney(amount)} arrived${
          params.gatewayPaymentId ? ` (${params.gatewayPaymentId})` : ''
        }. Refund it from the gateway dashboard.`,
        link: '/admin/payments',
      },
      tx,
    )
    return { invoice, alreadyPaid: true, reactivated: false }
  }

  const amountPaid = invoice.amountPaid + amount
  const cleared = amountPaid >= invoice.total
  const updated = await tx.subscriptionInvoice.update({
    where: { id: invoice.id },
    data: {
      amountPaid,
      status: cleared ? 'PAID' : 'PARTIALLY_PAID',
      paidAt: cleared ? now : null,
    },
  })

  const { reactivated } = await reactivateOrganizationIfClear(tx, invoice.subscription.organizationId, now)

  await recordActivity(
    {
      organizationId: invoice.subscription.organizationId,
      propertyId: invoice.subscription.propertyId,
      actorId: params.actor.id,
      actorName: params.actor.name,
      event: 'SUBSCRIPTION_PAYMENT_COMPLETED',
      entityType: 'SubscriptionInvoice',
      entityId: invoice.id,
      summary: `${invoice.number} · ${formatMoney(amount)} received for ${invoice.subscription.property.name}${
        params.isDemo ? ' (demo)' : ''
      }`,
      meta: { method: params.method, gatewayPaymentId: params.gatewayPaymentId ?? null, reactivated },
    },
    tx,
  )
  return { invoice: { ...invoice, ...updated }, alreadyPaid: false, reactivated }
}

/**
 * Claims the subscription's next billing cycle and raises its invoice. The
 * conditional update on nextBillingDate lets only one caller (a billing run
 * or an AutoPay charge webhook) bill a given period. Returns null when someone
 * else already claimed it.
 */
async function claimCycleAndInvoice(
  tx: Tx,
  subscription: { id: string; organizationId: string; nextBillingDate: Date; amount: number },
) {
  const periodStart = startOfDay(subscription.nextBillingDate)
  const periodEnd = startOfDay(addMonths(periodStart, 1))
  const claim = await tx.subscription.updateMany({
    where: { id: subscription.id, nextBillingDate: subscription.nextBillingDate },
    data: { nextBillingDate: periodEnd },
  })
  if (claim.count !== 1) return null
  const number = await nextSubInvoiceNumber(tx, periodStart)
  const organization = await tx.organization.findUnique({
    where: { id: subscription.organizationId },
    select: { gstin: true, state: true },
  })
  // amount = taxable value; tax = 18% GST when the platform is registered.
  const gst = subscriptionGst(organization ?? {}, subscription.amount)
  return tx.subscriptionInvoice.create({
    data: {
      subscriptionId: subscription.id,
      number,
      periodStart,
      periodEnd,
      issueDate: periodStart,
      dueDate: startOfDay(addDays(periodStart, 3)),
      amount: gst.taxable,
      tax: gst.tax,
      total: gst.total,
      status: 'PENDING',
    },
  })
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
    const periodEnd = startOfDay(addMonths(periodStart, 1))

    // Claim this billing cycle and raise its invoice in one transaction: the
    // conditional update on nextBillingDate lets only one of two overlapping
    // runs bill (and charge) the same period.
    const invoice = await retryOnUniqueConflict(
      () => prisma.$transaction((tx) => claimCycleAndInvoice(tx, subscription)),
      ['number'],
    )
    if (!invoice) continue

    const demo = paymentMode() === 'demo'
    const mandateActive = subscription.autopayEnabled && subscription.mandateStatus === 'ACTIVE'

    // Razorpay AutoPay: Razorpay charges on its own schedule and the platform
    // webhook (subscription.charged) settles this invoice. We never debit
    // ourselves; if no charge arrives by graceEndsAt, enforceGracePeriods
    // suspends exactly as for a manual invoice.
    if (!demo && mandateActive && subscription.gatewaySubscriptionId) {
      const graceEndsAt = addDays(periodStart, subscription.plan.graceDays)
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          status: subscription.status === 'TRIALING' ? 'ACTIVE' : subscription.status,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          graceEndsAt,
        },
      })
      await notifyOrgAdmins(subscription.organizationId, {
        kind: 'SUBSCRIPTION',
        title: 'Subscription invoice raised',
        body: `${invoice.number} · ${formatMoney(invoice.total)} for ${subscription.property.name} will be collected by AutoPay.`,
        link: '/app/subscription',
      })
      results.push({ property: subscription.property.name, amount: invoice.total, outcome: 'invoiced' })
      continue
    }

    // No usable mandate (or a legacy live "mandate" with no gateway behind
    // it): the owner pays the invoice with Pay now.
    if (!demo || !mandateActive) {
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
        body: `${invoice.number} · ${formatMoney(invoice.total)} for ${subscription.property.name}. Pay before ${addDays(periodStart, subscription.plan.graceDays).toLocaleDateString('en-IN')}.`,
        link: '/app/subscription',
      })
      results.push({ property: subscription.property.name, amount: invoice.total, outcome: 'invoiced' })
      continue
    }

    // Demo AutoPay attempt: a labelled simulation — no money moves and every
    // row is flagged isDemo.
    const attempt = simulateAutopayDebit(invoice.id)

    if (attempt.success) {
      await prisma.$transaction(async (tx) => {
        await tx.subscriptionPayment.create({
          data: {
            subscriptionId: subscription.id,
            invoiceId: invoice.id,
            amount: invoice.total,
            status: 'SUCCESS',
            method: 'GATEWAY',
            paidAt: now,
            gatewayProvider: demo ? 'demo' : 'gateway',
            isDemo: demo,
          },
        })
        await tx.subscriptionInvoice.update({
          where: { id: invoice.id },
          data: { status: 'PAID', amountPaid: invoice.total, paidAt: now },
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
        await reactivateOrganizationIfClear(tx, subscription.organizationId, now)
        await recordActivity(
          {
            organizationId: subscription.organizationId,
            propertyId: subscription.propertyId,
            actorName: 'AutoPay',
            event: 'SUBSCRIPTION_PAYMENT_COMPLETED',
            entityType: 'SubscriptionInvoice',
            entityId: invoice.id,
            summary: `${invoice.number} · ${formatMoney(invoice.total)} charged for ${subscription.property.name}`,
          },
          tx,
        )
      })
      await notifyOrgAdmins(subscription.organizationId, {
        kind: 'SUBSCRIPTION',
        title: 'Subscription charged',
        body: `${formatMoney(invoice.total)} for ${subscription.property.name}. Invoice ${invoice.number}.`,
        link: '/app/subscription',
      })
      results.push({ property: subscription.property.name, amount: invoice.total, outcome: 'paid' })
    } else {
      const graceEndsAt = addDays(periodStart, subscription.plan.graceDays)
      await prisma.$transaction(async (tx) => {
        await tx.subscriptionPayment.create({
          data: {
            subscriptionId: subscription.id,
            invoiceId: invoice.id,
            amount: invoice.total,
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
        amount: invoice.total,
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
    where: {
      // ACTIVE is included for Razorpay AutoPay subscriptions: their invoice is
      // raised with a grace deadline while we wait for the charge webhook.
      status: { in: ['GRACE', 'PAST_DUE', 'ACTIVE'] },
      graceEndsAt: { lt: now },
      invoices: { some: { status: { in: [...UNPAID_INVOICE] } } },
    },
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
  const result = await prisma.$transaction(async (tx) => {
    const invoice = await tx.subscriptionInvoice.findUnique({
      where: { id: params.invoiceId },
      select: { status: true },
    })
    if (!invoice) throw new NotFoundError('Invoice not found')
    if (invoice.status === 'PAID') throw new ConflictError('This invoice is already paid')
    // Same settle + reactivation path as Pay now and AutoPay charges.
    return settleSubscriptionInvoice(tx, {
      invoiceId: params.invoiceId,
      method: params.method ?? 'BANK_TRANSFER',
      provider: params.reference ? `manual:${params.reference.slice(0, 60)}` : 'manual',
      isDemo: paymentMode() === 'demo',
      actor: params.actor,
    })
  })
  return result.invoice
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

// --------------------------------------------------------------------------
// Pay now (one-off payment of a subscription invoice)
// --------------------------------------------------------------------------

async function loadPayableInvoice(invoiceId: string, organizationId: string) {
  const invoice = await prisma.subscriptionInvoice.findUnique({
    where: { id: invoiceId },
    include: { subscription: { include: { property: true, organization: true } } },
  })
  if (!invoice || invoice.subscription.organizationId !== organizationId) {
    throw new NotFoundError('Invoice not found')
  }
  if (!(UNPAID_INVOICE as readonly string[]).includes(invoice.status)) {
    throw new ConflictError('This invoice is not awaiting payment')
  }
  const due = invoice.total - invoice.amountPaid
  if (due <= 0) throw new ConflictError('This invoice is already paid')
  return { invoice, due }
}

export type InvoiceCheckout =
  | { mode: 'demo'; invoiceId: string; number: string; amount: number }
  | {
      mode: 'live'
      invoiceId: string
      number: string
      amount: number
      keyId: string
      orderId: string
      amountPaise: number
      currency: 'INR'
      description: string
      prefill: { name: string; email: string; contact: string }
      notes: Record<string, string>
    }

/** Starts Pay now: a platform Razorpay order for the invoice's balance. */
export async function startInvoiceCheckout(params: {
  invoiceId: string
  organizationId: string
  payer: { name: string; email: string }
}): Promise<InvoiceCheckout> {
  const { invoice, due } = await loadPayableInvoice(params.invoiceId, params.organizationId)
  const creds = platformRazorpay()
  if (!creds) return { mode: 'demo', invoiceId: invoice.id, number: invoice.number, amount: due }

  const notes = {
    kind: 'subscription_invoice',
    invoiceId: invoice.id,
    organizationId: invoice.subscription.organizationId,
  }

  // Re-use the open order for this invoice when the amount still matches, so
  // retrying checkout does not litter the account with orders.
  let orderId: string | null = null
  if (invoice.gatewayOrderId) {
    const existing = await rzpFetchOrder(creds, invoice.gatewayOrderId).catch(() => null)
    if (existing && existing.status !== 'paid' && existing.amount === toPaise(due)) orderId = existing.id
  }
  if (!orderId) {
    const order = await createOrder({ amount: due, receipt: invoice.number, notes })
    orderId = order.id
    await prisma.subscriptionInvoice.update({
      where: { id: invoice.id },
      data: { gatewayOrderId: orderId },
    })
  }

  const org = invoice.subscription.organization
  return {
    mode: 'live',
    invoiceId: invoice.id,
    number: invoice.number,
    amount: due,
    keyId: creds.keyId,
    orderId,
    amountPaise: toPaise(due),
    currency: 'INR',
    description: `${invoice.number} · ${invoice.subscription.property.name}`,
    prefill: {
      name: params.payer.name || org.ownerName,
      email: params.payer.email || org.contactEmail,
      contact: org.contactPhone,
    },
    notes,
  }
}

export type SettleOutcome = {
  status: 'paid' | 'duplicate' | 'ignored'
  invoiceNumber?: string
  reactivated?: boolean
  reason?: string
}

/**
 * Settles a subscription invoice from a payment Razorpay confirmed on the
 * PLATFORM account (fetched, or delivered by a signed webhook). Shared by the
 * checkout callback and the webhook — whichever is second sees `duplicate`.
 */
async function settleInvoiceFromPlatformPayment(
  creds: RazorpayCredentials,
  payment: RazorpayPayment,
  expect?: { invoiceId: string; organizationId: string; orderId: string },
): Promise<SettleOutcome> {
  if (payment.status !== 'captured' && payment.status !== 'authorized') {
    return { status: 'ignored', reason: `Payment is ${payment.status}` }
  }
  if (!payment.order_id) return { status: 'ignored', reason: 'Payment has no order' }
  if (expect && payment.order_id !== expect.orderId) {
    return { status: 'ignored', reason: 'Payment does not belong to this order' }
  }

  const order = await rzpFetchOrder(creds, payment.order_id)
  const notes = { ...notesOf(payment), ...notesOf(order) }
  if (notes.kind !== 'subscription_invoice' || !notes.invoiceId) {
    return { status: 'ignored', reason: 'Not a subscription invoice order' }
  }
  if (payment.amount !== order.amount || payment.currency !== 'INR') {
    return { status: 'ignored', reason: 'Payment amount does not match the order' }
  }
  if (
    expect &&
    (notes.invoiceId !== expect.invoiceId || notes.organizationId !== expect.organizationId)
  ) {
    return { status: 'ignored', reason: 'Order belongs to another invoice' }
  }

  const exists = await prisma.subscriptionPayment.findUnique({
    where: { gatewayPaymentId: payment.id },
    select: { id: true },
  })
  if (exists) return { status: 'duplicate' }

  try {
    const result = await prisma.$transaction((tx) =>
      settleSubscriptionInvoice(tx, {
        invoiceId: notes.invoiceId,
        amount: fromPaise(payment.amount),
        method: payment.method === 'upi' ? 'UPI' : payment.method === 'card' ? 'CARD' : 'GATEWAY',
        provider: 'razorpay',
        gatewayPaymentId: payment.id,
        isDemo: false,
        actor: { name: 'Razorpay' },
      }),
    )
    await notifyPaid(result.invoice, fromPaise(payment.amount), result.reactivated)
    return { status: 'paid', invoiceNumber: result.invoice.number, reactivated: result.reactivated }
  } catch (error) {
    if (isUniqueViolation(error, ['gatewayPaymentId'])) return { status: 'duplicate' }
    throw error
  }
}

async function notifyPaid(
  invoice: { number: string; subscription: { organizationId: string; property: { name: string } } },
  amount: number,
  reactivated: boolean,
) {
  await notifyOrgAdmins(invoice.subscription.organizationId, {
    kind: 'SUBSCRIPTION',
    title: reactivated ? 'Payment received — account restored' : 'Subscription payment received',
    body: `${formatMoney(amount)} for ${invoice.subscription.property.name}. Invoice ${invoice.number}.`,
    link: '/app/subscription',
  })
}

/** Checkout callback for Pay now: signature, then a fetch from Razorpay. */
export async function confirmInvoiceCheckout(params: {
  invoiceId: string
  organizationId: string
  orderId: string
  paymentId: string
  signature: string
}): Promise<SettleOutcome> {
  const creds = platformRazorpay()
  if (!creds) throw new ValidationError('Online payment is not configured on this deployment')
  if (!verifyPaymentSignature(params)) throw new ValidationError('Payment signature did not verify')
  const payment = await rzpFetchPayment(creds, params.paymentId)
  return settleInvoiceFromPlatformPayment(creds, payment, {
    invoiceId: params.invoiceId,
    organizationId: params.organizationId,
    orderId: params.orderId,
  })
}

/** Demo-mode Pay now: same settlement, flagged isDemo everywhere. */
export async function payInvoiceDemo(params: {
  invoiceId: string
  organizationId: string
  actor: { id?: string; name: string }
}): Promise<SettleOutcome> {
  if (paymentMode() !== 'demo') {
    throw new ValidationError('Demo payments are disabled once a real gateway is configured')
  }
  const { invoice, due } = await loadPayableInvoice(params.invoiceId, params.organizationId)
  const result = await prisma.$transaction((tx) =>
    settleSubscriptionInvoice(tx, {
      invoiceId: invoice.id,
      amount: due,
      method: 'GATEWAY',
      provider: 'demo',
      isDemo: true,
      actor: params.actor,
    }),
  )
  await notifyPaid(result.invoice, due, result.reactivated)
  return { status: 'paid', invoiceNumber: invoice.number, reactivated: result.reactivated }
}

// --------------------------------------------------------------------------
// Platform Razorpay webhook (AutoPay subscriptions + Pay now)
// --------------------------------------------------------------------------

export type WebhookResult = { handled: boolean; note: string }

/** Finds our Subscription for a Razorpay subscription entity. */
async function subscriptionForRemote(remote: RazorpaySubscription) {
  const byId = await prisma.subscription.findUnique({
    where: { gatewaySubscriptionId: remote.id },
    include: { property: true, plan: true, organization: true },
  })
  if (byId) return { subscription: byId, current: true }
  // An older (replaced) gateway subscription of ours: still map charges, but
  // never let its status events overwrite the current mandate.
  const ourId = notesOf(remote).subscriptionId
  if (!ourId) return null
  const byNotes = await prisma.subscription.findUnique({
    where: { id: ourId },
    include: { property: true, plan: true, organization: true },
  })
  return byNotes ? { subscription: byNotes, current: false } : null
}

/**
 * subscription.charged: settle the oldest unpaid invoice of the subscription,
 * or — when the charge arrives before our billing run raised one — claim the
 * next cycle and invoice it here. Idempotent on the payment id.
 */
async function handleSubscriptionCharged(
  remote: RazorpaySubscription,
  payment: RazorpayPayment | undefined,
): Promise<WebhookResult> {
  if (!payment?.id) return { handled: false, note: 'charged event without a payment' }
  const found = await subscriptionForRemote(remote)
  if (!found) return { handled: false, note: 'unknown subscription' }
  const { subscription } = found

  const exists = await prisma.subscriptionPayment.findUnique({
    where: { gatewayPaymentId: payment.id },
    select: { id: true },
  })
  if (exists) return { handled: true, note: 'duplicate' }

  if (found.current && subscription.mandateStatus !== 'ACTIVE') {
    await activateMandate(subscription.id, remote)
  }

  const amount = fromPaise(payment.amount)
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await retryOnUniqueConflict(
        () =>
          prisma.$transaction(async (tx) => {
            let invoice = await tx.subscriptionInvoice.findFirst({
              where: { subscriptionId: subscription.id, status: { in: [...UNPAID_INVOICE] } },
              orderBy: { periodStart: 'asc' },
            })
            if (!invoice) {
              const fresh = await tx.subscription.findUnique({ where: { id: subscription.id } })
              if (!fresh) return null
              invoice = await claimCycleAndInvoice(tx, fresh)
              if (!invoice) return null // a billing run claimed it first — retry
              await tx.subscription.update({
                where: { id: subscription.id },
                data: {
                  status: fresh.status === 'TRIALING' ? 'ACTIVE' : fresh.status,
                  currentPeriodStart: invoice.periodStart,
                  currentPeriodEnd: invoice.periodEnd,
                },
              })
            }
            return settleSubscriptionInvoice(tx, {
              invoiceId: invoice.id,
              amount,
              method: payment.method === 'upi' ? 'UPI' : payment.method === 'card' ? 'CARD' : 'GATEWAY',
              provider: 'razorpay',
              gatewayPaymentId: payment.id,
              isDemo: false,
              actor: { name: 'AutoPay' },
            })
          }),
        ['number'],
      )
      if (!result) continue
      await notifyOrgAdmins(subscription.organizationId, {
        kind: 'SUBSCRIPTION',
        title: result.reactivated ? 'AutoPay charged — account restored' : 'Subscription charged',
        body: `${formatMoney(amount)} for ${subscription.property.name}. Invoice ${result.invoice.number}.`,
        link: '/app/subscription',
      })
      return { handled: true, note: `settled ${result.invoice.number}` }
    } catch (error) {
      if (isUniqueViolation(error, ['gatewayPaymentId'])) return { handled: true, note: 'duplicate' }
      throw error
    }
  }
  return { handled: false, note: 'could not claim a billing cycle' }
}

async function handleSubscriptionTrouble(
  remote: RazorpaySubscription,
  kind: 'pending' | 'halted',
): Promise<WebhookResult> {
  const found = await subscriptionForRemote(remote)
  if (!found?.current) return { handled: false, note: 'not the current gateway subscription' }
  const { subscription } = found
  const graceEndsAt = subscription.graceEndsAt ?? addDays(new Date(), subscription.plan.graceDays)

  await prisma.subscription.update({
    where: { id: subscription.id },
    data: {
      status: ['ACTIVE', 'TRIALING'].includes(subscription.status) ? 'PAST_DUE' : subscription.status,
      graceEndsAt,
      ...(kind === 'halted' ? { mandateStatus: 'FAILED' as const, autopayEnabled: false } : {}),
    },
  })
  if (kind === 'halted') {
    await prisma.paymentMethod.updateMany({
      where: { subscriptionId: subscription.id, status: 'ACTIVE' },
      data: { status: 'FAILED' },
    })
  }
  await recordActivity({
    organizationId: subscription.organizationId,
    propertyId: subscription.propertyId,
    actorName: 'AutoPay',
    event: 'SUBSCRIPTION_PAYMENT_FAILED',
    entityType: 'Subscription',
    entityId: subscription.id,
    summary:
      kind === 'halted'
        ? `${subscription.property.name}: AutoPay stopped after repeated failed charges`
        : `${subscription.property.name}: AutoPay charge failed, Razorpay will retry`,
  })
  await notifyOrgAdmins(subscription.organizationId, {
    kind: 'SUBSCRIPTION',
    title: kind === 'halted' ? 'AutoPay has stopped' : 'AutoPay charge failed',
    body:
      kind === 'halted'
        ? `Razorpay could not charge ${subscription.property.name} after several tries. Pay the invoice with Pay now and set up AutoPay again before ${graceEndsAt.toLocaleDateString('en-IN')}.`
        : `The charge for ${subscription.property.name} failed; Razorpay will retry. You can also pay the invoice now. Access stays on until ${graceEndsAt.toLocaleDateString('en-IN')}.`,
    link: '/app/subscription',
  })
  if (kind === 'halted') {
    await notifySuperAdmins({
      kind: 'SUBSCRIPTION',
      title: 'AutoPay halted',
      body: `${subscription.organization.name} — ${subscription.property.name}`,
      link: '/admin/payments',
    })
  }
  return { handled: true, note: `mandate ${kind}` }
}

async function handleSubscriptionEnded(remote: RazorpaySubscription): Promise<WebhookResult> {
  const found = await subscriptionForRemote(remote)
  if (!found?.current) return { handled: false, note: 'not the current gateway subscription' }
  const { subscription } = found
  const wasActive = subscription.mandateStatus === 'ACTIVE'
  await prisma.$transaction([
    prisma.subscription.update({
      where: { id: subscription.id },
      data: { autopayEnabled: false, mandateStatus: 'REVOKED', gatewayAuthUrl: null },
    }),
    prisma.paymentMethod.updateMany({
      where: { subscriptionId: subscription.id, status: { in: ['ACTIVE', 'PENDING'] } },
      data: { status: 'REVOKED' },
    }),
  ])
  if (wasActive) {
    await notifyOrgAdmins(subscription.organizationId, {
      kind: 'SUBSCRIPTION',
      title: 'AutoPay switched off',
      body: `The AutoPay mandate for ${subscription.property.name} was cancelled. Pay invoices with Pay now or set up AutoPay again.`,
      link: '/app/subscription',
    })
  }
  return { handled: true, note: 'mandate revoked' }
}

/**
 * Legacy: rent orders created on the PLATFORM account by older builds carried
 * notes {invoiceId, residentId}. Still recorded so nothing paid is lost.
 */
async function handleLegacyRentPayment(payment: RazorpayPayment, notes: Record<string, string>) {
  const invoice = await prisma.rentInvoice.findUnique({
    where: { id: notes.invoiceId },
    select: { id: true, residentId: true },
  })
  if (!invoice || invoice.residentId !== notes.residentId) {
    return { handled: false, note: 'unknown rent invoice' }
  }
  const result = await recordGatewayPayment({
    residentId: invoice.residentId,
    amount: fromPaise(payment.amount),
    method: payment.method === 'upi' ? 'UPI' : 'GATEWAY',
    reference: payment.order_id ?? payment.id,
    notes: 'Paid online by the resident',
    invoiceIds: [invoice.id],
    actor: { name: 'Payment gateway' },
    gateway: {
      provider: 'razorpay',
      orderId: payment.order_id ?? undefined,
      paymentId: payment.id,
      isDemo: false,
    },
  })
  return { handled: true, note: result.duplicate ? 'duplicate' : `receipt ${result.payment.receiptNumber}` }
}

/**
 * Dispatches a PLATFORM webhook whose signature the route already verified.
 * Never throws for an unknown or irrelevant event — it is acknowledged and
 * ignored so Razorpay stops retrying.
 */
export async function handlePlatformWebhook(event: RazorpayWebhookEvent): Promise<WebhookResult> {
  const creds = platformRazorpay()
  if (!creds) return { handled: false, note: 'platform gateway not configured' }
  const name = event.event ?? ''
  const remote = event.payload?.subscription?.entity
  const payment = event.payload?.payment?.entity

  if (name.startsWith('subscription.')) {
    if (!remote?.id) return { handled: false, note: 'no subscription entity' }
    switch (name) {
      case 'subscription.authenticated':
      case 'subscription.activated':
      case 'subscription.resumed': {
        const found = await subscriptionForRemote(remote)
        if (!found?.current) return { handled: false, note: 'not the current gateway subscription' }
        await activateMandate(found.subscription.id, remote)
        return { handled: true, note: 'mandate active' }
      }
      case 'subscription.charged':
        return handleSubscriptionCharged(remote, payment)
      case 'subscription.pending':
        return handleSubscriptionTrouble(remote, 'pending')
      case 'subscription.halted':
        return handleSubscriptionTrouble(remote, 'halted')
      case 'subscription.cancelled':
      case 'subscription.completed':
        return handleSubscriptionEnded(remote)
      default:
        return { handled: false, note: `ignored ${name}` }
    }
  }

  if (name === 'payment.captured' && payment?.id) {
    let notes = notesOf(payment)
    if (!notes.kind && payment.order_id && !notes.residentId) {
      const order = await rzpFetchOrder(creds, payment.order_id).catch(() => null)
      notes = { ...notes, ...notesOf(order) }
    }
    if (notes.kind === 'subscription_invoice') {
      const outcome = await settleInvoiceFromPlatformPayment(creds, payment)
      return { handled: outcome.status !== 'ignored', note: outcome.reason ?? outcome.status }
    }
    if (notes.invoiceId && notes.residentId && (!notes.kind || notes.kind === 'rent')) {
      return handleLegacyRentPayment(payment, notes)
    }
    return { handled: false, note: 'payment not for StayFlow invoices' }
  }

  if (name === 'payment.failed' && payment?.id) {
    const notes = notesOf(payment)
    if (notes.kind === 'subscription_invoice' && notes.invoiceId) {
      const invoice = await prisma.subscriptionInvoice.findUnique({
        where: { id: notes.invoiceId },
        include: { subscription: true },
      })
      if (invoice) {
        await recordActivity({
          organizationId: invoice.subscription.organizationId,
          propertyId: invoice.subscription.propertyId,
          actorName: 'Razorpay',
          event: 'SUBSCRIPTION_PAYMENT_FAILED',
          entityType: 'SubscriptionInvoice',
          entityId: invoice.id,
          summary: `${invoice.number} payment failed${payment.error_description ? ` — ${payment.error_description}` : ''}`,
        })
      }
    }
    return { handled: true, note: 'payment failure logged' }
  }

  return { handled: false, note: `ignored ${name || 'unknown event'}` }
}

// --------------------------------------------------------------------------
// Plan limits
// --------------------------------------------------------------------------

/**
 * Throws a ConflictError when adding one more property / resident would exceed
 * the organization's plan. The limit is the most generous `maxProperties` /
 * `maxResidents` among the plans of the organization's live subscriptions
 * (null = unlimited); an organization with no subscription yet is held to the
 * default plan. Call before creating the property or checking the resident in.
 */
export async function assertPlanCapacity(organizationId: string, kind: 'property' | 'resident') {
  const subscriptions = await prisma.subscription.findMany({
    where: { organizationId, status: { not: 'CANCELLED' } },
    select: { plan: { select: { name: true, maxProperties: true, maxResidents: true } } },
  })
  const plans = subscriptions.length
    ? subscriptions.map((s) => s.plan)
    : await prisma.plan.findMany({
        where: { active: true },
        orderBy: { isDefault: 'desc' },
        take: 1,
        select: { name: true, maxProperties: true, maxResidents: true },
      })
  if (!plans.length) return

  const limits = plans.map((p) => (kind === 'property' ? p.maxProperties : p.maxResidents))
  if (limits.some((l) => l == null)) return
  const limit = Math.max(...(limits as number[]))

  const used =
    kind === 'property'
      ? await prisma.property.count({ where: { organizationId, archivedAt: null } })
      : await prisma.resident.count({ where: { organizationId, status: { in: ['ACTIVE', 'NOTICE'] } } })

  if (used >= limit) {
    const what = kind === 'property' ? 'PGs' : 'active residents'
    throw new ConflictError(
      `Your ${plans[0].name} plan allows up to ${limit} ${what}. Contact StayFlow support to upgrade your plan.`,
    )
  }
}
