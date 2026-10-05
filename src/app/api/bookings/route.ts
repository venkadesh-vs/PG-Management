import { z } from 'zod'
import type { BookingStatus, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ok, parseBody, route } from '@/lib/api-helpers'
import { assertPropertyAccess, resolveScope } from '@/lib/tenancy'
import { bookingCreateSchema, createBooking, type BookingCreateInput } from '@/server/services/bookings'

const querySchema = z.object({
  view: z.enum(['list', 'beds']).optional(),
  propertyId: z.string().optional(),
  status: z.string().optional(),
  q: z.string().optional(),
})

/**
 * GET /api/bookings?propertyId=&status=&q=      — bookings in scope
 * GET /api/bookings?view=beds&propertyId=…      — free beds to hold, by room
 */
export const GET = route(
  async ({ user, request }) => {
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams))

    if (query.view === 'beds') {
      if (!query.propertyId) return { rooms: [] }
      await assertPropertyAccess(user, query.propertyId)
      const [property, rooms] = await Promise.all([
        prisma.property.findUnique({
          where: { id: query.propertyId },
          select: { standardRent: true, standardDeposit: true },
        }),
        prisma.room.findMany({
          where: { propertyId: query.propertyId, beds: { some: { status: 'AVAILABLE', residentId: null } } },
          select: {
            id: true,
            number: true,
            type: true,
            baseRent: true,
            hasAC: true,
            floor: { select: { name: true, level: true } },
            beds: {
              where: { status: 'AVAILABLE', residentId: null },
              select: { id: true, label: true, rent: true },
              orderBy: { label: 'asc' },
            },
          },
          orderBy: [{ floor: { level: 'asc' } }, { number: 'asc' }],
        }),
      ])
      return {
        standardRent: property?.standardRent ?? 0,
        standardDeposit: property?.standardDeposit ?? 0,
        rooms: rooms.map((room) => ({
          id: room.id,
          number: room.number,
          type: room.type,
          hasAC: room.hasAC,
          floor: room.floor.name,
          beds: room.beds.map((bed) => ({
            id: bed.id,
            label: bed.label,
            rent: bed.rent ?? room.baseRent ?? property?.standardRent ?? 0,
          })),
        })),
      }
    }

    const scope = await resolveScope(user, query.propertyId)
    const where: Prisma.BookingWhereInput = {
      organizationId: scope.organizationId,
      propertyId: scope.propertyId ?? { in: scope.allowedPropertyIds },
      ...(query.status ? { status: query.status as BookingStatus } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { code: { contains: query.q, mode: 'insensitive' } },
              { phone: { contains: query.q } },
            ],
          }
        : {}),
    }
    const bookings = await prisma.booking.findMany({
      where,
      include: {
        bed: { select: { label: true, room: { select: { number: true } } } },
        property: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 300,
    })
    return { bookings }
  },
  { module: 'leads', permission: 'leads.view' },
)

/** POST /api/bookings — create a booking; CONFIRMED atomically reserves the bed. */
export const POST = route(
  async ({ user, request }) => {
    const body = await parseBody(request, bookingCreateSchema as z.ZodType<BookingCreateInput>)
    const result = await createBooking(user, body)
    return ok(result, { status: 201 })
  },
  { module: 'leads', permission: 'bookings.manage' },
)
