import { z } from 'zod'
import { fail, parseBody, route } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { isRateLimited, recordHit } from '@/lib/rate-limit'
import { isDeliverableEmail, sendVerificationEmail, verifyEmailToken } from '@/server/services/accounts'

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('RESEND') }),
  z.object({ action: z.literal('VERIFY'), token: z.string().min(1) }),
])

/**
 * POST /api/auth/verify-email
 *   RESEND — signed-in user asks for a fresh verification link.
 *   VERIFY — consume a link (the /verify-email page does this server-side too).
 */
export const POST = route(
  async ({ user, request }) => {
    const body = await parseBody(request, schema)

    if (body.action === 'VERIFY') {
      const verified = await verifyEmailToken(body.token)
      if (!verified) return fail('This link has expired or was already used', 422)
      return { success: true, message: 'Email confirmed' }
    }

    if (!user) return fail('Please sign in', 401)
    const record = await prisma.user.findUnique({
      where: { id: user.id },
      select: { emailVerifiedAt: true, email: true },
    })
    if (record?.emailVerifiedAt) return { success: true, message: 'Your email is already confirmed' }
    if (!record || !isDeliverableEmail(record.email)) {
      return fail('There is no email address on this account to confirm', 422)
    }

    const key = `verify-email:user:${user.id}`
    if (await isRateLimited(key, 3, 60)) {
      return fail('We sent a few links already. Check your inbox (and spam), or try again in an hour.', 429)
    }
    await recordHit(key)
    await sendVerificationEmail(user.id)
    return { success: true, message: `We sent a new link to ${record.email}` }
  },
  { public: true },
)
