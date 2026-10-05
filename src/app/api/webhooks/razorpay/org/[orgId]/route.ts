import { NextResponse } from 'next/server'
import {
  getOrgRazorpay,
  logRentPaymentFailure,
  recordRentGatewayPayment,
} from '@/server/integrations/payments'
import { parseWebhookEvent, verifyWebhookSignature } from '@/server/integrations/razorpay'

/**
 * Per-organization Razorpay webhook — rent paid into the PG owner's own
 * account. The owner pastes `${appUrl}/api/webhooks/razorpay/org/<orgId>` into
 * their Razorpay dashboard with their own webhook secret.
 *
 * Public — no session. Raw body first, then the signature against THIS org's
 * webhook secret, then the payment is matched to the order StayFlow created
 * (notes + amount, fetched from Razorpay). Duplicates and unknown events get
 * 200 so Razorpay stops retrying.
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
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const event = parseWebhookEvent(raw)
  const payment = event?.payload?.payment?.entity
  if (!event || !payment?.id) {
    return NextResponse.json({ received: true, handled: false, note: 'ignored' })
  }

  try {
    if (event.event === 'payment.captured') {
      const outcome = await recordRentGatewayPayment({
        organizationId: orgId,
        creds,
        payment,
        source: 'webhook',
      })
      return NextResponse.json({ received: true, ...outcome })
    }
    if (event.event === 'payment.failed') {
      await logRentPaymentFailure(orgId, payment)
      return NextResponse.json({ received: true, handled: true, note: 'failure logged' })
    }
    return NextResponse.json({ received: true, handled: false, note: `ignored ${event.event}` })
  } catch (error) {
    console.error('[webhooks/razorpay/org]', orgId, event.event, error)
    return NextResponse.json({ error: 'Processing failed; please retry' }, { status: 500 })
  }
}
