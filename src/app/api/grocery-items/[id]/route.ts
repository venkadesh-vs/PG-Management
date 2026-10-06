import { prisma } from '@/lib/prisma'
import type { SessionUser } from '@/lib/auth'
import { ok, parseBody, route } from '@/lib/api-helpers'
import { assertPropertyAccess, ConflictError, NotFoundError } from '@/lib/tenancy'
import { groceryItemSchema } from '@/lib/validation'
import { recordActivity } from '@/server/events'

/**
 * /api/grocery-items/<id>  (grocery.manage)
 *   PATCH  — edit name, category, unit, minimum stock, per-resident quantity
 *            and vendor. Stock levels move through purchases and meals only.
 *   DELETE — remove an item that has never been purchased. Deleting a
 *            purchased item would cascade its purchase history, so those are
 *            refused.
 */

const updateSchema = groceryItemSchema.omit({ propertyId: true, currentStock: true }).partial()

function idFrom(request: Request) {
  return decodeURIComponent(new URL(request.url).pathname.split('/').filter(Boolean).pop() ?? '')
}

async function loadItem(user: SessionUser, id: string) {
  const item = await prisma.groceryItem.findUnique({
    where: { id },
    include: { _count: { select: { purchases: true } } },
  })
  if (!item || item.organizationId !== user.organizationId) {
    throw new NotFoundError('Item not found')
  }
  await assertPropertyAccess(user, item.propertyId)
  return item
}

export const PATCH = route(
  async ({ user, request }) => {
    const item = await loadItem(user, idFrom(request))
    const body = await parseBody(request, updateSchema)

    if (body.name !== undefined && body.name !== item.name) {
      const clash = await prisma.groceryItem.findFirst({
        where: { propertyId: item.propertyId, name: body.name, id: { not: item.id } },
        select: { id: true },
      })
      if (clash) throw new ConflictError(`${body.name} is already on this PG's stock list`)
    }
    // Stock and purchase quantities are stored in the unit; switching it
    // after purchases would silently re-scale history.
    if (body.unit !== undefined && body.unit !== item.unit && item._count.purchases > 0) {
      throw new ConflictError('The unit cannot change once purchases are recorded for this item')
    }

    const updated = await prisma.groceryItem.update({
      where: { id: item.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.category !== undefined ? { category: body.category } : {}),
        ...(body.unit !== undefined ? { unit: body.unit } : {}),
        ...(body.minimumStock !== undefined ? { minimumStock: body.minimumStock } : {}),
        ...(body.perResidentPerMeal !== undefined
          ? { perResidentPerMeal: body.perResidentPerMeal }
          : {}),
        ...(body.vendor !== undefined ? { vendor: body.vendor || null } : {}),
      },
    })

    await recordActivity({
      organizationId: item.organizationId,
      propertyId: item.propertyId,
      actorId: user.id,
      actorName: user.name,
      actorRole: user.role,
      event: 'SETTINGS_UPDATED',
      entityType: 'GroceryItem',
      entityId: item.id,
      summary: `Grocery item ${updated.name} updated`,
    })

    return ok({ item: updated, message: `${updated.name} saved` })
  },
  { module: 'grocery', permission: 'grocery.manage' },
)

export const DELETE = route(
  async ({ user, request }) => {
    const item = await loadItem(user, idFrom(request))
    if (item._count.purchases > 0) {
      throw new ConflictError(
        `${item.name} has ${item._count.purchases} recorded purchase${item._count.purchases === 1 ? '' : 's'}, so it cannot be deleted. Set its minimum stock and per-resident quantity to 0 to stop it appearing on purchase lists.`,
      )
    }

    await prisma.groceryItem.delete({ where: { id: item.id } })
    await recordActivity({
      organizationId: item.organizationId,
      propertyId: item.propertyId,
      actorId: user.id,
      actorName: user.name,
      actorRole: user.role,
      event: 'SETTINGS_UPDATED',
      entityType: 'GroceryItem',
      entityId: item.id,
      summary: `Grocery item ${item.name} deleted`,
      meta: { action: 'DELETE' },
    })
    return ok({ message: `${item.name} removed from the stock list` })
  },
  { module: 'grocery', permission: 'grocery.manage' },
)
