import { ok, parseBody, route } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { assertResidentAccess, NotFoundError } from '@/lib/tenancy'
import { chargeActionSchema } from '@/lib/billing-schemas'
import { addCharge, voidCharge } from '@/server/services/billing'
import { formatMoney } from '@/lib/utils'

/**
 * POST /api/charges
 *   ADD  — a recurring charge, one-time charge or discount for a resident
 *   VOID — stop a charge (with a reason); charges are never edited
 */
export const POST = route(
  async ({ user, request }) => {
    const body = await parseBody(request, chargeActionSchema)
    const actor = { id: user.id, name: user.name }
    const organizationId = user.organizationId!

    if (body.action === 'ADD') {
      await assertResidentAccess(user, body.residentId)
      const charge = await addCharge({
        organizationId,
        residentId: body.residentId,
        kind: body.kind,
        category: body.category,
        label: body.label,
        amount: body.amount,
        startDate: new Date(body.startDate),
        endDate: body.endDate ? new Date(body.endDate) : null,
        actor,
      })
      return ok(
        {
          id: charge.id,
          message:
            body.kind === 'ONE_TIME'
              ? `${charge.label} (${formatMoney(charge.amount)}) will be on the next invoice`
              : `${charge.label} added — ${formatMoney(charge.amount)} a month`,
        },
        { status: 201 },
      )
    }

    const charge = await prisma.residentCharge.findFirst({
      where: { id: body.chargeId, organizationId },
      select: { residentId: true },
    })
    if (!charge) throw new NotFoundError('Charge not found')
    await assertResidentAccess(user, charge.residentId)
    const result = await voidCharge({ organizationId, chargeId: body.chargeId, reason: body.reason, actor })
    return ok({
      message: result.creditedInvoice
        ? `Charge voided and credited on ${result.creditedInvoice}`
        : 'Charge voided — it will not be billed again',
    })
  },
  { module: 'rent', permission: 'rent.manage' },
)
