import type { Metadata, Viewport } from 'next'
import { prisma } from '@/lib/prisma'
import { isOrgRestricted, requireOrgUser } from '@/lib/auth'
import { filterNavSections, OWNER_NAV } from '@/lib/navigation'
import { ensureOrgDefaults } from '@/server/services/org-defaults'
import { AppShell } from '@/components/app/app-shell'
import { PWA_APPS, pwaMetadata } from '@/lib/pwa'
import { PlatformAnnouncementBanner } from '@/components/app/platform-announcement-banner'
import { SubscriptionGraceBanner } from '@/components/app/subscription-grace-banner'
import { graceBannerFor } from '@/server/services/owner-billing'

export const metadata: Metadata = pwaMetadata('owner')
export const viewport: Viewport = { themeColor: PWA_APPS.owner.color }

export default async function OwnerLayout({ children }: { children: React.ReactNode }) {
  // The layout itself stays open for a paused account so /app/subscription
  // works; every other owner page sends it to /paywall (requireOrgUser).
  const user = await requireOrgUser({ allowRestricted: true })
  // Organizations created before roles/lookups existed get them on first visit.
  await ensureOrgDefaults(user.organizationId)

  const [properties, complaints, notifications, tasks, grace] = await Promise.all([
    prisma.property.findMany({
      where: {
        organizationId: user.organizationId,
        archivedAt: null,
        ...(user.propertyIds.length ? { id: { in: user.propertyIds } } : {}),
      },
      select: { id: true, name: true, type: true, city: true },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    }),
    prisma.complaint.count({
      where: {
        organizationId: user.organizationId,
        status: { in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS'] },
      },
    }),
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    prisma.maintenanceTask.count({
      where: { organizationId: user.organizationId, status: { in: ['PENDING', 'ACCEPTED'] } },
    }),
    // StayFlow payment overdue but still in grace: a banner, never a block.
    graceBannerFor(user.organizationId).catch(() => null),
  ])

  return (
    <AppShell
      nav={filterNavSections(OWNER_NAV, user)}
      user={{
        name: user.name,
        email: user.email,
        role: user.role,
        avatarUrl: user.avatarUrl,
        organizationName: user.organizationName,
      }}
      properties={properties}
      badges={{ complaints, notifications, tasks, leads: 0 }}
      installName={PWA_APPS.owner.shortName}
      restricted={isOrgRestricted(user)}
      access={{ role: user.role, modules: user.modules, permissions: user.permissions }}
    >
      <PlatformAnnouncementBanner />
      {grace && !isOrgRestricted(user) && (
        <SubscriptionGraceBanner
          amount={grace.amount}
          invoiceNumber={grace.invoiceNumber}
          lastActiveDay={grace.lastActiveDay.toISOString()}
          daysLeft={grace.daysLeft}
          tone={grace.tone}
          canPay={user.role === 'OWNER' || user.permissions.includes('billing.manage')}
        />
      )}
      {children}
    </AppShell>
  )
}
