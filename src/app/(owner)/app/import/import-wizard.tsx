'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Download, FileSpreadsheet, ListChecks } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { cn } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select } from '@/components/ui/input'
import type { ColumnMapping, FieldDef, ImportKind, RowCheck, RowOutcome, SheetRow } from '@/server/services/import-fields'
import { PreviewStep, SummaryStep, type ImportResult, type Preview } from './import-steps'

export type Parsed = {
  fileName: string
  sheets: string[]
  sheet: string
  headers: string[]
  rows: SheetRow[]
  fields: FieldDef[]
  suggested: ColumnMapping
}

export type { RowCheck, RowOutcome }

const MAX_BYTES = 5 * 1024 * 1024

const KIND_HELP: Record<ImportKind, { step: string; text: string }> = {
  rooms: {
    step: 'Step 1',
    text: 'One row per room (PG, floor, room number, beds / sharing, rent per bed) — or one row per bed with a bed label. Missing floors, rooms and beds are created; rooms that already exist are skipped.',
  },
  residents: {
    step: 'Step 2',
    text: 'One row per resident: name, phone, PG, room, bed, joining date and monthly rent (plus deposit, email, guardian, ID, food if you have them). Each resident is checked in exactly like a manual check-in.',
  },
  balances: {
    step: 'Step 3',
    text: 'For residents already in StayFlow (matched by phone or resident code): rent outstanding, advance paid and deposit held as of a date. Outstanding becomes one "Opening balance" invoice — old months are never re-billed.',
  },
}

/**
 * Upload → match columns → check → preview → confirm → summary. The file is
 * parsed on the server; the rows come back as text and stay in the browser
 * until the person confirms, when the server checks them once more.
 */
export function ImportWizard({
  kinds,
  initialKind,
  properties,
  loginsAvailable,
  whatsappAvailable,
}: {
  kinds: { key: ImportKind; title: string }[]
  initialKind: ImportKind
  properties: { name: string; code: string }[]
  loginsAvailable: boolean
  whatsappAvailable: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [kind, setKind] = React.useState<ImportKind>(initialKind)
  const [file, setFile] = React.useState<File | null>(null)
  const [parsed, setParsed] = React.useState<Parsed | null>(null)
  const [mapping, setMapping] = React.useState<ColumnMapping>({})
  const [preview, setPreview] = React.useState<Preview | null>(null)
  const [result, setResult] = React.useState<ImportResult | null>(null)
  const [busy, setBusy] = React.useState<'reading' | 'checking' | 'importing' | null>(null)

  function reset(nextKind = kind) {
    setKind(nextKind)
    setFile(null)
    setParsed(null)
    setMapping({})
    setPreview(null)
    setResult(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  async function read(f: File, sheet?: string) {
    if (f.size > MAX_BYTES) {
      toast.error('The file is too large', 'Keep it under 5 MB — split it into smaller files.')
      return
    }
    setBusy('reading')
    try {
      const form = new FormData()
      form.append('file', f)
      form.append('kind', kind)
      if (sheet) form.append('sheet', sheet)
      const res = await fetch('/api/imports/parse', { method: 'POST', body: form, credentials: 'same-origin' })
      const data = (await res.json().catch(() => null)) as (Parsed & { error?: string }) | null
      if (!res.ok || !data) throw new ApiError(data?.error ?? 'We could not read this file.', res.status)
      setFile(f)
      setParsed(data)
      setMapping(data.suggested)
      setPreview(null)
    } catch (error) {
      toast.error('This file cannot be read', error instanceof ApiError ? error.message : 'Check your connection and try again.')
      if (inputRef.current) inputRef.current.value = ''
    } finally {
      setBusy(null)
    }
  }

  async function check() {
    if (!parsed) return
    setBusy('checking')
    try {
      const data = await api.post<Preview>(`/api/imports/${kind}`, {
        action: 'preview',
        fileName: parsed.fileName,
        headers: parsed.headers,
        rows: parsed.rows,
        mapping,
      })
      setPreview(data)
    } catch (error) {
      toast.error('Could not check the rows', error instanceof ApiError ? error.message : 'Please try again.')
    } finally {
      setBusy(null)
    }
  }

  async function commit(options: { stopOnErrors: boolean; createLogins: boolean; sendWelcome: boolean }) {
    if (!parsed || !preview) return
    setBusy('importing')
    try {
      const data = await api.post<ImportResult>(`/api/imports/${kind}`, {
        action: 'import',
        jobId: preview.jobId,
        fileName: parsed.fileName,
        headers: parsed.headers,
        rows: parsed.rows,
        mapping,
        ...options,
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

  if (result && parsed) return <SummaryStep result={result} kind={kind} onAgain={() => reset()} />

  const help = KIND_HELP[kind]

  return (
    <div className="space-y-6">
      {/* ---------------------------------------------------- what + file */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">1. What are you importing?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {kinds.map((k) => (
              <button
                key={k.key}
                type="button"
                disabled={Boolean(busy)}
                onClick={() => k.key !== kind && reset(k.key)}
                className={cn(
                  'rounded-xl border px-3 py-2.5 text-left transition',
                  k.key === kind ? 'border-blue-500 bg-blue-50/60 ring-1 ring-blue-500' : 'border-slate-200 hover:border-slate-300',
                )}
              >
                <span className="block text-[11px] uppercase tracking-wide text-slate-500">{KIND_HELP[k.key].step}</span>
                <span className="block text-sm font-medium text-slate-900">{k.title}</span>
              </button>
            ))}
          </div>
          <p className="text-sm text-slate-600">{help.text}</p>
          {kind !== 'balances' && properties.length > 0 && (
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
            <a href={`/api/imports/${kind}`} download>
              <Download className="size-3.5" />
              Download a sample sheet
            </a>
          </Button>

          <label
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 px-4 py-8 text-center transition hover:border-blue-300 hover:bg-blue-50/40',
              busy && 'pointer-events-none opacity-60',
            )}
          >
            <FileSpreadsheet className="size-8 text-slate-400" />
            <span className="break-all text-sm font-medium text-slate-800">
              {busy === 'reading' ? 'Reading the file…' : (parsed?.fileName ?? 'Choose an Excel (.xlsx) or CSV file')}
            </span>
            <span className="text-xs text-slate-500">
              {parsed ? `${parsed.rows.length} rows found · tap to choose another file` : 'Up to 5 MB and 2,000 rows. Nothing is saved until you confirm.'}
            </span>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void read(f)
              }}
            />
          </label>

          {parsed && parsed.sheets.length > 1 && file && (
            <label className="block space-y-1 text-sm">
              <span className="font-medium text-slate-700">Sheet</span>
              <Select value={parsed.sheet} disabled={Boolean(busy)} onChange={(e) => void read(file, e.target.value)}>
                {parsed.sheets.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </label>
          )}
        </CardContent>
      </Card>

      {/* ---------------------------------------------------- mapping */}
      {parsed && !preview && (
        <MappingStep
          parsed={parsed}
          mapping={mapping}
          onChange={setMapping}
          onCheck={check}
          checking={busy === 'checking'}
          kind={kind}
        />
      )}

      {/* ---------------------------------------------------- preview */}
      {parsed && preview && (
        <PreviewStep
          kind={kind}
          parsed={parsed}
          preview={preview}
          busy={busy === 'importing'}
          loginsAvailable={loginsAvailable}
          whatsappAvailable={whatsappAvailable}
          onBack={() => setPreview(null)}
          onReset={() => reset()}
          onConfirm={commit}
        />
      )}
    </div>
  )
}

function MappingStep({
  parsed,
  mapping,
  onChange,
  onCheck,
  checking,
  kind,
}: {
  parsed: Parsed
  mapping: ColumnMapping
  onChange: (m: ColumnMapping) => void
  onCheck: () => void
  checking: boolean
  kind: ImportKind
}) {
  const used = new Set(Object.values(mapping))
  const ignored = parsed.headers.filter((_, i) => !used.has(i))
  const sample = (idx: number) => parsed.rows.find((r) => r.cells[idx])?.cells[idx] ?? ''
  const missing = parsed.fields.filter((f) => f.required && mapping[f.key] === undefined)
  const needsWho = kind === 'balances' && mapping.phone === undefined && mapping.code === undefined

  function set(key: string, value: string) {
    const next = { ...mapping }
    if (value === '') delete next[key]
    else {
      const idx = Number(value)
      // A column feeds one field: take it away from any other.
      for (const [k, v] of Object.entries(next)) if (v === idx) delete next[k]
      next[key] = idx
    }
    onChange(next)
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">2. Match your columns</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-slate-600">
          We matched what we could from your headers. Fix any that are wrong; fields marked * are required.
        </p>
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {parsed.fields.map((f) => {
            const idx = mapping[f.key]
            return (
              <li key={f.key} className="grid gap-2 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] sm:items-center">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800">
                    {f.label}
                    {f.required && <span className="text-rose-600"> *</span>}
                  </p>
                  {f.hint && <p className="text-xs text-slate-500">{f.hint}</p>}
                </div>
                <div className="min-w-0">
                  <Select
                    aria-label={`Column for ${f.label}`}
                    value={idx === undefined ? '' : String(idx)}
                    onChange={(e) => set(f.key, e.target.value)}
                    className={cn(f.required && idx === undefined && 'border-rose-300')}
                  >
                    <option value="">— Not in my file —</option>
                    {parsed.headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h}
                      </option>
                    ))}
                  </Select>
                  {idx !== undefined && sample(idx) && (
                    <p className="mt-1 truncate text-xs text-slate-500">e.g. {sample(idx)}</p>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
        {ignored.length > 0 && (
          <p className="text-xs text-slate-500">
            Ignored columns: <span className="text-slate-700">{ignored.join(', ')}</span>
          </p>
        )}
        {(missing.length > 0 || needsWho) && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {needsWho ? 'Choose a column for Phone or Resident code. ' : ''}
            {missing.length > 0 && `Still needed: ${missing.map((f) => f.label).join(', ')}.`}
          </p>
        )}
        <div className="flex justify-end">
          <Button variant="primary" onClick={onCheck} loading={checking} disabled={checking || missing.length > 0 || needsWho} className="w-full sm:w-auto">
            <ListChecks className="size-4" />
            {checking ? 'Checking every row…' : `Check ${parsed.rows.length} rows`}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
