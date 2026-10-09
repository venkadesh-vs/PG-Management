import 'server-only'

import type { BillingCycle, PaymentMethodKind, Plan, Prisma, Property, UserRole } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/tenancy'
import { notifyOrgAdmins, notifySuperAdmins, recordActivity } from '../events'
import { addDays, addMonths, formatMoney, startOfDay } from '@/lib/utils'
import { computeGst, financialYear } from '@/lib/gst'
import { platformEnv } from '@/lib/platform-env'
import {
  createOrder,
  demoPaymentsAllowed,
  getOrgRazorpay,
  handleOrgWebhook,
  PAYMENT_NOT_SET_UP,
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
import { isUniqueViolation, nextCounterNumber, recordGatewayPayment, retryOnUniqueConflict } from './billing'
import {
  CANCEL_CATEGORIES,
  CYCLE_LABEL,
  RETRY_DAYS,
  CYCLE_MONTHS,
  cyclePrice,
  isStaleFailureEvent,
  nextRetryAt,
  nextStatus,
  prorate,
  retriesExhausted,
  type CancelCategory,
  type SubStatus,
} from '@/lib/subscription-math'
import { downgradeBlockers, type PlanLimits } from '@/lib/plan-entitlements'
import { assertWithinPlan, countUsage } from './plan-limits'
import { failedWebhooks, finishWebhook, reclaimFailedWebhook } from './webhook-log'
import { ownerBillingEvents } from './owner-billing'

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
  const periodEnd = addMonths(now, CYCLE_MONTHS[plan.billingCycle] ?? 1)

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
  const autopayStopped = await stopMandateForNewAmount(subscription.id)
  return { changed: true, price, autopayStopped }
}

/**
 * Stops a live Razorpay mandate because what each charge should collect has
 * changed (reprice, plan change, cycle switch), and asks the owner to set up
 * AutoPay again for the new amount. Returns whether a mandate was stopped.
 */
export async function stopMandateForNewAmount(subscriptionId: string): Promise<boolean> {
  const subscription = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: { property: true, plan: true },
  })
  if (!subscription) return false
  const creds = platformRazorpay()
  if (
    !creds ||
    !subscription.gatewaySubscriptionId ||
    (subscription.mandateStatus !== 'ACTIVE' && subscription.mandateStatus !== 'PENDING')
  ) {
    return false
  }
  await cancelGatewaySubscription(creds, subscription.gatewaySubscriptionId)
  await prisma.$transaction([
    prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        autopayEnabled: false,
        mandateStatus: 'REVOKED',
        gatewayAuthUrl: null,
      },
    }),
    prisma.paymentMethod.updateMany({
      where: {
        subscriptionId: subscription.id,
        status: { in: ['ACTIVE', 'PENDING'] },
      },
      data: { status: 'REVOKED' },
    }),
  ])
  const perCycle = cyclePrice(
    subscription.amount,
    subscription.billingCycle,
    subscription.plan.yearlyDiscountPercent,
  )
  await notifyOrgAdmins(subscription.organizationId, {
    kind: 'SUBSCRIPTION',
    title: 'Please re-authorise AutoPay',
    body: `${subscription.property.name}'s subscription is now ${formatMoney(perCycle)} ${CYCLE_LABEL[subscription.billingCycle].toLowerCase()}. Your old AutoPay was for a different amount, so it has been stopped — set up AutoPay again to approve the new amount.`,
    link: '/app/subscription',
  })
  return true
}

/** Cancels a Razorpay subscription unless it is already in a terminal state. */
async function cancelGatewaySubscription(creds: RazorpayCredentials, gatewaySubscriptionId: string) {
  const remote = await rzpFetchSubscription(creds, gatewaySubscriptionId)
  if (TERMINAL_SUBSCRIPTION_STATES.includes(remote.status)) return remote
  return rzpCancelSubscription(creds, gatewaySubscriptionId, { atCycleEnd: false })
}

/** Razorpay plan period for a billing cycle. */
function gatewayPeriod(cycle: BillingCycle): {
  period: 'monthly' | 'yearly'
  interval: number
} {
  return cycle === 'YEARLY'
    ? { period: 'yearly', interval: 1 }
    : { period: 'monthly', interval: CYCLE_MONTHS[cycle] }
}

/** Finds (or creates and caches) the Razorpay plan for an amount per billing cycle. */
async function getOrCreateGatewayPlan(
  creds: RazorpayCredentials,
  amount: number,
  cycle: BillingCycle = 'MONTHLY',
) {
  // Plans live in one Razorpay account (and test/live are separate), so the
  // cache is keyed by key id.
  const provider = `razorpay:${creds.keyId}`
  const { period, interval } = gatewayPeriod(cycle)
  const where = {
    provider_amount_period_interval: { provider, amount, period, interval },
  }
  const cached = await prisma.gatewayPlan.findUnique({ where })
  if (cached) return cached.gatewayPlanId

  const plan = await rzpCreatePlan(creds, {
    period,
    interval,
    name: `StayFlow PG subscription — ${formatMoney(amount)} ${CYCLE_LABEL[cycle].toLowerCase()}`,
    amountPaise: toPaise(amount),
  })
  try {
    await prisma.gatewayPlan.create({
      data: { provider, amount, period, interval, gatewayPlanId: plan.id },
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
    include: { property: true, plan: true },
  })
  if (!subscription) throw new NotFoundError('Subscription not found')
  if (subscription.status === 'CANCELLED') throw new ConflictError('This subscription is cancelled')

  // Live: a real Razorpay Subscription the owner authorises on Razorpay's
  // hosted page (UPI AutoPay / card / eMandate).
  const creds = platformRazorpay()
  if (creds) return setupGatewayAutopay(creds, subscription)

  // Demo: the mandate is local and clearly labelled — demo deployments only.
  if (!demoPaymentsAllowed()) throw new ConflictError(PAYMENT_NOT_SET_UP)
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
  subscription: Prisma.SubscriptionGetPayload<{
    include: { property: true; plan: true }
  }>,
) {
  if (subscription.amount < 1) throw new ValidationError('This subscription has no amount to collect')
  // The mandate collects the invoice total for one billing cycle, GST included.
  const organization = await prisma.organization.findUnique({
    where: { id: subscription.organizationId },
    select: { gstin: true, state: true },
  })
  const perCycle = cyclePrice(
    subscription.amount,
    subscription.billingCycle,
    subscription.plan.yearlyDiscountPercent,
  )
  const gross = subscriptionGst(organization ?? {}, perCycle).total

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

  const planId = await getOrCreateGatewayPlan(creds, gross, subscription.billingCycle)
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
    data: {
      status: 'ACTIVE',
      graceEndsAt: null,
      failedAttempts: 0,
      nextRetryAt: null,
      lastPaymentError: null,
    },
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
  const current = await tx.subscription.findUnique({
    where: { id: subscription.id },
    include: { plan: true, property: true },
  })
  if (!current) return null

  // A downgrade or cycle switch the owner scheduled takes effect now, at the
  // start of the new period.
  let plan = current.plan
  let amount = current.amount
  const cycle = current.pendingBillingCycle ?? current.billingCycle
  if (current.pendingPlanId && current.pendingPlanId !== current.planId) {
    const target = await tx.plan.findUnique({
      where: { id: current.pendingPlanId },
    })
    if (target) {
      plan = target
      amount = (await priceForProperty(current.property, target)).amount
    }
  }

  const periodStart = startOfDay(subscription.nextBillingDate)
  const periodEnd = startOfDay(addMonths(periodStart, CYCLE_MONTHS[cycle] ?? 1))
  const claim = await tx.subscription.updateMany({
    where: {
      id: subscription.id,
      nextBillingDate: subscription.nextBillingDate,
    },
    data: {
      nextBillingDate: periodEnd,
      planId: plan.id,
      amount,
      billingCycle: cycle,
      pendingPlanId: null,
      pendingBillingCycle: null,
    },
  })
  if (claim.count !== 1) return null
  const changed = plan.id !== current.planId || cycle !== current.billingCycle
  if (changed) {
    await recordActivity(
      {
        organizationId: current.organizationId,
        propertyId: current.propertyId,
        actorName: 'Billing',
        event: 'SUBSCRIPTION_CHANGED',
        entityType: 'Subscription',
        entityId: current.id,
        summary: `${current.property.name}: scheduled change applied — ${plan.name}, ${CYCLE_LABEL[cycle].toLowerCase()} billing`,
        before: {
          plan: current.plan.name,
          billingCycle: current.billingCycle,
          amount: current.amount,
        },
        after: { plan: plan.name, billingCycle: cycle, amount },
      },
      tx,
    )
  }
  const number = await nextSubInvoiceNumber(tx, periodStart)
  const organization = await tx.organization.findUnique({
    where: { id: subscription.organizationId },
    select: { gstin: true, state: true },
  })
  // amount = taxable value for the whole cycle; tax = 18% GST when registered.
  const gst = subscriptionGst(organization ?? {}, cyclePrice(amount, cycle, plan.yearlyDiscountPercent))
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
 * invoice (applying any scheduled downgrade / cycle switch first), attempts
 * AutoPay where a mandate exists, and moves the subscription along the
 * lifecycle when payment fails. A subscription set to cancel at period end
 * is cancelled here instead of being billed.
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
    outcome: 'paid' | 'failed' | 'invoiced' | 'cancelled'
    reason?: string
  }[] = []

  for (const subscription of due) {
    // Cancel at period end: the paid period is over, so stop here.
    if (subscription.cancelAtPeriodEnd) {
      await finaliseCancellation(subscription.id, { name: 'Billing' }, now)
      results.push({
        property: subscription.property.name,
        amount: 0,
        outcome: 'cancelled',
      })
      continue
    }

    // Claim this billing cycle and raise its invoice in one transaction: the
    // conditional update on nextBillingDate lets only one of two overlapping
    // runs bill (and charge) the same period.
    const invoice = await retryOnUniqueConflict(
      () => prisma.$transaction((tx) => claimCycleAndInvoice(tx, subscription)),
      ['number'],
    )
    if (!invoice) continue
    const periodStart = invoice.periodStart
    const periodEnd = invoice.periodEnd

    const demo = paymentMode() === 'demo'
    let mandateActive = subscription.autopayEnabled && subscription.mandateStatus === 'ACTIVE'
    const scheduledChange = Boolean(subscription.pendingPlanId || subscription.pendingBillingCycle)

    // A scheduled plan / cycle change alters what each charge collects. A live
    // Razorpay mandate was authorised for the old amount, so it is stopped and
    // the owner re-authorises (explicit consent for the new amount); this
    // invoice is then paid with Pay now.
    if (!demo && mandateActive && subscription.gatewaySubscriptionId && scheduledChange) {
      await stopMandateForNewAmount(subscription.id).catch((error) =>
        console.error('[subscriptions] could not stop mandate after scheduled change', error),
      )
      mandateActive = false
    }

    if (!demo && mandateActive && subscription.gatewaySubscriptionId) {
      // Razorpay AutoPay: Razorpay charges on its own schedule and the platform
      // webhook (subscription.charged) settles this invoice. We never debit
      // ourselves; if no charge arrives by graceEndsAt, enforceGracePeriods
      // suspends exactly as for a manual invoice.
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
    // it): the owner pays the invoice with Pay now. PAST_DUE ("payment due")
    // until the due date, then GRACE until graceEndsAt, then SUSPENDED.
    if (!demo || !mandateActive || !demoPaymentsAllowed()) {
      const graceEndsAt = addDays(periodStart, subscription.plan.graceDays)
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          status: nextStatus(subscription.status as SubStatus, {
            type: 'INVOICE_UNPAID',
          }),
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          graceEndsAt,
        },
      })
      // In-app + WhatsApp + email, exactly once per invoice.
      await ownerBillingEvents.invoiceRaised(
        { id: subscription.id, organizationId: subscription.organizationId, propertyName: subscription.property.name },
        invoice,
      )
      results.push({
        property: subscription.property.name,
        amount: invoice.total,
        outcome: 'invoiced',
      })
      continue
    }

    // Our own debit (demo AutoPay): a labelled simulation — no money moves and
    // every row is flagged isDemo. Failures follow the retry schedule.
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: { currentPeriodStart: periodStart, currentPeriodEnd: periodEnd },
    })
    const outcome = await attemptOwnCharge({
      subscriptionId: subscription.id,
      invoiceId: invoice.id,
      attempt: 1,
      firstFailedAt: now,
      now,
    })
    results.push({
      property: subscription.property.name,
      amount: invoice.total,
      outcome: outcome.success ? 'paid' : 'failed',
      reason: outcome.reason,
    })
  }

  return results
}

/**
 * One charge attempt we make ourselves (demo AutoPay). On failure the
 * subscription becomes PAST_DUE with a retry 1, 3 and 5 days after the first
 * failure; once those are used it enters GRACE (plan.graceDays) and
 * enforceGracePeriods suspends it when that runs out.
 */
async function attemptOwnCharge(params: {
  subscriptionId: string
  invoiceId: string
  /** 1 for the first try, 2.. for retries. */
  attempt: number
  firstFailedAt: Date
  now: Date
}): Promise<{ success: boolean; reason?: string }> {
  const { now } = params
  const subscription = await prisma.subscription.findUnique({
    where: { id: params.subscriptionId },
    include: { property: true, plan: true, organization: true },
  })
  const invoice = await prisma.subscriptionInvoice.findUnique({
    where: { id: params.invoiceId },
  })
  if (!subscription || !invoice) return { success: false, reason: 'missing subscription or invoice' }
  const due = invoice.total - invoice.amountPaid
  if (due <= 0 || invoice.status === 'PAID') return { success: true }

  const demo = paymentMode() === 'demo'
  // The simulated debit settles invoices without money, so it runs only on a
  // demo deployment. Elsewhere a leftover demo mandate simply fails the
  // attempt, and the owner pays with Pay now before grace ends.
  const attempt = demoPaymentsAllowed()
    ? simulateAutopayDebit(params.attempt === 1 ? invoice.id : `${invoice.id}:${params.attempt}`)
    : { success: false as const, reason: 'AutoPay is not available on this deployment — please use Pay now' }

  if (attempt.success) {
    await prisma.$transaction(async (tx) => {
      await settleSubscriptionInvoice(tx, {
        invoiceId: invoice.id,
        amount: due,
        method: 'GATEWAY',
        provider: demo ? 'demo' : 'gateway',
        isDemo: demo,
        actor: { name: 'AutoPay' },
        now,
      })
      await tx.subscription.update({
        where: { id: subscription.id },
        data: {
          status: 'ACTIVE',
          graceEndsAt: null,
          failedAttempts: 0,
          nextRetryAt: null,
          lastPaymentError: null,
        },
      })
    })
    await notifyOrgAdmins(subscription.organizationId, {
      kind: 'SUBSCRIPTION',
      title: 'Subscription charged',
      body: `${formatMoney(due)} for ${subscription.property.name}. Invoice ${invoice.number}.`,
      link: '/app/subscription',
    })
    return { success: true }
  }

  const failedAttempts = params.attempt
  const retryAt = nextRetryAt(params.firstFailedAt, failedAttempts)
  const exhausted = retriesExhausted(failedAttempts) || !retryAt
  const status = nextStatus(subscription.status as SubStatus, {
    type: 'PAYMENT_FAILED',
    retriesLeft: !exhausted,
  })
  const graceEndsAt = exhausted ? addDays(now, subscription.plan.graceDays) : null

  await prisma.$transaction(async (tx) => {
    await tx.subscriptionPayment.create({
      data: {
        subscriptionId: subscription.id,
        invoiceId: invoice.id,
        amount: due,
        status: 'FAILED',
        method: 'GATEWAY',
        failureReason: attempt.reason,
        retryCount: failedAttempts - 1,
        gatewayProvider: demo ? 'demo' : 'gateway',
        isDemo: demo,
      },
    })
    await tx.subscription.update({
      where: { id: subscription.id },
      data: {
        status,
        failedAttempts,
        nextRetryAt: exhausted ? null : retryAt,
        lastPaymentError: attempt.reason ?? 'Payment failed',
        graceEndsAt,
      },
    })
    await tx.organization.updateMany({
      where: {
        id: subscription.organizationId,
        status: { in: ['TRIAL', 'ACTIVE'] },
      },
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
        summary: `${invoice.number} attempt ${failedAttempts} failed — ${attempt.reason}${
          exhausted ? ' · retries used, grace period started' : ''
        }`,
      },
      tx,
    )
  })

  await notifyOrgAdmins(subscription.organizationId, {
    kind: 'SUBSCRIPTION',
    title: exhausted ? 'Subscription payment failed — grace period started' : 'Subscription payment failed',
    body:
      exhausted && graceEndsAt
        ? `${attempt.reason}. Please pay ${invoice.number} before ${graceEndsAt.toLocaleDateString('en-IN')} to keep access.`
        : `${attempt.reason}. We will try again on ${retryAt?.toLocaleDateString('en-IN')}, or pay now from your subscription page.`,
    link: '/app/subscription',
  })
  if (failedAttempts === 1 || exhausted) {
    await notifySuperAdmins({
      kind: 'SUBSCRIPTION',
      title: 'Failed subscription payment',
      body: `${subscription.organization.name} — ${subscription.property.name}: ${attempt.reason} (attempt ${failedAttempts})`,
      link: '/admin/payments',
    })
  }
  return { success: false, reason: attempt.reason }
}

/** Retries our own failed charges whose retry date has arrived. */
export async function retryFailedCharges(now = new Date()) {
  const dueRetries = await prisma.subscription.findMany({
    where: { status: 'PAST_DUE', nextRetryAt: { lte: now } },
    select: { id: true, failedAttempts: true, nextRetryAt: true },
  })
  let recovered = 0
  let failed = 0
  for (const sub of dueRetries) {
    // Claim the retry so two overlapping runs do not both charge.
    const claim = await prisma.subscription.updateMany({
      where: { id: sub.id, nextRetryAt: sub.nextRetryAt },
      data: { nextRetryAt: null },
    })
    if (claim.count !== 1) continue
    const invoice = await prisma.subscriptionInvoice.findFirst({
      where: { subscriptionId: sub.id, status: { in: [...UNPAID_INVOICE] } },
      orderBy: { periodStart: 'asc' },
    })
    if (!invoice) {
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { failedAttempts: 0, lastPaymentError: null },
      })
      continue
    }
    // Retry offsets count from the first failure; recover it from the schedule.
    const offsetDays = RETRY_DAYS[sub.failedAttempts - 1] ?? 0
    const firstFailedAt = addDays(sub.nextRetryAt ?? now, -offsetDays)
    const outcome = await attemptOwnCharge({
      subscriptionId: sub.id,
      invoiceId: invoice.id,
      attempt: sub.failedAttempts + 1,
      firstFailedAt,
      now,
    })
    if (outcome.success) recovered++
    else failed++
  }
  return { retried: recovered + failed, recovered, failed }
}

/**
 * Moves overdue subscriptions along the lifecycle and suspends those whose
 * grace period has run out:
 *  - PAST_DUE with no retry pending and an invoice past its due date → GRACE
 *  - PAST_DUE / GRACE / ACTIVE (Razorpay AutoPay waiting for a charge) with an
 *    unpaid invoice and graceEndsAt passed → SUSPENDED (org suspended too).
 */
export async function enforceGracePeriods(now = new Date()) {
  const toGrace = await prisma.subscription.findMany({
    where: {
      status: 'PAST_DUE',
      nextRetryAt: null,
      invoices: {
        some: { status: { in: [...UNPAID_INVOICE] }, dueDate: { lt: now } },
      },
    },
    include: { plan: true, property: true },
  })
  for (const subscription of toGrace) {
    const graceEndsAt = subscription.graceEndsAt ?? addDays(now, subscription.plan.graceDays)
    const moved = await prisma.subscription.updateMany({
      where: { id: subscription.id, status: 'PAST_DUE' },
      data: {
        status: nextStatus('PAST_DUE', { type: 'GRACE_STARTED' }),
        graceEndsAt,
      },
    })
    if (moved.count === 1 && graceEndsAt > now) {
      await ownerBillingEvents.graceStarted(
        {
          id: subscription.id,
          organizationId: subscription.organizationId,
          propertyName: subscription.property.name,
          graceEndsAt,
        },
        now,
      )
    }
  }

  const expired = await prisma.subscription.findMany({
    where: {
      // ACTIVE is included for Razorpay AutoPay subscriptions: their invoice is
      // raised with a grace deadline while we wait for the charge webhook.
      status: { in: ['GRACE', 'PAST_DUE', 'ACTIVE'] },
      graceEndsAt: { lt: now },
      // Never suspend while one of our own retries is still scheduled.
      nextRetryAt: null,
      invoices: { some: { status: { in: [...UNPAID_INVOICE] } } },
    },
    include: { organization: true, property: true },
  })

  for (const subscription of expired) {
    await prisma.$transaction(async (tx) => {
      await tx.subscription.update({
        where: { id: subscription.id },
        data: {
          status: nextStatus(subscription.status as SubStatus, {
            type: 'GRACE_EXPIRED',
          }),
        },
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
    await ownerBillingEvents.suspended({
      id: subscription.id,
      organizationId: subscription.organizationId,
      propertyName: subscription.property.name,
      graceEndsAt: subscription.graceEndsAt,
    })
  }
  return { suspended: expired.length, graced: toGrace.length }
}

/** Marks a subscription invoice as paid manually (bank transfer, UPI, cash). */
export async function markSubscriptionInvoicePaid(params: {
  invoiceId: string
  method?: 'BANK_TRANSFER' | 'UPI' | 'CASH' | 'CARD'
  reference?: string
  actor: { id?: string; name: string }
}) {
  let due = 0
  const result = await prisma.$transaction(async (tx) => {
    const invoice = await tx.subscriptionInvoice.findUnique({
      where: { id: params.invoiceId },
      select: { status: true, total: true, amountPaid: true },
    })
    if (!invoice) throw new NotFoundError('Invoice not found')
    if (invoice.status === 'PAID') throw new ConflictError('This invoice is already paid')
    due = Math.max(0, invoice.total - invoice.amountPaid)
    // Same settle + reactivation path as Pay now and AutoPay charges.
    return settleSubscriptionInvoice(tx, {
      invoiceId: params.invoiceId,
      method: params.method ?? 'BANK_TRANSFER',
      provider: params.reference ? `manual:${params.reference.slice(0, 60)}` : 'manual',
      isDemo: paymentMode() === 'demo',
      actor: params.actor,
    })
  })
  if (!result.alreadyPaid) await notifyPaid(result.invoice, due, result.reactivated)
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
  /** processing: authorised, not captured yet — the payment.captured webhook settles it. */
  status: 'paid' | 'duplicate' | 'processing' | 'ignored'
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
  // Only captured money settles an invoice; an authorised payment can still be voided.
  if (payment.status === 'authorized') return { status: 'processing' }
  if (payment.status !== 'captured') {
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
  invoice: {
    id: string
    number: string
    subscriptionId: string
    subscription: { organizationId: string; property: { name: string } }
  },
  amount: number,
  reactivated: boolean,
) {
  // In-app + WhatsApp + email, once per invoice.
  await ownerBillingEvents.paymentReceived(
    invoice.subscription.organizationId,
    { id: invoice.id, number: invoice.number, subscriptionId: invoice.subscriptionId, propertyName: invoice.subscription.property.name },
    amount,
    reactivated,
  )
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
  if (!demoPaymentsAllowed()) throw new ConflictError(PAYMENT_NOT_SET_UP)
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
  if (payment.status && payment.status !== 'captured') {
    return { handled: false, note: `charged event with a ${payment.status} payment` }
  }
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
      await notifyPaid(result.invoice, amount, result.reactivated)
      return { handled: true, note: `settled ${result.invoice.number}` }
    } catch (error) {
      if (isUniqueViolation(error, ['gatewayPaymentId'])) return { handled: true, note: 'duplicate' }
      throw error
    }
  }
  return { handled: false, note: 'could not claim a billing cycle' }
}

/** When the last successful payment of a subscription was recorded. */
async function lastSuccessfulPaymentAt(subscriptionId: string) {
  const last = await prisma.subscriptionPayment.findFirst({
    where: { subscriptionId, status: 'SUCCESS' },
    orderBy: { paidAt: 'desc' },
    select: { paidAt: true },
  })
  return last?.paidAt ?? null
}

function eventTime(createdAt?: number) {
  return typeof createdAt === 'number' && createdAt > 0 ? new Date(createdAt * 1000) : null
}

async function handleSubscriptionTrouble(
  remote: RazorpaySubscription,
  kind: 'pending' | 'halted',
  eventCreatedAt: Date | null = null,
): Promise<WebhookResult> {
  const found = await subscriptionForRemote(remote)
  if (!found?.current) return { handled: false, note: 'not the current gateway subscription' }
  const { subscription } = found

  // Out of order: a charge that succeeded after this failure was reported
  // already settled things — never move the subscription backwards.
  if (
    isStaleFailureEvent({
      eventCreatedAt,
      lastSuccessAt: await lastSuccessfulPaymentAt(subscription.id),
    })
  ) {
    return {
      handled: false,
      note: `stale subscription.${kind} ignored (paid since)`,
    }
  }

  const graceEndsAt = subscription.graceEndsAt ?? addDays(new Date(), subscription.plan.graceDays)
  await prisma.subscription.update({
    where: { id: subscription.id },
    data: {
      status: nextStatus(subscription.status as SubStatus, {
        type: 'PAYMENT_FAILED',
        retriesLeft: kind === 'pending',
      }),
      graceEndsAt,
      lastPaymentError:
        kind === 'halted'
          ? 'AutoPay stopped after repeated failed charges'
          : 'AutoPay charge failed; Razorpay will retry',
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
  if (payment.status !== 'captured') return { handled: false, note: `payment is ${payment.status}` }
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
        if (!found?.current)
          return {
            handled: false,
            note: 'not the current gateway subscription',
          }
        // A late activation after the mandate was cancelled must not revive
        // it: ask Razorpay for the current state first.
        const fresh = await rzpFetchSubscription(creds, remote.id).catch(() => null)
        if (fresh && TERMINAL_SUBSCRIPTION_STATES.includes(fresh.status)) {
          return {
            handled: false,
            note: `stale ${name} ignored (gateway subscription is ${fresh.status})`,
          }
        }
        await activateMandate(found.subscription.id, fresh ?? remote)
        return { handled: true, note: 'mandate active' }
      }
      case 'subscription.charged':
        return handleSubscriptionCharged(remote, payment)
      case 'subscription.pending':
        return handleSubscriptionTrouble(remote, 'pending', eventTime(event.created_at))
      case 'subscription.halted':
        return handleSubscriptionTrouble(remote, 'halted', eventTime(event.created_at))
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
      return {
        handled: outcome.status === 'paid' || outcome.status === 'duplicate',
        note: outcome.reason ?? outcome.status,
      }
    }
    if (notes.invoiceId && notes.residentId && (!notes.kind || notes.kind === 'rent')) {
      return handleLegacyRentPayment(payment, notes)
    }
    return { handled: false, note: 'payment not for StayFlow invoices' }
  }

  if ((name === 'refund.processed' || name === 'payment.refunded') && (payment?.id || event.payload?.refund?.entity)) {
    return flagPlatformRefund(event)
  }

  if (name === 'payment.failed' && payment?.id) {
    const notes = notesOf(payment)
    if (notes.kind === 'subscription_invoice' && notes.invoiceId) {
      const invoice = await prisma.subscriptionInvoice.findUnique({
        where: { id: notes.invoiceId },
        include: { subscription: true },
      })
      // A failure reported after the invoice was paid (out of order) changes nothing.
      if (invoice && invoice.status === 'PAID') {
        return {
          handled: false,
          note: 'stale payment.failed ignored (invoice already paid)',
        }
      }
      if (invoice) {
        await prisma.subscription.update({
          where: { id: invoice.subscriptionId },
          data: {
            lastPaymentError: payment.error_description?.slice(0, 300) ?? 'Payment failed',
          },
        })
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
 * @deprecated use assertWithinPlan (services/plan-limits). Kept for existing
 * callers: throws a 402 PlanLimitError when one more property / resident
 * would exceed the organization's plan.
 */
export async function assertPlanCapacity(organizationId: string, kind: 'property' | 'resident') {
  await assertWithinPlan(organizationId, kind === 'property' ? 'properties' : 'residents')
}

// --------------------------------------------------------------------------
// Owner lifecycle: upgrade / downgrade / cycle switch / cancel / resume
// --------------------------------------------------------------------------

type Actor = { id?: string; name: string; role?: UserRole }

const OWNER_CYCLES: BillingCycle[] = ['MONTHLY', 'YEARLY']

async function loadOwnedSubscription(subscriptionId: string, organizationId?: string) {
  const subscription = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: {
      plan: true,
      property: true,
      organization: {
        select: { id: true, name: true, gstin: true, state: true },
      },
    },
  })
  if (!subscription || (organizationId && subscription.organizationId !== organizationId)) {
    throw new NotFoundError('Subscription not found')
  }
  return subscription
}

function snapshot(s: {
  status: string
  planId: string
  amount: number
  billingCycle: string
  trialEndsAt: Date | null
  nextBillingDate: Date
  graceEndsAt: Date | null
  cancelAtPeriodEnd: boolean
  pendingPlanId: string | null
  pendingBillingCycle: string | null
  cancelledAt: Date | null
}) {
  return {
    status: s.status,
    planId: s.planId,
    amount: s.amount,
    billingCycle: s.billingCycle,
    trialEndsAt: s.trialEndsAt?.toISOString() ?? null,
    nextBillingDate: s.nextBillingDate.toISOString(),
    graceEndsAt: s.graceEndsAt?.toISOString() ?? null,
    cancelAtPeriodEnd: s.cancelAtPeriodEnd,
    pendingPlanId: s.pendingPlanId,
    pendingBillingCycle: s.pendingBillingCycle,
    cancelledAt: s.cancelledAt?.toISOString() ?? null,
  }
}

export type ChangePreview = {
  kind: 'upgrade' | 'downgrade' | 'cycle' | 'clear' | 'none'
  effective: 'now' | 'period_end'
  currentPlan: { id: string; name: string }
  targetPlan: { id: string; name: string }
  currentCycle: BillingCycle
  targetCycle: BillingCycle
  targetMonthly: number
  /** Charged today (prorated upgrade), GST included. */
  dueNow: {
    taxable: number
    tax: number
    total: number
    remainingDays: number
    totalDays: number
  }
  /** The next renewal after this change. */
  nextCharge: { date: string; taxable: number; tax: number; total: number }
  blockers: string[]
  notes: string[]
}

/**
 * What a plan and/or cycle change would do, without doing it: upgrades take
 * effect now with the price difference for the rest of the period invoiced
 * today; downgrades and cycle switches wait for the period end. A plan whose
 * limits are below current usage is refused (blockers).
 */
export async function previewSubscriptionChange(params: {
  subscriptionId: string
  organizationId?: string
  planId?: string
  billingCycle?: BillingCycle
  now?: Date
}): Promise<ChangePreview> {
  const now = params.now ?? new Date()
  const subscription = await loadOwnedSubscription(params.subscriptionId, params.organizationId)
  if (subscription.status === 'CANCELLED') throw new ConflictError('This subscription is cancelled')

  const targetPlan = params.planId
    ? await prisma.plan.findUnique({ where: { id: params.planId } })
    : subscription.plan
  if (!targetPlan) throw new NotFoundError('Plan not found')
  if (!targetPlan.active && targetPlan.id !== subscription.planId) {
    throw new ValidationError('That plan is no longer offered')
  }
  const targetCycle = params.billingCycle ?? subscription.pendingBillingCycle ?? subscription.billingCycle
  if (params.billingCycle && !OWNER_CYCLES.includes(params.billingCycle)) {
    throw new ValidationError('Choose monthly or yearly billing')
  }

  const planChange = targetPlan.id !== subscription.planId
  const cycleChange = targetCycle !== subscription.billingCycle
  const targetMonthly = planChange
    ? (await priceForProperty(subscription.property, targetPlan)).amount
    : subscription.amount
  const trial = subscription.status === 'TRIALING'
  const upgrade = planChange && targetMonthly >= subscription.amount

  const blockers: string[] = []
  const notes: string[] = []
  if (planChange) {
    // Limits after the move: the target plan plus the org's other live plans.
    const others = await prisma.subscription.findMany({
      where: {
        organizationId: subscription.organizationId,
        status: { not: 'CANCELLED' },
        id: { not: subscription.id },
      },
      select: {
        plan: {
          select: {
            name: true,
            maxProperties: true,
            maxBeds: true,
            maxResidents: true,
            maxStaff: true,
          },
        },
      },
    })
    const after: PlanLimits[] = [...others.map((o) => o.plan), targetPlan]
    const usage = await countUsage(subscription.organizationId)
    for (const b of downgradeBlockers(usage, after)) blockers.push(b.message)
  }

  const gst = (taxable: number) => {
    const g = subscriptionGst(subscription.organization, taxable)
    return { taxable: g.taxable, tax: g.tax, total: g.total }
  }

  // Due now: only an upgrade outside the trial is charged immediately.
  let dueNow = { ...gst(0), remainingDays: 0, totalDays: 0 }
  if (upgrade && !trial) {
    const currentPerCycle = cyclePrice(
      subscription.amount,
      subscription.billingCycle,
      subscription.plan.yearlyDiscountPercent,
    )
    const targetPerCycle = cyclePrice(
      targetMonthly,
      subscription.billingCycle,
      targetPlan.yearlyDiscountPercent,
    )
    const p = prorate({
      currentCyclePrice: currentPerCycle,
      targetCyclePrice: targetPerCycle,
      periodStart: subscription.currentPeriodStart,
      periodEnd: subscription.currentPeriodEnd,
      now,
    })
    dueNow = {
      ...gst(p.amount),
      remainingDays: p.remainingDays,
      totalDays: p.totalDays,
    }
    if (p.amount > 0) {
      notes.push(
        `You pay the difference for the ${p.remainingDays} day${p.remainingDays === 1 ? '' : 's'} left in this period today.`,
      )
    }
  }

  // The plan in force at the next renewal: the target, else a downgrade
  // already scheduled, else the current plan.
  let nextMonthly = targetMonthly
  let nextDiscount = targetPlan.yearlyDiscountPercent
  if (!planChange && subscription.pendingPlanId && params.planId === undefined) {
    const pending = await prisma.plan.findUnique({
      where: { id: subscription.pendingPlanId },
    })
    if (pending) {
      nextMonthly = (await priceForProperty(subscription.property, pending)).amount
      nextDiscount = pending.yearlyDiscountPercent
    }
  }
  const nextTaxable = cyclePrice(nextMonthly, targetCycle, nextDiscount)

  const kind: ChangePreview['kind'] = planChange
    ? upgrade
      ? 'upgrade'
      : 'downgrade'
    : cycleChange
      ? 'cycle'
      : subscription.pendingPlanId || subscription.pendingBillingCycle
        ? 'clear'
        : 'none'
  const effective = trial || kind === 'upgrade' ? 'now' : 'period_end'

  if (trial)
    notes.push(
      'You are on a free trial, so the change applies now and nothing is charged until the trial ends.',
    )
  if (kind === 'downgrade') notes.push(`${targetPlan.name} starts when your current period ends.`)
  if (cycleChange && !trial) notes.push(`${CYCLE_LABEL[targetCycle]} billing starts at your next renewal.`)
  if (kind === 'clear') notes.push('Your scheduled change will be cancelled; you stay as you are.')
  if (
    kind !== 'none' &&
    subscription.mandateStatus === 'ACTIVE' &&
    subscription.gatewaySubscriptionId &&
    paymentMode() === 'live'
  ) {
    notes.push('AutoPay was authorised for the old amount, so you will be asked to set it up again.')
  }

  return {
    kind,
    effective,
    currentPlan: { id: subscription.plan.id, name: subscription.plan.name },
    targetPlan: { id: targetPlan.id, name: targetPlan.name },
    currentCycle: subscription.billingCycle,
    targetCycle,
    targetMonthly,
    dueNow,
    nextCharge: {
      date: subscription.nextBillingDate.toISOString(),
      ...gst(nextTaxable),
    },
    blockers,
    notes,
  }
}

/** Applies a previewed change. Same rules as previewSubscriptionChange. */
export async function changeSubscription(params: {
  subscriptionId: string
  organizationId?: string
  planId?: string
  billingCycle?: BillingCycle
  actor: Actor
  now?: Date
}) {
  const now = params.now ?? new Date()
  const preview = await previewSubscriptionChange({ ...params, now })
  if (preview.blockers.length) {
    throw new ValidationError(
      `You can't move to ${preview.targetPlan.name} yet. ${preview.blockers.join(' ')} Remove the extra first.`,
    )
  }
  if (preview.kind === 'none') return { preview, invoice: null, message: 'Nothing to change' }

  const subscription = await loadOwnedSubscription(params.subscriptionId, params.organizationId)
  const before = snapshot(subscription)
  const trial = subscription.status === 'TRIALING'
  const planChange = preview.targetPlan.id !== subscription.planId
  const cycleChange = preview.targetCycle !== subscription.billingCycle

  const data: Prisma.SubscriptionUpdateInput = {}
  if (trial) {
    // Nothing has been paid: everything applies now.
    data.plan = { connect: { id: preview.targetPlan.id } }
    data.amount = preview.targetMonthly
    data.billingCycle = preview.targetCycle
    data.pendingPlanId = null
    data.pendingBillingCycle = null
  } else {
    if (preview.kind === 'upgrade') {
      data.plan = { connect: { id: preview.targetPlan.id } }
      data.amount = preview.targetMonthly
      data.pendingPlanId = null
    } else if (preview.kind === 'downgrade') {
      data.pendingPlanId = preview.targetPlan.id
    } else if (!planChange) {
      data.pendingPlanId = null
    }
    data.pendingBillingCycle = cycleChange ? preview.targetCycle : null
  }

  const invoice = await retryOnUniqueConflict(
    () =>
      prisma.$transaction(async (tx) => {
        await tx.subscription.update({ where: { id: subscription.id }, data })
        let raised = null
        if (!trial && preview.kind === 'upgrade' && preview.dueNow.taxable > 0) {
          const number = await nextSubInvoiceNumber(tx, now)
          raised = await tx.subscriptionInvoice.create({
            data: {
              subscriptionId: subscription.id,
              number,
              periodStart: now,
              periodEnd: subscription.currentPeriodEnd,
              issueDate: now,
              dueDate: startOfDay(addDays(now, 3)),
              amount: preview.dueNow.taxable,
              tax: preview.dueNow.tax,
              total: preview.dueNow.total,
              status: 'PENDING',
            },
          })
          // An unpaid upgrade invoice follows the normal grace rules.
          if (!subscription.graceEndsAt) {
            await tx.subscription.update({
              where: { id: subscription.id },
              data: { graceEndsAt: addDays(now, subscription.plan.graceDays) },
            })
          }
        }
        const after = await tx.subscription.findUniqueOrThrow({
          where: { id: subscription.id },
        })
        await recordActivity(
          {
            organizationId: subscription.organizationId,
            propertyId: subscription.propertyId,
            actorId: params.actor.id,
            actorName: params.actor.name,
            event: 'SUBSCRIPTION_CHANGED',
            entityType: 'Subscription',
            entityId: subscription.id,
            summary: `${subscription.property.name}: ${describeChange(preview)}${
              raised ? ` · ${raised.number} ${formatMoney(raised.total)} due now` : ''
            }`,
            before,
            after: snapshot(after),
          },
          tx,
        )
        return raised
      }),
    ['number'],
  )

  // The amount each charge collects changed now (upgrade / trial switch):
  // a live mandate for the old amount must be re-authorised.
  if (data.amount !== undefined || (trial && cycleChange)) {
    await stopMandateForNewAmount(subscription.id).catch((error) =>
      console.error('[subscriptions] could not stop mandate after change', error),
    )
  }

  return { preview, invoice, message: describeChange(preview) }
}

function describeChange(p: ChangePreview) {
  switch (p.kind) {
    case 'upgrade':
      return `Upgraded to ${p.targetPlan.name}`
    case 'downgrade':
      return p.effective === 'now'
        ? `Moved to ${p.targetPlan.name}`
        : `${p.targetPlan.name} scheduled from the next renewal`
    case 'cycle':
      return p.effective === 'now'
        ? `${CYCLE_LABEL[p.targetCycle]} billing set`
        : `${CYCLE_LABEL[p.targetCycle]} billing scheduled from the next renewal`
    case 'clear':
      return 'Scheduled change cancelled'
    default:
      return 'No change'
  }
}

/** Ends a subscription now: CANCELLED, mandate stopped, org cancelled when nothing live remains. */
async function finaliseCancellation(subscriptionId: string, actor: Actor, now = new Date()) {
  const subscription = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: { property: true },
  })
  if (!subscription || subscription.status === 'CANCELLED') return subscription
  const before = snapshot(subscription)

  if (subscription.gatewaySubscriptionId || subscription.autopayEnabled) {
    await cancelAutopay(subscription.id).catch((error) =>
      console.error('[subscriptions] could not stop AutoPay on cancellation', error),
    )
  }

  const updated = await prisma.$transaction(async (tx) => {
    const after = await tx.subscription.update({
      where: { id: subscription.id },
      data: {
        status: nextStatus(subscription.status as SubStatus, {
          type: 'CANCELLED',
        }),
        cancelledAt: now,
        cancelAtPeriodEnd: false,
        pendingPlanId: null,
        pendingBillingCycle: null,
        nextRetryAt: null,
        graceEndsAt: null,
      },
    })
    const live = await tx.subscription.count({
      where: {
        organizationId: subscription.organizationId,
        status: { not: 'CANCELLED' },
      },
    })
    if (live === 0) {
      await tx.organization.update({
        where: { id: subscription.organizationId },
        data: { status: 'CANCELLED' },
      })
    }
    await recordActivity(
      {
        organizationId: subscription.organizationId,
        propertyId: subscription.propertyId,
        actorId: actor.id,
        actorName: actor.name,
        event: 'SUBSCRIPTION_CANCELLED',
        entityType: 'Subscription',
        entityId: subscription.id,
        summary: `${subscription.property.name}: subscription cancelled${
          subscription.cancelCategory ? ` (${categoryLabel(subscription.cancelCategory)})` : ''
        }`,
        meta: {
          category: subscription.cancelCategory,
          reason: subscription.cancelReason,
        },
        before,
        after: snapshot(after),
      },
      tx,
    )
    return after
  })
  await notifyOrgAdmins(subscription.organizationId, {
    kind: 'SUBSCRIPTION',
    title: 'Subscription cancelled',
    body: `${subscription.property.name}'s StayFlow subscription has ended. You can reactivate it any time from the subscription page.`,
    link: '/app/subscription',
  })
  return updated
}

function categoryLabel(value: string) {
  return CANCEL_CATEGORIES.find((c) => c.value === value)?.label ?? value
}

/** Owner cancel: now, or at the end of the paid period (with reason + category). */
export async function cancelSubscription(params: {
  subscriptionId: string
  organizationId?: string
  when: 'now' | 'period_end'
  category: CancelCategory
  reason?: string
  actor: Actor
}) {
  const subscription = await loadOwnedSubscription(params.subscriptionId, params.organizationId)
  if (subscription.status === 'CANCELLED') throw new ConflictError('This subscription is already cancelled')

  await prisma.subscription.update({
    where: { id: subscription.id },
    data: {
      cancelCategory: params.category,
      cancelReason: params.reason?.slice(0, 500) || null,
    },
  })

  if (params.when === 'now') {
    await finaliseCancellation(subscription.id, params.actor)
    return {
      message: `${subscription.property.name}'s subscription is cancelled`,
    }
  }

  const before = snapshot(subscription)
  const after = await prisma.subscription.update({
    where: { id: subscription.id },
    data: {
      cancelAtPeriodEnd: true,
      pendingPlanId: null,
      pendingBillingCycle: null,
    },
  })
  await recordActivity({
    organizationId: subscription.organizationId,
    propertyId: subscription.propertyId,
    actorId: params.actor.id,
    actorName: params.actor.name,
    event: 'SUBSCRIPTION_CANCELLED',
    entityType: 'Subscription',
    entityId: subscription.id,
    summary: `${subscription.property.name}: cancellation scheduled for ${after.nextBillingDate.toLocaleDateString('en-IN')} (${categoryLabel(params.category)})`,
    meta: {
      category: params.category,
      reason: params.reason ?? null,
      atPeriodEnd: true,
    },
    before,
    after: snapshot(after),
  })
  return {
    message: `${subscription.property.name} stays active until ${after.nextBillingDate.toLocaleDateString('en-IN')}, then ends`,
  }
}

/** Undo a scheduled cancellation before the period ends. */
export async function resumeSubscription(params: {
  subscriptionId: string
  organizationId?: string
  actor: Actor
}) {
  const subscription = await loadOwnedSubscription(params.subscriptionId, params.organizationId)
  if (subscription.status === 'CANCELLED') {
    throw new ConflictError('This subscription has already ended — ask StayFlow support to reactivate it')
  }
  if (!subscription.cancelAtPeriodEnd) throw new ConflictError('No cancellation is scheduled')
  const before = snapshot(subscription)
  const after = await prisma.subscription.update({
    where: { id: subscription.id },
    data: {
      cancelAtPeriodEnd: false,
      cancelCategory: null,
      cancelReason: null,
    },
  })
  await recordActivity({
    organizationId: subscription.organizationId,
    propertyId: subscription.propertyId,
    actorId: params.actor.id,
    actorName: params.actor.name,
    event: 'SUBSCRIPTION_CHANGED',
    entityType: 'Subscription',
    entityId: subscription.id,
    summary: `${subscription.property.name}: scheduled cancellation withdrawn`,
    before,
    after: snapshot(after),
  })
  return { message: `${subscription.property.name} will keep renewing` }
}

// --------------------------------------------------------------------------
// Super Admin actions — every one audited (ADMIN_ACTION, before/after)
// --------------------------------------------------------------------------

export type AdminSubscriptionAction =
  | { action: 'EXTEND_TRIAL'; days: number }
  | { action: 'APPLY_CREDIT'; amount: number; note?: string }
  | { action: 'CANCEL'; reason?: string }
  | { action: 'REACTIVATE' }

export async function adminSubscriptionAction(params: {
  subscriptionId: string
  input: AdminSubscriptionAction
  actor: Actor
  now?: Date
}): Promise<{ message: string }> {
  const now = params.now ?? new Date()
  const subscription = await loadOwnedSubscription(params.subscriptionId)
  const before = snapshot(subscription)
  const input = params.input
  let message = ''

  if (input.action === 'EXTEND_TRIAL') {
    const paidBefore = await prisma.subscriptionInvoice.count({
      where: { subscriptionId: subscription.id, status: 'PAID' },
    })
    if (subscription.status !== 'TRIALING' && paidBefore > 0) {
      throw new ConflictError('This PG has already paid — apply a credit instead of extending the trial')
    }
    if (subscription.status === 'CANCELLED') throw new ConflictError('Reactivate the subscription first')
    const base = subscription.trialEndsAt && subscription.trialEndsAt > now ? subscription.trialEndsAt : now
    const trialEndsAt = addDays(base, input.days)
    await prisma.$transaction(async (tx) => {
      // A trial that lapsed unpaid: its open invoices are withdrawn.
      await tx.subscriptionInvoice.updateMany({
        where: {
          subscriptionId: subscription.id,
          status: { in: [...UNPAID_INVOICE] },
          amountPaid: 0,
        },
        data: { status: 'CANCELLED' },
      })
      await tx.subscription.update({
        where: { id: subscription.id },
        data: {
          status: nextStatus(subscription.status as SubStatus, {
            type: 'TRIAL_EXTENDED',
          }),
          trialEndsAt,
          nextBillingDate: trialEndsAt,
          graceEndsAt: null,
          failedAttempts: 0,
          nextRetryAt: null,
          lastPaymentError: null,
        },
      })
      await reactivateOrganizationIfClear(tx, subscription.organizationId, now)
    })
    message = `Trial extended to ${trialEndsAt.toLocaleDateString('en-IN')}`
  } else if (input.action === 'APPLY_CREDIT') {
    const open = await prisma.subscriptionInvoice.findMany({
      where: {
        subscriptionId: subscription.id,
        status: { in: [...UNPAID_INVOICE] },
      },
      orderBy: { periodStart: 'asc' },
    })
    const outstanding = open.reduce((sum, i) => sum + (i.total - i.amountPaid), 0)
    if (!open.length) throw new ConflictError('There is no open invoice to apply a credit to')
    if (input.amount > outstanding) {
      throw new ValidationError(`The credit is more than what is owed (${formatMoney(outstanding)})`)
    }
    let left = input.amount
    await prisma.$transaction(async (tx) => {
      for (const invoice of open) {
        if (left <= 0) break
        const portion = Math.min(left, invoice.total - invoice.amountPaid)
        await settleSubscriptionInvoice(tx, {
          invoiceId: invoice.id,
          amount: portion,
          method: 'ADJUSTMENT',
          provider: `credit${input.note ? `:${input.note.slice(0, 60)}` : ''}`,
          isDemo: false,
          actor: params.actor,
          now,
        })
        left -= portion
      }
    })
    message = `${formatMoney(input.amount)} credit applied`
  } else if (input.action === 'CANCEL') {
    if (subscription.status === 'CANCELLED') throw new ConflictError('Already cancelled')
    if (input.reason) {
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          cancelReason: input.reason.slice(0, 500),
          cancelCategory: 'OTHER',
        },
      })
    }
    await finaliseCancellation(subscription.id, params.actor, now)
    message = 'Subscription cancelled'
  } else {
    if (
      subscription.status !== 'CANCELLED' &&
      subscription.status !== 'SUSPENDED' &&
      !subscription.cancelAtPeriodEnd
    ) {
      throw new ConflictError('This subscription is already live')
    }
    const unpaid = await prisma.subscriptionInvoice.count({
      where: {
        subscriptionId: subscription.id,
        status: { in: [...UNPAID_INVOICE] },
      },
    })
    if (subscription.status !== 'CANCELLED' && subscription.status !== 'SUSPENDED') {
      // Only a scheduled cancellation to withdraw.
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          cancelAtPeriodEnd: false,
          cancelCategory: null,
          cancelReason: null,
        },
      })
    } else {
      const status =
        subscription.status === 'SUSPENDED'
          ? // An admin override: access back now with a fresh grace period.
            'GRACE'
          : nextStatus(subscription.status as SubStatus, {
              type: 'REACTIVATED',
              paidUp: unpaid === 0,
            })
      await prisma.$transaction(async (tx) => {
        await tx.subscription.update({
          where: { id: subscription.id },
          data: {
            status,
            cancelledAt: null,
            cancelAtPeriodEnd: false,
            cancelCategory: null,
            cancelReason: null,
            graceEndsAt: status === 'ACTIVE' ? null : addDays(now, subscription.plan.graceDays),
            // A period that ended while cancelled is billed afresh from today.
            ...(subscription.nextBillingDate < now ? { nextBillingDate: now } : {}),
          },
        })
        await tx.organization.updateMany({
          where: {
            id: subscription.organizationId,
            status: { in: ['CANCELLED', 'SUSPENDED'] },
          },
          data: { status: status === 'ACTIVE' ? 'ACTIVE' : 'PAST_DUE' },
        })
      })
    }
    message = 'Subscription reactivated'
  }

  const after = await prisma.subscription.findUniqueOrThrow({
    where: { id: subscription.id },
  })
  await recordActivity({
    organizationId: subscription.organizationId,
    propertyId: subscription.propertyId,
    actorId: params.actor.id,
    actorName: params.actor.name,
    actorRole: params.actor.role ?? 'SUPER_ADMIN',
    event: 'ADMIN_ACTION',
    entityType: 'Subscription',
    entityId: subscription.id,
    summary: `${subscription.organization.name} — ${subscription.property.name}: ${message}`,
    meta: {
      action: input.action,
      ...('days' in input ? { days: input.days } : {}),
      ...('amount' in input ? { amount: input.amount } : {}),
    },
    before,
    after: snapshot(after),
  })
  if (input.action !== 'CANCEL') {
    await notifyOrgAdmins(subscription.organizationId, {
      kind: 'SUBSCRIPTION',
      title: 'Your StayFlow subscription was updated',
      body: `${subscription.property.name}: ${message}.`,
      link: '/app/subscription',
    })
  }
  return { message }
}

/** Audit wrapper for the admin "mark invoice paid" action. */
export async function adminMarkInvoicePaid(params: {
  invoiceId: string
  method?: 'BANK_TRANSFER' | 'UPI' | 'CASH' | 'CARD'
  reference?: string
  actor: Actor
}) {
  const before = await prisma.subscriptionInvoice.findUnique({
    where: { id: params.invoiceId },
    include: {
      subscription: {
        select: { organizationId: true, propertyId: true, status: true },
      },
    },
  })
  if (!before) throw new NotFoundError('Invoice not found')
  const invoice = await markSubscriptionInvoicePaid(params)
  const sub = await prisma.subscription.findUnique({
    where: { id: before.subscriptionId },
    select: { status: true },
  })
  await recordActivity({
    organizationId: before.subscription.organizationId,
    propertyId: before.subscription.propertyId,
    actorId: params.actor.id,
    actorName: params.actor.name,
    actorRole: params.actor.role ?? 'SUPER_ADMIN',
    event: 'ADMIN_ACTION',
    entityType: 'SubscriptionInvoice',
    entityId: before.id,
    summary: `${before.number} marked paid by StayFlow (${params.method ?? 'BANK_TRANSFER'}${params.reference ? ` · ${params.reference}` : ''})`,
    meta: { action: 'MARK_PAID' },
    before: {
      invoiceStatus: before.status,
      amountPaid: before.amountPaid,
      subscriptionStatus: before.subscription.status,
    },
    after: {
      invoiceStatus: 'PAID',
      amountPaid: invoice.total,
      subscriptionStatus: sub?.status ?? null,
    },
  })
  return invoice
}

// --------------------------------------------------------------------------
// Webhook replay (nightly): FAILED Razorpay events get another go
// --------------------------------------------------------------------------

export async function replayFailedWebhooks() {
  const rows = await failedWebhooks('razorpay')
  let processed = 0
  let failed = 0
  for (const row of rows) {
    if (!(await reclaimFailedWebhook(row.id))) continue
    const payload = (row.payload ?? {}) as RazorpayWebhookEvent & {
      _stayflowOrgId?: string
    }
    try {
      let result: WebhookResult
      if (payload._stayflowOrgId) {
        const creds = await getOrgRazorpay(payload._stayflowOrgId)
        result = creds
          ? await handleOrgWebhook(payload._stayflowOrgId, creds, payload)
          : { handled: false, note: 'Razorpay no longer connected' }
      } else {
        result = await handlePlatformWebhook(payload)
      }
      await finishWebhook(row.id, {
        status: result.handled ? 'PROCESSED' : 'IGNORED',
        error: result.handled ? null : result.note,
      })
      processed++
    } catch (error) {
      await finishWebhook(row.id, {
        status: 'FAILED',
        error: error instanceof Error ? error.message : String(error),
      })
      failed++
    }
  }
  return { processed, failed }
}

/**
 * A refund made on the PLATFORM Razorpay account (a subscription payment).
 * Subscription money is never changed automatically: the refund is recorded in
 * the audit log and Super Admins are asked to adjust the invoice by hand.
 * Duplicate deliveries are stopped by the webhook event log.
 */
async function flagPlatformRefund(event: RazorpayWebhookEvent): Promise<WebhookResult> {
  const refund = event.payload?.refund?.entity
  const paymentId = refund?.payment_id ?? event.payload?.payment?.entity?.id ?? null
  if (!paymentId) return { handled: false, note: 'refund event without a payment id' }
  const local = await prisma.subscriptionPayment.findUnique({
    where: { gatewayPaymentId: paymentId },
    include: { subscription: { select: { organizationId: true, propertyId: true } }, invoice: { select: { number: true } } },
  })
  if (!local) return { handled: false, note: 'refund for a payment StayFlow did not record' }
  const amount = fromPaise(refund?.amount ?? event.payload?.payment?.entity?.amount_refunded ?? 0)
  await recordActivity({
    organizationId: local.subscription.organizationId,
    propertyId: local.subscription.propertyId,
    actorName: 'Razorpay',
    event: 'ADMIN_ACTION',
    entityType: 'SubscriptionPayment',
    entityId: local.id,
    summary: `Razorpay refunded ${formatMoney(amount)} of subscription payment ${paymentId}${local.invoice ? ` (${local.invoice.number})` : ''}${refund?.id ? ` — ${refund.id}` : ''}. Adjust the invoice by hand.`,
    meta: { paymentId, refundId: refund?.id ?? null, amount, needsReview: true },
  })
  await notifySuperAdmins({
    kind: 'SUBSCRIPTION',
    title: 'Subscription refund needs review',
    body: `${formatMoney(amount)} refunded on Razorpay for payment ${paymentId}${local.invoice ? ` (${local.invoice.number})` : ''}.`,
    link: '/admin/payments',
  }).catch(() => undefined)
  return { handled: true, note: 'refund flagged for review' }
}
