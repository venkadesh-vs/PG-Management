import { prisma } from '@/lib/prisma'
import { ok, parseBody, route } from '@/lib/api-helpers'
import { NotFoundError } from '@/lib/tenancy'
import { leadUpdateSchema } from '@/lib/validation'
import { recordActivity } from '@/server/events'
import { LEAD_STATUS_STYLE } from '@/lib/theme'

/** Move a lead through the pipeline and record what was said. */
export const POST = route(
  async ({ user, request }) => {
    const body = await parseBody(request, leadUpdateSchema)

    const lead = await prisma.lead.findUnique({ where: { id: body.leadId } })
    if (!lead) throw new NotFoundError('Lead not found')

    const statusChanged = Boolean(body.status && body.status !== lead.status)

    const updated = await prisma.lead.update({
      where: { id: lead.id },
      data: {
        ...(body.status ? { status: body.status } : {}),
        ...(body.demoAt ? { demoAt: new Date(body.demoAt) } : {}),
        // Any interaction counts as contact.
        lastContactedAt: new Date(),
      },
    })

    if (body.note?.trim() || statusChanged) {
      await prisma.leadNote.create({
        data: {
          leadId: lead.id,
          authorId: user.id,
          authorName: user.name,
          body:
            body.note?.trim() ||
            `Status changed to ${LEAD_STATUS_STYLE[updated.status].label.toLowerCase()}`,
          statusTo: body.status,
        },
      })
    }

    if (statusChanged) {
      await recordActivity({
        actorId: user.id,
        actorName: user.name,
        actorRole: user.role,
        event: 'LEAD_UPDATED',
        entityType: 'Lead',
        entityId: lead.id,
        summary: `${lead.name} moved to ${LEAD_STATUS_STYLE[updated.status].label.toLowerCase()}`,
      })
    }

    return ok({
      lead: updated,
      message: statusChanged
        ? `${lead.name} is now ${LEAD_STATUS_STYLE[updated.status].label.toLowerCase()}`
        : 'Note saved',
    })
  },
  { roles: ['SUPER_ADMIN'] },
)
