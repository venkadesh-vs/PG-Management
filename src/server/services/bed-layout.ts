import 'server-only'

import type { BookingStatus, Prisma } from '@prisma/client'
import { ConflictError } from '@/lib/tenancy'

/**
 * Bed layout edits — growing or shrinking a room, adding and removing beds.
 *
 * A bed is only ever deleted when it is unused: nobody in it, not held for a
 * live booking, and no history (past stays or bookings). BedAllocation rows
 * cascade with the bed, so deleting a used bed would erase a resident's stay
 * history. Used beds are refused; the owner can block them from the bed map.
 */

type Tx = Prisma.TransactionClient

export const ACTIVE_BOOKING: BookingStatus[] = ['PENDING', 'CONFIRMED']

export type LayoutBed = {
  id: string
  label: string
  status: string
  residentId: string | null
  _count: { allocations: number; bookings: number }
  bookings: { code: string; name: string }[]
}

/** Why a bed cannot be removed, or null when it can. */
export function bedRemovalBlocker(bed: LayoutBed): string | null {
  if (bed.residentId || bed.status === 'OCCUPIED') return 'occupied'
  if (bed.bookings.length > 0 || bed.status === 'RESERVED') return 'reserved for a booking'
  if (bed._count.allocations > 0 || bed._count.bookings > 0) return 'has past residents or bookings'
  return null
}

/** A, B, C … Z, then 27, 28 … — the first labels not already used in the room. */
export function nextBedLabels(existing: string[], count: number) {
  const used = new Set(existing)
  const labels: string[] = []
  for (let i = 0; labels.length < count && i < 200; i++) {
    const label = i < 26 ? String.fromCharCode(65 + i) : String(i + 1)
    if (!used.has(label)) {
      used.add(label)
      labels.push(label)
    }
  }
  return labels
}

export async function loadRoomBeds(tx: Tx, roomId: string): Promise<LayoutBed[]> {
  return tx.bed.findMany({
    where: { roomId },
    select: {
      id: true,
      label: true,
      status: true,
      residentId: true,
      _count: { select: { allocations: true, bookings: true } },
      bookings: {
        where: { status: { in: ACTIVE_BOOKING } },
        select: { code: true, name: true },
        take: 1,
      },
    },
    orderBy: { label: 'asc' },
  })
}

/**
 * Brings a room to `target` beds. Adds new AVAILABLE beds, or deletes unused
 * ones (highest label first, so A, B, C… stay stable). Refuses to shrink
 * below the beds that are occupied, booked or carry history.
 */
export async function resizeRoom(
  tx: Tx,
  room: { id: string; propertyId: string; floorId: string; baseRent: number | null },
  target: number,
) {
  const beds = await loadRoomBeds(tx, room.id)
  const summary = { added: 0, deleted: 0 }

  if (target > beds.length) {
    const labels = nextBedLabels(
      beds.map((b) => b.label),
      target - beds.length,
    )
    if (labels.length) {
      await tx.bed.createMany({
        data: labels.map((label) => ({
          propertyId: room.propertyId,
          floorId: room.floorId,
          roomId: room.id,
          label,
          status: 'AVAILABLE' as const,
          rent: room.baseRent,
        })),
      })
      summary.added = labels.length
    }
  } else if (target < beds.length) {
    const need = beds.length - target
    const removable = beds.filter((b) => !bedRemovalBlocker(b)).reverse()
    if (removable.length < need) {
      const kept = beds.length - removable.length
      throw new ConflictError(
        `${kept} bed${kept === 1 ? ' is' : 's are'} occupied, booked or have past residents, so this room cannot go below ${kept} bed${kept === 1 ? '' : 's'}. Block extra beds from the bed map instead.`,
      )
    }
    const ids = removable.slice(0, need).map((b) => b.id)
    // Conditional delete: a bed checked into or booked meanwhile is skipped.
    const deleted = await tx.bed.deleteMany({
      where: { id: { in: ids }, residentId: null, status: { notIn: ['OCCUPIED', 'RESERVED'] } },
    })
    if (deleted.count !== ids.length) {
      throw new ConflictError('A bed in this room changed a moment ago. Refresh and try again.')
    }
    summary.deleted = deleted.count
  }

  return summary
}
