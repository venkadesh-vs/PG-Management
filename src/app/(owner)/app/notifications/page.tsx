import type { Metadata } from 'next'
import { requireOrgUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PageHeader } from '@/components/app/page-header'
import { NotificationList } from '@/components/app/notification-list'

export const metadata: Metadata = { title: 'Notifications' }

export default async function NotificationsPage() {
  const user = await requireOrgUser()

  const [notifications, unread] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        subtitle={
          unread > 0
            ? `${unread} unread. Everything that needs your attention, in one list.`
            : 'You are all caught up.'
        }
        icon="bell"
        breadcrumbs={[{ label: 'Dashboard', href: '/app' }, { label: 'Notifications' }]}
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
