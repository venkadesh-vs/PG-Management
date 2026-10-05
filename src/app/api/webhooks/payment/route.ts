import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { serverEnv } from '@/lib/env'
import { verifyWebhookSignature } from '@/server/integrations/payments'
import { isUniqueViolation, recordPayment } from '@/server/services/billing'
import { handleError } from '@/lib/api-helpers'

/**
 * Payment gateway webhook — the ONLY place a real online payment is marked
 * paid.
 *
 * The browser is never trusted for this: the resident's app starts an order,
 * the gateway takes the money, and the gateway tells us here. The signature is
 * verified against PAYMENT_WEBHOOK_SECRET before anything is written.
 *
 * With no gateway configured this endpoint rejects everything, so a demo
 * deployment cannot be tricked into recording a payment.
 */
export async function POST(request: Request) {
  try {
    if (!serverEnv.payment.isLive) {
      return NextResponse.json(
        {
          error:
            'No payment gateway is configured on this deployment, so webhooks are not accepted.',
        },
        { status: 503 },
      )
    }

    const raw = await request.text()
    const signature =
      request.headers.get('x-razorpay-signature') ?? request.headers.get('x-webhook-signature')

    if (!verifyWebhookSignature(raw, signature)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    const event = JSON.parse(raw) as {
      event?: string
      payload?: {
        payment?: {
          entity?: {
            id?: string
            order_id?: string
            amount?: number
            status?: string
            notes?: Record<string, string>
          }
        }
      }
    }

    const payment = event.payload?.payment?.entity
    if (!payment?.id || event.event !== 'payment.captured') {
      // Acknowledge anything we do not act on, so the gateway stops retrying.
      return NextResponse.json({ received: true, handled: false })
    }

    const invoiceId = payment.notes?.invoiceId
    const residentId = payment.notes?.residentId
    if (!invoiceId || !residentId) {
      return NextResponse.json(
        { error: 'Payment is missing the invoice reference' },
        { status: 400 },
      )
    }

    const invoice = await prisma.rentInvoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, residentId: true },
    })
    if (!invoice || invoice.residentId !== residentId) {
      return NextResponse.json({ error: 'Unknown invoice' }, { status: 404 })
    }

    // The gateway reports paise; this product stores whole rupees.
    const amount = Math.round((payment.amount ?? 0) / 100)

    // Idempotency: a gateway may deliver the same event more than once, even
    // concurrently. RentPayment.gatewayPaymentId is unique, so the database
    // rejects the second insert; a check-then-insert here would race.
    let result: Awaited<ReturnType<typeof recordPayment>>
    try {
      result = await recordPayment({
        residentId,
        amount,
        method: 'GATEWAY',
        reference: payment.order_id,
        notes: 'Paid online by the resident',
        invoiceIds: [invoice.id],
        actor: { name: 'Payment gateway' },
        gateway: {
          provider: serverEnv.payment.provider,
          orderId: payment.order_id,
          paymentId: payment.id,
          isDemo: false,
        },
      })
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      const existing = await prisma.rentPayment.findUnique({
        where: { gatewayPaymentId: payment.id },
        select: { receiptNumber: true },
      })
      // A unique clash on anything other than this payment id is a real error.
      if (!existing) throw error
      return NextResponse.json({
        received: true,
        duplicate: true,
        message: 'already processed',
        receipt: existing.receiptNumber,
      })
    }

    return NextResponse.json({
      received: true,
      handled: true,
      receipt: result.payment.receiptNumber,
    })
  } catch (error) {
    return handleError(error)
  }
}
