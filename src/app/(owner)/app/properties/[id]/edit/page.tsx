import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { requireAccess } from '@/lib/auth'
import { assertPropertyAccess } from '@/lib/tenancy'
import { prisma } from '@/lib/prisma'
import { PageHeader } from '@/components/app/page-header'
import { PropertyForm } from '../../property-form'

export const metadata: Metadata = { title: 'Edit PG' }

export default async function EditPropertyPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  // Same rule as PATCH /api/properties/<id>.
  const user = await requireAccess({ module: 'properties', permission: 'properties.manage' })
  const { id } = await params
  await assertPropertyAccess(user, id)

  const property = await prisma.property.findFirst({
    where: { id, organizationId: user.organizationId },
  })
  if (!property) notFound()
  if (property.archivedAt) redirect(`/app/properties/${id}`)

  const electricityMode = (['INCLUDED', 'SHARED', 'METERED'] as const).includes(
    property.electricityMode as 'INCLUDED',
  )
    ? (property.electricityMode as 'INCLUDED' | 'SHARED' | 'METERED')
    : 'INCLUDED'

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Edit ${property.name}`}
        subtitle="Rent changes apply to new residents and new invoices. Existing residents keep their agreed rent."
        icon="building"
        breadcrumbs={[
          { label: 'Dashboard', href: '/app' },
          { label: 'Properties', href: '/app/properties' },
          { label: property.name, href: `/app/properties/${property.id}` },
          { label: 'Edit' },
        ]}
      />
      <PropertyForm
        plan={null}
        existingCount={0}
        property={{
          id: property.id,
          name: property.name,
          code: property.code,
          type: property.type,
          addressLine: property.addressLine,
          city: property.city,
          state: property.state,
          pincode: property.pincode,
          contactName: property.contactName ?? '',
          contactPhone: property.contactPhone ?? '',
          description: property.description ?? '',
          standardRent: property.standardRent,
          standardDeposit: property.standardDeposit,
          maintenanceFee: property.maintenanceFee,
          foodCharge: property.foodCharge,
          foodIncluded: property.foodIncluded,
          electricityMode,
          electricityRate: property.electricityRate,
          noticePeriodDays: property.noticePeriodDays,
          amenities: property.amenities,
          rules: property.rules,
        }}
      />
    </div>
  )
}
