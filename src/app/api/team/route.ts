import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { parseBody, route } from '@/lib/api-helpers'
import { phoneSchema } from '@/lib/validation'
import {
  assertPropertyAccess,
  assertResidentAccess,
  ForbiddenError,
  NotFoundError,
  requirePermission,
} from '@/lib/tenancy'
import { recordActivity } from '@/server/events'
import {
  inviteManager,
  resendTeamInvite,
  sendResidentAccess,
  sendStaffAccess,
  setTeamMemberActive,
  type AccessLinkResult,
} from '@/server/services/accounts'

const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('INVITE_MANAGER'),
    name: z.string().trim().min(2, 'Enter their name').max(120),
    email: z.string().trim().email('Enter a valid email'),
    phone: phoneSchema,
    /** Empty = every PG. */
    propertyIds: z.array(z.string().min(1)).default([]),
  }),
  z.object({ action: z.literal('RESEND_TEAM_INVITE'), userId: z.string().min(1) }),
  z.object({
    action: z.literal('SET_MEMBER_STATUS'),
    userId: z.string().min(1),
    active: z.boolean(),
  }),
  z.object({ action: z.literal('RESEND_RESIDENT_INVITE'), residentId: z.string().min(1) }),
  z.object({ action: z.literal('RESEND_STAFF_INVITE'), staffId: z.string().min(1) }),
])

function describe(access: AccessLinkResult, name: string) {
  const via =
    access.sentVia.length === 2
      ? 'WhatsApp and email'
      : access.sentVia[0] === 'whatsapp'
        ? 'WhatsApp'
        : access.sentVia[0] === 'email'
          ? 'email'
          : null
  if (access.kind === 'PASSWORD_RESET') {
    return `${name} already has an account — a password reset link was sent${via ? ` via ${via}` : ''}`
  }
  return via ? `Invite sent to ${name} via ${via}` : `Copy the invite link and share it with ${name}`
}

/**
 * POST /api/team — logins for the people around a PG: invite and manage
 * managers (owner only), and (re)send login links to residents and staff.
 */
export const POST = route(
  async ({ user, request }) => {
    const body = await parseBody(request, schema)
    const organizationId = user.organizationId
    if (!organizationId) throw new ForbiddenError()
    const actor = { id: user.id, name: user.name, role: user.role }

    switch (body.action) {
      case 'INVITE_MANAGER': {
        requirePermission(user, 'settings:write')
        const result = await inviteManager({
          organizationId,
          actor,
          name: body.name,
          email: body.email,
          phone: body.phone,
          propertyIds: body.propertyIds ?? [],
        })
        return {
          kind: result.kind,
          email: result.email,
          inviteUrl: result.inviteUrl,
          sentVia: result.sentVia,
          message: describe(result, result.user.name),
        }
      }

      case 'RESEND_TEAM_INVITE': {
        requirePermission(user, 'settings:write')
        const result = await resendTeamInvite({ organizationId, userId: body.userId })
        return { ...result, message: describe(result, 'them') }
      }

      case 'SET_MEMBER_STATUS': {
        requirePermission(user, 'settings:write')
        const result = await setTeamMemberActive({
          organizationId,
          actor,
          userId: body.userId,
          active: body.active,
        })
        return {
          success: true,
          message: body.active
            ? `${result.name} can sign in again`
            : `${result.name} is deactivated and signed out everywhere`,
        }
      }

      case 'RESEND_RESIDENT_INVITE': {
        requirePermission(user, 'resident:write')
        await assertResidentAccess(user, body.residentId)
        const resident = await prisma.resident.findFirst({
          where: { id: body.residentId, organizationId },
          select: { fullName: true, propertyId: true },
        })
        if (!resident) throw new NotFoundError('Resident not found')
        const result = await sendResidentAccess({ organizationId, residentId: body.residentId })
        await recordActivity({
          organizationId,
          propertyId: resident.propertyId,
          actorId: user.id,
          actorName: user.name,
          actorRole: user.role,
          event: 'RESIDENT_UPDATED',
          entityType: 'Resident',
          entityId: body.residentId,
          summary: `Login link sent to ${resident.fullName}`,
        })
        return { ...result, message: describe(result, resident.fullName) }
      }

      case 'RESEND_STAFF_INVITE': {
        requirePermission(user, 'staff:login')
        const staff = await prisma.staff.findFirst({
          where: { id: body.staffId, organizationId },
          select: { name: true, propertyId: true },
        })
        if (!staff) throw new NotFoundError('Staff member not found')
        if (staff.propertyId) await assertPropertyAccess(user, staff.propertyId)
        const result = await sendStaffAccess({ organizationId, staffId: body.staffId })
        await recordActivity({
          organizationId,
          propertyId: staff.propertyId,
          actorId: user.id,
          actorName: user.name,
          actorRole: user.role,
          event: 'STAFF_CREATED',
          entityType: 'Staff',
          entityId: body.staffId,
          summary: `Worker app login link sent to ${staff.name}`,
        })
        return { ...result, message: describe(result, staff.name) }
      }
    }
  },
  { roles: ['OWNER', 'MANAGER'] },
)
