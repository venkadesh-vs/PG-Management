import { z } from 'zod'
import { parseBody, parseQuery, route } from '@/lib/api-helpers'
import { requirePermission, resolveScope } from '@/lib/tenancy'
import {
  createRequest,
  createRequestSchema,
  type CreateRequestInput,
  listRequests,
  residentRequests,
} from '@/server/services/requests'

const listQuery = z.object({
  tab: z.enum(['pending', 'approved', 'all']).optional(),
  kind: z.enum(['LEAVE', 'VISITOR', 'ROOM_CHANGE', 'SERVICE', 'OTHER']).optional(),
  property: z.string().optional(),
})

/**
 * GET /api/requests — a resident sees their own requests; the owner team
 * (requests.view) sees the inbox for the PGs they cover.
 */
export const GET = route(
  async ({ user, request }) => {
    if (user.role === 'TENANT') {
      return { requests: await residentRequests(user.residentId!) }
    }
    requirePermission(user, 'requests.view')
    const query = parseQuery(request, listQuery)
    const scope = await resolveScope(user, query.property)
    return { requests: await listRequests(scope, { tab: query.tab, kind: query.kind }) }
  },
  { module: 'requests', roles: ['TENANT', 'OWNER', 'MANAGER'] },
)

/** POST /api/requests — a resident raises leave / visitor / room / service. */
export const POST = route(
  async ({ user, request }) => {
    const body = await parseBody(request, createRequestSchema as z.ZodType<CreateRequestInput>)
    const created = await createRequest(user, body)
    return { request: created, message: 'Request sent. We will let you know as soon as it is answered.' }
  },
  { module: 'requests', roles: ['TENANT'] },
)
