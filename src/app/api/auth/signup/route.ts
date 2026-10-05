import { z } from 'zod'
import { createSession } from '@/lib/auth'
import { passwordProblem } from '@/lib/password'
import { fail, handleError, ok, parseBody } from '@/lib/api-helpers'
import { phoneSchema } from '@/lib/validation'
import { clientIp, isRateLimited, recordHit } from '@/lib/rate-limit'
import { recordActivity } from '@/server/events'
import { bootstrapOrganization, sendVerificationEmail } from '@/server/services/accounts'

const schema = z.object({
  ownerName: z.string().trim().min(2, 'Enter your name').max(120),
  orgName: z.string().trim().min(2, 'Enter your PG or business name').max(120),
  email: z.string().trim().email('Enter a valid email address').max(200),
  phone: phoneSchema,
  city: z.string().trim().min(2, 'Enter your city').max(80),
  password: z.string().min(1, 'Choose a password'),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: 'Please accept the terms to continue' }) }),
})

/** POST /api/auth/signup — self-serve trial account for a PG owner. */
export async function POST(request: Request) {
  try {
    const ip = await clientIp()
    const ipKey = `signup:ip:${ip}`
    if (await isRateLimited(ipKey, 5, 60)) {
      return fail('Too many sign-ups from this network. Please try again in an hour.', 429)
    }

    const body = await parseBody(request, schema)
    const problem = passwordProblem(body.password)
    if (problem) return fail(`password: ${problem}`, 422)

    await recordHit(ipKey)
    const { owner, organization } = await bootstrapOrganization({
      orgName: body.orgName,
      ownerName: body.ownerName,
      email: body.email,
      phone: body.phone,
      city: body.city,
      source: 'SELF_SIGNUP',
      password: body.password,
      ip,
    })

    await sendVerificationEmail(owner.id).catch((error: unknown) => {
      console.error('[signup] verification email failed', error)
    })

    await createSession(owner.id)
    await recordActivity({
      organizationId: organization.id,
      actorId: owner.id,
      actorName: owner.name,
      actorRole: owner.role,
      event: 'AUTH_LOGIN',
      entityType: 'User',
      entityId: owner.id,
      summary: `${owner.name} signed in after creating ${organization.name}`,
      ip,
    })

    return ok({ redirectTo: '/app', user: { name: owner.name } }, { status: 201 })
  } catch (error) {
    return handleError(error)
  }
}
