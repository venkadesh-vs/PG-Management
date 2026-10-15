import type { Metadata } from 'next'
import { requireTenant } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { Bell } from 'lucide-react'
import { NotificationList } from '@/components/app/notification-list'
import { PhoneHeader } from '../_ui/phone-ui'

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
      <PhoneHeader
        icon={Bell}
        title="Notifications"
        subtitle="Rent, payments, complaints and notices from your PG."
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
