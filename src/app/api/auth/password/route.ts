import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { HOME_FOR_ROLE, revokeOtherSessions } from '@/lib/auth'
import { hashPassword, passwordProblem, verifyPassword } from '@/lib/password'
import { fail, parseBody, route } from '@/lib/api-helpers'
import { recordActivity } from '@/server/events'

const schema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password'),
  newPassword: z.string().min(1, 'Enter a new password'),
})

/** POST /api/auth/password — change your own password; signs out other devices. */
export const POST = route(
  async ({ user, request }) => {
    const body = await parseBody(request, schema)

    const record = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { passwordHash: true },
    })
    if (!(await verifyPassword(body.currentPassword, record.passwordHash))) {
      return fail('Your current password is incorrect', 422)
    }
    const problem = passwordProblem(body.newPassword)
    if (problem) return fail(problem, 422)
    if (body.newPassword === body.currentPassword) {
      return fail('Choose a password different from the current one', 422)
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(body.newPassword),
        mustChangePassword: false,
        passwordChangedAt: new Date(),
      },
    })
    await revokeOtherSessions(user.id, user.sessionId)
    await recordActivity({
      organizationId: user.organizationId,
      actorId: user.id,
      actorName: user.name,
      actorRole: user.role,
      event: 'AUTH_PASSWORD_CHANGED',
      entityType: 'User',
      entityId: user.id,
      summary: `${user.name} changed their password`,
    })

    return { success: true, redirectTo: HOME_FOR_ROLE[user.role] }
  },
  { allowPendingPassword: true, allowRestricted: true },
)
