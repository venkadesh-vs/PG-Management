import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ok, parseBody, route } from '@/lib/api-helpers'
import {
  assertFloorInProperty,
  assertPropertyAccess,
  ConflictError,
  NotFoundError,
} from '@/lib/tenancy'
import { bedUpdateSchema, floorSchema, roomSchema } from '@/lib/validation'
import { recordActivity } from '@/server/events'

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('ADD_FLOOR') }).merge(floorSchema),
  z.object({ action: z.literal('ADD_ROOM') }).merge(roomSchema),
  z.object({ action: z.literal('UPDATE_BED') }).merge(bedUpdateSchema),
  z.object({
    action: z.literal('BULK_ROOMS'),
    propertyId: z.string().min(1),
    floorId: z.string().min(1),
    prefix: z.string().max(4).optional(),
    startNumber: z.coerce.number().int().min(1),
    count: z.coerce.number().int().min(1).max(40),
    capacity: z.coerce.number().int().min(1).max(12),
    type: z.enum(['SINGLE', 'DOUBLE', 'TRIPLE', 'QUAD', 'DORM']),
    baseRent: z.coerce.number().int().min(0).optional(),
    hasAC: z.boolean().default(false),
  }),
])

/** Floors, rooms and beds. Adding a room creates its beds in the same go. */
export const POST = route(
  async ({ user, request }) => {
    const body = await parseBody(request, schema)

    if (body.action === 'UPDATE_BED') {
      const bed = await prisma.bed.findUnique({
        where: { id: body.bedId },
        include: { room: true, property: true, resident: true },
      })
      if (!bed) throw new NotFoundError('Bed not found')
      await assertPropertyAccess(user, bed.propertyId)

      if (body.status && body.status !== 'OCCUPIED' && bed.residentId) {
        throw new ConflictError(
          `${bed.resident?.fullName ?? 'A resident'} is in this bed. Move or check them out first.`,
        )
      }
      if (body.status === 'OCCUPIED' && !bed.residentId) {
        throw new ConflictError('Check a resident in to mark a bed occupied')
      }

      const updated = await prisma.bed.update({
        where: { id: bed.id },
        data: {
          ...(body.status ? { status: body.status } : {}),
          ...(body.rent !== undefined ? { rent: body.rent } : {}),
          ...(body.notes !== undefined ? { notes: body.notes || null } : {}),
          ...(body.blockedReason !== undefined
            ? { blockedReason: body.blockedReason || null }
            : {}),
        },
      })
      return ok({
        bed: updated,
        message: `Bed ${bed.label} in Room ${bed.room.number} updated`,
      })
    }

    await assertPropertyAccess(user, body.propertyId)

    if (body.action === 'ADD_FLOOR') {
      const floor = await prisma.floor.create({
        data: { propertyId: body.propertyId, name: body.name, level: body.level },
      })
      return ok({ floor, message: `${floor.name} added` }, { status: 201 })
    }

    // A room's floor must sit in the same PG, or beds end up split across
    // properties (and across organizations).
    if (body.action === 'ADD_ROOM' || body.action === 'BULK_ROOMS') {
      await assertFloorInProperty(body.floorId, body.propertyId)
    }

    if (body.action === 'ADD_ROOM') {
      const exists = await prisma.room.findFirst({
        where: { propertyId: body.propertyId, number: body.number },
      })
      if (exists) throw new ConflictError(`Room ${body.number} already exists in this PG`)

      const room = await prisma.room.create({
        data: {
          propertyId: body.propertyId,
          floorId: body.floorId,
          number: body.number,
          type: body.type,
          capacity: body.capacity,
          baseRent: body.baseRent ?? null,
          hasAC: body.hasAC,
          hasBalcony: body.hasBalcony,
          hasAttachedBath: body.hasAttachedBath,
          notes: body.notes || null,
          beds: {
            create: Array.from({ length: body.capacity }, (_, i) => ({
              propertyId: body.propertyId,
              floorId: body.floorId,
              label: String.fromCharCode(65 + i),
              status: 'AVAILABLE' as const,
              rent: body.baseRent ?? null,
            })),
          },
        },
        include: { beds: true },
      })

      await recordActivity({
        organizationId: user.organizationId!,
        propertyId: body.propertyId,
        actorId: user.id,
        actorName: user.name,
        actorRole: user.role,
        event: 'PROPERTY_UPDATED',
        entityType: 'Room',
        entityId: room.id,
        summary: `Room ${room.number} added with ${room.beds.length} beds`,
      })

      return ok(
        { room, message: `Room ${room.number} added with ${room.beds.length} beds` },
        { status: 201 },
      )
    }

    // BULK_ROOMS — the fastest way to set up a new floor.
    const created: string[] = []
    for (let i = 0; i < body.count; i++) {
      const number = `${body.prefix ?? ''}${body.startNumber + i}`
      const exists = await prisma.room.findFirst({
        where: { propertyId: body.propertyId, number },
      })
      if (exists) continue
      await prisma.room.create({
        data: {
          propertyId: body.propertyId,
          floorId: body.floorId,
          number,
          type: body.type,
          capacity: body.capacity,
          baseRent: body.baseRent ?? null,
          hasAC: body.hasAC,
          beds: {
            create: Array.from({ length: body.capacity }, (_, b) => ({
              propertyId: body.propertyId,
              floorId: body.floorId,
              label: String.fromCharCode(65 + b),
              status: 'AVAILABLE' as const,
              rent: body.baseRent ?? null,
            })),
          },
        },
      })
      created.push(number)
    }

    await recordActivity({
      organizationId: user.organizationId!,
      propertyId: body.propertyId,
      actorId: user.id,
      actorName: user.name,
      actorRole: user.role,
      event: 'PROPERTY_UPDATED',
      summary: `${created.length} rooms added (${created.length * body.capacity} beds)`,
    })

    return ok(
      {
        created: created.length,
        skipped: body.count - created.length,
        message: `${created.length} rooms and ${created.length * body.capacity} beds added`,
      },
      { status: 201 },
    )
  },
  { roles: ['OWNER', 'MANAGER'] },
)

/** GET /api/rooms?propertyId= — the bed picker data source. */
export const GET = route(
  async ({ user, request }) => {
    const url = new URL(request.url)
    const propertyId = url.searchParams.get('propertyId')
    const onlyAvailable = url.searchParams.get('available') === '1'
    if (!propertyId) return { floors: [] }
    await assertPropertyAccess(user, propertyId)

    const floors = await prisma.floor.findMany({
      where: { propertyId },
      orderBy: { level: 'asc' },
      include: {
        rooms: {
          orderBy: { number: 'asc' },
          include: {
            beds: {
              orderBy: { label: 'asc' },
              where: onlyAvailable ? { status: { in: ['AVAILABLE', 'RESERVED'] } } : undefined,
              include: { resident: { select: { id: true, fullName: true, code: true } } },
            },
          },
        },
      },
    })

    return {
      floors: floors.map((floor) => ({
        ...floor,
        rooms: floor.rooms.filter((room) => !onlyAvailable || room.beds.length > 0),
      })),
    }
  },
  { roles: ['OWNER', 'MANAGER'] },
)
