import 'server-only'

import { prisma } from '@/lib/prisma'
import { OPTIONAL_MODULES, type ModuleKey } from '@/lib/modules'
import { planExcludedModules } from '@/lib/plan-entitlements'

/**
 * Optional modules the platform withholds from this organization: their
 * FeatureFlag is off globally, or Organization.featureOverrides[flag] === false.
 */
export async function platformWithheldModules(organizationId: string): Promise<ModuleKey[]> {
  const [org, flagsOff] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        featureOverrides: true,
        subscriptions: { where: { status: { not: 'CANCELLED' } }, select: { plan: { select: { features: true } } } },
      },
    }),
    prisma.featureFlag.findMany({ where: { enabled: false }, select: { key: true } }),
  ])
  const overrides = (org?.featureOverrides ?? {}) as Record<string, unknown>
  const off = new Set([
    ...flagsOff.map((f) => f.key),
    ...Object.entries(overrides)
      .filter(([, v]) => v === false)
      .map(([k]) => k),
  ])
  // ...and optional modules the org's plan does not include.
  const planOff = new Set(planExcludedModules((org?.subscriptions ?? []).map((s) => s.plan.features)))
  return OPTIONAL_MODULES.filter((m) => (m.flag && off.has(m.flag)) || planOff.has(m.key)).map((m) => m.key)
}
