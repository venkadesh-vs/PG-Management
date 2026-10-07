import { z } from 'zod'
import { ok, parseBody, route } from '@/lib/api-helpers'
import { taskForComplaint } from '@/server/services/maintenance'

/**
 * POST /api/maintenance  { action: 'FROM_COMPLAINT', complaintId }
 * Starts repair tracking (vendor, estimate, cost) for a complaint that has no
 * task yet. Returns the existing task when there already is one.
 */
const schema = z.object({ action: z.literal('FROM_COMPLAINT'), complaintId: z.string().min(1) })

export const POST = route(
  async ({ user, request }) => {
    const body = await parseBody(request, schema)
    const { task, created } = await taskForComplaint(user, body.complaintId)
    return ok({ task, message: created ? 'Repair tracking started' : 'Repair already tracked' }, { status: created ? 201 : 200 })
  },
  { module: 'complaints', permission: 'complaints.manage' },
)
