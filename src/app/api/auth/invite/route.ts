import { z } from 'zod'
import { createSession, HOME_FOR_ROLE } from '@/lib/auth'
import { passwordProblem } from '@/lib/password'
import { prisma } from '@/lib/prisma'
import { fail, handleError, ok, parseBody } from '@/lib/api-helpers'
import { clientIp, isRateLimited, recordHit } from '@/lib/rate-limit'
import { recordActivity } from '@/server/events'
import { acceptInvite } from '@/server/services/accounts'

const schema = z.object({
  token: z.string().min(1, 'This link is incomplete'),
  password: z.string().min(1, 'Choose a password'),
})

/** POST /api/auth/invite — accept an invitation by choosing a password. */
export async function POST(request: Request) {
  try {
    const ip = await clientIp()
    const ipKey = `invite:ip:${ip}`
    if (await isRateLimited(ipKey, 20, 60)) {
      return fail('Too many attempts. Please try again later.', 429)
    }
    await recordHit(ipKey)

    const body = await parseBody(request, schema)
    const problem = passwordProblem(body.password)
    if (problem) return fail(`password: ${problem}`, 422)

    const user = await acceptInvite(body.token, body.password)
    await createSession(user.id)
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
    await recordActivity({
      organizationId: user.organizationId,
      actorId: user.id,
      actorName: user.name,
      actorRole: user.role,
      event: 'AUTH_LOGIN',
      entityType: 'User',
      entityId: user.id,
      summary: `${user.name} signed in for the first time`,
      ip,
    })

    return ok({ redirectTo: HOME_FOR_ROLE[user.role], user: { name: user.name } })
  } catch (error) {
    return handleError(error)
  }
}
