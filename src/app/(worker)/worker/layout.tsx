import { prisma } from '@/lib/prisma'
import { requireWorker } from '@/lib/auth'
import { WORKER_NAV } from '@/lib/navigation'
import { MobileShell } from '@/components/app/mobile-shell'

export default async function WorkerLayout({ children }: { children: React.ReactNode }) {
  const user = await requireWorker()

  const [staff, unread] = await Promise.all([
    prisma.staff.findUnique({
      where: { id: user.staffId },
      select: { role: true, property: { select: { name: true } } },
    }),
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
  ])

  const subtitle = staff
    ? `${staff.role.replace('_', ' ').toLowerCase()}${staff.property ? ` · ${staff.property.name}` : ''}`
    : undefined

  return (
    <MobileShell
      nav={WORKER_NAV}
      user={{ name: user.name, email: user.email }}
      subtitle={subtitle}
      unread={unread}
      accent="amber"
    >
      {children}
    </MobileShell>
  )
}
