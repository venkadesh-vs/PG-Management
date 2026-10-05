import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ok, parseBody, route } from '@/lib/api-helpers'
import { NotFoundError } from '@/lib/tenancy'
import { recordActivity } from '@/server/events'
import { createClientSchema } from '@/lib/validation'
import { OPTIONAL_MODULES } from '@/lib/modules'
import { ValidationError } from '@/lib/tenancy'
import type { Prisma } from '@prisma/client'
import { bootstrapOrganization, sendAccessLink, sendOwnerAccess } from '@/server/services/accounts'

const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('SET_STATUS'),
    organizationId: z.string().min(1),
    status: z.enum(['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED']),
    note: z.string().optional(),
  }),
  z.object({ action: z.literal('CREATE') }).merge(createClientSchema),
  z.object({ action: z.literal('RESEND_OWNER_INVITE'), organizationId: z.string().min(1) }),
  z.object({
    action: z.literal('SET_FEATURE_OVERRIDES'),
    organizationId: z.string().min(1),
    /** Flag keys withheld from this client ({flag: false} is stored). Others follow the global flag. */
    withheld: z.array(z.string().min(1)).max(50),
  }),
])

const MODULE_FLAGS = new Set(OPTIONAL_MODULES.flatMap((m) => (m.flag ? [m.flag] : [])))

/** Platform-level account controls. Super Admin only. */
export const POST = route(
  async ({ user, request }) => {
    const body = await parseBody(request, schema)

    if (body.action === 'CREATE') {
      // Same bootstrap as self-signup; the owner gets an invite, not a password.
      const { organization, owner } = await bootstrapOrganization({
        orgName: body.orgName,
        ownerName: body.ownerName,
        email: body.email,
        phone: body.phone,
        city: body.city || null,
        source: 'ADMIN',
        actor: { id: user.id, name: user.name, role: user.role },
      })
      const access = await sendAccessLink(owner.id)
      return ok(
        {
          organization: { id: organization.id, name: organization.name },
          ...access,
          message: `${organization.name} created — invite ${access.sentVia.length ? 'sent' : 'ready to share'}`,
        },
        { status: 201 },
      )
    }

    if (body.action === 'RESEND_OWNER_INVITE') {
      const { owner, ...access } = await sendOwnerAccess(body.organizationId)
      return ok({
        ...access,
        message:
          access.kind === 'PASSWORD_RESET'
            ? `${owner.name} already uses StayFlow — a password reset link was sent to them`
            : `Invite sent to ${owner.name}`,
      })
    }

    if (body.action === 'SET_FEATURE_OVERRIDES') {
      const unknown = body.withheld.filter((f) => !MODULE_FLAGS.has(f))
      if (unknown.length) throw new ValidationError(`Unknown feature: ${unknown.join(', ')}`)
      const target = await prisma.organization.findUnique({
        where: { id: body.organizationId },
        select: { id: true, name: true, featureOverrides: true },
      })
      if (!target) throw new NotFoundError('Organization not found')
      // Keep any non-module overrides untouched; rewrite only module flags.
      const current = { ...((target.featureOverrides ?? {}) as Record<string, unknown>) }
      for (const flag of MODULE_FLAGS) delete current[flag]
      for (const flag of body.withheld) current[flag] = false
      await prisma.organization.update({
        where: { id: target.id },
        data: { featureOverrides: current as Prisma.InputJsonValue },
      })
      const labels = OPTIONAL_MODULES.filter((m) => m.flag && body.withheld.includes(m.flag)).map((m) => m.label)
      await recordActivity({
        organizationId: target.id,
        actorId: user.id,
        actorName: user.name,
        actorRole: user.role,
        event: 'SETTINGS_UPDATED',
        entityType: 'Organization',
        entityId: target.id,
        summary: labels.length
          ? `StayFlow withheld ${labels.join(', ')} for ${target.name}`
          : `StayFlow restored every plan feature for ${target.name}`,
      })
      return ok({ featureOverrides: current, message: `Features updated for ${target.name}` })
    }

    const org = await prisma.organization.findUnique({
      where: { id: body.organizationId },
      select: { id: true, name: true, status: true },
    })
    if (!org) throw new NotFoundError('Organization not found')

    await prisma.organization.update({
      where: { id: org.id },
      data: { status: body.status, notes: body.note ?? undefined },
    })

    // Individual logins are left alone: the organization status is checked
    // on every request (lib/auth isOrgRestricted), so owners can still sign in
    // to pay, residents/staff see a paused screen, and a user suspended for
    // their own reasons is never silently re-activated.

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
