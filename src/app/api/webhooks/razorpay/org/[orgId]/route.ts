import { NextResponse } from 'next/server'
import { getOrgRazorpay, handleOrgWebhook } from '@/server/integrations/payments'
import { parseWebhookEvent, verifyWebhookSignature } from '@/server/integrations/razorpay'
import { runLoggedWebhook, webhookEventKey } from '@/server/services/webhook-log'

/**
 * Per-organization Razorpay webhook — rent paid into the PG owner's own
 * account. The owner pastes `${appUrl}/api/webhooks/razorpay/org/<orgId>` into
 * their Razorpay dashboard with their own webhook secret.
 *
 * Public — no session. Raw body first, then the signature against THIS org's
 * webhook secret (bad signature → 400), then the payment is matched to the
 * order StayFlow created (notes + amount, fetched from Razorpay).
 *
 * Idempotent: recorded as a WebhookEvent keyed by Razorpay's event id before
 * processing; redeliveries of a processed event answer 200 "already
 * processed". Failures are stored as FAILED and answered 200.
 *
 * Events: payment.captured (records the payment unless the checkout callback
 * already did), payment.failed (logged).
 */
export async function POST(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params
  const raw = await request.text()
  const signature = request.headers.get('x-razorpay-signature')

  const creds = await getOrgRazorpay(orgId)
  if (!creds?.webhookSecret) {
    return NextResponse.json({ error: 'Razorpay is not connected for this account' }, { status: 404 })
  }
  if (!verifyWebhookSignature(raw, signature, creds.webhookSecret)) {
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
    // The org id travels with the stored payload so a FAILED event can be replayed.
    payload: { ...event, _stayflowOrgId: orgId },
    handler: () => handleOrgWebhook(orgId, creds, event),
  })
  if (outcome.duplicate) {
    return NextResponse.json({ received: true, duplicate: true, note: 'already processed' })
  }
  return NextResponse.json({ received: true, ...outcome })
}
