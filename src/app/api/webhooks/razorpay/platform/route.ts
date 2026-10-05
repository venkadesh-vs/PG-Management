import { NextResponse } from 'next/server'
import { verifyWebhookSignature, paymentMode } from '@/server/integrations/payments'
import { parseWebhookEvent } from '@/server/integrations/razorpay'
import { handlePlatformWebhook } from '@/server/services/subscriptions'

/**
 * PLATFORM Razorpay webhook (StayFlow's own account, PAYMENT_WEBHOOK_SECRET).
 *
 * Public — no session. The raw body is read as text and its signature
 * verified before anything is parsed or written. Unknown or irrelevant events
 * are acknowledged with 200 so Razorpay stops retrying; only a genuine
 * processing failure returns 500 (which makes Razorpay retry later, and every
 * handler is idempotent on the payment id).
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
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const event = parseWebhookEvent(raw)
  if (!event) return NextResponse.json({ received: true, handled: false, note: 'not JSON' })

  try {
    const result = await handlePlatformWebhook(event)
    return NextResponse.json({ received: true, ...result })
  } catch (error) {
    console.error('[webhooks/razorpay/platform]', event.event, error)
    return NextResponse.json({ error: 'Processing failed; please retry' }, { status: 500 })
  }
}
