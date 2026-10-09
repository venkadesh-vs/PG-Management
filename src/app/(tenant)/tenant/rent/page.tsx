import type { Metadata } from 'next'
import { CheckCircle2, Download, Receipt } from 'lucide-react'
import { requireTenant } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { INVOICE_STATUS_STYLE, themeFor } from '@/lib/theme'
import { cn, daysBetween, formatDate, formatDateTime, formatMoney, formatMonth, startOfDay } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { Badge, StatusChip } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/feedback'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives'
import { PayRentButton } from './pay-rent-button'
import { AutopayCard } from './autopay-card'
import { residentAutopayStatus } from '@/server/services/resident-autopay'

export const metadata: Metadata = { title: 'Rent & Payments' }

export default async function TenantRentPage() {
  const user = await requireTenant()
  const today = startOfDay(new Date())

  const resident = await prisma.resident.findUnique({
    where: { id: user.residentId },
    include: {
      property: true,
      deposit: true,
      invoices: { orderBy: { periodStart: 'desc' }, include: { lines: true } },
      payments: { where: { status: 'SUCCESS' }, orderBy: { paidAt: 'desc' } },
      ledger: { orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }], take: 40 },
      // One-time charges confirmed but not yet on an invoice (e.g. last month's electricity share).
      charges: {
        where: { kind: 'ONE_TIME', billedInvoiceId: null, voidedAt: null },
        orderBy: { startDate: 'asc' },
      },
    },
  })
  if (!resident) return null

  const theme = themeFor(resident.property.type)
  // AutoPay is optional and must never break the rent page.
  const autopay = await residentAutopayStatus(resident.id).catch(() => null)
  const open = resident.invoices.filter((i) =>
    ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'].includes(i.status),
  )
  const outstanding = open.reduce((s, i) => s + i.balance, 0)
  const paidTotal = resident.payments.reduce((s, p) => s + p.amount, 0)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight text-slate-900">
          Rent & payments
        </h1>
        <p className="mt-0.5 text-sm text-slate-500">
          Your invoices, receipts and running account.
        </p>
      </div>

      {/* --------------------------------------------------- Amount due */}
      <Card className={cn(outstanding > 0 ? 'border-amber-200' : 'border-emerald-200')}>
        <CardContent className="p-5">
          {outstanding > 0 ? (
            <>
              <p className="text-xs font-medium text-slate-500">
                Total outstanding
              </p>
              <p className="mt-1 font-display text-3xl font-semibold text-slate-900 tabular">
                {formatMoney(outstanding)}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                Across {open.length} invoice{open.length === 1 ? '' : 's'}
              </p>
              <div className="mt-4">
                {/* One invoice: pay it. Several: pay the whole outstanding at
                    once (oldest first); single invoices can be paid below. */}
                <PayRentButton
                  invoice={open.length === 1 ? { id: open[0].id, number: open[0].number } : null}
                  amount={outstanding}
                  label={open.length === 1 ? undefined : `Pay all ${formatMoney(outstanding)}`}
                  propertyType={resident.property.type}
                />
              </div>
            </>
          ) : (
            <div className="flex items-center gap-3">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50">
                <CheckCircle2 className="size-5 text-emerald-600" />
              </div>
              <div>
                <p className="font-display text-base font-semibold text-slate-900">Nothing due</p>
                <p className="text-sm text-slate-500">
                  You have paid {formatMoney(paidTotal)} in total so far.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {autopay && <AutopayCard status={autopay} />}

      {/* ------------------------------------- Coming on next invoice */}
      {resident.charges.length > 0 && (
        <Card>
          <CardContent className="space-y-3 p-5">
            <div>
              <p className="text-sm font-semibold text-slate-900">Coming on your next rent invoice</p>
              <p className="mt-0.5 text-xs text-slate-500">
                Your PG has added these. They will be included in your next rent invoice, so you pay them together with your rent.
              </p>
            </div>
            <ul className="divide-y divide-slate-100 text-sm">
              {resident.charges.map((charge) => (
                <li key={charge.id} className="flex items-start justify-between gap-3 py-2">
                  <LineLabel label={charge.label} kind={charge.category} />
                  <span className="shrink-0 font-medium tabular-nums text-slate-900">{formatMoney(charge.amount)}</span>
                </li>
              ))}
            </ul>
            {resident.charges.length > 1 && (
              <p className="flex justify-between border-t border-slate-100 pt-2 text-sm">
                <span className="text-slate-500">Total to be added</span>
                <span className="font-semibold tabular-nums text-slate-900">
                  {formatMoney(resident.charges.reduce((sum, c) => sum + c.amount, 0))}
                </span>
              </p>
            )}
            {resident.charges.some((c) => isElectricityLine({ kind: c.category, label: c.label })) && <ElectricityExplainer />}
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="invoices">
        <TabsList className="w-full">
          <TabsTrigger value="invoices" className="flex-1">
            Invoices
          </TabsTrigger>
          <TabsTrigger value="receipts" className="flex-1">
            Receipts
          </TabsTrigger>
          <TabsTrigger value="ledger" className="flex-1">
            Account
          </TabsTrigger>
        </TabsList>

        {/* ----------------------------------------------------- Invoices */}
        <TabsContent value="invoices">
          {resident.invoices.length === 0 ? (
            <EmptyState
              icon="file"
              title="No invoices yet"
              description="Your first rent invoice will appear here once it is generated."
            />
          ) : (
            <div className="space-y-3">
            {resident.invoices.some((i) => i.lines.some(isElectricityLine)) && <ElectricityExplainer />}
            <ul className="space-y-3">
              {resident.invoices.map((invoice) => {
                const overdueDays = daysBetween(invoice.dueDate, today)
                const unpaid = invoice.balance > 0
                return (
                  <li key={invoice.id}>
                    <Card className={cn(unpaid && invoice.status === 'OVERDUE' && 'border-rose-200')}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-display text-sm font-semibold text-slate-900">
                              {formatMonth(invoice.periodStart)}
                            </p>
                            <p className="font-mono text-[11px] text-slate-500">{invoice.number}</p>
                          </div>
                          <StatusChip
                            label={INVOICE_STATUS_STYLE[invoice.status].label}
                            chip={INVOICE_STATUS_STYLE[invoice.status].chip}
                          />
                        </div>

                        <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3">
                          {invoice.lines.map((line) => (
                            <li
                              key={line.id}
                              className="flex items-start justify-between gap-3 text-sm"
                            >
                              <LineLabel label={line.label} kind={line.kind} />
                              <span
                                className={cn(
                                  'shrink-0 font-medium tabular',
                                  line.kind === 'DISCOUNT' ? 'text-emerald-600' : 'text-slate-800',
                                )}
                              >
                                {line.kind === 'DISCOUNT' ? '− ' : ''}
                                {formatMoney(line.amount)}
                              </span>
                            </li>
                          ))}
                          {invoice.discount > 0 && (
                            <li className="flex items-center justify-between text-sm text-emerald-600">
                              <span>Discount</span>
                              <span className="font-medium tabular">
                                − {formatMoney(invoice.discount)}
                              </span>
                            </li>
                          )}
                        </ul>

                        <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
                          <div>
                            <p className="text-xs text-slate-500">
                              Due {formatDate(invoice.dueDate)}
                              {unpaid && overdueDays > 0 && (
                                <span className="ml-1 font-semibold text-rose-600">
                                  · {overdueDays} days overdue
                                </span>
                              )}
                            </p>
                            <p className="font-display text-lg font-semibold text-slate-900 tabular">
                              {formatMoney(unpaid ? invoice.balance : invoice.total)}
                            </p>
                          </div>
                          {unpaid ? (
                            <PayRentButton
                              size="sm"
                              invoice={{ id: invoice.id, number: invoice.number }}
                              amount={invoice.balance}
                              propertyType={resident.property.type}
                            />
                          ) : (
                            <Badge variant="success">
                              <CheckCircle2 className="size-3" />
                              Paid {invoice.paidAt ? formatDate(invoice.paidAt) : ''}
                            </Badge>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </li>
                )
              })}
            </ul>
            </div>
          )}
        </TabsContent>

        {/* ----------------------------------------------------- Receipts */}
        <TabsContent value="receipts">
          {resident.payments.length === 0 ? (
            <EmptyState
              icon="receipt"
              title="No payments yet"
              description="Your receipts appear here the moment a payment is recorded."
            />
          ) : (
            <ul className="space-y-2">
              {resident.payments.map((payment) => (
                <li key={payment.id}>
                  <Card>
                    <CardContent className="flex items-center gap-3 p-4">
                      <div className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl', theme.bg)}>
                        <Receipt className={cn('size-4', theme.text)} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-sm font-medium text-slate-800">
                          {payment.receiptNumber}
                        </p>
                        <p className="text-xs text-slate-500">
                          {formatDateTime(payment.paidAt)} ·{' '}
                          {payment.method.replace('_', ' ').toLowerCase()}
                        </p>
                        {payment.isDemo && (
                          <Badge variant="warning" size="sm" className="mt-1">
                            Demo payment
                          </Badge>
                        )}
                      </div>
                      <span className="shrink-0 font-display text-base font-semibold text-emerald-600 tabular">
                        {formatMoney(payment.amount)}
                      </span>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-400">
            <Download className="size-3.5" />
            Use your browser&apos;s print option to save any receipt as a PDF.
          </p>
        </TabsContent>

        {/* ------------------------------------------------------- Ledger */}
        <TabsContent value="ledger">
          <Card>
            <CardContent className="p-4">
              <div className="mb-3 flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <p className="text-xs font-medium text-slate-500">Current balance</p>
                  <p
                    className={cn(
                      'font-display text-xl font-semibold tabular',
                      outstanding > 0 ? 'text-rose-600' : 'text-emerald-600',
                    )}
                  >
                    {outstanding > 0 ? formatMoney(outstanding) : 'Settled'}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-medium text-slate-500">Deposit held</p>
                  <p className="font-display text-xl font-semibold text-slate-900 tabular">
                    {formatMoney(resident.deposit?.collected ?? 0)}
                  </p>
                </div>
              </div>

              {resident.ledger.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500">
                  Nothing on your account yet.
                </p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {resident.ledger.map((entry) => (
                    <li key={entry.id} className="flex items-start justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm text-slate-700">{entry.label}</p>
                        <p className="text-xs text-slate-400">{formatDate(entry.entryDate)}</p>
                      </div>
                      <span
                        className={cn(
                          'shrink-0 text-sm font-medium tabular',
                          entry.credit > 0 ? 'text-emerald-600' : 'text-slate-800',
                        )}
                      >
                        {entry.credit > 0
                          ? `− ${formatMoney(entry.credit)}`
                          : entry.debit > 0
                            ? formatMoney(entry.debit)
                            : '—'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function isElectricityLine(line: { kind: string; label: string }) {
  return line.kind === 'ELECTRICITY' || line.label.startsWith('Electricity ')
}

/** Electricity lines carry their working ("90 units × ₹13 = ₹1170, 30 of 30 days, 3 sharing"); show it as a second line. */
function LineLabel({ label, kind }: { label: string; kind: string }) {
  if (!isElectricityLine({ kind, label })) return <span className="text-slate-600">{label}</span>
  const parts = label.split(' · ')
  return (
    <span className="min-w-0">
      <span className="block text-slate-600">{parts.slice(0, 2).join(' · ')}</span>
      {parts.length > 2 && <span className="block text-xs text-slate-500">{parts.slice(2).join(' · ')}</span>}
    </span>
  )
}

function ElectricityExplainer() {
  return (
    <details className="group rounded-xl border border-slate-200 bg-white p-4 text-sm">
      <summary className="cursor-pointer list-none font-medium text-slate-900 marker:hidden">
        How is my electricity calculated?
      </summary>
      <div className="mt-2 space-y-2 text-slate-600">
        <p>Your room has its own meter. Each month the units used (this reading minus the last one) are multiplied by that month&apos;s rate per unit to give the room&apos;s bill.</p>
        <p>The room&apos;s bill is shared only by the people who actually stayed in the room during that period, never by empty beds. If someone moved in or out partway, everyone pays for their own days.</p>
        <p>Your share is shown under each electricity line, and it is added to your rent invoice so you pay once.</p>
      </div>
    </details>
  )
}
