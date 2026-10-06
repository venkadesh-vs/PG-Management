import { z } from 'zod'
import { parseBody, route } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/tenancy'
import { cancelRequest, decideRequest, decideRequestSchema, type DecideRequestInput } from '@/server/services/requests'

type Params = { params: Promise<{ id: string }> }

const tenantAction = z.object({ action: z.literal('CANCEL') })

/**
 * PATCH /api/requests/:id
 * - resident: { action: 'CANCEL' } while still pending
 * - owner team (requests.manage): { action: 'APPROVE' | 'REJECT' | 'DONE', note?, createTask? }
 */
export function PATCH(request: Request, { params }: Params) {
  return route(
    async ({ user, request }) => {
      const { id } = await params
      if (user.role === 'TENANT') {
        await parseBody(request, tenantAction)
        await cancelRequest(user, id)
        return { message: 'Request cancelled' }
      }
      requirePermission(user, 'requests.manage')
      const body = await parseBody(request, decideRequestSchema as z.ZodType<DecideRequestInput>)
      const result = await decideRequest(user, id, body)
      return { ...result, message: 'Request updated' }
    },
    { module: 'requests', roles: ['TENANT', 'OWNER', 'MANAGER'] },
  )(request)
}
