import Link from 'next/link'
import { AlertTriangle, Repeat } from 'lucide-react'
import { cn, formatDate, formatMoney } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { autopaySettings, listMandates } from '@/server/services/resident-autopay'

const STATUS: Record<string, { label: string; tone: string }> = {
  ACTIVE: { label: 'On', tone: 'bg-emerald-50 text-emerald-700' },
  PENDING: { label: 'Setting up', tone: 'bg-amber-50 text-amber-700' },
  PAUSED: { label: 'Paused', tone: 'bg-slate-100 text-slate-600' },
  FAILED: { label: 'Failed', tone: 'bg-rose-50 text-rose-700' },
}

/** Rent & Payments: who pays by AutoPay, their day, the next debit and anything failing. */
export async function AutopayPanel({ organizationId, propertyIds }: { organizationId: string; propertyIds: string[] }) {
  const settings = await autopaySettings(organizationId)
  const data = await listMandates({ organizationId, propertyIds })
  if (!settings.enabled && data.mandates.length === 0) return null
  const active = data.mandates.filter((m) => m.status === 'ACTIVE').length
  const failing = data.mandates.filter((m) => m.status === 'FAILED' || (m.lastError && m.status === 'ACTIVE')).length

  return (
    <Card>
      <CardContent className="space-y-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
              <Repeat className="size-4" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">AutoPay</p>
              <p className="text-xs text-slate-500">
                {active} resident{active === 1 ? '' : 's'} pay automatically
                {failing ? ` · ${failing} need${failing === 1 ? 's' : ''} attention` : ''} · days {data.window.min}–{data.window.max}
              </p>
            </div>
          </div>
          <Link href="/app/settings?tab=billing" className="text-xs font-medium text-blue-700 hover:underline">
            AutoPay settings
          </Link>
        </div>

        {!settings.enabled && (
          <p className="text-xs text-slate-500">AutoPay is switched off for new residents. Existing AutoPays keep running until cancelled.</p>
        )}

        {data.outsideWindow > 0 && (
          <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            {data.outsideWindow} resident{data.outsideWindow === 1 ? ' has a date' : 's have dates'} outside {data.window.min}–{data.window.max}. They are still debited on
            their old day; open their profile to pick a new one.
          </p>
        )}

        {data.mandates.length === 0 ? (
          <p className="text-xs text-slate-500">Nobody has set up AutoPay yet. Residents see a &quot;Set up AutoPay&quot; card on their Rent page.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.mandates.slice(0, 8).map((m) => {
              const meta = STATUS[m.status] ?? STATUS.PENDING
              return (
                <li key={m.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0">
                    <Link href={`/app/residents/${m.residentId}`} className="block truncate font-medium text-slate-900 hover:underline">
                      {m.resident}
                      {m.room ? <span className="font-normal text-slate-500"> · {m.room}</span> : null}
                    </Link>
                    <span className="block truncate text-xs text-slate-500">
                      {m.method} · {m.dayLabel}
                      {m.dayOutsideWindow ? ' (outside window)' : ''} · up to {formatMoney(m.maxAmount)}
                      {m.lastError ? ` · ${m.lastError}` : ''}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className={cn('rounded-md px-1.5 py-0.5 text-[11px] font-medium', meta.tone)}>{meta.label}</span>
                    {m.next && (
                      <span className="text-[11px] tabular-nums text-slate-500">
                        {formatMoney(m.next.amount)} · {formatDate(m.next.chargeDate)}
                      </span>
                    )}
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
