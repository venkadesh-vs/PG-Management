import { prisma } from '@/lib/prisma'
import { ok, parseBody, route } from '@/lib/api-helpers'
import { ForbiddenError, NotFoundError } from '@/lib/tenancy'
import { mealOptSchema } from '@/lib/validation'
import { setMealAttendance } from '@/server/services/kitchen'

/**
 * POST /api/tenant/meals — a resident opts in or out of a specific meal.
 * The meal's expected count is recomputed immediately.
 */
export const POST = route(
  async ({ user, request }) => {
    const body = await parseBody(request, mealOptSchema)

    const meal = await prisma.meal.findUnique({
      where: { id: body.mealId },
      select: { id: true, propertyId: true },
    })
    if (!meal) throw new NotFoundError('Meal not found')

    const resident = await prisma.resident.findUnique({
      where: { id: user.residentId! },
      select: { propertyId: true },
    })
    if (!resident || resident.propertyId !== meal.propertyId) {
      throw new ForbiddenError('That meal is not at your PG')
    }

    await setMealAttendance({
      residentId: user.residentId!,
      mealId: meal.id,
      status: body.status,
    })

    return ok({ message: 'Meal preference saved' })
  },
  { roles: ['TENANT'] },
)
