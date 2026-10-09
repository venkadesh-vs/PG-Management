import { Suspense } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  BadgeCheck,
  Bed,
  Building2,
  FileText,
  IdCard,
  Mail,
  Phone,
  ShieldCheck,
  Utensils,
  Wallet,
} from 'lucide-react'
import { requireAccess } from '@/lib/auth'
import { ExportButton } from '@/components/app/export-button'
import { assertResidentAccess, ForbiddenError, NotFoundError } from '@/lib/tenancy'
import { prisma } from '@/lib/prisma'
import {
  INVOICE_STATUS_STYLE,
  RESIDENT_STATUS_STYLE,
  COMPLAINT_STATUS_STYLE,
  themeFor,
} from '@/lib/theme'
import {
  cn,
  formatDate,
  formatDateTime,
  formatMoney,
  formatPhone,
  initials,
  maskId,
} from '@/lib/utils'
import { PageHeader } from '@/components/app/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge, StatusChip } from '@/components/ui/badge'
import { Avatar, AvatarFallback, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives'
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
import { getLookupLabels } from '@/server/services/org-defaults'
import { ResidentActions } from './resident-actions'
import { ResendInviteButton } from '@/components/app/invite-link'
import { LedgerTable } from './ledger-table'
import { DepositCard } from './deposit-card'
import { ChargesCard } from './charges-card'
import { RentRevisionCard } from './rent-revision-card'
import { ResidentAutopayCard } from './autopay-card'
import { residentAutopayStatus } from '@/server/services/resident-autopay'
import { firstMonthSummary } from '@/lib/first-month'
import { SettlementCard } from './settlement-card'
import { readChecklist } from '@/lib/checkout-checklist'
import { InvoiceActions } from '../../rent/invoice-actions'
import { PaymentActions, PaymentStatusBadge } from '../../payments/payment-actions'
import { rentOnDay, unallocatedOf } from '@/lib/billing-calc'

export const metadata: Metadata = { title: 'Resident' }

export default async function ResidentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await requireAccess({ module: 'residents', permission: 'residents.view' })
  const { id } = await params
  // Another organisation's (or another PG's) record reads as "not found".
  await assertResidentAccess(user, id).catch((error: unknown) => {
    if (error instanceof NotFoundError || error instanceof ForbiddenError) notFound()
    throw error
  })
  const has = (p: string) => user.permissions.includes(p)
  // AutoPay status is optional; never let it break the resident page.
  const autopay = await residentAutopayStatus(id).catch(() => null)

  const resident = await prisma.resident.findUnique({
    where: { id },
    include: {
      property: true,
      room: { include: { floor: true } },
      bed: true,
      deposit: true,
      documents: { orderBy: { uploadedAt: 'desc' } },
      foodSubscription: { include: { foodPlan: true } },
      checkout: true,
      user: { select: { email: true, status: true, lastLoginAt: true } },
      invoices: { orderBy: { periodStart: 'desc' }, include: { lines: true } },
      payments: { orderBy: { paidAt: 'desc' }, include: { allocations: { select: { amount: true, invoiceId: true } } } },
      charges: { orderBy: [{ voidedAt: 'asc' }, { createdAt: 'desc' }] },
      rentRevisions: { orderBy: { effectiveFrom: 'desc' } },
      ledger: { orderBy: [{ entryDate: 'asc' }, { createdAt: 'asc' }] },
      complaints: { orderBy: { createdAt: 'desc' }, take: 10 },
      allocations: {
        orderBy: { fromDate: 'desc' },
        include: { bed: { select: { label: true, room: { select: { number: true } } } } },
      },
      utilityCharges: { orderBy: { periodStart: 'desc' }, take: 6 },
    },
  })
  if (!resident) notFound()
  // The room's electricity meter, so checkout can take a final reading.
  const roomMeter =
    user.modules.includes('electricity') && resident.status !== 'CHECKED_OUT'
      ? await prisma.electricityMeter.findFirst({
          where: {
            organizationId: user.organizationId!,
            status: 'ACTIVE',
            room: { OR: [{ beds: { some: { residentId: resident.id } } }, { residents: { some: { id: resident.id } } }] },
          },
          select: {
            meterNumber: true,
            readings: { orderBy: { readingDate: 'desc' }, take: 1, select: { value: true, readingDate: true } },
          },
        })
      : null

  const theme = themeFor(resident.property.type)
  // rentAmount already holds a revision scheduled for later; show what is in force today.
  const currentRent = rentOnDay(new Date(), resident.rentAmount, resident.rentRevisions)
  const billedOn = new Map(resident.invoices.map((i) => [i.id, i.number]))
  const invoiceCan = { credit: has('invoices.waive'), debit: has('rent.manage') }
  const paymentCan = { edit: has('payments.record'), reverse: has('payments.record') && has('invoices.waive') }
  const checkedOut = resident.status === 'CHECKED_OUT'
  // Check-in summary: the joining-month "First month" invoice (if the first-month flow
  // was used), how it was paid, the advance and when regular rent starts.
  const firstMonthInvoice = resident.invoices.find((i) => i.lines.some((l) => l.label.startsWith('First month')))
  const firstMonthPaid = firstMonthInvoice
    ? resident.payments.find((p) => p.allocations.some((a) => a.invoiceId === firstMonthInvoice.id))
    : undefined
  const checkInSummary = firstMonthSummary({
    joiningDate: resident.joiningDate,
    amount: firstMonthInvoice ? firstMonthInvoice.total : null,
    method: firstMonthPaid?.method,
    paidAt: firstMonthPaid?.paidAt,
    advance: resident.deposit?.collected ?? 0,
    rentDueDay: resident.rentDueDay,
    money: formatMoney,
  })
  const startOfDayNow = new Date(new Date().setHours(0, 0, 0, 0))
  const outstanding = resident.invoices
    .filter((i) => ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'].includes(i.status))
    .reduce((s, i) => s + i.balance, 0)
  const lifetimePaid = resident.payments
    .filter((p) => p.status === 'SUCCESS')
    .reduce((s, p) => s + p.amount, 0)
  const openInvoices = resident.invoices.filter((i) =>
    ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'].includes(i.status),
  )

  // Vacant beds in the same PG, for the transfer dialog.
  const [availableBeds, idTypeLabels, relationLabels, categoryLabels] = await Promise.all([
    prisma.bed.findMany({
      where: { propertyId: resident.propertyId, status: 'AVAILABLE' },
      include: { room: { select: { number: true, baseRent: true } } },
      orderBy: [{ room: { number: 'asc' } }, { label: 'asc' }],
    }),
    getLookupLabels(resident.organizationId, 'ID_TYPE'),
    getLookupLabels(resident.organizationId, 'GUARDIAN_RELATION'),
    getLookupLabels(resident.organizationId, 'COMPLAINT_CATEGORY'),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title={resident.fullName}
        subtitle={`${resident.code} · joined ${formatDate(resident.joiningDate)}`}
        breadcrumbs={[
          { label: 'Dashboard', href: '/app' },
          { label: 'Residents', href: '/app/residents' },
          { label: resident.fullName },
        ]}
        actions={
          <ResidentActions
            resident={{
              id: resident.id,
              fullName: resident.fullName,
              status: resident.status,
              propertyType: resident.property.type,
              rentAmount: currentRent,
              outstanding,
              exitDate: resident.exitDate?.toISOString() ?? null,
              noticeDate: resident.noticeDate?.toISOString() ?? null,
              meter: roomMeter
                ? {
                    meterNumber: roomMeter.meterNumber,
                    lastReading: roomMeter.readings[0]
                      ? { value: Number(String(roomMeter.readings[0].value)), date: roomMeter.readings[0].readingDate.toISOString() }
                      : null,
                  }
                : null,
            }}
            openInvoices={openInvoices.map((i) => ({
              id: i.id,
              number: i.number,
              balance: i.balance,
              dueDate: i.dueDate.toISOString(),
            }))}
            availableBeds={availableBeds.map((b) => ({
              id: b.id,
              label: `Room ${b.room.number} · Bed ${b.label}`,
              rent: b.rent ?? b.room.baseRent ?? resident.property.standardRent ?? undefined,
            }))}
            can={{
              recordPayment: has('payments.record'),
              manage: has('residents.manage'),
              checkout: has('residents.checkout'),
              rent: has('rent.manage'),
            }}
          />
        }
      />

      {/* ------------------------------------------------ Identity header */}
      <div
        className={cn(
          'relative overflow-hidden rounded-xl border border-slate-200 bg-white p-5 shadow-xs sm:p-6',
        )}
      >
        <div className={cn('absolute inset-x-0 top-0 h-1', theme.bgSolid)} />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
          <Avatar className="size-14 border border-slate-200">
            <AvatarFallback className="bg-slate-100 text-base font-semibold text-slate-700">
              {initials(resident.fullName)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-xl font-semibold tracking-tight text-slate-900">
                {resident.fullName}
              </h2>
              <StatusChip
                label={RESIDENT_STATUS_STYLE[resident.status].label}
                chip={RESIDENT_STATUS_STYLE[resident.status].chip}
              />
              {resident.kycStatus === 'VERIFIED' && (
                <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                  <ShieldCheck className="size-3" />
                  KYC verified
                </span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-500">
              <span className="flex items-center gap-1.5">
                <Building2 className="size-3.5" />
                {resident.property.name}
              </span>
              <span className="flex items-center gap-1.5">
                <Bed className="size-3.5" />
                {resident.room ? `Room ${resident.room.number}` : 'No room'}
                {resident.bed ? ` · Bed ${resident.bed.label}` : ''}
              </span>
              <span className="flex items-center gap-1.5">
                <Phone className="size-3.5" />
                {formatPhone(resident.phone)}
              </span>
              {resident.email && (
                <span className="flex min-w-0 items-center gap-1.5 break-all">
                  <Mail className="size-3.5" />
                  {resident.email}
                </span>
              )}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:w-auto sm:gap-3">
            <HeaderStat label="Rent" value={formatMoney(currentRent)} />
            <HeaderStat
              label="Outstanding"
              value={outstanding === 0 ? 'Clear' : formatMoney(outstanding)}
              tone={outstanding > 0 ? 'warn' : 'ok'}
            />
            <HeaderStat label="Paid to date" value={formatMoney(lifetimePaid, { compact: true })} />
          </div>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="max-w-full">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="rent">Rent & invoices</TabsTrigger>
          <TabsTrigger value="ledger">Ledger</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          {user.modules.includes('complaints') && <TabsTrigger value="complaints">Complaints</TabsTrigger>}
        </TabsList>

        {/* ----------------------------------------------------- Overview */}
        <TabsContent value="overview">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Personal details</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
                <Detail label="Full name" value={resident.fullName} />
                <Detail label="Resident code" value={resident.code} />
                <Detail label="Date of birth" value={formatDate(resident.dateOfBirth)} />
                <Detail label="Blood group" value={resident.bloodGroup} />
                <Detail label="Qualification" value={resident.qualification} />
                <Detail
                  label="Occupation"
                  value={
                    resident.occupationType
                      ? `${resident.occupationType === 'STUDENT' ? 'Student' : 'Working'}${resident.companyName ? ` · ${resident.companyName}` : ''}`
                      : null
                  }
                />
                <Detail label="Mobile" value={formatPhone(resident.phone)} />
                <Detail label="WhatsApp" value={formatPhone(resident.whatsappPhone)} />
                <Detail label="Email" value={resident.email} />
                <Detail
                  label="Permanent address"
                  value={
                    [resident.permanentAddress, resident.city, resident.state, resident.pincode]
                      .filter(Boolean)
                      .join(', ') || null
                  }
                  className="sm:col-span-2"
                />
                <Detail
                  label="Guardian"
                  value={
                    resident.guardianName
                      ? `${resident.guardianName}${resident.guardianRelation ? ` (${relationLabels[resident.guardianRelation] ?? resident.guardianRelation})` : ''}`
                      : null
                  }
                />
                <Detail label="Guardian mobile" value={formatPhone(resident.guardianPhone)} />
                <Detail
                  label="ID proof"
                  value={
                    resident.idNumber
                      ? `${resident.idType ? (idTypeLabels[resident.idType] ?? resident.idType) : 'ID'} · ${has('residents.kyc') ? resident.idNumber : maskId(resident.idNumber)}`
                      : null
                  }
                />
                <Detail
                  label="KYC"
                  value={`${resident.kycStatus.replace('_', ' ').toLowerCase()}${
                    resident.kycVerifiedAt ? ` · ${formatDate(resident.kycVerifiedAt)}` : ''
                  }`}
                />
                {resident.notes && (
                  <Detail label="Internal notes" value={resident.notes} className="sm:col-span-2" />
                )}
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Wallet className="size-4 text-slate-400" />
                    Money
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2.5">
                  <Row label="Monthly rent" value={formatMoney(currentRent)} />
                  {currentRent !== resident.rentAmount && (
                    <Row label="Scheduled rent" value={formatMoney(resident.rentAmount)} />
                  )}
                  {resident.charges
                    .filter((c) => !c.voidedAt && c.kind !== 'ONE_TIME' && (!c.endDate || c.endDate >= startOfDayNow))
                    .map((c) => (
                      <Row
                        key={c.id}
                        label={c.label}
                        value={`${c.kind === 'DISCOUNT' ? '− ' : ''}${formatMoney(c.amount)}`}
                      />
                    ))}
                  {resident.maintenanceFee > 0 && (
                    <Row label="Maintenance" value={formatMoney(resident.maintenanceFee)} />
                  )}
                  {resident.foodOptIn && (
                    <Row label="Food plan" value={formatMoney(resident.foodCharge)} />
                  )}
                  {resident.discountAmount > 0 && (
                    <Row
                      label={`Discount${resident.discountNote ? ` (${resident.discountNote})` : ''}`}
                      value={`− ${formatMoney(resident.discountAmount)}`}
                    />
                  )}
                  <Row label="Rent due day" value={`${resident.rentDueDay} of every month`} />
                  <p className="border-t border-slate-100 pt-2.5 text-xs text-slate-500">{checkInSummary}</p>
                </CardContent>
              </Card>

              <DepositCard
                residentId={resident.id}
                residentName={resident.fullName}
                checkedOut={resident.status === 'CHECKED_OUT'}
                depositAmount={resident.depositAmount}
                deposit={
                  resident.deposit
                    ? {
                        amount: resident.deposit.amount,
                        collected: resident.deposit.collected,
                        deductions: resident.deposit.deductions,
                        refunded: resident.deposit.refunded,
                        status: resident.deposit.status,
                        collectedAt: resident.deposit.collectedAt?.toISOString() ?? null,
                        refundedAt: resident.deposit.refundedAt?.toISOString() ?? null,
                        refundMethod: resident.deposit.refundMethod,
                        refundReference: resident.deposit.refundReference,
                        refundNote: resident.deposit.refundNote,
                      }
                    : null
                }
                pendingRefund={
                  resident.checkout && !resident.checkout.settledAt ? resident.checkout.refundAmount : 0
                }
                can={{
                  refund: has('residents.checkout'),
                  collect: has('payments.record') || has('residents.checkout'),
                }}
              />

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Utensils className="size-4 text-slate-400" />
                    Food & app
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2.5">
                  <Row
                    label="Food plan"
                    value={
                      resident.foodSubscription?.active
                        ? resident.foodSubscription.foodPlan.name
                        : 'Not subscribed'
                    }
                  />
                  <Row
                    label="Resident app"
                    value={resident.user ? resident.user.email : 'No account'}
                  />
                  {resident.user?.lastLoginAt && (
                    <Row label="Last signed in" value={formatDateTime(resident.user.lastLoginAt)} />
                  )}
                  {resident.status !== 'CHECKED_OUT' && has('residents.manage') && (
                    <ResendInviteButton
                      action="RESEND_RESIDENT_INVITE"
                      payload={{ residentId: resident.id }}
                      label={resident.user ? 'Resend login link' : 'Create app login'}
                      variant="ghost"
                    />
                  )}
                  {resident.noticeDate && (
                    <Row label="Notice given" value={formatDate(resident.noticeDate)} />
                  )}
                  {resident.exitDate && (
                    <Row label="Exit date" value={formatDate(resident.exitDate)} />
                  )}
                </CardContent>
              </Card>

              {resident.checkout && (
                <SettlementCard
                  residentId={resident.id}
                  canManage={has('residents.checkout')}
                  settlement={{
                    exitDate: resident.checkout.exitDate.toISOString(),
                    outstandingRent: resident.checkout.outstandingRent,
                    proRataRent: resident.checkout.proRataRent,
                    foodCharges: resident.checkout.foodCharges,
                    utilityCharges: resident.checkout.utilityCharges,
                    otherCharges: resident.checkout.otherCharges,
                    damageDeduction: resident.checkout.damageDeduction,
                    depositHeld: resident.checkout.depositHeld,
                    refundAmount: resident.checkout.refundAmount,
                    payableAmount: resident.checkout.payableAmount,
                    settledAt: resident.checkout.settledAt?.toISOString() ?? null,
                    settlementNote: resident.checkout.settlementNote,
                    lockedAt: resident.checkout.lockedAt?.toISOString() ?? null,
                    inspection: readChecklist(resident.checkout.inspection),
                    clearance: readChecklist(resident.checkout.clearance),
                  }}
                />
              )}

              {resident.allocations.length > 0 && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <Bed className="size-4 text-slate-400" />
                      Stay history
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ol className="space-y-2.5">
                      {resident.allocations.map((a) => (
                        <li key={a.id} className="flex items-start justify-between gap-3 text-sm">
                          <span className="min-w-0 font-medium text-slate-700">
                            Room {a.bed.room.number} · Bed {a.bed.label}
                          </span>
                          <span className="shrink-0 text-right text-xs text-slate-500">
                            {formatDate(a.fromDate)} – {a.toDate ? formatDate(a.toDate) : 'now'}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </TabsContent>

        {/* --------------------------------------------------------- Rent */}
        <TabsContent value="rent">
          <div className="mb-4 grid gap-4 lg:grid-cols-2">
            {autopay && (
              <ResidentAutopayCard
                residentId={resident.id}
                canManage={has('rent.manage')}
                checkedOut={checkedOut}
                offered={autopay.offered}
                day={autopay.day}
                window={autopay.window}
                dayOutsideWindow={autopay.dayOutsideWindow}
                mandate={autopay.mandate}
                upcoming={
                  autopay.upcoming
                    ? { amount: autopay.upcoming.amount, chargeDate: new Date(autopay.upcoming.chargeDate).toISOString(), invoice: autopay.upcoming.invoice }
                    : null
                }
              />
            )}
            <ChargesCard
              residentId={resident.id}
              canManage={has('rent.manage')}
              checkedOut={checkedOut}
              charges={resident.charges.map((c) => ({
                id: c.id,
                kind: c.kind,
                category: c.category,
                label: c.label,
                amount: c.amount,
                startDate: c.startDate.toISOString(),
                endDate: c.endDate?.toISOString() ?? null,
                billedInvoice: c.billedInvoiceId ? (billedOn.get(c.billedInvoiceId) ?? 'an invoice') : null,
                lastBilledFor: c.lastBilledFor?.toISOString() ?? null,
                voidedAt: c.voidedAt?.toISOString() ?? null,
                voidReason: c.voidReason,
              }))}
            />
            <RentRevisionCard
              residentId={resident.id}
              rentAmount={resident.rentAmount}
              canManage={has('rent.manage')}
              checkedOut={checkedOut}
              revisions={resident.rentRevisions.map((r) => ({
                id: r.id,
                oldRent: r.oldRent,
                newRent: r.newRent,
                effectiveFrom: r.effectiveFrom.toISOString(),
                reason: r.reason,
                createdBy: r.createdBy,
                createdAt: r.createdAt.toISOString(),
              }))}
            />
          </div>
          {has('reports.export') && has('rent.view') && user.modules.includes('rent') && (
            <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="w-full sm:w-auto">Export for all residents:</span>
              <Suspense fallback={null}>
                <ExportButton kind="charges" label="Charges" />
                <ExportButton kind="rent-revisions" label="Rent changes" />
                <ExportButton kind="deposits" label="Deposits" />
              </Suspense>
            </div>
          )}
          {resident.invoices.length === 0 ? (
            <EmptyState
              icon="file"
              title="No invoices yet"
              description="Invoices generate automatically on the first of each month."
            />
          ) : (
            <>
              {/* Desktop table */}
              <TableWrap className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice</TableHead>
                      <TableHead>Period</TableHead>
                      <TableHead>Due</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Paid</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {resident.invoices.map((invoice) => (
                      <TableRow key={invoice.id}>
                        <TableCell>
                          <p className="font-medium text-slate-800">
                            <a href={`/api/documents/rent-invoice/${invoice.id}.pdf`} className="hover:text-blue-700 hover:underline" target="_blank" rel="noopener" title="Download PDF">
                              {invoice.number}
                            </a>
                          </p>
                          <p className="text-xs text-slate-500">
                            {invoice.lines.map((l) => l.label.split('—')[0].trim()).join(' · ')}
                          </p>
                        </TableCell>
                        <TableCell className="text-sm text-slate-600">
                          {formatDate(invoice.periodStart)}
                        </TableCell>
                        <TableCell className="text-sm text-slate-600">
                          {formatDate(invoice.dueDate)}
                        </TableCell>
                        <TableCell className="text-right tabular">{formatMoney(invoice.total)}</TableCell>
                        <TableCell className="text-right text-emerald-600 tabular">
                          {formatMoney(invoice.amountPaid)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            'text-right font-semibold tabular',
                            invoice.balance > 0 ? 'text-rose-600' : 'text-slate-400',
                          )}
                        >
                          {invoice.balance > 0 ? formatMoney(invoice.balance) : '—'}
                        </TableCell>
                        <TableCell>
                          <StatusChip
                            label={INVOICE_STATUS_STYLE[invoice.status].label}
                            chip={INVOICE_STATUS_STYLE[invoice.status].chip}
                          />
                        </TableCell>
                        <TableCell>
                          <InvoiceActions invoice={invoice} can={invoiceCan} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableWrap>

              {/* Mobile cards */}
              <ul className="space-y-2 md:hidden">
                {resident.invoices.map((invoice) => (
                  <li
                    key={invoice.id}
                    className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <a href={`/api/documents/rent-invoice/${invoice.id}.pdf`} target="_blank" rel="noopener" className="truncate font-medium text-slate-900 hover:text-blue-700 hover:underline">
                        {invoice.number}
                      </a>
                      <div className="flex shrink-0 items-center gap-1">
                        <StatusChip
                          label={INVOICE_STATUS_STYLE[invoice.status].label}
                          chip={INVOICE_STATUS_STYLE[invoice.status].chip}
                        />
                        <InvoiceActions invoice={invoice} can={invoiceCan} />
                      </div>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {formatDate(invoice.periodStart)} · due {formatDate(invoice.dueDate)}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {invoice.lines.map((l) => l.label.split('—')[0].trim()).join(' · ')}
                    </p>
                    <div className="mt-2 flex items-center justify-between gap-2 text-sm">
                      <span className="text-xs text-slate-500 tabular">
                        {formatMoney(invoice.total)} ·{' '}
                        <span className="text-emerald-600">{formatMoney(invoice.amountPaid)} paid</span>
                      </span>
                      <span
                        className={cn(
                          'font-semibold tabular',
                          invoice.balance > 0 ? 'text-rose-600' : 'text-slate-400',
                        )}
                      >
                        {invoice.balance > 0 ? formatMoney(invoice.balance) : 'Paid'}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}

          {resident.payments.length > 0 && (
            <Card className="mt-4">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Payments received</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-y divide-slate-100">
                  {resident.payments.slice(0, 24).map((payment) => (
                    <li key={payment.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-800">
                          <a href={`/api/documents/rent-receipt/${payment.id}.pdf`} className="hover:text-blue-700 hover:underline" target="_blank" rel="noopener" title="Download receipt">
                            {payment.receiptNumber}
                          </a>
                          {payment.isDemo && (
                            <Badge variant="warning" size="sm" className="ml-2">
                              Demo payment
                            </Badge>
                          )}
                        </p>
                        <p className="text-xs text-slate-500">
                          {formatDateTime(payment.paidAt)} ·{' '}
                          {payment.method.replace('_', ' ').toLowerCase()}
                          {payment.utr ? ` · UTR ${payment.utr}` : ''}
                          {payment.reference ? ` · ${payment.reference}` : ''}
                          {payment.purpose === 'DEPOSIT' ? ' · deposit' : ''}
                        </p>
                        {payment.status === 'REVERSED' && payment.reversalReason && (
                          <p className="text-[11px] text-rose-600">Reversed — {payment.reversalReason}</p>
                        )}
                        {payment.attachmentUrl && (
                          <a href={payment.attachmentUrl} target="_blank" rel="noopener" className="text-[11px] text-blue-600 hover:underline">
                            View proof
                          </a>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <div className="text-right">
                          <span
                            className={cn(
                              'font-semibold tabular',
                              payment.status === 'REVERSED' ? 'text-slate-400 line-through' : 'text-emerald-600',
                            )}
                          >
                            {formatMoney(payment.amount)}
                          </span>
                          <div>
                            <PaymentStatusBadge status={payment.status} refundedAmount={payment.refundedAmount} />
                          </div>
                        </div>
                        <PaymentActions
                          can={paymentCan}
                          payment={{
                            id: payment.id,
                            residentId: resident.id,
                            receiptNumber: payment.receiptNumber,
                            amount: payment.amount,
                            status: payment.status,
                            purpose: payment.purpose,
                            method: payment.method,
                            reference: payment.reference,
                            utr: payment.utr,
                            notes: payment.notes,
                            attachmentUrl: payment.attachmentUrl,
                            refundedAmount: payment.refundedAmount,
                            unallocated: unallocatedOf(payment),
                          }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ------------------------------------------------------- Ledger */}
        <TabsContent value="ledger">
          <LedgerTable
            entries={resident.ledger.map((e) => ({
              id: e.id,
              date: e.entryDate.toISOString(),
              kind: e.kind,
              label: e.label,
              debit: e.debit,
              credit: e.credit,
              balance: e.balance,
            }))}
            depositCollected={resident.deposit?.collected ?? 0}
          />
        </TabsContent>

        {/* ---------------------------------------------------- Documents */}
        <TabsContent value="documents">
          {resident.documents.length === 0 ? (
            <EmptyState
              icon="file"
              title="No documents uploaded"
              description="ID proofs and the signed admission form appear here once uploaded."
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {resident.documents.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-xs"
                >
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-slate-100">
                    <IdCard className="size-5 text-slate-500" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">{doc.label}</p>
                    <p className="text-xs text-slate-500">
                      {doc.kind.replace('_', ' ').toLowerCase()} · {formatDate(doc.uploadedAt)}
                    </p>
                    {doc.verified ? (
                      <Badge variant="success" size="sm" className="mt-1.5">
                        <BadgeCheck className="size-3" />
                        Verified
                      </Badge>
                    ) : (
                      <Badge variant="warning" size="sm" className="mt-1.5">
                        Pending check
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500">
            <FileText className="size-3.5" />
            This demo stores document records without uploading files. Connect object storage to
            hold the actual scans.
          </p>
        </TabsContent>

        {/* --------------------------------------------------- Complaints */}
        <TabsContent value="complaints">
          {resident.complaints.length === 0 ? (
            <EmptyState
              icon="wrench"
              title="No complaints raised"
              description="Anything this resident reports from the app will show up here."
            />
          ) : (
            <ul className="space-y-2">
              {resident.complaints.map((complaint) => (
                <li key={complaint.id}>
                  <Link
                    href={`/app/complaints/${complaint.id}`}
                    className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-xs transition-shadow hover:border-slate-300"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">{complaint.title}</p>
                      <p className="text-xs text-slate-500">
                        {complaint.code} · {categoryLabels[complaint.category] ?? complaint.category} ·{' '}
                        {formatDate(complaint.createdAt)}
                      </p>
                    </div>
                    <StatusChip
                      label={COMPLAINT_STATUS_STYLE[complaint.status].label}
                      chip={COMPLAINT_STATUS_STYLE[complaint.status].chip}
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>

    </div>
  )
}

function HeaderStat({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'ok' | 'warn'
}) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p
        className={cn(
          'font-display text-sm font-semibold tabular',
          tone === 'warn' ? 'text-rose-600' : 'text-slate-900',
        )}
      >
        {value}
      </p>
    </div>
  )
}

function Detail({
  label,
  value,
  className,
}: {
  label: string
  value?: string | null
  className?: string
}) {
  return (
    <div className={className}>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-800">{value || '—'}</dd>
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
