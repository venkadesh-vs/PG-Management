'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileUp,
  RotateCcw,
  XCircle,
} from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { cn } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/primitives'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrap,
} from '@/components/ui/table'

type RowResult = {
  row: number
  fullName: string
  phone: string
  pg: string
  room: string
  bed: string
  joiningDate: string
  rent: string
  errors: string[]
  warnings: string[]
}

type Preview = { rows: RowResult[]; valid: number; invalid: number }

type Outcome = {
  row: number
  fullName: string
  status: 'imported' | 'failed' | 'skipped'
  residentId?: string
  residentCode?: string
  message?: string
}

type ImportResult = {
  outcomes: Outcome[]
  imported: number
  failed: number
  skipped: number
  message: string
}

const MAX_BYTES = 2_000_000

/**
 * Upload → check every row → import. The file is read in the browser and
 * sent as text; the server validates it twice (preview, then again right
 * before importing) so nothing stale is ever checked in.
 */
export function ImportWizard({
  properties,
  loginsAvailable,
  whatsappAvailable,
}: {
  properties: { name: string; code: string }[]
  loginsAvailable: boolean
  whatsappAvailable: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = React.useState<string | null>(null)
  const [csv, setCsv] = React.useState<string | null>(null)
  const [preview, setPreview] = React.useState<Preview | null>(null)
  const [result, setResult] = React.useState<ImportResult | null>(null)
  const [busy, setBusy] = React.useState<'checking' | 'importing' | null>(null)
  const [onlyProblems, setOnlyProblems] = React.useState(false)
  const [createLogins, setCreateLogins] = React.useState(false)
  const [sendWelcome, setSendWelcome] = React.useState(false)

  function reset() {
    setFileName(null)
    setCsv(null)
    setPreview(null)
    setResult(null)
    setOnlyProblems(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  async function check(text: string) {
    setBusy('checking')
    try {
      const data = await api.post<Preview>('/api/imports/residents', { csv: text, dryRun: true })
      setPreview(data)
      setOnlyProblems(data.invalid > 0 && data.rows.length > 20)
    } catch (error) {
      setPreview(null)
      toast.error('This file cannot be imported', error instanceof ApiError ? error.message : 'Please try again.')
    } finally {
      setBusy(null)
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return
    if (file.size > MAX_BYTES) {
      toast.error('The file is too large', 'Import at most 500 residents at a time.')
      return
    }
    if (/\.xlsx?$/i.test(file.name)) {
      toast.error(
        'Save it as CSV first',
        'In Excel choose File → Save As → "CSV UTF-8 (Comma delimited)" and upload that file.',
      )
      return
    }
    const text = await file.text()
    setFileName(file.name)
    setCsv(text)
    setResult(null)
    await check(text)
  }

  async function commit() {
    if (!csv || !preview?.valid) return
    setBusy('importing')
    try {
      const data = await api.post<ImportResult>('/api/imports/residents', {
        csv,
        dryRun: false,
        createLogins: loginsAvailable && createLogins,
        sendWelcome: whatsappAvailable && sendWelcome,
      })
      setResult(data)
      if (data.imported) toast.success('Import finished', data.message)
      else toast.error('Nothing was imported', data.message)
      router.refresh()
    } catch (error) {
      toast.error('The import did not go through', error instanceof ApiError ? error.message : 'Please try again.')
    } finally {
      setBusy(null)
    }
  }

  // ----------------------------------------------------------------- result
  if (result) return <ResultSummary result={result} onAgain={reset} />

  const shown = preview
    ? onlyProblems
      ? preview.rows.filter((r) => r.errors.length || r.warnings.length)
      : preview.rows
    : []

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------------ step 1 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">1. Fill in the template</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-slate-600">
          <p>
            One row per resident. Required: full name, phone (10 digits), PG name, room, bed,
            joining date (DD/MM/YYYY or YYYY-MM-DD) and monthly rent. The bed must exist and be
            available. Up to 500 rows per file.
          </p>
          <p>
            Working in Excel or Google Sheets? Save or download the sheet as{' '}
            <span className="font-medium text-slate-800">CSV</span> before uploading.
          </p>
          {properties.length > 0 && (
            <p className="text-xs text-slate-500">
              PG names you can use:{' '}
              {properties.map((p, i) => (
                <span key={p.code}>
                  {i > 0 && ', '}
                  <span className="font-medium text-slate-700">{p.name}</span> ({p.code})
                </span>
              ))}
            </p>
          )}
          <Button variant="outline" size="sm" asChild>
            <a href="/api/imports/residents" download>
              <Download className="size-3.5" />
              Download template (CSV)
            </a>
          </Button>
        </CardContent>
      </Card>

      {/* ------------------------------------------------------ step 2 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">2. Upload and check</CardTitle>
        </CardHeader>
        <CardContent>
          <label
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-200 px-4 py-8 text-center transition hover:border-blue-300 hover:bg-blue-50/40',
              busy && 'pointer-events-none opacity-60',
            )}
          >
            <FileSpreadsheet className="size-8 text-slate-400" />
            <span className="text-sm font-medium text-slate-800">
              {busy === 'checking' ? 'Checking every row…' : fileName ?? 'Choose a CSV file'}
            </span>
            <span className="text-xs text-slate-500">Nothing is saved until you press Import.</span>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </label>
        </CardContent>
      </Card>

      {/* ------------------------------------------------------ preview */}
      {preview && (
        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0 pb-3">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-sm">3. Review</CardTitle>
              <Badge variant="success">{preview.valid} ready</Badge>
              {preview.invalid > 0 && <Badge variant="danger">{preview.invalid} with errors</Badge>}
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <Switch checked={onlyProblems} onCheckedChange={setOnlyProblems} />
              Only rows with problems
            </label>
          </CardHeader>
          <CardContent className="space-y-4">
            {preview.invalid > 0 && (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Rows with errors are skipped. Fix them in your sheet and upload the file again, or
                import the ready rows now and the rest later.
              </p>
            )}

            {shown.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">No problems found.</p>
            ) : (
              <>
                <TableWrap className="hidden md:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-14">Row</TableHead>
                        <TableHead>Resident</TableHead>
                        <TableHead>PG · room · bed</TableHead>
                        <TableHead>Joining</TableHead>
                        <TableHead className="text-right">Rent</TableHead>
                        <TableHead>Check</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {shown.map((row) => (
                        <TableRow key={row.row} className={cn(row.errors.length > 0 && 'bg-red-50/40')}>
                          <TableCell className="text-xs text-slate-500 tabular">{row.row}</TableCell>
                          <TableCell>
                            <p className="font-medium text-slate-800">{row.fullName || '—'}</p>
                            <p className="text-xs text-slate-500 tabular">{row.phone}</p>
                          </TableCell>
                          <TableCell className="text-sm text-slate-600">
                            {[row.pg, row.room, row.bed].filter(Boolean).join(' · ') || '—'}
                          </TableCell>
                          <TableCell className="text-sm text-slate-600 tabular">{row.joiningDate}</TableCell>
                          <TableCell className="text-right text-sm tabular">{row.rent}</TableCell>
                          <TableCell className="max-w-xs">
                            <RowStatus row={row} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableWrap>

                <ul className="space-y-2 md:hidden">
                  {shown.map((row) => (
                    <li
                      key={row.row}
                      className={cn(
                        'rounded-2xl border bg-white p-4 shadow-card',
                        row.errors.length ? 'border-red-200' : 'border-slate-200',
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-900">{row.fullName || '—'}</p>
                          <p className="text-xs text-slate-500 tabular">{row.phone}</p>
                        </div>
                        <span className="shrink-0 text-[11px] text-slate-400">Row {row.row}</span>
                      </div>
                      <p className="mt-1 text-xs text-slate-600">
                        {[row.pg, row.room && `Room ${row.room}`, row.bed && `Bed ${row.bed}`]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                      <p className="text-xs text-slate-500 tabular">
                        {row.joiningDate} · {row.rent}
                      </p>
                      <div className="mt-2">
                        <RowStatus row={row} />
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {/* -------------------------------------------- options + go */}
            <div className="space-y-2 border-t border-slate-100 pt-4">
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
            </div>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="ghost" onClick={reset} disabled={Boolean(busy)}>
                <RotateCcw className="size-4" />
                Start over
              </Button>
              <Button
                variant="primary"
                onClick={commit}
                loading={busy === 'importing'}
                disabled={!preview.valid || Boolean(busy)}
              >
                <FileUp className="size-4" />
                {busy === 'importing'
                  ? 'Importing… keep this page open'
                  : `Import ${preview.valid} resident${preview.valid === 1 ? '' : 's'}`}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function RowStatus({ row }: { row: RowResult }) {
  if (!row.errors.length && !row.warnings.length) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
        <CheckCircle2 className="size-3.5" />
        Ready
      </span>
    )
  }
  return (
    <ul className="space-y-0.5 text-xs">
      {row.errors.map((e) => (
        <li key={e} className="flex items-start gap-1 text-red-700">
          <XCircle className="mt-px size-3.5 shrink-0" />
          {e}
        </li>
      ))}
      {row.warnings.map((w) => (
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

function ResultSummary({ result, onAgain }: { result: ImportResult; onAgain: () => void }) {
  const problems = result.outcomes.filter((o) => o.status !== 'imported' || o.message)
  const imported = result.outcomes.filter((o) => o.status === 'imported')
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Import finished</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          <Tile label="Imported" value={result.imported} tone="text-emerald-700" />
          <Tile label="Failed" value={result.failed} tone="text-red-700" />
          <Tile label="Skipped" value={result.skipped} tone="text-amber-700" />
        </div>

        {problems.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Rows that need a look
            </p>
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {problems.map((o) => (
                <li key={o.row} className="flex items-start gap-3 px-3 py-2 text-sm">
                  <span className="w-12 shrink-0 text-xs text-slate-400 tabular">Row {o.row}</span>
                  <div className="min-w-0">
                    <p className="font-medium text-slate-800">
                      {o.fullName || '—'}
                      <Badge
                        size="sm"
                        variant={o.status === 'imported' ? 'warning' : o.status === 'failed' ? 'danger' : 'default'}
                        className="ml-2"
                      >
                        {o.status}
                      </Badge>
                    </p>
                    {o.message && <p className="text-xs text-slate-500">{o.message}</p>}
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
                <Link href={`/app/residents/${o.residentId}`} className="text-blue-600 hover:underline">
                  {o.fullName}
                </Link>
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
          <Button variant="primary" asChild>
            <Link href="/app/residents">Go to residents</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function Tile({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 text-center">
      <p className={cn('font-display text-2xl font-semibold tabular', tone)}>{value}</p>
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
    </div>
  )
}
