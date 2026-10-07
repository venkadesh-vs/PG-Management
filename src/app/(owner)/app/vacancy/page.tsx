import type { Metadata } from 'next'
import Link from 'next/link'
import { BedDouble, CalendarPlus, ClipboardList, PhoneCall, TrendingDown } from 'lucide-react'
import { requireAccess } from '@/lib/auth'
import { resolveScope } from '@/lib/tenancy'
import { themeFor } from '@/lib/theme'
import { cn, formatDate, formatMoney } from '@/lib/utils'
import { LONG_VACANT_DAYS, vacancyDetails } from '@/server/services/analytics'
import { PageHeader, SectionHeader } from '@/components/app/page-header'
import { StatCard, StatGrid } from '@/components/app/stat-card'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/feedback'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrap,
} from '@/components/ui/table'

export const metadata: Metadata = { title: 'Vacancy' }

const BED_LIST_LIMIT = 50

export default async function VacancyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const user = await requireAccess({ module: 'properties', permission: 'properties.view' })
  const params = await searchParams
  const scope = await resolveScope(user, params.property)
  const v = await vacancyDetails(scope)

  const money = user.modules.includes('rent') && user.permissions.includes('rent.view')
  const leads = user.modules.includes('leads') && user.permissions.includes('leads.view')
  const t = v.totals

  const actions = [
    { href: '/app/beds', label: 'View on bed map', icon: BedDouble, show: true },
    { href: '/app/leads?new=1', label: 'Create enquiry', icon: PhoneCall, show: leads },
    { href: '/app/leads?view=followups', label: 'Leads & follow-ups', icon: ClipboardList, show: leads },
    { href: '/app/bookings?new=1', label: 'Create booking', icon: CalendarPlus, show: leads },
  ].filter((a) => a.show)

  return (
    <div className="space-y-7">
      <PageHeader
        title="Vacancy"
        subtitle="Which beds are empty, for how long, and what that costs you each month."
        icon="bed"
        breadcrumbs={[{ label: 'Dashboard', href: '/app' }, { label: 'Vacancy' }]}
      />

      {money && v.monthlyLoss > 0 && (
        <div className="rounded-xl border border-amber-200/70 bg-amber-50/50 p-4 sm:p-5">
          <p className="flex items-center gap-2 text-sm text-slate-600">
            <TrendingDown className="size-4 text-amber-600" strokeWidth={1.75} />
            Estimated monthly vacancy loss
          </p>
          <p className="font-display text-2xl font-semibold tracking-tight text-amber-700 sm:text-3xl">
            {formatMoney(v.monthlyLoss)}
            <span className="text-base font-medium text-amber-600">/month</span>
          </p>
          <p className="text-xs text-slate-500">
            {t.available} available {t.available === 1 ? 'bed' : 'beds'} × average rent {formatMoney(v.averageRent)} (what
            current residents pay in each PG).
          </p>
        </div>
      )}

      <StatGrid cols={4}>
        <StatCard label="Total beds" value={t.total} icon="bed" hint={`${t.rate}% occupied`} />
        <StatCard label="Occupied" value={t.occupied} icon="user" tone="emerald" />
        <StatCard label="Available" value={t.available} icon="door" tone="amber" hint={v.longVacant ? `${v.longVacant} empty ${LONG_VACANT_DAYS}+ days` : undefined} />
        <StatCard label="Reserved" value={t.reserved} icon="calendar" hint="Held by bookings" />
      </StatGrid>
      <StatGrid cols={4}>
        <StatCard label="Under maintenance" value={t.maintenance} icon="wrench" tone="red" />
        <StatCard label="Blocked" value={t.blocked} icon="warning" tone="red" />
        <StatCard label="Occupancy" value={t.rate} format="percent" icon="chart" />
        {money ? (
          <StatCard label="Avg. rent per bed" value={v.averageRent} format="money" icon="money" tone="emerald" />
        ) : (
          <StatCard label="Rooms with space" value={v.rooms.length} icon="door" tone="emerald" />
        )}
      </StatGrid>

      {actions.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          {actions.map((a) => (
            <Link
              key={a.href}
              href={a.href}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 shadow-xs hover:bg-slate-50"
            >
              <a.icon className="size-4 text-slate-500" />
              {a.label}
            </Link>
          ))}
        </div>
      )}

      {t.total === 0 ? (
        <EmptyState
          icon="bed"
          title="No beds set up yet"
          description="Add rooms and beds to a PG and vacancy shows up here."
        />
      ) : (
        <>
          {/* ---------------------------------------- PG breakdown */}
          {v.byProperty.length > 1 && (
            <section className="space-y-4">
              <SectionHeader title="By PG" description="Every property, same yardstick." icon="building" />
              <TableWrap>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>PG</TableHead>
                      <TableHead className="text-right">Beds</TableHead>
                      <TableHead className="text-right">Occupied</TableHead>
                      <TableHead className="text-right">Available</TableHead>
                      <TableHead className="hidden text-right sm:table-cell">Reserved</TableHead>
                      <TableHead className="hidden text-right sm:table-cell">Maint. / blocked</TableHead>
                      <TableHead className="text-right">Occ.</TableHead>
                      {money && <TableHead className="text-right">Loss / month</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {v.byProperty.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell>
                          <span className="flex items-center gap-2">
                            <span className={cn('size-2 shrink-0 rounded-full', themeFor(p.type).bgSolid)} />
                            <span className="font-medium text-slate-800">{p.name}</span>
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular">{p.total}</TableCell>
                        <TableCell className="text-right tabular">{p.occupied}</TableCell>
                        <TableCell className="text-right font-semibold text-amber-700 tabular">{p.available}</TableCell>
                        <TableCell className="hidden text-right tabular sm:table-cell">{p.reserved}</TableCell>
                        <TableCell className="hidden text-right tabular sm:table-cell">
                          {p.maintenance} / {p.blocked}
                        </TableCell>
                        <TableCell className="text-right tabular">{p.rate}%</TableCell>
                        {money && <TableCell className="text-right tabular">{formatMoney(p.monthlyLoss)}</TableCell>}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableWrap>
            </section>
          )}

          {/* ---------------------------------------- Vacant beds */}
          <section className="space-y-4">
            <SectionHeader
              title="Vacant beds"
              description="Longest empty first — these are the ones to push."
              icon="bed"
            />
            {v.beds.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <p className="text-sm font-medium text-emerald-700">Every bed is filled or reserved.</p>
                  <p className="mt-1 text-sm text-slate-500">No rent is slipping away right now.</p>
                </CardContent>
              </Card>
            ) : (
              <>
                <TableWrap className="hidden md:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Bed</TableHead>
                        <TableHead>PG</TableHead>
                        <TableHead>Floor</TableHead>
                        <TableHead>Empty since</TableHead>
                        <TableHead className="text-right">Days vacant</TableHead>
                        {money && <TableHead className="text-right">Rent</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {v.beds.slice(0, BED_LIST_LIMIT).map((b) => (
                        <TableRow key={b.id}>
                          <TableCell className="font-medium text-slate-800">
                            Room {b.roomNumber} · {b.label}
                          </TableCell>
                          <TableCell>
                            <span className="flex items-center gap-1.5 text-sm text-slate-600">
                              <span className={cn('size-1.5 rounded-full', themeFor(b.propertyType).bgSolid)} />
                              {b.propertyName}
                            </span>
                          </TableCell>
                          <TableCell className="text-sm text-slate-600">{b.floor}</TableCell>
                          <TableCell className="text-sm text-slate-600">{formatDate(b.vacantSince)}</TableCell>
                          <TableCell className="text-right">
                            <DaysBadge days={b.daysVacant} />
                          </TableCell>
                          {money && <TableCell className="text-right tabular">{formatMoney(b.rent)}</TableCell>}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableWrap>
                <ul className="space-y-2 md:hidden">
                  {v.beds.slice(0, BED_LIST_LIMIT).map((b) => (
                    <li key={b.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-900">
                            Room {b.roomNumber} · {b.label}
                          </p>
                          <p className="truncate text-xs text-slate-500">
                            {b.propertyName} · {b.floor}
                          </p>
                        </div>
                        <DaysBadge days={b.daysVacant} />
                      </div>
                      <p className="mt-2 flex justify-between text-xs text-slate-500">
                        <span>Empty since {formatDate(b.vacantSince)}</span>
                        {money && <span className="font-semibold text-slate-800 tabular">{formatMoney(b.rent)}/mo</span>}
                      </p>
                    </li>
                  ))}
                </ul>
                {v.beds.length > BED_LIST_LIMIT && (
                  <p className="text-xs text-slate-500">
                    Showing the {BED_LIST_LIMIT} longest-empty of {v.beds.length} beds.{' '}
                    <Link href="/app/beds" className="font-semibold text-blue-600">
                      See all on the bed map
                    </Link>
                  </p>
                )}
              </>
            )}
          </section>

          {/* ---------------------------------------- Rooms with space */}
          {v.rooms.length > 0 && (
            <section className="space-y-4">
              <SectionHeader title="Rooms with space" description="Ready to show a walk-in today." icon="door" />
              <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {v.rooms.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-xs">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-900">Room {r.number}</p>
                      <p className="truncate text-xs text-slate-500">
                        {r.propertyName} · {r.floor} · {r.type.toLowerCase().replace('_', ' ')}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <Badge variant="warning" size="sm">
                        {r.free} free
                      </Badge>
                      {money && <p className="mt-0.5 text-xs text-slate-500 tabular">from {formatMoney(r.rent)}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}

function DaysBadge({ days }: { days: number }) {
  return (
    <Badge variant={days >= LONG_VACANT_DAYS * 2 ? 'danger' : days >= LONG_VACANT_DAYS ? 'warning' : 'outline'} size="sm">
      {days === 0 ? 'Today' : `${days} ${days === 1 ? 'day' : 'days'}`}
    </Badge>
  )
}
