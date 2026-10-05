/**
 * One-off: give every existing organization its default roles and lookup
 * lists, and put existing manager/staff logins on matching roles.
 *   npx tsx --conditions=react-server scripts/backfill-org-defaults.ts
 */
import { prisma } from '../src/lib/prisma'
import { ensureOrgDefaults } from '../src/server/services/org-defaults'

async function main() {
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } })
  for (const org of orgs) {
    await ensureOrgDefaults(org.id)
    console.log(`  ✓ ${org.name}`)
  }
}

main().finally(() => prisma.$disconnect())
