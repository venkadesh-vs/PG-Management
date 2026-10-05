import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { createSession, HOME_FOR_ROLE } from '@/lib/auth'
import { verifyPassword } from '@/lib/password'
import { fail, handleError, ok, parseBody } from '@/lib/api-helpers'
import { recordActivity } from '@/server/events'
import { clearHits, clientIp, isRateLimited, recordHit } from '@/lib/rate-limit'

const schema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
})

export async function POST(request: Request) {
  try {
    const { email: rawEmail, password } = await parseBody(request, schema)
    const email = rawEmail.toLowerCase().trim()

    // Brute-force guard: 5 failures per account and 20 per IP in 15 minutes.
    const ip = await clientIp()
    const emailKey = `login:email:${email}`
    const ipKey = `login:ip:${ip}`
    if ((await isRateLimited(emailKey, 5, 15)) || (await isRateLimited(ipKey, 20, 15))) {
      return fail('Too many sign-in attempts. Please wait 15 minutes and try again.', 429)
    }
    const failed = async () => {
      await Promise.all([recordHit(emailKey), recordHit(ipKey)])
      return fail('Email or password is incorrect', 401)
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: { organization: { select: { status: true, name: true } } },
    })

    // Same message and comparable timing for "no such user" and "wrong
    // password", so the endpoint cannot be used to enumerate accounts.
    if (!user) {
      await verifyPassword(password, '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv')
      return failed()
    }

    const valid = await verifyPassword(password, user.passwordHash)
    if (!valid) return failed()
    await clearHits(emailKey)

    if (user.status === 'SUSPENDED') {
      return fail('This account has been suspended. Contact your PG owner.', 403)
    }
    if (user.status === 'ARCHIVED') {
      return fail('This account is no longer active.', 403)
    }

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
      summary: `${user.name} signed in`,
    })

    return ok({
      user: { id: user.id, name: user.name, role: user.role },
      redirectTo: user.mustChangePassword ? '/change-password' : HOME_FOR_ROLE[user.role],
    })
  } catch (error) {
    return handleError(error)
  }
}
