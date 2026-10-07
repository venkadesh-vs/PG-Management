import 'server-only'

import { prisma } from '@/lib/prisma'
import { ValidationError } from '@/lib/tenancy'
import {
  effectiveLimit,
  effectiveMeteredLimit,
  fitsLimit,
  istMonthKey,
  istMonthStart,
  LIMIT_KEYS,
  limitMessage,
  storageAllowed,
  storageLimitMessage,
  toMb,
  UPGRADE_PATH,
  whatsappAllowed,
  whatsappLimitMessage,
  type LimitKey,
  type MeteredKey,
  type MeteredPlanLimits,
  type PlanLimits,
} from '@/lib/plan-entitlements'
import { notifyOrgAdmins } from '@/server/events'

/**
 * Plan usage limits. An organization's limit for each dimension is the most
 * generous among the plans of its live (not cancelled) subscriptions; with no
 * subscription yet it is held to the default plan. null = unlimited.
 */

/** A plan limit was reached. 402 so clients can offer "Upgrade". */
export class PlanLimitError extends ValidationError {
  constructor(
    message: string,
    public readonly limitKey: LimitKey | MeteredKey,
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
  whatsappMonthlyLimit: true,
  storageLimitMb: true,
} as const

type OrgPlan = PlanLimits & MeteredPlanLimits

/** The plans that set this organization's limits. */
export async function orgPlans(organizationId: string): Promise<OrgPlan[]> {
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
  /** WhatsApp this month and file storage (MB). */
  metered: { key: MeteredKey; label: string; used: number; limit: number | null; unit: string; percent: number | null }[]
}

/** Used vs limit per dimension, for the owner's subscription page. */
export async function usageForOrg(organizationId: string, now = new Date()): Promise<UsageSummary> {
  const [plans, usage, whatsappUsed, storageBytes] = await Promise.all([
    orgPlans(organizationId),
    countUsage(organizationId),
    whatsappSentThisMonth(organizationId, now),
    storageUsedBytes(organizationId),
  ])
  const pct = (used: number, limit: number | null) =>
    limit == null ? null : limit === 0 ? 100 : Math.min(100, Math.round((used / limit) * 100))
  const waLimit = effectiveMeteredLimit(plans, 'whatsapp')
  const storageLimit = effectiveMeteredLimit(plans, 'storage')
  const storageMb = toMb(storageBytes)
  return {
    metered: [
      { key: 'whatsapp', label: 'WhatsApp messages this month', used: whatsappUsed, limit: waLimit, unit: '', percent: pct(whatsappUsed, waLimit) },
      { key: 'storage', label: 'File storage', used: storageMb, limit: storageLimit, unit: 'MB', percent: pct(storageMb, storageLimit) },
    ],
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

// ------------------------------------------------------- metered limits ----

/** Statuses that mean a live WhatsApp message went (or is going) to Meta. */
const COUNTED_STATUSES = ['QUEUED', 'SENT', 'DELIVERED', 'READ'] as const

/** Live (non-demo) WhatsApp messages this organization sent this IST month. */
export async function whatsappSentThisMonth(organizationId: string, now = new Date()): Promise<number> {
  return prisma.outboundMessage.count({
    where: {
      organizationId,
      channel: 'WHATSAPP',
      isDemo: false,
      status: { in: [...COUNTED_STATUSES] },
      createdAt: { gte: istMonthStart(now) },
    },
  })
}

export type WhatsAppQuota = { allowed: boolean; used: number; limit: number | null; message: string | null }

/**
 * Whether the organization may send one more live WhatsApp message this
 * month. Checked just before sending; two sends racing at the very edge may
 * both go out, which is acceptable for a monthly allowance.
 */
export async function whatsappQuota(organizationId: string | null, now = new Date()): Promise<WhatsAppQuota> {
  if (!organizationId) return { allowed: true, used: 0, limit: null, message: null }
  const plans = await orgPlans(organizationId)
  const limit = effectiveMeteredLimit(plans, 'whatsapp')
  if (limit == null) return { allowed: true, used: 0, limit: null, message: null }
  const used = await whatsappSentThisMonth(organizationId, now)
  const plan = plans.find((p) => p.whatsappMonthlyLimit === limit) ?? plans[0]
  return whatsappAllowed(used, limit)
    ? { allowed: true, used, limit, message: null }
    : { allowed: false, used, limit, message: whatsappLimitMessage(plan.name, limit) }
}

/**
 * Tells the owner and managers once per month that WhatsApp messages have
 * stopped. The month key in the link is what keeps it to one notice.
 */
export async function noticeWhatsAppLimitOnce(organizationId: string, message: string, now = new Date()) {
  const link = `${UPGRADE_PATH}?limit=whatsapp-${istMonthKey(now)}`
  const already = await prisma.notification.findFirst({ where: { organizationId, link }, select: { id: true } })
  if (already) return false
  await notifyOrgAdmins(organizationId, {
    kind: 'SUBSCRIPTION',
    title: 'WhatsApp messages paused for this month',
    body: `${message} In-app notifications keep working.`,
    link,
  })
  return true
}

/** Bytes of files this organization has uploaded. */
export async function storageUsedBytes(organizationId: string): Promise<number> {
  const agg = await prisma.uploadedFile.aggregate({ where: { organizationId }, _sum: { size: true } })
  return agg._sum.size ?? 0
}

/** Throws a PlanLimitError (402) when a new file would not fit the plan's storage. */
export async function assertStorageAvailable(organizationId: string, addingBytes: number) {
  const plans = await orgPlans(organizationId)
  const limit = effectiveMeteredLimit(plans, 'storage')
  if (limit == null) return
  const used = await storageUsedBytes(organizationId)
  if (!storageAllowed(used, addingBytes, limit)) {
    const plan = plans.find((p) => p.storageLimitMb === limit) ?? plans[0]
    throw new PlanLimitError(storageLimitMessage(plan.name, limit), 'storage', limit)
  }
}
