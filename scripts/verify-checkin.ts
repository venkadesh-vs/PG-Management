/**
 * Ad-hoc verification that a check-in wired up every connected record.
 * Usage: npx tsx scripts/verify-checkin.ts RES-0098
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const code = process.argv[2] ?? 'RES-0098'

async function main() {
  const resident = await prisma.resident.findFirst({
    where: { code },
    include: {
      bed: { include: { room: true } },
      deposit: true,
      foodSubscription: true,
      ledger: { orderBy: { createdAt: 'asc' } },
      invoices: true,
      user: true,
    },
  })
  if (!resident) {
    console.log(`No resident with code ${code}`)
    return
  }

  console.log('resident   ', resident.fullName, resident.status)
  console.log('bed        ', resident.bed?.status, 'room', resident.bed?.room.number, 'bed', resident.bed?.label)
  console.log('deposit    ', resident.deposit?.status, resident.deposit?.collected)
  console.log('food sub   ', resident.foodSubscription?.active)
  console.log('ledger     ', resident.ledger.map((l) => `${l.kind} ${l.debit}/${l.credit} => ${l.balance}`).join(' | '))
  console.log('invoices   ', resident.invoices.map((i) => `${i.number} ${i.total} ${i.status}`).join(', '))
  console.log('tenant user', resident.user?.email, resident.user?.role)

  const activity = await prisma.activityLog.findMany({
    where: { entityId: resident.id },
    select: { event: true },
  })
  console.log('activity   ', activity.map((a) => a.event).join(', '))

  const notifications = await prisma.notification.count({ where: { userId: resident.userId ?? '' } })
  console.log('tenant notifications', notifications)

  const message = await prisma.outboundMessage.findFirst({
    where: { refId: resident.id },
    select: { template: true, status: true, isDemo: true },
  })
  console.log('whatsapp   ', message?.template, message?.status, 'demo:', message?.isDemo)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
