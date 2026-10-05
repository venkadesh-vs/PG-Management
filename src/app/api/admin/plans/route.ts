import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ok, parseBody, route } from '@/lib/api-helpers'
import { NotFoundError, ValidationError } from '@/lib/tenancy'
import { recordActivity } from '@/server/events'
import { formatMoney } from '@/lib/utils'

const schema = z.object({
  planId: z.string().min(1),
  name: z.string().trim().min(2),
  description: z.string().optional(),
  pricingBasis: z.enum(['STANDARD_RENT', 'PER_BED', 'FLAT']),
  multiplier: z.coerce.number().int().min(1).max(500),
  perBedPrice: z.coerce.number().int().min(0),
  flatPrice: z.coerce.number().int().min(0),
  minAmount: z.coerce.number().int().min(0),
  maxAmount: z.coerce.number().int().min(0),
  trialDays: z.coerce.number().int().min(0).max(90),
  graceDays: z.coerce.number().int().min(0).max(60),
  active: z.boolean(),
  isDefault: z.boolean(),
})

/** Edit the pricing rules a plan applies. Super Admin only. */
export const POST = route(
  async ({ user, request }) => {
    const body = await parseBody(request, schema)
    if (body.minAmount > body.maxAmount) {
      throw new ValidationError('The minimum cannot be higher than the maximum')
    }

    const plan = await prisma.plan.findUnique({ where: { id: body.planId } })
    if (!plan) throw new NotFoundError('Plan not found')

    const updated = await prisma.$transaction(async (tx) => {
      // Only one plan can be the default.
      if (body.isDefault) {
        await tx.plan.updateMany({
          where: { id: { not: plan.id } },
          data: { isDefault: false },
        })
      }
      return tx.plan.update({
        where: { id: plan.id },
        data: {
          name: body.name,
          description: body.description || null,
          pricingBasis: body.pricingBasis,
          multiplier: body.multiplier,
          perBedPrice: body.perBedPrice,
          flatPrice: body.flatPrice,
          minAmount: body.minAmount,
          maxAmount: body.maxAmount,
          trialDays: body.trialDays,
          graceDays: body.graceDays,
          active: body.active,
          isDefault: body.isDefault,
        },
      })
    })

    await recordActivity({
      actorId: user.id,
      actorName: user.name,
      actorRole: user.role,
      event: 'SETTINGS_UPDATED',
      entityType: 'Plan',
      entityId: plan.id,
      summary: `${updated.name} pricing updated — ${
        updated.pricingBasis === 'STANDARD_RENT'
          ? `${updated.multiplier}% of standard rent`
          : updated.pricingBasis === 'PER_BED'
            ? `${formatMoney(updated.perBedPrice)} per bed`
            : `${formatMoney(updated.flatPrice)} flat`
      }`,
    })

    return ok({ plan: updated, message: `${updated.name} saved` })
  },
  { roles: ['SUPER_ADMIN'] },
)
