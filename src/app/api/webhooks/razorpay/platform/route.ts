import { NextResponse } from 'next/server'
import { verifyWebhookSignature, paymentMode } from '@/server/integrations/payments'
import { parseWebhookEvent } from '@/server/integrations/razorpay'
import { handlePlatformWebhook } from '@/server/services/subscriptions'
import { runLoggedWebhook, webhookEventKey } from '@/server/services/webhook-log'

/**
 * PLATFORM Razorpay webhook (StayFlow's own account, PAYMENT_WEBHOOK_SECRET).
 *
 * Public — no session. The raw body is read as text and its signature
 * verified before anything is parsed or written (bad signature → 400).
 *
 * Idempotent: every delivery is first recorded as a WebhookEvent keyed by
 * Razorpay's event id (x-razorpay-event-id, else a hash of the body). A
 * redelivery of an event already PROCESSED/IGNORED answers 200 "already
 * processed" without running again. Processing failures are stored as FAILED
 * (replayed by the nightly job) and still answered 200 so Razorpay does not
 * hammer us; payment-level idempotency (unique gatewayPaymentId) stays as a
 * second line of defence.
 *
 * Events: subscription.authenticated | activated | charged | pending | halted
 * | cancelled | completed, payment.captured, payment.failed.
 */
export async function POST(request: Request) {
  if (paymentMode() === 'demo') {
    return NextResponse.json(
      { error: 'No payment gateway is configured on this deployment, so webhooks are not accepted.' },
      { status: 503 },
    )
  }

  const raw = await request.text()
  const signature =
    request.headers.get('x-razorpay-signature') ?? request.headers.get('x-webhook-signature')
  if (!verifyWebhookSignature(raw, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const event = parseWebhookEvent(raw)
  if (!event) return NextResponse.json({ received: true, handled: false, note: 'not JSON' })

  const outcome = await runLoggedWebhook({
    provider: 'razorpay',
    eventId: webhookEventKey({
      headerId: request.headers.get('x-razorpay-event-id'),
      rawBody: raw,
      parsed: event as { id?: unknown },
    }),
    type: event.event ?? 'unknown',
    payload: event,
    handler: () => handlePlatformWebhook(event),
  })
  if (outcome.duplicate) {
    return NextResponse.json({ received: true, duplicate: true, note: 'already processed' })
  }
  return NextResponse.json({ received: true, ...outcome })
}
