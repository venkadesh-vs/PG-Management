import { z } from 'zod'
import { ok, parseBody, route } from '@/lib/api-helpers'
import { requireModule } from '@/lib/tenancy'
import { setResidentFood } from '@/server/services/resident-food'

const schema = z.object({
  needFood: z.boolean(),
  foodPlanId: z.string().min(1).max(40).optional(),
})

/**
 * POST /api/tenant/food — the resident starts or stops the PG's food plan.
 * Meal counts for the owner and the cook follow; billing rules are in
 * src/lib/food-choice.ts.
 */
export const POST = route(
  async ({ user, request }) => {
    requireModule(user, 'residentApp')
    const body = await parseBody(request, schema)
    return ok(await setResidentFood(user, body))
  },
  { roles: ['TENANT'], module: 'food' },
)
