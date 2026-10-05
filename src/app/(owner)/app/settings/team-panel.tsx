'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Ban, RotateCcw, Smartphone, UserPlus, Users } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { cn, formatDateTime, relativeTime } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Input, Select } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/primitives'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { InviteLinkPanel, ResendInviteButton, type AccessLink } from '@/components/app/invite-link'
import { APP_LABEL, ROLE_DOT, type RoleRow } from '@/components/settings/shared'

export type TeamMember = {
  id: string
  name: string
  email: string
  phone: string | null
  role: string
  status: string
  pending: boolean
  lastLoginAt: string | null
  propertyNames: string[]
  orgRoleId: string | null
  roleName: string | null
}

export function TeamPanel({
  team,
  properties,
  currentUserId,
  canManage,
  roles,
}: {
  team: TeamMember[]
  properties: { id: string; name: string }[]
  currentUserId: string
  canManage: boolean
  roles: RoleRow[]
}) {
  const router = useRouter()
  const toast = useToast()
  const [inviting, setInviting] = React.useState(false)
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const [confirm, setConfirm] = React.useState<TeamMember | null>(null)
  const office = team.filter((m) => m.role !== 'WORKER')
  const staffLogins = team.filter((m) => m.role === 'WORKER')

  async function setRole(member: TeamMember, orgRoleId: string) {
    if (!orgRoleId || orgRoleId === member.orgRoleId) return
    setBusyId(member.id)
    try {
      const res = await api.post<{ message: string }>('/api/team', { action: 'SET_MEMBER_ROLE', userId: member.id, orgRoleId })
      toast.success('Role updated', `${res.message}. It applies on their next click.`)
      router.refresh()
    } catch (error) {
      toast.fromError(error, 'change the role')
    } finally {
      setBusyId(null)
    }
  }

  function rolePicker(member: TeamMember) {
    const app = member.role === 'WORKER' ? 'STAFF_APP' : 'DASHBOARD'
    const options = roles.filter((r) => r.app === app)
    const current = roles.find((r) => r.id === member.orgRoleId)
    if (!canManage) {
      return (
        <Badge variant="outline" size="sm">
          {current && <span className={cn('size-2 rounded-full', ROLE_DOT[current.color] ?? ROLE_DOT.blue)} />}
          {member.roleName ?? 'No role'}
        </Badge>
      )
    }
    return (
      <Select
        aria-label={`Role for ${member.name}`}
        className="h-8 w-auto min-w-[9rem] py-0 text-xs"
        value={member.orgRoleId ?? ''}
        disabled={busyId === member.id}
        onChange={(e) => setRole(member, e.target.value)}
      >
        {!member.orgRoleId && <option value="">Choose a role</option>}
        {options.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </Select>
    )
  }

  async function setActive(member: TeamMember, active: boolean) {
    setBusyId(member.id)
    try {
      const res = await api.post<{ message: string }>('/api/team', {
        action: 'SET_MEMBER_STATUS',
        userId: member.id,
        active,
      })
      toast.success(active ? 'Reactivated' : 'Deactivated', res.message)
      setConfirm(null)
      router.refresh()
    } catch (error) {
      toast.error('Could not update', error instanceof ApiError ? error.message : 'Please try again.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Users className="size-4 text-slate-400" />
              Owners & managers
            </CardTitle>
            <p className="mt-1 text-xs text-slate-500">
              Everyone who signs in to the dashboard. Each manager’s role decides what they can do, and
              PG access decides where — all PGs or only the ones you choose.
            </p>
          </div>
          {canManage && (
            <Button type="button" variant="primary" size="sm" onClick={() => setInviting(true)}>
              <UserPlus className="size-3.5" />
              Invite manager
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-slate-100">
          {office.map((member) => {
            const self = member.id === currentUserId
            const suspended = member.status === 'SUSPENDED'
            return (
              <li key={member.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">
                    {member.name}
                    {self && <span className="ml-1.5 text-xs font-normal text-slate-400">(you)</span>}
                  </p>
                  <p className="truncate text-xs text-slate-500">{member.email}</p>
                  <p className="text-xs text-slate-400">
                    {member.role === 'OWNER'
                      ? 'All PGs'
                      : member.propertyNames.length
                        ? member.propertyNames.join(', ')
                        : 'All PGs'}
                    {member.lastLoginAt && (
                      <span title={formatDateTime(member.lastLoginAt)}>
                        {' '}· last seen {relativeTime(member.lastLoginAt)}
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {member.role === 'OWNER' ? (
                    <Badge variant="blue" size="sm">
                      Owner · full access
                    </Badge>
                  ) : (
                    rolePicker(member)
                  )}
                  <Badge
                    variant={suspended ? 'danger' : member.pending ? 'warning' : 'success'}
                    size="sm"
                  >
                    {suspended ? 'Deactivated' : member.pending ? 'Invite pending' : 'Active'}
                  </Badge>
                  {canManage && !self && !suspended && member.pending && (
                    <ResendInviteButton
                      action="RESEND_TEAM_INVITE"
                      payload={{ userId: member.id }}
                      label="Resend invite"
                      variant="ghost"
                    />
                  )}
                  {canManage && !self && (
                    suspended ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        loading={busyId === member.id}
                        onClick={() => setActive(member, true)}
                      >
                        <RotateCcw className="size-3.5" />
                        Reactivate
                      </Button>
                    ) : (
                      <Button type="button" size="sm" variant="ghost" onClick={() => setConfirm(member)}>
                        <Ban className="size-3.5" />
                        Deactivate
                      </Button>
                    )
                  )}
                </div>
              </li>
            )
          })}
        </ul>

        <div className="mt-6 border-t border-slate-100 pt-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Smartphone className="size-4 text-slate-400" />
            Staff app logins
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Staff get their phone login from the Staff page. Pick what each one can do here.
          </p>
          {staffLogins.length === 0 ? (
            <p className="mt-3 rounded-xl border border-dashed border-slate-200 p-4 text-center text-xs text-slate-500">
              No staff app logins yet. Open a staff member on the Staff page and send them a login.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-slate-100">
              {staffLogins.map((member) => {
                const suspended = member.status === 'SUSPENDED'
                return (
                  <li key={member.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">{member.name}</p>
                      <p className="truncate text-xs text-slate-500">{member.phone ?? member.email}</p>
                      <p className="text-xs text-slate-400">
                        {member.propertyNames.length ? member.propertyNames.join(', ') : 'All PGs'}
                        {member.lastLoginAt && <> · last seen {relativeTime(member.lastLoginAt)}</>}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      {rolePicker(member)}
                      <Badge variant={suspended ? 'danger' : member.pending ? 'warning' : 'success'} size="sm">
                        {suspended ? 'Deactivated' : member.pending ? 'Invite pending' : 'Active'}
                      </Badge>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </CardContent>

      <Dialog open={Boolean(confirm)} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Deactivate {confirm?.name}?</DialogTitle>
            <DialogDescription>
              They are signed out on every device and cannot sign in until you reactivate them.
              Nothing they recorded is deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              loading={Boolean(confirm && busyId === confirm.id)}
              onClick={() => confirm && setActive(confirm, false)}
            >
              Deactivate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {canManage && (
        <InviteManagerDialog
          open={inviting}
          onOpenChange={setInviting}
          properties={properties}
          roles={roles.filter((r) => r.app === 'DASHBOARD')}
        />
      )}
    </Card>
  )
}

function InviteManagerDialog({
  open,
  onOpenChange,
  properties,
  roles,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  properties: { id: string; name: string }[]
  roles: RoleRow[]
}) {
  const router = useRouter()
  const toast = useToast()
  const [values, setValues] = React.useState({ name: '', email: '', phone: '' })
  const [allPgs, setAllPgs] = React.useState(true)
  const [selected, setSelected] = React.useState<string[]>([])
  const defaultRole = roles.find((r) => r.name === 'Manager')?.id ?? roles[0]?.id ?? ''
  const [orgRoleId, setOrgRoleId] = React.useState(defaultRole)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState<AccessLink | null>(null)

  React.useEffect(() => {
    if (open) {
      setValues({ name: '', email: '', phone: '' })
      setAllPgs(true)
      setSelected([])
      setOrgRoleId(defaultRole)
      setError(null)
      setResult(null)
    }
  }, [open])

  function toggle(id: string, checked: boolean) {
    setSelected((current) => (checked ? [...current, id] : current.filter((p) => p !== id)))
  }

  async function submit() {
    if (!values.name.trim() || !values.email.trim() || !values.phone.trim()) {
      setError('Name, email and mobile number are all needed')
      return
    }
    if (!allPgs && selected.length === 0) {
      setError('Choose at least one PG, or give access to all PGs')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await api.post<AccessLink & { message: string }>('/api/team', {
        action: 'INVITE_MANAGER',
        ...values,
        propertyIds: allPgs ? [] : selected,
        orgRoleId: orgRoleId || undefined,
      })
      toast.success('Manager invited', res.message)
      setResult(res)
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{result ? 'Invite sent' : 'Invite a manager'}</DialogTitle>
          <DialogDescription>
            {result
              ? 'They set their own password from the link. It works once, for 3 days.'
              : 'They get a link on email and WhatsApp to set their password — no passwords to share.'}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <InviteLinkPanel link={result} title="Invite link" />
        ) : (
          <div className="grid gap-4 py-1 sm:grid-cols-2">
            <Field label="Full name" required className="sm:col-span-2">
              <Input
                value={values.name}
                onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
                autoComplete="off"
              />
            </Field>
            <Field label="Email" required>
              <Input
                type="email"
                value={values.email}
                onChange={(e) => setValues((v) => ({ ...v, email: e.target.value }))}
                autoComplete="off"
              />
            </Field>
            <Field label="Mobile number" required>
              <Input
                type="tel"
                inputMode="tel"
                value={values.phone}
                onChange={(e) => setValues((v) => ({ ...v, phone: e.target.value }))}
              />
            </Field>
            <Field
              label="Role"
              className="sm:col-span-2"
              hint={
                roles.find((r) => r.id === orgRoleId)?.description ??
                'Decides what they can see and do. Edit roles in Roles & permissions.'
              }
            >
              <Select value={orgRoleId} onChange={(e) => setOrgRoleId(e.target.value)}>
                {roles.length === 0 && <option value="">Manager (default)</option>}
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} · {APP_LABEL[r.app]}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="space-y-2 sm:col-span-2">
              <p className="text-sm font-medium text-slate-700">PG access</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { value: true, label: 'All PGs' },
                  { value: false, label: 'Selected PGs' },
                ].map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    onClick={() => setAllPgs(option.value)}
                    className={cn(
                      'rounded-xl border px-3 py-2 text-sm font-medium transition-colors',
                      allPgs === option.value
                        ? 'border-blue-300 bg-blue-50 text-blue-700'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50',
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {!allPgs && (
                <div className="space-y-1.5 rounded-xl border border-slate-200 p-3">
                  {properties.length === 0 && (
                    <p className="text-xs text-slate-500">Add a PG first to restrict access.</p>
                  )}
                  {properties.map((p) => (
                    <label key={p.id} className="flex cursor-pointer items-center gap-2.5 text-sm text-slate-700">
                      <Checkbox
                        checked={selected.includes(p.id)}
                        onCheckedChange={(checked) => toggle(p.id, checked === true)}
                      />
                      {p.name}
                    </label>
                  ))}
                </div>
              )}
            </div>
            {error && <p className="text-xs font-medium text-red-600 sm:col-span-2">{error}</p>}
          </div>
        )}

        <DialogFooter>
          {result ? (
            <Button type="button" variant="primary" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          ) : (
            <>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="button" variant="primary" loading={busy} onClick={submit}>
                {!busy && <UserPlus className="size-4" />}
                Send invite
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
