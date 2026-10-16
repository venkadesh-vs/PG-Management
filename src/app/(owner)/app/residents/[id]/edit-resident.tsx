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
import { cleanPhone, PhoneInput, PincodeInput } from '@/components/ui/india-inputs'
import { INDIA, INDIA_MESSAGE, idNumberProblem, idNumberFormat, idNumberRule } from '@/lib/india'
import { Switch } from '@/components/ui/primitives'

export type EditResidentValues = {
  fullName: string
  phone: string
  whatsappPhone: string
  email: string
  dateOfBirth: string
  gender: string
  bloodGroup: string
  qualification: string
  guardianName: string
  guardianRelation: string
  guardianPhone: string
  guardianAddress: string
  permanentAddress: string
  city: string
  state: string
  pincode: string
  occupationType: string
  companyName: string
  designation: string
  idType: string
  idNumber: string
  kycStatus: string
  rentDueDay: number
  maintenanceFee: number
  foodOptIn: boolean
  foodCharge: number
  discountAmount: number
  discountNote: string
  notes: string
}

type Option = { value: string; label: string }

/** Fired by the ⋯ menu so the one edit dialog on the page opens. */
export const EDIT_RESIDENT_EVENT = 'stayflow:edit-resident'

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']

/** Keep a stored value selectable even when it is not on the org's list. */
function withCurrent(options: Option[], current: string) {
  return current && !options.some((o) => o.value === current) ? [...options, { value: current, label: current }] : options
}

/**
 * Fix a resident's details after check-in. Rent changes go through the rent
 * revision card and the room through "Move to another bed", so both keep
 * their history; everything else is here, and every change is logged with
 * the old and new value.
 */
export function EditResident({
  residentId,
  initial,
  relations,
  idTypes,
  can,
  label = 'Edit',
}: {
  residentId: string
  initial: EditResidentValues
  relations: Option[]
  idTypes: Option[]
  /** rent.manage for the billing fields, residents.kyc for the full ID number. */
  can: { rent: boolean; kyc: boolean }
  label?: string
}) {
  const router = useRouter()
  const toast = useToast()
  const [open, setOpen] = React.useState(false)
  const [values, setValues] = React.useState(initial)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<{ field?: string; message: string } | null>(null)

  // Opened from the ⋯ menu ("Edit details") or a link with ?edit=1.
  React.useEffect(() => {
    const show = () => {
      setValues(initial)
      setError(null)
      setOpen(true)
    }
    if (new URLSearchParams(window.location.search).get('edit') === '1') show()
    window.addEventListener(EDIT_RESIDENT_EVENT, show)
    return () => window.removeEventListener(EDIT_RESIDENT_EVENT, show)
  }, [initial])

  const set = <K extends keyof EditResidentValues>(key: K, value: EditResidentValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }))
    if (error?.field === key) setError(null)
  }
  const idRule = idNumberRule(values.idType)
  const idBox = idNumberFormat(values.idType)
  const err = (key: keyof EditResidentValues) => (error?.field === key ? error.message : undefined)

  function openForm() {
    setValues(initial)
    setError(null)
    setOpen(true)
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (values.fullName.trim().length < 2) return setError({ field: 'fullName', message: 'Enter the full name' })
    if (!INDIA.mobile.test(cleanPhone(values.phone))) {
      return setError({ field: 'phone', message: INDIA_MESSAGE.mobile })
    }
    // Optional numbers are checked only when edited, so an old value never blocks a save.
    const changed = (key: keyof EditResidentValues) => values[key] !== initial[key] && String(values[key]).trim() !== ''
    for (const key of ['whatsappPhone', 'guardianPhone'] as const) {
      if (changed(key) && !INDIA.mobile.test(cleanPhone(values[key]))) return setError({ field: key, message: INDIA_MESSAGE.mobile })
    }
    if (changed('pincode') && !INDIA.pincode.test(values.pincode.trim())) {
      return setError({ field: 'pincode', message: INDIA_MESSAGE.pincode })
    }
    if (can.kyc && (changed('idNumber') || (changed('idType') && values.idNumber))) {
      const problem = idNumberProblem(values.idType, values.idNumber)
      if (problem) return setError({ field: 'idNumber', message: problem })
    }
    // Send only what changed, so a field this person may not edit is never touched.
    const body: Record<string, unknown> = {}
    for (const key of Object.keys(values) as (keyof EditResidentValues)[]) {
      if (values[key] !== initial[key]) body[key] = values[key]
    }
    if (!Object.keys(body).length) {
      setOpen(false)
      return
    }
    setBusy(true)
    try {
      await api.patch(`/api/residents/${residentId}`, body)
      toast.success('Details updated', 'The change is saved in the activity log.')
      setOpen(false)
      router.refresh()
    } catch (e) {
      const message = e instanceof ApiError ? e.message : 'Please try again.'
      const field = (Object.keys(values) as (keyof EditResidentValues)[]).find((k) => message.toLowerCase().startsWith(k.toLowerCase()))
      setError({ field, message })
      toast.error('Could not save', message)
    } finally {
      setBusy(false)
    }
  }

  const money = (key: 'maintenanceFee' | 'foodCharge' | 'discountAmount') => (
    <Input
      type="number"
      inputMode="numeric"
      min={0}
      disabled={!can.rent}
      value={values[key]}
      onChange={(e) => set(key, Math.max(0, Math.round(Number(e.target.value) || 0)))}
    />
  )

  return (
    <>
      <Button variant="outline" size="sm" onClick={openForm}>
        <Pencil className="size-3.5" />
        {label}
      </Button>

      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent size="lg">
          <form onSubmit={save}>
            <DialogHeader>
              <DialogTitle>Edit resident details</DialogTitle>
              <DialogDescription>
                Fix any mistake from check-in. To change rent use “Change rent” on the Rent & invoices tab, and for the room use
                “Move to another bed”, so both keep their history.
              </DialogDescription>
            </DialogHeader>

            <div className="grid max-h-[65vh] gap-4 overflow-y-auto py-3 pr-1 sm:grid-cols-2">
              <Section>Personal</Section>
              <Field label="Full name" required error={err('fullName')} className="sm:col-span-2">
                <Input value={values.fullName} onChange={(e) => set('fullName', e.target.value)} />
              </Field>
              <Field label="Mobile" required error={err('phone')}>
                <PhoneInput value={values.phone} onChange={(e) => set('phone', e.target.value)} />
              </Field>
              <Field label="WhatsApp" hint="Empty = same as mobile" error={err('whatsappPhone')}>
                <PhoneInput value={values.whatsappPhone} onChange={(e) => set('whatsappPhone', e.target.value)} />
              </Field>
              <Field label="Email" error={err('email')}>
                <Input type="email" value={values.email} onChange={(e) => set('email', e.target.value)} />
              </Field>
              <Field label="Date of birth" error={err('dateOfBirth')}>
                <Input type="date" value={values.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} />
              </Field>
              <Field label="Gender">
                <Select value={values.gender} onChange={(e) => set('gender', e.target.value)}>
                  <option value="">Not set</option>
                  {withCurrent([{ value: 'MALE', label: 'Male' }, { value: 'FEMALE', label: 'Female' }, { value: 'OTHER', label: 'Other' }], values.gender).map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Blood group">
                <Select value={values.bloodGroup} onChange={(e) => set('bloodGroup', e.target.value)}>
                  <option value="">Not set</option>
                  {withCurrent(BLOOD_GROUPS.map((g) => ({ value: g, label: g })), values.bloodGroup).map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Qualification" className="sm:col-span-2">
                <Input value={values.qualification} onChange={(e) => set('qualification', e.target.value)} />
              </Field>

              <Section>Guardian / emergency contact</Section>
              <Field label="Name" error={err('guardianName')}>
                <Input value={values.guardianName} onChange={(e) => set('guardianName', e.target.value)} />
              </Field>
              <Field label="Relation">
                <Select value={values.guardianRelation} onChange={(e) => set('guardianRelation', e.target.value)}>
                  <option value="">Choose…</option>
                  {withCurrent(relations, values.guardianRelation).map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Guardian mobile" error={err('guardianPhone')}>
                <PhoneInput value={values.guardianPhone} onChange={(e) => set('guardianPhone', e.target.value)} />
              </Field>
              <Field label="Guardian address">
                <Input value={values.guardianAddress} onChange={(e) => set('guardianAddress', e.target.value)} />
              </Field>

              <Section>Permanent address</Section>
              <Field label="Address" className="sm:col-span-2">
                <Textarea rows={2} value={values.permanentAddress} onChange={(e) => set('permanentAddress', e.target.value)} />
              </Field>
              <Field label="City">
                <Input value={values.city} onChange={(e) => set('city', e.target.value)} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="State">
                  <Input value={values.state} onChange={(e) => set('state', e.target.value)} />
                </Field>
                <Field label="PIN code" error={err('pincode')}>
                  <PincodeInput value={values.pincode} onChange={(e) => set('pincode', e.target.value)} />
                </Field>
              </div>

              <Section>Work or study</Section>
              <Field label="Occupation">
                <Select value={values.occupationType} onChange={(e) => set('occupationType', e.target.value)}>
                  <option value="">Not set</option>
                  <option value="WORKING">Working</option>
                  <option value="STUDENT">Student</option>
                  <option value="OTHER">Other</option>
                </Select>
              </Field>
              <Field label={values.occupationType === 'STUDENT' ? 'College' : 'Company'}>
                <Input value={values.companyName} onChange={(e) => set('companyName', e.target.value)} />
              </Field>
              <Field label={values.occupationType === 'STUDENT' ? 'Course' : 'Designation'} className="sm:col-span-2">
                <Input value={values.designation} onChange={(e) => set('designation', e.target.value)} />
              </Field>

              <Section>ID proof</Section>
              <Field label="ID type">
                <Select value={values.idType} onChange={(e) => set('idType', e.target.value)}>
                  <option value="">Not set</option>
                  {withCurrent(idTypes, values.idType).map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </Select>
              </Field>
              <Field
                label="ID number"
                hint={can.kyc ? idRule?.message : 'Only someone with full ID access can change this'}
                error={err('idNumber')}
              >
                <Input
                  value={values.idNumber}
                  disabled={!can.kyc}
                  placeholder={idBox?.placeholder}
                  maxLength={idBox?.maxLength}
                  inputMode={idBox?.numeric ? 'numeric' : undefined}
                  onChange={(e) => set('idNumber', idRule ? idRule.clean(e.target.value) : e.target.value)}
                />
              </Field>
              <Field label="KYC status" className="sm:col-span-2">
                <Select value={values.kycStatus} onChange={(e) => set('kycStatus', e.target.value)}>
                  <option value="NOT_SUBMITTED">Not submitted</option>
                  <option value="PENDING">Pending</option>
                  <option value="VERIFIED">Verified</option>
                  <option value="REJECTED">Rejected</option>
                </Select>
              </Field>

              <Section>
                Billing{!can.rent && <span className="ml-1 font-normal text-slate-500">(needs rent permission)</span>}
              </Section>
              <Field label="Rent due day" hint="Day of the month, 1–28" error={err('rentDueDay')}>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={28}
                  disabled={!can.rent}
                  value={values.rentDueDay}
                  onChange={(e) => set('rentDueDay', Math.min(28, Math.max(1, Math.round(Number(e.target.value) || 1))))}
                />
              </Field>
              <Field label="Maintenance (₹/month)" error={err('maintenanceFee')}>{money('maintenanceFee')}</Field>
              <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 sm:col-span-2">
                <span className="text-sm text-slate-700">Takes food from the PG</span>
                <Switch checked={values.foodOptIn} disabled={!can.rent} onCheckedChange={(v) => set('foodOptIn', v)} aria-label="Takes food" />
              </div>
              {values.foodOptIn && (
                <Field label="Food charge (₹/month)" error={err('foodCharge')}>{money('foodCharge')}</Field>
              )}
              <Field label="Discount (₹/month)" error={err('discountAmount')}>{money('discountAmount')}</Field>
              {values.discountAmount > 0 && (
                <Field label="Discount reason" className="sm:col-span-2">
                  <Input value={values.discountNote} disabled={!can.rent} onChange={(e) => set('discountNote', e.target.value)} />
                </Field>
              )}
              <p className="text-xs text-slate-500 sm:col-span-2">
                Billing changes apply from the next rent bill. Bills already raised stay as they are; adjust them from the Rent tab.
              </p>

              <Section>Notes</Section>
              <Field label="Private notes" className="sm:col-span-2">
                <Textarea rows={2} value={values.notes} onChange={(e) => set('notes', e.target.value)} />
              </Field>
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={busy}>
                <Check className="size-4" />
                Save changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

function Section({ children }: { children: React.ReactNode }) {
  return <p className="border-t border-slate-100 pt-3 text-sm font-semibold text-slate-900 first:border-0 first:pt-0 sm:col-span-2">{children}</p>
}
