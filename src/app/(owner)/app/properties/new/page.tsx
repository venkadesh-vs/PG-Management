import type { Metadata } from 'next'
import { requireOrgUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PageHeader } from '@/components/app/page-header'
import { PropertyForm } from '../property-form'

export const metadata: Metadata = { title: 'Add a PG' }

export default async function NewPropertyPage() {
  const user = await requireOrgUser()

  // Show the pricing rule so the owner sees the subscription before creating.
  const plan = await prisma.plan.findFirst({
    where: { active: true },
    orderBy: { isDefault: 'desc' },
    select: {
      name: true,
      pricingBasis: true,
      multiplier: true,
      perBedPrice: true,
      flatPrice: true,
      minAmount: true,
      maxAmount: true,
      trialDays: true,
    },
  })

  const count = await prisma.property.count({
    where: { organizationId: user.organizationId, archivedAt: null },
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Add a PG"
        subtitle="Set the property up once. Rent defaults, the food plan and the subscription follow from what you enter here."
        icon="building"
        breadcrumbs={[
          { label: 'Dashboard', href: '/app' },
          { label: 'Properties', href: '/app/properties' },
          { label: 'Add a PG' },
        ]}
      />
      <PropertyForm plan={plan} existingCount={count} />
    </div>
  )
}
