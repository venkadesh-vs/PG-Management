import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, Bed, Building2, MapPin, Plus } from 'lucide-react'
import { requireAccess } from '@/lib/auth'
import { resolveScope } from '@/lib/tenancy'
import { prisma } from '@/lib/prisma'
import { themeFor } from '@/lib/theme'
import { cn, formatMoney } from '@/lib/utils'
import { propertyComparison } from '@/server/services/analytics'
import { PageHeader } from '@/components/app/page-header'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/feedback'
import { OccupancyBar } from '@/components/app/occupancy-ring'

export const metadata: Metadata = { title: 'Properties' }

export default async function PropertiesPage({
  searchParams,
}: {
  searchParams: Promise<{ property?: string }>
}) {
  const user = await requireAccess({ module: 'properties', permission: 'properties.view' })
  const canCreate = user.permissions.includes('properties.create')
  const canSeeMoney = user.permissions.includes('rent.view')
  const params = await searchParams
  const scope = await resolveScope(user, params.property)

  const [properties, comparison] = await Promise.all([
    prisma.property.findMany({
      where: { id: { in: scope.allowedPropertyIds } },
      include: {
        _count: { select: { rooms: true, beds: true, floors: true } },
        subscription: { select: { amount: true, status: true, nextBillingDate: true } },
      },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    }),
    propertyComparison(scope.organizationId, scope.allowedPropertyIds),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Properties"
        subtitle="Each PG carries its own rent configuration, theme and subscription."
        icon="building"
        breadcrumbs={[{ label: 'Dashboard', href: '/app' }, { label: 'Properties' }]}
        actions={
          canCreate && (
            <Button variant="primary" asChild>
              <Link href="/app/properties/new">
                <Plus className="size-4" />
                Add a PG
              </Link>
            </Button>
          )
        }
      />

      {properties.length === 0 ? (
        <EmptyState
          icon="building"
          title="No PG added yet"
          description="Add your first property to start tracking rooms, beds, residents and rent."
          action={
            canCreate && (
              <Button variant="primary" asChild>
                <Link href="/app/properties/new">
                  <Plus className="size-4" />
                  Add a PG
                </Link>
              </Button>
            )
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {properties.map((property) => {
            const theme = themeFor(property.type)
            const stats = comparison.find((c) => c.id === property.id)
            return (
              <div
                key={property.id}
                className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card transition-shadow hover:shadow-elevated"
              >
                <div className={cn('relative h-24 bg-gradient-to-br p-5', theme.gradient)}>
                  <div className="dot-grid absolute inset-0 opacity-[0.15]" />
                  <div className="relative flex items-start justify-between">
                    <div>
                      <h2 className="font-display text-lg font-semibold tracking-tight text-white">
                        {property.name}
                      </h2>
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-white/75">
                        <MapPin className="size-3" />
                        {property.city}, {property.state}
                      </p>
                    </div>
                    <span className="rounded-full border border-white/25 bg-white/15 px-2.5 py-0.5 text-[11px] font-medium text-white backdrop-blur">
                      {theme.label}
                    </span>
                  </div>
                </div>

                <div className="space-y-4 p-5">
                  <div className="grid grid-cols-4 gap-2 text-center">
                    <Metric label="Floors" value={String(property._count.floors)} />
                    <Metric label="Rooms" value={String(property._count.rooms)} />
                    <Metric label="Beds" value={String(property._count.beds)} />
                    <Metric label="Residents" value={String(stats?.residents ?? 0)} />
                  </div>

                  {stats && (
                    <div>
                      <div className="mb-1.5 flex items-center justify-between text-xs">
                        <span className="text-slate-500">Occupancy</span>
                        <span className={cn('font-semibold', theme.text)}>
                          {stats.occupancy.rate}%
                        </span>
                      </div>
                      <OccupancyBar
                        occupied={stats.occupancy.occupied}
                        available={stats.occupancy.available}
                        reserved={stats.occupancy.reserved}
                        maintenance={stats.occupancy.maintenance}
                        blocked={stats.occupancy.blocked}
                      />
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-3 text-sm">
                    <div>
                      <p className="text-xs text-slate-500">Standard rent</p>
                      <p className="font-semibold text-slate-800 tabular">
                        {formatMoney(property.standardRent)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Collected this month</p>
                      <p className="font-semibold text-emerald-600 tabular">
                        {canSeeMoney ? formatMoney(stats?.collection ?? 0) : '—'}
                      </p>
                    </div>
                  </div>

                  {property.subscription && (
                    <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                      <span className="text-xs text-slate-500">StayFlow subscription</span>
                      <span className="text-xs font-semibold text-slate-700 tabular">
                        {formatMoney(property.subscription.amount)}/mo
                      </span>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" asChild>
                      <Link href={`/app/properties/${property.id}`}>
                        <Building2 className="size-3.5" />
                        Configure
                      </Link>
                    </Button>
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/app/beds?property=${property.id}`}>
                        <Bed className="size-3.5" />
                        Bed map
                      </Link>
                    </Button>
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/app?property=${property.id}`}>
                        Dashboard
                        <ArrowRight className="size-3.5" />
                      </Link>
                    </Button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-2 py-2">
      <p className="font-display text-lg font-semibold text-slate-900 tabular">{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
    </div>
  )
}
