import { prisma } from '@/lib/prisma'
import { requireSuperAdmin } from '@/lib/auth'
import { ADMIN_NAV } from '@/lib/navigation'
import { AppShell } from '@/components/app/app-shell'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSuperAdmin()

  const [notifications, leads] = await Promise.all([
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    prisma.lead.count({ where: { status: 'NEW' } }),
  ])

  return (
    <AppShell
      nav={ADMIN_NAV}
      user={{
        name: user.name,
        email: user.email,
        role: user.role,
        avatarUrl: user.avatarUrl,
        organizationName: 'StayFlow Platform',
      }}
      properties={[]}
      badges={{ complaints: 0, notifications, tasks: 0, leads }}
      showPropertySwitcher={false}
      searchScope="platform"
    >
      {children}
    </AppShell>
  )
}
