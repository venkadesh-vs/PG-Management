import type { Metadata } from 'next'
import { requireOrgUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { serverEnv } from '@/lib/env'
import { paymentMode } from '@/server/integrations/payments'
import { PageHeader } from '@/components/app/page-header'
import { SettingsForm } from './settings-form'

export const metadata: Metadata = { title: 'Settings' }

export default async function SettingsPage() {
  const user = await requireOrgUser()

  const [organization, settings, team, properties] = await Promise.all([
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
      where: { organizationId: user.organizationId, role: { in: ['OWNER', 'MANAGER'] } },
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
        propertyAccess: { select: { property: { select: { name: true } } } },
      },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    }),
    prisma.property.findMany({
      where: { organizationId: user.organizationId, archivedAt: null },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        subtitle="Rent cycle, late fees, reminders and payment details. These drive the automations — change them here and every PG follows."
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
