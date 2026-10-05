import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ok, parseBody, route } from '@/lib/api-helpers'
import { NotFoundError } from '@/lib/tenancy'
import { recordActivity } from '@/server/events'

const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('SET_STATUS'),
    organizationId: z.string().min(1),
    status: z.enum(['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED']),
    note: z.string().optional(),
  }),
])

/** Platform-level account controls. Super Admin only. */
export const POST = route(
  async ({ user, request }) => {
    const body = await parseBody(request, schema)

    const org = await prisma.organization.findUnique({
      where: { id: body.organizationId },
      select: { id: true, name: true, status: true },
    })
    if (!org) throw new NotFoundError('Organization not found')

    await prisma.organization.update({
      where: { id: org.id },
      data: { status: body.status, notes: body.note ?? undefined },
    })

    // Suspending the account also suspends every owner/manager login so the
    // restriction is enforced at sign-in, not just in the UI.
    await prisma.user.updateMany({
      where: { organizationId: org.id, role: { in: ['OWNER', 'MANAGER'] } },
      data: { status: body.status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE' },
    })

    await recordActivity({
      organizationId: org.id,
      actorId: user.id,
      actorName: user.name,
      actorRole: user.role,
      event: 'SETTINGS_UPDATED',
      entityType: 'Organization',
      entityId: org.id,
      summary: `${org.name} moved from ${org.status.toLowerCase()} to ${body.status.toLowerCase()}${
        body.note ? ` — ${body.note}` : ''
      }`,
    })

    return ok({ message: `${org.name} is now ${body.status.replace('_', ' ').toLowerCase()}` })
  },
  { roles: ['SUPER_ADMIN'] },
)
