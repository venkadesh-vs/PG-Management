import { ok, parseBody, route } from '@/lib/api-helpers'
import { assertResidentAccess } from '@/lib/tenancy'
import { paymentSchema } from '@/lib/validation'
import { recordPayment } from '@/server/services/billing'
import { formatMoney } from '@/lib/utils'

/** POST /api/payments — record a rent payment and settle everything downstream. */
export const POST = route(
  async ({ user, request }) => {
    const body = await parseBody(request, paymentSchema)
    await assertResidentAccess(user, body.residentId)

    const result = await recordPayment({
      residentId: body.residentId,
      amount: body.amount,
      method: body.method,
      paidAt: body.paidAt ? new Date(body.paidAt) : undefined,
      reference: body.reference || undefined,
      notes: body.notes || undefined,
      invoiceIds: body.invoiceIds,
      actor: { id: user.id, name: user.name },
    })

    return ok(
      {
        receiptNumber: result.payment.receiptNumber,
        amount: result.payment.amount,
        allocations: result.allocations,
        advance: result.advance,
        message: `${formatMoney(result.payment.amount)} recorded — receipt ${result.payment.receiptNumber}`,
      },
      { status: 201 },
    )
  },
  { roles: ['OWNER', 'MANAGER'] },
)
