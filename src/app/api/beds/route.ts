import { z } from 'zod'
import { ok, parseBody, route } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { assertPropertyAccess, NotFoundError } from '@/lib/tenancy'
import { changeBedStatus } from '@/server/services/beds'

/** Bed actions from the bed map: block, mark under maintenance, release. */
const reason = z.string().trim().max(200, 'Keep the reason under 200 characters')

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('BLOCK'), bedId: z.string().min(1), reason }),
  z.object({ action: z.literal('MAINTENANCE'), bedId: z.string().min(1), reason }),
  z.object({ action: z.literal('RELEASE'), bedId: z.string().min(1) }),
])

export const POST = route(
  async ({ user, request }) => {
    const body = await parseBody(request, schema)
    const bed = await prisma.bed.findUnique({
      where: { id: body.bedId },
      select: { propertyId: true },
    })
    if (!bed) throw new NotFoundError('Bed not found')
    await assertPropertyAccess(user, bed.propertyId)

    const result = await changeBedStatus({
      bedId: body.bedId,
      action: body.action,
      reason: 'reason' in body ? body.reason : undefined,
      actor: { id: user.id, name: user.name },
    })
    return ok(result)
  },
  { module: 'properties', permission: 'properties.manage' },
)
