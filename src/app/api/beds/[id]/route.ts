import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import type { SessionUser } from '@/lib/auth'
import { ok, parseBody, route } from '@/lib/api-helpers'
import { assertPropertyAccess, ConflictError, NotFoundError } from '@/lib/tenancy'
import { recordActivity } from '@/server/events'
import { bedRemovalBlocker, loadRoomBeds } from '@/server/services/bed-layout'

/**
 * /api/beds/<id>  (properties.manage)
 *   PATCH  — rename the bed, change its rent override or notes. Status
 *            changes stay on POST /api/beds (BLOCK / MAINTENANCE / RELEASE),
 *            which guards occupancy and bookings.
 *   DELETE — remove an unused bed. Refused when the bed is occupied, held
 *            for a booking, or has any history (past stays or bookings).
 */

const rupees = z.coerce.number().int('Enter a whole rupee amount').min(0, 'Cannot be negative')

const updateSchema = z.object({
  label: z.string().trim().min(1, 'Give the bed a label').max(6).optional(),
  // '' clears the override so the room/PG rent applies.
  rent: z.union([z.literal(''), rupees]).optional(),
  notes: z.string().trim().max(500).optional(),
})

function idFrom(request: Request) {
  return decodeURIComponent(new URL(request.url).pathname.split('/').filter(Boolean).pop() ?? '')
}

async function loadBed(user: SessionUser, id: string) {
  const bed = await prisma.bed.findUnique({
    where: { id },
    include: {
      room: { select: { id: true, number: true } },
      resident: { select: { fullName: true } },
      property: { select: { organizationId: true, archivedAt: true } },
    },
  })
  if (!bed || bed.property.organizationId !== user.organizationId) {
    throw new NotFoundError('Bed not found')
  }
  await assertPropertyAccess(user, bed.propertyId)
  if (bed.property.archivedAt) throw new ConflictError('This PG is archived. Restore it first.')
  return bed
}

function activity(user: SessionUser, propertyId: string, bedId: string, summary: string) {
  return recordActivity({
    organizationId: user.organizationId,
    propertyId,
    actorId: user.id,
    actorName: user.name,
    actorRole: user.role,
    event: 'PROPERTY_UPDATED',
    entityType: 'Bed',
    entityId: bedId,
    summary,
  })
}

export const PATCH = route(
  async ({ user, request }) => {
    const bed = await loadBed(user, idFrom(request))
    const body = await parseBody(request, updateSchema)

    if (body.label !== undefined && body.label !== bed.label) {
      const clash = await prisma.bed.findFirst({
        where: { roomId: bed.roomId, label: body.label, id: { not: bed.id } },
        select: { id: true },
      })
      if (clash) throw new ConflictError(`Room ${bed.room.number} already has a bed ${body.label}`)
    }

    const updated = await prisma.bed.update({
      where: { id: bed.id },
      data: {
        ...(body.label !== undefined ? { label: body.label } : {}),
        ...(body.rent !== undefined ? { rent: body.rent === '' ? null : body.rent } : {}),
        ...(body.notes !== undefined ? { notes: body.notes || null } : {}),
      },
    })

    const message = `Bed ${updated.label} in Room ${bed.room.number} saved`
    await activity(user, bed.propertyId, bed.id, message)
    return ok({ bed: updated, message })
  },
  { module: 'properties', permission: 'properties.manage' },
)

export const DELETE = route(
  async ({ user, request }) => {
    const bed = await loadBed(user, idFrom(request))
    const where = `Bed ${bed.label} in Room ${bed.room.number}`

    await prisma.$transaction(async (tx) => {
      const beds = await loadRoomBeds(tx, bed.roomId)
      const target = beds.find((b) => b.id === bed.id)
      if (!target) throw new NotFoundError('Bed not found')

      const blocker = bedRemovalBlocker(target)
      if (blocker === 'occupied') {
        throw new ConflictError(
          bed.resident
            ? `${bed.resident.fullName} is in ${where}. Move or check them out first.`
            : `${where} is occupied. Free it before removing it.`,
        )
      }
      if (blocker === 'reserved for a booking') {
        const booking = target.bookings[0]
        throw new ConflictError(
          booking
            ? `${where} is held for booking ${booking.code} (${booking.name}). Cancel or move the booking first.`
            : `${where} is reserved. Release it before removing it.`,
        )
      }
      if (blocker) {
        throw new ConflictError(
          `${where} has past residents or bookings on file, so it cannot be deleted. Block it from the bed map instead.`,
        )
      }
      if (beds.length <= 1) {
        throw new ConflictError(`This is the only bed in Room ${bed.room.number}. Delete the room instead.`)
      }

      // Conditional delete: if someone checks in or books it meanwhile, the
      // row no longer matches and nothing is removed.
      const deleted = await tx.bed.deleteMany({
        where: { id: bed.id, residentId: null, status: { notIn: ['OCCUPIED', 'RESERVED'] } },
      })
      if (deleted.count !== 1) {
        throw new ConflictError(`${where} changed a moment ago. Refresh and try again.`)
      }
      await tx.room.update({ where: { id: bed.roomId }, data: { capacity: beds.length - 1 } })
    })

    const message = `${where} removed`
    await activity(user, bed.propertyId, bed.id, message)
    return ok({ message })
  },
  { module: 'properties', permission: 'properties.manage' },
)
