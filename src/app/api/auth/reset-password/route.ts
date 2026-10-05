import { z } from 'zod'
import { createSession, HOME_FOR_ROLE } from '@/lib/auth'
import { passwordProblem } from '@/lib/password'
import { fail, handleError, ok, parseBody } from '@/lib/api-helpers'
import { clientIp, isRateLimited, recordHit } from '@/lib/rate-limit'
import { completePasswordReset } from '@/server/services/accounts'

const schema = z.object({
  token: z.string().min(1, 'This link is incomplete'),
  password: z.string().min(1, 'Choose a new password'),
})

/** POST /api/auth/reset-password — set a new password from a reset link. */
export async function POST(request: Request) {
  try {
    const ip = await clientIp()
    const ipKey = `reset:ip:${ip}`
    if (await isRateLimited(ipKey, 20, 60)) {
      return fail('Too many attempts. Please try again later.', 429)
    }
    await recordHit(ipKey)

    const body = await parseBody(request, schema)
    const problem = passwordProblem(body.password)
    if (problem) return fail(`password: ${problem}`, 422)

    // Consumes the link, clears mustChangePassword and ends every session.
    const user = await completePasswordReset(body.token, body.password)
    await createSession(user.id)

    return ok({ redirectTo: HOME_FOR_ROLE[user.role], user: { name: user.name } })
  } catch (error) {
    return handleError(error)
  }
}
