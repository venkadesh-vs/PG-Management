import { z } from 'zod'
import { ok, parseBody, route } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { NotFoundError, resolveScope } from '@/lib/tenancy'
import { cancelMandate, listMandates, setChargeDay } from '@/server/services/resident-autopay'

/**
 * Resident AutoPay, owner side.
 *   GET ?property=                       → mandates (who is on AutoPay, next debit) + recent debits
 *   POST { action: 'CANCEL', mandateId, reason } → cancels a resident's AutoPay
 *   POST { action: 'SET_DAY', residentId, day }   → the resident's debit / rent due day, within the window
 */
export const GET = route(
  async ({ user, request }) => {
    const property = new URL(request.url).searchParams.get('property')
    const scope = await resolveScope(user, property)
    return listMandates({
      organizationId: scope.organizationId,
      propertyIds: scope.propertyId ? [scope.propertyId] : scope.allowedPropertyIds,
    })
  },
  { module: 'rent', permission: 'rent.view' },
)

const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('CANCEL'),
    mandateId: z.string().min(1),
    reason: z.string().trim().min(3, 'Say why AutoPay is being cancelled').max(200),
  }),
  z.object({ action: z.literal('SET_DAY'), residentId: z.string().min(1), day: z.coerce.number().int() }),
])

export const POST = route(
  async ({ user, request }) => {
    const body = await parseBody(request, schema)
    const scope = await resolveScope(user)
    if (body.action === 'SET_DAY') {
      const resident = await prisma.resident.findFirst({
        where: { id: body.residentId, organizationId: scope.organizationId, propertyId: { in: scope.allowedPropertyIds } },
        select: { id: true },
      })
      if (!resident) throw new NotFoundError('Resident not found')
      const result = await setChargeDay({
        residentId: resident.id,
        organizationId: scope.organizationId,
        day: body.day,
        actor: { id: user.id, name: user.name, role: user.role },
        byOwner: true,
      })
      return ok({ ...result, message: 'Date saved. It applies from the next invoice.' })
    }
    const mandate = await prisma.residentMandate.findFirst({
      where: { id: body.mandateId, organizationId: scope.organizationId, propertyId: { in: scope.allowedPropertyIds } },
    })
    if (!mandate) throw new NotFoundError('AutoPay not found')
    await cancelMandate({
      mandateId: mandate.id,
      organizationId: scope.organizationId,
      actor: { id: user.id, name: user.name, role: user.role },
      reason: body.reason,
    })
    return ok({ message: 'AutoPay cancelled for this resident.' })
  },
  { module: 'rent', permission: 'rent.manage' },
)
