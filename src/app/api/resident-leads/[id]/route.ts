import { prisma } from '@/lib/prisma'
import { parseBody, route } from '@/lib/api-helpers'
import type { z } from 'zod'
import { getLeadForUser, leadActionSchema, updateLead, type LeadAction } from '@/server/services/leads'

type Params = { params: Promise<{ id: string }> }

/** GET /api/resident-leads/:id — one enquiry with its timeline and bookings. */
export function GET(request: Request, { params }: Params) {
  return route(
    async ({ user }) => {
      const { id } = await params
      await getLeadForUser(user, id)
      const lead = await prisma.residentLead.findUnique({
        where: { id },
        include: {
          property: { select: { id: true, name: true } },
          activities: { orderBy: { createdAt: 'desc' }, take: 100 },
          bookings: { orderBy: { createdAt: 'desc' }, select: { id: true, code: true, status: true, checkInDate: true } },
        },
      })
      return { lead }
    },
    { module: 'leads', permission: 'leads.view' },
  )(request)
}

/** PATCH /api/resident-leads/:id — pipeline actions (log call, visit, lost…). */
export function PATCH(request: Request, { params }: Params) {
  return route(
    async ({ user, request }) => {
      const { id } = await params
      const body = await parseBody(request, leadActionSchema as z.ZodType<LeadAction>)
      return updateLead(user, id, body)
    },
    { module: 'leads', permission: 'leads.manage' },
  )(request)
}
