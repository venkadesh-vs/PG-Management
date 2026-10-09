'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Check, Copy, Smartphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { PhotoUpload } from '@/components/app/photo-upload'
import { useToast } from '@/components/ui/toast'
import { api, ApiError } from '@/lib/client'
import { formatMoney } from '@/lib/utils'

/** One copyable line (UPI ID, account number, IFSC…). */
export function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = React.useState(false)
  if (!value) return null
  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked: the value is selectable */
    }
  }
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <p className="text-[11px] font-medium text-slate-500">{label}</p>
        <p className="select-all truncate font-mono text-sm text-slate-900">{value}</p>
      </div>
      <button
        type="button"
        onClick={copy}
        className="shrink-0 rounded-md border border-slate-200 bg-white p-1.5 text-slate-500 hover:text-slate-900"
        aria-label={`Copy ${label}`}
      >
        {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  )
}

/** Opens the phone's UPI app with the exact amount filled in. */
export function UpiAppButton({ href }: { href: string }) {
  return (
    <a
      href={href}
      className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-900 hover:bg-slate-50 sm:w-auto sm:px-4"
    >
      <Smartphone className="size-4" />
      Open UPI app with amount
    </a>
  )
}

/** "I've paid" — owner reports a UPI / bank transfer for the Super Admin to verify. */
export function PaidClaimForm({
  invoices,
  canPay,
}: {
  invoices: { id: string; number: string; balance: number }[]
  canPay: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const [open, setOpen] = React.useState(false)
  const [invoiceId, setInvoiceId] = React.useState(invoices[0]?.id ?? '')
  const [method, setMethod] = React.useState<'UPI' | 'BANK_TRANSFER'>('UPI')
  const [utr, setUtr] = React.useState('')
  const [note, setNote] = React.useState('')
  const [proof, setProof] = React.useState<string[]>([])
  const [uploading, setUploading] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  if (!canPay) {
    return <p className="text-sm text-slate-500">Only the PG owner (or someone with billing access) can report a payment.</p>
  }
  if (!open) {
    return (
      <Button variant="outline" className="w-full sm:w-auto" onClick={() => setOpen(true)}>
        I&apos;ve paid by UPI / bank transfer
      </Button>
    )
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await api.post<{ message: string }>('/api/subscription/claims', {
        invoiceId,
        method,
        utr: utr.trim(),
        proofUrl: proof[0] ?? '',
        note: note.trim() || undefined,
      })
      toast.success('Payment details sent', res.message)
      setOpen(false)
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
      {invoices.length > 1 && (
        <Field label="Invoice" htmlFor="claim-invoice">
          <Select id="claim-invoice" value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}>
            {invoices.map((i) => (
              <option key={i.id} value={i.id}>
                {i.number} · {formatMoney(i.balance)}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Paid by" htmlFor="claim-method">
          <Select id="claim-method" value={method} onChange={(e) => setMethod(e.target.value as 'UPI' | 'BANK_TRANSFER')}>
            <option value="UPI">UPI / GPay / PhonePe</option>
            <option value="BANK_TRANSFER">Bank transfer (NEFT / IMPS)</option>
          </Select>
        </Field>
        <Field label="UTR / transaction ID" htmlFor="claim-utr" required hint="12 digits in your UPI app or bank SMS">
          <Input id="claim-utr" value={utr} onChange={(e) => setUtr(e.target.value)} placeholder="e.g. 428391234567" required />
        </Field>
      </div>
      <PhotoUpload
        value={proof}
        onChange={setProof}
        purpose="OTHER"
        max={1}
        label="Add payment screenshot"
        hint="Optional — helps us verify faster"
        onBusyChange={setUploading}
      />
      <Field label="Note (optional)" htmlFor="claim-note">
        <Textarea id="claim-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
      </Field>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={busy || uploading || utr.trim().length < 6}>
          {busy ? 'Sending…' : 'Send for verification'}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
