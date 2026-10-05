import type { Metadata } from 'next'
import { requireOrgUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { serverEnv } from '@/lib/env'
import { paymentMode } from '@/server/integrations/payments'
import { PageHeader } from '@/components/app/page-header'
import { SettingsForm } from './settings-form'
import { ensureOrgDefaults } from '@/server/services/org-defaults'
import { platformWithheldModules } from '@/components/settings/platform.server'
import { SETTINGS_TABS, type SettingsTab } from '@/components/settings/shared'

export const metadata: Metadata = { title: 'Settings' }

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>
}) {
  const user = await requireOrgUser()
  const { tab: rawTab } = await searchParams
  const canTeam = user.role === 'OWNER' || user.permissions.includes('team.manage')
  const canLookups = user.role === 'OWNER' || user.permissions.includes('settings.manage')
  const wanted = (Array.isArray(rawTab) ? rawTab[0] : rawTab) as SettingsTab | undefined
  const allowed =
    wanted &&
    SETTINGS_TABS.includes(wanted) &&
    (!['features', 'roles', 'team'].includes(wanted) || canTeam) &&
    (wanted !== 'lookups' || canLookups)
  const initialTab = allowed ? wanted : undefined

  if (canTeam) await ensureOrgDefaults(user.organizationId)

  const [organization, settings, team, properties, roles, withheld] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: user.organizationId },
      select: {
        name: true,
        ownerName: true,
        contactEmail: true,
        contactPhone: true,
        city: true,
        state: true,
        addressLine: true,
        status: true,
      },
    }),
    prisma.orgSetting.findUnique({ where: { organizationId: user.organizationId } }),
    prisma.user.findMany({
      where: {
        organizationId: user.organizationId,
        role: { in: ['OWNER', 'MANAGER', 'WORKER'] },
        archivedAt: null,
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        lastLoginAt: true,
        status: true,
        mustChangePassword: true,
        passwordChangedAt: true,
        orgRoleId: true,
        orgRole: { select: { name: true } },
        propertyAccess: { select: { property: { select: { name: true } } } },
      },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    }),
    prisma.property.findMany({
      where: { organizationId: user.organizationId, archivedAt: null },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    canTeam
      ? prisma.orgRole.findMany({
          where: { organizationId: user.organizationId },
          orderBy: [{ app: 'asc' }, { createdAt: 'asc' }],
          include: { _count: { select: { users: { where: { archivedAt: null } } } } },
        })
      : Promise.resolve([]),
    platformWithheldModules(user.organizationId),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        subtitle="Rent rules, reminders, features, roles and your team. Change something here and every PG follows."
        icon="settings"
        breadcrumbs={[{ label: 'Dashboard', href: '/app' }, { label: 'Settings' }]}
      />
      <SettingsForm
        organization={organization}
        settings={
          settings
            ? {
                rentDueDay: settings.rentDueDay,
                rentGenerateDay: settings.rentGenerateDay,
                lateFeeEnabled: settings.lateFeeEnabled,
                lateFeeGraceDays: settings.lateFeeGraceDays,
                lateFeeAmount: settings.lateFeeAmount,
                lateFeePerDay: settings.lateFeePerDay,
                reminderDaysBefore: settings.reminderDaysBefore,
                reminderOnDueDate: settings.reminderOnDueDate,
                reminderAfterDays: settings.reminderAfterDays,
                whatsappEnabled: settings.whatsappEnabled,
                upiId: settings.upiId ?? '',
                upiPayeeName: settings.upiPayeeName ?? '',
                invoicePrefix: settings.invoicePrefix,
                receiptPrefix: settings.receiptPrefix,
                slaUrgentHours: settings.slaUrgentHours,
                slaHighHours: settings.slaHighHours,
                slaMediumHours: settings.slaMediumHours,
                slaLowHours: settings.slaLowHours,
              }
            : null
        }
        team={team.map((member) => ({
          id: member.id,
          name: member.name,
          email: member.email,
          phone: member.phone,
          role: member.role,
          status: member.status,
          // Invited but never set a password.
          pending:
            member.status === 'INVITED' || (member.mustChangePassword && !member.passwordChangedAt),
          lastLoginAt: member.lastLoginAt?.toISOString() ?? null,
          propertyNames: member.propertyAccess.map((a) => a.property.name),
          orgRoleId: member.orgRoleId,
          roleName: member.role === 'OWNER' ? 'Owner' : (member.orgRole?.name ?? null),
        }))}
        initialTab={initialTab}
        access={{ team: canTeam, lookups: canLookups }}
        features={{
          disabledModules: settings?.disabledModules ?? [],
          withheld,
          enabledModules: user.modules,
        }}
        roles={roles.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          app: r.app,
          color: r.color,
          permissions: r.permissions,
          isTemplate: r.isTemplate,
          userCount: r._count.users,
        }))}
        properties={properties}
        currentUserId={user.id}
        integrations={{
          whatsapp: serverEnv.whatsapp.isLive ? 'live' : 'demo',
          payments: paymentMode(),
        }}
        canEdit={user.role === 'OWNER'}
      />
    </div>
  )
}
