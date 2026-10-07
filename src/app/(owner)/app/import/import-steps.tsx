'use client'

import * as React from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowLeft, CheckCircle2, Download, FileUp, MinusCircle, RotateCcw, XCircle } from 'lucide-react'
import { errorReportCsv } from '@/lib/csv'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/primitives'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableWrap } from '@/components/ui/table'
import type { ImportKind, RowCheck, RowOutcome } from '@/server/services/import-fields'
import type { Parsed } from './import-wizard'

export type Preview = {
  jobId: string
  checks: RowCheck[]
  notes: string[]
  counts: { ready: number; skip: number; error: number }
}

export type ImportResult = {
  jobId: string
  outcomes: RowOutcome[]
  imported: number
  skipped: number
  failed: number
  message: string
}

const NOUN: Record<ImportKind, [string, string]> = {
  residents: ['resident', 'residents'],
  rooms: ['row', 'rows'],
  balances: ['balance', 'balances'],
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

type Filter = 'all' | 'problems' | 'ready'

export function PreviewStep({
  kind,
  parsed,
  preview,
  busy,
  loginsAvailable,
  whatsappAvailable,
  onBack,
  onReset,
  onConfirm,
}: {
  kind: ImportKind
  parsed: Parsed
  preview: Preview
  busy: boolean
  loginsAvailable: boolean
  whatsappAvailable: boolean
  onBack: () => void
  onReset: () => void
  onConfirm: (o: { stopOnErrors: boolean; createLogins: boolean; sendWelcome: boolean }) => void
}) {
  const { counts } = preview
  const [filter, setFilter] = React.useState<Filter>(counts.error > 0 ? 'problems' : 'all')
  const [stopOnErrors, setStopOnErrors] = React.useState(false)
  const [createLogins, setCreateLogins] = React.useState(false)
  const [sendWelcome, setSendWelcome] = React.useState(false)
  const [limit, setLimit] = React.useState(100)

  const shown = preview.checks.filter((c) =>
    filter === 'all' ? true : filter === 'ready' ? c.status === 'ready' : c.status !== 'ready' || c.warnings.length > 0,
  )
  const blocked = stopOnErrors && counts.error > 0
  const [one, many] = NOUN[kind]

  function downloadReport() {
    const base = parsed.fileName.replace(/\.[^.]+$/, '')
    download(`${base}-errors.csv`, errorReportCsv(parsed.headers, parsed.rows, preview.checks))
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">3. Check and confirm</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          <Tile label="Will import" value={counts.ready} tone="text-emerald-700" />
          <Tile label="Will skip" value={counts.skip} tone="text-slate-700" />
          <Tile label="Has errors" value={counts.error} tone="text-rose-700" />
        </div>

        {preview.notes.map((n) => (
          <p key={n} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {n}
          </p>
        ))}
        {counts.error > 0 && (
          <div className="flex flex-col gap-2 rounded-xl border border-rose-200 bg-rose-50/60 px-3 py-2 text-xs text-rose-800 sm:flex-row sm:items-center sm:justify-between">
            <span>
              Rows with errors are not imported. Download the error report, fix those rows in your sheet and upload it
              again — rows already imported will be skipped.
            </span>
            <Button variant="outline" size="sm" onClick={downloadReport} className="shrink-0 bg-white">
              <Download className="size-3.5" />
              Error report
            </Button>
          </div>
        )}

        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ['all', `All (${preview.checks.length})`],
              ['problems', 'Errors & warnings'],
              ['ready', `Ready (${counts.ready})`],
            ] as [Filter, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium',
                filter === key ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {shown.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">Nothing to show here.</p>
        ) : (
          <>
            <TableWrap className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-14">Row</TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead>Check</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.slice(0, limit).map((c) => (
                    <TableRow key={c.row} className={cn(c.status === 'error' && 'bg-rose-50/40')}>
                      <TableCell className="align-top text-xs text-slate-500 tabular">{c.row}</TableCell>
                      <TableCell className="align-top">
                        <p className="font-medium text-slate-800">{c.title}</p>
                        <p className="text-xs text-slate-500">{c.subtitle}</p>
                      </TableCell>
                      <TableCell className="max-w-sm align-top">
                        <RowStatus check={c} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrap>
            <ul className="space-y-2 md:hidden">
              {shown.slice(0, limit).map((c) => (
                <li
                  key={c.row}
                  className={cn(
                    'rounded-xl border bg-white p-3 shadow-xs',
                    c.status === 'error' ? 'border-rose-200' : 'border-slate-200',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 break-words font-medium text-slate-900">{c.title}</p>
                    <span className="shrink-0 text-[11px] text-slate-400">Row {c.row}</span>
                  </div>
                  {c.subtitle && <p className="mt-0.5 break-words text-xs text-slate-500">{c.subtitle}</p>}
                  <div className="mt-2">
                    <RowStatus check={c} />
                  </div>
                </li>
              ))}
            </ul>
            {shown.length > limit && (
              <div className="text-center">
                <Button variant="ghost" size="sm" onClick={() => setLimit((l) => l + 200)}>
                  Show more ({shown.length - limit} left)
                </Button>
              </div>
            )}
          </>
        )}

        <div className="space-y-2 border-t border-slate-100 pt-4">
          <OptionRow
            label="Stop if any row has errors"
            hint="On: nothing is imported until every row is fixed. Off: ready rows are imported and the rest are listed."
            checked={stopOnErrors}
            onChange={setStopOnErrors}
          />
          {kind === 'residents' && (
            <>
              <OptionRow
                label="Create resident app logins"
                hint={
                  loginsAvailable
                    ? 'Each resident gets an invite link to set their own password (emailed when an email is given).'
                    : 'The resident app is switched off in Settings → Features.'
                }
                checked={loginsAvailable && createLogins}
                disabled={!loginsAvailable}
                onChange={setCreateLogins}
              />
              <OptionRow
                label="Send welcome messages on WhatsApp"
                hint={
                  whatsappAvailable
                    ? 'Off by default. Turning it on also records WhatsApp consent for rent reminders.'
                    : 'WhatsApp messages are switched off in Settings → Features.'
                }
                checked={whatsappAvailable && sendWelcome}
                disabled={!whatsappAvailable}
                onChange={setSendWelcome}
              />
            </>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onReset} disabled={busy}>
            <RotateCcw className="size-4" />
            Start over
          </Button>
          <Button variant="outline" onClick={onBack} disabled={busy}>
            <ArrowLeft className="size-4" />
            Change columns
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={busy || counts.ready === 0 || blocked}
            onClick={() =>
              onConfirm({
                stopOnErrors,
                createLogins: loginsAvailable && createLogins,
                sendWelcome: whatsappAvailable && sendWelcome,
              })
            }
          >
            <FileUp className="size-4" />
            {busy
              ? 'Importing… keep this page open'
              : blocked
                ? 'Fix the errors first'
                : `Import ${counts.ready} ${counts.ready === 1 ? one : many}`}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function RowStatus({ check }: { check: RowCheck }) {
  return (
    <ul className="space-y-0.5 text-xs">
      {check.status === 'ready' && (
        <li className="flex items-center gap-1 font-medium text-emerald-700">
          <CheckCircle2 className="size-3.5" />
          Ready
        </li>
      )}
      {check.status === 'skip' && (
        <li className="flex items-center gap-1 font-medium text-slate-600">
          <MinusCircle className="size-3.5" />
          Will skip
        </li>
      )}
      {check.errors.map((e) => (
        <li key={e} className="flex items-start gap-1 text-rose-700">
          <XCircle className="mt-px size-3.5 shrink-0" />
          {e}
        </li>
      ))}
      {check.warnings.map((w) => (
        <li key={w} className="flex items-start gap-1 text-amber-700">
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          {w}
        </li>
      ))}
    </ul>
  )
}

function OptionRow({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  disabled?: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label
      className={cn(
        'flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3',
        disabled ? 'opacity-60' : 'cursor-pointer',
      )}
    >
      <span>
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        <span className="block text-xs text-slate-500">{hint}</span>
      </span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </label>
  )
}

export function SummaryStep({ result, kind, onAgain }: { result: ImportResult; kind: ImportKind; onAgain: () => void }) {
  const problems = result.outcomes.filter((o) => o.status !== 'imported')
  const imported = result.outcomes.filter((o) => o.status === 'imported')
  const next: Record<ImportKind, { href: string; label: string }> = {
    rooms: { href: '/app/beds', label: 'Open the bed map' },
    residents: { href: '/app/residents', label: 'Go to residents' },
    balances: { href: '/app/rent', label: 'Go to rent' },
  }
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Import finished</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm font-medium text-slate-800">
          Imported {result.imported} · Skipped {result.skipped} · Failed {result.failed}
        </p>
        <div className="grid grid-cols-3 gap-2">
          <Tile label="Imported" value={result.imported} tone="text-emerald-700" />
          <Tile label="Skipped" value={result.skipped} tone="text-slate-700" />
          <Tile label="Failed" value={result.failed} tone="text-rose-700" />
        </div>

        {problems.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium text-slate-500">Not imported</p>
            <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
              {problems.map((o) => (
                <li key={o.row} className="flex items-start gap-3 px-3 py-2 text-sm">
                  <span className="w-12 shrink-0 text-xs text-slate-400 tabular">Row {o.row}</span>
                  <div className="min-w-0">
                    <p className="break-words font-medium text-slate-800">
                      {o.title}
                      <Badge size="sm" variant={o.status === 'failed' ? 'danger' : 'default'} className="ml-2">
                        {o.status}
                      </Badge>
                    </p>
                    {o.message && <p className="break-words text-xs text-slate-500">{o.message}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {imported.length > 0 && (
          <p className="text-xs text-slate-500">
            Imported:{' '}
            {imported.slice(0, 12).map((o, i) => (
              <span key={o.row}>
                {i > 0 && ', '}
                {o.link ? (
                  <Link href={o.link} className="text-blue-600 hover:underline">
                    {o.title}
                  </Link>
                ) : (
                  o.title
                )}
              </span>
            ))}
            {imported.length > 12 && ` and ${imported.length - 12} more`}
          </p>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onAgain}>
            <RotateCcw className="size-4" />
            Import another file
          </Button>
          <Button variant="outline" asChild>
            <a href={`/api/imports/jobs?id=${result.jobId}`} download>
              <Download className="size-4" />
              Download results
            </a>
          </Button>
          <Button variant="primary" asChild>
            <Link href={next[kind].href}>{next[kind].label}</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function Tile({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-2 py-2 text-center">
      <p className={cn('font-display text-2xl font-semibold tabular', tone)}>{value}</p>
      <p className="text-[11px] text-slate-500">{label}</p>
    </div>
  )
}
