'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { api } from '@/lib/client'
import { toISODate } from '@/lib/utils'
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
import { ROOM_PREFS, SOURCES } from './lead-meta'

type PropertyOption = { id: string; name: string }

const EMPTY = {
  name: '',
  phone: '',
  email: '',
  gender: '',
  source: 'PHONE',
  budget: '',
  roomTypePref: '',
  moveInDate: '',
  notes: '',
}

export function NewLeadButton({
  properties,
  defaultPropertyId,
  label = 'Add enquiry',
  variant = 'primary',
}: {
  properties: PropertyOption[]
  defaultPropertyId?: string | null
  label?: string
  variant?: 'primary' | 'outline'
}) {
  const router = useRouter()
  const toast = useToast()
  const [open, setOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [values, setValues] = React.useState({ ...EMPTY, propertyId: defaultPropertyId ?? properties[0]?.id ?? '' })
  const [errors, setErrors] = React.useState<Record<string, string>>({})

  const wasOpen = React.useRef(open)
  React.useEffect(() => {
    if (open && !wasOpen.current) {
      setValues({ ...EMPTY, propertyId: defaultPropertyId ?? properties[0]?.id ?? '' })
      setErrors({})
    }
    wasOpen.current = open
  }, [open, defaultPropertyId, properties])

  function set(name: keyof typeof values, value: string) {
    setValues((v) => ({ ...v, [name]: value }))
    setErrors((e) => {
      if (!e[name]) return e
      const next = { ...e }
      delete next[name]
      return next
    })
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const nextErrors: Record<string, string> = {}
    if (values.name.trim().length < 2) nextErrors.name = 'Enter their name'
    if (!/^(\+?91[-\s]?)?[6-9]\d{9}$/.test(values.phone.replace(/\s/g, ''))) {
      nextErrors.phone = 'Enter a valid 10-digit mobile number'
    }
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors)
      return
    }
    setBusy(true)
    try {
      const result = await api.post<{ lead: { id: string; name: string }; deduped: boolean; message: string }>(
        '/api/resident-leads',
        { ...values, phone: values.phone.replace(/\s/g, ''), budget: values.budget || '' },
      )
      if (result.deduped) toast.info('Already in your pipeline', result.message)
      else toast.success('Enquiry added', result.message)
      setOpen(false)
      router.refresh()
    } catch (error) {
      toast.fromError(error, 'add the enquiry')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <Plus /> {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>New enquiry</DialogTitle>
            <DialogDescription>
              Someone asked about a bed? Note it down in a few seconds — we’ll remind you to follow up.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" required error={errors.name}>
              <Input autoFocus placeholder="e.g. Priya Raman" value={values.name} onChange={(e) => set('name', e.target.value)} />
            </Field>
            <Field label="Mobile number" required error={errors.phone} hint="Same number again? We’ll update their enquiry.">
              <Input inputMode="tel" placeholder="10-digit number" value={values.phone} onChange={(e) => set('phone', e.target.value)} />
            </Field>
            <Field label="Email">
              <Input type="email" placeholder="Optional" value={values.email} onChange={(e) => set('email', e.target.value)} />
            </Field>
            <Field label="Gender">
              <Select value={values.gender} onChange={(e) => set('gender', e.target.value)}>
                <option value="">Not specified</option>
                <option value="FEMALE">Female</option>
                <option value="MALE">Male</option>
                <option value="OTHER">Other</option>
              </Select>
            </Field>
            <Field label="PG they’re asking about">
              <Select value={values.propertyId} onChange={(e) => set('propertyId', e.target.value)}>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="How did they find you?">
              <Select value={values.source} onChange={(e) => set('source', e.target.value)}>
                {SOURCES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Budget (₹ / month)">
              <Input type="number" inputMode="numeric" min={0} placeholder="e.g. 9000" value={values.budget} onChange={(e) => set('budget', e.target.value)} />
            </Field>
            <Field label="Room preference">
              <Select value={values.roomTypePref} onChange={(e) => set('roomTypePref', e.target.value)}>
                {ROOM_PREFS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Move-in date">
              <Input type="date" min={toISODate(new Date())} value={values.moveInDate} onChange={(e) => set('moveInDate', e.target.value)} />
            </Field>
            <Field label="Notes" className="sm:col-span-2">
              <Textarea rows={2} placeholder="Working at…, wants AC, coming with a friend…" value={values.notes} onChange={(e) => set('notes', e.target.value)} />
            </Field>
            <DialogFooter className="sm:col-span-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={busy}>
                Save enquiry
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
