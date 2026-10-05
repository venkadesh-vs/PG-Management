import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ok, parseBody, route } from '@/lib/api-helpers'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/tenancy'
import {
  cancelAutopay,
  confirmInvoiceCheckout,
  payInvoiceDemo,
  setupAutopay,
  startInvoiceCheckout,
} from '@/server/services/subscriptions'
import { RazorpayError } from '@/server/integrations/razorpay'
import { formatMoney } from '@/lib/utils'

const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('SETUP_AUTOPAY'),
    subscriptionId: z.string().min(1),
    // Only used by the demo mandate; live AutoPay picks the method on Razorpay.
    kind: z.enum(['UPI_AUTOPAY', 'NACH', 'CARD']).optional(),
    label: z.string().min(1).optional(),
    maskedRef: z.string().max(80).optional(),
  }),
  z.object({ action: z.literal('CANCEL_AUTOPAY'), subscriptionId: z.string().min(1) }),
  z.object({ action: z.literal('PAY_INVOICE_START'), invoiceId: z.string().min(1) }),
  z.object({
    action: z.literal('PAY_INVOICE_VERIFY'),
    invoiceId: z.string().min(1),
    orderId: z.string().min(1),
    paymentId: z.string().min(1),
    signature: z.string().min(1),
  }),
  z.object({ action: z.literal('PAY_INVOICE_DEMO'), invoiceId: z.string().min(1) }),
])

/**
 * The PG owner's own StayFlow billing: AutoPay mandates and Pay now.
 * allowRestricted — a suspended organization must still be able to pay.
 * Every amount comes from the database; the client only names the invoice.
 */
export const POST = route(
  async ({ user, request }) => {
    const body = await parseBody(request, schema)
    const organizationId = user.organizationId
    if (!organizationId) throw new ForbiddenError()

    try {
      if (body.action === 'PAY_INVOICE_START') {
        return ok(
          await startInvoiceCheckout({
            invoiceId: body.invoiceId,
            organizationId,
            payer: { name: user.name, email: user.email },
          }),
        )
      }

      if (body.action === 'PAY_INVOICE_VERIFY') {
        const outcome = await confirmInvoiceCheckout({ ...body, organizationId })
        if (outcome.status === 'ignored') {
          throw new ValidationError(outcome.reason ?? 'The payment could not be verified')
        }
        return ok({
          status: outcome.status,
          reactivated: outcome.reactivated ?? false,
          message:
            outcome.status === 'duplicate'
              ? 'Payment already recorded'
              : `Payment received for ${outcome.invoiceNumber}`,
        })
      }

      if (body.action === 'PAY_INVOICE_DEMO') {
        const outcome = await payInvoiceDemo({
          invoiceId: body.invoiceId,
          organizationId,
          actor: { id: user.id, name: user.name },
        })
        return ok({
          status: outcome.status,
          demo: true,
          reactivated: outcome.reactivated ?? false,
          message: `${outcome.invoiceNumber} marked paid (demo — no money moved)`,
        })
      }

      const subscription = await prisma.subscription.findUnique({
        where: { id: body.subscriptionId },
        include: { property: { select: { name: true } } },
      })
      if (!subscription) throw new NotFoundError('Subscription not found')
      if (subscription.organizationId !== organizationId) throw new ForbiddenError()

      if (body.action === 'CANCEL_AUTOPAY') {
        await cancelAutopay(subscription.id)
        return ok({ message: 'AutoPay switched off' })
      }

      const result = await setupAutopay({
        subscriptionId: subscription.id,
        kind: body.kind,
        label: body.label ?? 'UPI AutoPay',
        maskedRef: body.maskedRef,
        actor: { id: user.id, name: user.name },
      })
      if (result.mode === 'live') {
        return ok({
          mode: 'live',
          redirectUrl: result.redirectUrl,
          message: 'Continue on Razorpay to authorise AutoPay',
        })
      }
      return ok({
        mode: 'demo',
        redirectUrl: null,
        message: `${subscription.property.name} will be charged ${formatMoney(subscription.amount)} automatically each month (demo).`,
      })
    } catch (error) {
      // Gateway errors carry a readable reason; surface it instead of a 500.
      if (error instanceof RazorpayError) throw new ConflictError(error.message)
      throw error
    }
  },
  { roles: ['OWNER'], allowRestricted: true },
)
