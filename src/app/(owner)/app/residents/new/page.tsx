import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { requireAccess } from '@/lib/auth'
import { resolveScope } from '@/lib/tenancy'
import { prisma } from '@/lib/prisma'
import { PageHeader } from '@/components/app/page-header'
import { getLookup } from '@/server/services/org-defaults'
import { toISODate } from '@/lib/utils'
import { CheckInWizard, type CheckInPrefill } from './check-in-wizard'

export const metadata: Metadata = { title: 'Check in resident' }

export default async function NewResidentPage({
  searchParams,
}: {
  searchParams: Promise<{ property?: string; bed?: string; booking?: string }>
}) {
  const user = await requireAccess({ module: 'residents', permission: 'residents.manage' })
  const params = await searchParams
  const scope = await resolveScope(user, params.property)

  // Checking in from a booking: carry its details over.
  let prefill: CheckInPrefill | null = null
  if (params.booking) {
    const booking = await prisma.booking.findFirst({
      where: {
        id: params.booking,
        organizationId: scope.organizationId,
        propertyId: { in: scope.allowedPropertyIds },
        status: { in: ['PENDING', 'CONFIRMED'] },
      },
      include: {
        bed: { select: { id: true, label: true, room: { select: { number: true } } } },
        lead: { select: { gender: true } },
      },
    })
    if (booking) {
      const today = new Date()
      prefill = {
        bookingId: booking.id,
        code: booking.code,
        fullName: booking.name,
        phone: booking.phone,
        email: booking.email ?? '',
        gender: booking.lead?.gender ?? '',
        propertyId: booking.propertyId,
        bedId: booking.bed?.id ?? '',
        bedName: booking.bed ? `${booking.bed.room.number}-${booking.bed.label}` : null,
        joiningDate: toISODate(booking.checkInDate > today ? booking.checkInDate : today),
        rentAmount: booking.rent,
        depositAmount: booking.deposit,
        tokenAmount: booking.tokenPaidAt ? booking.tokenAmount : 0,
      }
    }
  }

  const properties = await prisma.property.findMany({
    where: { id: { in: scope.allowedPropertyIds } },
    select: {
      id: true,
      name: true,
      type: true,
      standardRent: true,
      standardDeposit: true,
      maintenanceFee: true,
      foodCharge: true,
      foodIncluded: true,
      foodPlans: {
        where: { active: true },
        select: { id: true, name: true, monthlyCharge: true, isDefault: true },
      },
    },
    orderBy: { name: 'asc' },
  })

  if (!properties.length) redirect('/app/properties/new')

  const [settings, idTypes, relations] = await Promise.all([
    prisma.orgSetting.findUnique({
      where: { organizationId: scope.organizationId },
      select: { rentDueDay: true, rentDueDayMin: true, rentDueDayMax: true },
    }),
    getLookup(scope.organizationId, 'ID_TYPE'),
    getLookup(scope.organizationId, 'GUARDIAN_RELATION'),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title={prefill ? `Check in ${prefill.fullName}` : 'Check in a resident'}
        subtitle="One form replaces the paper admission book. Everything it touches — bed, rent schedule, deposit, food plan and resident app — is set up when you finish."
        icon="userPlus"
        breadcrumbs={[
          { label: 'Dashboard', href: '/app' },
          { label: 'Residents', href: '/app/residents' },
          { label: 'Check in' },
        ]}
      />
      <CheckInWizard
        properties={properties}
        defaultPropertyId={prefill?.propertyId ?? scope.propertyId ?? properties[0].id}
        prefill={prefill}
        defaultBedId={params.bed}
        rentDueDay={settings?.rentDueDay ?? 5}
        dueDayWindow={{ min: settings?.rentDueDayMin ?? 1, max: settings?.rentDueDayMax ?? 10 }}
        idTypes={idTypes}
        relations={relations}
        foodEnabled={user.modules.includes('food')}
      />
    </div>
  )
}
