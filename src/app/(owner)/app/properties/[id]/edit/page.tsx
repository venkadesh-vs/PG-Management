import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { requireAccess } from '@/lib/auth'
import { assertPropertyAccess, ForbiddenError, NotFoundError } from '@/lib/tenancy'
import { prisma } from '@/lib/prisma'
import { PageHeader } from '@/components/app/page-header'
import { PropertyForm } from '../../property-form'
import { deriveRentCard, normaliseRentCard } from '@/lib/rent-card'
import { RentCardEditor } from './rent-card-editor'

export const metadata: Metadata = { title: 'Edit PG' }

export default async function EditPropertyPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  // Same rule as PATCH /api/properties/<id>.
  const user = await requireAccess({ module: 'properties', permission: 'properties.manage' })
  const { id } = await params
  // Another organisation's (or another PG's) record reads as "not found".
  await assertPropertyAccess(user, id).catch((error: unknown) => {
    if (error instanceof NotFoundError || error instanceof ForbiddenError) notFound()
    throw error
  })

  const property = await prisma.property.findFirst({
    where: { id, organizationId: user.organizationId },
  })
  if (!property) notFound()
  if (property.archivedAt) redirect(`/app/properties/${id}`)

  // The rooms decide which rows the card shows; a PG without a card starts
  // from the rents its rooms already carry.
  const rooms = await prisma.room.findMany({
    where: { propertyId: property.id },
    select: { type: true, capacity: true, hasAC: true, baseRent: true },
  })
  const derived = deriveRentCard(rooms, property.standardRent)
  const saved = normaliseRentCard(property.rentCard)
  const initialCard = Object.keys(saved).length ? saved : derived.card

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
      <RentCardEditor
        propertyId={property.id}
        initial={initialCard}
        used={derived.used}
        standardRent={property.standardRent}
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
