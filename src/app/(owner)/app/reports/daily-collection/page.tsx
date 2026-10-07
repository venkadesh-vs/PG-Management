import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { Download, Equal, Minus, Plus } from 'lucide-react'
import { requireAccess } from '@/lib/auth'
import { resolveScope } from '@/lib/tenancy'
import { prisma } from '@/lib/prisma'
import { cn, formatDateLong, formatMoney, toISODate } from '@/lib/utils'
import { dailyCollectionReport } from '@/server/services/billing'
import { PageHeader } from '@/components/app/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/feedback'
import { FilterBar, FilterSelect } from '@/components/app/filters'
import { DayPicker } from './day-picker'

export const metadata: Metadata = { title: 'Daily collection' }

const METHOD_LABEL: Record<string, string> = {
  CASH: 'Cash',
  UPI: 'UPI',
  BANK_TRANSFER: 'Bank transfer',
  CARD: 'Card',
  CHEQUE: 'Cheque',
  GATEWAY: 'Online (Razorpay)',
  ADJUSTMENT: 'Adjustment',
  OTHER: 'Other',
}

function parseDay(value: string | undefined) {
  const m = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date()
  return Number.isNaN(d.getTime()) || d > new Date() ? new Date() : d
}

/**
 * Daily collection report: what was owed this morning, what was billed and
 * collected today, what was adjusted, and what is owed tonight — with every
 * entry behind each number. Built from the resident ledger, so the equation
 * always closes.
 */
export default async function DailyCollectionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const user = await requireAccess({ module: 'rent', permission: 'rent.view' })
  const params = await searchParams
  const scope = await resolveScope(user, params.property)
  const propertyIds = scope.propertyId ? [scope.propertyId] : scope.allowedPropertyIds
  const day = parseDay(params.date)
  const dayISO = toISODate(day)

  const [report, properties] = await Promise.all([
    dailyCollectionReport({ organizationId: scope.organizationId, propertyIds, date: day }),
    prisma.property.findMany({
      where: { id: { in: scope.allowedPropertyIds } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ])

  const exportQuery = new URLSearchParams({ date: dayISO, ...(params.property ? { property: params.property } : {}) })
  const canExport = user.permissions.includes('reports.export')
  const lists = report.lists
  const quiet = !lists.invoiced.length && !lists.collected.length && !lists.adjustments.length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Daily collection"
        subtitle={formatDateLong(day)}
        icon="money"
        breadcrumbs={[
          { label: 'Dashboard', href: '/app' },
          { label: 'Payments', href: '/app/payments' },
          { label: 'Daily collection' },
        ]}
        actions={
          canExport ? (
            <Button variant="outline" asChild>
              <a href={`/api/exports/daily-collection.csv?${exportQuery}`} download>
                <Download className="size-4" />
                Export CSV
              </a>
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <Suspense fallback={null}>
          <DayPicker value={dayISO} />
        </Suspense>
        {properties.length > 1 && (
          <Suspense fallback={null}>
            <FilterBar activeCount={params.property ? 1 : 0}>
              <FilterSelect
                paramKey="property"
                placeholder="All PGs"
                options={properties.map((p) => ({ value: p.id, label: p.name }))}
              />
            </FilterBar>
          </Suspense>
        )}
      </div>

      {/* The equation */}
      <Card>
        <CardContent className="p-4 sm:p-6">
          <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-center sm:gap-2">
            <Figure label="Opening outstanding" value={report.opening} href="#opening" />
            <Op icon={<Plus className="size-4" />} />
            <Figure label="Invoiced today" value={report.invoiced} tone="amber" href="#invoiced" />
            <Op icon={<Minus className="size-4" />} />
            <Figure label="Collected today" value={report.collected} tone="emerald" href="#collected" />
            <Op icon={<span className="text-sm font-semibold">±</span>} />
            <Figure label="Adjustments" value={report.adjustments} signed tone="violet" href="#adjustments" />
            <Op icon={<Equal className="size-4" />} />
            <Figure label="Closing outstanding" value={report.closing} strong />
          </div>
          <p className="mt-4 text-xs text-slate-500">
            {formatMoney(report.opening)} + {formatMoney(report.invoiced)} − {formatMoney(report.collected)}{' '}
            {report.adjustments < 0 ? '−' : '+'} {formatMoney(Math.abs(report.adjustments))} ={' '}
            <span className="font-semibold text-slate-700">{formatMoney(report.closing)}</span>. Outstanding is
            net of advances (money paid ahead lowers it). Adjustments cover credit and debit notes,
            waivers, reversals, refunds and deposits applied at checkout.
          </p>
          {Object.keys(report.byMethod).length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {Object.entries(report.byMethod)
                .sort((a, b) => b[1] - a[1])
                .map(([method, amount]) => (
                  <span key={method} className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800">
                    {METHOD_LABEL[method] ?? method}: {formatMoney(amount)}
                  </span>
                ))}
            </div>
          )}
        </CardContent>
      </Card>

      {quiet && (
        <EmptyState
          icon="money"
          title="No money moved on this day"
          description="No invoices, payments or adjustments were recorded. The closing outstanding equals the opening."
        />
      )}

      <EntryList id="invoiced" title="Invoiced today" rows={lists.invoiced} side="debit" />
      <EntryList id="collected" title="Collected today" rows={lists.collected} side="credit" />
      <EntryList id="adjustments" title="Adjustments" rows={lists.adjustments} side="signed" />

      <Card id="opening">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between text-sm">
            <span>Opening outstanding by resident</span>
            <span className="tabular text-slate-500">{formatMoney(report.opening)}</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {report.openingByResident.length === 0 ? (
            <p className="text-sm text-slate-500">Nobody owed anything at the start of the day.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {report.openingByResident.map((r) => (
                <li key={r.residentId} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <Link href={`/app/residents/${r.residentId}`} className="min-w-0 hover:text-blue-700">
                    <span className="block truncate font-medium text-slate-800">{r.resident}</span>
                    <span className="block text-xs text-slate-500">
                      {r.code}
                      {properties.length > 1 ? ` · ${r.property}` : ''}
                    </span>
                  </Link>
                  <span className={cn('shrink-0 font-semibold tabular', r.balance > 0 ? 'text-red-600' : 'text-emerald-600')}>
                    {r.balance < 0 ? `${formatMoney(-r.balance)} advance` : formatMoney(r.balance)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Op({ icon }: { icon: React.ReactNode }) {
  return <span className="hidden size-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 sm:flex">{icon}</span>
}

function Figure({
  label,
  value,
  tone,
  strong,
  signed,
  href,
}: {
  label: string
  value: number
  tone?: 'amber' | 'emerald' | 'violet'
  strong?: boolean
  signed?: boolean
  href?: string
}) {
  const body = (
    <>
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p
        className={cn(
          'font-display text-lg font-semibold tabular',
          strong ? 'text-slate-900' : tone === 'emerald' ? 'text-emerald-700' : tone === 'amber' ? 'text-amber-700' : tone === 'violet' ? 'text-violet-700' : 'text-slate-800',
        )}
      >
        {signed && value > 0 ? '+' : signed && value < 0 ? '−' : ''}
        {formatMoney(Math.abs(value))}
      </p>
    </>
  )
  const cls = cn(
    'min-w-0 flex-1 rounded-xl border px-3 py-2',
    strong ? 'col-span-2 border-slate-300 bg-slate-50 sm:col-span-1' : 'border-slate-200 bg-white',
  )
  return href ? (
    <a href={href} className={cn(cls, 'transition-colors hover:border-blue-300')}>
      {body}
    </a>
  ) : (
    <div className={cls}>{body}</div>
  )
}

type EntryRow = Awaited<ReturnType<typeof dailyCollectionReport>>['lists']['invoiced'][number]

function EntryList({
  id,
  title,
  rows,
  side,
}: {
  id: string
  title: string
  rows: EntryRow[]
  side: 'debit' | 'credit' | 'signed'
}) {
  const total = rows.reduce((s, r) => s + (side === 'debit' ? r.debit : side === 'credit' ? r.credit : r.debit - r.credit), 0)
  return (
    <Card id={id}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-sm">
          <span>
            {title} <span className="font-normal text-slate-400">({rows.length})</span>
          </span>
          <span className="tabular text-slate-500">
            {side === 'signed' && total > 0 ? '+' : side === 'signed' && total < 0 ? '−' : ''}
            {formatMoney(Math.abs(total))}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing on this day.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => {
              const amount = side === 'debit' ? r.debit : side === 'credit' ? r.credit : r.debit - r.credit
              return (
                <li key={r.id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <Link href={`/app/residents/${r.residentId}`} className="font-medium text-slate-800 hover:text-blue-700">
                      {r.resident}
                    </Link>
                    <span className="ml-1.5 text-xs text-slate-400">{r.code}</span>
                    <p className="text-xs text-slate-500">
                      {r.label}
                      {r.method ? ` · ${METHOD_LABEL[r.method] ?? r.method}` : ''}
                      {r.reference ? ` · ${r.reference}` : ''}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      {r.at.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}
                    </p>
                  </div>
                  <span
                    className={cn(
                      'shrink-0 font-semibold tabular',
                      side === 'credit' ? 'text-emerald-600' : side === 'debit' ? 'text-slate-800' : amount < 0 ? 'text-emerald-600' : 'text-amber-700',
                    )}
                  >
                    {side === 'signed' ? (amount < 0 ? '− ' : '+ ') : ''}
                    {formatMoney(Math.abs(amount))}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
