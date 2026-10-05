import 'server-only'

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { serverEnv } from '@/lib/env'

/**
 * Payment gateway abstraction.
 *
 * demo     — creates a local order and a clearly-labelled demo confirmation
 *            step. No money moves; every resulting payment row is flagged
 *            `isDemo` and every receipt is watermarked DEMO.
 * razorpay — creates a real order; the payment is only ever marked paid from
 *            the verified webhook (`verifyWebhookSignature`), never from a
 *            browser callback.
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

export async function createOrder(params: {
  amount: number
  receipt: string
  notes?: Record<string, string>
}): Promise<GatewayOrder> {
  if (!serverEnv.payment.isLive) {
    return {
      id: `demo_order_${randomBytes(8).toString('hex')}`,
      amount: params.amount,
      currency: 'INR',
      provider: 'demo',
      isDemo: true,
      demoToken: randomBytes(16).toString('hex'),
    }
  }

  const auth = Buffer.from(`${serverEnv.payment.keyId}:${serverEnv.payment.keySecret}`).toString(
    'base64',
  )
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: params.amount * 100, // gateway works in paise
      currency: 'INR',
      receipt: params.receipt,
      notes: params.notes,
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Payment gateway rejected the order: ${res.status} ${text}`)
  }
  const order = (await res.json()) as { id: string }
  return {
    id: order.id,
    amount: params.amount,
    currency: 'INR',
    provider: serverEnv.payment.provider,
    isDemo: false,
  }
}

/**
 * Verifies a gateway webhook. Returns false in demo mode — a demo deployment
 * must never accept a webhook as proof of payment.
 */
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  if (!serverEnv.payment.isLive || !serverEnv.payment.webhookSecret || !signature) return false
  const expected = createHmac('sha256', serverEnv.payment.webhookSecret)
    .update(rawBody)
    .digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** Verifies the checkout handshake signature (order_id|payment_id). */
export function verifyPaymentSignature(params: {
  orderId: string
  paymentId: string
  signature: string
}): boolean {
  if (!serverEnv.payment.isLive) return false
  const expected = createHmac('sha256', serverEnv.payment.keySecret)
    .update(`${params.orderId}|${params.paymentId}`)
    .digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(params.signature)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
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
