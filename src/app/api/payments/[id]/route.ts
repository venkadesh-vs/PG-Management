import { ok, parseBody, route } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { assertInScope, NotFoundError, requirePermission } from '@/lib/tenancy'
import { paymentActionSchema, paymentEditSchema } from '@/lib/billing-schemas'
import { editPayment, refundPayment, reversePayment } from '@/server/services/billing'
import { formatMoney } from '@/lib/utils'

/** The payment id from /api/payments/<id>, checked against the user's PGs. */
async function paymentFor(request: Request, user: { organizationId: string | null }) {
  const id = decodeURIComponent(new URL(request.url).pathname.split('/').filter(Boolean).pop() ?? '')
  const payment = await prisma.rentPayment.findFirst({
    where: { id, organizationId: user.organizationId ?? '__none__' },
    select: { id: true, propertyId: true, receiptNumber: true },
  })
  if (!payment) throw new NotFoundError('Payment not found')
  return payment
}

/**
 * PATCH /api/payments/<id> — edit notes, reference, UTR or proof. Amount,
 * date and method never change here: reverse and record again instead.
 */
export const PATCH = route(
  async ({ user, request }) => {
    const payment = await paymentFor(request, user)
    assertInScope(user, payment.propertyId)
    const body = await parseBody(request, paymentEditSchema)
    const result = await editPayment({
      organizationId: user.organizationId!,
      paymentId: payment.id,
      changes: {
        notes: body.notes,
        reference: body.reference,
        utr: body.utr,
        attachmentUrl: body.attachmentUrl === '' ? null : body.attachmentUrl,
      },
      actor: { id: user.id, name: user.name },
    })
    return ok({ message: result.changed ? `${payment.receiptNumber} updated` : 'Nothing to change' })
  },
  { module: 'rent', permission: 'payments.record' },
)

/**
 * POST /api/payments/<id> — REVERSE (wrong entry, bounced cheque) or REFUND
 * (unapplied money). Both move money already counted, so on top of
 * payments.record they need invoices.waive — the same permission that lets
 * someone write off dues (see tenancy 'payment:refund').
 */
export const POST = route(
  async ({ user, request }) => {
    requirePermission(user, 'invoices.waive')
    const payment = await paymentFor(request, user)
    assertInScope(user, payment.propertyId)
    const body = await parseBody(request, paymentActionSchema)
    const actor = { id: user.id, name: user.name }

    if (body.action === 'REVERSE') {
      const result = await reversePayment({
        organizationId: user.organizationId!,
        paymentId: payment.id,
        reason: body.reason,
        actor,
      })
      return ok({
        message: result.reopened.length
          ? `${payment.receiptNumber} reversed — ${result.reopened.join(', ')} reopened`
          : `${payment.receiptNumber} reversed`,
      })
    }

    await refundPayment({
      organizationId: user.organizationId!,
      paymentId: payment.id,
      amount: body.amount,
      method: body.method,
      reference: body.reference,
      reason: body.reason,
      actor,
    })
    return ok({ message: `${formatMoney(body.amount)} refunded from ${payment.receiptNumber}` })
  },
  { module: 'rent', permission: 'payments.record' },
)
