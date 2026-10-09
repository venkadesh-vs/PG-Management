import 'server-only'

import { Prisma, type UserRole } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/tenancy'
import { formatMoney } from '@/lib/utils'
import {
  AUTOPAY_METHODS,
  autopayMaxAmount,
  chargeAmount,
  clampDay,
  dayProblem,
  isDueForCharge,
  mandateStatusFromToken,
  METHOD_LABEL,
  nextChargeDate,
  nextRetry,
  ordinal,
  planNotices,
  RAZORPAY_METHOD,
  type AutopayMethod,
} from '@/lib/autopay'
import { notifyOrgAdmins, notifyUsers, recordActivity } from '@/server/events'
import { getOrgRazorpay, recordRentGatewayPayment, type OrgRazorpay } from '@/server/integrations/payments'
import {
  cancelToken,
  createCustomer,
  createMandateOrder,
  createRecurringOrder,
  createRecurringPayment,
  fetchCustomerTokens,
  fetchPayment,
  notesOf,
  RazorpayError,
  toPaise,
  verifyCheckoutSignature,
  type RazorpayPayment,
} from '@/server/integrations/razorpay'

/**
 * Resident rent AutoPay on the PG owner's own Razorpay account (recurring payments).
 *
 *   resident authorises once  → ResidentMandate (PENDING → ACTIVE when the token is confirmed)
 *   day before the debit      → AutopayAttempt NOTIFIED + pre-debit notice to the resident
 *   debit day                 → attempt INITIATED: an order + a recurring payment for the
 *                               invoice balance (never above the notice or the limit)
 *   payment.captured webhook  → the existing rent recording books the money once;
 *                               the attempt becomes SUCCEEDED
 *   payment.failed            → FAILED; retried on the following days, then owner alerted
 *
 * Every step is idempotent: attempts are unique per (invoice, attempt number) and a
 * debit is claimed with a conditional update before Razorpay is called, so a rerun of
 * the daily automation can never charge twice.
 */

const LIVE = ['PENDING', 'ACTIVE', 'PAUSED'] as const
const OPEN = ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] as const
/** UPI and card authorisations need a real payment of at least ₹1; an eMandate authorises for ₹0. */
const AUTH_AMOUNT_PAISE: Record<AutopayMethod, number> = { UPI: 100, CARD: 100, EMANDATE: 0 }
/** Mandates are authorised for 10 years; the resident or owner cancels when they leave. */
const MANDATE_YEARS = 10

type Actor = { id?: string | null; name: string; role?: UserRole | null }

export type AutopaySettings = {
  enabled: boolean
  percent: number
  cap: number | null
  offsetDays: number
  retryDays: number
  /** The days residents may choose for their debit (and rent due day). */
  dayMin: number
  dayMax: number
  /** The organisation's default rent due day, for residents without their own. */
  defaultDueDay: number
}

export async function autopaySettings(organizationId: string): Promise<AutopaySettings> {
  const s = await prisma.orgSetting.findUnique({
    where: { organizationId },
    select: {
      residentAutopayEnabled: true,
      autopayMaxPercent: true,
      autopayMaxAmountCap: true,
      autopayChargeDayOffset: true,
      autopayRetryDays: true,
      rentDueDayMin: true,
      rentDueDayMax: true,
      rentDueDay: true,
    },
  })
  return {
    enabled: s?.residentAutopayEnabled ?? false,
    percent: s?.autopayMaxPercent ?? 150,
    cap: s?.autopayMaxAmountCap ?? null,
    offsetDays: s?.autopayChargeDayOffset ?? 0,
    retryDays: s?.autopayRetryDays ?? 2,
    dayMin: s?.rentDueDayMin ?? 1,
    dayMax: s?.rentDueDayMax ?? 10,
    defaultDueDay: s?.rentDueDay ?? 5,
  }
}

/** The day a resident is debited (and their rent falls due): their own, else the PG's. */
export function chargeDayOf(resident: { rentDueDay: number | null }, settings: AutopaySettings) {
  return resident.rentDueDay ?? settings.defaultDueDay
}

/**
 * Sets the resident's AutoPay day, which is also their rent due day, so AutoPay
 * debits on the day the rent falls due and no late fee can land before it. Takes
 * effect from the next invoice: invoices already raised keep their due date.
 */
export async function setChargeDay(params: { residentId: string; organizationId: string; day: number; actor: Actor; byOwner?: boolean }) {
  const resident = await prisma.resident.findFirst({
    where: { id: params.residentId, organizationId: params.organizationId },
    select: { id: true, propertyId: true, rentDueDay: true, fullName: true },
  })
  if (!resident) throw new NotFoundError('Resident not found')
  const settings = await autopaySettings(params.organizationId)
  // Residents pick their own day only where the PG offers AutoPay; the owner can always set it.
  if (!params.byOwner && !settings.enabled) throw new ConflictError('Your PG has not turned on AutoPay yet.')
  const problem = dayProblem(params.day, { min: settings.dayMin, max: settings.dayMax })
  if (problem) throw new ValidationError(problem)
  const before = chargeDayOf(resident, settings)
  if (resident.rentDueDay === params.day) return { day: params.day, changed: false }
  await prisma.resident.update({ where: { id: resident.id }, data: { rentDueDay: params.day } })
  await recordActivity({
    organizationId: params.organizationId,
    propertyId: resident.propertyId,
    actorId: params.actor.id ?? undefined,
    actorName: params.actor.name,
    actorRole: params.actor.role ?? null,
    event: 'AUTOPAY_MANDATE_UPDATED',
    entityType: 'Resident',
    entityId: resident.id,
    summary: `AutoPay day for ${resident.fullName} changed from the ${ordinal(before)} to the ${ordinal(params.day)} (rent due day too, from the next invoice)`,
    before: { rentDueDay: before },
    after: { rentDueDay: params.day },
  })
  if (params.byOwner) {
    await notifyResidentUser(resident.id, {
      organizationId: params.organizationId,
      kind: 'RENT',
      title: 'Your rent date changed',
      body: `Your rent is now due, and AutoPay debits it, on the ${ordinal(params.day)} of every month, from your next invoice.`,
      link: '/tenant/rent',
    })
  }
  return { day: params.day, changed: true }
}

function monthlyBillOf(r: { rentAmount: number; maintenanceFee: number; foodOptIn: boolean; foodCharge: number }) {
  return r.rentAmount + r.maintenanceFee + (r.foodOptIn ? r.foodCharge : 0)
}

const today0 = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const dateLabel = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

// --------------------------------------------------------------------------
// Resident view
// --------------------------------------------------------------------------

/** What the resident app shows: whether AutoPay is offered, the mandate and recent debits. */
export async function residentAutopayStatus(residentId: string) {
  const resident = await prisma.resident.findUnique({
    where: { id: residentId },
    select: {
      id: true,
      organizationId: true,
      rentAmount: true,
      maintenanceFee: true,
      foodOptIn: true,
      foodCharge: true,
      status: true,
      rentDueDay: true,
    },
  })
  if (!resident) throw new NotFoundError('Resident not found')
  const settings = await autopaySettings(resident.organizationId)
  const day = chargeDayOf(resident, settings)
  const window = { min: settings.dayMin, max: settings.dayMax }
  const creds = settings.enabled ? await getOrgRazorpay(resident.organizationId) : null
  const offered = settings.enabled && Boolean(creds) && resident.status !== 'CHECKED_OUT'
  const mandate = await prisma.residentMandate.findFirst({
    where: { residentId, status: { in: [...LIVE, 'FAILED'] } },
    orderBy: { createdAt: 'desc' },
    include: {
      attempts: {
        orderBy: { createdAt: 'desc' },
        take: 6,
        include: { invoice: { select: { number: true } } },
      },
    },
  })
  const upcoming = mandate?.attempts.find((a) => a.status === 'NOTIFIED' || a.status === 'INITIATED') ?? null
  return {
    offered,
    reason: offered
      ? null
      : !settings.enabled
        ? 'Your PG has not turned on AutoPay yet.'
        : 'Online payments are not set up for your PG yet.',
    limit: autopayMaxAmount({ monthlyBill: monthlyBillOf(resident), percent: settings.percent, cap: settings.cap }),
    day,
    dayLabel: ordinal(day),
    window,
    /** Outside the owner's current window: still debited on this day until a new one is picked. */
    dayOutsideWindow: dayProblem(day, window) !== null,
    suggestedDay: clampDay(day, window),
    nextChargeDate: nextChargeDate(day, new Date()),
    methods: AUTOPAY_METHODS.map((m) => ({ key: m, label: METHOD_LABEL[m] })),
    mandate: mandate
      ? {
          id: mandate.id,
          status: mandate.status,
          method: mandate.method as AutopayMethod,
          methodLabel: METHOD_LABEL[mandate.method as AutopayMethod] ?? mandate.method,
          maxAmount: mandate.maxAmount,
          authorizedAt: mandate.authorizedAt,
          lastError: mandate.lastError,
        }
      : null,
    upcoming: upcoming
      ? { amount: upcoming.amount, chargeDate: upcoming.chargeDate, status: upcoming.status, invoice: upcoming.invoice.number }
      : null,
    attempts: (mandate?.attempts ?? []).map((a) => ({
      id: a.id,
      invoice: a.invoice.number,
      amount: a.amount,
      chargeDate: a.chargeDate,
      status: a.status,
      error: a.error,
      attemptNumber: a.attemptNumber,
    })),
  }
}

/**
 * Starts a mandate: a Razorpay customer, a PENDING mandate and the authorisation
 * order. Returns the options the resident app passes to Razorpay Checkout
 * (with `recurring: '1'`). Any earlier PENDING mandate is replaced.
 */
export async function startMandate(params: {
  residentId: string
  method: AutopayMethod
  chargeDay: number
  actor: Actor
  fallbackEmail?: string | null
}) {
  const resident = await prisma.resident.findUnique({
    where: { id: params.residentId },
    include: { property: { select: { name: true } }, user: { select: { email: true } } },
  })
  if (!resident) throw new NotFoundError('Resident not found')
  if (resident.status === 'CHECKED_OUT') throw new ConflictError('AutoPay is only for current residents')
  const settings = await autopaySettings(resident.organizationId)
  if (!settings.enabled) throw new ConflictError('Your PG has not turned on AutoPay yet.')
  const creds = await getOrgRazorpay(resident.organizationId)
  if (!creds) throw new ConflictError('Online payments are not set up for your PG yet.')

  const existing = await prisma.residentMandate.findFirst({
    where: { residentId: resident.id, status: { in: [...LIVE] } },
  })
  if (existing?.status === 'ACTIVE' || existing?.status === 'PAUSED') {
    throw new ConflictError('AutoPay is already set up. Cancel it first to switch to another method.')
  }
  if (existing) {
    await prisma.residentMandate.update({
      where: { id: existing.id },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: 'Replaced by a new setup' },
    })
  }

  const email = resident.email || resident.user?.email || params.fallbackEmail || ''
  if (!email) throw new ValidationError('Add an email address to your profile first.')
  const dayError = dayProblem(params.chargeDay, { min: settings.dayMin, max: settings.dayMax })
  if (dayError) throw new ValidationError(dayError)
  const maxAmount = autopayMaxAmount({ monthlyBill: monthlyBillOf(resident), percent: settings.percent, cap: settings.cap })

  try {
    const customer = await createCustomer(creds, {
      name: resident.fullName,
      email,
      contact: resident.phone,
      notes: { residentId: resident.id, organizationId: resident.organizationId },
    })
    const mandate = await prisma.residentMandate.create({
      data: {
        organizationId: resident.organizationId,
        propertyId: resident.propertyId,
        residentId: resident.id,
        customerId: customer.id,
        method: params.method,
        maxAmount,
      },
    })
    const expireAt = Math.floor(Date.now() / 1000) + MANDATE_YEARS * 365 * 86_400
    const notes = { kind: 'autopay_auth', organizationId: resident.organizationId, residentId: resident.id, mandateId: mandate.id }
    const order = await createMandateOrder(creds, {
      amountPaise: AUTH_AMOUNT_PAISE[params.method],
      customerId: customer.id,
      method: RAZORPAY_METHOD[params.method],
      maxAmountPaise: toPaise(maxAmount),
      expireAt,
      receipt: `AP-${resident.code}-${Date.now().toString(36)}`,
      notes,
    })
    await prisma.residentMandate.update({ where: { id: mandate.id }, data: { authOrderId: order.id } })
    // The chosen day becomes the rent due day, from the next invoice.
    await setChargeDay({ residentId: resident.id, organizationId: resident.organizationId, day: params.chargeDay, actor: params.actor })
    return {
      mandateId: mandate.id,
      keyId: creds.keyId,
      orderId: order.id,
      customerId: customer.id,
      amountPaise: AUTH_AMOUNT_PAISE[params.method],
      maxAmount,
      name: resident.property.name,
      description: `Rent AutoPay up to ${formatMoney(maxAmount)}`,
      prefill: { name: resident.fullName, email, contact: resident.phone },
      notes,
    }
  } catch (error) {
    if (error instanceof RazorpayError) throw new ValidationError(`AutoPay could not be started: ${error.message}`)
    throw error
  }
}

/** Checkout success: verify the signature, then read the token's real status from Razorpay. */
export async function confirmMandate(params: { residentId: string; orderId: string; paymentId: string; signature: string }) {
  const mandate = await prisma.residentMandate.findFirst({
    where: { residentId: params.residentId, authOrderId: params.orderId },
  })
  if (!mandate) throw new NotFoundError('AutoPay setup not found')
  const creds = await getOrgRazorpay(mandate.organizationId)
  if (!creds) throw new ConflictError('Online payments are not set up for your PG yet.')
  const valid = verifyCheckoutSignature({
    orderId: params.orderId,
    paymentId: params.paymentId,
    signature: params.signature,
    keySecret: creds.keySecret,
  })
  if (!valid) throw new ValidationError('The AutoPay confirmation did not verify. Please try again.')
  const updated = await syncMandate(mandate.id, creds, params.paymentId)
  return updated
}

/** Reads the mandate's token from Razorpay and mirrors its status. Safe to call any time. */
export async function syncMandate(mandateId: string, creds: OrgRazorpay, authPaymentId?: string | null) {
  const mandate = await prisma.residentMandate.findUnique({ where: { id: mandateId } })
  if (!mandate) return null
  let tokenId = mandate.tokenId
  const paymentId = authPaymentId ?? mandate.authPaymentId
  if (!tokenId && paymentId) {
    const payment = await fetchPayment(creds, paymentId)
    tokenId = payment.token_id ?? null
  }
  let status: string = mandate.status
  if (tokenId) {
    const tokens = await fetchCustomerTokens(creds, mandate.customerId)
    const token = tokens.items?.find((t) => t.id === tokenId)
    if (token) status = mandateStatusFromToken(token.recurring_details?.status)
  }
  if (mandate.status === 'CANCELLED') status = 'CANCELLED'
  return applyMandateStatus(mandate.id, status, { tokenId, authPaymentId: paymentId ?? null })
}

async function applyMandateStatus(
  mandateId: string,
  status: string,
  extra: { tokenId?: string | null; authPaymentId?: string | null; error?: string | null } = {},
) {
  const before = await prisma.residentMandate.findUnique({ where: { id: mandateId } })
  if (!before) return null
  const next = status as 'PENDING' | 'ACTIVE' | 'PAUSED' | 'CANCELLED' | 'FAILED'
  const updated = await prisma.residentMandate.update({
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
    await recordActivity({
      organizationId: updated.organizationId,
      propertyId: updated.propertyId,
      actorName: 'Razorpay',
      event: 'AUTOPAY_MANDATE_UPDATED',
      entityType: 'Resident',
      entityId: updated.residentId,
      summary: `AutoPay (${METHOD_LABEL[updated.method as AutopayMethod] ?? updated.method}) is now ${updated.status.toLowerCase()}`,
      before: { status: before.status },
      after: { status: updated.status },
    }).catch(() => undefined)
    if (updated.status === 'ACTIVE') {
      await notifyResidentUser(updated.residentId, {
        organizationId: updated.organizationId,
        kind: 'PAYMENT',
        title: 'AutoPay is on',
        body: `Your rent will be paid automatically up to ${formatMoney(updated.maxAmount)} a month. You get a reminder a day before every debit.`,
        link: '/tenant/rent',
      })
    }
  }
  return updated
}

/** Cancels at Razorpay first (so the bank stops honouring it), then here. */
export async function cancelMandate(params: { mandateId: string; organizationId: string; actor: Actor; reason?: string }) {
  const mandate = await prisma.residentMandate.findFirst({
    where: { id: params.mandateId, organizationId: params.organizationId },
  })
  if (!mandate) throw new NotFoundError('AutoPay not found')
  if (mandate.status === 'CANCELLED') return mandate
  let bankNote: string | null = null
  if (mandate.tokenId) {
    const creds = await getOrgRazorpay(mandate.organizationId)
    if (creds) {
      try {
        await cancelToken(creds, mandate.customerId, mandate.tokenId)
      } catch (error) {
        // Already cancelled at the bank, or Razorpay unreachable: StayFlow stops debiting
        // either way; keep the reason visible for the owner.
        bankNote = error instanceof Error ? error.message : String(error)
      }
    }
  }
  const updated = await prisma.$transaction(async (tx) => {
    const m = await tx.residentMandate.update({
      where: { id: mandate.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelledBy: params.actor.name,
        cancelReason: params.reason ?? null,
        ...(bankNote ? { lastError: `Cancel at Razorpay: ${bankNote}` } : {}),
      },
    })
    // Debits that were announced but not started are dropped.
    await tx.autopayAttempt.updateMany({
      where: { mandateId: mandate.id, status: 'NOTIFIED' },
      data: { status: 'SKIPPED', error: 'AutoPay was cancelled' },
    })
    return m
  })
  await recordActivity({
    organizationId: mandate.organizationId,
    propertyId: mandate.propertyId,
    actorId: params.actor.id ?? undefined,
    actorName: params.actor.name,
    actorRole: params.actor.role ?? null,
    event: 'AUTOPAY_MANDATE_UPDATED',
    entityType: 'Resident',
    entityId: mandate.residentId,
    summary: `AutoPay cancelled by ${params.actor.name}${params.reason ? ` — ${params.reason}` : ''}`,
    before: { status: mandate.status },
    after: { status: 'CANCELLED' },
  })
  return updated
}

// --------------------------------------------------------------------------
// Webhooks (called from the org webhook dispatcher)
// --------------------------------------------------------------------------

type TokenEntity = { id?: string; customer_id?: string; recurring_details?: { status?: string; failure_reason?: string | null } }

/** token.confirmed / token.rejected / token.cancelled / token.paused. */
export async function handleTokenEvent(organizationId: string, event: string, token: TokenEntity | undefined) {
  if (!token?.id) return { handled: false, note: 'token event without a token' }
  const mandate = await prisma.residentMandate.findFirst({
    where: {
      organizationId,
      OR: [{ tokenId: token.id }, ...(token.customer_id ? [{ customerId: token.customer_id, tokenId: null }] : [])],
    },
    orderBy: { createdAt: 'desc' },
  })
  if (!mandate) return { handled: false, note: 'token for a mandate StayFlow did not start' }
  const fromEvent = event.replace('token.', '')
  const status = mandateStatusFromToken(token.recurring_details?.status ?? fromEvent)
  await applyMandateStatus(mandate.id, mandate.status === 'CANCELLED' ? 'CANCELLED' : status, {
    tokenId: token.id,
    error: status === 'FAILED' ? token.recurring_details?.failure_reason ?? 'The bank rejected the mandate' : null,
  })
  return { handled: true, note: `mandate ${status.toLowerCase()}` }
}

/** The ₹1/₹0 authorisation payment of a mandate. */
export async function handleAuthPayment(organizationId: string, creds: OrgRazorpay, event: string, payment: RazorpayPayment) {
  const notes = notesOf(payment)
  const mandate = await prisma.residentMandate.findFirst({
    where: {
      organizationId,
      OR: [{ id: notes.mandateId ?? '' }, ...(payment.order_id ? [{ authOrderId: payment.order_id }] : [])],
    },
  })
  if (!mandate) return { handled: false, note: 'authorisation for an unknown mandate' }
  if (event === 'payment.failed') {
    if (mandate.status === 'PENDING') {
      await applyMandateStatus(mandate.id, 'FAILED', { error: payment.error_description ?? 'Authorisation failed' })
    }
    return { handled: true, note: 'mandate authorisation failed' }
  }
  await syncMandate(mandate.id, creds, payment.id)
  return { handled: true, note: 'mandate authorisation recorded' }
}

/** A recurring debit's payment: find its attempt by order or payment id. */
async function attemptForPayment(organizationId: string, payment: RazorpayPayment) {
  return prisma.autopayAttempt.findFirst({
    where: {
      organizationId,
      OR: [{ paymentId: payment.id }, ...(payment.order_id ? [{ orderId: payment.order_id }] : [])],
    },
    include: { mandate: true, invoice: { select: { number: true } } },
  })
}

export async function onRecurringCaptured(organizationId: string, payment: RazorpayPayment) {
  const attempt = await attemptForPayment(organizationId, payment)
  if (!attempt || attempt.status === 'SUCCEEDED') return
  await prisma.$transaction([
    prisma.autopayAttempt.update({
      where: { id: attempt.id },
      data: { status: 'SUCCEEDED', paymentId: payment.id, completedAt: new Date(), error: null },
    }),
    prisma.residentMandate.update({
      where: { id: attempt.mandateId },
      data: { lastChargeAt: new Date(), failureCount: 0, lastError: null },
    }),
  ])
  await recordActivity({
    organizationId,
    propertyId: attempt.mandate.propertyId,
    actorName: 'AutoPay',
    event: 'AUTOPAY_CHARGE',
    entityType: 'RentInvoice',
    entityId: attempt.invoiceId,
    summary: `AutoPay debited ${formatMoney(attempt.amount)} for ${attempt.invoice.number}`,
  }).catch(() => undefined)
}

export async function onRecurringFailed(organizationId: string, payment: RazorpayPayment) {
  const attempt = await attemptForPayment(organizationId, payment)
  if (!attempt || attempt.status === 'SUCCEEDED' || attempt.status === 'FAILED') return
  await failAttempt(attempt.id, payment.error_description ?? payment.error_reason ?? 'The debit failed')
}

async function failAttempt(attemptId: string, error: string) {
  const attempt = await prisma.autopayAttempt.update({
    where: { id: attemptId },
    data: { status: 'FAILED', completedAt: new Date(), error: error.slice(0, 300) },
    include: { mandate: true, invoice: { select: { number: true } } },
  })
  await prisma.residentMandate.update({ where: { id: attempt.mandateId }, data: { lastError: error.slice(0, 300) } })
  await recordActivity({
    organizationId: attempt.organizationId,
    propertyId: attempt.mandate.propertyId,
    actorName: 'AutoPay',
    event: 'PAYMENT_FAILED',
    entityType: 'RentInvoice',
    entityId: attempt.invoiceId,
    summary: `AutoPay debit of ${formatMoney(attempt.amount)} for ${attempt.invoice.number} failed — ${error}`,
  }).catch(() => undefined)
  return attempt
}

// --------------------------------------------------------------------------
// Daily automation
// --------------------------------------------------------------------------

export type AutopayReport = {
  synced: number
  notified: number
  skipped: number
  charged: number
  failed: number
  reconciled: number
  retriesScheduled: number
  alerted: number
}

/** Notices, debits, reconciliation and retries for every PG that offers AutoPay. */
export async function runResidentAutopay(params: { now: Date; organizationId?: string; errors: string[] }) {
  const report: AutopayReport = { synced: 0, notified: 0, skipped: 0, charged: 0, failed: 0, reconciled: 0, retriesScheduled: 0, alerted: 0 }
  const orgs = await prisma.orgSetting.findMany({
    where: { residentAutopayEnabled: true, ...(params.organizationId ? { organizationId: params.organizationId } : {}) },
    select: { organizationId: true },
  })
  for (const { organizationId } of orgs) {
    const creds = await getOrgRazorpay(organizationId)
    if (!creds) continue
    const settings = await autopaySettings(organizationId)
    try {
      await runForOrg({ organizationId, creds, settings, now: params.now, report })
    } catch (error) {
      params.errors.push(`autopay (${organizationId}): ${(error as Error).message}`)
    }
  }
  return report
}

async function runForOrg(ctx: {
  organizationId: string
  creds: OrgRazorpay
  settings: AutopaySettings
  now: Date
  report: AutopayReport
}) {
  const { organizationId, creds, settings, now, report } = ctx

  // 1. Mandates still waiting for the bank (eMandates take a few days).
  const pending = await prisma.residentMandate.findMany({ where: { organizationId, status: 'PENDING', authOrderId: { not: null } } })
  for (const m of pending) {
    try {
      await syncMandate(m.id, creds)
      report.synced++
    } catch {
      // Still not authorised (or Razorpay unreachable): try again tomorrow.
    }
  }

  // 2. Debits started earlier whose webhook never arrived.
  const stale = await prisma.autopayAttempt.findMany({
    where: { organizationId, status: 'INITIATED', paymentId: { not: null }, attemptedAt: { lt: new Date(now.getTime() - 3_600_000) } },
  })
  for (const a of stale) {
    try {
      const payment = await fetchPayment(creds, a.paymentId!)
      if (payment.status === 'captured') {
        await recordRentGatewayPayment({ organizationId, creds, payment, source: 'webhook' })
        await onRecurringCaptured(organizationId, payment)
        report.reconciled++
      } else if (payment.status === 'failed') {
        await failAttempt(a.id, payment.error_description ?? 'The debit failed')
        report.reconciled++
      }
    } catch {
      // Unknown yet; check again on the next run.
    }
  }

  // 3. Pre-debit notices for debits due tomorrow (or overdue ones, debited tomorrow).
  const mandates = await prisma.residentMandate.findMany({
    where: { organizationId, status: 'ACTIVE' },
    include: { resident: { select: { id: true, userId: true, fullName: true, status: true, joiningDate: true } } },
  })
  for (const m of mandates) {
    if (m.resident.status === 'CHECKED_OUT') continue
    // AutoPay starts with the first regular month: the joining month (collected by hand
    // at check-in) is never debited.
    const joined = new Date(m.resident.joiningDate)
    const firstRegularMonth = new Date(joined.getFullYear(), joined.getMonth() + 1, 1)
    const invoices = await prisma.rentInvoice.findMany({
      where: {
        residentId: m.residentId,
        status: { in: [...OPEN] },
        balance: { gt: 0 },
        periodStart: { gte: firstRegularMonth },
      },
      select: { id: true, dueDate: true, balance: true, status: true, number: true },
    })
    if (!invoices.length) continue
    const attempts = await prisma.autopayAttempt.findMany({
      where: { invoiceId: { in: invoices.map((i) => i.id) } },
      select: { invoiceId: true, attemptNumber: true, status: true },
    })
    const plans = planNotices({
      today: now,
      offsetDays: settings.offsetDays,
      maxAmount: m.maxAmount,
      mandateActive: true,
      invoices,
      attempts,
    })
    for (const plan of plans) {
      const invoice = invoices.find((i) => i.id === plan.invoiceId)!
      try {
        if (plan.action === 'skip') {
          await prisma.autopayAttempt.create({
            data: {
              organizationId,
              mandateId: m.id,
              invoiceId: plan.invoiceId,
              attemptNumber: 1,
              amount: plan.amount,
              chargeDate: today0(now),
              status: 'SKIPPED',
              error: plan.reason,
            },
          })
          report.skipped++
          await notifyResidentUser(m.residentId, {
            organizationId,
            kind: 'RENT',
            title: 'Please pay this rent yourself',
            body: `${invoice.number}: ${plan.reason}, so it will not be debited automatically. Pay it from the Rent page.`,
            link: '/tenant/rent',
          })
          await notifyOrgAdmins(organizationId, {
            kind: 'RENT',
            title: 'AutoPay skipped an invoice',
            body: `${m.resident.fullName} · ${invoice.number}: ${plan.reason}.`,
            link: '/app/rent',
          }).catch(() => undefined)
          continue
        }
        await prisma.autopayAttempt.create({
          data: {
            organizationId,
            mandateId: m.id,
            invoiceId: plan.invoiceId,
            attemptNumber: 1,
            amount: plan.amount,
            chargeDate: plan.chargeDate,
            status: 'NOTIFIED',
            notifiedAt: now,
          },
        })
        report.notified++
        await sendPreDebitNotice({ residentId: m.residentId, organizationId, amount: plan.amount, chargeDate: plan.chargeDate, invoiceNumber: invoice.number, method: m.method })
      } catch (error) {
        // Unique (invoice, attempt) — another run already created it.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') continue
        throw error
      }
    }
  }

  // 4. Debits whose day has come.
  const due = await prisma.autopayAttempt.findMany({
    where: { organizationId, status: 'NOTIFIED', chargeDate: { lte: now } },
    include: {
      mandate: { include: { resident: { select: { id: true, phone: true, email: true, fullName: true, code: true, user: { select: { email: true } } } } } },
      invoice: { select: { id: true, number: true, balance: true, status: true } },
    },
  })
  for (const a of due) {
    if (!isDueForCharge(a, now)) continue
    if (a.mandate.status !== 'ACTIVE' || !a.mandate.tokenId) {
      await prisma.autopayAttempt.updateMany({ where: { id: a.id, status: 'NOTIFIED' }, data: { status: 'SKIPPED', error: 'AutoPay is not active' } })
      continue
    }
    const balance = (OPEN as readonly string[]).includes(a.invoice.status) ? a.invoice.balance : 0
    const amount = chargeAmount(a.amount, balance)
    if (amount <= 0) {
      await prisma.autopayAttempt.updateMany({ where: { id: a.id, status: 'NOTIFIED' }, data: { status: 'SKIPPED', error: 'Already paid' } })
      continue
    }
    // Claim the debit before calling Razorpay: a concurrent or repeated run sees 0 rows.
    const claimed = await prisma.autopayAttempt.updateMany({
      where: { id: a.id, status: 'NOTIFIED' },
      data: { status: 'INITIATED', attemptedAt: now, amount },
    })
    if (claimed.count === 0) continue
    const r = a.mandate.resident
    const notes = {
      kind: 'rent',
      organizationId,
      residentId: r.id,
      invoiceId: a.invoice.id,
      autopayAttemptId: a.id,
    }
    try {
      const order = await createRecurringOrder(creds, {
        amountPaise: toPaise(amount),
        receipt: `${a.invoice.number}-AP${a.attemptNumber}`,
        notes,
      })
      await prisma.autopayAttempt.update({ where: { id: a.id }, data: { orderId: order.id } })
      const result = await createRecurringPayment(creds, {
        email: r.email || r.user?.email || '',
        contact: r.phone,
        amountPaise: toPaise(amount),
        orderId: order.id,
        customerId: a.mandate.customerId,
        tokenId: a.mandate.tokenId,
        description: `Rent ${a.invoice.number}`,
        notes,
      })
      if (result.razorpay_payment_id) {
        await prisma.autopayAttempt.update({ where: { id: a.id }, data: { paymentId: result.razorpay_payment_id } })
      }
      report.charged++
    } catch (error) {
      await failAttempt(a.id, error instanceof Error ? error.message : String(error))
      report.failed++
    }
  }

  // 5. Retries, then the owner alert once retries are used up.
  const failed = await prisma.autopayAttempt.findMany({
    where: { organizationId, status: 'FAILED', alertedAt: null },
    include: { mandate: { include: { resident: { select: { fullName: true } } } }, invoice: { select: { number: true, balance: true, status: true } } },
  })
  for (const f of failed) {
    const later = await prisma.autopayAttempt.count({ where: { invoiceId: f.invoiceId, attemptNumber: { gt: f.attemptNumber } } })
    if (later) continue
    const stillOpen = (OPEN as readonly string[]).includes(f.invoice.status) && f.invoice.balance > 0
    if (!stillOpen || f.mandate.status !== 'ACTIVE') {
      await prisma.autopayAttempt.update({ where: { id: f.id }, data: { alertedAt: now } })
      continue
    }
    const retry = nextRetry({ attemptNumber: f.attemptNumber, retryDays: settings.retryDays, today: now })
    if (retry) {
      const amount = Math.min(f.invoice.balance, f.mandate.maxAmount)
      try {
        await prisma.autopayAttempt.create({
          data: {
            organizationId,
            mandateId: f.mandateId,
            invoiceId: f.invoiceId,
            attemptNumber: retry.attemptNumber,
            amount,
            chargeDate: retry.chargeDate,
            status: 'NOTIFIED',
            notifiedAt: now,
          },
        })
        report.retriesScheduled++
        await sendPreDebitNotice({
          residentId: f.mandate.residentId,
          organizationId,
          amount,
          chargeDate: retry.chargeDate,
          invoiceNumber: f.invoice.number,
          method: f.mandate.method,
          retry: true,
        })
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error
      }
      continue
    }
    await prisma.$transaction([
      prisma.autopayAttempt.update({ where: { id: f.id }, data: { alertedAt: now } }),
      prisma.residentMandate.update({
        where: { id: f.mandateId },
        data: { failureCount: { increment: 1 }, lastError: f.error ?? 'Debit failed' },
      }),
    ])
    report.alerted++
    await notifyResidentUser(f.mandate.residentId, {
      organizationId,
      kind: 'RENT',
      title: 'AutoPay could not collect your rent',
      body: `We tried to debit ${formatMoney(f.amount)} for ${f.invoice.number} ${f.attemptNumber} times and it did not go through. Please pay it from the Rent page.`,
      link: '/tenant/rent',
    })
    await notifyOrgAdmins(organizationId, {
      kind: 'RENT',
      title: 'AutoPay failed — follow up',
      body: `${f.mandate.resident.fullName} · ${f.invoice.number}: ${f.attemptNumber} debit attempts failed (${f.error ?? 'declined'}).`,
      link: '/app/rent',
    }).catch(() => undefined)
  }
}

/**
 * The pre-debit notice. It is a legal requirement, so it is not subject to the
 * owner's notification switches. (For UPI, Razorpay/NPCI also send their own.)
 */
async function sendPreDebitNotice(p: {
  residentId: string
  organizationId: string
  amount: number
  chargeDate: Date
  invoiceNumber: string
  method: string
  retry?: boolean
}) {
  await notifyResidentUser(p.residentId, {
    organizationId: p.organizationId,
    kind: 'RENT',
    title: p.retry ? 'AutoPay will try again tomorrow' : `AutoPay: ${formatMoney(p.amount)} on ${dateLabel(p.chargeDate)}`,
    body: `${formatMoney(p.amount)} for ${p.invoiceNumber} will be debited on ${dateLabel(p.chargeDate)} by ${
      METHOD_LABEL[p.method as AutopayMethod] ?? 'AutoPay'
    }. Pay it yourself before then, or cancel AutoPay from the Rent page, if you prefer.`,
    link: '/tenant/rent',
  })
}

async function notifyResidentUser(residentId: string, input: Parameters<typeof notifyUsers>[1]) {
  const r = await prisma.resident.findUnique({ where: { id: residentId }, select: { userId: true } })
  if (r?.userId) await notifyUsers([r.userId], input).catch(() => undefined)
}

// --------------------------------------------------------------------------
// Owner view
// --------------------------------------------------------------------------

export async function listMandates(params: { organizationId: string; propertyIds: string[] }) {
  const mandates = await prisma.residentMandate.findMany({
    where: { organizationId: params.organizationId, propertyId: { in: params.propertyIds }, status: { in: [...LIVE, 'FAILED'] } },
    orderBy: { createdAt: 'desc' },
    include: {
      resident: {
        select: { id: true, fullName: true, code: true, rentDueDay: true, bed: { select: { label: true, room: { select: { number: true } } } } },
      },
      attempts: { orderBy: { createdAt: 'desc' }, take: 3, include: { invoice: { select: { number: true } } } },
    },
  })
  const settings = await autopaySettings(params.organizationId)
  const window = { min: settings.dayMin, max: settings.dayMax }
  const attempts = await prisma.autopayAttempt.findMany({
    where: { organizationId: params.organizationId, mandate: { propertyId: { in: params.propertyIds } } },
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: { invoice: { select: { number: true } }, mandate: { include: { resident: { select: { fullName: true } } } } },
  })
  const rows = mandates.map((m) => {
    const day = chargeDayOf(m.resident, settings)
    return { m, day, outside: dayProblem(day, window) !== null }
  })
  return {
    window,
    /** Residents on AutoPay whose day is outside the window (still debited on their old day). */
    outsideWindow: rows.filter((r) => r.outside && r.m.status !== 'FAILED').length,
    mandates: rows.map(({ m, day, outside }) => ({
      id: m.id,
      day,
      dayLabel: ordinal(day),
      dayOutsideWindow: outside,
      residentId: m.residentId,
      resident: m.resident.fullName,
      code: m.resident.code,
      room: m.resident.bed ? `${m.resident.bed.room.number}${m.resident.bed.label}` : null,
      status: m.status,
      method: METHOD_LABEL[m.method as AutopayMethod] ?? m.method,
      maxAmount: m.maxAmount,
      lastChargeAt: m.lastChargeAt,
      lastError: m.lastError,
      next: m.attempts.find((a) => a.status === 'NOTIFIED' || a.status === 'INITIATED') ?? null,
    })),
    attempts: attempts.map((a) => ({
      id: a.id,
      resident: a.mandate.resident.fullName,
      invoice: a.invoice.number,
      amount: a.amount,
      chargeDate: a.chargeDate,
      status: a.status,
      error: a.error,
      attemptNumber: a.attemptNumber,
    })),
  }
}
