import 'server-only'

import { prisma } from '@/lib/prisma'
import { serverEnv } from '@/lib/env'
import type { SessionUser } from '@/lib/auth'
import { isDeliverableEmail } from '@/server/services/accounts'
import { OnboardingChecklist, VerifyEmailBanner, type ChecklistItem } from './onboarding-checklist'

/**
 * Getting-started guidance for accounts created through sign-up, the admin
 * or a converted lead. Every step is computed from real data, so it ticks
 * itself off; the whole card disappears once everything is done.
 */
export async function Onboarding({ user }: { user: SessionUser & { organizationId: string } }) {
  if (user.role !== 'OWNER') return null
  const organizationId = user.organizationId

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { signupSource: true },
  })
  // Older accounts (and the demo) were set up by hand — no checklist.
  if (!org?.signupSource) return null

  const [me, properties, beds, residents, settings, whatsapp] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: { email: true, emailVerifiedAt: true } }),
    prisma.property.findFirst({
      where: { organizationId, archivedAt: null },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.bed.count({ where: { property: { organizationId, archivedAt: null } } }),
    prisma.resident.count({ where: { organizationId } }),
    prisma.orgSetting.findUnique({ where: { organizationId }, select: { upiId: true } }),
    prisma.integrationCredential.findFirst({
      where: { organizationId, kind: 'WHATSAPP_META', active: true },
      select: { id: true },
    }),
  ])

  const emailVerified = Boolean(me?.emailVerifiedAt) || !isDeliverableEmail(me?.email)
  const allItems: ChecklistItem[] = [
    {
      key: 'email',
      title: 'Verify your email',
      body: 'So you can always recover your account.',
      done: emailVerified,
      action: 'resend-verify',
    },
    {
      key: 'property',
      title: 'Add your first PG',
      body: 'Name, address and standard rent. Your free trial starts here.',
      done: Boolean(properties),
      href: '/app/properties/new',
    },
    {
      key: 'beds',
      title: 'Add rooms & beds',
      body: 'Build floors, rooms and beds so occupancy is tracked.',
      done: beds > 0,
      href: properties ? `/app/properties/${properties.id}` : '/app/properties',
    },
    {
      key: 'resident',
      title: 'Check in your first resident',
      body: 'Rent schedule, deposit and resident app — all set up in one go.',
      done: residents > 0,
      href: '/app/residents/new',
    },
    {
      key: 'upi',
      title: 'Add your UPI ID',
      body: 'Residents pay rent straight to you from the reminder.',
      done: Boolean(settings?.upiId),
      href: '/app/settings',
    },
    {
      key: 'whatsapp',
      title: 'Connect WhatsApp',
      body: 'Send rent reminders, receipts and updates automatically.',
      done: Boolean(whatsapp) || serverEnv.whatsapp.isLive,
      href: '/app/settings/whatsapp',
    },
  ]

  // A switched-off module has no setup step.
  const items = allItems.filter((i) => i.key !== 'whatsapp' || user.modules.includes('whatsapp'))

  return (
    <>
      {!emailVerified && me && <VerifyEmailBanner email={me.email} />}
      {items.some((i) => !i.done) && <OnboardingChecklist items={items} />}
    </>
  )
}
