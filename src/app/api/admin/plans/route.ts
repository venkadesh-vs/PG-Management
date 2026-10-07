import { z } from 'zod'
import type { Plan } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ok, parseBody, route } from '@/lib/api-helpers'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/tenancy'
import { recordActivity } from '@/server/events'
import { formatMoney } from '@/lib/utils'
import { normalisePlanFeatures } from '@/lib/plan-entitlements'

/** A limit: a number, '' / null for unlimited, or omitted to leave unchanged. */
const limit = z.union([z.literal(''), z.null(), z.coerce.number().int().min(0)]).optional()

function pickLimit(value: number | '' | null | undefined, current: number | null | undefined) {
  if (value === undefined) return current ?? null
  return value === '' || value === null ? null : value
}

const schema = z.object({
  /** Omit to create a new plan. */
  planId: z.string().min(1).optional(),
  name: z.string().trim().min(2),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{2,40}$/, 'Use lowercase letters, numbers and dashes')
    .optional(),
  tagline: z.string().trim().max(120).optional(),
  description: z.string().optional(),
  pricingBasis: z.enum(['STANDARD_RENT', 'PER_BED', 'FLAT']),
  multiplier: z.coerce.number().int().min(1).max(500),
  perBedPrice: z.coerce.number().int().min(0).max(10_000_000, 'Amount is too large'),
  flatPrice: z.coerce.number().int().min(0).max(10_000_000, 'Amount is too large'),
  minAmount: z.coerce.number().int().min(0).max(10_000_000, 'Amount is too large'),
  maxAmount: z.coerce.number().int().min(0).max(10_000_000, 'Amount is too large'),
  trialDays: z.coerce.number().int().min(0).max(90),
  graceDays: z.coerce.number().int().min(0).max(60),
  active: z.boolean(),
  isDefault: z.boolean(),
  // Plan engine (all optional so older clients keep working).
  yearlyDiscountPercent: z.coerce.number().int().min(0).max(90).optional(),
  maxProperties: limit,
  maxBeds: limit,
  maxResidents: limit,
  maxStaff: limit,
  whatsappMonthlyLimit: limit,
  storageLimitMb: limit,
  /** Optional module keys included (lib/modules). Omit to leave unchanged. */
  features: z.array(z.string().min(1)).max(50).optional(),
  /** true = every feature (stores an empty list). */
  allFeatures: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).max(999).optional(),
  highlighted: z.boolean().optional(),
})

function audit(plan: Plan) {
  return {
    name: plan.name,
    tagline: plan.tagline,
    pricingBasis: plan.pricingBasis,
    multiplier: plan.multiplier,
    perBedPrice: plan.perBedPrice,
    flatPrice: plan.flatPrice,
    minAmount: plan.minAmount,
    maxAmount: plan.maxAmount,
    yearlyDiscountPercent: plan.yearlyDiscountPercent,
    trialDays: plan.trialDays,
    graceDays: plan.graceDays,
    maxProperties: plan.maxProperties,
    maxBeds: plan.maxBeds,
    maxResidents: plan.maxResidents,
    maxStaff: plan.maxStaff,
    whatsappMonthlyLimit: plan.whatsappMonthlyLimit,
    storageLimitMb: plan.storageLimitMb,
    features: plan.features,
    sortOrder: plan.sortOrder,
    highlighted: plan.highlighted,
    active: plan.active,
    isDefault: plan.isDefault,
  }
}

/** Create or edit a plan: pricing rule, limits, features, display. Super Admin only. */
export const POST = route(
  async ({ user, request }) => {
    const body = await parseBody(request, schema)
    if (body.minAmount > body.maxAmount) {
      throw new ValidationError('The minimum cannot be higher than the maximum')
    }

    const existing = body.planId ? await prisma.plan.findUnique({ where: { id: body.planId } }) : null
    if (body.planId && !existing) throw new NotFoundError('Plan not found')

    const slug = body.slug ?? (existing ? existing.slug : slugify(body.name))
    if (slug !== existing?.slug) {
      const clash = await prisma.plan.findUnique({ where: { slug }, select: { id: true } })
      if (clash) throw new ConflictError(`Another plan already uses “${slug}”`)
    }

    const features =
      body.allFeatures === true
        ? []
        : body.features
          ? normalisePlanFeatures(body.features)
          : (existing?.features ?? [])

    const data = {
      name: body.name,
      slug,
      tagline: body.tagline || null,
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
      features,
      ...(body.yearlyDiscountPercent !== undefined ? { yearlyDiscountPercent: body.yearlyDiscountPercent } : {}),
      ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
      ...(body.highlighted !== undefined ? { highlighted: body.highlighted } : {}),
      // Limits: null = unlimited; omitted = unchanged.
      maxProperties: pickLimit(body.maxProperties, existing?.maxProperties),
      maxBeds: pickLimit(body.maxBeds, existing?.maxBeds),
      maxResidents: pickLimit(body.maxResidents, existing?.maxResidents),
      maxStaff: pickLimit(body.maxStaff, existing?.maxStaff),
      whatsappMonthlyLimit: pickLimit(body.whatsappMonthlyLimit, existing?.whatsappMonthlyLimit),
      storageLimitMb: pickLimit(body.storageLimitMb, existing?.storageLimitMb),
    }

    const saved = await prisma.$transaction(async (tx) => {
      // Only one plan can be the default.
      if (body.isDefault) {
        await tx.plan.updateMany({
          where: existing ? { id: { not: existing.id } } : {},
          data: { isDefault: false },
        })
      }
      return existing
        ? tx.plan.update({ where: { id: existing.id }, data })
        : tx.plan.create({ data })
    })

    await recordActivity({
      actorId: user.id,
      actorName: user.name,
      actorRole: user.role,
      event: 'ADMIN_ACTION',
      entityType: 'Plan',
      entityId: saved.id,
      summary: `${saved.name} ${existing ? 'updated' : 'created'} — ${
        saved.pricingBasis === 'STANDARD_RENT'
          ? `${saved.multiplier}% of standard rent`
          : saved.pricingBasis === 'PER_BED'
            ? `${formatMoney(saved.perBedPrice)} per bed`
            : `${formatMoney(saved.flatPrice)} flat`
      }`,
      meta: { action: existing ? 'PLAN_UPDATED' : 'PLAN_CREATED' },
      before: existing ? audit(existing) : undefined,
      after: audit(saved),
    })

    return ok({ plan: saved, message: `${saved.name} saved` }, { status: existing ? 200 : 201 })
  },
  { roles: ['SUPER_ADMIN'] },
)

function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || `plan-${Date.now()}`
  )
}
