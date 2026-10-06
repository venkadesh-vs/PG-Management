import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import type { SessionUser } from '@/lib/auth'
import { ok, parseBody, route } from '@/lib/api-helpers'
import {
  assertFloorInProperty,
  assertPropertyAccess,
  ConflictError,
  NotFoundError,
} from '@/lib/tenancy'
import { recordActivity } from '@/server/events'
import {
  loadRoomBeds,
  nextBedLabels,
  resizeRoom,
} from '@/server/services/bed-layout'

/**
 * /api/rooms/<id>  (properties.manage)
 *   PATCH  — edit number, floor, type, capacity, rent and amenities.
 *            Capacity changes add beds or delete unused ones only.
 *   POST { action: 'ADD_BED' } — add one bed to the room
 *   DELETE — delete an unused room. A room with anyone in it, a live
 *            booking, or any history (past stays, bookings, complaints,
 *            tasks) is refused so nothing traceable is lost.
 */

const rupees = z.coerce.number().int('Enter a whole rupee amount').min(0, 'Cannot be negative')

const updateSchema = z.object({
  number: z.string().trim().min(1, 'Room number is required').max(12).optional(),
  floorId: z.string().min(1).optional(),
  type: z.enum(['SINGLE', 'DOUBLE', 'TRIPLE', 'QUAD', 'DORM']).optional(),
  capacity: z.coerce.number().int().min(1, 'At least one bed').max(12).optional(),
  // '' clears the override so the PG's standard rent applies.
  baseRent: z.union([z.literal(''), rupees]).optional(),
  hasAC: z.boolean().optional(),
  hasBalcony: z.boolean().optional(),
  hasAttachedBath: z.boolean().optional(),
  notes: z.string().trim().max(500).optional(),
})

const actionSchema = z.object({
  action: z.literal('ADD_BED'),
  rent: z.union([z.literal(''), rupees]).optional(),
})

const MAX_BEDS = 12

function idFrom(request: Request) {
  return decodeURIComponent(new URL(request.url).pathname.split('/').filter(Boolean).pop() ?? '')
}

async function loadRoom(user: SessionUser, id: string) {
  const room = await prisma.room.findUnique({
    where: { id },
    include: { property: { select: { organizationId: true, archivedAt: true } } },
  })
  if (!room || room.property.organizationId !== user.organizationId) {
    throw new NotFoundError('Room not found')
  }
  await assertPropertyAccess(user, room.propertyId)
  if (room.property.archivedAt) throw new ConflictError('This PG is archived. Restore it first.')
  return room
}

function activity(user: SessionUser, propertyId: string, roomId: string, summary: string) {
  return recordActivity({
    organizationId: user.organizationId,
    propertyId,
    actorId: user.id,
    actorName: user.name,
    actorRole: user.role,
    event: 'PROPERTY_UPDATED',
    entityType: 'Room',
    entityId: roomId,
    summary,
  })
}

export const PATCH = route(
  async ({ user, request }) => {
    const room = await loadRoom(user, idFrom(request))
    const body = await parseBody(request, updateSchema)

    if (body.number !== undefined && body.number !== room.number) {
      const clash = await prisma.room.findFirst({
        where: { propertyId: room.propertyId, number: body.number, id: { not: room.id } },
        select: { id: true },
      })
      if (clash) throw new ConflictError(`Room ${body.number} already exists in this PG`)
    }
    const floorChanged = body.floorId !== undefined && body.floorId !== room.floorId
    if (floorChanged) await assertFloorInProperty(body.floorId!, room.propertyId)

    const baseRent =
      body.baseRent === undefined ? undefined : body.baseRent === '' ? null : body.baseRent

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.room.update({
        where: { id: room.id },
        data: {
          ...(body.number !== undefined ? { number: body.number } : {}),
          ...(floorChanged ? { floorId: body.floorId } : {}),
          ...(body.type !== undefined ? { type: body.type } : {}),
          ...(baseRent !== undefined ? { baseRent } : {}),
          ...(body.hasAC !== undefined ? { hasAC: body.hasAC } : {}),
          ...(body.hasBalcony !== undefined ? { hasBalcony: body.hasBalcony } : {}),
          ...(body.hasAttachedBath !== undefined ? { hasAttachedBath: body.hasAttachedBath } : {}),
          ...(body.notes !== undefined ? { notes: body.notes || null } : {}),
        },
      })

      // Beds denormalise floorId; keep them with their room.
      if (floorChanged) {
        await tx.bed.updateMany({ where: { roomId: room.id }, data: { floorId: body.floorId } })
      }
      // Beds that carried the old room rent follow the new one. Beds with
      // their own override, and residents' agreed rents, are left alone.
      if (baseRent !== undefined && baseRent !== room.baseRent) {
        await tx.bed.updateMany({
          where: { roomId: room.id, rent: room.baseRent },
          data: { rent: baseRent },
        })
      }

      const resized =
        body.capacity !== undefined
          ? await resizeRoom(
              tx,
              { ...room, floorId: updated.floorId, baseRent: updated.baseRent },
              body.capacity,
            )
          : null
      // Capacity always mirrors the beds actually in the room.
      const capacity = await tx.bed.count({ where: { roomId: room.id } })
      const saved =
        capacity !== updated.capacity
          ? await tx.room.update({ where: { id: room.id }, data: { capacity } })
          : updated
      return { updated: saved, resized }
    })

    let message = `Room ${result.updated.number} saved`
    if (result.resized) {
      const { added, deleted } = result.resized
      const parts = [
        added > 0 && `${added} bed${added === 1 ? '' : 's'} added`,
        deleted > 0 && `${deleted} bed${deleted === 1 ? '' : 's'} removed`,
      ].filter(Boolean)
      if (parts.length) message += ` — ${parts.join(', ')}`
    }

    await activity(user, room.propertyId, room.id, message)
    return ok({ room: result.updated, message })
  },
  { module: 'properties', permission: 'properties.manage' },
)

export const POST = route(
  async ({ user, request }) => {
    const room = await loadRoom(user, idFrom(request))
    const body = await parseBody(request, actionSchema)

    const bed = await prisma.$transaction(async (tx) => {
      const beds = await loadRoomBeds(tx, room.id)
      if (beds.length >= MAX_BEDS) throw new ConflictError(`A room can have at most ${MAX_BEDS} beds`)
      const [label] = nextBedLabels(
        beds.map((b) => b.label),
        1,
      )
      if (!label) throw new ConflictError('No free bed label left in this room')
      const created = await tx.bed.create({
        data: {
          propertyId: room.propertyId,
          floorId: room.floorId,
          roomId: room.id,
          label,
          status: 'AVAILABLE',
          rent: body.rent === undefined || body.rent === '' ? room.baseRent : body.rent,
        },
      })
      await tx.room.update({ where: { id: room.id }, data: { capacity: beds.length + 1 } })
      return created
    })

    const message = `Bed ${bed.label} added to Room ${room.number}`
    await activity(user, room.propertyId, room.id, message)
    return ok({ bed, message }, { status: 201 })
  },
  { module: 'properties', permission: 'properties.manage' },
)

export const DELETE = route(
  async ({ user, request }) => {
    const room = await loadRoom(user, idFrom(request))

    const beds = await loadRoomBeds(prisma, room.id)
    const occupied = beds.filter((b) => b.residentId || b.status === 'OCCUPIED').length
    const booked = beds.filter((b) => b.bookings.length > 0 || b.status === 'RESERVED').length
    if (occupied > 0) {
      throw new ConflictError(
        `Room ${room.number} has ${occupied} occupied bed${occupied === 1 ? '' : 's'}. Move or check those residents out first.`,
      )
    }
    if (booked > 0) {
      throw new ConflictError(
        `Room ${room.number} has ${booked} bed${booked === 1 ? '' : 's'} reserved for bookings. Cancel or move the bookings first.`,
      )
    }

    const [allocations, bookings, residents, complaints, tasks] = await Promise.all([
      prisma.bedAllocation.count({ where: { bed: { roomId: room.id } } }),
      prisma.booking.count({ where: { bed: { roomId: room.id } } }),
      prisma.resident.count({ where: { roomId: room.id } }),
      prisma.complaint.count({ where: { roomId: room.id } }),
      prisma.maintenanceTask.count({ where: { roomId: room.id } }),
    ])
    if (allocations + bookings + residents + complaints + tasks > 0) {
      throw new ConflictError(
        `Room ${room.number} has past residents, bookings or complaints on file, so it cannot be deleted. Block its beds from the bed map to stop using it.`,
      )
    }

    // Re-check inside the delete: a bed booked or checked into meanwhile
    // keeps the room.
    await prisma.$transaction(async (tx) => {
      const busy = await tx.bed.count({
        where: { roomId: room.id, OR: [{ residentId: { not: null } }, { status: { in: ['OCCUPIED', 'RESERVED'] } }] },
      })
      if (busy > 0) throw new ConflictError(`Room ${room.number} changed a moment ago. Refresh and try again.`)
      await tx.room.delete({ where: { id: room.id } })
    })
    await activity(user, room.propertyId, room.id, `Room ${room.number} deleted with ${beds.length} beds`)
    return ok({ message: `Room ${room.number} deleted` })
  },
  { module: 'properties', permission: 'properties.manage' },
)
