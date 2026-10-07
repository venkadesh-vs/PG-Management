import { ok, parseBody, route } from '@/lib/api-helpers'
import { assertResidentAccess } from '@/lib/tenancy'
import { paymentSchema } from '@/lib/validation'
import { paymentExtrasSchema } from '@/lib/billing-schemas'
import { recordPayment } from '@/server/services/billing'
import { formatMoney } from '@/lib/utils'

const schema = paymentSchema.merge(paymentExtrasSchema)

/**
 * POST /api/payments — record a rent payment and settle everything downstream.
 * `invoiceIds` picks the invoices to pay first (in that order); the rest goes
 * oldest-due first and anything left is kept as an advance.
 */
export const POST = route(
  async ({ user, request }) => {
    const body = await parseBody(request, schema)
    await assertResidentAccess(user, body.residentId)

    const result = await recordPayment({
      residentId: body.residentId,
      amount: body.amount,
      method: body.method,
      paidAt: body.paidAt ? new Date(body.paidAt) : undefined,
      reference: body.reference || undefined,
      utr: body.utr || undefined,
      attachmentUrl: body.attachmentUrl || undefined,
      notes: body.notes || undefined,
      invoiceIds: body.invoiceIds,
      actor: { id: user.id, name: user.name },
    })

    return ok(
      {
        id: result.payment.id,
        receiptNumber: result.payment.receiptNumber,
        amount: result.payment.amount,
        allocations: result.allocations,
        advance: result.advance,
        message: `${formatMoney(result.payment.amount)} recorded — receipt ${result.payment.receiptNumber}`,
      },
      { status: 201 },
    )
  },
  { module: 'rent', permission: 'payments.record' },
)
