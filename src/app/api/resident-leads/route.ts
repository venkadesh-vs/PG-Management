import { z } from 'zod'
import type { Prisma, ResidentLeadStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ok, parseBody, route } from '@/lib/api-helpers'
import { resolveScope } from '@/lib/tenancy'
import { createLead, leadCreateSchema, leadScopeWhere, type LeadCreateInput } from '@/server/services/leads'

/** GET /api/resident-leads?propertyId=&status=&q= — enquiries in scope (pickers, refresh). */
const querySchema = z.object({
  propertyId: z.string().optional(),
  status: z.string().optional(),
  q: z.string().optional(),
  open: z.string().optional(),
})

export const GET = route(
  async ({ user, request }) => {
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    const scope = await resolveScope(user, query.propertyId)
    const propertyIds = scope.propertyId ? [scope.propertyId] : scope.allowedPropertyIds
    const where: Prisma.ResidentLeadWhereInput = {
      AND: [
        leadScopeWhere(user, propertyIds),
        query.status ? { status: query.status as ResidentLeadStatus } : {},
        query.open ? { status: { notIn: ['LOST', 'CHECKED_IN'] } } : {},
        query.q
          ? {
              OR: [
                { name: { contains: query.q, mode: 'insensitive' } },
                { phone: { contains: query.q.replace(/\D/g, '') || query.q } },
              ],
            }
          : {},
      ],
    }
    const leads = await prisma.residentLead.findMany({
      where,
      include: { property: { select: { id: true, name: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 300,
    })
    return { leads }
  },
  { module: 'leads', permission: 'leads.view' },
)

/** POST /api/resident-leads — add an enquiry (an open lead with the same phone is updated instead). */
export const POST = route(
  async ({ user, request }) => {
    const body = await parseBody(request, leadCreateSchema as z.ZodType<LeadCreateInput>)
    const { lead, deduped } = await createLead(user, body)
    return ok(
      {
        lead,
        deduped,
        message: deduped
          ? `${lead.name} already had an open enquiry, so we updated it instead of adding a duplicate`
          : `Enquiry from ${lead.name} added. Follow up today while they are keen.`,
      },
      { status: deduped ? 200 : 201 },
    )
  },
  { module: 'leads', permission: 'leads.manage' },
)
