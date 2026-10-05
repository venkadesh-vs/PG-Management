import type { Metadata } from 'next'
import { requireSuperAdmin } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PageHeader } from '@/components/app/page-header'
import { NotificationList } from '@/components/app/notification-list'

export const metadata: Metadata = { title: 'Notifications' }

export default async function AdminNotificationsPage() {
  const user = await requireSuperAdmin()

  const notifications = await prisma.notification.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        subtitle="New enquiries, failed subscription payments and platform alerts."
        icon="bell"
        breadcrumbs={[{ label: 'Platform', href: '/admin' }, { label: 'Notifications' }]}
      />
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
