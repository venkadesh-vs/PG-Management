import 'server-only'

import { createHmac, randomBytes } from 'node:crypto'
import { serverEnv } from '@/lib/env'
import { prisma } from '@/lib/prisma'
import { decryptJson } from '@/lib/crypto'
import { recordActivity } from '../events'
import { recordGatewayPayment } from '../services/billing'
import {
  createOrder as rzpCreateOrder,
  fetchOrder,
  fetchPayment,
  fromPaise,
  notesOf,
  toPaise,
  verifyCheckoutSignature,
  verifyWebhookSignature as rzpVerifyWebhook,
  type RazorpayCredentials,
  type RazorpayNotes,
  type RazorpayOrder,
  type RazorpayPayment,
} from './razorpay'

/**
 * Payment gateway plumbing. Two accounts, never mixed:
 *
 * PLATFORM — StayFlow's own Razorpay account (env PAYMENT_*). Collects the SaaS
 *            subscription: one-off "Pay now" orders and Razorpay Subscriptions
 *            (AutoPay). Without keys the platform runs in demo mode: every
 *            record is flagged `isDemo` and labelled DEMO in the UI.
 * ORG      — each PG owner's own Razorpay account (IntegrationCredential
 *            RAZORPAY, secrets encrypted). Collects rent straight into the
 *            owner's bank. Without it, rent falls back to the UPI deep link
 *            (manual reconciliation) or, on a demo deployment, a demo payment.
 *
 * A real payment is only ever recorded after the server has verified it with
 * Razorpay itself (signature + a fetch of the payment), or from a webhook whose
 * signature checks out. The browser's word is never enough.
 */

export type GatewayOrder = {
  id: string
  amount: number
  currency: 'INR'
  provider: string
  isDemo: boolean
  /** Opaque token the client posts back for demo confirmation. */
  demoToken?: string
}

export function paymentMode(): 'demo' | 'live' {
  return serverEnv.payment.isLive ? 'live' : 'demo'
}

/** The platform's own Razorpay keys, or null in demo mode. */
export function platformRazorpay(): RazorpayCredentials | null {
  if (!serverEnv.payment.isLive) return null
  return { keyId: serverEnv.payment.keyId, keySecret: serverEnv.payment.keySecret }
}

/**
 * Platform order (SaaS invoices). In demo mode returns a local, clearly-fake
 * order id that only the demo confirmation path accepts.
 */
export async function createOrder(params: {
  amount: number
  receipt: string
  notes?: Record<string, string>
}): Promise<GatewayOrder> {
  const creds = platformRazorpay()
  if (!creds) {
    return {
      id: `demo_order_${randomBytes(8).toString('hex')}`,
      amount: params.amount,
      currency: 'INR',
      provider: 'demo',
      isDemo: true,
      demoToken: randomBytes(16).toString('hex'),
    }
  }
  const order = await rzpCreateOrder(creds, {
    amountPaise: toPaise(params.amount),
    receipt: params.receipt,
    notes: params.notes,
  })
  return { id: order.id, amount: params.amount, currency: 'INR', provider: 'razorpay', isDemo: false }
}

/**
 * Verifies a PLATFORM webhook. Returns false in demo mode — a demo deployment
 * must never accept a webhook as proof of payment.
 */
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  if (!serverEnv.payment.isLive) return false
  return rzpVerifyWebhook(rawBody, signature, serverEnv.payment.webhookSecret)
}

/** Verifies a PLATFORM checkout handshake signature (order_id|payment_id). */
export function verifyPaymentSignature(params: {
  orderId: string
  paymentId: string
  signature: string
}): boolean {
  if (!serverEnv.payment.isLive) return false
  return verifyCheckoutSignature({ ...params, keySecret: serverEnv.payment.keySecret })
}

/**
 * Simulated recurring debit for SaaS AutoPay. In demo mode the outcome is
 * deterministic per invoice so a demo can show both success and the failure →
 * grace → retry path without pretending a real charge happened.
 */
export function simulateAutopayDebit(seed: string): { success: boolean; reason?: string } {
  const hash = createHmac('sha256', 'stayflow-demo-autopay').update(seed).digest()
  const roll = hash[0] % 10
  if (roll === 0) return { success: false, reason: 'Insufficient balance (demo simulation)' }
  if (roll === 1) return { success: false, reason: 'Mandate limit exceeded (demo simulation)' }
  return { success: true }
}

// --------------------------------------------------------------------------
// Organization (PG owner) Razorpay account
// --------------------------------------------------------------------------

export type OrgRazorpay = RazorpayCredentials & { webhookSecret: string; credentialId: string }

type OrgRazorpaySecrets = { keySecret: string; webhookSecret: string }

/** The organization's own connected Razorpay keys, or null when not connected. */
export async function getOrgRazorpay(organizationId: string): Promise<OrgRazorpay | null> {
  const credential = await prisma.integrationCredential.findUnique({
    where: { organizationId_kind: { organizationId, kind: 'RAZORPAY' } },
  })
  if (!credential || !credential.active) return null
  try {
    const secrets = decryptJson<OrgRazorpaySecrets>(credential.secretCipher)
    if (!secrets.keySecret) return null
    return {
      keyId: credential.publicId,
      keySecret: secrets.keySecret,
      webhookSecret: secrets.webhookSecret ?? '',
      credentialId: credential.id,
    }
  } catch (error) {
    // A rotated DATA_ENCRYPTION_KEY makes stored secrets unreadable. Fall back
    // to UPI rather than breaking the rent page, and tell the owner why.
    console.error('[payments] could not decrypt Razorpay credential', { organizationId, error })
    await prisma.integrationCredential
      .update({
        where: { id: credential.id },
        data: { lastError: 'Stored keys could not be decrypted — please reconnect Razorpay.' },
      })
      .catch(() => undefined)
    return null
  }
}

/** Records the last gateway error against the org's credential (shown in settings). */
export async function noteOrgRazorpayError(credentialId: string, message: string | null) {
  await prisma.integrationCredential
    .update({ where: { id: credentialId }, data: { lastError: message } })
    .catch(() => undefined)
}

/** Creates a rent order on the ORGANIZATION's own Razorpay account. */
export async function createRentOrder(params: {
  creds: OrgRazorpay
  amount: number
  receipt: string
  notes: RazorpayNotes
}): Promise<RazorpayOrder> {
  return rzpCreateOrder(params.creds, {
    amountPaise: toPaise(params.amount),
    receipt: params.receipt,
    notes: params.notes,
  })
}

export type RentGatewayOutcome =
  | { status: 'recorded'; receiptNumber: string; amount: number; duplicate: boolean }
  | { status: 'ignored'; reason: string }

/**
 * Records a rent payment that Razorpay has confirmed on the org's account.
 * Shared by the checkout callback and the org webhook, so whichever arrives
 * first records it and the other sees a duplicate (gatewayPaymentId unique).
 *
 * `payment` must come from Razorpay (a fetch or a signed webhook) — never from
 * the browser. The order is fetched for its notes and amount, which the server
 * set when it created it.
 */
export async function recordRentGatewayPayment(params: {
  organizationId: string
  creds: OrgRazorpay
  payment: RazorpayPayment
  signature?: string
  source: 'checkout' | 'webhook'
  /** When set (checkout path), the resident who must own the order. */
  expectResidentId?: string
}): Promise<RentGatewayOutcome> {
  const { payment } = params
  if (payment.status !== 'captured' && payment.status !== 'authorized') {
    return { status: 'ignored', reason: `Payment is ${payment.status}` }
  }
  if (!payment.order_id) return { status: 'ignored', reason: 'Payment has no order' }

  const order = await fetchOrder(params.creds, payment.order_id)
  const notes = { ...notesOf(payment), ...notesOf(order) }

  if (notes.kind !== 'rent' || notes.organizationId !== params.organizationId) {
    return { status: 'ignored', reason: 'Not a StayFlow rent order for this organization' }
  }
  if (payment.amount !== order.amount || payment.currency !== 'INR') {
    return { status: 'ignored', reason: 'Payment amount does not match the order' }
  }
  if (params.expectResidentId && notes.residentId !== params.expectResidentId) {
    return { status: 'ignored', reason: 'This payment belongs to another resident' }
  }

  const resident = await prisma.resident.findUnique({
    where: { id: notes.residentId ?? '' },
    select: { id: true, organizationId: true, fullName: true },
  })
  if (!resident || resident.organizationId !== params.organizationId) {
    return { status: 'ignored', reason: 'Unknown resident' }
  }

  let invoiceIds: string[] | undefined
  if (notes.invoiceId) {
    const invoice = await prisma.rentInvoice.findUnique({
      where: { id: notes.invoiceId },
      select: { id: true, residentId: true },
    })
    if (invoice?.residentId === resident.id) invoiceIds = [invoice.id]
  }

  const result = await recordGatewayPayment({
    residentId: resident.id,
    amount: fromPaise(payment.amount),
    method: payment.method === 'upi' ? 'UPI' : 'GATEWAY',
    reference: payment.id,
    notes: `Paid online via Razorpay (${payment.method})`,
    invoiceIds,
    actor: { name: params.source === 'checkout' ? resident.fullName : 'Razorpay' },
    gateway: {
      provider: 'razorpay',
      orderId: payment.order_id,
      paymentId: payment.id,
      signature: params.signature,
      isDemo: false,
    },
  })

  return {
    status: 'recorded',
    receiptNumber: result.payment.receiptNumber,
    amount: result.payment.amount,
    duplicate: result.duplicate,
  }
}

/** Checkout callback path for rent: signature, then a fetch from Razorpay. */
export async function confirmRentCheckout(params: {
  organizationId: string
  residentId: string
  orderId: string
  paymentId: string
  signature: string
}): Promise<RentGatewayOutcome> {
  const creds = await getOrgRazorpay(params.organizationId)
  if (!creds) return { status: 'ignored', reason: 'Online payments are not connected for this PG' }
  const valid = verifyCheckoutSignature({
    orderId: params.orderId,
    paymentId: params.paymentId,
    signature: params.signature,
    keySecret: creds.keySecret,
  })
  if (!valid) return { status: 'ignored', reason: 'Payment signature did not verify' }

  const payment = await fetchPayment(creds, params.paymentId)
  if (payment.order_id !== params.orderId) {
    return { status: 'ignored', reason: 'Payment does not belong to this order' }
  }
  return recordRentGatewayPayment({
    organizationId: params.organizationId,
    creds,
    payment,
    signature: params.signature,
    source: 'checkout',
    expectResidentId: params.residentId,
  })
}

/** Logs a failed rent payment reported by the org's webhook. */
export async function logRentPaymentFailure(organizationId: string, payment: RazorpayPayment) {
  const notes = notesOf(payment)
  console.info('[payments] rent payment failed', {
    organizationId,
    paymentId: payment.id,
    orderId: payment.order_id,
    reason: payment.error_description,
  })
  await recordActivity({
    organizationId,
    actorName: 'Razorpay',
    event: 'PAYMENT_FAILED',
    entityType: 'RentPayment',
    entityId: payment.id,
    summary: `Online rent payment of ₹${fromPaise(payment.amount)} failed${
      payment.error_description ? ` — ${payment.error_description}` : ''
    }`,
    meta: { residentId: notes.residentId ?? null, orderId: payment.order_id },
  }).catch(() => undefined)
}

/**
 * Dispatches an ORG webhook whose signature the route already verified.
 * Returns handled:false for anything irrelevant (logged as IGNORED);
 * throws only for genuine processing failures (logged as FAILED).
 */
export async function handleOrgWebhook(
  organizationId: string,
  creds: OrgRazorpay,
  event: { event?: string; payload?: { payment?: { entity?: RazorpayPayment } } },
): Promise<{ handled: boolean; note: string }> {
  const payment = event.payload?.payment?.entity
  if (!payment?.id) return { handled: false, note: 'no payment entity' }
  if (event.event === 'payment.captured') {
    const outcome = await recordRentGatewayPayment({ organizationId, creds, payment, source: 'webhook' })
    if (outcome.status === 'ignored') return { handled: false, note: outcome.reason }
    return {
      handled: true,
      note: outcome.duplicate ? 'duplicate' : `receipt ${outcome.receiptNumber}`,
    }
  }
  if (event.event === 'payment.failed') {
    await logRentPaymentFailure(organizationId, payment)
    return { handled: true, note: 'failure logged' }
  }
  return { handled: false, note: `ignored ${event.event ?? 'unknown event'}` }
}
