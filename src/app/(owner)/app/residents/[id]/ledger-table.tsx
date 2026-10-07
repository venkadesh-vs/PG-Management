'use client'

import { motion } from 'framer-motion'
import { ArrowDownLeft, ArrowUpRight, Scale } from 'lucide-react'
import { cn, formatDate, formatMoney } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/feedback'
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  TableWrap,
} from '@/components/ui/table'

type Entry = {
  id: string
  date: string
  kind: string
  label: string
  debit: number
  credit: number
  balance: number
}

const KIND_STYLE: Record<string, string> = {
  CHARGE: 'text-slate-700',
  PAYMENT: 'text-emerald-600',
  DISCOUNT: 'text-violet-600',
  ADJUSTMENT: 'text-amber-600',
  DEPOSIT: 'text-sky-600',
  REFUND: 'text-sky-600',
  WAIVER: 'text-violet-600',
}

/**
 * The resident's running account: every charge, payment, discount, deposit
 * movement and adjustment, oldest first, with the balance carried forward.
 */
export function LedgerTable({
  entries,
  depositCollected,
}: {
  entries: Entry[]
  depositCollected: number
}) {
  if (!entries.length) {
    return (
      <EmptyState
        icon="wallet"
        title="Nothing on the ledger yet"
        description="Charges and payments appear here from the first invoice onwards."
      />
    )
  }

  const totalDebit = entries.reduce((s, e) => s + e.debit, 0)
  const totalCredit = entries.reduce((s, e) => s + e.credit, 0)
  const closing = entries[entries.length - 1]?.balance ?? 0

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard
          label="Total charged"
          value={formatMoney(totalDebit)}
          icon={ArrowUpRight}
          tone="slate"
        />
        <SummaryCard
          label="Total paid"
          value={formatMoney(totalCredit)}
          icon={ArrowDownLeft}
          tone="emerald"
        />
        <SummaryCard
          label={closing > 0 ? 'Balance due' : closing < 0 ? 'Advance held' : 'Settled'}
          value={formatMoney(Math.abs(closing))}
          icon={Scale}
          tone={closing > 0 ? 'red' : 'emerald'}
        />
      </div>

      {/* Desktop table */}
      <TableWrap className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Particulars</TableHead>
              <TableHead className="text-right">Debit</TableHead>
              <TableHead className="text-right">Credit</TableHead>
              <TableHead className="text-right">Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry, i) => (
              <motion.tr
                key={entry.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: Math.min(i * 0.015, 0.25) }}
                className="border-b border-slate-100 transition-colors hover:bg-slate-50/70"
              >
                <TableCell className="whitespace-nowrap text-sm text-slate-600">
                  {formatDate(entry.date)}
                </TableCell>
                <TableCell>
                  <span className={cn('text-sm font-medium', KIND_STYLE[entry.kind] ?? 'text-slate-700')}>
                    {entry.label}
                  </span>
                  <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                    {entry.kind.toLowerCase()}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular">
                  {entry.debit > 0 ? formatMoney(entry.debit) : '—'}
                </TableCell>
                <TableCell className="text-right text-emerald-600 tabular">
                  {entry.credit > 0 ? formatMoney(entry.credit) : '—'}
                </TableCell>
                <TableCell
                  className={cn(
                    'text-right font-semibold tabular',
                    entry.balance > 0 ? 'text-rose-600' : 'text-slate-500',
                  )}
                >
                  {formatMoney(entry.balance)}
                </TableCell>
              </motion.tr>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={2} className="font-semibold text-slate-700">
                Closing balance
                {depositCollected > 0 && (
                  <span className="ml-2 text-xs font-normal text-slate-500">
                    (security deposit of {formatMoney(depositCollected)} held separately)
                  </span>
                )}
              </TableCell>
              <TableCell className="text-right font-semibold tabular">
                {formatMoney(totalDebit)}
              </TableCell>
              <TableCell className="text-right font-semibold text-emerald-600 tabular">
                {formatMoney(totalCredit)}
              </TableCell>
              <TableCell
                className={cn(
                  'text-right font-semibold tabular',
                  closing > 0 ? 'text-rose-600' : 'text-emerald-600',
                )}
              >
                {formatMoney(closing)}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </TableWrap>

      {/* Mobile cards */}
      <ul className="space-y-2 md:hidden">
        {entries.map((entry) => (
          <li
            key={entry.id}
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs"
          >
            <div className="flex items-start justify-between gap-2">
              <p className={cn('min-w-0 text-sm font-medium', KIND_STYLE[entry.kind] ?? 'text-slate-700')}>
                {entry.label}
              </p>
              <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                {entry.kind.toLowerCase()}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-slate-500">{formatDate(entry.date)}</p>
            <div className="mt-2 flex items-center justify-between gap-2 text-sm">
              <span className="tabular">
                {entry.debit > 0 && <span className="text-slate-700">+{formatMoney(entry.debit)}</span>}
                {entry.credit > 0 && (
                  <span className="text-emerald-600">−{formatMoney(entry.credit)}</span>
                )}
              </span>
              <span
                className={cn(
                  'font-semibold tabular',
                  entry.balance > 0 ? 'text-rose-600' : 'text-slate-500',
                )}
              >
                {formatMoney(entry.balance)}
              </span>
            </div>
          </li>
        ))}
        <li className="rounded-xl border border-slate-200 bg-slate-50 p-4 shadow-xs">
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold text-slate-700">Closing balance</p>
            <span
              className={cn(
                'font-semibold tabular',
                closing > 0 ? 'text-rose-600' : 'text-emerald-600',
              )}
            >
              {formatMoney(closing)}
            </span>
          </div>
          {depositCollected > 0 && (
            <p className="mt-0.5 text-xs text-slate-500">
              Security deposit of {formatMoney(depositCollected)} held separately
            </p>
          )}
        </li>
      </ul>
    </div>
  )
}

function SummaryCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string
  value: string
  icon: React.ElementType
  tone: 'slate' | 'emerald' | 'red'
}) {
  const tones = {
    slate: 'bg-slate-100 text-slate-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    red: 'bg-rose-50 text-rose-600',
  }
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className={cn('flex size-10 items-center justify-center rounded-xl', tones[tone])}>
          <Icon className="size-5" />
        </div>
        <div>
          <p className="text-xs text-slate-500">{label}</p>
          <p className="font-display text-lg font-semibold text-slate-900 tabular">{value}</p>
        </div>
      </CardContent>
    </Card>
  )
}
