import { ok, parseBody, route } from '@/lib/api-helpers'
import { ForbiddenError } from '@/lib/tenancy'
import { quickSetupPg, quickSetupSchema } from '@/server/services/quick-setup'
import { canRunSetup, completeOnboarding } from '@/server/services/onboarding'

/**
 * POST /api/setup/quick — a whole PG (floors, rooms, beds, rent card, food,
 * deposit) in one go. From the first-login setup it also finishes onboarding.
 */
export const POST = route(
  async ({ user, request }) => {
    const raw = (await request.clone().json().catch(() => ({}))) as { finishOnboarding?: boolean }
    const body = await parseBody(request, quickSetupSchema)
    const result = await quickSetupPg(user, body)
    if (raw.finishOnboarding) {
      if (!canRunSetup(user)) throw new ForbiddenError()
      await completeOnboarding(user.organizationId!)
    }
    return ok(result, { status: 201 })
  },
  { permission: 'properties.create' },
)
