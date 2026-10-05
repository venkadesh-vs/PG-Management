import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ok, route } from '@/lib/api-helpers'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/tenancy'
import { createClientSchema, leadUpdateSchema } from '@/lib/validation'
import { bootstrapOrganization, sendAccessLink } from '@/server/services/accounts'
import { recordActivity } from '@/server/events'
import { LEAD_STATUS_STYLE } from '@/lib/theme'

const convertSchema = createClientSchema.extend({
  action: z.literal('CONVERT'),
  leadId: z.string().min(1),
})

/**
 * Move a lead through the pipeline and record what was said, or (action
 * CONVERT) turn it into a client account.
 */
export const POST = route(
  async ({ user, request }) => {
    let raw: unknown
    try {
      raw = await request.json()
    } catch {
      throw new ValidationError('Request body must be valid JSON')
    }

    if ((raw as { action?: string } | null)?.action === 'CONVERT') {
      const input = convertSchema.parse(raw)
      const lead = await prisma.lead.findUnique({ where: { id: input.leadId } })
      if (!lead) throw new NotFoundError('Lead not found')
      if (lead.convertedOrgId) throw new ConflictError('This lead was already converted')

      const { organization, owner } = await bootstrapOrganization({
        orgName: input.orgName,
        ownerName: input.ownerName,
        email: input.email,
        phone: input.phone,
        city: input.city || null,
        source: 'LEAD',
        actor: { id: user.id, name: user.name, role: user.role },
      })
      await prisma.lead.update({
        where: { id: lead.id },
        data: { status: 'CONVERTED', convertedOrgId: organization.id, lastContactedAt: new Date() },
      })
      await prisma.leadNote.create({
        data: {
          leadId: lead.id,
          authorId: user.id,
          authorName: user.name,
          body: `Converted to client account ${organization.name}`,
          statusTo: 'CONVERTED',
        },
      })
      await recordActivity({
        actorId: user.id,
        actorName: user.name,
        actorRole: user.role,
        event: 'LEAD_UPDATED',
        entityType: 'Lead',
        entityId: lead.id,
        summary: `${lead.name} converted to client ${organization.name}`,
      })
      const access = await sendAccessLink(owner.id)
      return ok(
        {
          organization: { id: organization.id, name: organization.name },
          ...access,
          message: `${organization.name} created from this lead`,
        },
        { status: 201 },
      )
    }

    const body = leadUpdateSchema.parse(raw)

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
