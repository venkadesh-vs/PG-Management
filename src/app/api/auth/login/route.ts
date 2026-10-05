import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { createSession, HOME_FOR_ROLE } from '@/lib/auth'
import { verifyPassword } from '@/lib/password'
import { fail, handleError, ok, parseBody } from '@/lib/api-helpers'
import { recordActivity } from '@/server/events'

const schema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
})

export async function POST(request: Request) {
  try {
    const { email, password } = await parseBody(request, schema)

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: { organization: { select: { status: true, name: true } } },
    })

    // Same message and comparable timing for "no such user" and "wrong
    // password", so the endpoint cannot be used to enumerate accounts.
    if (!user) {
      await verifyPassword(password, '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv')
      return fail('Email or password is incorrect', 401)
    }

    const valid = await verifyPassword(password, user.passwordHash)
    if (!valid) return fail('Email or password is incorrect', 401)

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
      redirectTo: HOME_FOR_ROLE[user.role],
    })
  } catch (error) {
    return handleError(error)
  }
}
