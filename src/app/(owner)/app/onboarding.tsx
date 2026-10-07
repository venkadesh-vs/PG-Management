import 'server-only'

import { prisma } from '@/lib/prisma'
import type { SessionUser } from '@/lib/auth'
import { isDeliverableEmail } from '@/server/services/accounts'
import { getOnboarding, setupFacts } from '@/server/services/onboarding'
import {
  ContinueSetupCard,
  OnboardingChecklist,
  VerifyEmailBanner,
  type ChecklistItem,
} from './onboarding-checklist'

/**
 * Getting Started guidance on the owner dashboard. Every item is computed
 * from real data, so it ticks itself off; the card disappears once
 * everything is done. While the setup wizard is unfinished, a "Continue
 * setup" card leads back to the exact step the owner left.
 */
export async function Onboarding({ user }: { user: SessionUser & { organizationId: string } }) {
  if (user.role !== 'OWNER') return null
  const organizationId = user.organizationId

  const [org, me, onboarding, facts] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId }, select: { signupSource: true } }),
    prisma.user.findUnique({ where: { id: user.id }, select: { email: true, emailVerifiedAt: true } }),
    getOnboarding(organizationId),
    setupFacts(organizationId),
  ])
  // Older accounts (and the demo) were set up by hand — no checklist,
  // unless the owner has opened the setup wizard.
  if (!org?.signupSource && !onboarding.started) return null

  const emailVerified = Boolean(me?.emailVerifiedAt) || !isDeliverableEmail(me?.email)
  const step = (key: string) => `/app/setup?step=${key}`

  const allItems: ChecklistItem[] = [
    {
      key: 'property',
      title: 'PG created',
      body: 'Name, address and type. Your free trial starts here.',
      done: Boolean(facts.property),
      href: step('basics'),
    },
    {
      key: 'rooms',
      title: 'Rooms configured',
      body: 'Add floors and rooms in a couple of taps.',
      done: facts.rooms > 0,
      href: facts.property ? step('floors') : step('basics'),
    },
    {
      key: 'beds',
      title: 'Beds configured',
      body: 'Beds come with each room — check the totals.',
      done: facts.beds > 0,
      href: facts.property ? step(facts.rooms > 0 ? 'beds' : 'rooms') : step('basics'),
    },
    {
      key: 'rent',
      title: 'Rent rules set',
      body: 'Standard rent, due day and late fee.',
      done: facts.rentRulesSet,
      href: facts.property ? step('rent') : '/app/settings',
    },
    {
      key: 'payments',
      title: 'Payment account connected',
      body: 'Add your UPI ID or connect Razorpay.',
      done: facts.upi || facts.razorpay,
      href: facts.property ? step('payments') : '/app/settings/payments',
    },
    {
      key: 'whatsapp',
      title: 'WhatsApp connected',
      body: 'Reminders and receipts from your own number.',
      done: facts.whatsapp,
      href: '/app/settings/whatsapp',
    },
    {
      key: 'staff',
      title: 'Staff added',
      body: 'Invite a manager or add your staff.',
      done: facts.staff + facts.managers > 0,
      href: facts.property ? step('staff') : '/app/settings',
    },
    {
      key: 'residents',
      title: 'Residents added',
      body: 'Check in or import your residents from a spreadsheet.',
      done: facts.residents > 0,
      href: '/app/residents/import',
    },
  ]

  // A switched-off module has no setup step.
  const items = allItems.filter((i) => i.key !== 'whatsapp' || user.modules.includes('whatsapp'))
  const showContinue = onboarding.started && !onboarding.completedAt && onboarding.step !== 'done'

  return (
    <>
      {!emailVerified && me && <VerifyEmailBanner email={me.email} />}
      {/* One progress figure only: when the checklist shows, "Continue setup" lives inside it. */}
      {items.some((i) => !i.done) ? (
        <OnboardingChecklist
          items={items}
          continueHref={showContinue ? `/app/setup?step=${encodeURIComponent(onboarding.step)}` : undefined}
        />
      ) : (
        showContinue && <ContinueSetupCard percent={onboarding.percent} step={onboarding.step} />
      )}
    </>
  )
}
