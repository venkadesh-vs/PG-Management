import 'server-only'

import { prisma } from '@/lib/prisma'
import { enabledModules, MODULES, type ModuleKey } from '@/lib/modules'

/**
 * Module switches for background jobs, which run without a session. Same
 * rule as the session loader (lib/auth + lib/access): the owner's
 * OrgSetting.disabledModules plus platform flags switched off globally or
 * overridden off for the organization.
 */

/** Enabled modules per organization (all orgs, or the given one). */
export async function orgModuleMap(organizationId?: string): Promise<Map<string, Set<ModuleKey>>> {
  const [orgs, flagsOff] = await Promise.all([
    prisma.organization.findMany({
      where: organizationId ? { id: organizationId } : {},
      select: { id: true, featureOverrides: true, settings: { select: { disabledModules: true } } },
    }),
    prisma.featureFlag.findMany({ where: { enabled: false }, select: { key: true } }),
  ])
  const globalOff = flagsOff.map((f) => f.key)

  const map = new Map<string, Set<ModuleKey>>()
  for (const org of orgs) {
    const overrides = (org.featureOverrides ?? {}) as Record<string, unknown>
    const off = new Set([
      ...globalOff,
      ...Object.entries(overrides)
        .filter(([, v]) => v === false)
        .map(([k]) => k),
    ])
    const platformOff = MODULES.filter((m) => m.flag && off.has(m.flag)).map((m) => m.key)
    map.set(org.id, enabledModules(org.settings?.disabledModules ?? [], platformOff))
  }
  return map
}

/** Organization ids that have this module switched off. */
export async function orgsWithModuleOff(module: ModuleKey, organizationId?: string): Promise<string[]> {
  const map = await orgModuleMap(organizationId)
  return [...map.entries()].filter(([, on]) => !on.has(module)).map(([id]) => id)
}

/** True when the module is on for the organization. */
export async function isModuleOn(organizationId: string, module: ModuleKey): Promise<boolean> {
  const map = await orgModuleMap(organizationId)
  return map.get(organizationId)?.has(module) ?? false
}
