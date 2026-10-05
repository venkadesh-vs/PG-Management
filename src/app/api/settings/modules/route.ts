import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { parseBody, route } from '@/lib/api-helpers'
import { MODULE_BY_KEY, OPTIONAL_MODULES, type ModuleKey } from '@/lib/modules'
import { ValidationError } from '@/lib/tenancy'
import { recordActivity } from '@/server/events'
import { platformWithheldModules } from '@/components/settings/platform.server'

const OPTIONAL_KEYS = new Set<string>(OPTIONAL_MODULES.map((m) => m.key))

const schema = z.object({ disabledModules: z.array(z.string().min(1)).max(50) })

/** GET /api/settings/modules — what is switched off, by the owner and by the plan. */
export const GET = route(
  async ({ user }) => {
    const organizationId = user.organizationId!
    const [settings, withheld] = await Promise.all([
      prisma.orgSetting.findUnique({ where: { organizationId }, select: { disabledModules: true } }),
      platformWithheldModules(organizationId),
    ])
    return { disabledModules: settings?.disabledModules ?? [], withheld, enabled: user.modules }
  },
  { roles: ['OWNER', 'MANAGER'], permission: 'team.manage' },
)

/**
 * POST /api/settings/modules — switch optional modules on or off. Turning a
 * module off only hides it; no data is ever deleted.
 */
export const POST = route(
  async ({ user, request }) => {
    const body = await parseBody(request, schema)
    const organizationId = user.organizationId!

    const unknown = body.disabledModules.filter((k) => !OPTIONAL_KEYS.has(k))
    if (unknown.length) throw new ValidationError(`These can't be switched off: ${unknown.join(', ')}`)

    const off = new Set(body.disabledModules as ModuleKey[])
    // A module whose dependency is off goes off too (staff app needs staff).
    for (const m of OPTIONAL_MODULES) {
      if (m.requires?.some((r) => off.has(r))) off.add(m.key)
    }
    const next = OPTIONAL_MODULES.map((m) => m.key).filter((k) => off.has(k))

    const before = await prisma.orgSetting.findUnique({ where: { organizationId }, select: { disabledModules: true } })
    const prev = new Set(before?.disabledModules ?? [])

    const settings = await prisma.orgSetting.upsert({
      where: { organizationId },
      create: { organizationId, disabledModules: next },
      update: { disabledModules: next },
      select: { id: true, disabledModules: true },
    })

    const turnedOff = next.filter((k) => !prev.has(k)).map((k) => MODULE_BY_KEY[k].label)
    const turnedOn = [...prev].filter((k) => !off.has(k as ModuleKey) && MODULE_BY_KEY[k as ModuleKey]).map((k) => MODULE_BY_KEY[k as ModuleKey].label)
    const parts = [
      turnedOff.length ? `switched off ${turnedOff.join(', ')}` : '',
      turnedOn.length ? `switched on ${turnedOn.join(', ')}` : '',
    ].filter(Boolean)

    if (parts.length) {
      await recordActivity({
        organizationId,
        actorId: user.id,
        actorName: user.name,
        actorRole: user.role,
        event: 'SETTINGS_UPDATED',
        entityType: 'OrgSetting',
        entityId: settings.id,
        summary: `Features: ${parts.join('; ')}`,
      })
    }

    return { disabledModules: settings.disabledModules, message: 'Features saved' }
  },
  { roles: ['OWNER', 'MANAGER'], permission: 'team.manage' },
)
