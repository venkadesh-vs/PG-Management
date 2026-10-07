'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Plus } from 'lucide-react'
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
import { LEAD_SOURCES, LEAD_STATUSES, LOST_REASONS, leadStyle } from './lead-meta'

export type AdminOption = { id: string; name: string }

export type EditableLead = {
  id: string
  name: string
  phone: string
  whatsapp: string | null
  email: string | null
  pgName: string | null
  city: string | null
  bedCount: number | null
  pgCount: number
  currentSoftware: string | null
  source: string
  salesOwnerId: string | null
  followUpAt: string | null
  demoAt: string | null
  lostReason: string | null
  status: string
}

type Values = {
  name: string
  phone: string
  whatsapp: string
  email: string
  pgName: string
  city: string
  bedCount: string
  pgCount: string
  currentSoftware: string
  source: string
  salesOwnerId: string
  followUpDate: string
  demoAt: string
  lostReason: string
  status: string
  note: string
}

const pad = (n: number) => String(n).padStart(2, '0')

/** ISO → value for <input type="datetime-local">, in the viewer's time. */
export function toLocalDateTime(iso: string | null | undefined) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function toLocalDate(iso: string | null | undefined) {
  return toLocalDateTime(iso).slice(0, 10)
}

function initial(lead?: EditableLead, currentAdminId?: string): Values {
  return {
    name: lead?.name ?? '',
    phone: lead?.phone ?? '',
    whatsapp: lead?.whatsapp ?? '',
    email: lead?.email ?? '',
    pgName: lead?.pgName ?? '',
    city: lead?.city ?? '',
    bedCount: lead?.bedCount != null ? String(lead.bedCount) : '',
    pgCount: lead ? String(lead.pgCount) : '1',
    currentSoftware: lead?.currentSoftware ?? '',
    source: lead?.source ?? 'phone',
    salesOwnerId: lead?.salesOwnerId ?? currentAdminId ?? '',
    followUpDate: toLocalDate(lead?.followUpAt),
    demoAt: toLocalDateTime(lead?.demoAt),
    lostReason: lead?.lostReason ?? '',
    status: lead?.status ?? 'NEW',
    note: '',
  }
}

/**
 * Add a lead by hand, or edit every field of an existing one. The API audits
 * the before/after of whatever changed.
 */
export function LeadEditDialog({
  lead,
  admins,
  currentAdminId,
  trigger,
}: {
  lead?: EditableLead
  admins: AdminOption[]
  currentAdminId?: string
  trigger?: 'button' | 'icon'
}) {
  const router = useRouter()
  const toast = useToast()
  const [open, setOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [values, setValues] = React.useState<Values>(() => initial(lead, currentAdminId))
  const set = (key: keyof Values) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setValues((v) => ({ ...v, [key]: e.target.value }))

  function openDialog() {
    setValues(initial(lead, currentAdminId))
    setOpen(true)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      const payload = {
        name: values.name,
        phone: values.phone,
        whatsapp: values.whatsapp,
        email: values.email,
        pgName: values.pgName,
        city: values.city,
        bedCount: values.bedCount,
        pgCount: values.pgCount || '1',
        currentSoftware: values.currentSoftware,
        source: values.source,
        salesOwnerId: values.salesOwnerId || null,
        followUpAt: values.followUpDate ? `${values.followUpDate}T10:00` : null,
        demoAt: values.demoAt || null,
        lostReason: values.lostReason,
        note: values.note || undefined,
      }
      const res = lead
        ? await api.post<{ message: string }>('/api/admin/leads', {
            leadId: lead.id,
            ...payload,
            status: values.status !== lead.status ? values.status : undefined,
          })
        : await api.post<{ message: string }>('/api/admin/leads', { action: 'CREATE_LEAD', ...payload })
      toast.success(lead ? 'Lead saved' : 'Lead added', res.message)
      setOpen(false)
      router.refresh()
    } catch (error) {
      toast.fromError(error, lead ? 'save the lead' : 'add the lead')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {trigger === 'icon' ? (
        <Button variant="ghost" size="sm" onClick={openDialog}>
          <Pencil className="size-3.5" />
          Edit
        </Button>
      ) : (
        <Button variant="primary" onClick={openDialog}>
          <Plus className="size-4" />
          Add lead
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{lead ? `Edit ${lead.name}` : 'Add a lead'}</DialogTitle>
            <DialogDescription>
              {lead ? 'Every change is recorded in the audit log.' : 'A PG owner you met, who called, or was referred.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Owner name" required>
                <Input value={values.name} onChange={set('name')} required />
              </Field>
              <Field label="PG name">
                <Input value={values.pgName} onChange={set('pgName')} />
              </Field>
              <Field label="Phone" required>
                <Input type="tel" value={values.phone} onChange={set('phone')} required />
              </Field>
              <Field label="WhatsApp" hint="Leave empty if same as phone">
                <Input type="tel" value={values.whatsapp} onChange={set('whatsapp')} />
              </Field>
              <Field label="Email">
                <Input type="email" value={values.email} onChange={set('email')} />
              </Field>
              <Field label="City">
                <Input value={values.city} onChange={set('city')} />
              </Field>
              <Field label="Beds">
                <Input type="number" min={0} inputMode="numeric" value={values.bedCount} onChange={set('bedCount')} />
              </Field>
              <Field label="PGs">
                <Input type="number" min={1} inputMode="numeric" value={values.pgCount} onChange={set('pgCount')} />
              </Field>
              <Field label="Current software" hint="Excel, notebook, another app…">
                <Input value={values.currentSoftware} onChange={set('currentSoftware')} />
              </Field>
              <Field label="Source">
                <Select value={values.source} onChange={set('source')}>
                  {LEAD_SOURCES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                  {!LEAD_SOURCES.some((s) => s.value === values.source) && values.source && (
                    <option value={values.source}>{values.source}</option>
                  )}
                </Select>
              </Field>
              <Field label="Sales owner">
                <Select value={values.salesOwnerId} onChange={set('salesOwnerId')}>
                  <option value="">Unassigned</option>
                  {admins.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
              </Field>
              {lead && (
                <Field label="Stage">
                  <Select value={values.status} onChange={set('status')}>
                    {LEAD_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {leadStyle(s).label}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <Field label="Next follow-up">
                <Input type="date" value={values.followUpDate} onChange={set('followUpDate')} />
              </Field>
              <Field label="Demo date & time">
                <Input type="datetime-local" value={values.demoAt} onChange={set('demoAt')} />
              </Field>
              {(values.status === 'LOST' || values.lostReason) && (
                <Field label="Lost reason" required={values.status === 'LOST'}>
                  <Select value={values.lostReason} onChange={set('lostReason')}>
                    <option value="">Pick a reason</option>
                    {LOST_REASONS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </div>
            <Field label={lead ? 'Add a note (optional)' : 'Notes'}>
              <Textarea rows={2} value={values.note} onChange={set('note')} placeholder="What did they say?" />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={busy}>
                {lead ? 'Save lead' : 'Add lead'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
