import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { requireSuperAdmin } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  formatDate,
  formatMoney,
  formatPhone,
  relativeTime,
} from '@/lib/utils'
import { PageHeader } from '@/components/app/page-header'
import { StatCard } from '@/components/app/stat-card'
import { Badge } from '@/components/ui/badge'
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
import { FilterBar, FilterSelect, Pagination, SearchInput } from '@/components/app/filters'
import { CreateClientDialog } from './create-client-dialog'
import { computeMrr, subscriptionMrr } from '@/server/services/platform-metrics'

export const metadata: Metadata = { title: 'Organizations' }

const PAGE_SIZE = 20

const STATUS_VARIANT: Record<string, 'success' | 'info' | 'warning' | 'danger' | 'default'> = {
  ACTIVE: 'success',
  TRIAL: 'info',
  PAST_DUE: 'warning',
  SUSPENDED: 'danger',
  CANCELLED: 'default',
}

export default async function OrganizationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  await requireSuperAdmin()
  const params = await searchParams

  const page = Math.max(1, Number(params.page) || 1)
  const q = params.q?.trim() ?? ''
  const status = params.status
  const plan = params.plan
  const city = params.city
  const source = params.source

  const where = {
    archivedAt: null,
    ...(status ? { status: status as never } : {}),
    ...(plan ? { subscriptions: { some: { planId: plan, status: { not: 'CANCELLED' as const } } } } : {}),
    ...(city ? { city: { equals: city, mode: 'insensitive' as const } } : {}),
    ...(source ? { signupSource: source } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' as const } },
            { ownerName: { contains: q, mode: 'insensitive' as const } },
            { contactEmail: { contains: q, mode: 'insensitive' as const } },
            { contactPhone: { contains: q } },
            { city: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  }

  const [organizations, total, counts, totals] = await Promise.all([
    prisma.organization.findMany({
      where,
      include: {
        _count: {
          select: {
            properties: { where: { archivedAt: null } },
            residents: { where: { status: { in: ['ACTIVE', 'NOTICE'] } } },
            users: true,
          },
        },
        properties: { where: { archivedAt: null }, select: { _count: { select: { beds: true } } } },
        users: { select: { lastLoginAt: true }, orderBy: { lastLoginAt: { sort: 'desc', nulls: 'last' } }, take: 1 },
        subscriptions: {
          select: {
            amount: true,
            status: true,
            billingCycle: true,
            nextBillingDate: true,
            plan: { select: { name: true, yearlyDiscountPercent: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.organization.count({ where }),
    prisma.organization.groupBy({
      by: ['status'],
      where: { archivedAt: null },
      _count: { _all: true },
    }),
    prisma.subscription.findMany({
      where: { status: 'ACTIVE' },
      select: { status: true, amount: true, billingCycle: true, plan: { select: { yearlyDiscountPercent: true } } },
    }),
  ])
  const platformMrr = computeMrr(
    totals.map((t) => ({ ...t, yearlyDiscountPercent: t.plan.yearlyDiscountPercent })),
  )

  const [plans, cities, activity] = await Promise.all([
    prisma.plan.findMany({ select: { id: true, name: true }, orderBy: { sortOrder: 'asc' } }),
    prisma.organization.findMany({
      where: { archivedAt: null, city: { not: null } },
      distinct: ['city'],
      select: { city: true },
      orderBy: { city: 'asc' },
      take: 100,
    }),
    organizations.length
      ? prisma.activityLog.groupBy({
          by: ['organizationId'],
          where: { organizationId: { in: organizations.map((o) => o.id) } },
          _max: { createdAt: true },
        })
      : Promise.resolve([]),
  ])
  const lastActivity = new Map(activity.map((a) => [a.organizationId, a._max.createdAt]))
  const rowFor = (org: (typeof organizations)[number]) => {
    const mrr = Math.round(
      org.subscriptions
        .filter((s) => s.status === 'ACTIVE')
        .reduce(
          (sum, sub) =>
            sum +
            subscriptionMrr({
              status: sub.status,
              amount: sub.amount,
              billingCycle: sub.billingCycle,
              yearlyDiscountPercent: sub.plan.yearlyDiscountPercent,
            }),
          0,
        ),
    )
    const beds = org.properties.reduce((sum, p) => sum + p._count.beds, 0)
    const planNames = [...new Set(org.subscriptions.filter((s) => s.status !== 'CANCELLED').map((s) => s.plan.name))]
    const login = org.users[0]?.lastLoginAt ?? null
    const logged = lastActivity.get(org.id) ?? null
    const last = [login, logged].filter((d): d is Date => Boolean(d)).sort((a, b) => b.getTime() - a.getTime())[0] ?? null
    return { mrr, beds, planNames, last }
  }

  const countFor = (s: string) => counts.find((c) => c.status === s)?._count._all ?? 0
  const activeFilters = [q, status, plan, city, source].filter(Boolean).length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        subtitle="Every PG owner account on the platform, with their PGs, beds, residents and subscription."
        icon="building"
        breadcrumbs={[{ label: 'Platform', href: '/admin' }, { label: 'Organizations' }]}
        actions={<CreateClientDialog />}
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Total accounts" value={counts.reduce((n, c) => n + c._count._all, 0)} icon="building" hint={activeFilters ? `${total} match these filters` : undefined} />
        <StatCard label="Active" value={countFor('ACTIVE')} icon="check" />
        <StatCard label="On trial" value={countFor('TRIAL')} icon="clock" />
        <StatCard
          label="Combined MRR"
          value={platformMrr}
          format="money"
          icon="sparkles"
          tone="amber"
          hint={`${totals.length} active subscriptions`}
        />
      </div>

      <Suspense fallback={<TableSkeleton />}>
        <FilterBar activeCount={activeFilters}>
          <SearchInput placeholder="Search name, owner, email or city…" />
          <FilterSelect
            paramKey="status"
            placeholder="All statuses"
            options={[
              { value: 'ACTIVE', label: 'Active' },
              { value: 'TRIAL', label: 'Trial' },
              { value: 'PAST_DUE', label: 'Past due' },
              { value: 'SUSPENDED', label: 'Suspended' },
              { value: 'CANCELLED', label: 'Cancelled' },
            ]}
          />
          <FilterSelect paramKey="plan" placeholder="All plans" options={plans.map((p) => ({ value: p.id, label: p.name }))} />
          {cities.length > 0 && (
            <FilterSelect
              paramKey="city"
              placeholder="All cities"
              options={cities.map((c) => ({ value: c.city!, label: c.city! }))}
            />
          )}
          <FilterSelect
            paramKey="source"
            placeholder="Any signup source"
            options={[
              { value: 'SELF_SIGNUP', label: 'Self signup' },
              { value: 'ADMIN', label: 'Created by admin' },
              { value: 'LEAD', label: 'From a sales lead' },
            ]}
          />
        </FilterBar>
      </Suspense>

      {organizations.length === 0 ? (
        <EmptyState
          icon="building"
          title={activeFilters ? 'Nothing matches these filters' : 'No organizations yet'}
          description="Self-signups, accounts you create and converted leads appear here."
        />
      ) : (
        <>
          {/* Desktop table */}
          <TableWrap className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Organization</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead className="text-right">PGs</TableHead>
                  <TableHead className="text-right">Beds</TableHead>
                  <TableHead className="text-right">Residents</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead className="text-right">MRR</TableHead>
                  <TableHead>Next billing</TableHead>
                  <TableHead>Last activity</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {organizations.map((org) => {
                  const { mrr, beds, planNames, last } = rowFor(org)
                  const nextBilling = org.subscriptions
                    .map((s) => s.nextBillingDate)
                    .sort((a, b) => a.getTime() - b.getTime())[0]

                  return (
                    <TableRow key={org.id}>
                      <TableCell>
                        <Link
                          href={`/admin/organizations/${org.id}`}
                          className="font-medium text-slate-900 hover:text-blue-700"
                        >
                          {org.name}
                        </Link>
                        <p className="text-xs text-slate-500">
                          {org.city ?? '—'} · joined {formatDate(org.createdAt)}
                        </p>
                      </TableCell>
                      <TableCell>
                        <p className="text-sm text-slate-700">{org.ownerName}</p>
                        <p className="text-xs text-slate-500">{formatPhone(org.contactPhone)}</p>
                      </TableCell>
                      <TableCell className="text-right tabular">{org._count.properties}</TableCell>
                      <TableCell className="text-right tabular">{beds}</TableCell>
                      <TableCell className="text-right tabular">{org._count.residents}</TableCell>
                      <TableCell className="text-sm text-slate-600">{planNames.join(', ') || '—'}</TableCell>
                      <TableCell className="text-right font-semibold tabular">
                        {mrr > 0 ? formatMoney(mrr) : '—'}
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">
                        {nextBilling ? formatDate(nextBilling) : '—'}
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">
                        {last ? relativeTime(last) : 'Never'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[org.status] ?? 'default'} size="sm">
                          {org.status.replace('_', ' ').toLowerCase()}
                        </Badge>
                        {org.trialEndsAt && org.status === 'TRIAL' && (
                          <p className="mt-0.5 text-[10px] text-slate-400">
                            ends {relativeTime(org.trialEndsAt)}
                          </p>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableWrap>

          {/* Mobile cards */}
          <ul className="space-y-2 md:hidden">
            {organizations.map((org) => {
              const { mrr, beds, last } = rowFor(org)
              const nextBilling = org.subscriptions
                .map((s) => s.nextBillingDate)
                .sort((a, b) => a.getTime() - b.getTime())[0]

              return (
                <li key={org.id}>
                  <Link
                    href={`/admin/organizations/${org.id}`}
                    className="block rounded-xl border border-slate-200 bg-white p-4 shadow-card"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate font-medium text-slate-900">{org.name}</p>
                      <Badge variant={STATUS_VARIANT[org.status] ?? 'default'} size="sm">
                        {org.status.replace('_', ' ').toLowerCase()}
                      </Badge>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-slate-500">
                      {org.ownerName} · {formatPhone(org.contactPhone)}
                    </p>
                    <p className="text-xs text-slate-500">
                      {org.city ?? '—'} · {org._count.properties} PGs · {beds} beds · {org._count.residents} residents
                      {last ? ` · active ${relativeTime(last)}` : ''}
                      {org.trialEndsAt && org.status === 'TRIAL'
                        ? ` · trial ends ${relativeTime(org.trialEndsAt)}`
                        : ''}
                    </p>
                    <div className="mt-2 flex items-center justify-between gap-2 text-sm">
                      <span className="text-xs text-slate-500">
                        Next billing {nextBilling ? formatDate(nextBilling) : '—'}
                      </span>
                      <span className="font-semibold tabular">
                        {mrr > 0 ? `${formatMoney(mrr)}/mo` : '—'}
                      </span>
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>

          <Suspense fallback={null}>
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} />
          </Suspense>
        </>
      )}
    </div>
  )
}
