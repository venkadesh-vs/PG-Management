import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { requireAccess } from '@/lib/auth'
import { resolveScope } from '@/lib/tenancy'
import { prisma } from '@/lib/prisma'
import { PageHeader } from '@/components/app/page-header'
import { getLookup } from '@/server/services/org-defaults'
import { CheckInWizard } from './check-in-wizard'

export const metadata: Metadata = { title: 'Check in resident' }

export default async function NewResidentPage({
  searchParams,
}: {
  searchParams: Promise<{ property?: string; bed?: string }>
}) {
  const user = await requireAccess({ module: 'residents', permission: 'residents.manage' })
  const params = await searchParams
  const scope = await resolveScope(user, params.property)

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
      select: { rentDueDay: true },
    }),
    getLookup(scope.organizationId, 'ID_TYPE'),
    getLookup(scope.organizationId, 'GUARDIAN_RELATION'),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Check in a resident"
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
        defaultPropertyId={scope.propertyId ?? properties[0].id}
        defaultBedId={params.bed}
        rentDueDay={settings?.rentDueDay ?? 5}
        idTypes={idTypes}
        relations={relations}
        foodEnabled={user.modules.includes('food')}
      />
    </div>
  )
}
