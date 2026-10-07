import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { requireSuperAdmin } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { SUBSCRIPTION_STATUS_STYLE, themeFor } from '@/lib/theme'
import { cn, formatDate, formatMoney } from '@/lib/utils'
import { platformMetrics } from '@/server/services/subscriptions'
import { PageHeader } from '@/components/app/page-header'
import { StatCard } from '@/components/app/stat-card'
import { Badge, StatusChip } from '@/components/ui/badge'
import { EmptyState, TableSkeleton } from '@/components/ui/feedback'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrap,
} from '@/components/ui/table'
import { FilterBar, FilterSelect, SearchInput } from '@/components/app/filters'
import { RunBillingButton } from './run-billing-button'
import { SubscriptionAdminActions } from './subscription-actions'
import { CYCLE_LABEL, STATUS_WORDS, type SubStatus } from '@/lib/subscription-math'

export const metadata: Metadata = { title: 'Subscriptions' }

export default async function AdminSubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  await requireSuperAdmin()
  const params = await searchParams
  const q = params.q?.trim() ?? ''
  const status = params.status
  const planFilter = params.plan
  const cycle = params.cycle
  const CYCLES = ['MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY'] as const

  const [subscriptions, metrics, plans] = await Promise.all([
    prisma.subscription.findMany({
      where: {
        ...(status ? { status: status as never } : {}),
        ...(planFilter ? { planId: planFilter } : {}),
        ...(cycle && (CYCLES as readonly string[]).includes(cycle) ? { billingCycle: cycle as (typeof CYCLES)[number] } : {}),
        ...(q
          ? {
              OR: [
                { organization: { name: { contains: q, mode: 'insensitive' } } },
                { property: { name: { contains: q, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: {
        organization: { select: { id: true, name: true } },
        property: { select: { name: true, type: true, standardRent: true } },
        plan: { select: { name: true, pricingBasis: true, multiplier: true } },
        invoices: {
          where: { status: { in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] } },
          select: { id: true, number: true, total: true, amountPaid: true },
          orderBy: { periodStart: 'asc' },
        },
      },
      orderBy: [{ status: 'asc' }, { nextBillingDate: 'asc' }],
      take: 100,
    }),
    platformMetrics(),
    prisma.plan.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: { id: true, name: true } }),
  ])

  const activeFilters = [q, status, planFilter, cycle].filter(Boolean).length
  const actionsFor = (sub: (typeof subscriptions)[number]) => {
    const open = sub.invoices[0]
    return (
      <SubscriptionAdminActions
        subscriptionId={sub.id}
        label={`${sub.organization.name} — ${sub.property.name}`}
        status={sub.status}
        cancelAtPeriodEnd={sub.cancelAtPeriodEnd}
        openInvoice={open ? { id: open.id, number: open.number, due: open.total - open.amountPaid } : null}
        owed={sub.invoices.reduce((s, i) => s + (i.total - i.amountPaid), 0)}
      />
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Subscriptions"
        subtitle="One subscription per PG. Pricing follows the plan rules, so changing a plan re-prices every PG on it."
        icon="sparkles"
        breadcrumbs={[{ label: 'Platform', href: '/admin' }, { label: 'Subscriptions' }]}
        actions={<RunBillingButton />}
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="MRR" value={metrics.mrr} format="money" icon="sparkles" />
        <StatCard label="Active" value={metrics.activeSubscriptions} icon="check" />
        <StatCard label="On trial" value={metrics.trials} icon="clock" hint={`${metrics.expiringTrials} ending within 7 days`} />
        <StatCard label="Past due / grace" value={metrics.pastDue} icon="warning" tone={metrics.pastDue ? 'red' : undefined} />
      </div>

      <Suspense fallback={<TableSkeleton />}>
        <FilterBar activeCount={activeFilters}>
          <SearchInput placeholder="Search organization or PG…" />
          <FilterSelect
            paramKey="status"
            placeholder="All statuses"
            options={[
              { value: 'ACTIVE', label: 'Active' },
              { value: 'TRIALING', label: 'Trial' },
              { value: 'PAST_DUE', label: 'Payment due' },
              { value: 'GRACE', label: 'Grace period' },
              { value: 'SUSPENDED', label: 'Suspended' },
              { value: 'CANCELLED', label: 'Cancelled' },
            ]}
          />
          <FilterSelect
            paramKey="plan"
            placeholder="All plans"
            options={plans.map((p) => ({ value: p.id, label: p.name }))}
          />
          <FilterSelect
            paramKey="cycle"
            placeholder="All cycles"
            options={CYCLES.map((c) => ({ value: c, label: CYCLE_LABEL[c] }))}
          />
        </FilterBar>
      </Suspense>

      {subscriptions.length === 0 ? (
        <EmptyState
          icon="sparkles"
          title={activeFilters ? 'Nothing matches these filters' : 'No subscriptions yet'}
          description="A subscription is created automatically whenever an owner adds a PG."
        />
      ) : (
        <>
          {/* Desktop table */}
          <TableWrap className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PG</TableHead>
                  <TableHead>Organization</TableHead>
                  <TableHead>Plan & basis</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Next billing</TableHead>
                  <TableHead>AutoPay</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subscriptions.map((sub) => {
                  const theme = themeFor(sub.property.type)
                  const style = SUBSCRIPTION_STATUS_STYLE[sub.status]
                  const owed = sub.invoices.reduce((s, i) => s + (i.total - i.amountPaid), 0)
                  return (
                    <TableRow key={sub.id}>
                      <TableCell>
                        <span className="flex items-center gap-2">
                          <span className={cn('size-2 shrink-0 rounded-full', theme.bgSolid)} />
                          <span className="font-medium text-slate-900">{sub.property.name}</span>
                        </span>
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/admin/organizations/${sub.organization.id}`}
                          className="text-sm text-slate-700 hover:text-blue-700"
                        >
                          {sub.organization.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <p className="text-sm text-slate-700">
                          {sub.plan.name} · {CYCLE_LABEL[sub.billingCycle].toLowerCase()}
                        </p>
                        <p className="text-xs text-slate-500">
                          {sub.plan.pricingBasis === 'STANDARD_RENT'
                            ? `${sub.plan.multiplier}% of ${formatMoney(sub.property.standardRent)} rent`
                            : sub.plan.pricingBasis.replace('_', ' ').toLowerCase()}
                        </p>
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular">
                        {formatMoney(sub.amount)}
                        {owed > 0 && (
                          <span className="block text-[11px] font-normal text-rose-600">
                            {formatMoney(owed)} owed
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">
                        {formatDate(sub.nextBillingDate)}
                        {sub.graceEndsAt && (
                          <span className="block text-[11px] text-amber-600">
                            grace to {formatDate(sub.graceEndsAt)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {sub.autopayEnabled && sub.mandateStatus === 'ACTIVE' ? (
                          <Badge variant="success" size="sm">
                            On
                          </Badge>
                        ) : (
                          <Badge variant="outline" size="sm">
                            Off
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusChip label={STATUS_WORDS[sub.status as SubStatus]?.label ?? style.label} chip={style.chip} />
                        {sub.cancelAtPeriodEnd && sub.status !== 'CANCELLED' && (
                          <span className="block text-[11px] text-rose-600">cancels at period end</span>
                        )}
                        {sub.lastPaymentError && ['PAST_DUE', 'GRACE', 'SUSPENDED'].includes(sub.status) && (
                          <span className="block max-w-[180px] truncate text-[11px] text-rose-600" title={sub.lastPaymentError}>
                            {sub.lastPaymentError}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{actionsFor(sub)}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableWrap>

          {/* Mobile cards */}
          <ul className="space-y-2 md:hidden">
            {subscriptions.map((sub) => {
              const theme = themeFor(sub.property.type)
              const style = SUBSCRIPTION_STATUS_STYLE[sub.status]
              const owed = sub.invoices.reduce((s, i) => s + (i.total - i.amountPaid), 0)
              const autopayOn = sub.autopayEnabled && sub.mandateStatus === 'ACTIVE'
              return (
                <li key={sub.id} className="space-y-1">
                  <Link
                    href={`/admin/organizations/${sub.organization.id}`}
                    className="block rounded-xl border border-slate-200 bg-white p-4 shadow-card"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className={cn('size-2 shrink-0 rounded-full', theme.bgSolid)} />
                        <span className="truncate font-medium text-slate-900">{sub.property.name}</span>
                      </span>
                      <StatusChip label={style.label} chip={style.chip} />
                    </div>
                    <p className="mt-0.5 truncate text-xs text-slate-500">
                      {sub.organization.name} · {sub.plan.name} · AutoPay {autopayOn ? 'on' : 'off'}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {sub.plan.pricingBasis === 'STANDARD_RENT'
                        ? `${sub.plan.multiplier}% of ${formatMoney(sub.property.standardRent)} rent`
                        : sub.plan.pricingBasis.replace('_', ' ').toLowerCase()}
                    </p>
                    <div className="mt-2 flex items-end justify-between gap-2 text-sm">
                      <span className="text-xs text-slate-500">
                        Next billing {formatDate(sub.nextBillingDate)}
                        {sub.graceEndsAt && (
                          <span className="block text-[11px] text-amber-600">
                            grace to {formatDate(sub.graceEndsAt)}
                          </span>
                        )}
                      </span>
                      <span className="text-right font-semibold tabular">
                        {formatMoney(sub.amount)}
                        {owed > 0 && (
                          <span className="block text-[11px] font-normal text-rose-600">
                            {formatMoney(owed)} owed
                          </span>
                        )}
                      </span>
                    </div>
                  </Link>
                  <div className="flex justify-end">{actionsFor(sub)}</div>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}
