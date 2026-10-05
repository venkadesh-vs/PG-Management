import 'server-only'

import type { MealType, Prisma, StockUnit } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { NotFoundError, ValidationError } from '@/lib/tenancy'
import { notifyOrgAdmins, recordActivity } from '../events'
import { formatMoney, startOfDay } from '@/lib/utils'
import { isModuleOn } from './org-modules'

/**
 * Food and grocery.
 *
 * Meal counts are derived from who is actually subscribed and present — not
 * typed in. Grocery requirement is derived from those counts using a
 * per-item, per-resident, per-meal factor that the PG configures, because no
 * two kitchens consume alike. Nothing about consumption is hard-coded.
 */

export const MEAL_TYPES: MealType[] = ['BREAKFAST', 'LUNCH', 'DINNER']

export const UNIT_LABEL: Record<StockUnit, string> = {
  KG: 'kg',
  GRAM: 'g',
  LITRE: 'L',
  ML: 'ml',
  PIECE: 'pcs',
  PACKET: 'packets',
  DOZEN: 'dozen',
  CYLINDER: 'cylinders',
}

/** Residents subscribed to a given meal on a given day. */
export async function expectedMealCount(propertyId: string, type: MealType, date: Date) {
  const day = startOfDay(date)
  const field =
    type === 'BREAKFAST'
      ? 'includesBreakfast'
      : type === 'LUNCH'
        ? 'includesLunch'
        : 'includesDinner'

  const subscriptions = await prisma.foodSubscription.count({
    where: {
      active: true,
      startDate: { lte: day },
      OR: [{ endDate: null }, { endDate: { gte: day } }],
      foodPlan: { propertyId, [field]: true },
      resident: { status: { in: ['ACTIVE', 'NOTICE'] }, propertyId },
    },
  })

  // Anyone who has explicitly opted out of today's meal is removed.
  const meal = await prisma.meal.findUnique({
    where: { propertyId_date_type: { propertyId, date: day, type } },
    select: { id: true },
  })
  const optedOut = meal
    ? await prisma.mealAttendance.count({
        where: { mealId: meal.id, status: { in: ['SKIPPED', 'ON_LEAVE'] } },
      })
    : 0

  return Math.max(0, subscriptions - optedOut)
}

export async function todaysMealBoard(propertyIds: string[], date = new Date()) {
  const day = startOfDay(date)
  const meals = await prisma.meal.findMany({
    where: { propertyId: { in: propertyIds }, date: day },
    include: { property: { select: { id: true, name: true, type: true } } },
    orderBy: { type: 'asc' },
  })

  const board = await Promise.all(
    MEAL_TYPES.map(async (type) => {
      const rows = meals.filter((m) => m.type === type)
      let expected = 0
      for (const propertyId of propertyIds) {
        expected += await expectedMealCount(propertyId, type, day)
      }
      return {
        type,
        expected,
        served: rows.reduce((s, m) => s + (m.actualCount ?? 0), 0),
        menus: rows.map((m) => ({
          id: m.id,
          property: m.property.name,
          propertyType: m.property.type,
          menu: m.menu,
          expectedCount: m.expectedCount,
          actualCount: m.actualCount,
        })),
      }
    }),
  )
  return board
}

export async function upsertMeal(params: {
  organizationId: string
  propertyId: string
  date: Date
  type: MealType
  menu: string
  notes?: string
  actor: { id?: string; name: string }
}) {
  const day = startOfDay(params.date)
  const expected = await expectedMealCount(params.propertyId, params.type, day)

  return prisma.meal.upsert({
    where: {
      propertyId_date_type: { propertyId: params.propertyId, date: day, type: params.type },
    },
    create: {
      organizationId: params.organizationId,
      propertyId: params.propertyId,
      date: day,
      type: params.type,
      menu: params.menu,
      notes: params.notes,
      expectedCount: expected,
    },
    update: { menu: params.menu, notes: params.notes, expectedCount: expected },
  })
}

export async function markMealServed(params: {
  mealId: string
  actualCount: number
  preparedBy?: string
}) {
  const { meal, crossedMinimum } = await prisma.$transaction(async (tx) => {
    // The Meal model has no served flag; `actualCount` is null until the meal
    // is served, so the conditional update is the "served once" guard. Of two
    // overlapping calls only one matches, and only that one deducts stock.
    const claim = await tx.meal.updateMany({
      where: { id: params.mealId, actualCount: null },
      data: { actualCount: params.actualCount, preparedBy: params.preparedBy },
    })
    const firstServe = claim.count === 1
    if (!firstServe) {
      // Already served: a correction updates the count but never re-deducts.
      await tx.meal.update({
        where: { id: params.mealId },
        data: { actualCount: params.actualCount, preparedBy: params.preparedBy },
      })
    }
    const meal = await tx.meal.findUniqueOrThrow({
      where: { id: params.mealId },
      include: { property: true },
    })
    const crossedMinimum = firstServe
      ? await consumeStockForMeal(tx, meal.propertyId, params.actualCount)
      : []
    return { meal, crossedMinimum }
  })

  // Alerts go out after commit, only for items this meal pushed below minimum.
  for (const itemId of crossedMinimum) await raiseLowStock(itemId)
  return meal
}

/** Resident-driven opt-out, used by the tenant app. */
export async function setMealAttendance(params: {
  residentId: string
  mealId: string
  status: 'EXPECTED' | 'SKIPPED' | 'ON_LEAVE' | 'ATTENDED'
}) {
  const attendance = await prisma.mealAttendance.upsert({
    where: { mealId_residentId: { mealId: params.mealId, residentId: params.residentId } },
    create: { mealId: params.mealId, residentId: params.residentId, status: params.status, markedAt: new Date() },
    update: { status: params.status, markedAt: new Date() },
  })

  const meal = await prisma.meal.findUnique({ where: { id: params.mealId } })
  if (meal) {
    const expected = await expectedMealCount(meal.propertyId, meal.type, meal.date)
    await prisma.meal.update({ where: { id: meal.id }, data: { expectedCount: expected } })
  }
  return attendance
}

// --------------------------------------------------------------------------
// Grocery
// --------------------------------------------------------------------------

/**
 * Estimated requirement for a horizon, derived from real meal counts and the
 * per-item factor configured by the PG. Returns the shortfall against
 * current stock — i.e. the purchase list.
 */
export async function purchasePlan(propertyId: string, days = 7) {
  const items = await prisma.groceryItem.findMany({
    where: { propertyId },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  })

  let mealsPerDay = 0
  for (const type of MEAL_TYPES) {
    mealsPerDay += await expectedMealCount(propertyId, type, new Date())
  }

  return items.map((item) => {
    // perResidentPerMeal is expressed in the item's own base unit.
    const required = Math.ceil((item.perResidentPerMeal * mealsPerDay * days) / 1000) // g→kg, ml→L
    const normalised =
      item.unit === 'KG' || item.unit === 'LITRE'
        ? required
        : Math.ceil(item.perResidentPerMeal * mealsPerDay * days)
    const shortfall = Math.max(0, normalised + item.minimumStock - item.currentStock)
    return {
      ...item,
      mealsPerDay,
      estimatedRequirement: normalised,
      shortfall,
      needsPurchase: shortfall > 0 || item.currentStock <= item.minimumStock,
      estimatedCost: shortfall * item.lastPurchasePrice,
    }
  })
}

/**
 * Deducts stock when a meal is served.
 *
 * TODO(kitchen): GroceryItem has no meal-type mapping, so every item with a
 * per-meal factor is deducted for every meal (tea leaves at dinner, rice at
 * breakfast). Deducting per meal type needs a schema field such as
 * `mealTypes MealType[]` on GroceryItem; until then this keeps the old
 * behaviour.
 *
 * NOTE: currentStock is an Int column, so a deduction below one whole unit
 * (e.g. 0.3 kg of salt) is lost to rounding and never accumulates. Fixing that
 * needs currentStock (and minimumStock) to become Float/Decimal.
 */
async function consumeStockForMeal(
  tx: Prisma.TransactionClient,
  propertyId: string,
  count: number,
): Promise<string[]> {
  const crossedMinimum: string[] = []
  const items = await tx.groceryItem.findMany({
    where: { propertyId, perResidentPerMeal: { gt: 0 } },
  })
  for (const item of items) {
    const used =
      item.unit === 'KG' || item.unit === 'LITRE'
        ? (item.perResidentPerMeal * count) / 1000
        : item.perResidentPerMeal * count
    const deduct = Math.min(item.currentStock, Math.round(used))
    if (deduct <= 0) continue
    const next = item.currentStock - deduct
    // Atomic decrement so a purchase recorded at the same moment is not lost.
    await tx.groceryItem.update({
      where: { id: item.id },
      data: { currentStock: { decrement: deduct } },
    })
    if (next <= item.minimumStock && item.currentStock > item.minimumStock) {
      crossedMinimum.push(item.id)
    }
  }
  return crossedMinimum
}

async function raiseLowStock(itemId: string) {
  const item = await prisma.groceryItem.findUnique({
    where: { id: itemId },
    include: { property: true },
  })
  if (!item) return
  // No low-stock alerts while the grocery module is switched off.
  if (!(await isModuleOn(item.organizationId, 'grocery'))) return
  await recordActivity({
    organizationId: item.organizationId,
    propertyId: item.propertyId,
    actorName: 'Automation',
    event: 'STOCK_LOW',
    entityType: 'GroceryItem',
    entityId: item.id,
    summary: `${item.name} is low — ${item.currentStock}${UNIT_LABEL[item.unit]} left (minimum ${item.minimumStock})`,
  })
  await notifyOrgAdmins(item.organizationId, {
    kind: 'GROCERY',
    title: 'Low stock',
    body: `${item.name} at ${item.property.name}: ${item.currentStock}${UNIT_LABEL[item.unit]} left.`,
    link: '/app/grocery',
  })
}

/** Records a purchase: stock up, expense created, activity logged. */
export async function recordPurchase(params: {
  organizationId: string
  propertyId: string
  groceryItemId: string
  quantity: number
  unitPrice: number
  vendor?: string
  purchaseDate: Date
  invoiceRef?: string
  createExpense?: boolean
  actor: { id?: string; name: string }
}) {
  if (params.quantity <= 0) throw new ValidationError('Quantity must be greater than zero')

  return prisma.$transaction(async (tx) => {
    const item = await tx.groceryItem.findFirst({
      where: { id: params.groceryItemId, propertyId: params.propertyId },
    })
    if (!item) throw new NotFoundError('Grocery item not found')

    const totalAmount = params.quantity * params.unitPrice

    let expenseId: string | undefined
    if (params.createExpense !== false) {
      const category = await tx.expenseCategory.findFirst({
        where: { organizationId: params.organizationId, slug: 'groceries' },
      })
      if (category) {
        const expense = await tx.expense.create({
          data: {
            organizationId: params.organizationId,
            propertyId: params.propertyId,
            categoryId: category.id,
            title: `${item.name} — ${params.quantity}${UNIT_LABEL[item.unit]}`,
            amount: totalAmount,
            spentOn: startOfDay(params.purchaseDate),
            paidTo: params.vendor,
            reference: params.invoiceRef,
            recordedBy: params.actor.name,
          },
        })
        expenseId = expense.id
      }
    }

    const purchase = await tx.groceryPurchase.create({
      data: {
        organizationId: params.organizationId,
        propertyId: params.propertyId,
        groceryItemId: item.id,
        quantity: params.quantity,
        unitPrice: params.unitPrice,
        totalAmount,
        vendor: params.vendor,
        purchaseDate: startOfDay(params.purchaseDate),
        invoiceRef: params.invoiceRef,
        expenseId,
        purchasedBy: params.actor.name,
      },
    })

    await tx.groceryItem.update({
      where: { id: item.id },
      data: {
        currentStock: { increment: params.quantity },
        lastPurchasePrice: params.unitPrice,
        vendor: params.vendor ?? item.vendor,
      },
    })

    await recordActivity(
      {
        organizationId: params.organizationId,
        propertyId: params.propertyId,
        actorId: params.actor.id,
        actorName: params.actor.name,
        event: 'STOCK_PURCHASED',
        entityType: 'GroceryPurchase',
        entityId: purchase.id,
        summary: `${item.name} +${params.quantity}${UNIT_LABEL[item.unit]} · ${formatMoney(totalAmount)}`,
      },
      tx,
    )

    return { purchase, expenseId }
  })
}

export async function lowStockItems(propertyIds: string[]) {
  const items = await prisma.groceryItem.findMany({
    where: { propertyId: { in: propertyIds } },
    include: { property: { select: { name: true, type: true } } },
    orderBy: { name: 'asc' },
  })
  return items.filter((i) => i.currentStock <= i.minimumStock)
}
