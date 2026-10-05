import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import {
  Mail,
  MapPin,
  Phone,
  UserRound,
} from 'lucide-react'
import { requireSuperAdmin } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { INVOICE_STATUS_STYLE, SUBSCRIPTION_STATUS_STYLE, themeFor } from '@/lib/theme'
import { cn, formatDate, formatDateTime, formatMoney, formatPhone } from '@/lib/utils'
import { occupancyFor } from '@/server/services/residents'
import { PageHeader, SectionHeader } from '@/components/app/page-header'
import { StatCard } from '@/components/app/stat-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge, StatusChip } from '@/components/ui/badge'
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
import { OccupancyBar } from '@/components/app/occupancy-ring'
import { ActivityTimeline } from '@/components/app/activity-timeline'
import { OrgStatusControl } from './org-status-control'

export const metadata: Metadata = { title: 'Organization' }

export default async function AdminOrganizationPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireSuperAdmin()
  const { id } = await params

  const org = await prisma.organization.findUnique({
    where: { id },
    include: {
      properties: {
        where: { archivedAt: null },
        include: {
          subscription: { include: { plan: true } },
          _count: { select: { residents: true, beds: true, rooms: true } },
        },
      },
      users: {
        where: { role: { in: ['OWNER', 'MANAGER'] } },
        select: { id: true, name: true, email: true, role: true, lastLoginAt: true },
      },
      _count: { select: { residents: true, properties: true } },
      subscriptions: {
        include: {
          property: { select: { name: true, type: true } },
          invoices: { orderBy: { issueDate: 'desc' }, take: 6, include: { payments: true } },
        },
      },
    },
  })
  if (!org) notFound()

  const propertyIds = org.properties.map((p) => p.id)
  const [occupancy, collections, activity] = await Promise.all([
    propertyIds.length
      ? occupancyFor(propertyIds)
      : Promise.resolve({ total: 0, occupied: 0, available: 0, reserved: 0, maintenance: 0, blocked: 0, rate: 0 }),
    prisma.rentPayment.aggregate({
      where: { organizationId: org.id, status: 'SUCCESS', purpose: 'RENT' },
      _sum: { amount: true },
    }),
    prisma.activityLog.findMany({
      where: { organizationId: org.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
  ])

  const mrr = org.subscriptions
    .filter((s) => s.status === 'ACTIVE')
    .reduce((s, sub) => s + sub.amount, 0)
  const allInvoices = org.subscriptions.flatMap((s) =>
    s.invoices.map((i) => ({ ...i, propertyName: s.property.name, propertyType: s.property.type })),
  )
  const outstanding = allInvoices
    .filter((i) => i.status !== 'PAID')
    .reduce((s, i) => s + (i.total - i.amountPaid), 0)

  return (
    <div className="space-y-6">
      <PageHeader
        title={org.name}
        subtitle={`${org.ownerName} · joined ${formatDate(org.createdAt)}`}
        icon="building"
        breadcrumbs={[
          { label: 'Platform', href: '/admin' },
          { label: 'Organizations', href: '/admin/organizations' },
          { label: org.name },
        ]}
        actions={<OrgStatusControl organizationId={org.id} status={org.status} name={org.name} />}
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Monthly revenue" value={mrr} format="money" icon="sparkles" tone="violet" hint={`${org.subscriptions.length} subscriptions`} />
        <StatCard label="PGs" value={org._count.properties} icon="building" tone="blue" hint={`${occupancy.total} beds`} />
        <StatCard label="Residents" value={org._count.residents} icon="users" tone="emerald" hint={`${occupancy.rate}% occupancy`} />
        <StatCard
          label="Outstanding to us"
          value={outstanding}
          format="money"
          icon="warning"
          tone={outstanding > 0 ? 'amber' : 'emerald'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Contact</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            <Row icon={UserRound} value={org.ownerName} />
            <Row icon={Mail} value={org.contactEmail} />
            <Row icon={Phone} value={formatPhone(org.contactPhone)} />
            {(org.addressLine || org.city) && (
              <Row
                icon={MapPin}
                value={[org.addressLine, org.city, org.state].filter(Boolean).join(', ')}
              />
            )}
            <div className="border-t border-slate-100 pt-2.5">
              <p className="text-xs text-slate-500">Account status</p>
              <Badge
                variant={
                  org.status === 'ACTIVE' ? 'success' : org.status === 'TRIAL' ? 'info' : 'warning'
                }
                size="sm"
                className="mt-1"
              >
                {org.status.replace('_', ' ').toLowerCase()}
              </Badge>
              {org.trialEndsAt && (
                <p className="mt-1 text-xs text-slate-500">
                  Trial ends {formatDate(org.trialEndsAt)}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Team</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-slate-100">
              {org.users.map((member) => (
                <li key={member.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">{member.name}</p>
                    <p className="truncate text-xs text-slate-500">{member.email}</p>
                    {member.lastLoginAt && (
                      <p className="text-xs text-slate-400 sm:hidden">
                        Last login {formatDateTime(member.lastLoginAt)}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {member.lastLoginAt && (
                      <span className="hidden text-xs text-slate-400 sm:inline">
                        {formatDateTime(member.lastLoginAt)}
                      </span>
                    )}
                    <Badge variant={member.role === 'OWNER' ? 'blue' : 'outline'} size="sm">
                      {member.role.toLowerCase()}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <SectionHeader title="Their PGs" description="Each one carries its own subscription." icon="building" />

      {org.properties.length === 0 ? (
        <EmptyState icon="building" title="No PGs added yet" description="This account has not created a property." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {org.properties.map((property) => {
            const theme = themeFor(property.type)
            return (
              <Card key={property.id} className="overflow-hidden">
                <div className={cn('h-1.5 bg-gradient-to-r', theme.gradient)} />
                <CardContent className="space-y-3 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-display text-sm font-semibold text-slate-900">
                        {property.name}
                      </p>
                      <p className="text-xs text-slate-500">
                        {theme.label} · {property.city}
                      </p>
                    </div>
                    {property.subscription && (
                      <StatusChip
                        label={SUBSCRIPTION_STATUS_STYLE[property.subscription.status].label}
                        chip={SUBSCRIPTION_STATUS_STYLE[property.subscription.status].chip}
                      />
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
                    <Metric label="Rooms" value={property._count.rooms} />
                    <Metric label="Beds" value={property._count.beds} />
                    <Metric label="Residents" value={property._count.residents} />
                    <Metric
                      label="Rent"
                      value={formatMoney(property.standardRent, { compact: true })}
                    />
                  </div>

                  {property.subscription && (
                    <div className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm">
                      <span className="text-slate-500">
                        {property.subscription.plan.name} plan
                        {property.subscription.autopayEnabled ? ' · AutoPay' : ''}
                      </span>
                      <span className="font-semibold text-slate-800 tabular">
                        {formatMoney(property.subscription.amount)}/mo
                      </span>
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <SectionHeader title="Billing history" description="Subscription invoices raised to this account." icon="receipt" />

      {allInvoices.length === 0 ? (
        <EmptyState icon="receipt" title="No invoices yet" description="Billing starts after the trial." />
      ) : (
        <>
          {/* Desktop table */}
          <TableWrap className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>PG</TableHead>
                  <TableHead>Issued</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allInvoices
                  .sort((a, b) => b.issueDate.getTime() - a.issueDate.getTime())
                  .map((invoice) => {
                    const theme = themeFor(invoice.propertyType)
                    const failed = invoice.payments.some((p) => p.status === 'FAILED')
                    return (
                      <TableRow key={invoice.id}>
                        <TableCell className="font-mono text-sm">{invoice.number}</TableCell>
                        <TableCell>
                          <span className="flex items-center gap-1.5 text-sm text-slate-600">
                            <span className={cn('size-1.5 rounded-full', theme.bgSolid)} />
                            {invoice.propertyName}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm text-slate-600">
                          {formatDate(invoice.issueDate)}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular">
                          {formatMoney(invoice.total)}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <StatusChip
                              label={INVOICE_STATUS_STYLE[invoice.status].label}
                              chip={INVOICE_STATUS_STYLE[invoice.status].chip}
                            />
                            {failed && (
                              <Badge variant="danger" size="sm">
                                Attempt failed
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
              </TableBody>
            </Table>
          </TableWrap>

          {/* Mobile cards */}
          <ul className="space-y-2 md:hidden">
            {allInvoices.map((invoice) => {
              const theme = themeFor(invoice.propertyType)
              const failed = invoice.payments.some((p) => p.status === 'FAILED')
              return (
                <li
                  key={invoice.id}
                  className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate font-mono text-sm font-medium text-slate-900">
                      {invoice.number}
                    </p>
                    <StatusChip
                      label={INVOICE_STATUS_STYLE[invoice.status].label}
                      chip={INVOICE_STATUS_STYLE[invoice.status].chip}
                    />
                  </div>
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                    <span className={cn('size-1.5 shrink-0 rounded-full', theme.bgSolid)} />
                    <span className="truncate">{invoice.propertyName}</span>
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-2 text-sm">
                    <span className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                      Issued {formatDate(invoice.issueDate)}
                      {failed && (
                        <Badge variant="danger" size="sm">
                          Attempt failed
                        </Badge>
                      )}
                    </span>
                    <span className="font-semibold tabular">{formatMoney(invoice.total)}</span>
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Occupancy across their PGs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <OccupancyBar
              occupied={occupancy.occupied}
              available={occupancy.available}
              reserved={occupancy.reserved}
              maintenance={occupancy.maintenance}
              blocked={occupancy.blocked}
            />
            <p className="text-sm text-slate-600">
              {occupancy.occupied} of {occupancy.total} beds occupied ({occupancy.rate}%) ·{' '}
              {formatMoney(collections._sum.amount ?? 0)} collected from residents to date
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Recent activity</CardTitle>
          </CardHeader>
          <CardContent>
            <ActivityTimeline items={activity} compact />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Row({ icon: Icon, value }: { icon: React.ElementType; value: string }) {
  return (
    <p className="flex items-start gap-2 text-sm text-slate-700">
      <Icon className="mt-0.5 size-4 shrink-0 text-slate-400" />
      {value}
    </p>
  )
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-1.5 py-1.5">
      <p className="font-display text-sm font-semibold text-slate-900 tabular">{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
    </div>
  )
}
