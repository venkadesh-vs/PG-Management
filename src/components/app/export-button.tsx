'use client'

import { useSearchParams } from 'next/navigation'
import { ChevronDown, Download, FileSpreadsheet, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown'

export type ExportKind =
  | 'residents'
  | 'invoices'
  | 'payments'
  | 'expenses'
  | 'outstanding'
  | 'complaints'
  | 'maintenance'
  | 'assets'
  | 'visitors'
  | 'staff'
  | 'enquiries'
  | 'bookings'
  | 'deposits'
  | 'charges'
  | 'rent-revisions'
  | 'electricity'
  | 'activity'

/**
 * Downloads the current list as Excel (CSV) or a designed PDF report. Carries the page's PG filter (and a
 * date range when the page has one) so the file matches what is on screen.
 * `carry` adds more query keys (e.g. the audit log's filters); `href`
 * replaces the endpoint (the Super Admin audit export lives elsewhere).
 */
export function ExportButton({
  kind,
  label = 'Export',
  carry = [],
  href: endpoint,
}: {
  kind?: ExportKind
  label?: string
  carry?: readonly string[]
  href?: string
}) {
  const params = useSearchParams()
  const query = new URLSearchParams()
  for (const key of new Set(['property', 'from', 'to', ...carry])) {
    const value = params.get(key)
    if (value) query.set(key, value)
  }
  const qs = query.size ? `?${query}` : ''
  // A custom endpoint (the Super Admin audit log) is CSV only.
  if (endpoint || !kind) {
    return (
      <Button variant="outline" asChild>
        <a href={`${endpoint}${qs}`} download>
          <Download className="size-4" />
          {label}
        </a>
      </Button>
    )
  }
  return <ExportMenu label={label} csv={`/api/exports/${kind}.csv${qs}`} pdf={`/api/exports/${kind}.pdf${qs}`} />
}

/** "Export ▾" → PDF report, Excel (.xlsx) or raw CSV. Also used by pages that build their own export URLs. */
export function ExportMenu({ label = 'Export', csv, pdf }: { label?: string; csv: string; pdf: string }) {
  const xlsx = csv.replace(/\.csv(\?|$)/, '.xlsx$1')
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          <Download className="size-4" />
          {label}
          <ChevronDown className="size-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[14rem]">
        <DropdownMenuItem asChild>
          <a href={pdf} download>
            <FileText className="size-4 text-rose-600" />
            <span className="flex flex-col">
              <span className="font-medium">PDF report</span>
              <span className="text-xs text-slate-500">Print-ready, key columns and totals</span>
            </span>
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={xlsx} download>
            <FileSpreadsheet className="size-4 text-emerald-600" />
            <span className="flex flex-col">
              <span className="font-medium">Excel (.xlsx)</span>
              <span className="text-xs text-slate-500">Every column, formatted, with filters</span>
            </span>
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={csv} download>
            <FileSpreadsheet className="size-4 text-slate-400" />
            <span className="flex flex-col">
              <span className="font-medium">CSV</span>
              <span className="text-xs text-slate-500">Raw data for other software</span>
            </span>
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
