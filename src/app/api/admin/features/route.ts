import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ok, parseBody, route } from '@/lib/api-helpers'
import { NotFoundError } from '@/lib/tenancy'
import { recordActivity } from '@/server/events'

const schema = z.object({
  featureId: z.string().min(1),
  enabled: z.boolean(),
  plans: z.array(z.string()).optional(),
})

/** Switch a platform capability on or off. Super Admin only. */
export const POST = route(
  async ({ user, request }) => {
    const body = await parseBody(request, schema)

    const feature = await prisma.featureFlag.findUnique({ where: { id: body.featureId } })
    if (!feature) throw new NotFoundError('Feature not found')

    const updated = await prisma.featureFlag.update({
      where: { id: feature.id },
      data: {
        enabled: body.enabled,
        ...(body.plans ? { plans: body.plans } : {}),
      },
    })

    await recordActivity({
      actorId: user.id,
      actorName: user.name,
      actorRole: user.role,
      event: 'SETTINGS_UPDATED',
      entityType: 'FeatureFlag',
      entityId: feature.id,
      summary: `${updated.name} ${updated.enabled ? 'enabled' : 'disabled'}`,
    })

    return ok({
      feature: updated,
      message: `${updated.name} is now ${updated.enabled ? 'enabled' : 'disabled'}`,
    })
  },
  { roles: ['SUPER_ADMIN'] },
)
