'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { FileText, Loader2, Paperclip, Plus, X } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { TICKET_CATEGORIES, TICKET_PRIORITIES } from '@/lib/support'
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

/** "Contact support" — opens a ticket with the StayFlow team. */
export function NewTicket({
  label = 'New ticket',
  defaultCategory = '',
  defaultSubject = '',
  autoOpen = false,
}: {
  label?: string
  defaultCategory?: string
  defaultSubject?: string
  autoOpen?: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const [open, setOpen] = React.useState(autoOpen)
  const [busy, setBusy] = React.useState(false)
  const [uploading, setUploading] = React.useState(false)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [values, setValues] = React.useState({
    subject: defaultSubject,
    category: defaultCategory,
    priority: 'NORMAL',
    message: '',
    attachmentUrl: '',
  })
  const set = (key: keyof typeof values, value: string) => {
    setValues((v) => ({ ...v, [key]: value }))
    setErrors((e) => ({ ...e, [key]: '' }))
  }

  async function attach(file: File | undefined) {
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      toast.error('That file is too large', 'Screenshots and PDFs up to 5 MB can be attached.')
      return
    }
    setUploading(true)
    try {
      const form = new FormData()
      form.set('file', file)
      form.set('purpose', 'OTHER')
      const res = await fetch('/api/uploads', { method: 'POST', body: form, credentials: 'same-origin' })
      const data = (await res.json().catch(() => null)) as { url?: string; error?: string } | null
      if (!res.ok || !data?.url) throw new Error(data?.error ?? 'The file could not be uploaded.')
      set('attachmentUrl', data.url)
    } catch (error) {
      toast.error('Upload failed', (error as Error).message)
    } finally {
      setUploading(false)
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const missing: Record<string, string> = {}
    if (values.subject.trim().length < 5) missing.subject = 'Give the ticket a short subject'
    if (!values.category) missing.category = 'Choose what this is about'
    if (values.message.trim().length < 5) missing.message = 'Write a few words about the problem'
    if (Object.keys(missing).length) {
      setErrors(missing)
      return
    }
    setBusy(true)
    try {
      const result = await api.post<{ ticket: { id: string; code: string }; message: string }>('/api/support', {
        ...values,
        attachmentUrl: values.attachmentUrl || undefined,
      })
      toast.success(`Ticket ${result.ticket.code} sent`, result.message)
      setOpen(false)
      router.push(`/app/support/${result.ticket.id}`)
    } catch (error) {
      toast.error('Could not send the ticket', error instanceof ApiError ? error.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent size="lg">
          <form onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>Contact StayFlow support</DialogTitle>
              <DialogDescription>
                Tell us what happened and what you expected. Screenshots help us fix it faster.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-2 sm:grid-cols-2">
              <Field label="Subject" required error={errors.subject} className="sm:col-span-2">
                <Input
                  value={values.subject}
                  maxLength={140}
                  onChange={(e) => set('subject', e.target.value)}
                  placeholder="e.g. Rent reminders did not go out today"
                />
              </Field>
              <Field label="About" required error={errors.category}>
                <Select value={values.category} onChange={(e) => set('category', e.target.value)}>
                  <option value="">Choose…</option>
                  {TICKET_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="How urgent?"
                hint={TICKET_PRIORITIES.find((p) => p.value === values.priority)?.hint}
              >
                <Select value={values.priority} onChange={(e) => set('priority', e.target.value)}>
                  {TICKET_PRIORITIES.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="What happened?" required error={errors.message} className="sm:col-span-2">
                <Textarea
                  rows={5}
                  maxLength={4000}
                  value={values.message}
                  onChange={(e) => set('message', e.target.value)}
                  placeholder="Which page, which resident or PG, and what you saw on screen."
                />
              </Field>
              <div className="sm:col-span-2">
                {values.attachmentUrl ? (
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700">
                    <FileText className="size-3.5" />
                    File attached
                    <button
                      type="button"
                      onClick={() => set('attachmentUrl', '')}
                      className="rounded p-0.5 text-slate-400 hover:text-slate-700"
                      aria-label="Remove attachment"
                    >
                      <X className="size-3.5" />
                    </button>
                  </span>
                ) : (
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
                    {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Paperclip className="size-3.5" />}
                    {uploading ? 'Uploading…' : 'Attach a screenshot or PDF (optional)'}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      className="sr-only"
                      disabled={uploading}
                      onChange={(e) => {
                        void attach(e.target.files?.[0])
                        e.target.value = ''
                      }}
                    />
                  </label>
                )}
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={busy} disabled={uploading}>
                Send ticket
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
