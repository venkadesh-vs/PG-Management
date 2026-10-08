import type { Metadata } from 'next'
import { requireAccess } from '@/lib/auth'
import { resolveScope, hasPermission } from '@/lib/tenancy'
import { prisma } from '@/lib/prisma'
import { listRates } from '@/server/services/electricity'
import { PageHeader } from '@/components/app/page-header'
import { ElectricityTabs } from '../electricity-tabs'
import { RateManager } from './rate-manager'

export const metadata: Metadata = { title: 'Electricity rates' }

export default async function RatesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireAccess({ module: 'electricity', permission: 'electricity.view' })
  const params = await searchParams
  const scope = await resolveScope(user, params.property)
  const [rates, properties] = await Promise.all([
    listRates(user, scope.propertyId),
    prisma.property.findMany({
      where: { id: { in: scope.propertyId ? [scope.propertyId] : scope.allowedPropertyIds } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Electricity rates"
        subtitle="The price per unit for each PG, month by month. A new rate applies from its month onwards; bills already made keep the rate they used."
        icon="zap"
        breadcrumbs={[{ label: 'Dashboard', href: '/app' }, { label: 'Electricity', href: '/app/electricity' }, { label: 'Rates' }]}
      />
      <ElectricityTabs active="rates" />
      <RateManager
        canManage={hasPermission(user, 'electricity.manage')}
        properties={properties}
        rates={rates.map((r) => ({
          id: r.id,
          propertyId: r.property.id,
          propertyName: r.property.name,
          month: r.month,
          ratePerUnit: r.ratePerUnit,
          note: r.note,
          createdByName: r.createdByName,
          createdAt: r.createdAt.toISOString(),
          current: r.current,
        }))}
      />
    </div>
  )
}
