import { POST as platformWebhook } from '../razorpay/platform/route'

/**
 * Legacy webhook URL, kept so existing Razorpay dashboard configurations keep
 * working. It is the PLATFORM webhook (PAYMENT_WEBHOOK_SECRET) and delegates
 * to /api/webhooks/razorpay/platform, which also still records legacy rent
 * orders that were created on the platform account (notes invoiceId +
 * residentId). New set-ups should use /api/webhooks/razorpay/platform for the
 * platform and /api/webhooks/razorpay/org/<orgId> for each PG owner.
 */
export async function POST(request: Request) {
  return platformWebhook(request)
}
