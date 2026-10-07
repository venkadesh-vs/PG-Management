'use client'

import * as React from 'react'
import { FileText, Loader2, Paperclip, X } from 'lucide-react'
import { ApiError } from '@/lib/client'
import { cn, formatDate, formatMoney } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'

/**
 * Pieces shared by every "record payment" form: proof upload and the
 * invoice picker that overrides oldest-first allocation.
 */

const MAX_BYTES = 5 * 1024 * 1024

/** Attach one photo or PDF as proof of payment. Holds an /api/uploads/<id> URL. */
export function ProofUpload({
  value,
  onChange,
  residentId,
  onBusyChange,
}: {
  value: string
  onChange: (url: string) => void
  residentId?: string
  onBusyChange?: (busy: boolean) => void
}) {
  const toast = useToast()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [busy, setBusy] = React.useState(false)
  const [name, setName] = React.useState('')

  async function upload(file: File) {
    if (file.size > MAX_BYTES) {
      toast.error('That file is too large', 'Choose a photo or PDF under 5 MB.')
      return
    }
    setBusy(true)
    onBusyChange?.(true)
    try {
      const form = new FormData()
      form.set('file', file)
      form.set('purpose', 'OTHER')
      if (residentId) form.set('residentId', residentId)
      const res = await fetch('/api/uploads', { method: 'POST', body: form })
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string }
      if (!res.ok || !data.url) throw new ApiError(data.error ?? 'Upload failed', res.status)
      onChange(data.url)
      setName(file.name)
    } catch (error) {
      toast.fromError(error, 'upload the proof')
    } finally {
      setBusy(false)
      onBusyChange?.(false)
    }
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void upload(file)
        }}
      />
      {value ? (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
          <a href={value} target="_blank" rel="noopener" className="flex min-w-0 items-center gap-2 text-emerald-800 hover:underline">
            <FileText className="size-4 shrink-0" />
            <span className="truncate">{name || 'Proof attached'}</span>
          </a>
          <button
            type="button"
            onClick={() => {
              onChange('')
              setName('')
            }}
            className="rounded-md p-1 text-emerald-700 hover:bg-emerald-100"
            aria-label="Remove proof"
          >
            <X className="size-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 px-3 py-2.5 text-sm text-slate-600 transition-colors hover:border-blue-300 hover:bg-blue-50/40 disabled:opacity-60"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
          {busy ? 'Uploading…' : 'Attach screenshot or PDF (optional)'}
        </button>
      )}
    </div>
  )
}

export type PickableInvoice = { id: string; number: string; balance: number; dueDate: string }

/**
 * Open invoices with tick boxes. Ticked invoices are paid first, in the order
 * ticked; anything left goes to the rest oldest-first, then becomes an advance.
 */
export function InvoicePicker({
  invoices,
  value,
  onChange,
  amount,
}: {
  invoices: PickableInvoice[]
  value: string[]
  onChange: (ids: string[]) => void
  amount: number
}) {
  // Preview the split exactly as the server will do it.
  const preview = React.useMemo(() => {
    const byDue = [...invoices].sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    const picked = value.map((id) => byDue.find((i) => i.id === id)).filter(Boolean) as PickableInvoice[]
    const ordered = [...picked, ...byDue.filter((i) => !picked.includes(i))]
    const split = new Map<string, number>()
    let left = amount > 0 ? amount : 0
    for (const inv of ordered) {
      const applied = Math.min(left, inv.balance)
      left -= applied
      if (applied > 0) split.set(inv.id, applied)
    }
    return { split, advance: left }
  }, [invoices, value, amount])

  if (!invoices.length) {
    return amount > 0 ? (
      <p className="rounded-xl bg-blue-50 px-3 py-2 text-xs text-blue-800">
        No open invoices — {formatMoney(amount)} will be kept as an advance for the next invoice.
      </p>
    ) : null
  }

  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-slate-500">Apply to</p>
        <p className="text-[11px] text-slate-400">
          {value.length ? 'Ticked first, then oldest' : 'Oldest due first — tick to choose'}
        </p>
      </div>
      <ul className="space-y-1">
        {invoices.map((invoice) => {
          const checked = value.includes(invoice.id)
          const applied = preview.split.get(invoice.id) ?? 0
          return (
            <li key={invoice.id}>
              <label
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-sm transition-colors',
                  checked ? 'bg-blue-50' : 'hover:bg-slate-50',
                )}
              >
                <input
                  type="checkbox"
                  className="size-4 accent-blue-600"
                  checked={checked}
                  onChange={() => onChange(checked ? value.filter((v) => v !== invoice.id) : [...value, invoice.id])}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-slate-700">{invoice.number}</span>
                  <span className="block text-[11px] text-slate-400">due {formatDate(invoice.dueDate)}</span>
                </span>
                <span className="text-right tabular">
                  <span className="block font-medium text-slate-800">{formatMoney(invoice.balance)}</span>
                  {applied > 0 && (
                    <span className="block text-[11px] text-emerald-600">
                      {applied >= invoice.balance ? 'clears' : `${formatMoney(applied)} applied`}
                    </span>
                  )}
                </span>
              </label>
            </li>
          )
        })}
      </ul>
      {preview.advance > 0 && (
        <p className="mt-2 text-xs text-blue-700">
          {formatMoney(preview.advance)} more than the dues — kept as an advance.
        </p>
      )}
    </div>
  )
}
