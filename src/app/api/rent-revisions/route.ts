import { ok, parseBody, route } from '@/lib/api-helpers'
import { assertResidentAccess } from '@/lib/tenancy'
import { rentRevisionSchema } from '@/lib/billing-schemas'
import { reviseRent } from '@/server/services/billing'
import { formatMoney } from '@/lib/utils'

/**
 * POST /api/rent-revisions — change a resident's rent from a date. Months
 * already invoiced from that date get a credit/debit note for the difference.
 */
export const POST = route(
  async ({ user, request }) => {
    const body = await parseBody(request, rentRevisionSchema)
    await assertResidentAccess(user, body.residentId)
    const result = await reviseRent({
      organizationId: user.organizationId!,
      residentId: body.residentId,
      newRent: body.newRent,
      effectiveFrom: new Date(body.effectiveFrom),
      reason: body.reason,
      actor: { id: user.id, name: user.name },
    })
    const notes = result.adjustments.length
      ? ` ${result.adjustments
          .map((a) => `${a.kind === 'DEBIT' ? 'Debit' : 'Credit'} note ${formatMoney(a.amount)} on ${a.invoice}`)
          .join('; ')}.`
      : ''
    return ok(
      { id: result.revision.id, message: `Rent is ${formatMoney(body.newRent)} from the chosen date.${notes}` },
      { status: 201 },
    )
  },
  { module: 'rent', permission: 'rent.manage' },
)
