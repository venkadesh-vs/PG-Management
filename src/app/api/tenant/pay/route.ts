import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ok, parseBody, route } from '@/lib/api-helpers'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/tenancy'
import {
  confirmRentCheckout,
  createOrder,
  createRentOrder,
  getOrgRazorpay,
  noteOrgRazorpayError,
  paymentMode,
} from '@/server/integrations/payments'
import { RazorpayError, toPaise } from '@/server/integrations/razorpay'
import { outstandingFor, recordPayment } from '@/server/services/billing'
import { buildUpiLink } from '@/server/integrations/whatsapp'
import { formatMoney } from '@/lib/utils'

/**
 * Resident-initiated rent payment.
 *
 * START   — the amount is computed here from the database: one invoice's
 *           balance, or (no invoiceId) the resident's whole outstanding.
 *           • PG connected Razorpay → an order on the PG OWNER's own account;
 *             the client opens Razorpay Checkout.
 *           • otherwise → the UPI deep link / copy-UPI fallback (the owner
 *             reconciles by hand), plus a labelled demo order on a demo
 *             deployment.
 * VERIFY  — Checkout's success callback. The signature is checked with the
 *           PG's key secret AND the payment is fetched from Razorpay (status,
 *           order, amount) before it is recorded. The org webhook records the
 *           same payment idempotently if it arrives first.
 * CONFIRM — demo deployments only; records a payment flagged isDemo.
 */
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('START'), invoiceId: z.string().min(1).optional() }),
  z.object({
    action: z.literal('VERIFY'),
    orderId: z.string().min(1),
    paymentId: z.string().min(1),
    signature: z.string().min(1),
  }),
  z.object({
    action: z.literal('CONFIRM'),
    invoiceId: z.string().min(1).optional(),
    orderId: z.string().min(1),
  }),
])

const OPEN = ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] as const

/** The amount being paid and the invoice it targets (null = all outstanding). */
async function resolveTarget(residentId: string, invoiceId?: string) {
  if (invoiceId) {
    const invoice = await prisma.rentInvoice.findUnique({ where: { id: invoiceId } })
    if (!invoice) throw new NotFoundError('Invoice not found')
    if (invoice.residentId !== residentId) throw new ForbiddenError('Not your invoice')
    if (invoice.balance <= 0 || !(OPEN as readonly string[]).includes(invoice.status)) {
      throw new ValidationError('This invoice is already paid')
    }
    return { amount: invoice.balance, invoice, label: invoice.number }
  }
  const amount = await outstandingFor(residentId)
  if (amount <= 0) throw new ValidationError('Nothing is due right now')
  return { amount, invoice: null, label: 'All outstanding rent' }
}

export const POST = route(
  async ({ user, request }) => {
    const body = await parseBody(request, schema)
    if (!user.residentId) throw new ForbiddenError()

    const resident = await prisma.resident.findUnique({
      where: { id: user.residentId },
      include: {
        organization: { include: { settings: true } },
        property: { select: { name: true } },
      },
    })
    if (!resident) throw new NotFoundError('Resident not found')

    // --- VERIFY (Razorpay Checkout callback) --------------------------------
    if (body.action === 'VERIFY') {
      let outcome
      try {
        outcome = await confirmRentCheckout({
          organizationId: resident.organizationId,
          residentId: resident.id,
          orderId: body.orderId,
          paymentId: body.paymentId,
          signature: body.signature,
        })
      } catch (error) {
        if (error instanceof RazorpayError) {
          throw new ValidationError(
            `We could not confirm the payment with Razorpay yet (${error.message}). If money left your account, your receipt will appear automatically.`,
          )
        }
        throw error
      }
      if (outcome.status !== 'recorded') throw new ValidationError(outcome.reason)
      return ok({
        receiptNumber: outcome.receiptNumber,
        amount: outcome.amount,
        demo: false,
        duplicate: outcome.duplicate,
        message: `${formatMoney(outcome.amount)} received — receipt ${outcome.receiptNumber}`,
      })
    }

    const target = await resolveTarget(resident.id, body.invoiceId)
    const demo = paymentMode() === 'demo'

    // --- START --------------------------------------------------------------
    if (body.action === 'START') {
      const settings = resident.organization.settings
      const upiLink =
        settings?.upiId && settings.upiPayeeName
          ? buildUpiLink({
              upiId: settings.upiId,
              payeeName: settings.upiPayeeName,
              amount: target.amount,
              note: `Rent ${target.invoice?.number ?? resident.code}`,
            })
          : null
      const upi = { upiLink, upiId: settings?.upiId ?? null }

      const creds = await getOrgRazorpay(resident.organizationId)
      let gatewayError: string | null = null
      if (creds) {
        try {
          const notes: Record<string, string> = {
            kind: 'rent',
            organizationId: resident.organizationId,
            residentId: resident.id,
            ...(target.invoice ? { invoiceId: target.invoice.id } : {}),
          }
          const order = await createRentOrder({
            creds,
            amount: target.amount,
            receipt: target.invoice?.number ?? `${resident.code}-${Date.now().toString(36)}`,
            notes,
          })
          return ok({
            mode: 'razorpay' as const,
            demo: false,
            orderId: order.id,
            keyId: creds.keyId,
            amount: target.amount,
            amountPaise: toPaise(target.amount),
            currency: 'INR',
            name: resident.property.name,
            description: target.label,
            prefill: {
              name: resident.fullName,
              email: resident.email ?? user.email ?? '',
              contact: resident.phone,
            },
            notes,
            invoiceNumber: target.invoice?.number ?? null,
            ...upi,
          })
        } catch (error) {
          if (!(error instanceof RazorpayError)) throw error
          // Keys revoked or Razorpay down: tell the owner, and let the
          // resident still pay by UPI rather than hit a dead end.
          console.error('[tenant/pay] Razorpay order failed', error.message)
          await noteOrgRazorpayError(creds.credentialId, error.message)
          gatewayError = 'Online card/UPI checkout is unavailable right now.'
        }
      }

      if (demo) {
        const order = await createOrder({
          amount: target.amount,
          receipt: target.invoice?.number ?? resident.code,
          notes: { residentId: resident.id, invoiceId: target.invoice?.id ?? '' },
        })
        return ok({
          mode: 'demo' as const,
          demo: true,
          orderId: order.id,
          amount: target.amount,
          invoiceNumber: target.invoice?.number ?? null,
          gatewayError,
          ...upi,
        })
      }

      if (!upi.upiLink && !upi.upiId) {
        throw new ValidationError(
          gatewayError ??
            'Your PG has not set up online payments yet. Please pay your PG owner directly.',
        )
      }
      return ok({
        mode: 'upi' as const,
        demo: false,
        orderId: null,
        amount: target.amount,
        invoiceNumber: target.invoice?.number ?? null,
        gatewayError,
        ...upi,
      })
    }

    // --- CONFIRM (demo only) -------------------------------------------------
    if (!demo) {
      // Never trust the browser for a real payment.
      throw new ValidationError(
        'This payment must be confirmed by the payment gateway. Complete the checkout and your receipt will appear automatically.',
      )
    }
    if (!body.orderId.startsWith('demo_order_')) {
      throw new ValidationError('Invalid demo order')
    }

    const result = await recordPayment({
      residentId: resident.id,
      amount: target.amount,
      method: 'GATEWAY',
      reference: body.orderId,
      notes: 'Paid from the resident app (demo payment — no money moved)',
      invoiceIds: target.invoice ? [target.invoice.id] : undefined,
      actor: { id: user.id, name: resident.fullName },
      gateway: { provider: 'demo', orderId: body.orderId, isDemo: true },
    })

    return ok({
      receiptNumber: result.payment.receiptNumber,
      amount: result.payment.amount,
      demo: true,
      message: `${formatMoney(result.payment.amount)} recorded — receipt ${result.payment.receiptNumber}`,
    })
  },
  { roles: ['TENANT'] },
)
