import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Bed, CheckCircle2, MapPin, Phone, Sparkles, Utensils } from 'lucide-react'
import { requireOrgUser } from '@/lib/auth'
import { assertPropertyAccess } from '@/lib/tenancy'
import { prisma } from '@/lib/prisma'
import { themeFor, SUBSCRIPTION_STATUS_STYLE } from '@/lib/theme'
import { cn, formatDate, formatMoney, formatPhone } from '@/lib/utils'
import { occupancyFor } from '@/server/services/residents'
import { PageHeader } from '@/components/app/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge, StatusChip } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { OccupancyBar } from '@/components/app/occupancy-ring'
import { RoomBuilder } from './room-builder'

export const metadata: Metadata = { title: 'PG settings' }

export default async function PropertyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await requireOrgUser()
  const { id } = await params
  await assertPropertyAccess(user, id)

  const property = await prisma.property.findUnique({
    where: { id },
    include: {
      floors: {
        orderBy: { level: 'asc' },
        include: {
          rooms: {
            orderBy: { number: 'asc' },
            include: { _count: { select: { beds: true } }, beds: { select: { status: true } } },
          },
        },
      },
      foodPlans: { where: { active: true } },
      subscription: { include: { plan: true } },
      _count: { select: { residents: true, beds: true, rooms: true } },
    },
  })
  if (!property) notFound()

  const theme = themeFor(property.type)
  const occupancy = await occupancyFor([property.id])

  return (
    <div className="space-y-6">
      <PageHeader
        title={property.name}
        subtitle={`${theme.label} · ${property.city}`}
        icon="building"
        breadcrumbs={[
          { label: 'Dashboard', href: '/app' },
          { label: 'Properties', href: '/app/properties' },
          { label: property.name },
        ]}
        actions={
          <Button variant="outline" asChild>
            <Link href={`/app/beds?property=${property.id}`}>
              <Bed className="size-4" />
              Open bed map
            </Link>
          </Button>
        }
      />

      <div
        className={cn(
          'relative overflow-hidden rounded-3xl bg-gradient-to-br p-6 text-white shadow-elevated',
          theme.gradient,
        )}
      >
        <div className="dot-grid absolute inset-0 opacity-[0.12]" />
        <div className="relative grid gap-5 lg:grid-cols-[1fr_auto]">
          <div>
            <h2 className="font-display text-xl font-semibold tracking-tight">{property.name}</h2>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-white/75">
              <MapPin className="size-3.5" />
              {property.addressLine}, {property.city}, {property.state} {property.pincode}
            </p>
            {property.contactPhone && (
              <p className="mt-1 flex items-center gap-1.5 text-sm text-white/75">
                <Phone className="size-3.5" />
                {property.contactName} · {formatPhone(property.contactPhone)}
              </p>
            )}
            {property.description && (
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/70">
                {property.description}
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-1.5">
              {property.amenities.map((amenity) => (
                <span
                  key={amenity}
                  className="rounded-full border border-white/20 bg-white/10 px-2.5 py-0.5 text-[11px] backdrop-blur"
                >
                  {amenity}
                </span>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:w-64">
            <HeroTile label="Rooms" value={String(property._count.rooms)} />
            <HeroTile label="Beds" value={String(property._count.beds)} />
            <HeroTile label="Occupied" value={`${occupancy.occupied}`} />
            <HeroTile label="Occupancy" value={`${occupancy.rate}%`} />
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Rent configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            <Row label="Standard rent" value={formatMoney(property.standardRent)} />
            <Row label="Standard deposit" value={formatMoney(property.standardDeposit)} />
            <Row label="Maintenance" value={formatMoney(property.maintenanceFee)} />
            <Row label="Food charge" value={formatMoney(property.foodCharge)} />
            <Row
              label="Electricity"
              value={
                property.electricityMode === 'INCLUDED'
                  ? 'Included in rent'
                  : `${property.electricityMode.toLowerCase()} · ${formatMoney(property.electricityRate)}/unit`
              }
            />
            <Row label="Notice period" value={`${property.noticePeriodDays} days`} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Utensils className="size-4 text-slate-400" />
              Food plans
            </CardTitle>
          </CardHeader>
          <CardContent>
            {property.foodPlans.length === 0 ? (
              <p className="text-sm text-slate-500">
                No food plan set up. Residents will not be added to the daily meal count.
              </p>
            ) : (
              <ul className="space-y-2">
                {property.foodPlans.map((plan) => (
                  <li
                    key={plan.id}
                    className="flex items-start justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/60 p-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">
                        {plan.name}
                        {plan.isDefault && (
                          <Badge variant="info" size="sm" className="ml-1.5">
                            Default
                          </Badge>
                        )}
                      </p>
                      <p className="text-xs text-slate-500">
                        {[
                          plan.includesBreakfast && 'Breakfast',
                          plan.includesLunch && 'Lunch',
                          plan.includesDinner && 'Dinner',
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold text-slate-800 tabular">
                      {formatMoney(plan.monthlyCharge)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Sparkles className="size-4 text-slate-400" />
              Subscription
            </CardTitle>
          </CardHeader>
          <CardContent>
            {property.subscription ? (
              <div className="space-y-2.5">
                <div className="flex items-baseline gap-2">
                  <span className="font-display text-2xl font-semibold text-slate-900 tabular">
                    {formatMoney(property.subscription.amount)}
                  </span>
                  <span className="text-sm text-slate-500">/month</span>
                </div>
                <StatusChip
                  label={SUBSCRIPTION_STATUS_STYLE[property.subscription.status].label}
                  chip={SUBSCRIPTION_STATUS_STYLE[property.subscription.status].chip}
                />
                <Row label="Plan" value={property.subscription.plan.name} />
                <Row
                  label="Next billing"
                  value={formatDate(property.subscription.nextBillingDate)}
                />
                <Row
                  label="AutoPay"
                  value={property.subscription.autopayEnabled ? 'Active' : 'Not set up'}
                />
                <Button variant="outline" size="sm" className="mt-1 w-full" asChild>
                  <Link href="/app/subscription">Manage subscription</Link>
                </Button>
              </div>
            ) : (
              <p className="text-sm text-slate-500">No subscription attached to this PG.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Occupancy across this PG</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <OccupancyBar
            occupied={occupancy.occupied}
            available={occupancy.available}
            reserved={occupancy.reserved}
            maintenance={occupancy.maintenance}
            blocked={occupancy.blocked}
          />
          <div className="flex flex-wrap gap-4 text-xs text-slate-600">
            <Legend color="bg-slate-700" label="Occupied" value={occupancy.occupied} />
            <Legend color="bg-emerald-400" label="Available" value={occupancy.available} />
            <Legend color="bg-amber-400" label="Reserved" value={occupancy.reserved} />
            <Legend color="bg-orange-400" label="Maintenance" value={occupancy.maintenance} />
            <Legend color="bg-slate-300" label="Blocked" value={occupancy.blocked} />
          </div>
        </CardContent>
      </Card>

      <RoomBuilder
        propertyId={property.id}
        propertyType={property.type}
        standardRent={property.standardRent}
        floors={property.floors.map((floor) => ({
          id: floor.id,
          name: floor.name,
          level: floor.level,
          rooms: floor.rooms.map((room) => ({
            id: room.id,
            number: room.number,
            type: room.type,
            capacity: room.capacity,
            baseRent: room.baseRent,
            hasAC: room.hasAC,
            bedCount: room._count.beds,
            occupied: room.beds.filter((b) => b.status === 'OCCUPIED').length,
          })),
        }))}
      />

      {property.rules.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">House rules</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5">
              {property.rules.map((rule) => (
                <li key={rule} className="flex items-start gap-2 text-sm text-slate-600">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-slate-300" />
                  {rule}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function HeroTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/15 bg-white/10 px-3 py-2 backdrop-blur">
      <p className="text-[10px] uppercase tracking-wide text-white/60">{label}</p>
      <p className="font-display text-lg font-semibold tabular">{value}</p>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-800 tabular">{value}</span>
    </div>
  )
}

function Legend({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn('size-2 rounded-full', color)} />
      {label}
      <span className="font-semibold text-slate-800 tabular">{value}</span>
    </span>
  )
}
