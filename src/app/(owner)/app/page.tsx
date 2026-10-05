import type { Metadata } from 'next'
import Link from 'next/link'
import {
  ArrowRight,
  Bed,
  Building2,
  ChartNoAxesCombined,
  ClipboardList,
  TrendingDown,
  UserPlus,
  Utensils,
  Wallet,
  Wrench,
} from 'lucide-react'

import { requireOrgUser } from '@/lib/auth'
import { resolveScope } from '@/lib/tenancy'
import { prisma } from '@/lib/prisma'
import {
  collectionBreakdown,
  complaintBreakdown,
  dashboardSummary,
  expenseBreakdown,
  occupancyTrend,
  propertyComparison,
  revenueTrend,
} from '@/server/services/analytics'
import { todaysMealBoard } from '@/server/services/kitchen'
import { lowStockItems } from '@/server/services/kitchen'
import { upcomingVacancies } from '@/server/services/residents'
import { BRAND_THEME, themeFor, CHART_COLORS, COMPLAINT_STATUS_STYLE } from '@/lib/theme'
import { cn, endOfMonth, formatDate, formatMoney, percent, startOfMonth } from '@/lib/utils'
import { PageHeader, SectionHeader } from '@/components/app/page-header'
import { StatCard } from '@/components/app/stat-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge, StatusChip } from '@/components/ui/badge'
import { EmptyState, MotionGrid, MotionItem } from '@/components/ui/feedback'
import {
  CategoryBarChart,
  ComparisonChart,
  DonutChart,
  OccupancyChart,
  RevenueChart,
} from '@/components/app/charts'
import { ActivityTimeline } from '@/components/app/activity-timeline'
import { OccupancyRing } from '@/components/app/occupancy-ring'
import { ICONS, type IconName } from '@/lib/icons'

export const metadata: Metadata = { title: 'Dashboard' }

export default async function OwnerDashboard({
  searchParams,
}: {
  searchParams: Promise<{ property?: string }>
}) {
  const user = await requireOrgUser()
  const params = await searchParams
  const scope = await resolveScope(user, params.property)
  const propertyIds = scope.propertyId ? [scope.propertyId] : scope.allowedPropertyIds

  const activeProperty = scope.propertyId
    ? await prisma.property.findUnique({ where: { id: scope.propertyId } })
    : null
  const theme = activeProperty ? themeFor(activeProperty.type) : BRAND_THEME

  const monthStart = startOfMonth(new Date())
  const monthEnd = endOfMonth(new Date())

  const [
    summary,
    revenue,
    occupancy,
    collection,
    expenses,
    comparison,
    complaints,
    meals,
    lowStock,
    vacancies,
    activity,
    complaintList,
  ] = await Promise.all([
    dashboardSummary(scope),
    revenueTrend(propertyIds, 6),
    occupancyTrend(propertyIds, 30),
    collectionBreakdown(propertyIds),
    expenseBreakdown(propertyIds, monthStart, monthEnd),
    propertyComparison(scope.organizationId, scope.allowedPropertyIds),
    complaintBreakdown(propertyIds),
    todaysMealBoard(propertyIds),
    lowStockItems(propertyIds),
    upcomingVacancies(propertyIds, 30),
    prisma.activityLog.findMany({
      where: { organizationId: scope.organizationId },
      orderBy: { createdAt: 'desc' },
      take: 8,
    }),
    prisma.complaint.findMany({
      where: {
        propertyId: { in: propertyIds },
        status: { in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS'] },
      },
      include: {
        property: { select: { name: true, type: true } },
        room: { select: { number: true } },
        assignedStaff: { select: { name: true } },
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      take: 5,
    }),
  ])

  const noProperties = scope.allowedPropertyIds.length === 0

  if (noProperties) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={`Welcome, ${user.name.split(' ')[0]}`}
          subtitle="Add your first PG and StayFlow starts connecting everything for you."
        />
        <EmptyState
          icon="building"
          title="No PG added yet"
          description="Create a property, add floors, rooms and beds, then check in your first resident. Rent schedules, occupancy and the resident app switch on automatically."
          action={
            <Button variant="primary" asChild>
              <Link href="/app/properties/new">
                <Building2 className="size-4" />
                Add your first PG
              </Link>
            </Button>
          }
          className="py-16"
        />
      </div>
    )
  }

  const collectionRate = percent(collection.paid, collection.total)

  return (
    <div className="space-y-7">
      {/* --------------------------------------------------- Hero header */}
      <div
        className={cn(
          'relative overflow-hidden rounded-3xl bg-gradient-to-br p-6 text-white shadow-elevated sm:p-8',
          theme.gradient,
        )}
      >
        <div className="dot-grid absolute inset-0 opacity-[0.12]" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-2.5 py-0.5 text-[11px] font-medium backdrop-blur">
                <Building2 className="size-3" />
                {activeProperty ? themeFor(activeProperty.type).label : 'All properties'}
              </span>
              <span className="text-xs text-white/60">
                {new Date().toLocaleDateString('en-IN', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                })}
              </span>
            </div>
            <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
              {activeProperty ? activeProperty.name : `${user.organizationName}`}
            </h1>
            <p className="max-w-lg text-sm leading-relaxed text-white/70">
              {summary.residents} residents across {summary.occupancy.total} beds.{' '}
              {summary.pendingRent > 0
                ? `${formatMoney(summary.pendingRent)} still to collect this cycle.`
                : 'Everything billed has been collected.'}
            </p>
          </div>

          <div className="flex items-center gap-6">
            <OccupancyRing
              value={summary.occupancy.rate}
              occupied={summary.occupancy.occupied}
              total={summary.occupancy.total}
            />
            <div className="hidden space-y-2 sm:block">
              <HeroStat label="Collected this month" value={formatMoney(summary.monthCollection)} />
              <HeroStat label="Expected monthly" value={formatMoney(summary.expectedRevenue)} />
              <HeroStat
                label="Open complaints"
                value={`${summary.openComplaints}`}
                tone={summary.openComplaints > 0 ? 'warn' : 'ok'}
              />
            </div>
          </div>
        </div>

        <div className="relative mt-6 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" asChild className="bg-white/95 text-slate-900 hover:bg-white">
            <Link href={`/app/residents/new${scope.propertyId ? `?property=${scope.propertyId}` : ''}`}>
              <UserPlus className="size-4" />
              Check in resident
            </Link>
          </Button>
          <Button size="sm" variant="ghost" asChild className="border border-white/20 text-white hover:bg-white/10 hover:text-white">
            <Link href="/app/rent">
              <Wallet className="size-4" />
              Record payment
            </Link>
          </Button>
          <Button size="sm" variant="ghost" asChild className="border border-white/20 text-white hover:bg-white/10 hover:text-white">
            <Link href="/app/beds">
              <Bed className="size-4" />
              Bed map
            </Link>
          </Button>
        </div>
      </div>

      {/* ----------------------------------------------------- Stat grid */}
      <MotionGrid className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <MotionItem>
          <StatCard
            label="Residents"
            value={summary.residents}
            icon="user"
            tone={theme.key === 'pink' ? 'pink' : 'blue'}
            hint={`${summary.newThisMonth} joined this month`}
            href="/app/residents"
          />
        </MotionItem>
        <MotionItem>
          <StatCard
            label="Occupancy"
            value={summary.occupancy.rate}
            format="percent"
            icon="beds"
            tone="violet"
            hint={`${summary.occupancy.occupied} of ${summary.occupancy.total} beds filled`}
            href="/app/beds"
          />
        </MotionItem>
        <MotionItem>
          <StatCard
            label="Collected this month"
            value={summary.monthCollection}
            format="money"
            icon="money"
            tone="emerald"
            hint={`${summary.monthPayments} payments · ${formatMoney(summary.todayCollection)} today`}
            href="/app/payments"
          />
        </MotionItem>
        <MotionItem>
          <StatCard
            label="Pending rent"
            value={summary.pendingRent + summary.overdueRent}
            format="money"
            icon="warning"
            tone={summary.overdueRent > 0 ? 'red' : 'amber'}
            hint={`${summary.overdueCount} overdue · ${summary.pendingCount} pending`}
            href="/app/rent"
          />
        </MotionItem>
      </MotionGrid>

      <MotionGrid className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <MotionItem>
          <StatCard label="Vacant beds" value={summary.occupancy.available} icon="door" tone="emerald" hint={`${summary.occupancy.reserved} reserved`} href="/app/beds" />
        </MotionItem>
        <MotionItem>
          <StatCard label="Under maintenance" value={summary.occupancy.maintenance + summary.occupancy.blocked} icon="wrench" tone="amber" hint="Beds out of service" href="/app/beds" />
        </MotionItem>
        <MotionItem>
          <StatCard label="Expenses this month" value={summary.monthExpenses} format="money" icon="receipt" tone="red" hint={`Net ${formatMoney(summary.netThisMonth)}`} href="/app/expenses" />
        </MotionItem>
        <MotionItem>
          <StatCard label="Open complaints" value={summary.openComplaints} icon="wrench" tone={summary.urgentComplaints > 0 ? 'red' : 'default'} hint={`${summary.urgentComplaints} high priority`} href="/app/complaints" />
        </MotionItem>
      </MotionGrid>

      {/* ---------------------------------------------- Operations today */}
      <section className="space-y-4">
        <SectionHeader
          title="Today at your PG"
          description="What needs attention right now."
          icon="calendar"
        />
        <div className="grid gap-4 lg:grid-cols-3">
          {/* Rent due today */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Wallet className="size-4 text-amber-500" />
                Rent due today
                {summary.dueToday.length > 0 && (
                  <Badge variant="warning" size="sm">
                    {summary.dueToday.length}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {summary.dueToday.length === 0 ? (
                <p className="py-4 text-sm text-slate-500">
                  No rent falls due today. Reminders go out automatically three days before.
                </p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {summary.dueToday.slice(0, 4).map((invoice) => (
                    <li key={invoice.id}>
                      <Link
                        href={`/app/residents/${invoice.residentId}`}
                        className="flex items-center justify-between gap-3 py-2.5 transition-colors hover:text-blue-700"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-slate-800">
                            {invoice.residentName}
                          </span>
                          <span className="block text-xs text-slate-500">{invoice.number}</span>
                        </span>
                        <span className="shrink-0 text-sm font-semibold text-slate-900 tabular">
                          {formatMoney(invoice.amount)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {summary.dueToday.length > 4 && (
                <Link href="/app/rent" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-blue-600">
                  View all {summary.dueToday.length} <ArrowRight className="size-3" />
                </Link>
              )}
            </CardContent>
          </Card>

          {/* Food counts */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Utensils className="size-4 text-orange-500" />
                Today&apos;s meal count
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              {meals.map((meal) => (
                <div
                  key={meal.type}
                  className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {meal.type.toLowerCase()}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {meal.menus[0]?.menu ?? 'Menu not set'}
                    </p>
                  </div>
                  <p className="shrink-0 font-display text-lg font-semibold text-slate-900 tabular">
                    {meal.expected}
                  </p>
                </div>
              ))}
              <Link href="/app/food" className="inline-flex items-center gap-1 pt-1 text-xs font-semibold text-blue-600">
                Plan meals <ArrowRight className="size-3" />
              </Link>
            </CardContent>
          </Card>

          {/* Ops queue */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <ClipboardList className="size-4 text-violet-500" />
                Needs action
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              <OpsRow
                icon="wrench"
                label="Pending worker tasks"
                value={summary.pendingTasks}
                href="/app/complaints"
                tone={summary.pendingTasks > 0 ? 'amber' : 'ok'}
              />
              <OpsRow
                icon="cart"
                label="Low stock items"
                value={lowStock.length}
                href="/app/grocery"
                tone={lowStock.length > 0 ? 'red' : 'ok'}
              />
              <OpsRow
                icon="door"
                label="Upcoming vacancies (30d)"
                value={vacancies.length}
                href="/app/residents?status=NOTICE"
                tone={vacancies.length > 0 ? 'amber' : 'ok'}
              />
              <OpsRow
                icon="userPlus"
                label="Checked out this month"
                value={summary.checkoutsThisMonth}
                href="/app/residents?status=CHECKED_OUT"
                tone="ok"
              />
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ---------------------------------------------------- Charts row */}
      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <div>
              <CardTitle className="text-sm">Collections vs expenses</CardTitle>
              <p className="text-xs text-slate-500">Last 6 months</p>
            </div>
            <Badge variant="outline" size="sm">
              <ChartNoAxesCombined className="size-3" />
              Live data
            </Badge>
          </CardHeader>
          <CardContent className="pt-2">
            <RevenueChart data={revenue} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">This month&apos;s rent</CardTitle>
            <p className="text-xs text-slate-500">{collectionRate}% collected</p>
          </CardHeader>
          <CardContent className="pt-2">
            <DonutChart
              money
              centerValue={`${collectionRate}%`}
              centerLabel="collected"
              data={[
                { name: 'Paid', value: collection.paid, color: '#10b981' },
                { name: 'Pending', value: collection.pending, color: '#f59e0b' },
                { name: 'Overdue', value: collection.overdue, color: '#ef4444' },
              ]}
            />
            <div className="mt-2 space-y-1.5">
              <LegendRow color="#10b981" label="Paid" value={formatMoney(collection.paid)} />
              <LegendRow color="#f59e0b" label="Pending" value={formatMoney(collection.pending)} />
              <LegendRow color="#ef4444" label="Overdue" value={formatMoney(collection.overdue)} />
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Occupancy trend</CardTitle>
            <p className="text-xs text-slate-500">Last 30 days</p>
          </CardHeader>
          <CardContent className="pt-2">
            <OccupancyChart data={occupancy} color={theme.hex === '#0f172a' ? CHART_COLORS[0] : theme.hex} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Expenses by category</CardTitle>
            <p className="text-xs text-slate-500">This month</p>
          </CardHeader>
          <CardContent className="pt-2">
            <CategoryBarChart data={expenses.slice(0, 6)} color={CHART_COLORS[5]} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Complaints</CardTitle>
            <p className="text-xs text-slate-500">All time by status</p>
          </CardHeader>
          <CardContent className="pt-2">
            <DonutChart
              data={complaints.map((c) => ({
                name: COMPLAINT_STATUS_STYLE[c.status].label,
                value: c.count,
              }))}
              centerValue={String(summary.openComplaints)}
              centerLabel="open now"
            />
          </CardContent>
        </Card>
      </section>

      {/* ------------------------------------------------ PG comparison */}
      {comparison.length > 1 && !scope.propertyId && (
        <section className="space-y-4">
          <SectionHeader title="Your PGs side by side" description="Same month, same metrics." icon="building" />
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardContent className="pt-6">
                <ComparisonChart
                  data={comparison.map((p) => ({
                    name: p.name.replace(/StayFlow\s*/i, ''),
                    collected: p.collection,
                    pending: p.pending,
                    expenses: p.expenses,
                  }))}
                />
              </CardContent>
            </Card>
            <div className="space-y-3">
              {comparison.map((property) => {
                const t = themeFor(property.type)
                return (
                  <Link
                    key={property.id}
                    href={`/app?property=${property.id}`}
                    className="block rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card transition-all hover:shadow-elevated"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-display text-sm font-semibold text-slate-900">
                          {property.name}
                        </p>
                        <p className="text-xs text-slate-500">
                          {property.residents} residents · {property.city}
                        </p>
                      </div>
                      <StatusChip label={t.label} chip={t.chip} />
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                      <MiniMetric label="Occupancy" value={`${property.occupancy.rate}%`} />
                      <MiniMetric label="Collected" value={formatMoney(property.collection, { compact: true })} />
                      <MiniMetric label="Pending" value={formatMoney(property.pending, { compact: true })} />
                    </div>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={cn('h-full rounded-full transition-all', t.bgSolid)}
                        style={{ width: `${property.occupancy.rate}%` }}
                      />
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>
        </section>
      )}

      {/* --------------------------------------- Complaints + activity */}
      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm">Open complaints</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/app/complaints">
                View all <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {complaintList.length === 0 ? (
              <EmptyState
                compact
                icon="wrench"
                title="Nothing open"
                description="Every complaint raised has been resolved."
              />
            ) : (
              <ul className="divide-y divide-slate-100">
                {complaintList.map((complaint) => (
                  <li key={complaint.id}>
                    <Link
                      href={`/app/complaints/${complaint.id}`}
                      className="flex items-start gap-3 py-3 transition-colors hover:bg-slate-50/60"
                    >
                      <span
                        className={cn(
                          'mt-1 flex size-8 shrink-0 items-center justify-center rounded-lg',
                          complaint.priority === 'URGENT' || complaint.priority === 'HIGH'
                            ? 'bg-red-50 text-red-600'
                            : 'bg-slate-100 text-slate-500',
                        )}
                      >
                        <Wrench className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-800">
                          {complaint.title}
                        </span>
                        <span className="block truncate text-xs text-slate-500">
                          {complaint.code} · {complaint.property.name}
                          {complaint.room ? ` · Room ${complaint.room.number}` : ''}
                          {complaint.assignedStaff ? ` · ${complaint.assignedStaff.name}` : ' · unassigned'}
                        </span>
                      </span>
                      <StatusChip
                        label={COMPLAINT_STATUS_STYLE[complaint.status].label}
                        chip={COMPLAINT_STATUS_STYLE[complaint.status].chip}
                        className="mt-0.5 shrink-0"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm">Recent activity</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/app/activity">
                Full log <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            <ActivityTimeline items={activity} compact />
          </CardContent>
        </Card>
      </section>

      {vacancies.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <TrendingDown className="size-4 text-amber-500" />
              Beds freeing up in the next 30 days
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {vacancies.slice(0, 6).map((resident) => (
                <li
                  key={resident.id}
                  className="flex items-center justify-between rounded-xl border border-amber-100 bg-amber-50/50 px-3 py-2"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-slate-800">
                      {resident.fullName}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {resident.bed ? `Room ${resident.bed.room.number} · Bed ${resident.bed.label}` : 'No bed'}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs font-semibold text-amber-700">
                    {formatDate(resident.exitDate)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function HeroStat({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warn' }) {
  return (
    <div className="flex items-center justify-between gap-6 rounded-xl border border-white/15 bg-white/10 px-3 py-1.5 backdrop-blur">
      <span className="text-xs text-white/70">{label}</span>
      <span className={cn('text-sm font-semibold tabular', tone === 'warn' ? 'text-amber-200' : 'text-white')}>
        {value}
      </span>
    </div>
  )
}

function OpsRow({
  icon,
  label,
  value,
  href,
  tone,
}: {
  icon: IconName
  label: string
  value: number
  href: string
  tone: 'ok' | 'amber' | 'red'
}) {
  const Icon = ICONS[icon]
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-xl border border-slate-100 px-3 py-2 transition-colors hover:bg-slate-50"
    >
      <Icon
        className={cn(
          'size-4 shrink-0',
          tone === 'red' ? 'text-red-500' : tone === 'amber' ? 'text-amber-500' : 'text-slate-400',
        )}
      />
      <span className="min-w-0 flex-1 truncate text-sm text-slate-600">{label}</span>
      <span
        className={cn(
          'shrink-0 font-display text-sm font-semibold tabular',
          tone === 'red' ? 'text-red-600' : tone === 'amber' ? 'text-amber-600' : 'text-slate-700',
        )}
      >
        {value}
      </span>
    </Link>
  )
}

function LegendRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="size-2 rounded-full" style={{ background: color }} />
      <span className="text-slate-500">{label}</span>
      <span className="ml-auto font-semibold text-slate-800 tabular">{value}</span>
    </div>
  )
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-1.5 py-1.5">
      <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className="font-display text-sm font-semibold text-slate-900 tabular">{value}</p>
    </div>
  )
}
