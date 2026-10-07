'use client'

import * as React from 'react'
import Link from 'next/link'
import { CheckCircle2, ExternalLink, FileSpreadsheet, MessageCircle, RefreshCw, UserPlus, Users } from 'lucide-react'
import { api } from '@/lib/client'
import { toISODate } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'
import { Field, Input, Select } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Note, PHONE_RE, StepFooter, StepHeading, hasErrors, toInt, type Errors, type StepContext } from './ui'

function useAdvance(ctx: StepContext, action: string) {
  const toast = useToast()
  const [busy, setBusy] = React.useState(false)
  const go = async (how: 'complete' | 'skip') => {
    setBusy(true)
    try {
      await ctx.advance({ how })
    } catch (e) {
      toast.fromError(e, action)
    } finally {
      setBusy(false)
    }
  }
  return { busy, go }
}

// ------------------------------------------------------------ whatsapp ----

export function WhatsAppStep({ ctx }: { ctx: StepContext }) {
  const { busy, go } = useAdvance(ctx, 'save your progress')
  const { facts, isOwner, modules } = ctx.snapshot
  const moduleOn = modules.includes('whatsapp')

  return (
    <>
      <StepHeading
        title="WhatsApp"
        optional
        body="Rent reminders, receipts and notices on WhatsApp — the channel residents actually read."
      />
      {facts.whatsapp ? (
        <Note tone="ok">
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="size-4" />
            WhatsApp is connected. Reminders and receipts go out automatically.
          </span>
        </Note>
      ) : (
        <div className="space-y-3 rounded-xl border border-slate-200 p-4">
          <p className="flex items-center gap-2 font-medium text-slate-900">
            <MessageCircle className="size-4 text-emerald-600" />
            Send from your own WhatsApp Business number
          </p>
          <p className="text-sm text-slate-500">
            Connect your Meta WhatsApp Business account so messages carry your PG’s name.
          </p>
          {isOwner && moduleOn ? (
            <Button variant="outline" size="sm" asChild>
              <Link href="/app/settings/whatsapp" target="_blank">
                <ExternalLink className="size-3.5" />
                Connect WhatsApp
              </Link>
            </Button>
          ) : (
            <p className="text-xs text-slate-500">
              {moduleOn ? 'Only the owner can connect WhatsApp.' : 'The WhatsApp module is switched off for your account.'}
            </p>
          )}
        </div>
      )}
      <Note>
        No rush — until you connect your own number, messages go out from the StayFlow platform number, so
        residents still get reminders and receipts.
      </Note>
      <StepFooter
        onBack={ctx.back}
        onNext={() => go(facts.whatsapp ? 'complete' : 'skip')}
        nextLabel={facts.whatsapp ? 'Next' : 'Use platform number'}
        busy={busy}
      />
    </>
  )
}

// --------------------------------------------------------------- staff ----

export function StaffStep({ ctx }: { ctx: StepContext }) {
  const { busy, go } = useAdvance(ctx, 'save your progress')
  const { facts, modules } = ctx.snapshot
  const [added, setAdded] = React.useState<string[]>([])
  const total = facts.staff + facts.managers + added.length

  return (
    <>
      <StepHeading
        title="Team & staff"
        optional
        body="Invite a manager to run the PG with you, and add your cook, warden or housekeeping staff."
      />
      {total > 0 && (
        <Note tone="ok">
          <span className="flex items-center gap-1.5">
            <Users className="size-4" />
            {facts.managers} manager{facts.managers === 1 ? '' : 's'} and {facts.staff} staff on your team
            {added.length ? ` · just added: ${added.join(', ')}` : ''}
          </span>
        </Note>
      )}
      <InviteManager ctx={ctx} onAdded={(n) => setAdded((a) => [...a, n])} />
      {modules.includes('staff') && <AddStaff ctx={ctx} onAdded={(n) => setAdded((a) => [...a, n])} />}
      <StepFooter
        onBack={ctx.back}
        onNext={() => go(total > 0 ? 'complete' : 'skip')}
        nextLabel={total > 0 ? 'Next' : 'Skip for now'}
        busy={busy}
      />
    </>
  )
}

function InviteManager({ ctx, onAdded }: { ctx: StepContext; onAdded: (name: string) => void }) {
  const toast = useToast()
  const roles = ctx.snapshot.roles
  const [v, setV] = React.useState({ name: '', email: '', phone: '', orgRoleId: roles.find((r) => r.name === 'Manager')?.id ?? roles[0]?.id ?? '' })
  const [errors, setErrors] = React.useState<Errors>({})
  const [busy, setBusy] = React.useState(false)
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setV((s) => ({ ...s, [k]: e.target.value }))

  async function invite() {
    const e: Errors = {
      name: v.name.trim().length < 2 ? 'Enter their name' : undefined,
      email: !/^\S+@\S+\.\S+$/.test(v.email.trim()) ? 'Enter a valid email' : undefined,
      phone: !PHONE_RE.test(v.phone.trim()) ? 'Enter a valid 10-digit mobile number' : undefined,
    }
    setErrors(e)
    if (hasErrors(e)) return
    setBusy(true)
    try {
      const res = await api.post<{ message: string }>('/api/team', {
        action: 'INVITE_MANAGER',
        name: v.name.trim(),
        email: v.email.trim(),
        phone: v.phone.trim(),
        propertyIds: [],
        orgRoleId: v.orgRoleId || null,
      })
      toast.success('Invite sent', res.message)
      onAdded(v.name.trim())
      setV((s) => ({ ...s, name: '', email: '', phone: '' }))
    } catch (err) {
      toast.fromError(err, 'send the invite')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 p-4">
      <p className="flex items-center gap-2 font-medium text-slate-900">
        <UserPlus className="size-4 text-blue-600" />
        Invite a manager
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" error={errors.name}>
          <Input value={v.name} onChange={set('name')} aria-invalid={Boolean(errors.name)} />
        </Field>
        <Field label="Role">
          <Select value={v.orgRoleId} onChange={set('orgRoleId')}>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Email" error={errors.email}>
          <Input type="email" autoCapitalize="none" value={v.email} onChange={set('email')} aria-invalid={Boolean(errors.email)} />
        </Field>
        <Field label="Mobile" error={errors.phone}>
          <Input inputMode="tel" value={v.phone} onChange={set('phone')} aria-invalid={Boolean(errors.phone)} />
        </Field>
      </div>
      <Button variant="outline" size="sm" onClick={invite} loading={busy}>
        Send invite
      </Button>
    </div>
  )
}

function AddStaff({ ctx, onAdded }: { ctx: StepContext; onAdded: (name: string) => void }) {
  const toast = useToast()
  const jobs = ctx.snapshot.staffRoles
  const [v, setV] = React.useState({ name: '', role: jobs[0]?.value ?? '', phone: '', salary: '' })
  const [errors, setErrors] = React.useState<Errors>({})
  const [busy, setBusy] = React.useState(false)
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setV((s) => ({ ...s, [k]: e.target.value }))

  async function add() {
    const salary = v.salary.trim() ? toInt(v.salary) : undefined
    const e: Errors = {
      name: v.name.trim().length < 2 ? 'Enter the name' : undefined,
      role: !v.role ? 'Choose a job title' : undefined,
      phone: !PHONE_RE.test(v.phone.trim()) ? 'Enter a valid 10-digit mobile number' : undefined,
      salary: salary !== undefined && (Number.isNaN(salary) || salary < 0) ? 'Enter a whole rupee amount' : undefined,
    }
    setErrors(e)
    if (hasErrors(e)) return
    setBusy(true)
    try {
      const res = await api.post<{ message?: string }>('/api/operations', {
        entity: 'STAFF',
        name: v.name.trim(),
        role: v.role,
        phone: v.phone.trim(),
        propertyId: ctx.propertyId ?? '',
        joiningDate: toISODate(new Date()),
        salary,
        createLogin: false,
      })
      toast.success('Staff added', res.message)
      onAdded(v.name.trim())
      setV((s) => ({ ...s, name: '', phone: '', salary: '' }))
    } catch (err) {
      toast.fromError(err, 'add the staff member')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 p-4">
      <p className="flex items-center gap-2 font-medium text-slate-900">
        <Users className="size-4 text-blue-600" />
        Add staff
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" error={errors.name}>
          <Input value={v.name} onChange={set('name')} aria-invalid={Boolean(errors.name)} />
        </Field>
        <Field label="Job title" error={errors.role}>
          <Select value={v.role} onChange={set('role')}>
            {jobs.map((j) => (
              <option key={j.value} value={j.value}>
                {j.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Mobile" error={errors.phone}>
          <Input inputMode="tel" value={v.phone} onChange={set('phone')} aria-invalid={Boolean(errors.phone)} />
        </Field>
        <Field label="Monthly salary (₹)" hint="Optional" error={errors.salary}>
          <Input type="number" inputMode="numeric" value={v.salary} onChange={set('salary')} />
        </Field>
      </div>
      <Button variant="outline" size="sm" onClick={add} loading={busy}>
        Add staff member
      </Button>
    </div>
  )
}

// -------------------------------------------------------------- import ----

export function ImportStep({ ctx }: { ctx: StepContext }) {
  const { busy, go } = useAdvance(ctx, 'save your progress')
  const residents = ctx.snapshot.facts.residents

  return (
    <>
      <StepHeading
        title="Import residents"
        optional
        body="Already have residents? Bring them in from a spreadsheet, or check them in one by one."
      />
      {residents > 0 && (
        <Note tone="ok">
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="size-4" />
            {residents} resident{residents === 1 ? '' : 's'} in StayFlow
          </span>
        </Note>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          href="/app/residents/import"
          target="_blank"
          className="flex items-start gap-3 rounded-xl border border-slate-200 p-4 transition-colors hover:border-blue-300"
        >
          <FileSpreadsheet className="mt-0.5 size-5 shrink-0 text-emerald-600" />
          <span>
            <span className="block font-medium text-slate-900">Import from CSV</span>
            <span className="block text-xs text-slate-500">Download the template, fill it, upload. Opens in a new tab.</span>
          </span>
        </Link>
        <Link
          href="/app/residents/new"
          target="_blank"
          className="flex items-start gap-3 rounded-xl border border-slate-200 p-4 transition-colors hover:border-blue-300"
        >
          <UserPlus className="mt-0.5 size-5 shrink-0 text-blue-600" />
          <span>
            <span className="block font-medium text-slate-900">Check in a resident</span>
            <span className="block text-xs text-slate-500">Bed, rent, deposit and resident app in one go.</span>
          </span>
        </Link>
      </div>
      <p className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        Come back to this tab when you’re done.
        <Button variant="ghost" size="sm" onClick={ctx.refresh}>
          <RefreshCw className="size-3.5" />
          Refresh count
        </Button>
      </p>
      <StepFooter
        onBack={ctx.back}
        onNext={() => go(residents > 0 ? 'complete' : 'skip')}
        nextLabel={residents > 0 ? 'Next' : 'I’ll add residents later'}
        busy={busy}
      />
    </>
  )
}
