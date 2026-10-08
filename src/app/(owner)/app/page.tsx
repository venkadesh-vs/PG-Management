import type { Metadata } from 'next'
import { orgAuditWhere } from '@/server/services/audit-log'
import { parseAuditFilters } from '@/lib/audit-filters'
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

import { redirect } from 'next/navigation'

import { requireOrgUser } from '@/lib/auth'
import { OWNER_NAV, filterNavSections } from '@/lib/navigation'
import { resolveScope } from '@/lib/tenancy'
import { prisma } from '@/lib/prisma'
import {
  attentionSummary,
  collectionBreakdown,
  complaintBreakdown,
  dashboardSummary,
  expenseBreakdown,
  occupancyTrend,
  propertyComparison,
  revenueTrend,
  vacancyIntelligence,
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
import { Onboarding } from './onboarding'
import { shouldStartSetup } from '@/server/services/onboarding'
import { AttentionPanel } from './attention-panel'
import { VacancyCard } from './vacancy-card'
import { ElectricityCard } from './electricity-card'
import { electricitySummary } from '@/server/services/electricity'

export const metadata: Metadata = { title: 'Dashboard' }

export default async function OwnerDashboard({
  searchParams,
}: {
  searchParams: Promise<{ property?: string }>
}) {
  const user = await requireOrgUser()
  // A brand-new owner starts in the setup wizard (first visit only).
  if (await shouldStartSetup(user)) redirect('/app/setup')
  const has = (p: string) => user.permissions.includes(p)
  const on = (m: string) => (user.modules as string[]).includes(m)

  // No dashboard for this person: send them to the first page they can use.
  if (!on('dashboard') || !has('dashboard.view')) {
    const first = filterNavSections(OWNER_NAV, user)
      .flatMap((s) => s.items)
      .find((i) => i.href !== '/app' && i.href !== '/app/notifications')
    redirect(first?.href ?? '/app/no-access')
  }

  const show = {
    money: has('rent.view'),
    recordPayment: has('payments.record'),
    checkIn: has('residents.manage'),
    residents: has('residents.view'),
    beds: has('properties.view'),
    expenses: on('expenses') && has('expenses.view'),
    complaints: on('complaints') && has('complaints.view'),
    food: on('food') && has('food.view'),
    grocery: on('grocery') && has('grocery.view'),
    activity: on('activity') && has('activity.view'),
    leads: on('leads') && has('leads.view'),
  }
  const skip = <T,>(cond: boolean, run: () => Promise<T>, empty: T) => (cond ? run() : Promise.resolve(empty))

  const params = await searchParams
  const scope = await resolveScope(user, params.property)
  const propertyIds = scope.propertyId ? [scope.propertyId] : scope.allowedPropertyIds

  const activeProperty = scope.propertyId
    ? await prisma.property.findUnique({ where: { id: scope.propertyId } })
    : null
  const theme = activeProperty ? themeFor(activeProperty.type) : BRAND_THEME

  const monthStart = startOfMonth(new Date())
  const monthEnd = endOfMonth(new Date())

  // "Needs attention" shows only what this person can see and act on.
  const attentionFlags = {
    rent: show.money,
    complaints: show.complaints,
    beds: show.beds,
    grocery: show.grocery,
    bookings: show.leads,
    leads: show.leads,
    residents: show.residents,
    requests: user.modules.includes('requests') && (user.role === 'OWNER' || user.permissions.includes('requests.view')),
  }

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
    attention,
    vacancy,
  ] = await Promise.all([
    dashboardSummary(scope),
    revenueTrend(propertyIds, 6),
    occupancyTrend(propertyIds, 30),
    collectionBreakdown(propertyIds),
    skip(show.expenses, () => expenseBreakdown(propertyIds, monthStart, monthEnd), []),
    propertyComparison(scope.organizationId, scope.allowedPropertyIds),
    skip(show.complaints, () => complaintBreakdown(propertyIds), []),
    skip(show.food, () => todaysMealBoard(propertyIds), []),
    skip(show.grocery, () => lowStockItems(propertyIds), []),
    upcomingVacancies(propertyIds, 30),
    skip(
      show.activity,
      () =>
        // Same rule as the Activity page: the picked PG (or the PGs this
        // person may see) plus account-wide entries.
        prisma.activityLog.findMany({
          where: orgAuditWhere(user, scope, parseAuditFilters({ range: 'all' })),
          orderBy: { createdAt: 'desc' },
          take: 8,
        }),
      [],
    ),
    !show.complaints ? Promise.resolve([]) : prisma.complaint.findMany({
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
    attentionSummary(scope, attentionFlags),
    skip(show.money, () => vacancyIntelligence(scope), null),
  ])

  const electricity =
    user.modules.includes('electricity') && (user.role === 'OWNER' || user.permissions.includes('electricity.view'))
      ? await electricitySummary(user, scope.propertyId)
      : null

  const noProperties = scope.allowedPropertyIds.length === 0

  if (noProperties) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={`Welcome, ${user.name.split(' ')[0]}`}
          subtitle="Add your first PG and StayFlow starts connecting everything for you."
        />
        <Onboarding user={user} />
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

  const firstName = user.name.split(' ')[0]
  const outstanding = summary.pendingRent + summary.overdueRent
  // The current month is the last bucket of the 6-month trend.
  const billedThisMonth = revenue.at(-1)?.billed ?? 0

  return (
    <div className="space-y-7">
      {/* ------------------------------------------------ Greeting (§22) */}
      <header className="space-y-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
          {greetingIST()}, {firstName}
        </h1>
        <p className="text-sm text-slate-500">Here&apos;s what needs your attention today.</p>
      </header>

      <AttentionPanel counts={attention} flags={attentionFlags} propertyId={scope.propertyId} />

      <Onboarding user={user} />

      {/* ----------------------------------------------- KPI row (§22) */}
      <MotionGrid
        className={cn(
          'grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4',
          show.money && show.expenses ? 'xl:grid-cols-6' : show.money ? 'xl:grid-cols-4' : 'xl:grid-cols-2',
        )}
      >
        <MotionItem>
          <StatCard
            label="Occupancy"
            value={summary.occupancy.rate}
            format="percent"
            icon="beds"
            hint={`${summary.occupancy.occupied} of ${summary.occupancy.total} beds`}
            href="/app/beds"
          />
        </MotionItem>
        {show.money && (
          <>
            <MotionItem>
              <StatCard
                label="Collection"
                value={summary.monthCollection}
                format="money"
                icon="money"
                hint={`This month · ${formatMoney(summary.todayCollection)} today`}
                href="/app/payments"
              />
            </MotionItem>
            <MotionItem>
              <StatCard
                label="Outstanding"
                value={outstanding}
                format="money"
                icon="warning"
                tone={summary.overdueRent > 0 ? 'red' : 'amber'}
                hint={`${summary.overdueCount} overdue · ${summary.pendingCount} pending`}
                href="/app/rent"
              />
            </MotionItem>
            <MotionItem>
              <StatCard
                label="Revenue"
                value={billedThisMonth}
                format="money"
                icon="chart"
                hint={`Billed this month · ${formatMoney(summary.expectedRevenue)} expected`}
                href="/app/rent"
              />
            </MotionItem>
          </>
        )}
        {show.expenses && (
          <MotionItem>
            <StatCard
              label="Expenses"
              value={summary.monthExpenses}
              format="money"
              icon="receipt"
              hint="This month"
              href="/app/expenses"
            />
          </MotionItem>
        )}
        {show.expenses && show.money && (
          <MotionItem>
            <StatCard
              label="Profit"
              value={summary.netThisMonth}
              format="money"
              icon="cash"
              tone={summary.netThisMonth >= 0 ? 'emerald' : 'red'}
              hint="Collected minus expenses"
            />
          </MotionItem>
        )}
      </MotionGrid>

      <section className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
      {/* --------------------------------------------------- Hero header */}
      <div
        className={cn(
          'relative overflow-hidden rounded-xl border border-slate-200 bg-white p-5 shadow-xs sm:p-6',
          vacancy ? 'lg:col-span-2' : 'lg:col-span-3',
        )}
      >
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                <Building2 className="size-3" strokeWidth={1.75} />
                {activeProperty ? themeFor(activeProperty.type).label : 'All properties'}
              </span>
              <span className="text-xs text-slate-500">
                {new Date().toLocaleDateString('en-IN', {
                  timeZone: 'Asia/Kolkata',
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                })}
              </span>
            </div>
            <h2 className="truncate font-display text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
              {activeProperty ? activeProperty.name : `${user.organizationName}`}
            </h2>
            <p className="max-w-lg text-sm leading-relaxed text-slate-500">
              {summary.residents} residents across {summary.occupancy.total} beds.{' '}
              {show.money &&
                (summary.pendingRent > 0
                  ? `${formatMoney(summary.pendingRent)} still to collect this cycle.`
                  : 'Everything billed has been collected.')}
            </p>
          </div>

          <div className="flex items-center gap-6">
            <OccupancyRing
              value={summary.occupancy.rate}
              occupied={summary.occupancy.occupied}
              total={summary.occupancy.total}
              onDark={false}
              size={112}
            />
            <div className="hidden min-w-[15rem] space-y-1.5 sm:block">
              {show.money && (
                <>
                  <HeroStat label="Collected this month" value={formatMoney(summary.monthCollection)} />
                  <HeroStat label="Expected monthly" value={formatMoney(summary.expectedRevenue)} />
                </>
              )}
              {show.complaints && (
                <HeroStat
                  label="Open complaints"
                  value={`${summary.openComplaints}`}
                  tone={summary.openComplaints > 0 ? 'warn' : 'ok'}
                />
              )}
            </div>
          </div>
        </div>

        <div className="relative mt-6 flex flex-wrap gap-2">
          {show.checkIn && (
            <Button size="sm" variant="primary" asChild>
              <Link href={`/app/residents/new${scope.propertyId ? `?property=${scope.propertyId}` : ''}`}>
                <UserPlus className="size-4" />
                Check in resident
              </Link>
            </Button>
          )}
          {show.recordPayment && (
            <Button size="sm" variant="outline" asChild>
              <Link href="/app/rent">
                <Wallet className="size-4" />
                Record payment
              </Link>
            </Button>
          )}
          {show.beds && (
            <Button size="sm" variant="outline" asChild>
              <Link href="/app/beds">
                <Bed className="size-4" />
                Bed map
              </Link>
            </Button>
          )}
        </div>
      </div>

        {vacancy && <VacancyCard insight={vacancy} showPerProperty={!scope.propertyId} />}
      </section>

      {electricity && electricity.activeMeters > 0 && <ElectricityCard summary={electricity} />}

      <MotionGrid className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <MotionItem>
          <StatCard label="Vacant beds" value={summary.occupancy.available} icon="door" hint={`${summary.occupancy.reserved} reserved`} href="/app/beds" />
        </MotionItem>
        <MotionItem>
          <StatCard label="Under maintenance" value={summary.occupancy.maintenance + summary.occupancy.blocked} icon="wrench" hint="Beds out of service" href="/app/beds" />
        </MotionItem>
        <MotionItem>
          <StatCard
            label="Residents"
            value={summary.residents}
            icon="user"
            hint={`${summary.newThisMonth} joined this month`}
            href="/app/residents"
          />
        </MotionItem>
        {show.complaints && (
          <MotionItem>
            <StatCard label="Open complaints" value={summary.openComplaints} icon="wrench" tone={summary.urgentComplaints > 0 ? 'red' : 'default'} hint={`${summary.urgentComplaints} high priority`} href="/app/complaints" />
          </MotionItem>
        )}
      </MotionGrid>

      {/* ---------------------------------------------- Operations today */}
      <section className="space-y-4">
        <SectionHeader
          title="Today at your PG"
          description="Rent due, meals and the day's queue."
          icon="calendar"
        />
        <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
          {/* Rent due today */}
          {show.money && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Wallet className="size-4 text-slate-400" strokeWidth={1.75} />
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
          )}

          {/* Food counts */}
          {show.food && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Utensils className="size-4 text-slate-400" strokeWidth={1.75} />
                Today&apos;s meal count
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              {meals.map((meal) => (
                <div
                  key={meal.type}
                  className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-medium capitalize text-slate-600">
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
          )}

          {/* Ops queue */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <ClipboardList className="size-4 text-slate-400" strokeWidth={1.75} />
                Needs action
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              {show.complaints && (
                <OpsRow
                  icon="wrench"
                  label="Pending worker tasks"
                  value={summary.pendingTasks}
                  href="/app/complaints"
                  tone={summary.pendingTasks > 0 ? 'amber' : 'ok'}
                />
              )}
              {show.grocery && (
                <OpsRow
                  icon="cart"
                  label="Low stock items"
                  value={lowStock.length}
                  href="/app/grocery"
                  tone={lowStock.length > 0 ? 'red' : 'ok'}
                />
              )}
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
      {show.money && (
      <section className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
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
                { name: 'Overdue', value: collection.overdue, color: '#f43f5e' },
              ]}
            />
            <div className="mt-2 space-y-1.5">
              <LegendRow color="#10b981" label="Paid" value={formatMoney(collection.paid)} />
              <LegendRow color="#f59e0b" label="Pending" value={formatMoney(collection.pending)} />
              <LegendRow color="#f43f5e" label="Overdue" value={formatMoney(collection.overdue)} />
            </div>
          </CardContent>
        </Card>
      </section>
      )}

      <section className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Occupancy trend</CardTitle>
            <p className="text-xs text-slate-500">Last 30 days</p>
          </CardHeader>
          <CardContent className="pt-2">
            <OccupancyChart data={occupancy} color={theme.hex === '#0f172a' ? CHART_COLORS[0] : theme.hex} />
          </CardContent>
        </Card>

        {show.expenses && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Expenses by category</CardTitle>
            <p className="text-xs text-slate-500">This month</p>
          </CardHeader>
          <CardContent className="pt-2">
            <CategoryBarChart data={expenses.slice(0, 6)} color={CHART_COLORS[5]} />
          </CardContent>
        </Card>
        )}

        {show.complaints && (
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
        )}
      </section>

      {/* ------------------------------------------------ PG comparison */}
      {show.money && comparison.length > 1 && !scope.propertyId && (
        <section className="space-y-4">
          <SectionHeader
            title="Your PGs side by side"
            description="Same month, same metrics."
            icon="building"
            actions={
              <Link href="/app/reports#pg-performance" className="text-sm font-medium text-blue-700 hover:underline">
                Full comparison
              </Link>
            }
          />
          <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
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
                    className="block rounded-xl border border-slate-200 bg-white p-4 shadow-xs transition-colors hover:border-slate-300"

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
      <section className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        {show.complaints && (
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
                            ? 'bg-rose-50 text-rose-600'
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
        )}

        {show.activity && (
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
        )}
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

/** Time-of-day greeting in India time, whatever the server's timezone. */
function greetingIST() {
  const hour = Number(
    new Intl.DateTimeFormat('en-IN', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Kolkata' }).format(new Date()),
  )
  if (hour >= 5 && hour < 12) return 'Good morning'
  if (hour >= 12 && hour < 17) return 'Good afternoon'
  return 'Good evening'
}

function HeroStat({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warn' }) {
  return (
    <div className="flex items-center justify-between gap-6 rounded-lg bg-slate-50 px-3 py-1.5">
      <span className="text-xs text-slate-500">{label}</span>
      <span className={cn('text-sm font-semibold tabular', tone === 'warn' ? 'text-amber-700' : 'text-slate-900')}>
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
      className="flex items-center gap-3 rounded-lg border border-slate-100 px-3 py-2 transition-colors hover:bg-slate-50"
    >
      <Icon className="size-4 shrink-0 text-slate-400" strokeWidth={1.75} />
      <span className="min-w-0 flex-1 truncate text-sm text-slate-600">{label}</span>
      {tone !== 'ok' && value > 0 && (
        <span className={cn('size-1.5 shrink-0 rounded-full', tone === 'red' ? 'bg-rose-500' : 'bg-amber-500')} />
      )}
      <span className="shrink-0 text-sm font-semibold text-slate-900 tabular">{value}</span>
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
      <p className="text-[11px] text-slate-500">{label}</p>

      <p className="font-display text-sm font-semibold text-slate-900 tabular">{value}</p>
    </div>
  )
}
