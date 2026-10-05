import 'server-only'

import type { BookingStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/tenancy'
import { recordActivity } from '../events'

/**
 * Bed actions from the bed map (PRD §35): take a free bed out of service
 * (blocked or under maintenance) and put it back. A bed with someone in it, or
 * one held for a booking, is never touched here — checkout and the booking
 * flow own those transitions.
 */

const ACTIVE_BOOKING: BookingStatus[] = ['PENDING', 'CONFIRMED']

export type BedAction = 'BLOCK' | 'MAINTENANCE' | 'RELEASE'

export async function changeBedStatus(params: {
  bedId: string
  action: BedAction
  reason?: string
  actor: { id?: string; name: string }
}) {
  const reason = params.reason?.trim() || null
  if (params.action !== 'RELEASE' && !reason) {
    throw new ValidationError(
      params.action === 'BLOCK'
        ? 'Add a short reason so your team knows why this bed is blocked.'
        : 'Add a short note about the maintenance work.',
    )
  }

  return prisma.$transaction(async (tx) => {
    const bed = await tx.bed.findUnique({
      where: { id: params.bedId },
      include: {
        room: { select: { number: true } },
        property: { select: { id: true, organizationId: true } },
        resident: { select: { fullName: true } },
        bookings: {
          where: { status: { in: ACTIVE_BOOKING } },
          select: { code: true, name: true },
          take: 1,
        },
      },
    })
    if (!bed) throw new NotFoundError('Bed not found')
    const name = `Bed ${bed.label} in Room ${bed.room.number}`

    if (bed.residentId) {
      throw new ConflictError(
        `${bed.resident?.fullName ?? 'A resident'} is in this bed. Move or check them out first.`,
      )
    }
    const booking = bed.bookings[0]
    if (booking) {
      throw new ConflictError(
        `${name} is held for booking ${booking.code} (${booking.name}). Cancel or move the booking first.`,
      )
    }

    const status =
      params.action === 'BLOCK' ? 'BLOCKED' : params.action === 'MAINTENANCE' ? 'MAINTENANCE' : 'AVAILABLE'
    if (status === bed.status && params.action === 'RELEASE') {
      throw new ConflictError(`${name} is already available`)
    }

    // Conditional write: if someone checks in or books the bed meanwhile, the
    // row no longer matches and nothing changes.
    const updated = await tx.bed.updateMany({
      where: {
        id: bed.id,
        residentId: null,
        status: { not: 'OCCUPIED' },
      },
      data: { status, blockedReason: status === 'AVAILABLE' ? null : reason },
    })
    if (updated.count !== 1) {
      throw new ConflictError(`${name} changed a moment ago. Refresh the bed map and try again.`)
    }

    const summary =
      status === 'AVAILABLE'
        ? `${name} is available again`
        : status === 'BLOCKED'
          ? `${name} blocked — ${reason}`
          : `${name} marked under maintenance — ${reason}`

    await recordActivity(
      {
        organizationId: bed.property.organizationId,
        propertyId: bed.property.id,
        actorId: params.actor.id,
        actorName: params.actor.name,
        event: status === 'AVAILABLE' ? 'BED_RELEASED' : 'PROPERTY_UPDATED',
        entityType: 'Bed',
        entityId: bed.id,
        summary,
        meta: { from: bed.status, to: status, reason },
      },
      tx,
    )

    return { bedId: bed.id, propertyId: bed.propertyId, status, message: summary }
  })
}
