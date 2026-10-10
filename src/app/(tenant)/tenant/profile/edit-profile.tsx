'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Check, Pencil } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
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

export type ProfileValues = {
  phone: string
  whatsappPhone: string
  email: string
  bloodGroup: string
  guardianName: string
  guardianRelation: string
  guardianPhone: string
  permanentAddress: string
  city: string
  state: string
  pincode: string
  occupationType: string
  companyName: string
  designation: string
}

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']

/**
 * The resident edits their own contact, emergency contact, address and work
 * details. Name, ID proof, room and rent are changed by the PG owner.
 */
export function EditProfile({
  initial,
  relations,
}: {
  initial: ProfileValues
  relations: { value: string; label: string }[]
}) {
  const router = useRouter()
  const toast = useToast()
  const [open, setOpen] = React.useState(false)
  const [values, setValues] = React.useState(initial)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<{ field?: string; message: string } | null>(null)

  const set = (key: keyof ProfileValues, value: string) => {
    setValues((v) => ({ ...v, [key]: value }))
    if (error?.field === key) setError(null)
  }
  const err = (key: keyof ProfileValues) => (error?.field === key ? error.message : undefined)

  function openForm() {
    setValues(initial)
    setError(null)
    setOpen(true)
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!/^(\+?91[-\s]?)?[6-9]\d{9}$/.test(values.phone.trim())) {
      setError({ field: 'phone', message: 'Enter a valid 10-digit mobile number' })
      return
    }
    setBusy(true)
    try {
      const result = await api.patch<{ message: string }>('/api/tenant/profile', values)
      toast.success('Profile updated', result.message)
      setOpen(false)
      router.refresh()
    } catch (e) {
      const message = e instanceof ApiError ? e.message : 'Please try again.'
      const field = (Object.keys(values) as (keyof ProfileValues)[]).find((k) => message.toLowerCase().startsWith(k.toLowerCase()))
      setError({ field, message })
      toast.error('Could not save', message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={openForm}>
        <Pencil className="size-3.5" />
        Edit
      </Button>

      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent size="lg">
          <form onSubmit={save}>
            <DialogHeader>
              <DialogTitle>Edit your details</DialogTitle>
              <DialogDescription>
                Your name, ID proof, room and rent are updated by your PG owner.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-3 sm:grid-cols-2">
              <Field label="Mobile number" required error={err('phone')}>
                <Input type="tel" inputMode="tel" value={values.phone} onChange={(e) => set('phone', e.target.value)} />
              </Field>
              <Field label="WhatsApp number" hint="Leave empty if same as mobile" error={err('whatsappPhone')}>
                <Input type="tel" inputMode="tel" value={values.whatsappPhone} onChange={(e) => set('whatsappPhone', e.target.value)} />
              </Field>
              <Field label="Email" error={err('email')}>
                <Input type="email" inputMode="email" value={values.email} onChange={(e) => set('email', e.target.value)} />
              </Field>
              <Field label="Blood group">
                <Select value={values.bloodGroup} onChange={(e) => set('bloodGroup', e.target.value)}>
                  <option value="">Not set</option>
                  {BLOOD_GROUPS.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </Select>
              </Field>

              <p className="pt-1 text-sm font-semibold text-slate-900 sm:col-span-2">Emergency contact</p>
              <Field label="Name" error={err('guardianName')}>
                <Input value={values.guardianName} onChange={(e) => set('guardianName', e.target.value)} />
              </Field>
              <Field label="Relation" error={err('guardianRelation')}>
                <Select value={values.guardianRelation} onChange={(e) => set('guardianRelation', e.target.value)}>
                  <option value="">Choose…</option>
                  {relations.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Their phone" error={err('guardianPhone')} className="sm:col-span-2">
                <Input type="tel" inputMode="tel" value={values.guardianPhone} onChange={(e) => set('guardianPhone', e.target.value)} />
              </Field>

              <p className="pt-1 text-sm font-semibold text-slate-900 sm:col-span-2">Home address</p>
              <Field label="Address" error={err('permanentAddress')} className="sm:col-span-2">
                <Textarea rows={2} value={values.permanentAddress} onChange={(e) => set('permanentAddress', e.target.value)} />
              </Field>
              <Field label="City" error={err('city')}>
                <Input value={values.city} onChange={(e) => set('city', e.target.value)} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="State" error={err('state')}>
                  <Input value={values.state} onChange={(e) => set('state', e.target.value)} />
                </Field>
                <Field label="PIN code" error={err('pincode')}>
                  <Input inputMode="numeric" maxLength={6} value={values.pincode} onChange={(e) => set('pincode', e.target.value)} />
                </Field>
              </div>

              <p className="pt-1 text-sm font-semibold text-slate-900 sm:col-span-2">Work or study</p>
              <Field label="I am a">
                <Select value={values.occupationType} onChange={(e) => set('occupationType', e.target.value)}>
                  <option value="">Not set</option>
                  <option value="WORKING">Working professional</option>
                  <option value="STUDENT">Student</option>
                  <option value="OTHER">Other</option>
                </Select>
              </Field>
              <Field label={values.occupationType === 'STUDENT' ? 'College' : 'Company'} error={err('companyName')}>
                <Input value={values.companyName} onChange={(e) => set('companyName', e.target.value)} />
              </Field>
              <Field label={values.occupationType === 'STUDENT' ? 'Course' : 'Designation'} error={err('designation')} className="sm:col-span-2">
                <Input value={values.designation} onChange={(e) => set('designation', e.target.value)} />
              </Field>
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={busy}>
                <Check className="size-4" />
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
