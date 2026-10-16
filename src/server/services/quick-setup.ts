import 'server-only'

import { z } from 'zod'
import { INDIA, INDIA_MESSAGE } from '@/lib/india'
import { prisma } from '@/lib/prisma'
import type { SessionUser } from '@/lib/auth'
import { ValidationError } from '@/lib/tenancy'
import { formatMoney } from '@/lib/utils'
import {
  bedRent,
  capacityFor,
  cardRent,
  codeFromName,
  normaliseRentCard,
  SHARING,
  standardRentFrom,
  stateFromPincode,
  type RentCard,
  type SharingType,
} from '@/lib/rent-card'
import { recordActivity } from '@/server/events'
import { assertWithinPlan } from './plan-limits'
import { createSubscriptionForProperty, repriceSubscription } from './subscriptions'

/**
 * Quick setup: a whole PG in one request (the PG, floors, rooms, beds, rent
 * card, food and deposit), and the rent card editor for an existing PG.
 * The standard rent that prices the subscription is always worked out here
 * from the beds, never typed in.
 */

const sharing = z.enum(SHARING.map((s) => s.type) as [SharingType, ...SharingType[]])
const price = z.coerce.number().int().min(0).max(10_000_000).nullable().optional()

export const rentCardSchema = z.record(sharing, z.object({ nonAc: price, ac: price }))

export const quickSetupSchema = z.object({
  name: z.string().trim().min(3, 'Give the PG a name').max(120),
  type: z.enum(['MENS', 'WOMENS', 'COLIVE']),
  addressLine: z.string().trim().min(3, 'Enter the area or street').max(200),
  city: z.string().trim().min(2, 'Enter the city').max(80),
  pincode: z.string().trim().regex(INDIA.pincode, INDIA_MESSAGE.pincode),
  /** One row per room group: a floor can have several (e.g. 6 two-sharing + 4 three-sharing). */
  groups: z
    .array(
      z.object({
        level: z.coerce.number().int().min(0).max(30),
        rooms: z.coerce.number().int().min(1).max(60),
        sharing,
        ac: z.boolean(),
      }),
    )
    .min(1, 'Add at least one floor with rooms')
    .max(80),
  rentCard: rentCardSchema,
  food: z.enum(['NONE', 'INCLUDED', 'SEPARATE']),
  foodCharge: z.coerce.number().int().min(0).max(100_000).default(0),
  depositMonths: z.coerce.number().min(0).max(6).default(1),
  electricity: z.enum(['INCLUDED', 'METERED']).default('INCLUDED'),
})
export type QuickSetupInput = z.input<typeof quickSetupSchema>

function floorName(level: number) {
  if (level === 0) return 'Ground floor'
  const s = level % 10 === 1 && level !== 11 ? 'st' : level % 10 === 2 && level !== 12 ? 'nd' : level % 10 === 3 && level !== 13 ? 'rd' : 'th'
  return `${level}${s} floor`
}

/** Planned rooms with numbers: ground 1, 2…; first 101, 102…; groups on a floor continue the numbering. */
export function planRooms(groups: z.infer<typeof quickSetupSchema>['groups']) {
  const next = new Map<number, number>()
  const rooms: { level: number; number: string; type: SharingType; capacity: number; ac: boolean }[] = []
  for (const g of groups) {
    let n = next.get(g.level) ?? (g.level <= 0 ? 1 : g.level * 100 + 1)
    for (let i = 0; i < g.rooms; i++) {
      rooms.push({ level: g.level, number: String(n), type: g.sharing, capacity: capacityFor(g.sharing), ac: g.ac })
      n++
    }
    next.set(g.level, n)
  }
  return rooms
}

/** Every sharing/AC combination in the building must have a price. */
function assertPriced(card: RentCard, rooms: ReturnType<typeof planRooms>) {
  for (const r of rooms) {
    if (!cardRent(card, r.type, r.ac)) {
      const label = SHARING.find((s) => s.type === r.type)!.label
      throw new ValidationError(`rentCard: Enter the rent for ${label}${r.ac ? ' (AC)' : ''}`)
    }
  }
}

async function uniqueCode(organizationId: string, name: string) {
  const base = codeFromName(name)
  for (let i = 0; i < 50; i++) {
    const code = i === 0 ? base : `${base.slice(0, 5)}${i + 1}`
    const taken = await prisma.property.findFirst({ where: { organizationId, code }, select: { id: true } })
    if (!taken) return code
  }
  return `${base.slice(0, 4)}${Date.now().toString().slice(-3)}`
}

export async function quickSetupPg(user: SessionUser, raw: QuickSetupInput) {
  const input = quickSetupSchema.parse(raw)
  const organizationId = user.organizationId!
  const card = normaliseRentCard(input.rentCard)
  const rooms = planRooms(input.groups)
  assertPriced(card, rooms)
  const bedCount = rooms.reduce((s, r) => s + r.capacity, 0)
  await assertWithinPlan(organizationId, 'properties')
  await assertWithinPlan(organizationId, 'beds', bedCount)

  const bedRents = rooms.flatMap((r) => Array.from({ length: r.capacity }, () => cardRent(card, r.type, r.ac)!))
  const standardRent = standardRentFrom(bedRents, card)
  const code = await uniqueCode(organizationId, input.name)
  const state = stateFromPincode(input.pincode) ?? 'Tamil Nadu'
  const foodOn = input.food !== 'NONE'
  const foodCharge = input.food === 'SEPARATE' ? input.foodCharge : 0
  if (input.food === 'SEPARATE' && foodCharge <= 0) throw new ValidationError('foodCharge: Enter the monthly food charge')

  const result = await prisma.$transaction(
    async (tx) => {
      const property = await tx.property.create({
        data: {
          organizationId,
          name: input.name,
          code,
          type: input.type,
          addressLine: input.addressLine,
          city: input.city,
          state,
          pincode: input.pincode,
          standardRent,
          rentCard: card,
          standardDeposit: Math.round((standardRent * input.depositMonths) / 100) * 100,
          foodCharge,
          foodIncluded: foodOn,
          electricityMode: input.electricity,
        },
      })
      if (foodOn) {
        await tx.foodPlan.create({
          data: {
            organizationId,
            propertyId: property.id,
            name: 'Full board (3 meals)',
            description: input.food === 'INCLUDED' ? 'Included in the rent.' : 'Breakfast, lunch and dinner.',
            monthlyCharge: foodCharge,
            isDefault: true,
          },
        })
      }

      const levels = [...new Set(rooms.map((r) => r.level))].sort((a, b) => a - b)
      const floorIds = new Map<number, string>()
      for (const level of levels) {
        const floor = await tx.floor.create({ data: { propertyId: property.id, name: floorName(level), level } })
        floorIds.set(level, floor.id)
      }
      for (const r of rooms) {
        const floorId = floorIds.get(r.level)!
        await tx.room.create({
          data: {
            propertyId: property.id,
            floorId,
            number: r.number,
            type: r.type,
            capacity: r.capacity,
            hasAC: r.ac,
            baseRent: cardRent(card, r.type, r.ac),
            beds: {
              create: Array.from({ length: r.capacity }, (_, b) => ({
                propertyId: property.id,
                floorId,
                label: String.fromCharCode(65 + b),
                status: 'AVAILABLE' as const,
              })),
            },
          },
        })
      }

      const subscription = await createSubscriptionForProperty({ propertyId: property.id, tx, actor: { id: user.id, name: user.name } })
      await recordActivity(
        {
          organizationId,
          propertyId: property.id,
          actorId: user.id,
          actorName: user.name,
          actorRole: user.role,
          event: 'PROPERTY_CREATED',
          entityType: 'Property',
          entityId: property.id,
          summary: `${property.name} set up with ${rooms.length} rooms and ${bedCount} beds (quick setup)`,
          after: { standardRent, rentCard: card },
        },
        tx,
      )
      return { property, subscription }
    },
    { timeout: 60_000, maxWait: 10_000 },
  )

  return {
    propertyId: result.property.id,
    rooms: rooms.length,
    beds: bedCount,
    standardRent,
    subscription: result.subscription.subscription.amount,
    message: `${result.property.name} is ready: ${rooms.length} rooms, ${bedCount} beds. Subscription ${formatMoney(result.subscription.subscription.amount)}/month.`,
  }
}

/**
 * Saves a PG's rent card and prices every room from it. Residents already
 * staying keep their own rent; new check-ins use the new prices. The
 * standard rent and the subscription follow.
 */
export async function applyRentCard(user: SessionUser, propertyId: string, rawCard: unknown) {
  const card = normaliseRentCard(rawCard)
  if (!Object.keys(card).length) throw new ValidationError('rentCard: Enter at least one rent')
  const property = await prisma.property.findFirst({
    where: { id: propertyId, organizationId: user.organizationId!, archivedAt: null },
    include: { rooms: { include: { beds: { select: { id: true, rent: true } } } }, subscription: { select: { id: true } } },
  })
  if (!property) throw new ValidationError('PG not found')

  const missing = new Set<string>()
  await prisma.$transaction(
    async (tx) => {
      for (const room of property.rooms) {
        const rent = cardRent(card, room.type, room.hasAC)
        if (!rent) {
          missing.add(`${SHARING.find((s) => s.type === room.type)?.label ?? room.type}${room.hasAC ? ' AC' : ''}`)
          continue
        }
        await tx.room.update({ where: { id: room.id }, data: { baseRent: rent } })
        // Beds follow their room from now on.
        await tx.bed.updateMany({ where: { roomId: room.id }, data: { rent: null } })
      }
      await tx.property.update({ where: { id: property.id }, data: { rentCard: card } })
    },
    { timeout: 60_000, maxWait: 10_000 },
  )

  const { standardRent, subscription } = await refreshStandardRent(property.id)
  await recordActivity({
    organizationId: property.organizationId,
    propertyId: property.id,
    actorId: user.id,
    actorName: user.name,
    actorRole: user.role,
    event: 'PROPERTY_UPDATED',
    entityType: 'Property',
    entityId: property.id,
    summary: `Rent card updated for ${property.name}; standard rent ${formatMoney(standardRent)}`,
    before: { rentCard: property.rentCard ?? null, standardRent: property.standardRent },
    after: { rentCard: card, standardRent },
  })
  return {
    standardRent,
    subscription,
    missing: [...missing],
    message:
      `Rents updated. Standard rent is now ${formatMoney(standardRent)}` +
      (subscription ? `, subscription ${formatMoney(subscription)}/month` : '') +
      (missing.size ? `. No price yet for: ${[...missing].join(', ')}` : '.'),
  }
}

/** Works the standard rent out from the beds again and re-prices the subscription. */
export async function refreshStandardRent(propertyId: string) {
  const property = await prisma.property.findUniqueOrThrow({
    where: { id: propertyId },
    include: { rooms: { include: { beds: { select: { rent: true } } } }, subscription: { select: { id: true } } },
  })
  const rents = property.rooms.flatMap((room) => room.beds.map((bed) => bedRent(bed, room, property.standardRent)))
  const standardRent = standardRentFrom(rents, normaliseRentCard(property.rentCard)) || property.standardRent
  if (standardRent !== property.standardRent) {
    await prisma.property.update({ where: { id: propertyId }, data: { standardRent } })
  }
  let subscription: number | null = null
  if (property.subscription) {
    const result = await repriceSubscription(property.subscription.id)
    subscription = result.price.amount
  }
  return { standardRent, subscription }
}

/**
 * After rooms or bed rents change. Never fails the owner's action: if the
 * re-pricing cannot run now, the next change (or rent card save) catches up.
 */
export async function refreshStandardRentSafely(propertyId: string) {
  try {
    await refreshStandardRent(propertyId)
  } catch (error) {
    console.error('[rent-card] standard rent refresh failed', error)
  }
}
