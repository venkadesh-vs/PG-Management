import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ok, parseBody, route } from '@/lib/api-helpers'

const schema = z.object({
  id: z.string().optional(),
  all: z.boolean().optional(),
})

/**
 * PATCH /api/notifications — mark one, or every, notification read.
 * Always scoped to the caller's own notifications.
 */
export const PATCH = route(async ({ user, request }) => {
  const body = await parseBody(request, schema)

  if (body.all) {
    const result = await prisma.notification.updateMany({
      where: { userId: user.id, readAt: null },
      data: { readAt: new Date() },
    })
    return ok({ updated: result.count })
  }

  if (!body.id) return ok({ updated: 0 })

  const result = await prisma.notification.updateMany({
    where: { id: body.id, userId: user.id, readAt: null },
    data: { readAt: new Date() },
  })
  return ok({ updated: result.count })
})
