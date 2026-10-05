/**
 * Prints one id per entity type, for smoke-testing detail routes by URL.
 * Usage: npx tsx scripts/ids.ts
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const [complaint, resident, property, staff, org, lead] = await Promise.all([
    prisma.complaint.findFirst({ select: { id: true } }),
    prisma.resident.findFirst({ where: { status: 'ACTIVE' }, select: { id: true } }),
    prisma.property.findFirst({ select: { id: true } }),
    prisma.staff.findFirst({ select: { id: true } }),
    prisma.organization.findFirst({ select: { id: true } }),
    prisma.lead.findFirst({ select: { id: true } }),
  ])

  console.log(`complaint=${complaint?.id ?? ''}`)
  console.log(`resident=${resident?.id ?? ''}`)
  console.log(`property=${property?.id ?? ''}`)
  console.log(`staff=${staff?.id ?? ''}`)
  console.log(`organization=${org?.id ?? ''}`)
  console.log(`lead=${lead?.id ?? ''}`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
