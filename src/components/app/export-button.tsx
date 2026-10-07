'use client'

import { useSearchParams } from 'next/navigation'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'

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
  | 'activity'

/**
 * Downloads a CSV of the current list. Carries the page's PG filter (and a
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
  const base = endpoint ?? `/api/exports/${kind}.csv`
  const href = `${base}${query.size ? `?${query}` : ''}`
  return (
    <Button variant="outline" asChild>
      <a href={href} download>
        <Download className="size-4" />
        {label}
      </a>
    </Button>
  )
}
