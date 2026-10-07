import type { Metadata } from 'next'
import { AlertTriangle, CheckCircle2, Sparkles } from 'lucide-react'
import { requireAccess } from '@/lib/auth'
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
import { PayInvoiceButton } from './pay-invoice-button'
import {
  CancelSubscriptionButton,
  ChangePlanButton,
  ResumeSubscriptionButton,
  type PlanOption,
} from './plan-actions'
import { priceForProperty, subscriptionGst } from '@/server/services/subscriptions'
import { usageForOrg } from '@/server/services/plan-limits'
import {
  CANCEL_CATEGORIES,
  CYCLE_LABEL,
  CYCLE_SUFFIX,
  cyclePrice,
  describeStatus,
  STATUS_WORDS,
  type SubStatus,
} from '@/lib/subscription-math'
import { isModuleEntitlementList, LIMIT_NOUN } from '@/lib/plan-entitlements'
import { OPTIONAL_MODULES } from '@/lib/modules'

const PAYABLE = ['PENDING', 'PARTIALLY_PAID', 'OVERDUE']

export const metadata: Metadata = { title: 'Subscription' }

export default async function SubscriptionPage() {
  const user = await requireAccess({ module: 'settings', permission: 'billing.manage' })

  const [subscriptions, organization, invoices, plans, usage] = await Promise.all([
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
    prisma.plan.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
    usageForOrg(user.organizationId),
  ])
  const orgTax = await prisma.organization.findUnique({
    where: { id: user.organizationId },
    select: { gstin: true, state: true },
  })
  const now = new Date()
  const planNames = new Map(plans.map((p) => [p.id, p.name]))

  // What each PG would pay on each plan (prices derive from the PG itself).
  const optionsBySub = new Map<string, PlanOption[]>()
  for (const s of subscriptions) {
    const list = plans.some((p) => p.id === s.planId) ? plans : [s.plan, ...plans]
    optionsBySub.set(
      s.id,
      await Promise.all(
        list.map(async (plan) => ({
          id: plan.id,
          name: plan.name,
          tagline: plan.tagline,
          monthly: plan.id === s.planId ? s.amount : (await priceForProperty(s.property, plan)).amount,
          yearlyDiscountPercent: plan.yearlyDiscountPercent,
          highlighted: plan.highlighted,
        })),
      ),
    )
  }

  const monthlyTotal = subscriptions
    .filter((s) => s.status === 'ACTIVE' || s.status === 'TRIALING')
    .reduce((sum, s) => sum + s.amount, 0)
  const pendingPlanIds = subscriptions.map((s) => s.pendingPlanId).filter(Boolean) as string[]
  const pendingPlans = pendingPlanIds.length
    ? await prisma.plan.findMany({ where: { id: { in: pendingPlanIds } }, select: { id: true, name: true } })
    : []
  for (const p of pendingPlans) planNames.set(p.id, p.name)
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
                No payment gateway credentials are configured, so nothing is actually charged.
                AutoPay and Pay now below run as clearly-labelled simulations so you can see how
                billing, failures and the grace period behave — every record they create is flagged
                as demo.
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
            const words = STATUS_WORDS[subscription.status as SubStatus]
            const statusLine = describeStatus({
              status: subscription.status as SubStatus,
              now,
              trialEndsAt: subscription.trialEndsAt,
              graceEndsAt: subscription.graceEndsAt,
              currentPeriodEnd: subscription.nextBillingDate,
              cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
              nextRetryAt: subscription.nextRetryAt,
            })
            const perCycle = cyclePrice(
              subscription.amount,
              subscription.billingCycle,
              subscription.plan.yearlyDiscountPercent,
            )
            // The next renewal, after any scheduled change.
            const nextCycle = subscription.pendingBillingCycle ?? subscription.billingCycle
            const nextOption = optionsBySub
              .get(subscription.id)
              ?.find((o) => o.id === (subscription.pendingPlanId ?? subscription.planId))
            const nextTaxable = cyclePrice(
              nextOption?.monthly ?? subscription.amount,
              nextCycle,
              nextOption?.yearlyDiscountPercent ?? subscription.plan.yearlyDiscountPercent,
            )
            const nextTotal = subscriptionGst(orgTax ?? {}, nextTaxable).total
            const live = subscription.status !== 'CANCELLED'
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
                    <StatusChip label={words?.label ?? style.label} chip={style.chip} />
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p
                    className={cn(
                      'rounded-lg px-3 py-2 text-sm font-medium',
                      words?.tone === 'ok' && 'bg-emerald-50 text-emerald-800',
                      words?.tone === 'info' && 'bg-violet-50 text-violet-800',
                      words?.tone === 'warn' && 'bg-amber-50 text-amber-900',
                      words?.tone === 'bad' && 'bg-red-50 text-red-800',
                    )}
                  >
                    {statusLine}
                  </p>
                  <div className="flex items-baseline gap-2">
                    <span className="font-display text-3xl font-semibold text-slate-900 tabular">
                      {formatMoney(perCycle)}
                    </span>
                    <span className="text-sm text-slate-500">
                      {CYCLE_SUFFIX[subscription.billingCycle]} + GST
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed text-slate-500">
                    {basis}
                    {subscription.billingCycle === 'YEARLY' &&
                      ` · ${formatMoney(subscription.amount)}/month billed yearly with ${subscription.plan.yearlyDiscountPercent}% off`}
                  </p>
                  {subscription.lastPaymentError && subscription.status !== 'ACTIVE' && live && (
                    <p className="flex items-start gap-1.5 text-xs text-red-700">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                      Last payment failed: {subscription.lastPaymentError}
                    </p>
                  )}
                  {(subscription.pendingPlanId || subscription.pendingBillingCycle) && (
                    <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-900">
                      From {formatDate(subscription.nextBillingDate)}:{' '}
                      {subscription.pendingPlanId &&
                        `${planNames.get(subscription.pendingPlanId) ?? 'new'} plan`}
                      {subscription.pendingPlanId && subscription.pendingBillingCycle && ', '}
                      {subscription.pendingBillingCycle &&
                        `${CYCLE_LABEL[subscription.pendingBillingCycle].toLowerCase()} billing`}
                    </p>
                  )}
                  {subscription.cancelAtPeriodEnd && live && (
                    <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">
                      Ends on {formatDate(subscription.nextBillingDate)}
                      {subscription.cancelCategory &&
                        ` — ${CANCEL_CATEGORIES.find((c) => c.value === subscription.cancelCategory)?.label ?? ''}`}
                      . Change your mind any time before then.
                    </p>
                  )}

                  <div className="space-y-2 border-t border-slate-100 pt-3 text-sm">
                    <Row
                      label="Current period"
                      value={`${formatDate(subscription.currentPeriodStart)} – ${formatDate(subscription.currentPeriodEnd)}`}
                    />
                    <Row label="Billing" value={CYCLE_LABEL[subscription.billingCycle]} />
                    {live && !subscription.cancelAtPeriodEnd && (
                      <Row
                        label="Next billing"
                        value={`${formatDate(subscription.nextBillingDate)} · ${formatMoney(nextTotal)}`}
                      />
                    )}
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
                    authUrl={subscription.gatewayAuthUrl}
                  />

                  {live && (
                    <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-3">
                      {subscription.cancelAtPeriodEnd ? (
                        <ResumeSubscriptionButton subscriptionId={subscription.id} />
                      ) : (
                        <>
                          <ChangePlanButton
                            subscriptionId={subscription.id}
                            propertyName={subscription.property.name}
                            currentPlanId={subscription.planId}
                            currentCycle={subscription.billingCycle}
                            plans={optionsBySub.get(subscription.id) ?? []}
                          />
                          <CancelSubscriptionButton
                            subscriptionId={subscription.id}
                            propertyName={subscription.property.name}
                            periodEnd={subscription.nextBillingDate.toISOString()}
                            trial={subscription.status === 'TRIALING'}
                          />
                        </>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <SectionHeader
        title="Usage"
        description={`What your ${usage.planNames.join(' + ') || 'current'} plan allows, and how much you use.`}
        icon="chart"
      />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {usage.rows.map((row) => {
          const near = row.percent != null && row.percent >= 80
          const full = row.limit != null && row.used >= row.limit
          return (
            <Card key={row.key}>
              <CardContent className="space-y-2 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {LIMIT_NOUN[row.key][1]}
                </p>
                <p className="font-display text-xl font-semibold tabular text-slate-900">
                  {row.used}
                  <span className="text-sm font-normal text-slate-500">
                    {row.limit == null ? ' · unlimited' : ` of ${row.limit}`}
                  </span>
                </p>
                {row.limit != null && (
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-100" role="meter" aria-valuenow={row.used} aria-valuemin={0} aria-valuemax={row.limit} aria-label={LIMIT_NOUN[row.key][1]}>
                    <div
                      className={cn('h-full rounded-full', full ? 'bg-red-500' : near ? 'bg-amber-500' : 'bg-emerald-500')}
                      style={{ width: `${row.percent ?? 0}%` }}
                    />
                  </div>
                )}
                {full && <p className="text-[11px] text-red-600">Limit reached — upgrade to add more.</p>}
              </CardContent>
            </Card>
          )
        })}
      </div>

      {plans.length > 0 && (
        <>
          <SectionHeader
            title="Compare plans"
            description="Prices shown for a typical PG; each PG's exact price is in Change plan."
            icon="tags"
          />
          <TableWrap>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plan</TableHead>
                  <TableHead>Price rule</TableHead>
                  <TableHead>Yearly</TableHead>
                  <TableHead>PGs</TableHead>
                  <TableHead>Beds</TableHead>
                  <TableHead>Residents</TableHead>
                  <TableHead>Staff</TableHead>
                  <TableHead>Features</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plans.map((plan) => {
                  const current = subscriptions.some((s) => s.planId === plan.id && s.status !== 'CANCELLED')
                  const modules = isModuleEntitlementList(plan.features)
                    ? OPTIONAL_MODULES.filter((m) => plan.features.includes(m.key)).map((m) => m.label)
                    : null
                  return (
                    <TableRow key={plan.id} className={cn(plan.highlighted && 'bg-blue-50/40')}>
                      <TableCell>
                        <p className="flex items-center gap-1.5 font-medium text-slate-900">
                          {plan.name}
                          {plan.highlighted && <Badge size="sm">Popular</Badge>}
                          {current && <Badge variant="success" size="sm">Yours</Badge>}
                        </p>
                        {plan.tagline && <p className="text-xs text-slate-500">{plan.tagline}</p>}
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">
                        {plan.pricingBasis === 'STANDARD_RENT'
                          ? `${plan.multiplier}% of standard rent`
                          : plan.pricingBasis === 'PER_BED'
                            ? `${formatMoney(plan.perBedPrice)} per bed`
                            : `${formatMoney(plan.flatPrice)} flat`}
                        <span className="block text-xs text-slate-400">
                          {formatMoney(plan.minAmount)}–{formatMoney(plan.maxAmount)}/month
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-emerald-700">
                        {plan.yearlyDiscountPercent > 0 ? `${plan.yearlyDiscountPercent}% off` : '—'}
                      </TableCell>
                      <TableCell className="text-sm tabular">{plan.maxProperties ?? '∞'}</TableCell>
                      <TableCell className="text-sm tabular">{plan.maxBeds ?? '∞'}</TableCell>
                      <TableCell className="text-sm tabular">{plan.maxResidents ?? '∞'}</TableCell>
                      <TableCell className="text-sm tabular">{plan.maxStaff ?? '∞'}</TableCell>
                      <TableCell className="max-w-[260px] text-xs text-slate-600">
                        {modules ? (modules.length ? modules.join(', ') : 'Core only') : 'Everything'}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableWrap>
        </>
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
                  <TableHead className="text-right">
                    <span className="sr-only">Action</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((invoice) => {
                  const theme = themeFor(invoice.subscription.property.type)
                  const payment = invoice.payments[0]
                  return (
                    <TableRow key={invoice.id}>
                      <TableCell className="font-mono text-sm font-medium text-slate-800">
                        <a
                          href={`/api/documents/subscription-invoice/${invoice.id}.pdf`}
                          target="_blank"
                          rel="noopener"
                          className="hover:text-blue-700 hover:underline"
                          title="Download tax invoice (PDF)"
                        >
                          {invoice.number}
                        </a>
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
                      <TableCell className="text-right">
                        {invoice.status === 'PAID' && (
                          <a
                            href={`/api/documents/subscription-invoice/${invoice.id}.pdf`}
                            target="_blank"
                            rel="noopener"
                            className="text-xs font-medium text-blue-700 hover:underline"
                            title="Paid tax invoice — serves as your receipt"
                          >
                            Receipt
                          </a>
                        )}
                        {PAYABLE.includes(invoice.status) && invoice.total > invoice.amountPaid && (
                          <PayInvoiceButton
                            invoiceId={invoice.id}
                            number={invoice.number}
                            amount={invoice.total - invoice.amountPaid}
                            demo={demo}
                          />
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
            {invoices.map((invoice) => {
              const theme = themeFor(invoice.subscription.property.type)
              const payment = invoice.payments[0]
              return (
                <li
                  key={invoice.id}
                  className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card"
                >
                  <div className="flex items-start justify-between gap-2">
                    <a
                      href={`/api/documents/subscription-invoice/${invoice.id}.pdf`}
                      target="_blank"
                      rel="noopener"
                      className="truncate font-mono text-sm font-medium text-slate-800 underline-offset-2 hover:underline"
                    >
                      {invoice.number}
                    </a>
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
                  {PAYABLE.includes(invoice.status) && invoice.total > invoice.amountPaid && (
                    <div className="mt-3 flex justify-end border-t border-slate-100 pt-3">
                      <PayInvoiceButton
                        invoiceId={invoice.id}
                        number={invoice.number}
                        amount={invoice.total - invoice.amountPaid}
                        demo={demo}
                        size="default"
                      />
                    </div>
                  )}
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
              'AutoPay (UPI AutoPay, card or eMandate via Razorpay) debits monthly; a failure moves you into a grace period rather than cutting access instantly.',
              'Any open invoice can be paid instantly with Pay now — a suspended account unlocks as soon as it is paid.',
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
