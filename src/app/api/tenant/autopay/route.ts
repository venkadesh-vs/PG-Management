import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ok, parseBody, route } from '@/lib/api-helpers'
import { ForbiddenError, NotFoundError } from '@/lib/tenancy'
import { AUTOPAY_METHODS } from '@/lib/autopay'
import { cancelMandate, confirmMandate, residentAutopayStatus, setChargeDay, startMandate } from '@/server/services/resident-autopay'

/**
 * Resident rent AutoPay (resident app).
 *   GET                                   → status: offered?, limit, mandate, upcoming debit, history
 *   POST { action: 'START', method, chargeDay } → Razorpay Checkout options (recurring) for the mandate;
 *                                           the chosen day becomes the rent due day (next invoice on)
 *   POST { action: 'CHANGE_DAY', day }     → a new debit / due day within the owner's window
 *   POST { action: 'CONFIRM', orderId, paymentId, signature }
 *                                         → checkout success; the token status is read from Razorpay
 *   POST { action: 'CANCEL', reason? }    → cancels at Razorpay, then here
 */
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('START'), method: z.enum(AUTOPAY_METHODS), chargeDay: z.coerce.number().int() }),
  z.object({ action: z.literal('CHANGE_DAY'), day: z.coerce.number().int() }),
  z.object({
    action: z.literal('CONFIRM'),
    orderId: z.string().min(1),
    paymentId: z.string().min(1),
    signature: z.string().min(1),
  }),
  z.object({ action: z.literal('CANCEL'), reason: z.string().trim().max(200).optional() }),
])

export const GET = route(
  async ({ user }) => {
    if (!user.residentId) throw new ForbiddenError()
    return residentAutopayStatus(user.residentId)
  },
  { roles: ['TENANT'], module: 'residentApp' },
)

export const POST = route(
  async ({ user, request }) => {
    const body = await parseBody(request, schema)
    if (!user.residentId) throw new ForbiddenError()
    const residentId = user.residentId

    if (body.action === 'START') {
      const checkout = await startMandate({
        residentId,
        method: body.method,
        chargeDay: body.chargeDay,
        actor: { id: user.id, name: user.name, role: user.role },
        fallbackEmail: user.email,
      })
      return ok({ checkout })
    }
    if (body.action === 'CHANGE_DAY') {
      const result = await setChargeDay({
        residentId,
        organizationId: user.organizationId!,
        day: body.day,
        actor: { id: user.id, name: user.name, role: user.role },
      })
      return ok({ ...result, message: 'Date saved. It applies from your next rent invoice.' })
    }
    if (body.action === 'CONFIRM') {
      const mandate = await confirmMandate({ residentId, orderId: body.orderId, paymentId: body.paymentId, signature: body.signature })
      const active = mandate?.status === 'ACTIVE'
      return ok({
        status: mandate?.status ?? 'PENDING',
        message: active
          ? 'AutoPay is on. Your rent will be paid automatically.'
          : 'AutoPay is being set up with your bank. We will tell you when it is active.',
      })
    }

    const mandate = await prisma.residentMandate.findFirst({
      where: { residentId, status: { in: ['PENDING', 'ACTIVE', 'PAUSED'] } },
      orderBy: { createdAt: 'desc' },
    })
    if (!mandate) throw new NotFoundError('AutoPay is not set up')
    await cancelMandate({
      mandateId: mandate.id,
      organizationId: mandate.organizationId,
      actor: { id: user.id, name: user.name, role: user.role },
      reason: body.reason ?? 'Cancelled by the resident',
    })
    return ok({ message: 'AutoPay cancelled. Nothing more will be debited.' })
  },
  { roles: ['TENANT'], module: 'residentApp' },
)
