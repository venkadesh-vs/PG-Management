import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, Building2, TrendingUp } from 'lucide-react'
import { requireSuperAdmin } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { platformMetrics } from '@/server/services/subscriptions'
import { getPlatformKpis } from '@/server/services/platform-metrics'
import { CHART_COLORS, SUBSCRIPTION_STATUS_STYLE, themeFor } from '@/lib/theme'
import { LEAD_PIPELINE, LEAD_SIDE, leadStyle } from './leads/lead-meta'
import { addDays, addMonths, cn, formatDate, formatMoney, relativeTime, startOfMonth } from '@/lib/utils'
import { PageHeader, SectionHeader } from '@/components/app/page-header'
import { StatCard } from '@/components/app/stat-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge, StatusChip } from '@/components/ui/badge'
import { EmptyState, MotionGrid, MotionItem } from '@/components/ui/feedback'
import { CategoryBarChart, DonutChart, RevenueChart } from '@/components/app/charts'
import { ActivityTimeline } from '@/components/app/activity-timeline'

export const metadata: Metadata = { title: 'Platform' }

export default async function AdminDashboard() {
  await requireSuperAdmin()

  const [metrics, organizations, expiring, failed, leads, activity, invoices, orgStatuses, kpis] =
    await Promise.all([
      platformMetrics(),
      prisma.organization.findMany({
        where: { archivedAt: null },
        include: {
          _count: { select: { properties: true, residents: true } },
          subscriptions: { select: { amount: true, status: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 6,
      }),
      prisma.subscription.findMany({
        where: {
          OR: [
            { status: 'TRIALING', trialEndsAt: { lte: addDays(new Date(), 7) } },
            { status: { in: ['GRACE', 'PAST_DUE'] } },
          ],
        },
        include: {
          organization: { select: { id: true, name: true } },
          property: { select: { name: true, type: true } },
        },
        take: 8,
      }),
      prisma.subscriptionPayment.findMany({
        where: { status: 'FAILED' },
        include: {
          subscription: {
            select: {
              organization: { select: { id: true, name: true } },
              property: { select: { name: true } },
            },
          },
        },
        orderBy: { attemptedAt: 'desc' },
        take: 5,
      }),
      prisma.lead.findMany({
        where: { status: { in: ['NEW', 'CONTACTED', 'DEMO_SCHEDULED', 'FOLLOW_UP'] } },
        orderBy: { createdAt: 'desc' },
        take: 6,
      }),
      prisma.activityLog.findMany({
        where: {
          event: {
            in: [
              'SUBSCRIPTION_CREATED',
              'SUBSCRIPTION_PAYMENT_COMPLETED',
              'SUBSCRIPTION_PAYMENT_FAILED',
              'PROPERTY_CREATED',
              'LEAD_CREATED',
            ],
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
      prisma.subscriptionInvoice.findMany({
        where: { issueDate: { gte: startOfMonth(addMonths(new Date(), -5)) } },
        select: { total: true, amountPaid: true, issueDate: true, status: true },
      }),
      prisma.organization.groupBy({
        by: ['status'],
        where: { archivedAt: null },
        _count: { _all: true },
      }),
      getPlatformKpis(),
    ])

  // Six-month platform revenue, billed vs collected.
  const months = Array.from({ length: 6 }, (_, i) => startOfMonth(addMonths(new Date(), -(5 - i))))
  const revenue = months.map((month) => {
    const rows = invoices.filter(
      (inv) => startOfMonth(inv.issueDate).getTime() === month.getTime(),
    )
    return {
      month: month.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }),
      billed: rows.reduce((s, r) => s + r.total, 0),
      collected: rows.reduce((s, r) => s + r.amountPaid, 0),
      expenses: 0,
    }
  })

  const topOrgs = organizations
    .map((org) => ({
      name: org.name,
      amount: org.subscriptions
        .filter((s) => s.status === 'ACTIVE')
        .reduce((s, sub) => s + sub.amount, 0),
    }))
    .filter((o) => o.amount > 0)
    .sort((a, b) => b.amount - a.amount)

  return (
    <div className="space-y-7">
      <PageHeader
        title="Platform"
        subtitle="Every organization, PG and subscription running on StayFlow."
        icon="gauge"
      />

      {/* ------------------------------------------------------ Headline */}
      <MotionGrid className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <MotionItem>
          <StatCard
            label="Monthly recurring revenue"
            value={kpis.mrr}
            format="money"
            icon="sparkles"
            tone="violet"
            hint={`${kpis.activeSubscriptions} active subscriptions`}
            href="/admin/subscriptions"
          />
        </MotionItem>
        <MotionItem>
          <StatCard
            label="Annual run rate"
            value={kpis.arr}
            format="moneyCompact"
            icon="chart"
            tone="blue"
            hint="MRR × 12"
          />
        </MotionItem>
        <MotionItem>
          <StatCard
            label="Customers"
            value={kpis.customers.total}
            icon="building"
            tone="emerald"
            hint={`${kpis.customers.active} active · ${kpis.customers.trial} on trial`}
            href="/admin/organizations"
          />
        </MotionItem>
        <MotionItem>
          <StatCard
            label="New this month"
            value={kpis.customers.newThisMonth}
            icon="userPlus"
            tone="pink"
            hint="Accounts created since the 1st"
          />
        </MotionItem>
      </MotionGrid>

      <MotionGrid className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <MotionItem>
          <StatCard
            label="Churn (30 days)"
            value={kpis.churn.rate}
            format="percent"
            icon="trendingDown"
            tone={kpis.churn.churned ? 'red' : 'emerald'}
            hint={`${kpis.churn.churned} of ${kpis.churn.activeAtStart} paying customers left`}
          />
        </MotionItem>
        <MotionItem>
          <StatCard
            label="Trials ending in 7 days"
            value={kpis.trialsEndingSoon}
            icon="clock"
            tone={kpis.trialsEndingSoon ? 'amber' : 'default'}
            hint={`${metrics.trials} subscriptions on trial`}
            href="/admin/organizations?status=TRIAL"
          />
        </MotionItem>
        <MotionItem>
          <StatCard
            label="Failed payments (30 days)"
            value={kpis.failedPayments30d}
            icon="card"
            tone={kpis.failedPayments30d ? 'red' : 'emerald'}
            hint={`${metrics.failedPayments} in total`}
            href="/admin/payments"
          />
        </MotionItem>
        <MotionItem>
          <StatCard
            label="Follow-ups due"
            value={kpis.followUps.due}
            icon="clipboard"
            tone={kpis.followUps.overdue ? 'red' : kpis.followUps.due ? 'amber' : 'emerald'}
            hint={
              kpis.followUps.overdue
                ? `${kpis.followUps.overdue} overdue · ${kpis.followUps.today} today`
                : `${kpis.followUps.today} due today`
            }
            href="/admin/leads?due=due&sort=followup&view=table"
          />
        </MotionItem>
      </MotionGrid>

      <MotionGrid className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <MotionItem>
          <StatCard
            label="Residents managed"
            value={metrics.residents}
            icon="users"
            tone="emerald"
            hint={`${metrics.properties} PGs · ${metrics.beds} beds · ${metrics.occupancyRate}% occupied`}
          />
        </MotionItem>
        <MotionItem>
          <StatCard
            label="Pending collection"
            value={metrics.pendingAmount}
            format="money"
            icon="warning"
            tone={metrics.pendingAmount > 0 ? 'amber' : 'emerald'}
            hint={`${metrics.pendingCount} unpaid invoices`}
            href="/admin/payments"
          />
        </MotionItem>
        <MotionItem>
          <StatCard
            label="Past due"
            value={metrics.pastDue}
            icon="warning"
            tone={metrics.pastDue ? 'red' : 'emerald'}
            hint="In grace or overdue"
          />
        </MotionItem>
        <MotionItem>
          <StatCard
            label="Suspended / cancelled"
            value={kpis.customers.suspended + kpis.customers.cancelled}
            icon="shield"
            tone={kpis.customers.suspended ? 'amber' : 'default'}
            hint={`${kpis.customers.suspended} suspended · ${kpis.customers.cancelled} cancelled`}
            href="/admin/organizations?status=SUSPENDED"
          />
        </MotionItem>
      </MotionGrid>

      {/* -------------------------------------------------- Growth trends */}
      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">MRR trend</CardTitle>
            <p className="text-xs text-slate-500">Monthly recurring revenue at each month end</p>
          </CardHeader>
          <CardContent className="pt-2">
            <CategoryBarChart
              layout="horizontal"
              color={CHART_COLORS[4]}
              height={220}
              data={kpis.trends.map((t) => ({ name: t.month, amount: t.mrr }))}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">New customers</CardTitle>
            <p className="text-xs text-slate-500">Accounts created per month</p>
          </CardHeader>
          <CardContent className="pt-2">
            <CategoryBarChart
              layout="horizontal"
              money={false}
              color={CHART_COLORS[2]}
              height={220}
              data={kpis.trends.map((t) => ({ name: t.month, amount: t.newCustomers }))}
            />
          </CardContent>
        </Card>
      </section>

      {/* ------------------------------------------------ Sales pipeline */}
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
          <div>
            <CardTitle className="text-sm">Sales pipeline</CardTitle>
            <p className="text-xs text-slate-500">Leads by stage</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {kpis.followUps.overdue > 0 && (
              <Link href="/admin/leads?due=overdue&sort=followup&view=table">
                <Badge variant="danger" size="sm">
                  {kpis.followUps.overdue} overdue
                </Badge>
              </Link>
            )}
            {kpis.followUps.today > 0 && (
              <Link href="/admin/leads?due=today&sort=followup&view=table">
                <Badge variant="warning" size="sm">
                  {kpis.followUps.today} due today
                </Badge>
              </Link>
            )}
            <Link href="/admin/leads" className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600">
              Open CRM <ArrowRight className="size-3" />
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {[...LEAD_PIPELINE, ...LEAD_SIDE].map((stage) => {
              const style = leadStyle(stage)
              return (
                <li key={stage}>
                  <Link
                    href={`/admin/leads?status=${stage}`}
                    className="block rounded-xl border border-slate-200 bg-white px-3 py-2 transition-colors hover:border-blue-300"
                  >
                    <p className="flex items-center gap-1.5 truncate text-[11px] text-slate-500">
                      <span className={cn('size-1.5 shrink-0 rounded-full', style.dot)} />
                      {style.label}
                    </p>
                    <p className="font-display text-lg font-semibold text-slate-900 tabular">
                      {kpis.leadsByStage[stage] ?? 0}
                    </p>
                  </Link>
                </li>
              )
            })}
          </ul>
        </CardContent>
      </Card>

      {/* -------------------------------------------------------- Charts */}
      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Subscription revenue</CardTitle>
            <p className="text-xs text-slate-500">Billed vs collected, last 6 months</p>
          </CardHeader>
          <CardContent className="pt-2">
            <RevenueChart
              data={revenue.map((r) => ({
                month: r.month,
                collected: r.collected,
                expenses: 0,
                billed: r.billed,
              }))}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Accounts by status</CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            <DonutChart
              centerValue={String(metrics.organizations)}
              centerLabel="organizations"
              data={orgStatuses.map((s) => ({
                name: s.status.replace('_', ' ').toLowerCase(),
                value: s._count._all,
              }))}
            />
          </CardContent>
        </Card>
      </section>

      {/* ---------------------------------------------- Needs attention */}
      {(expiring.length > 0 || failed.length > 0) && (
        <section className="grid gap-4 lg:grid-cols-2">
          {expiring.length > 0 && (
            <Card className="border-amber-200">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Needs attention</CardTitle>
                <p className="text-xs text-slate-500">
                  Trials ending soon and subscriptions in grace
                </p>
              </CardHeader>
              <CardContent>
                <ul className="divide-y divide-slate-100">
                  {expiring.map((sub) => {
                    const theme = themeFor(sub.property.type)
                    const style = SUBSCRIPTION_STATUS_STYLE[sub.status]
                    return (
                      <li key={sub.id}>
                        <Link
                          href={`/admin/organizations/${sub.organization.id}`}
                          className="flex items-center justify-between gap-3 py-2.5 hover:text-blue-700"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-slate-800">
                              {sub.organization.name}
                            </p>
                            <p className="flex items-center gap-1.5 text-xs text-slate-500">
                              <span className={cn('size-1.5 rounded-full', theme.bgSolid)} />
                              {sub.property.name} ·{' '}
                              {sub.status === 'TRIALING'
                                ? `trial ends ${formatDate(sub.trialEndsAt)}`
                                : `grace ends ${formatDate(sub.graceEndsAt)}`}
                            </p>
                          </div>
                          <StatusChip label={style.label} chip={style.chip} />
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </CardContent>
            </Card>
          )}

          {failed.length > 0 && (
            <Card className="border-red-200">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Failed payments</CardTitle>
                <p className="text-xs text-slate-500">AutoPay attempts that did not go through</p>
              </CardHeader>
              <CardContent>
                <ul className="divide-y divide-slate-100">
                  {failed.map((payment) => (
                    <li key={payment.id} className="flex items-start justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-800">
                          {payment.subscription.organization.name}
                        </p>
                        <p className="truncate text-xs text-slate-500">
                          {payment.subscription.property.name} · {payment.failureReason}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-semibold text-red-600 tabular">
                          {formatMoney(payment.amount)}
                        </p>
                        {payment.isDemo && (
                          <Badge variant="warning" size="sm">
                            Demo
                          </Badge>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </section>
      )}

      {/* ------------------------------------------------ Organizations */}
      <section className="space-y-4">
        <SectionHeader
          title="Organizations"
          description="The most recently onboarded accounts."
          icon="building"
          actions={
            <Link
              href="/admin/organizations"
              className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600"
            >
              View all <ArrowRight className="size-3" />
            </Link>
          }
        />
        {organizations.length === 0 ? (
          <EmptyState icon="building" title="No organizations yet" description="Converted leads appear here." />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {organizations.map((org) => {
              const mrr = org.subscriptions
                .filter((s) => s.status === 'ACTIVE')
                .reduce((s, sub) => s + sub.amount, 0)
              return (
                <Link key={org.id} href={`/admin/organizations/${org.id}`}>
                  <Card className="transition-shadow hover:shadow-elevated">
                    <CardContent className="flex items-center gap-3 p-4">
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-slate-100">
                        <Building2 className="size-5 text-slate-500" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-900">{org.name}</p>
                        <p className="truncate text-xs text-slate-500">
                          {org.ownerName} · {org._count.properties} PGs ·{' '}
                          {org._count.residents} residents
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-semibold text-slate-900 tabular">
                          {mrr > 0 ? `${formatMoney(mrr)}/mo` : '—'}
                        </p>
                        <Badge
                          variant={
                            org.status === 'ACTIVE'
                              ? 'success'
                              : org.status === 'TRIAL'
                                ? 'info'
                                : 'warning'
                          }
                          size="sm"
                        >
                          {org.status.replace('_', ' ').toLowerCase()}
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              )
            })}
          </div>
        )}
      </section>

      {/* ---------------------------------------------- Leads + activity */}
      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm">Open enquiries</CardTitle>
            <Link
              href="/admin/leads"
              className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600"
            >
              All leads <ArrowRight className="size-3" />
            </Link>
          </CardHeader>
          <CardContent>
            {leads.length === 0 ? (
              <EmptyState
                compact
                icon="clipboard"
                title="No open enquiries"
                description="Demo requests from the website land here."
              />
            ) : (
              <ul className="divide-y divide-slate-100">
                {leads.map((lead) => {
                  const style = leadStyle(lead.status)
                  return (
                    <li key={lead.id}>
                      <Link
                        href="/admin/leads"
                        className="flex items-center justify-between gap-3 py-2.5 hover:text-blue-700"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-800">{lead.name}</p>
                          <p className="truncate text-xs text-slate-500">
                            {lead.pgName ?? 'PG'} · {lead.city ?? '—'} · {lead.pgCount} PG
                            {lead.pgCount === 1 ? '' : 's'}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="text-[11px] text-slate-400">
                            {relativeTime(lead.createdAt)}
                          </span>
                          <StatusChip label={style.label} chip={style.chip} />
                        </div>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm">Platform activity</CardTitle>
            <Link
              href="/admin/audit"
              className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600"
            >
              Audit log <ArrowRight className="size-3" />
            </Link>
          </CardHeader>
          <CardContent>
            <ActivityTimeline items={activity} compact />
          </CardContent>
        </Card>
      </section>

      {topOrgs.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <TrendingUp className="size-4 text-slate-400" />
              Revenue by organization
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            <CategoryBarChart
              data={topOrgs.map((o) => ({ name: o.name, amount: o.amount }))}
              color={CHART_COLORS[4]}
              height={Math.max(160, topOrgs.length * 44)}
            />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
