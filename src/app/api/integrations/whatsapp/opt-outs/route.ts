import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { parseBody, route } from '@/lib/api-helpers'
import { NotFoundError, ValidationError, resolveScope } from '@/lib/tenancy'
import { recordActivity } from '@/server/events'

/**
 * /api/integrations/whatsapp/opt-outs — residents who said STOP.
 *
 * GET  → { residents: [{ id, fullName, phone, property, optedOutAt }] }
 * POST { residentId, action: 'OPT_IN' | 'OPT_OUT', reason }
 *      OPT_IN  — only when the resident asked to receive messages again;
 *                records fresh consent. Audited with the reason.
 *      OPT_OUT — the resident asked in person to stop WhatsApp messages.
 *
 * Needs settings.manage; limited to the caller's PGs.
 */

const schema = z.object({
  residentId: z.string().min(1),
  action: z.enum(['OPT_IN', 'OPT_OUT']),
  reason: z.string().trim().min(3, 'Say how the resident asked for this').max(200),
})

export const GET = route(
  async ({ user }) => {
    const scope = await resolveScope(user)
    const residents = await prisma.resident.findMany({
      where: {
        organizationId: user.organizationId!,
        propertyId: { in: scope.allowedPropertyIds },
        whatsappOptOutAt: { not: null },
      },
      select: {
        id: true,
        fullName: true,
        phone: true,
        whatsappPhone: true,
        status: true,
        whatsappOptOutAt: true,
        property: { select: { name: true } },
      },
      orderBy: { whatsappOptOutAt: 'desc' },
      take: 500,
    })
    return {
      residents: residents.map((r) => ({
        id: r.id,
        fullName: r.fullName,
        phone: r.whatsappPhone || r.phone,
        status: r.status,
        property: r.property.name,
        optedOutAt: r.whatsappOptOutAt!.toISOString(),
      })),
    }
  },
  { permission: 'settings.manage' },
)

export const POST = route(
  async ({ user, request }) => {
    const body = await parseBody(request, schema)
    const scope = await resolveScope(user)
    const resident = await prisma.resident.findFirst({
      where: { id: body.residentId, organizationId: user.organizationId!, propertyId: { in: scope.allowedPropertyIds } },
      select: { id: true, fullName: true, propertyId: true, whatsappOptOutAt: true, whatsappConsentAt: true },
    })
    if (!resident) throw new NotFoundError('Resident not found')

    const optingIn = body.action === 'OPT_IN'
    if (optingIn && !resident.whatsappOptOutAt) throw new ValidationError(`${resident.fullName} has not opted out`)
    if (!optingIn && resident.whatsappOptOutAt) throw new ValidationError(`${resident.fullName} has already opted out`)

    const now = new Date()
    const data = optingIn ? { whatsappOptOutAt: null, whatsappConsentAt: now } : { whatsappOptOutAt: now }
    await prisma.resident.update({ where: { id: resident.id }, data })

    await recordActivity({
      organizationId: user.organizationId,
      propertyId: resident.propertyId,
      actorId: user.id,
      actorName: user.name,
      actorRole: user.role,
      event: 'RESIDENT_UPDATED',
      entityType: 'Resident',
      entityId: resident.id,
      summary: `${resident.fullName} ${optingIn ? 'opted back in to' : 'opted out of'} WhatsApp messages — ${body.reason}`,
      before: {
        whatsappOptOutAt: resident.whatsappOptOutAt?.toISOString() ?? null,
        whatsappConsentAt: resident.whatsappConsentAt?.toISOString() ?? null,
      },
      after: {
        whatsappOptOutAt: optingIn ? null : now.toISOString(),
        whatsappConsentAt: optingIn ? now.toISOString() : (resident.whatsappConsentAt?.toISOString() ?? null),
      },
    })

    return {
      message: optingIn
        ? `${resident.fullName} will get WhatsApp messages again`
        : `${resident.fullName} will no longer get WhatsApp messages`,
    }
  },
  { permission: 'settings.manage' },
)
