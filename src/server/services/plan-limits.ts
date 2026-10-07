import 'server-only'

import { prisma } from '@/lib/prisma'
import { ValidationError } from '@/lib/tenancy'
import {
  effectiveLimit,
  fitsLimit,
  LIMIT_KEYS,
  limitMessage,
  UPGRADE_PATH,
  type LimitKey,
  type PlanLimits,
} from '@/lib/plan-entitlements'

/**
 * Plan usage limits. An organization's limit for each dimension is the most
 * generous among the plans of its live (not cancelled) subscriptions; with no
 * subscription yet it is held to the default plan. null = unlimited.
 */

/** A plan limit was reached. 402 so clients can offer "Upgrade". */
export class PlanLimitError extends ValidationError {
  constructor(
    message: string,
    public readonly limitKey: LimitKey,
    public readonly limit: number,
  ) {
    super(message, { limitKey, limit, upgradeUrl: UPGRADE_PATH })
    this.status = 402
    this.name = 'PlanLimitError'
  }
}

const PLAN_LIMIT_SELECT = {
  name: true,
  maxProperties: true,
  maxBeds: true,
  maxResidents: true,
  maxStaff: true,
} as const

/** The plans that set this organization's limits. */
export async function orgPlans(organizationId: string): Promise<PlanLimits[]> {
  const subscriptions = await prisma.subscription.findMany({
    where: { organizationId, status: { not: 'CANCELLED' } },
    select: { plan: { select: PLAN_LIMIT_SELECT } },
  })
  if (subscriptions.length) return subscriptions.map((s) => s.plan)
  return prisma.plan.findMany({
    where: { active: true },
    orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }],
    take: 1,
    select: PLAN_LIMIT_SELECT,
  })
}

/** Current usage per dimension. */
export async function countUsage(organizationId: string): Promise<Record<LimitKey, number>> {
  const [properties, beds, residents, staff] = await Promise.all([
    prisma.property.count({ where: { organizationId, archivedAt: null } }),
    prisma.bed.count({ where: { property: { organizationId, archivedAt: null } } }),
    prisma.resident.count({ where: { organizationId, status: { in: ['ACTIVE', 'NOTICE'] } } }),
    prisma.staff.count({ where: { organizationId, active: true } }),
  ])
  return { properties, beds, residents, staff }
}

async function countOne(organizationId: string, key: LimitKey): Promise<number> {
  switch (key) {
    case 'properties':
      return prisma.property.count({ where: { organizationId, archivedAt: null } })
    case 'beds':
      return prisma.bed.count({ where: { property: { organizationId, archivedAt: null } } })
    case 'residents':
      return prisma.resident.count({ where: { organizationId, status: { in: ['ACTIVE', 'NOTICE'] } } })
    case 'staff':
      return prisma.staff.count({ where: { organizationId, active: true } })
  }
}

/**
 * Throws a PlanLimitError (HTTP 402) when adding `adding` more of `key` would
 * exceed the organization's plan, e.g. "Your Starter plan allows 2 PGs.
 * Upgrade to add more at /app/subscription." Call before creating.
 */
export async function assertWithinPlan(organizationId: string, key: LimitKey, adding = 1) {
  const plans = await orgPlans(organizationId)
  const limit = effectiveLimit(plans, key)
  if (limit == null) return
  const used = await countOne(organizationId, key)
  if (!fitsLimit(used, adding, limit)) {
    // Name the plan that sets the limit (the most generous one).
    const field = { properties: 'maxProperties', beds: 'maxBeds', residents: 'maxResidents', staff: 'maxStaff' } as const
    const plan = plans.find((p) => p[field[key]] === limit) ?? plans[0]
    throw new PlanLimitError(limitMessage(plan.name, key, limit), key, limit)
  }
}

export type UsageSummary = {
  planNames: string[]
  rows: { key: LimitKey; used: number; limit: number | null; percent: number | null }[]
}

/** Used vs limit per dimension, for the owner's subscription page. */
export async function usageForOrg(organizationId: string): Promise<UsageSummary> {
  const [plans, usage] = await Promise.all([orgPlans(organizationId), countUsage(organizationId)])
  return {
    planNames: [...new Set(plans.map((p) => p.name))],
    rows: LIMIT_KEYS.map((key) => {
      const limit = effectiveLimit(plans, key)
      return {
        key,
        used: usage[key],
        limit,
        percent: limit == null ? null : limit === 0 ? 100 : Math.min(100, Math.round((usage[key] / limit) * 100)),
      }
    }),
  }
}
