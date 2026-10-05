import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ok, parseBody, route } from '@/lib/api-helpers'
import { ForbiddenError, NotFoundError } from '@/lib/tenancy'
import { cancelAutopay, setupAutopay } from '@/server/services/subscriptions'
import { formatMoney } from '@/lib/utils'

const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('SETUP_AUTOPAY'),
    subscriptionId: z.string().min(1),
    kind: z.enum(['UPI_AUTOPAY', 'NACH', 'CARD']),
    label: z.string().min(1),
    maskedRef: z.string().optional(),
  }),
  z.object({ action: z.literal('CANCEL_AUTOPAY'), subscriptionId: z.string().min(1) }),
])

/** AutoPay mandate management for the PG owner's own subscriptions. */
export const POST = route(
  async ({ user, request }) => {
    const body = await parseBody(request, schema)

    const subscription = await prisma.subscription.findUnique({
      where: { id: body.subscriptionId },
      include: { property: { select: { name: true } } },
    })
    if (!subscription) throw new NotFoundError('Subscription not found')
    if (subscription.organizationId !== user.organizationId) throw new ForbiddenError()

    if (body.action === 'CANCEL_AUTOPAY') {
      await cancelAutopay(subscription.id)
      return ok({ message: 'AutoPay switched off' })
    }

    await setupAutopay({
      subscriptionId: subscription.id,
      kind: body.kind,
      label: body.label,
      maskedRef: body.maskedRef,
      actor: { id: user.id, name: user.name },
    })

    return ok({
      message: `${subscription.property.name} will be charged ${formatMoney(subscription.amount)} automatically each month.`,
    })
  },
  { roles: ['OWNER'] },
)
