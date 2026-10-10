'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Check, FileText, Loader2, Paperclip, X } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { toISODate } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Field, Input, Select } from '@/components/ui/input'

type Values = {
  categoryId: string
  title: string
  amount: string
  spentOn: string
  paidTo: string
  paymentMode: string
  receiptUrl: string
}

const PAYMENT_MODES = [
  { value: 'CASH', label: 'Cash' },
  { value: 'UPI', label: 'UPI / GPay' },
  { value: 'CARD', label: 'Card' },
]

/** Pick the likeliest category for staff buys so most entries need one tap less. */
function defaultCategory(categories: { id: string; name: string }[]) {
  const pick = categories.find((c) => /clean|house|maint|repair|supplies/i.test(c.name))
  return pick?.id ?? ''
}

/**
 * Staff record what they bought with the PG's money or their own: what, how
 * much, where, and a photo of the bill. It is filed as PENDING for the owner.
 */
export function WorkerExpenseForm({
  propertyId,
  categories,
}: {
  propertyId: string
  categories: { id: string; name: string }[]
}) {
  const router = useRouter()
  const toast = useToast()
  const blank = React.useCallback(
    (): Values => ({
      categoryId: defaultCategory(categories),
      title: '',
      amount: '',
      spentOn: toISODate(new Date()),
      paidTo: '',
      paymentMode: 'CASH',
      receiptUrl: '',
    }),
    [categories],
  )
  const [values, setValues] = React.useState<Values>(blank)
  const [errors, setErrors] = React.useState<Partial<Record<keyof Values, string>>>({})
  const [busy, setBusy] = React.useState(false)
  const [uploading, setUploading] = React.useState(false)
  const fileRef = React.useRef<HTMLInputElement>(null)

  const set = <K extends keyof Values>(key: K, value: Values[K]) => {
    setValues((v) => ({ ...v, [key]: value }))
    setErrors((e) => ({ ...e, [key]: undefined }))
  }

  async function attach(file: File | undefined) {
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      toast.error('That file is too large', 'Bills up to 5 MB can be attached.')
      return
    }
    setUploading(true)
    try {
      const form = new FormData()
      form.set('file', file)
      form.set('purpose', 'OTHER')
      const res = await fetch('/api/uploads', { method: 'POST', body: form, credentials: 'same-origin' })
      const data = (await res.json().catch(() => null)) as { url?: string; error?: string } | null
      if (!res.ok || !data?.url) throw new Error(data?.error ?? 'The bill could not be uploaded.')
      set('receiptUrl', data.url)
    } catch (error) {
      toast.error('Upload failed', (error as Error).message)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const missing: Partial<Record<keyof Values, string>> = {}
    if (!values.categoryId) missing.categoryId = 'Choose a category'
    if (values.title.trim().length < 3) missing.title = 'Say what you bought'
    if (!Number(values.amount) || Number(values.amount) <= 0) missing.amount = 'Enter the amount'
    if (!values.spentOn) missing.spentOn = 'Choose the date'
    if (Object.keys(missing).length) {
      setErrors(missing)
      return
    }
    setBusy(true)
    try {
      const result = await api.post<{ message?: string }>('/api/operations', {
        entity: 'EXPENSE',
        propertyId,
        categoryId: values.categoryId,
        title: values.title.trim(),
        amount: Number(values.amount),
        spentOn: values.spentOn,
        paidTo: values.paidTo,
        paymentMode: values.paymentMode,
        receiptUrl: values.receiptUrl || null,
      })
      toast.success('Expense sent to the owner', result?.message)
      setValues(blank())
      router.refresh()
    } catch (error) {
      toast.error('Could not save the expense', error instanceof ApiError ? error.message : 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardContent className="p-4">
        <form onSubmit={submit} className="space-y-4">
          <p className="text-sm font-semibold text-slate-900">Add an expense</p>
          <Field label="What did you buy?" required error={errors.title}>
            <Input
              value={values.title}
              placeholder="Floor cleaner 5 L, 2 LED bulbs…"
              onChange={(e) => set('title', e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount (₹)" required error={errors.amount}>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                value={values.amount}
                onChange={(e) => set('amount', e.target.value)}
              />
            </Field>
            <Field label="Date" required error={errors.spentOn}>
              <Input type="date" value={values.spentOn} onChange={(e) => set('spentOn', e.target.value)} />
            </Field>
          </div>
          <Field label="Category" required error={errors.categoryId}>
            <Select value={values.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
              <option value="">Choose…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Shop">
              <Input value={values.paidTo} placeholder="Shop name" onChange={(e) => set('paidTo', e.target.value)} />
            </Field>
            <Field label="Paid by">
              <Select value={values.paymentMode} onChange={(e) => set('paymentMode', e.target.value)}>
                {PAYMENT_MODES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field label="Bill photo">
            {values.receiptUrl ? (
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <FileText className="size-4 shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1 truncate text-slate-700">Bill attached</span>
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove bill" onClick={() => set('receiptUrl', '')}>
                  <X className="size-4" />
                </Button>
              </div>
            ) : (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*,application/pdf"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => attach(e.target.files?.[0])}
                />
                <Button type="button" variant="outline" className="w-full" disabled={uploading} onClick={() => fileRef.current?.click()}>
                  {uploading ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
                  {uploading ? 'Uploading…' : 'Take a photo of the bill'}
                </Button>
              </>
            )}
          </Field>

          <Button type="submit" variant="success" className="w-full" loading={busy} disabled={uploading}>
            <Check className="size-4" />
            Send to owner
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
