import 'server-only'

import { prisma } from '@/lib/prisma'
import { ValidationError } from '@/lib/tenancy'

/**
 * Where an asset sits inside a PG: the PG itself, a floor, a room or a bed.
 * Every id is checked against the asset's PG, and the parents are filled in
 * (a bed implies its room and floor), so filters by floor or room are exact.
 */
export type AssetLocation = { floorId: string | null; roomId: string | null; bedId: string | null }

export async function resolveAssetLocation(
  propertyId: string,
  input: { placement?: string; roomId?: string },
): Promise<AssetLocation | undefined> {
  const placement = input.placement ?? (input.roomId !== undefined ? (input.roomId ? `room:${input.roomId}` : '') : undefined)
  if (placement === undefined) return undefined
  if (placement === '') return { floorId: null, roomId: null, bedId: null }

  const [kind, id] = placement.split(':') as ['floor' | 'room' | 'bed', string]
  if (kind === 'floor') {
    const floor = await prisma.floor.findFirst({ where: { id, propertyId }, select: { id: true } })
    if (!floor) throw new ValidationError('That floor is not in this PG')
    return { floorId: floor.id, roomId: null, bedId: null }
  }
  if (kind === 'room') {
    const room = await prisma.room.findFirst({ where: { id, propertyId }, select: { id: true, floorId: true } })
    if (!room) throw new ValidationError('That room is not in this PG')
    return { floorId: room.floorId, roomId: room.id, bedId: null }
  }
  const bed = await prisma.bed.findFirst({ where: { id, propertyId }, select: { id: true, roomId: true, floorId: true } })
  if (!bed) throw new ValidationError('That bed is not in this PG')
  return { floorId: bed.floorId, roomId: bed.roomId, bedId: bed.id }
}

/** The placement value for a stored asset (the select in the edit form). */
export function placementOf(asset: AssetLocation) {
  if (asset.bedId) return `bed:${asset.bedId}`
  if (asset.roomId) return `room:${asset.roomId}`
  if (asset.floorId) return `floor:${asset.floorId}`
  return ''
}
