'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { FileText, Loader2, Paperclip, Plus, X } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { cn, toISODate } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { Switch } from '@/components/ui/primitives'

/**
 * Add / edit an expense: the usual fields plus vendor, bill number, a bill
 * photo or PDF (uploaded to /api/uploads) and an optional repeat schedule.
 */

export type ExpenseFormValues = {
  id?: string
  propertyId: string
  categoryId: string
  title: string
  amount: number | ''
  spentOn: string
  paidTo: string
  billNumber: string
  paymentMode: string
  reference: string
  notes: string
  receiptUrl: string
  isRecurring: boolean
  recurrence: string
}

export const PAYMENT_MODES = [
  { value: 'CASH', label: 'Cash' },
  { value: 'UPI', label: 'UPI' },
  { value: 'BANK_TRANSFER', label: 'Bank transfer' },
  { value: 'CARD', label: 'Card' },
  { value: 'CHEQUE', label: 'Cheque' },
]

const RECURRENCE_OPTIONS = [
  { value: 'MONTHLY', label: 'Every month' },
  { value: 'QUARTERLY', label: 'Every 3 months' },
  { value: 'YEARLY', label: 'Every year' },
]

type Option = { id: string; name: string }

export function ExpenseForm({
  properties,
  categories,
  initial,
  approvalNote,
  open: controlledOpen,
  onOpenChange,
  trigger,
}: {
  properties: Option[]
  categories: Option[]
  /** With an id → edit (PATCH); without → create. */
  initial?: Partial<ExpenseFormValues>
  /** Shown under the amount, e.g. the approval threshold. */
  approvalNote?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
  trigger?: string
}) {
  const router = useRouter()
  const toast = useToast()
  const editing = Boolean(initial?.id)
  const [ownOpen, setOwnOpen] = React.useState(false)
  const open = controlledOpen ?? ownOpen
  const setOpen = onOpenChange ?? setOwnOpen

  const seed = React.useCallback(
    (): ExpenseFormValues => ({
      propertyId: properties[0]?.id ?? '',
      categoryId: '',
      title: '',
      amount: '',
      spentOn: toISODate(new Date()),
      paidTo: '',
      billNumber: '',
      paymentMode: 'CASH',
      reference: '',
      notes: '',
      receiptUrl: '',
      isRecurring: false,
      recurrence: 'MONTHLY',
      ...initial,
    }),
    [initial, properties],
  )
  const [values, setValues] = React.useState<ExpenseFormValues>(seed)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState(false)
  const [uploading, setUploading] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setValues(seed())
      setErrors({})
    }
    // Re-seed only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function set<K extends keyof ExpenseFormValues>(key: K, value: ExpenseFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }))
    setErrors((e) => {
      if (!e[key]) return e
      const next = { ...e }
      delete next[key]
      return next
    })
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
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const missing: Record<string, string> = {}
    if (!editing && !values.propertyId) missing.propertyId = 'Choose a PG'
    if (!values.categoryId) missing.categoryId = 'Choose a category'
    if (values.title.trim().length < 3) missing.title = 'Describe the expense'
    if (!values.amount || Number(values.amount) <= 0) missing.amount = 'Enter an amount'
    if (!values.spentOn) missing.spentOn = 'Choose the date'
    if (Object.keys(missing).length) {
      setErrors(missing)
      return
    }

    setBusy(true)
    const { id, propertyId, ...rest } = values
    const body = {
      ...rest,
      amount: Number(values.amount),
      recurrence: values.isRecurring ? values.recurrence : '',
      receiptUrl: values.receiptUrl || null,
    }
    try {
      const result = editing
        ? await api.patch<{ message?: string }>(`/api/expenses/${id}`, body)
        : await api.post<{ message?: string }>('/api/operations', { entity: 'EXPENSE', propertyId, ...body })
      toast.success(editing ? 'Expense updated' : 'Expense added', result?.message)
      setOpen(false)
      router.refresh()
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Please try again.'
      toast.error('Could not save the expense', message)
      const field = Object.keys(values).find((k) => message.toLowerCase().startsWith(k.toLowerCase()))
      if (field) setErrors({ [field]: message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {trigger && (
        <Button variant="primary" onClick={() => setOpen(true)}>
          <Plus className="size-4" />
          {trigger}
        </Button>
      )}
      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent size="lg">
          <form onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>{editing ? 'Edit expense' : 'Record an expense'}</DialogTitle>
              <DialogDescription>
                {editing
                  ? 'Changes are kept in the activity log with the old values.'
                  : 'Updates the PG’s expenses, P&L and reports together.'}
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-2 sm:grid-cols-2">
              {!editing && (
                <Field label="PG" required error={errors.propertyId}>
                  <Select value={values.propertyId} onChange={(e) => set('propertyId', e.target.value)}>
                    {properties.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <Field label="Category" required error={errors.categoryId} className={cn(editing && 'sm:col-span-2')}>
                <Select value={values.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
                  <option value="">Choose…</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="What was it for?" required error={errors.title} className="sm:col-span-2">
                <Input value={values.title} placeholder="EB bill for September" onChange={(e) => set('title', e.target.value)} />
              </Field>
              <Field label="Amount (₹)" required error={errors.amount} hint={approvalNote}>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={values.amount}
                  onChange={(e) => set('amount', e.target.value === '' ? '' : Number(e.target.value))}
                />
              </Field>
              <Field label="Date" required error={errors.spentOn}>
                <Input type="date" value={values.spentOn} onChange={(e) => set('spentOn', e.target.value)} />
              </Field>
              <Field label="Vendor / paid to" error={errors.paidTo}>
                <Input value={values.paidTo} placeholder="TNEB, Ravi Plumbing…" onChange={(e) => set('paidTo', e.target.value)} />
              </Field>
              <Field label="Bill number" error={errors.billNumber}>
                <Input value={values.billNumber} onChange={(e) => set('billNumber', e.target.value)} />
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
              <Field label="Reference / UTR">
                <Input value={values.reference} onChange={(e) => set('reference', e.target.value)} />
              </Field>

              <Field label="Bill photo or PDF" error={errors.receiptUrl} className="sm:col-span-2">
                {values.receiptUrl ? (
                  <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                    <FileText className="size-4 text-slate-500" />
                    <a href={values.receiptUrl} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-medium text-blue-600">
                      View attached bill
                    </a>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove attachment" onClick={() => set('receiptUrl', '')}>
                      <X className="size-4" />
                    </Button>
                  </div>
                ) : (
                  <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 px-3 py-3 text-sm text-slate-600 hover:bg-slate-50">
                    {uploading ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
                    {uploading ? 'Uploading…' : 'Attach a photo or PDF (up to 5 MB)'}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      capture="environment"
                      className="sr-only"
                      disabled={uploading}
                      onChange={(e) => {
                        void attach(e.target.files?.[0])
                        e.target.value = ''
                      }}
                    />
                  </label>
                )}
              </Field>

              <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 sm:col-span-2">
                <span>
                  <span className="block text-sm font-medium text-slate-800">Repeats</span>
                  <span className="block text-xs text-slate-500">
                    A copy is added automatically on the same day each period (building rent, salaries, internet).
                  </span>
                </span>
                <Switch checked={values.isRecurring} onCheckedChange={(checked) => set('isRecurring', checked)} />
              </label>
              {values.isRecurring && (
                <Field label="How often" className="sm:col-span-2">
                  <Select value={values.recurrence} onChange={(e) => set('recurrence', e.target.value)}>
                    {RECURRENCE_OPTIONS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}

              <Field label="Notes" className="sm:col-span-2">
                <Textarea rows={2} value={values.notes} onChange={(e) => set('notes', e.target.value)} />
              </Field>
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={busy} disabled={uploading}>
                {editing ? 'Save changes' : 'Save expense'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
