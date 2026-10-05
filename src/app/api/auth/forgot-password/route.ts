import { z } from 'zod'
import { fail, handleError, ok, parseBody } from '@/lib/api-helpers'
import { clientIp, isRateLimited, recordHit } from '@/lib/rate-limit'
import { localPhone, normaliseEmail, requestPasswordReset } from '@/server/services/accounts'

const schema = z.object({
  identifier: z.string().trim().min(3, 'Enter your email or mobile number').max(200),
})

const GENERIC =
  'If an account matches, we have sent a reset link to its email and WhatsApp. The link works for 1 hour.'

/**
 * POST /api/auth/forgot-password — always answers the same way, whether or
 * not an account exists, so it cannot be used to discover accounts.
 */
export async function POST(request: Request) {
  try {
    const { identifier } = await parseBody(request, schema)

    const ip = await clientIp()
    const ipKey = `forgot:ip:${ip}`
    if (await isRateLimited(ipKey, 10, 60)) {
      return fail('Too many requests from this network. Please try again in an hour.', 429)
    }
    await recordHit(ipKey)

    const normalised = identifier.includes('@') ? normaliseEmail(identifier) : localPhone(identifier)
    const idKey = `forgot:id:${normalised}`
    // Per-identifier limit is silent: the response never changes.
    if (!(await isRateLimited(idKey, 3, 60))) {
      await recordHit(idKey)
      await requestPasswordReset(identifier).catch((error: unknown) => {
        console.error('[forgot-password]', error)
      })
    }

    return ok({ success: true, message: GENERIC })
  } catch (error) {
    return handleError(error)
  }
}
