import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import type { SessionUser } from '@/lib/auth'
import { ok, parseBody, route } from '@/lib/api-helpers'
import { assertPropertyAccess, ConflictError, NotFoundError } from '@/lib/tenancy'
import { recordActivity } from '@/server/events'

/**
 * /api/floors/<id>  (properties.manage)
 *   PATCH  — rename a floor (and optionally change its level)
 *   DELETE — remove an empty floor. A floor that still has rooms is refused:
 *            delete or move its rooms first, so no bed history is lost.
 */

const updateSchema = z.object({
  name: z.string().trim().min(1, 'Name the floor').max(60).optional(),
  level: z.coerce.number().int().min(0).max(50).optional(),
})

function idFrom(request: Request) {
  return decodeURIComponent(new URL(request.url).pathname.split('/').filter(Boolean).pop() ?? '')
}

async function loadFloor(user: SessionUser, id: string) {
  const floor = await prisma.floor.findUnique({
    where: { id },
    include: { property: { select: { organizationId: true, archivedAt: true } } },
  })
  if (!floor || floor.property.organizationId !== user.organizationId) {
    throw new NotFoundError('Floor not found')
  }
  await assertPropertyAccess(user, floor.propertyId)
  if (floor.property.archivedAt) throw new ConflictError('This PG is archived. Restore it first.')
  return floor
}

function activity(user: SessionUser, propertyId: string, floorId: string, summary: string) {
  return recordActivity({
    organizationId: user.organizationId,
    propertyId,
    actorId: user.id,
    actorName: user.name,
    actorRole: user.role,
    event: 'PROPERTY_UPDATED',
    entityType: 'Floor',
    entityId: floorId,
    summary,
  })
}

export const PATCH = route(
  async ({ user, request }) => {
    const floor = await loadFloor(user, idFrom(request))
    const body = await parseBody(request, updateSchema)

    if (body.level !== undefined && body.level !== floor.level) {
      const clash = await prisma.floor.findFirst({
        where: { propertyId: floor.propertyId, level: body.level, id: { not: floor.id } },
        select: { name: true },
      })
      if (clash) throw new ConflictError(`Level ${body.level} is already used by ${clash.name}`)
    }

    const updated = await prisma.floor.update({
      where: { id: floor.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.level !== undefined ? { level: body.level } : {}),
      },
    })

    await activity(
      user,
      floor.propertyId,
      floor.id,
      updated.name !== floor.name ? `${floor.name} renamed to ${updated.name}` : `${updated.name} updated`,
    )
    return ok({ floor: updated, message: `${updated.name} saved` })
  },
  { module: 'properties', permission: 'properties.manage' },
)

export const DELETE = route(
  async ({ user, request }) => {
    const floor = await loadFloor(user, idFrom(request))

    const rooms = await prisma.room.count({ where: { floorId: floor.id } })
    if (rooms > 0) {
      throw new ConflictError(
        `${floor.name} still has ${rooms} room${rooms === 1 ? '' : 's'}. Delete or move them first.`,
      )
    }

    await prisma.floor.delete({ where: { id: floor.id } })
    await activity(user, floor.propertyId, floor.id, `${floor.name} removed`)
    return ok({ message: `${floor.name} removed` })
  },
  { module: 'properties', permission: 'properties.manage' },
)
