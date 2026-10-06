import { prisma } from '@/lib/prisma'
import type { SessionUser } from '@/lib/auth'
import { ok, parseBody, route } from '@/lib/api-helpers'
import {
  assertPropertyAccess,
  assertRoomInProperty,
  NotFoundError,
  ValidationError,
} from '@/lib/tenancy'
import { assetSchema } from '@/lib/validation'
import { recordActivity } from '@/server/events'

/**
 * /api/assets/<id>  (inventory.manage)
 *   PATCH  — edit an inventory item. Disposing is `condition: 'DISPOSED'`,
 *            which keeps the record (and its cost) on file.
 *   DELETE — remove an item entered by mistake.
 */

const updateSchema = assetSchema.omit({ propertyId: true }).partial()

function idFrom(request: Request) {
  return decodeURIComponent(new URL(request.url).pathname.split('/').filter(Boolean).pop() ?? '')
}

async function loadAsset(user: SessionUser, id: string) {
  const asset = await prisma.asset.findUnique({ where: { id } })
  if (!asset || asset.organizationId !== user.organizationId) {
    throw new NotFoundError('Item not found')
  }
  await assertPropertyAccess(user, asset.propertyId)
  return asset
}

function optionalDate(value: string | undefined) {
  if (value === undefined) return undefined
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new ValidationError('Enter a valid purchase date')
  return date
}

export const PATCH = route(
  async ({ user, request }) => {
    const asset = await loadAsset(user, idFrom(request))
    const body = await parseBody(request, updateSchema)

    if (body.roomId) await assertRoomInProperty(body.roomId, asset.propertyId)
    const purchaseDate = optionalDate(body.purchaseDate)

    const updated = await prisma.asset.update({
      where: { id: asset.id },
      data: {
        ...(body.roomId !== undefined ? { roomId: body.roomId || null } : {}),
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.category !== undefined ? { category: body.category } : {}),
        ...(body.quantity !== undefined ? { quantity: body.quantity } : {}),
        ...(body.condition !== undefined ? { condition: body.condition } : {}),
        ...(body.location !== undefined ? { location: body.location || null } : {}),
        ...(purchaseDate !== undefined ? { purchaseDate } : {}),
        ...(body.purchaseCost !== undefined ? { purchaseCost: body.purchaseCost } : {}),
        ...(body.serialNumber !== undefined ? { serialNumber: body.serialNumber || null } : {}),
        ...(body.notes !== undefined ? { notes: body.notes || null } : {}),
      },
    })

    const disposed = body.condition === 'DISPOSED' && asset.condition !== 'DISPOSED'
    await recordActivity({
      organizationId: asset.organizationId,
      propertyId: asset.propertyId,
      actorId: user.id,
      actorName: user.name,
      actorRole: user.role,
      event: 'PROPERTY_UPDATED',
      entityType: 'Asset',
      entityId: asset.id,
      summary: disposed ? `${updated.name} marked disposed` : `Inventory item ${updated.name} updated`,
    })

    return ok({
      asset: updated,
      message: disposed ? `${updated.name} marked as disposed` : `${updated.name} saved`,
    })
  },
  { module: 'inventory', permission: 'inventory.manage' },
)

export const DELETE = route(
  async ({ user, request }) => {
    const asset = await loadAsset(user, idFrom(request))
    await prisma.asset.delete({ where: { id: asset.id } })
    await recordActivity({
      organizationId: asset.organizationId,
      propertyId: asset.propertyId,
      actorId: user.id,
      actorName: user.name,
      actorRole: user.role,
      event: 'PROPERTY_UPDATED',
      entityType: 'Asset',
      entityId: asset.id,
      summary: `Inventory item ${asset.name} (×${asset.quantity}) deleted`,
      meta: { action: 'DELETE', category: asset.category, purchaseCost: asset.purchaseCost },
    })
    return ok({ message: `${asset.name} deleted from inventory` })
  },
  { module: 'inventory', permission: 'inventory.manage' },
)
