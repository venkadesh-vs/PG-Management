import { parseBody, route } from '@/lib/api-helpers'
import type { z } from 'zod'
import {
  bookingActionSchema,
  getBookingForUser,
  updateBooking,
  type BookingAction,
} from '@/server/services/bookings'

type Params = { params: Promise<{ id: string }> }

/** GET /api/bookings/:id */
export function GET(request: Request, { params }: Params) {
  return route(
    async ({ user }) => {
      const { id } = await params
      return { booking: await getBookingForUser(user, id) }
    },
    { module: 'leads', permission: 'leads.view' },
  )(request)
}

/** PATCH /api/bookings/:id — record token, confirm, cancel, extend. */
export function PATCH(request: Request, { params }: Params) {
  return route(
    async ({ user, request }) => {
      const { id } = await params
      const body = await parseBody(request, bookingActionSchema as z.ZodType<BookingAction>)
      return updateBooking(user, id, body)
    },
    { module: 'leads', permission: 'bookings.manage' },
  )(request)
}
