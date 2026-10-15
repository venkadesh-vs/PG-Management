import type { Metadata } from 'next'
import { requireAccess } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { QuickSetup } from '../../setup/quick-setup'

export const metadata: Metadata = { title: 'Add a PG' }

/** Another PG, in the same three quick screens as the first one. */
export default async function NewPropertyPage() {
  // Each PG adds to the billed subscription, so this needs its own permission.
  const user = await requireAccess({ module: 'properties', permission: 'properties.create' })
  const [plan, last] = await Promise.all([
    prisma.plan.findFirst({
      where: { active: true },
      orderBy: { isDefault: 'desc' },
      select: { pricingBasis: true, multiplier: true, perBedPrice: true, flatPrice: true, minAmount: true, maxAmount: true },
    }),
    prisma.property.findFirst({
      where: { organizationId: user.organizationId, archivedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { city: true },
    }),
  ])
  return <QuickSetup plan={plan} finishOnboarding={false} defaultCity={last?.city} ownerName={user.name} />
}
