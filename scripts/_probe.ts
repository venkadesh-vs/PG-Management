import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()
async function main() {
  const org = await p.organization.findFirst({ where: { name: 'Sree Balaji Hostels' }, select: { id: true, status: true, users: { select: { email: true } } } })
  const inv = await p.subscriptionInvoice.findMany({ where: { subscription: { organizationId: org!.id }, status: { not: 'PAID' } }, select: { id: true, number: true, total: true, tax: true } })
  console.log(JSON.stringify({ org, inv }))
}
main().finally(() => p.$disconnect())
