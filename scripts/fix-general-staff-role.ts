/**
 * One-off (roles were introduced on 2026-10-06): add the "General staff"
 * role to organizations created before it existed, and move staff logins
 * that the first backfill put on Cook/Housekeeping onto it, so nobody lost
 * access they had before roles.
 *   npx tsx scripts/fix-general-staff-role.ts
 */
import { prisma } from '../src/lib/prisma'
import { ROLE_TEMPLATES } from '../src/lib/permission-catalog'

async function main() {
  const template = ROLE_TEMPLATES.find((t) => t.name === 'General staff')!
  for (const org of await prisma.organization.findMany({ select: { id: true, name: true } })) {
    const role = await prisma.orgRole.upsert({
      where: { organizationId_name: { organizationId: org.id, name: template.name } },
      update: {},
      create: { organizationId: org.id, name: template.name, description: template.description, app: 'STAFF_APP', color: template.color, permissions: template.permissions, isTemplate: true },
    })
    const { count } = await prisma.user.updateMany({
      where: { organizationId: org.id, role: 'WORKER', orgRole: { name: { in: ['Cook', 'Housekeeping'] } } },
      data: { orgRoleId: role.id },
    })
    console.log(`  ✓ ${org.name}: ${count} staff login(s) on General staff`)
  }
}
main().finally(() => prisma.$disconnect())
