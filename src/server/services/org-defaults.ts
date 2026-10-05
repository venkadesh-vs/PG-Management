import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { LOOKUP_TYPES, ROLE_TEMPLATES } from '@/lib/permission-catalog'

type Db = Prisma.TransactionClient | typeof prisma

/**
 * Gives an organization its starting roles and dropdown lists, and moves any
 * manager/staff login that predates custom roles onto a matching role.
 * Safe to run any number of times: it only adds what is missing.
 */
export async function ensureOrgDefaults(organizationId: string, db: Db = prisma) {
  const [roleCount, lookupTypes] = await Promise.all([
    db.orgRole.count({ where: { organizationId } }),
    db.orgLookup.findMany({ where: { organizationId }, distinct: ['type'], select: { type: true } }),
  ])

  if (roleCount === 0) {
    await db.orgRole.createMany({
      data: ROLE_TEMPLATES.map((t) => ({
        organizationId,
        name: t.name,
        description: t.description,
        app: t.app,
        color: t.color,
        permissions: t.permissions,
        isTemplate: true,
      })),
      skipDuplicates: true,
    })
  }

  const have = new Set(lookupTypes.map((l) => l.type))
  const missing = LOOKUP_TYPES.filter((t) => !have.has(t.type))
  if (missing.length) {
    await db.orgLookup.createMany({
      data: missing.flatMap((t) =>
        t.defaults.map(([value, label], i) => ({ organizationId, type: t.type, value, label, sortOrder: i })),
      ),
      skipDuplicates: true,
    })
  }

  // Logins created before custom roles existed get the closest template.
  const unassigned = await db.user.findMany({
    where: { organizationId, orgRoleId: null, role: { in: ['MANAGER', 'WORKER'] } },
    select: { id: true, role: true, staff: { select: { role: true } } },
  })
  if (unassigned.length) {
    const roles = await db.orgRole.findMany({ where: { organizationId }, select: { id: true, name: true } })
    const byName = new Map(roles.map((r) => [r.name, r.id]))
    for (const u of unassigned) {
      const kitchen = ['COOK', 'KITCHEN_HELPER'].includes(u.staff?.role ?? '')
      const roleId = u.role === 'MANAGER' ? byName.get('Manager') : byName.get(kitchen ? 'Cook' : 'Housekeeping')
      if (roleId) await db.user.update({ where: { id: u.id }, data: { orgRoleId: roleId } })
    }
  }
}

/** The active options of one lookup list, in display order. */
export async function getLookup(organizationId: string, type: string) {
  const rows = await prisma.orgLookup.findMany({
    where: { organizationId, type, active: true },
    orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    select: { value: true, label: true },
  })
  if (rows.length) return rows
  // Before defaults are created, fall back to the built-in list.
  return (LOOKUP_TYPES.find((t) => t.type === type)?.defaults ?? []).map(([value, label]) => ({ value, label }))
}

/** value → label map for showing stored values (including deactivated ones). */
export async function getLookupLabels(organizationId: string, type: string) {
  const rows = await prisma.orgLookup.findMany({ where: { organizationId, type }, select: { value: true, label: true } })
  const map = new Map((LOOKUP_TYPES.find((t) => t.type === type)?.defaults ?? []).map(([v, l]) => [v, l]))
  for (const r of rows) map.set(r.value, r.label)
  return Object.fromEntries(map) as Record<string, string>
}
