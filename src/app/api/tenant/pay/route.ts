import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ok, parseBody, route } from '@/lib/api-helpers'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/tenancy'
import { createOrder, paymentMode } from '@/server/integrations/payments'
import { recordPayment } from '@/server/services/billing'
import { buildUpiLink } from '@/server/integrations/whatsapp'
import { formatMoney } from '@/lib/utils'

/**
 * Resident-initiated rent payment.
 *
 * START     — creates a gateway order (or a labelled demo order) and returns
 *             the UPI deep link where the PG has configured one.
 * CONFIRM   — demo mode only. Records a payment that is flagged `isDemo` end
 *             to end. With a live gateway this endpoint refuses, because the
 *             only thing allowed to mark a real payment paid is the verified
 *             webhook at /api/webhooks/payment.
 */
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('START'), invoiceId: z.string().min(1) }),
  z.object({
    action: z.literal('CONFIRM'),
    invoiceId: z.string().min(1),
    orderId: z.string().min(1),
  }),
])

export const POST = route(
  async ({ user, request }) => {
    const body = await parseBody(request, schema)

    const invoice = await prisma.rentInvoice.findUnique({
      where: { id: body.invoiceId },
      include: {
        resident: { select: { id: true, fullName: true } },
        organization: { include: { settings: true } },
        property: { select: { name: true } },
      },
    })
    if (!invoice) throw new NotFoundError('Invoice not found')
    if (invoice.residentId !== user.residentId) throw new ForbiddenError('Not your invoice')
    if (invoice.balance <= 0) throw new ValidationError('This invoice is already paid')

    const demo = paymentMode() === 'demo'

    if (body.action === 'START') {
      const order = await createOrder({
        amount: invoice.balance,
        receipt: invoice.number,
        notes: { invoiceId: invoice.id, residentId: invoice.residentId },
      })

      const settings = invoice.organization.settings
      const upiLink =
        settings?.upiId && settings.upiPayeeName
          ? buildUpiLink({
              upiId: settings.upiId,
              payeeName: settings.upiPayeeName,
              amount: invoice.balance,
              note: `Rent ${invoice.number}`,
            })
          : null

      return ok({
        orderId: order.id,
        amount: order.amount,
        demo: order.isDemo,
        upiLink,
        upiId: settings?.upiId ?? null,
        invoiceNumber: invoice.number,
      })
    }

    // --- CONFIRM ----------------------------------------------------------
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
      residentId: invoice.residentId,
      amount: invoice.balance,
      method: 'GATEWAY',
      reference: body.orderId,
      notes: 'Paid from the resident app (demo payment — no money moved)',
      invoiceIds: [invoice.id],
      actor: { id: user.id, name: invoice.resident.fullName },
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
