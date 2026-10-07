import { z } from 'zod'
import { parseBody, route } from '@/lib/api-helpers'
import { assertPropertyAccess, ForbiddenError } from '@/lib/tenancy'
import { STEP_KEYS, type SetupStepKey } from '@/app/(owner)/app/setup/steps'
import {
  canRunSetup,
  completeOnboarding,
  ensureDefaultFoodPlan,
  getOnboarding,
  reopenOnboarding,
  saveProgress,
} from '@/server/services/onboarding'

const stepKey = z.enum(STEP_KEYS as [SetupStepKey, ...SetupStepKey[]])

const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('SAVE'),
    step: stepKey,
    finish: z.object({ key: stepKey, how: z.enum(['complete', 'skip']) }).optional(),
    propertyId: z.string().min(1).optional(),
    answers: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    action: z.literal('FOOD_PLAN'),
    propertyId: z.string().min(1),
    monthlyCharge: z.coerce.number().int().min(0).max(100000),
    mealPlan: z.enum(['ALL', 'BREAKFAST_DINNER', 'DINNER']),
  }),
  z.object({ action: z.literal('COMPLETE') }),
  z.object({ action: z.literal('REOPEN') }),
])

function guard(user: Parameters<typeof canRunSetup>[0]) {
  if (!canRunSetup(user)) throw new ForbiddenError('Only the PG owner can run the setup wizard.')
}

/** GET /api/onboarding — where the wizard is and how far along. */
export const GET = route(
  async ({ user }) => {
    guard(user)
    return getOnboarding(user.organizationId!)
  },
  { roles: ['OWNER', 'MANAGER'] },
)

/**
 * POST /api/onboarding — wizard progress only. Real records (PG, floors,
 * rooms, settings, invites) are written through their own APIs.
 */
export const POST = route(
  async ({ user, request }) => {
    guard(user)
    const body = await parseBody(request, schema)
    const organizationId = user.organizationId!

    switch (body.action) {
      case 'SAVE': {
        if (body.propertyId) await assertPropertyAccess(user, body.propertyId)
        const result = await saveProgress(organizationId, body)
        return { ...result, message: 'Progress saved' }
      }
      case 'FOOD_PLAN': {
        await assertPropertyAccess(user, body.propertyId)
        await ensureDefaultFoodPlan(organizationId, body.propertyId, body)
        return { message: 'Meal plan saved' }
      }
      case 'COMPLETE': {
        const result = await completeOnboarding(organizationId)
        return { ...result, message: 'Setup complete — your PG is ready' }
      }
      case 'REOPEN': {
        await reopenOnboarding(organizationId)
        return { message: 'Setup reopened' }
      }
    }
  },
  { roles: ['OWNER', 'MANAGER'] },
)
