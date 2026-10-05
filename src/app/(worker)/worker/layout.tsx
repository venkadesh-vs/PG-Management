import type { Metadata, Viewport } from 'next'
import { prisma } from '@/lib/prisma'
import { requireWorker } from '@/lib/auth'
import { filterNavItems, WORKER_NAV } from '@/lib/navigation'
import { MobileShell } from '@/components/app/mobile-shell'
import { PWA_APPS, pwaMetadata } from '@/lib/pwa'

export const metadata: Metadata = pwaMetadata('worker')
export const viewport: Viewport = { themeColor: PWA_APPS.worker.color }

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
      nav={filterNavItems(WORKER_NAV, user)}
      user={{ name: user.name, email: user.email }}
      subtitle={subtitle}
      unread={unread}
      installName={PWA_APPS.worker.shortName}
      accent="amber"
    >
      {children}
    </MobileShell>
  )
}
