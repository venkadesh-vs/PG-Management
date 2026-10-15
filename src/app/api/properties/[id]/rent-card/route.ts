import { z } from 'zod'
import { ok, parseBody, route } from '@/lib/api-helpers'
import { assertPropertyAccess } from '@/lib/tenancy'
import { applyRentCard, rentCardSchema } from '@/server/services/quick-setup'

function idFrom(request: Request) {
  const parts = new URL(request.url).pathname.split('/').filter(Boolean)
  return decodeURIComponent(parts[parts.length - 2] ?? '')
}

/**
 * PUT /api/properties/<id>/rent-card — save the PG's rent card and price every
 * room from it. The standard rent and subscription follow automatically.
 */
export const PUT = route(
  async ({ user, request }) => {
    const id = idFrom(request)
    await assertPropertyAccess(user, id)
    const body = await parseBody(request, z.object({ rentCard: rentCardSchema }))
    return ok(await applyRentCard(user, id, body.rentCard))
  },
  { module: 'properties', permission: 'properties.manage' },
)
