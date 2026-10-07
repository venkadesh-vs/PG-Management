import { prisma } from '@/lib/prisma'
import type { SessionUser } from '@/lib/auth'
import { ok, parseBody, route } from '@/lib/api-helpers'
import { assertPropertyAccess, NotFoundError, ValidationError } from '@/lib/tenancy'
import { resolveAssetLocation } from '@/server/services/assets'
import { assetSchema } from '@/lib/validation'
import { recordActivity } from '@/server/events'

/**
 * /api/assets/<id>  (inventory.manage)
 *   PATCH  — edit an inventory item, including where it sits (`placement`:
 *            floor / room / bed), its status and current value. Disposing is
 *            `condition: 'DISPOSED'` or `status: 'DISPOSED'`, which keeps the
 *            record (and its cost) on file. Audited with before/after.
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

    const where = await resolveAssetLocation(asset.propertyId, { placement: body.placement, roomId: body.roomId })
    const purchaseDate = optionalDate(body.purchaseDate)
    const disposing = body.condition === 'DISPOSED' || body.status === 'DISPOSED'

    const updated = await prisma.asset.update({
      where: { id: asset.id },
      data: {
        ...(where ?? {}),
        ...(body.status !== undefined ? { status: body.status } : disposing ? { status: 'DISPOSED' } : {}),
        ...(body.currentValue !== undefined ? { currentValue: body.currentValue === '' ? null : body.currentValue } : {}),
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

    const disposed = disposing && asset.status !== 'DISPOSED' && asset.condition !== 'DISPOSED'
    const pick = (a: typeof asset) => ({
      name: a.name,
      category: a.category,
      quantity: a.quantity,
      condition: a.condition,
      status: a.status,
      floorId: a.floorId,
      roomId: a.roomId,
      bedId: a.bedId,
      location: a.location,
      purchaseCost: a.purchaseCost,
      currentValue: a.currentValue,
    })
    await recordActivity({
      organizationId: asset.organizationId,
      propertyId: asset.propertyId,
      actorId: user.id,
      actorName: user.name,
      actorRole: user.role,
      event: 'ASSET_UPDATED',
      entityType: 'Asset',
      entityId: asset.id,
      summary: disposed ? `${updated.name} marked disposed` : `Inventory item ${updated.name} updated`,
      before: pick(asset),
      after: pick(updated),
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
