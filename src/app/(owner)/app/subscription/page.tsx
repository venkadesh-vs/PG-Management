import type { Metadata } from 'next'
import { AlertTriangle, CheckCircle2, Sparkles } from 'lucide-react'
import { requireOrgUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { paymentMode } from '@/server/integrations/payments'
import { SUBSCRIPTION_STATUS_STYLE, INVOICE_STATUS_STYLE, themeFor } from '@/lib/theme'
import { cn, formatDate, formatMoney } from '@/lib/utils'
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
import { AutopayPanel } from './autopay-panel'

export const metadata: Metadata = { title: 'Subscription' }

export default async function SubscriptionPage() {
  const user = await requireOrgUser()

  const [subscriptions, organization, invoices] = await Promise.all([
    prisma.subscription.findMany({
      where: { organizationId: user.organizationId },
      include: {
        property: { select: { id: true, name: true, type: true, standardRent: true } },
        plan: true,
        paymentMethods: { where: { status: 'ACTIVE' } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.organization.findUnique({
      where: { id: user.organizationId },
      select: { name: true, status: true, trialEndsAt: true },
    }),
    prisma.subscriptionInvoice.findMany({
      where: { subscription: { organizationId: user.organizationId } },
      include: {
        subscription: { select: { property: { select: { name: true, type: true } } } },
        payments: { orderBy: { attemptedAt: 'desc' }, take: 1 },
      },
      orderBy: { issueDate: 'desc' },
      take: 24,
    }),
  ])

  const monthlyTotal = subscriptions
    .filter((s) => s.status === 'ACTIVE' || s.status === 'TRIALING')
    .reduce((sum, s) => sum + s.amount, 0)
  const outstanding = invoices
    .filter((i) => i.status !== 'PAID')
    .reduce((sum, i) => sum + (i.total - i.amountPaid), 0)
  const paidToDate = invoices
    .filter((i) => i.status === 'PAID')
    .reduce((sum, i) => sum + i.total, 0)
  const demo = paymentMode() === 'demo'
  const atRisk = subscriptions.some((s) => s.status === 'GRACE' || s.status === 'PAST_DUE')

  return (
    <div className="space-y-6">
      <PageHeader
        title="Subscription"
        subtitle="StayFlow is billed per PG. Each property carries its own subscription, priced from its own standard rent."
        icon="sparkles"
        breadcrumbs={[{ label: 'Dashboard', href: '/app' }, { label: 'Subscription' }]}
      />

      {demo && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="flex items-start gap-3 p-5">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600" />
            <div>
              <p className="text-sm font-semibold text-amber-900">
                Payments are in demo mode on this deployment
              </p>
              <p className="mt-1 text-sm leading-relaxed text-amber-800/80">
                No payment gateway credentials are configured, so nothing is actually charged. The
                AutoPay flow below runs as a clearly-labelled simulation so you can see how billing,
                failures and the grace period behave — every record it creates is flagged as demo.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {atRisk && (
        <Card className="border-red-200 bg-red-50/50">
          <CardContent className="flex items-start gap-3 p-5">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-red-600" />
            <div>
              <p className="text-sm font-semibold text-red-900">A subscription payment is pending</p>
              <p className="mt-1 text-sm text-red-800/80">
                Settle the outstanding invoice before the grace period ends to keep full access.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard
          label="Monthly total"
          value={monthlyTotal}
          format="money"
          icon="sparkles"
          tone="violet"
          hint={`${subscriptions.length} PG${subscriptions.length === 1 ? '' : 's'}`}
        />
        <StatCard
          label="Outstanding"
          value={outstanding}
          format="money"
          icon="warning"
          tone={outstanding > 0 ? 'amber' : 'emerald'}
        />
        <StatCard label="Paid to date" value={paidToDate} format="money" icon="check" tone="emerald" />
        <StatCard
          label="Account status"
          value={subscriptions.filter((s) => s.status === 'ACTIVE').length}
          icon="shield"
          tone={organization?.status === 'ACTIVE' ? 'emerald' : 'amber'}
          hint={`${organization?.status.replace('_', ' ').toLowerCase()} · ${subscriptions.length} subscriptions`}
        />
      </div>

      <SectionHeader
        title="Your PG subscriptions"
        description="One subscription per property, priced from that PG's own standard rent."
        icon="building"
      />

      {subscriptions.length === 0 ? (
        <EmptyState
          icon="sparkles"
          title="No subscription yet"
          description="A subscription is created automatically when you add your first PG."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {subscriptions.map((subscription) => {
            const theme = themeFor(subscription.property.type)
            const style = SUBSCRIPTION_STATUS_STYLE[subscription.status]
            const basis =
              subscription.plan.pricingBasis === 'STANDARD_RENT'
                ? `${subscription.plan.multiplier}% of this PG's standard rent (${formatMoney(subscription.property.standardRent)})`
                : subscription.plan.pricingBasis === 'PER_BED'
                  ? `${formatMoney(subscription.plan.perBedPrice)} per bed`
                  : 'Flat monthly fee'

            return (
              <Card key={subscription.id} className="overflow-hidden">
                <div className={cn('h-1.5 bg-gradient-to-r', theme.gradient)} />
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="truncate text-sm">
                        {subscription.property.name}
                      </CardTitle>
                      <p className="text-xs text-slate-500">{subscription.plan.name} plan</p>
                    </div>
                    <StatusChip label={style.label} chip={style.chip} />
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-baseline gap-2">
                    <span className="font-display text-3xl font-semibold text-slate-900 tabular">
                      {formatMoney(subscription.amount)}
                    </span>
                    <span className="text-sm text-slate-500">/month</span>
                  </div>
                  <p className="text-xs leading-relaxed text-slate-500">{basis}</p>

                  <div className="space-y-2 border-t border-slate-100 pt-3 text-sm">
                    <Row
                      label="Current period"
                      value={`${formatDate(subscription.currentPeriodStart)} – ${formatDate(subscription.currentPeriodEnd)}`}
                    />
                    <Row label="Next billing" value={formatDate(subscription.nextBillingDate)} />
                    {subscription.trialEndsAt && subscription.status === 'TRIALING' && (
                      <Row label="Trial ends" value={formatDate(subscription.trialEndsAt)} />
                    )}
                    {subscription.graceEndsAt && (
                      <Row label="Grace period ends" value={formatDate(subscription.graceEndsAt)} />
                    )}
                  </div>

                  <AutopayPanel
                    subscriptionId={subscription.id}
                    propertyName={subscription.property.name}
                    amount={subscription.amount}
                    autopayEnabled={subscription.autopayEnabled}
                    mandateStatus={subscription.mandateStatus}
                    methodLabel={subscription.paymentMethods[0]?.label ?? null}
                    demo={demo}
                  />
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <SectionHeader title="Invoices" description="Every StayFlow invoice and its payment." icon="receipt" />

      {invoices.length === 0 ? (
        <EmptyState icon="receipt" title="No invoices yet" description="Your first invoice appears after the trial ends." />
      ) : (
        <>
          {/* Desktop table */}
          <TableWrap className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>PG</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((invoice) => {
                  const theme = themeFor(invoice.subscription.property.type)
                  const payment = invoice.payments[0]
                  return (
                    <TableRow key={invoice.id}>
                      <TableCell className="font-mono text-sm font-medium text-slate-800">
                        {invoice.number}
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1.5 text-sm text-slate-600">
                          <span className={cn('size-1.5 rounded-full', theme.bgSolid)} />
                          {invoice.subscription.property.name}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">
                        {formatDate(invoice.periodStart)}
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">
                        {formatDate(invoice.dueDate)}
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
                          {payment?.isDemo && (
                            <Badge variant="warning" size="sm">
                              Demo
                            </Badge>
                          )}
                          {payment?.status === 'FAILED' && (
                            <span className="text-[11px] text-red-600">{payment.failureReason}</span>
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
            {invoices.map((invoice) => {
              const theme = themeFor(invoice.subscription.property.type)
              const payment = invoice.payments[0]
              return (
                <li
                  key={invoice.id}
                  className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate font-mono text-sm font-medium text-slate-800">
                      {invoice.number}
                    </p>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {payment?.isDemo && (
                        <Badge variant="warning" size="sm">
                          Demo
                        </Badge>
                      )}
                      <StatusChip
                        label={INVOICE_STATUS_STYLE[invoice.status].label}
                        chip={INVOICE_STATUS_STYLE[invoice.status].chip}
                      />
                    </div>
                  </div>
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                    <span className={cn('size-1.5 shrink-0 rounded-full', theme.bgSolid)} />
                    <span className="truncate">{invoice.subscription.property.name}</span>
                  </p>
                  {payment?.status === 'FAILED' && (
                    <p className="mt-1 text-[11px] text-red-600">{payment.failureReason}</p>
                  )}
                  <div className="mt-2 flex items-center justify-between gap-2 text-sm">
                    <span className="text-xs text-slate-500">
                      {formatDate(invoice.periodStart)} · due {formatDate(invoice.dueDate)}
                    </span>
                    <span className="font-semibold tabular">{formatMoney(invoice.total)}</span>
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Sparkles className="size-4 text-slate-400" />
            How StayFlow pricing works
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2 sm:grid-cols-2">
            {[
              'One subscription per PG — add a second PG and it is billed separately.',
              "Each PG's price is derived from its own standard rent, not a flat tier.",
              'No per-resident or per-feature charges.',
              'AutoPay debits monthly; a failure moves you into a grace period rather than cutting access instantly.',
            ].map((line) => (
              <li key={line} className="flex items-start gap-2 text-sm text-slate-600">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                {line}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-800">{value}</span>
    </div>
  )
}
