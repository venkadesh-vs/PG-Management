import { z } from 'zod'
import { ok, parseBody, route } from '@/lib/api-helpers'
import { assertResidentAccess } from '@/lib/tenancy'
import { checkoutSchema, noticeSchema, transferSchema } from '@/lib/validation'
import {
  completeCheckout,
  markNotice,
  previewCheckout,
  transferResident,
} from '@/server/services/residents'

/**
 * Resident lifecycle actions in one endpoint: transfer, notice, the checkout
 * settlement preview, and the checkout itself.
 */
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('TRANSFER') }).merge(transferSchema),
  z.object({ action: z.literal('NOTICE') }).merge(noticeSchema),
  z.object({ action: z.literal('CHECKOUT_PREVIEW') }).merge(checkoutSchema.partial({ exitDate: true }).required({ residentId: true })),
  z.object({ action: z.literal('CHECKOUT') }).merge(checkoutSchema),
])

export const POST = route(
  async ({ user, request }) => {
    const body = await parseBody(request, schema)
    await assertResidentAccess(user, body.residentId)
    const actor = { id: user.id, name: user.name }

    switch (body.action) {
      case 'TRANSFER': {
        const result = await transferResident({
          residentId: body.residentId,
          toBedId: body.toBedId,
          effectiveDate: body.effectiveDate ? new Date(body.effectiveDate) : undefined,
          actor,
        })
        return ok({
          message: `Moved to Room ${result.bed.room.number}, Bed ${result.bed.label}`,
        })
      }

      case 'NOTICE': {
        const resident = await markNotice({
          residentId: body.residentId,
          noticeDate: new Date(body.noticeDate),
          exitDate: new Date(body.exitDate),
          actor,
        })
        return ok({ message: `${resident.fullName} marked as serving notice` })
      }

      case 'CHECKOUT_PREVIEW': {
        const preview = await previewCheckout({
          residentId: body.residentId,
          exitDate: body.exitDate ? new Date(body.exitDate) : new Date(),
          damageDeduction: body.damageDeduction,
          otherCharges: body.otherCharges,
        })
        return ok({ preview })
      }

      case 'CHECKOUT': {
        const result = await completeCheckout({
          residentId: body.residentId,
          exitDate: new Date(body.exitDate),
          reason: body.reason || undefined,
          damageDeduction: body.damageDeduction,
          otherCharges: body.otherCharges,
          settlementNote: body.settlementNote || undefined,
          refundPaid: body.refundPaid,
          actor,
        })
        return ok({
          message: `${result.resident.fullName} checked out`,
          refund: result.checkout.refundAmount,
          payable: result.checkout.payableAmount,
        })
      }
    }
  },
  { roles: ['OWNER', 'MANAGER'] },
)
