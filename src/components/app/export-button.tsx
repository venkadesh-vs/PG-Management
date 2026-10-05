'use client'

import { useSearchParams } from 'next/navigation'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Downloads a CSV of the current list. Carries the page's PG filter (and a
 * date range when the page has one) so the file matches what is on screen.
 */
export function ExportButton({
  kind,
  label = 'Export',
}: {
  kind: 'residents' | 'invoices' | 'payments' | 'expenses' | 'outstanding'
  label?: string
}) {
  const params = useSearchParams()
  const query = new URLSearchParams()
  for (const key of ['property', 'from', 'to']) {
    const value = params.get(key)
    if (value) query.set(key, value)
  }
  const href = `/api/exports/${kind}.csv${query.size ? `?${query}` : ''}`
  return (
    <Button variant="outline" asChild>
      <a href={href} download>
        <Download className="size-4" />
        {label}
      </a>
    </Button>
  )
}
