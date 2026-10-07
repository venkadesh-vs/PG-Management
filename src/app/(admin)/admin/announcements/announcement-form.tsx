'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Plus, Square } from 'lucide-react'
import { api } from '@/lib/client'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toLocalDateTime } from '../leads/lead-edit-dialog'
import { AUDIENCES, SEVERITIES } from './announcement-meta'

export type AnnouncementRow = {
  id: string
  title: string
  body: string
  audience: string
  severity: string
  startsAt: string
  endsAt: string | null
}


export function AnnouncementDialog({ announcement }: { announcement?: AnnouncementRow }) {
  const router = useRouter()
  const toast = useToast()
  const [open, setOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const blank = () => ({
    title: announcement?.title ?? '',
    body: announcement?.body ?? '',
    audience: announcement?.audience ?? 'ALL',
    severity: announcement?.severity ?? 'INFO',
    startsAt: toLocalDateTime(announcement?.startsAt),
    endsAt: toLocalDateTime(announcement?.endsAt),
  })
  const [values, setValues] = React.useState(blank)
  const set = (key: keyof ReturnType<typeof blank>) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setValues((v) => ({ ...v, [key]: e.target.value }))

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      const res = await api.post<{ message: string }>('/api/admin/announcements', {
        action: announcement ? 'UPDATE' : 'CREATE',
        ...(announcement ? { id: announcement.id } : {}),
        ...values,
        startsAt: values.startsAt || null,
        endsAt: values.endsAt || null,
      })
      toast.success(announcement ? 'Saved' : 'Published', res.message)
      setOpen(false)
      router.refresh()
    } catch (error) {
      toast.fromError(error, announcement ? 'save the announcement' : 'publish the announcement')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {announcement ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setValues(blank())
            setOpen(true)
          }}
        >
          <Pencil className="size-3.5" />
          Edit
        </Button>
      ) : (
        <Button
          variant="primary"
          onClick={() => {
            setValues(blank())
            setOpen(true)
          }}
        >
          <Plus className="size-4" />
          New announcement
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{announcement ? 'Edit announcement' : 'New announcement'}</DialogTitle>
            <DialogDescription>Shown as a banner on PG owners’ dashboards. They can dismiss it.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-3">
            <Field label="Title" required>
              <Input value={values.title} onChange={set('title')} placeholder="Scheduled maintenance on Sunday" required />
            </Field>
            <Field label="Message" required>
              <Textarea rows={3} value={values.body} onChange={set('body')} required />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Who sees it">
                <Select value={values.audience} onChange={set('audience')}>
                  {AUDIENCES.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Tone">
                <Select value={values.severity} onChange={set('severity')}>
                  {SEVERITIES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Starts" hint="Empty = now">
                <Input type="datetime-local" value={values.startsAt} onChange={set('startsAt')} />
              </Field>
              <Field label="Ends" hint="Empty = until you end it">
                <Input type="datetime-local" value={values.endsAt} onChange={set('endsAt')} />
              </Field>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={busy}>
                {announcement ? 'Save' : 'Publish'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function EndAnnouncementButton({ id }: { id: string }) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = React.useState(false)
  async function end() {
    setBusy(true)
    try {
      const res = await api.post<{ message: string }>('/api/admin/announcements', { action: 'END', id })
      toast.success('Ended', res.message)
      router.refresh()
    } catch (error) {
      toast.fromError(error, 'end the announcement')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button variant="ghost" size="sm" onClick={end} loading={busy}>
      <Square className="size-3.5" />
      End now
    </Button>
  )
}
