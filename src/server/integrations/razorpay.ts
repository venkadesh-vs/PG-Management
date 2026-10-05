import 'server-only'

import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Minimal typed client over the Razorpay REST API.
 *
 * Every call takes the credentials explicitly, because two different accounts
 * are in play: the PLATFORM account (StayFlow's own, from env) collects SaaS
 * subscription fees, and each ORGANIZATION's own account collects its rent.
 * Nothing here reads env or the database.
 *
 * Amounts are in paise, exactly as Razorpay speaks them. Convert at the edge.
 */

const BASE_URL = 'https://api.razorpay.com/v1'

export type RazorpayCredentials = { keyId: string; keySecret: string }

export type RazorpayNotes = Record<string, string>

export type RazorpayOrder = {
  id: string
  entity: 'order'
  amount: number
  amount_paid: number
  amount_due: number
  currency: string
  receipt: string | null
  status: 'created' | 'attempted' | 'paid'
  notes: RazorpayNotes | unknown[]
  created_at: number
}

export type RazorpayPayment = {
  id: string
  entity: 'payment'
  amount: number
  currency: string
  status: 'created' | 'authorized' | 'captured' | 'refunded' | 'failed'
  order_id: string | null
  invoice_id: string | null
  method: string
  description: string | null
  email: string | null
  contact: string | null
  notes: RazorpayNotes | unknown[]
  error_code: string | null
  error_description: string | null
  error_reason?: string | null
  captured?: boolean
  created_at: number
}

export type RazorpayPlan = {
  id: string
  entity: 'plan'
  period: 'daily' | 'weekly' | 'monthly' | 'yearly'
  interval: number
  item: { id: string; name: string; amount: number; currency: string }
}

export type RazorpaySubscriptionStatus =
  | 'created'
  | 'authenticated'
  | 'active'
  | 'pending'
  | 'halted'
  | 'cancelled'
  | 'completed'
  | 'expired'
  | 'paused'

export type RazorpaySubscription = {
  id: string
  entity: 'subscription'
  plan_id: string
  status: RazorpaySubscriptionStatus
  current_start: number | null
  current_end: number | null
  charge_at: number | null
  start_at: number | null
  end_at: number | null
  total_count: number
  paid_count: number
  remaining_count: number
  short_url: string | null
  payment_method?: string | null
  notes: RazorpayNotes | unknown[]
}

/** A Razorpay API error with the message Razorpay itself gave, when it gave one. */
export class RazorpayError extends Error {
  status: number
  code?: string
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'RazorpayError'
    this.status = status
    this.code = code
  }
}

function authHeader(creds: RazorpayCredentials) {
  return `Basic ${Buffer.from(`${creds.keyId}:${creds.keySecret}`).toString('base64')}`
}

async function call<T>(
  creds: RazorpayCredentials,
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  body?: unknown,
): Promise<T> {
  if (!creds.keyId || !creds.keySecret) {
    throw new RazorpayError('Razorpay keys are not configured', 0)
  }
  let res: Response
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: authHeader(creds),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new RazorpayError(`Could not reach Razorpay (${reason})`, 0)
  }

  const text = await res.text()
  let payload: unknown = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = null
  }

  if (!res.ok) {
    const err = (payload as { error?: { code?: string; description?: string } } | null)?.error
    const message =
      res.status === 401
        ? 'Razorpay rejected the API keys (authentication failed)'
        : err?.description
          ? `Razorpay: ${err.description}`
          : `Razorpay request failed (${res.status})`
    throw new RazorpayError(message, res.status, err?.code)
  }
  return payload as T
}

/** Notes come back as `[]` when empty; normalise to an object. */
export function notesOf(entity: { notes?: RazorpayNotes | unknown[] | null } | null | undefined) {
  const notes = entity?.notes
  if (!notes || Array.isArray(notes)) return {} as RazorpayNotes
  return notes as RazorpayNotes
}

// --------------------------------------------------------------------------
// Orders & payments
// --------------------------------------------------------------------------

export function createOrder(
  creds: RazorpayCredentials,
  params: { amountPaise: number; receipt: string; notes?: RazorpayNotes },
) {
  if (!Number.isInteger(params.amountPaise) || params.amountPaise < 100) {
    throw new RazorpayError('Amount must be at least ₹1', 0)
  }
  return call<RazorpayOrder>(creds, 'POST', '/orders', {
    amount: params.amountPaise,
    currency: 'INR',
    // Razorpay caps receipt at 40 characters.
    receipt: params.receipt.slice(0, 40),
    notes: params.notes,
  })
}

export function fetchOrder(creds: RazorpayCredentials, orderId: string) {
  return call<RazorpayOrder>(creds, 'GET', `/orders/${encodeURIComponent(orderId)}`)
}

/** Cheapest authenticated call — used to verify a set of keys before storing them. */
export function listOrders(creds: RazorpayCredentials, params?: { count?: number }) {
  return call<{ entity: 'collection'; count: number; items: RazorpayOrder[] }>(
    creds,
    'GET',
    `/orders?count=${params?.count ?? 1}`,
  )
}

export function fetchPayment(creds: RazorpayCredentials, paymentId: string) {
  return call<RazorpayPayment>(creds, 'GET', `/payments/${encodeURIComponent(paymentId)}`)
}

// --------------------------------------------------------------------------
// Plans & subscriptions (platform AutoPay)
// --------------------------------------------------------------------------

export function createPlan(
  creds: RazorpayCredentials,
  params: {
    period: 'daily' | 'weekly' | 'monthly' | 'yearly'
    interval: number
    name: string
    amountPaise: number
    description?: string
    notes?: RazorpayNotes
  },
) {
  return call<RazorpayPlan>(creds, 'POST', '/plans', {
    period: params.period,
    interval: params.interval,
    item: {
      name: params.name,
      amount: params.amountPaise,
      currency: 'INR',
      description: params.description,
    },
    notes: params.notes,
  })
}

export function createSubscription(
  creds: RazorpayCredentials,
  params: {
    planId: string
    totalCount?: number
    customerNotify?: 0 | 1
    /** Unix seconds; omit to charge the first cycle on authorisation. */
    startAt?: number
    notes?: RazorpayNotes
  },
) {
  return call<RazorpaySubscription>(creds, 'POST', '/subscriptions', {
    plan_id: params.planId,
    total_count: params.totalCount ?? 120,
    quantity: 1,
    customer_notify: params.customerNotify ?? 1,
    ...(params.startAt ? { start_at: params.startAt } : {}),
    notes: params.notes,
  })
}

export function fetchSubscription(creds: RazorpayCredentials, subscriptionId: string) {
  return call<RazorpaySubscription>(
    creds,
    'GET',
    `/subscriptions/${encodeURIComponent(subscriptionId)}`,
  )
}

export function cancelSubscription(
  creds: RazorpayCredentials,
  subscriptionId: string,
  params?: { atCycleEnd?: boolean },
) {
  return call<RazorpaySubscription>(
    creds,
    'POST',
    `/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`,
    { cancel_at_cycle_end: params?.atCycleEnd ? 1 : 0 },
  )
}

/** Subscription states from which Razorpay will never charge again. */
export const TERMINAL_SUBSCRIPTION_STATES: RazorpaySubscriptionStatus[] = [
  'cancelled',
  'completed',
  'expired',
]

// --------------------------------------------------------------------------
// Signatures
// --------------------------------------------------------------------------

function safeEqualHex(expected: string, given: string) {
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(given, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** X-Razorpay-Signature = HMAC-SHA256(rawBody, webhookSecret), hex. */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string | null | undefined,
  secret: string | null | undefined,
) {
  if (!signature || !secret) return false
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  return safeEqualHex(expected, signature)
}

/** Checkout handler signature = HMAC-SHA256(`${orderId}|${paymentId}`, keySecret), hex. */
export function verifyCheckoutSignature(params: {
  orderId: string
  paymentId: string
  signature: string
  keySecret: string
}) {
  if (!params.signature || !params.keySecret) return false
  const expected = createHmac('sha256', params.keySecret)
    .update(`${params.orderId}|${params.paymentId}`)
    .digest('hex')
  return safeEqualHex(expected, params.signature)
}

export function toPaise(rupees: number) {
  return Math.round(rupees * 100)
}

export function fromPaise(paise: number) {
  return Math.round(paise / 100)
}

/** The parts of a Razorpay webhook body StayFlow reads. */
export type RazorpayWebhookEvent = {
  event?: string
  account_id?: string
  created_at?: number
  payload?: {
    payment?: { entity?: RazorpayPayment }
    order?: { entity?: RazorpayOrder }
    subscription?: { entity?: RazorpaySubscription }
  }
}

/** Parses a webhook body; returns null for anything that is not JSON. */
export function parseWebhookEvent(rawBody: string): RazorpayWebhookEvent | null {
  try {
    const parsed = JSON.parse(rawBody) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as RazorpayWebhookEvent) : null
  } catch {
    return null
  }
}
