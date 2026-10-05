import type { Metadata } from 'next'
import { requireTenant } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { NotificationList } from '@/components/app/notification-list'

export const metadata: Metadata = { title: 'Notifications' }

export default async function TenantNotificationsPage() {
  const user = await requireTenant()

  const notifications = await prisma.notification.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 60,
  })

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight text-slate-900">
          Notifications
        </h1>
        <p className="mt-0.5 text-sm text-slate-500">
          Rent, payments, complaints and notices from your PG.
        </p>
      </div>
      <NotificationList
        notifications={notifications.map((n) => ({
          id: n.id,
          kind: n.kind,
          title: n.title,
          body: n.body,
          link: n.link,
          readAt: n.readAt?.toISOString() ?? null,
          createdAt: n.createdAt.toISOString(),
        }))}
      />
    </div>
  )
}
