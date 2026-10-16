import 'server-only'

import { Prisma, type UserRole } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/tenancy'
import { addDays, formatMoney, startOfDay } from '@/lib/utils'
import {
  AUTOPAY_METHODS,
  chargeAmount,
  isDueForCharge,
  mandateStatusFromToken,
  METHOD_LABEL,
  nextRetry,
  planNotices,
  RAZORPAY_METHOD,
  type AutopayMethod,
} from '@/lib/autopay'
import { groupBills, ownerAutopayLimit, OWNER_METHOD_CEILING } from '@/lib/owner-autopay'
import { cyclePrice } from '@/lib/subscription-math'
import { notifyOrgAdmins, notifySuperAdmins, recordActivity } from '@/server/events'
import { demoPaymentsAllowed, platformRazorpay, simulateAutopayDebit, verifyPaymentSignature } from '@/server/integrations/payments'
import {
  cancelToken,
  createCustomer,
  createMandateOrder,
  createRecurringOrder,
  createRecurringPayment,
  fetchCustomerTokens,
  fetchOrder,
  fetchPayment,
  fromPaise,
  notesOf,
  RazorpayError,
  toPaise,
  type RazorpayCredentials,
  type RazorpayPayment,
  type RazorpayWebhookEvent,
} from '@/server/integrations/razorpay'
import { isUniqueViolation } from './billing'
import { ownerBillingEvents } from './owner-billing'
import { settleBill, subscriptionGst } from './subscriptions'

/**
 * Owner AutoPay: one mandate per owner for the combined StayFlow bill, on the
 * PLATFORM Razorpay account (recurring payments, debited "as presented").
 *
 *   owner approves once        → OwnerMandate PENDING → ACTIVE (token confirmed)
 *   day before the due day     → OwnerAutopayAttempt NOTIFIED + pre-debit notice
 *   due day                    → INITIATED: an order + a recurring payment for the
 *                                bill's balance (never above the notice or the limit)
 *   payment.captured webhook   → every line of the bill is settled once (settleBill)
 *   payment.failed             → FAILED; retried on the next days, then the owner is
 *                                told to pay with Pay now before the late fee
 *
 * Demo deployments get a labelled demo mandate; its debits are simulated and
 * every payment row is flagged isDemo.
 */

const LIVE = ['PENDING', 'ACTIVE', 'PAUSED'] as const
const UNPAID = ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] as const
/** UPI and card approvals need a real ₹1 payment; an eMandate approves for ₹0. */
const AUTH_AMOUNT_PAISE: Record<AutopayMethod, number> = { UPI: 100, CARD: 100, EMANDATE: 0 }
const MANDATE_YEARS = 10
/** Failed debits are retried on this many following days before the owner is asked to pay. */
const RETRY_DAYS = 2

type Actor = { id?: string | null; name: string; role?: UserRole | null }

const dateLabel = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

/** How AutoPay can run here: real Razorpay, a labelled demo, or not at all. */
function gateway(): { mode: 'live'; creds: RazorpayCredentials } | { mode: 'demo' } | { mode: 'off' } {
  const creds = platformRazorpay()
  if (creds) return { mode: 'live', creds }
  return demoPaymentsAllowed() ? { mode: 'demo' } : { mode: 'off' }
}

/** What the owner's next combined bill comes to (every live PG, with GST). */
export async function nextBillEstimate(organizationId: string) {
  const [subs, org] = await Promise.all([
    prisma.subscription.findMany({
      where: { organizationId, status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE', 'GRACE', 'SUSPENDED'] }, cancelAtPeriodEnd: false },
      include: { plan: { select: { yearlyDiscountPercent: true } } },
    }),
    prisma.organization.findUnique({ where: { id: organizationId }, select: { gstin: true, state: true } }),
  ])
  return subs.reduce(
    (sum, s) => sum + subscriptionGst(org ?? {}, cyclePrice(s.amount, s.pendingBillingCycle ?? s.billingCycle, s.plan.yearlyDiscountPercent)).total,
    0,
  )
}

// --------------------------------------------------------------------------
// Owner view
// --------------------------------------------------------------------------

export async function ownerAutopayStatus(organizationId: string) {
  const g = gateway()
  const nextBill = await nextBillEstimate(organizationId)
  const mandate = await prisma.ownerMandate.findFirst({
    where: { organizationId, status: { in: [...LIVE, 'FAILED'] } },
    orderBy: { createdAt: 'desc' },
    include: { attempts: { orderBy: { createdAt: 'desc' }, take: 6 } },
  })
  const upcoming = mandate?.attempts.find((a) => a.status === 'NOTIFIED' || a.status === 'INITIATED') ?? null
  return {
    mode: g.mode,
    nextBill,
    methods: AUTOPAY_METHODS.map((m) => ({
      key: m,
      label: METHOD_LABEL[m],
      limit: ownerAutopayLimit(nextBill, m),
      ceiling: OWNER_METHOD_CEILING[m],
    })),
    mandate: mandate
      ? {
          id: mandate.id,
          status: mandate.status,
          method: mandate.method as AutopayMethod,
          methodLabel: METHOD_LABEL[mandate.method as AutopayMethod] ?? mandate.method,
          maxAmount: mandate.maxAmount,
          isDemo: mandate.isDemo,
          authorizedAt: mandate.authorizedAt,
          lastError: mandate.lastError,
          /** The bill has grown past the approved limit: AutoPay will skip it. */
          overLimit: nextBill > mandate.maxAmount,
        }
      : null,
    upcoming: upcoming ? { amount: upcoming.amount, chargeDate: upcoming.chargeDate, status: upcoming.status } : null,
    attempts: (mandate?.attempts ?? []).map((a) => ({
      id: a.id,
      amount: a.amount,
      chargeDate: a.chargeDate,
      status: a.status,
      error: a.error,
      attemptNumber: a.attemptNumber,
    })),
  }
}

// --------------------------------------------------------------------------
// Setup, confirmation and cancellation
// --------------------------------------------------------------------------

/**
 * Starts the owner's mandate. Live: a Razorpay customer, a PENDING mandate and
 * the approval order, returned as Checkout options (`recurring: '1'`). Demo: an
 * ACTIVE demo mandate straight away. Any earlier unfinished setup is replaced.
 */
export async function startOwnerMandate(params: { organizationId: string; method: AutopayMethod; actor: Actor & { email?: string | null } }) {
  const g = gateway()
  if (g.mode === 'off') throw new ConflictError('AutoPay is not available yet. Please pay your bill with Pay now.')

  const existing = await prisma.ownerMandate.findFirst({ where: { organizationId: params.organizationId, status: { in: [...LIVE] } } })
  if (existing?.status === 'ACTIVE' || existing?.status === 'PAUSED') {
    throw new ConflictError('AutoPay is already on. Switch it off first to use another method.')
  }
  if (existing) {
    await prisma.ownerMandate.update({
      where: { id: existing.id },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: 'Replaced by a new setup' },
    })
  }

  const nextBill = await nextBillEstimate(params.organizationId)
  if (nextBill <= 0) throw new ConflictError('Add a PG first — there is no bill to pay yet.')
  const maxAmount = ownerAutopayLimit(nextBill, params.method)
  if (!maxAmount) {
    throw new ValidationError(
      `${METHOD_LABEL[params.method]} allows up to ${formatMoney(OWNER_METHOD_CEILING[params.method])} a debit and your bill is ${formatMoney(nextBill)}. Choose bank account (eMandate).`,
    )
  }
  const org = await prisma.organization.findUnique({
    where: { id: params.organizationId },
    select: { name: true, ownerName: true, contactEmail: true, contactPhone: true },
  })
  if (!org) throw new NotFoundError('Account not found')

  if (g.mode === 'demo') {
    const mandate = await prisma.ownerMandate.create({
      data: {
        organizationId: params.organizationId,
        provider: 'demo',
        method: params.method,
        maxAmount,
        status: 'ACTIVE',
        isDemo: true,
        authorizedAt: new Date(),
      },
    })
    await logMandate(mandate.organizationId, params.actor.name, `AutoPay (${METHOD_LABEL[params.method]}, demo) switched on, up to ${formatMoney(maxAmount)} a month`)
    return { mode: 'demo' as const, mandateId: mandate.id, maxAmount }
  }

  const email = org.contactEmail || params.actor.email || ''
  if (!email) throw new ValidationError('Add a contact email in Settings first.')
  try {
    const customer = await createCustomer(g.creds, {
      name: org.ownerName || org.name,
      email,
      contact: org.contactPhone,
      notes: { organizationId: params.organizationId, kind: 'owner' },
    })
    const mandate = await prisma.ownerMandate.create({
      data: { organizationId: params.organizationId, customerId: customer.id, method: params.method, maxAmount },
    })
    const notes = { kind: 'owner_autopay_auth', organizationId: params.organizationId, mandateId: mandate.id }
    const order = await createMandateOrder(g.creds, {
      amountPaise: AUTH_AMOUNT_PAISE[params.method],
      customerId: customer.id,
      method: RAZORPAY_METHOD[params.method],
      maxAmountPaise: toPaise(maxAmount),
      expireAt: Math.floor(Date.now() / 1000) + MANDATE_YEARS * 365 * 86_400,
      receipt: `OAP-${mandate.id.slice(-10)}`,
      notes,
    })
    await prisma.ownerMandate.update({ where: { id: mandate.id }, data: { authOrderId: order.id } })
    return {
      mode: 'live' as const,
      mandateId: mandate.id,
      maxAmount,
      keyId: g.creds.keyId,
      orderId: order.id,
      customerId: customer.id,
      amountPaise: AUTH_AMOUNT_PAISE[params.method],
      description: `StayFlow bill AutoPay up to ${formatMoney(maxAmount)}`,
      prefill: { name: org.ownerName, email, contact: org.contactPhone },
      notes,
    }
  } catch (error) {
    if (error instanceof RazorpayError) throw new ValidationError(`AutoPay could not be started: ${error.message}`)
    throw error
  }
}

/** Checkout success: verify the signature, then read the token's real status from Razorpay. */
export async function confirmOwnerMandate(params: { organizationId: string; orderId: string; paymentId: string; signature: string }) {
  const mandate = await prisma.ownerMandate.findFirst({ where: { organizationId: params.organizationId, authOrderId: params.orderId } })
  if (!mandate) throw new NotFoundError('AutoPay setup not found')
  const g = gateway()
  if (g.mode !== 'live') throw new ConflictError('Online payment is not configured on this deployment')
  if (!verifyPaymentSignature(params)) throw new ValidationError('The AutoPay confirmation did not verify. Please try again.')
  return syncOwnerMandate(mandate.id, g.creds, params.paymentId)
}

/** Reads the mandate's token from Razorpay and mirrors its status. Safe to call any time. */
export async function syncOwnerMandate(mandateId: string, creds: RazorpayCredentials, authPaymentId?: string | null) {
  const mandate = await prisma.ownerMandate.findUnique({ where: { id: mandateId } })
  if (!mandate) return null
  let tokenId = mandate.tokenId
  const paymentId = authPaymentId ?? mandate.authPaymentId
  if (!tokenId && paymentId) tokenId = (await fetchPayment(creds, paymentId)).token_id ?? null
  let status: string = mandate.status
  if (tokenId && mandate.customerId) {
    const tokens = await fetchCustomerTokens(creds, mandate.customerId)
    const token = tokens.items?.find((t) => t.id === tokenId)
    if (token) status = mandateStatusFromToken(token.recurring_details?.status)
  }
  if (mandate.status === 'CANCELLED') status = 'CANCELLED'
  return applyStatus(mandate.id, status, { tokenId, authPaymentId: paymentId ?? null })
}

async function applyStatus(mandateId: string, status: string, extra: { tokenId?: string | null; authPaymentId?: string | null; error?: string | null } = {}) {
  const before = await prisma.ownerMandate.findUnique({ where: { id: mandateId } })
  if (!before) return null
  const next = status as 'PENDING' | 'ACTIVE' | 'PAUSED' | 'CANCELLED' | 'FAILED'
  const updated = await prisma.ownerMandate.update({
    where: { id: mandateId },
    data: {
      status: next,
      ...(extra.tokenId ? { tokenId: extra.tokenId } : {}),
      ...(extra.authPaymentId ? { authPaymentId: extra.authPaymentId } : {}),
      ...(next === 'ACTIVE' && !before.authorizedAt ? { authorizedAt: new Date(), failureCount: 0, lastError: null } : {}),
      ...(next === 'CANCELLED' && !before.cancelledAt ? { cancelledAt: new Date(), cancelReason: before.cancelReason ?? 'Cancelled at the bank' } : {}),
      ...(extra.error ? { lastError: extra.error } : {}),
    },
  })
  if (before.status !== updated.status) {
    const label = METHOD_LABEL[updated.method as AutopayMethod] ?? updated.method
    await logMandate(updated.organizationId, 'Razorpay', `AutoPay (${label}) is now ${updated.status.toLowerCase()}`)
    if (updated.status === 'ACTIVE') {
      await notifyOrgAdmins(updated.organizationId, {
        kind: 'SUBSCRIPTION',
        title: 'AutoPay is on',
        body: `Your monthly StayFlow bill will be paid automatically, up to ${formatMoney(updated.maxAmount)}. You get a notice a day before every debit.`,
        link: '/app/subscription',
      }).catch(() => undefined)
    } else if (updated.status === 'FAILED' || (updated.status === 'CANCELLED' && before.status === 'ACTIVE')) {
      await notifyOrgAdmins(updated.organizationId, {
        kind: 'SUBSCRIPTION',
        title: updated.status === 'FAILED' ? 'AutoPay was not approved' : 'AutoPay switched off',
        body:
          updated.status === 'FAILED'
            ? `${updated.lastError ?? 'The bank did not approve it'}. You can try again from the Subscription page.`
            : 'Your AutoPay was cancelled at the bank. Pay your bill with Pay now, or set AutoPay up again.',
        link: '/app/subscription',
      }).catch(() => undefined)
    }
  }
  return updated
}

/** Cancels at Razorpay first (so the bank stops honouring it), then here. */
export async function cancelOwnerMandate(params: { organizationId: string; actor: Actor }) {
  const mandate = await prisma.ownerMandate.findFirst({
    where: { organizationId: params.organizationId, status: { in: [...LIVE, 'FAILED'] } },
    orderBy: { createdAt: 'desc' },
  })
  if (!mandate) throw new NotFoundError('AutoPay is not set up')
  let bankNote: string | null = null
  const g = gateway()
  if (mandate.tokenId && g.mode === 'live') {
    try {
      await cancelToken(g.creds, mandate.customerId, mandate.tokenId)
    } catch (error) {
      // Already cancelled at the bank, or Razorpay unreachable: StayFlow stops debiting either way.
      bankNote = error instanceof Error ? error.message : String(error)
    }
  }
  await prisma.$transaction([
    prisma.ownerMandate.update({
      where: { id: mandate.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelledBy: params.actor.name,
        cancelReason: 'Switched off by the owner',
        ...(bankNote ? { lastError: `Cancel at Razorpay: ${bankNote}` } : {}),
      },
    }),
    // Debits that were announced but not started are dropped.
    prisma.ownerAutopayAttempt.updateMany({
      where: { mandateId: mandate.id, status: 'NOTIFIED' },
      data: { status: 'SKIPPED', error: 'AutoPay was switched off' },
    }),
  ])
  await logMandate(mandate.organizationId, params.actor.name, `AutoPay switched off by ${params.actor.name}`, params.actor.id)
  return { cancelled: true }
}

async function logMandate(organizationId: string, actorName: string, summary: string, actorId?: string | null) {
  await recordActivity({
    organizationId,
    actorId: actorId ?? undefined,
    actorName,
    event: 'AUTOPAY_MANDATE_UPDATED',
    entityType: 'OwnerMandate',
    entityId: organizationId,
    summary,
  }).catch(() => undefined)
}

// --------------------------------------------------------------------------
// Settlement
// --------------------------------------------------------------------------

/** Unpaid lines of the owner's bill due on `dueDate`. */
async function billLineIds(organizationId: string, dueDate: Date) {
  const day = startOfDay(dueDate)
  const lines = await prisma.subscriptionInvoice.findMany({
    where: { subscription: { organizationId }, status: { in: [...UNPAID] }, dueDate: { gte: day, lt: addDays(day, 1) } },
    select: { id: true, total: true, amountPaid: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  return { ids: lines.map((l) => l.id), due: lines.reduce((s, l) => s + Math.max(0, l.total - l.amountPaid), 0) }
}

/** A successful debit: settle every line of the bill once, then mark the attempt. */
async function settleAttempt(attemptId: string, payment: { id: string | null; amount: number; method?: string | null; isDemo: boolean }) {
  const attempt = await prisma.ownerAutopayAttempt.findUnique({ where: { id: attemptId } })
  if (!attempt || attempt.status === 'SUCCEEDED') return { settled: false, note: 'already settled' }
  const { ids } = await billLineIds(attempt.organizationId, attempt.dueDate)
  // Paid another way meanwhile: settleBill still records the money on the bill's
  // first line, which alerts super admins to refund it.
  const lineIds = ids.length
    ? ids
    : (
        await prisma.subscriptionInvoice.findMany({
          where: { subscription: { organizationId: attempt.organizationId }, dueDate: { gte: startOfDay(attempt.dueDate), lt: addDays(startOfDay(attempt.dueDate), 1) } },
          select: { id: true },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: 1,
        })
      ).map((l) => l.id)
  if (!lineIds.length) return { settled: false, note: 'bill not found' }
  try {
    const result = await prisma.$transaction(async (tx) => {
      const r = await settleBill(tx, {
        lineIds,
        amount: payment.amount,
        method: payment.method === 'upi' ? 'UPI' : payment.method === 'card' ? 'CARD' : 'GATEWAY',
        provider: payment.isDemo ? 'demo' : 'razorpay',
        gatewayPaymentId: payment.id,
        isDemo: payment.isDemo,
        actor: { name: 'AutoPay' },
      })
      await tx.ownerAutopayAttempt.update({
        where: { id: attempt.id },
        data: { status: 'SUCCEEDED', completedAt: new Date(), error: null, ...(payment.id ? { paymentId: payment.id } : {}) },
      })
      await tx.ownerMandate.update({ where: { id: attempt.mandateId }, data: { lastChargeAt: new Date(), failureCount: 0, lastError: null } })
      return r
    })
    await ownerBillingEvents.paymentReceived(
      attempt.organizationId,
      { id: result.invoice.id, number: result.invoice.number, subscriptionId: result.invoice.subscriptionId, propertyName: result.invoice.subscription.property.name },
      payment.amount,
      result.reactivated,
    )
    return { settled: true, note: `settled ${result.invoice.number}` }
  } catch (error) {
    if (isUniqueViolation(error, ['gatewayPaymentId']) || isUniqueViolation(error, ['paymentId'])) return { settled: false, note: 'duplicate' }
    throw error
  }
}

async function failAttempt(attemptId: string, error: string) {
  const attempt = await prisma.ownerAutopayAttempt.update({
    where: { id: attemptId },
    data: { status: 'FAILED', completedAt: new Date(), error: error.slice(0, 300) },
  })
  await prisma.ownerMandate.update({ where: { id: attempt.mandateId }, data: { lastError: error.slice(0, 300) } })
  await recordActivity({
    organizationId: attempt.organizationId,
    actorName: 'AutoPay',
    event: 'SUBSCRIPTION_PAYMENT_FAILED',
    entityType: 'OwnerAutopayAttempt',
    entityId: attempt.id,
    summary: `AutoPay debit of ${formatMoney(attempt.amount)} for the StayFlow bill failed — ${error}`,
  }).catch(() => undefined)
  return attempt
}

// --------------------------------------------------------------------------
// Platform webhook (called from handlePlatformWebhook before anything else)
// --------------------------------------------------------------------------

/** Handles owner AutoPay events; returns null for events that are not ours. */
export async function handleOwnerAutopayWebhook(event: RazorpayWebhookEvent, creds: RazorpayCredentials) {
  const name = event.event ?? ''
  const payload = event.payload as Record<string, { entity?: Record<string, unknown> } | undefined> | undefined

  if (name.startsWith('token.')) {
    const token = payload?.token?.entity as { id?: string; customer_id?: string; recurring_details?: { status?: string; failure_reason?: string | null } } | undefined
    if (!token?.id) return null
    const mandate = await prisma.ownerMandate.findFirst({
      where: { OR: [{ tokenId: token.id }, ...(token.customer_id ? [{ customerId: token.customer_id, tokenId: null }] : [])] },
      orderBy: { createdAt: 'desc' },
    })
    if (!mandate) return null
    const status = mandateStatusFromToken(token.recurring_details?.status ?? name.replace('token.', ''))
    await applyStatus(mandate.id, mandate.status === 'CANCELLED' ? 'CANCELLED' : status, {
      tokenId: token.id,
      error: status === 'FAILED' ? token.recurring_details?.failure_reason ?? 'The bank rejected the mandate' : null,
    })
    return { handled: true, note: `owner mandate ${status.toLowerCase()}` }
  }

  const payment = event.payload?.payment?.entity as RazorpayPayment | undefined
  if (!payment?.id || (name !== 'payment.captured' && name !== 'payment.failed')) return null
  let notes = notesOf(payment)
  if (!notes.kind && payment.order_id) {
    const order = await fetchOrder(creds, payment.order_id).catch(() => null)
    notes = { ...notes, ...notesOf(order) }
  }

  if (notes.kind === 'owner_autopay_auth') {
    const mandate = await prisma.ownerMandate.findFirst({
      where: { OR: [{ id: notes.mandateId ?? '' }, ...(payment.order_id ? [{ authOrderId: payment.order_id }] : [])] },
    })
    if (!mandate) return { handled: false, note: 'approval for an unknown owner mandate' }
    if (name === 'payment.failed') {
      if (mandate.status === 'PENDING') await applyStatus(mandate.id, 'FAILED', { error: payment.error_description ?? 'Approval failed' })
      return { handled: true, note: 'owner mandate approval failed' }
    }
    await syncOwnerMandate(mandate.id, creds, payment.id)
    return { handled: true, note: 'owner mandate approval recorded' }
  }

  if (notes.kind === 'owner_autopay') {
    const attempt = await prisma.ownerAutopayAttempt.findFirst({
      where: { OR: [{ paymentId: payment.id }, ...(payment.order_id ? [{ orderId: payment.order_id }] : []), { id: notes.attemptId ?? '' }] },
    })
    if (!attempt) return { handled: false, note: 'debit for an unknown AutoPay attempt' }
    if (name === 'payment.failed') {
      if (attempt.status === 'SUCCEEDED' || attempt.status === 'FAILED') return { handled: true, note: 'stale failure ignored' }
      await failAttempt(attempt.id, payment.error_description ?? payment.error_reason ?? 'The debit failed')
      return { handled: true, note: 'owner AutoPay debit failed' }
    }
    if (payment.status !== 'captured') return { handled: false, note: `payment is ${payment.status}` }
    const r = await settleAttempt(attempt.id, { id: payment.id, amount: fromPaise(payment.amount), method: payment.method, isDemo: false })
    return { handled: true, note: r.note }
  }
  return null
}

// --------------------------------------------------------------------------
// Daily automation
// --------------------------------------------------------------------------

export type OwnerAutopayReport = { synced: number; notified: number; skipped: number; charged: number; failed: number; reconciled: number; alerted: number }

/** Notices, debits, reconciliation and retries for every owner with AutoPay. Runs after billing. */
export async function runOwnerAutopay(params: { now: Date; organizationId?: string; errors: string[] }) {
  const report: OwnerAutopayReport = { synced: 0, notified: 0, skipped: 0, charged: 0, failed: 0, reconciled: 0, alerted: 0 }
  const g = gateway()
  if (g.mode === 'off') return report
  const scope = params.organizationId ? { organizationId: params.organizationId } : {}
  const { now } = params

  if (g.mode === 'live') {
    // 1. Mandates still waiting for the bank (eMandates take a few days).
    for (const m of await prisma.ownerMandate.findMany({ where: { ...scope, status: 'PENDING', authOrderId: { not: null }, isDemo: false } })) {
      try {
        await syncOwnerMandate(m.id, g.creds)
        report.synced++
      } catch {
        // Not approved yet (or Razorpay unreachable): try again tomorrow.
      }
    }
    // 2. Debits started earlier whose webhook never arrived.
    const stale = await prisma.ownerAutopayAttempt.findMany({
      where: { ...scope, status: 'INITIATED', paymentId: { not: null }, attemptedAt: { lt: new Date(now.getTime() - 3_600_000) } },
    })
    for (const a of stale) {
      try {
        const payment = await fetchPayment(g.creds, a.paymentId!)
        if (payment.status === 'captured') {
          await settleAttempt(a.id, { id: payment.id, amount: fromPaise(payment.amount), method: payment.method, isDemo: false })
          report.reconciled++
        } else if (payment.status === 'failed') {
          await failAttempt(a.id, payment.error_description ?? 'The debit failed')
          report.reconciled++
        }
      } catch {
        // Unknown yet; check again on the next run.
      }
    }
  }

  // 3. Pre-debit notices: the day before each bill's due day.
  const mandates = await prisma.ownerMandate.findMany({ where: { ...scope, status: 'ACTIVE' } })
  for (const m of mandates) {
    try {
      const lines = await prisma.subscriptionInvoice.findMany({
        where: { subscription: { organizationId: m.organizationId }, status: { in: [...UNPAID] } },
        select: { id: true, dueDate: true, total: true, amountPaid: true, status: true },
      })
      const bills = groupBills(lines)
      if (!bills.length) continue
      const attempts = await prisma.ownerAutopayAttempt.findMany({
        where: { organizationId: m.organizationId, dueDate: { in: bills.map((b) => b.dueDate) } },
        select: { dueDate: true, attemptNumber: true, status: true },
      })
      const plans = planNotices({
        today: now,
        offsetDays: 0,
        maxAmount: m.maxAmount,
        mandateActive: true,
        invoices: bills,
        attempts: attempts.map((a) => ({ invoiceId: bills.find((b) => b.dueDate.getTime() === startOfDay(a.dueDate).getTime())?.id ?? '', attemptNumber: a.attemptNumber, status: a.status })),
      })
      for (const plan of plans) {
        const bill = bills.find((b) => b.id === plan.invoiceId)!
        try {
          if (plan.action === 'skip') {
            await prisma.ownerAutopayAttempt.create({
              data: { organizationId: m.organizationId, mandateId: m.id, dueDate: bill.dueDate, attemptNumber: 1, amount: plan.amount, chargeDate: startOfDay(now), status: 'SKIPPED', error: plan.reason },
            })
            report.skipped++
            await notifyOrgAdmins(m.organizationId, {
              kind: 'SUBSCRIPTION',
              title: 'Please pay this bill yourself',
              body: `Your StayFlow bill of ${formatMoney(plan.amount)} is above your AutoPay limit of ${formatMoney(m.maxAmount)}, so it will not be debited. Pay it with Pay now, and set AutoPay up again for a higher limit.`,
              link: '/app/subscription',
            })
            continue
          }
          await prisma.ownerAutopayAttempt.create({
            data: { organizationId: m.organizationId, mandateId: m.id, dueDate: bill.dueDate, attemptNumber: 1, amount: plan.amount, chargeDate: plan.chargeDate, status: 'NOTIFIED', notifiedAt: now },
          })
          report.notified++
          await preDebitNotice(m.organizationId, plan.amount, plan.chargeDate, m.method)
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') continue
          throw error
        }
      }
    } catch (error) {
      params.errors.push(`owner autopay notices (${m.organizationId}): ${(error as Error).message}`)
    }
  }

  // 4. Debits whose day has come.
  const due = await prisma.ownerAutopayAttempt.findMany({
    where: { ...scope, status: 'NOTIFIED', chargeDate: { lte: now } },
    include: { mandate: { include: { organization: { select: { contactEmail: true, contactPhone: true } } } } },
  })
  for (const a of due) {
    if (!isDueForCharge(a, now)) continue
    if (a.mandate.status !== 'ACTIVE' || (!a.mandate.isDemo && !a.mandate.tokenId)) {
      await prisma.ownerAutopayAttempt.updateMany({ where: { id: a.id, status: 'NOTIFIED' }, data: { status: 'SKIPPED', error: 'AutoPay is not active' } })
      continue
    }
    const { due: balance } = await billLineIds(a.organizationId, a.dueDate)
    const amount = chargeAmount(a.amount, balance)
    if (amount <= 0) {
      await prisma.ownerAutopayAttempt.updateMany({ where: { id: a.id, status: 'NOTIFIED' }, data: { status: 'SKIPPED', error: 'Already paid' } })
      continue
    }
    // Claim the debit before calling Razorpay: a concurrent or repeated run sees 0 rows.
    const claimed = await prisma.ownerAutopayAttempt.updateMany({ where: { id: a.id, status: 'NOTIFIED' }, data: { status: 'INITIATED', attemptedAt: now, amount } })
    if (claimed.count === 0) continue
    try {
      if (a.mandate.isDemo) {
        if (!demoPaymentsAllowed()) throw new Error('Demo AutoPay is not available on this deployment — please use Pay now')
        const sim = simulateAutopayDebit(`${a.id}:${a.attemptNumber}`)
        if (!sim.success) throw new Error(sim.reason ?? 'Payment failed')
        await settleAttempt(a.id, { id: null, amount, isDemo: true })
        report.charged++
        continue
      }
      if (g.mode !== 'live') throw new Error('Online payment is not configured on this deployment')
      const notes = { kind: 'owner_autopay', organizationId: a.organizationId, attemptId: a.id }
      const order = await createRecurringOrder(g.creds, { amountPaise: toPaise(amount), receipt: `OAP-${a.id.slice(-12)}-${a.attemptNumber}`, notes })
      await prisma.ownerAutopayAttempt.update({ where: { id: a.id }, data: { orderId: order.id } })
      const result = await createRecurringPayment(g.creds, {
        email: a.mandate.organization.contactEmail,
        contact: a.mandate.organization.contactPhone,
        amountPaise: toPaise(amount),
        orderId: order.id,
        customerId: a.mandate.customerId,
        tokenId: a.mandate.tokenId!,
        description: 'StayFlow monthly bill',
        notes,
      })
      if (result.razorpay_payment_id) {
        await prisma.ownerAutopayAttempt.update({ where: { id: a.id }, data: { paymentId: result.razorpay_payment_id } })
      }
      report.charged++
    } catch (error) {
      await failAttempt(a.id, error instanceof Error ? error.message : String(error))
      report.failed++
    }
  }

  // 5. Retries, then one alert once they are used up.
  const failed = await prisma.ownerAutopayAttempt.findMany({ where: { ...scope, status: 'FAILED', alertedAt: null }, include: { mandate: true } })
  for (const f of failed) {
    const later = await prisma.ownerAutopayAttempt.count({ where: { organizationId: f.organizationId, dueDate: f.dueDate, attemptNumber: { gt: f.attemptNumber } } })
    if (later) continue
    const { due: balance } = await billLineIds(f.organizationId, f.dueDate)
    if (balance <= 0 || f.mandate.status !== 'ACTIVE') {
      await prisma.ownerAutopayAttempt.update({ where: { id: f.id }, data: { alertedAt: now } })
      continue
    }
    const retry = nextRetry({ attemptNumber: f.attemptNumber, retryDays: RETRY_DAYS, today: now })
    if (retry) {
      const amount = Math.min(balance, f.mandate.maxAmount)
      try {
        await prisma.ownerAutopayAttempt.create({
          data: { organizationId: f.organizationId, mandateId: f.mandateId, dueDate: f.dueDate, attemptNumber: retry.attemptNumber, amount, chargeDate: retry.chargeDate, status: 'NOTIFIED', notifiedAt: now },
        })
        await preDebitNotice(f.organizationId, amount, retry.chargeDate, f.mandate.method, true)
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error
      }
      continue
    }
    await prisma.$transaction([
      prisma.ownerAutopayAttempt.update({ where: { id: f.id }, data: { alertedAt: now } }),
      prisma.ownerMandate.update({ where: { id: f.mandateId }, data: { failureCount: { increment: 1 }, lastError: f.error ?? 'Debit failed' } }),
    ])
    report.alerted++
    await notifyOrgAdmins(f.organizationId, {
      kind: 'SUBSCRIPTION',
      title: 'AutoPay could not pay your bill',
      body: `We tried to debit ${formatMoney(f.amount)} ${f.attemptNumber} times and it did not go through (${f.error ?? 'declined'}). Please pay it with Pay now to avoid the late fee.`,
      link: '/app/subscription',
    })
    await notifySuperAdmins({ kind: 'SUBSCRIPTION', title: 'Owner AutoPay failed', body: `${f.organizationId}: ${f.attemptNumber} debits failed (${f.error ?? 'declined'})`, link: '/admin/payments' }).catch(() => undefined)
  }
  return report
}

/** The pre-debit notice (RBI): always sent, whatever the owner's notification switches. */
async function preDebitNotice(organizationId: string, amount: number, chargeDate: Date, method: string, retry = false) {
  await notifyOrgAdmins(organizationId, {
    kind: 'SUBSCRIPTION',
    title: retry ? 'AutoPay will try again tomorrow' : `AutoPay: ${formatMoney(amount)} on ${dateLabel(chargeDate)}`,
    body: `${formatMoney(amount)} for your StayFlow bill will be debited on ${dateLabel(chargeDate)} by ${
      METHOD_LABEL[method as AutopayMethod] ?? 'AutoPay'
    }. Pay it yourself before then, or switch AutoPay off on the Subscription page, if you prefer.`,
    link: '/app/subscription',
  })
}
