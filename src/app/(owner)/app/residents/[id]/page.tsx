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
import { requireOrgUser } from '@/lib/auth'
import { assertResidentAccess } from '@/lib/tenancy'
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
import { ResidentActions } from './resident-actions'
import { ResendInviteButton } from '@/components/app/invite-link'
import { LedgerTable } from './ledger-table'

export const metadata: Metadata = { title: 'Resident' }

export default async function ResidentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await requireOrgUser()
  const { id } = await params
  await assertResidentAccess(user, id)

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
      payments: { orderBy: { paidAt: 'desc' } },
      ledger: { orderBy: [{ entryDate: 'asc' }, { createdAt: 'asc' }] },
      complaints: { orderBy: { createdAt: 'desc' }, take: 10 },
      utilityCharges: { orderBy: { periodStart: 'desc' }, take: 6 },
    },
  })
  if (!resident) notFound()

  const theme = themeFor(resident.property.type)
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
  const availableBeds = await prisma.bed.findMany({
    where: { propertyId: resident.propertyId, status: 'AVAILABLE' },
    include: { room: { select: { number: true } } },
    orderBy: [{ room: { number: 'asc' } }, { label: 'asc' }],
  })

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
              rentAmount: resident.rentAmount,
              outstanding,
              exitDate: resident.exitDate?.toISOString() ?? null,
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
            }))}
          />
        }
      />

      {/* ------------------------------------------------ Identity header */}
      <div
        className={cn(
          'relative overflow-hidden rounded-3xl bg-gradient-to-br p-6 text-white shadow-elevated',
          theme.gradient,
        )}
      >
        <div className="dot-grid absolute inset-0 opacity-[0.12]" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
          <Avatar className="size-16 border-2 border-white/30">
            <AvatarFallback className="bg-white/15 text-lg font-semibold text-white">
              {initials(resident.fullName)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-xl font-semibold tracking-tight">
                {resident.fullName}
              </h2>
              <StatusChip
                label={RESIDENT_STATUS_STYLE[resident.status].label}
                chip="border-white/25 bg-white/15 text-white"
              />
              {resident.kycStatus === 'VERIFIED' && (
                <span className="inline-flex items-center gap-1 rounded-full border border-white/25 bg-white/15 px-2 py-0.5 text-[11px] font-medium">
                  <ShieldCheck className="size-3" />
                  KYC verified
                </span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-white/80">
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
            <HeaderStat label="Rent" value={formatMoney(resident.rentAmount)} />
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
          <TabsTrigger value="complaints">Complaints</TabsTrigger>
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
                      ? `${resident.guardianName}${resident.guardianRelation ? ` (${resident.guardianRelation})` : ''}`
                      : null
                  }
                />
                <Detail label="Guardian mobile" value={formatPhone(resident.guardianPhone)} />
                <Detail
                  label="ID proof"
                  value={
                    resident.idNumber
                      ? `${resident.idType ?? 'ID'} · ${maskId(resident.idNumber)}`
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
                  <Row label="Monthly rent" value={formatMoney(resident.rentAmount)} />
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
                  <div className="border-t border-slate-100 pt-2">
                    <Row
                      label="Deposit"
                      value={`${formatMoney(resident.deposit?.collected ?? 0)} of ${formatMoney(resident.depositAmount)}`}
                    />
                    <Row
                      label="Deposit status"
                      value={(resident.deposit?.status ?? 'PENDING').replace('_', ' ').toLowerCase()}
                    />
                  </div>
                </CardContent>
              </Card>

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
                  {resident.status !== 'CHECKED_OUT' && (
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
                <Card className="border-slate-300 bg-slate-50">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Final settlement</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <Row label="Deposit held" value={formatMoney(resident.checkout.depositHeld)} />
                    <Row label="Dues adjusted" value={formatMoney(resident.checkout.outstandingRent + resident.checkout.proRataRent)} />
                    <Row label="Deductions" value={formatMoney(resident.checkout.damageDeduction)} />
                    <Row label="Refunded" value={formatMoney(resident.checkout.refundAmount)} />
                    {resident.checkout.settlementNote && (
                      <p className="pt-1 text-xs text-slate-500">{resident.checkout.settlementNote}</p>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </TabsContent>

        {/* --------------------------------------------------------- Rent */}
        <TabsContent value="rent">
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
                            invoice.balance > 0 ? 'text-red-600' : 'text-slate-400',
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
                    className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <a href={`/api/documents/rent-invoice/${invoice.id}.pdf`} target="_blank" rel="noopener" className="truncate font-medium text-slate-900 hover:text-blue-700 hover:underline">
                        {invoice.number}
                      </a>
                      <StatusChip
                        label={INVOICE_STATUS_STYLE[invoice.status].label}
                        chip={INVOICE_STATUS_STYLE[invoice.status].chip}
                      />
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
                          invoice.balance > 0 ? 'text-red-600' : 'text-slate-400',
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
                  {resident.payments.slice(0, 12).map((payment) => (
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
                          {payment.reference ? ` · ${payment.reference}` : ''}
                        </p>
                      </div>
                      <span className="shrink-0 font-semibold text-emerald-600 tabular">
                        {formatMoney(payment.amount)}
                      </span>
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
                  className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-card"
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
                    className="flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-card transition-shadow hover:shadow-elevated"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">{complaint.title}</p>
                      <p className="text-xs text-slate-500">
                        {complaint.code} · {complaint.category.toLowerCase()} ·{' '}
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
    <div className="rounded-xl border border-white/15 bg-white/10 px-3 py-2 backdrop-blur">
      <p className="text-[10px] uppercase tracking-wide text-white/60">{label}</p>
      <p
        className={cn(
          'font-display text-sm font-semibold tabular',
          tone === 'warn' ? 'text-amber-200' : 'text-white',
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
      <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
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
