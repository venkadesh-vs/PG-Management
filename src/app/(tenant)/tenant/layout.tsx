import type { Metadata, Viewport } from 'next'
import { prisma } from '@/lib/prisma'
import { requireTenant } from '@/lib/auth'
import { filterNavItems, TENANT_MORE, TENANT_NAV } from '@/lib/navigation'
import { MobileShell } from '@/components/app/mobile-shell'
import { PWA_APPS, pwaMetadata } from '@/lib/pwa'

export const metadata: Metadata = pwaMetadata('tenant')
export const viewport: Viewport = { themeColor: PWA_APPS.tenant.color }

export default async function TenantLayout({ children }: { children: React.ReactNode }) {
  const user = await requireTenant()

  const [resident, unread] = await Promise.all([
    prisma.resident.findUnique({
      where: { id: user.residentId },
      select: {
        property: { select: { name: true, type: true } },
        room: { select: { number: true } },
        bed: { select: { label: true } },
      },
    }),
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
  ])

  // Room first so a narrow header truncates the PG name, not the room.
  const pgName = resident?.property.name.replace(/^StayFlow\s+/i, '')
  const subtitle = resident
    ? [resident.room ? `Room ${resident.room.number}${resident.bed ? resident.bed.label : ''}` : null, pgName]
        .filter(Boolean)
        .join(' · ')
    : undefined

  return (
    <MobileShell
      nav={filterNavItems(TENANT_NAV, user)}
      moreNav={filterNavItems(TENANT_MORE, user)}
      user={{ name: user.name, email: user.email }}
      subtitle={subtitle}
      unread={unread}
      installName={PWA_APPS.tenant.shortName}
      accent="blue"
    >
      {children}
    </MobileShell>
  )
}
