'use client'

import * as React from 'react'
import { Check, Monitor, Smartphone } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MODULE_BY_KEY, type ModuleKey } from '@/lib/modules'
import { PERMISSION_GROUPS, ROLE_TEMPLATES } from '@/lib/permission-catalog'
import { api } from '@/lib/client'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/primitives'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { APP_LABEL, ROLE_COLORS, ROLE_DOT, type RoleRow } from './shared'

type Draft = {
  name: string
  description: string
  app: RoleRow['app']
  color: string
  permissions: string[]
}

const LABEL_OF = Object.fromEntries(PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => [p.key, p.label])))

/** "See residents, record payments…" in plain words. */
export function summarise(permissions: string[], max = 6) {
  const labels = permissions.map((k) => LABEL_OF[k]).filter(Boolean) as string[]
  if (!labels.length) return 'Nothing yet — tick what this role may do.'
  const shown = labels.slice(0, max).map((l, i) => (i === 0 ? l : l.charAt(0).toLowerCase() + l.slice(1)))
  return `Can: ${shown.join(', ')}${labels.length > max ? ` and ${labels.length - max} more` : ''}.`
}

export function RoleEditor({
  open,
  onOpenChange,
  role,
  roles,
  enabledModules,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null = create a new role. */
  role: RoleRow | null
  roles: RoleRow[]
  enabledModules: ModuleKey[]
  onSaved: (roles: RoleRow[]) => void
}) {
  const toast = useToast()
  const [draft, setDraft] = React.useState<Draft>({ name: '', description: '', app: 'DASHBOARD', color: 'blue', permissions: [] })
  const [template, setTemplate] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const on = React.useMemo(() => new Set(enabledModules), [enabledModules])

  React.useEffect(() => {
    if (!open) return
    setError(null)
    setTemplate('')
    setDraft(
      role
        ? { name: role.name, description: role.description ?? '', app: role.app, color: role.color, permissions: role.permissions }
        : { name: '', description: '', app: 'DASHBOARD', color: 'blue', permissions: [] },
    )
  }, [open, role])

  const selected = new Set(draft.permissions)

  function applyTemplate(value: string) {
    setTemplate(value)
    const [kind, key] = value.split(':')
    const source =
      kind === 'tpl'
        ? ROLE_TEMPLATES.find((t) => t.name === key)
        : kind === 'role'
          ? roles.find((r) => r.id === key)
          : null
    if (!source) {
      setDraft((d) => ({ ...d, permissions: [] }))
      return
    }
    setDraft((d) => ({
      ...d,
      app: source.app,
      color: source.color,
      description: d.description || (source.description ?? ''),
      permissions: [...source.permissions],
    }))
  }

  function setMany(keys: string[], checked: boolean) {
    setDraft((d) => {
      const next = new Set(d.permissions)
      keys.forEach((k) => (checked ? next.add(k) : next.delete(k)))
      return { ...d, permissions: [...next] }
    })
  }

  async function submit() {
    if (draft.name.trim().length < 2) {
      setError('Give the role a name')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const payload = {
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        app: draft.app,
        color: draft.color,
        permissions: draft.permissions,
      }
      const res = await api.post<{ roles: RoleRow[]; message: string }>(
        '/api/roles',
        role ? { action: 'UPDATE', id: role.id, ...payload } : { action: 'CREATE', ...payload },
      )
      toast.success(role ? 'Role saved' : 'Role created', role ? 'Changes apply right away, on their next click.' : res.message)
      onSaved(res.roles)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const appLocked = Boolean(role && role.userCount > 0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>{role ? `Edit ${role.name}` : 'Create a role'}</DialogTitle>
          <DialogDescription>
            Pick exactly what people with this role can see and do. The owner always has full access.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Role name" required>
            <Input
              value={draft.name}
              maxLength={40}
              placeholder="e.g. Night warden"
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            />
          </Field>
          {!role && (
            <Field label="Start from" hint="Copies its permissions — you can change them below">
              <Select value={template} onChange={(e) => applyTemplate(e.target.value)}>
                <option value="">Blank — nothing ticked</option>
                <optgroup label="StayFlow templates">
                  {ROLE_TEMPLATES.map((t) => (
                    <option key={t.name} value={`tpl:${t.name}`}>
                      {t.name} ({APP_LABEL[t.app]})
                    </option>
                  ))}
                </optgroup>
                {roles.length > 0 && (
                  <optgroup label="Your roles">
                    {roles.map((r) => (
                      <option key={r.id} value={`role:${r.id}`}>
                        {r.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </Select>
            </Field>
          )}
          <Field label="What it's for" className={role ? '' : 'sm:col-span-2'}>
            <Textarea
              rows={2}
              maxLength={200}
              value={draft.description}
              placeholder="One line so everyone knows when to use it"
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
            />
          </Field>

          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700">Signs in to</p>
            <div className="grid grid-cols-2 gap-2">
              {(['DASHBOARD', 'STAFF_APP'] as const).map((app) => (
                <button
                  key={app}
                  type="button"
                  disabled={appLocked}
                  onClick={() => setDraft((d) => ({ ...d, app }))}
                  className={cn(
                    'flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                    draft.app === app ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50',
                  )}
                >
                  {app === 'DASHBOARD' ? <Monitor className="size-4" /> : <Smartphone className="size-4" />}
                  {APP_LABEL[app]}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-500">
              {appLocked
                ? 'People already have this role, so where they sign in stays the same.'
                : draft.app === 'DASHBOARD'
                  ? 'For managers who use the full dashboard.'
                  : 'For cooks, cleaners and other staff on their phone.'}
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700">Colour</p>
            <div className="flex flex-wrap gap-2">
              {ROLE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  onClick={() => setDraft((d) => ({ ...d, color: c }))}
                  className={cn(
                    'flex size-8 items-center justify-center rounded-full ring-offset-2 transition',
                    ROLE_DOT[c],
                    draft.color === c ? 'ring-2 ring-slate-400' : 'hover:scale-110',
                  )}
                >
                  {draft.color === c && <Check className="size-4 text-white" />}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3 text-sm text-blue-900">
          <span className="font-semibold">{draft.permissions.length} permissions. </span>
          {summarise(draft.permissions)}
        </div>

        <div className="space-y-3">
          {PERMISSION_GROUPS.map((group) => {
            const moduleOn = on.has(group.module)
            const keys = group.permissions.map((p) => p.key)
            const count = keys.filter((k) => selected.has(k)).length
            const all = count === keys.length
            return (
              <section
                key={group.module}
                className={cn('rounded-xl border border-slate-200 p-3', !moduleOn && 'bg-slate-50 opacity-70')}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{group.label}</p>
                    {!moduleOn && (
                      <p className="text-xs text-amber-700">
                        {MODULE_BY_KEY[group.module].label} is switched off — these won’t apply until it’s back on.
                      </p>
                    )}
                  </div>
                  <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-600">
                    <Checkbox
                      checked={all ? true : count > 0 ? 'indeterminate' : false}
                      onCheckedChange={() => setMany(keys, !all)}
                    />
                    Select all
                  </label>
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {group.permissions.map((p) => (
                    <label key={p.key} className="flex cursor-pointer items-start gap-2.5 rounded-lg p-1.5 text-sm text-slate-700 hover:bg-slate-50">
                      <Checkbox
                        className="mt-0.5"
                        checked={selected.has(p.key)}
                        onCheckedChange={(c) => setMany([p.key], c === true)}
                      />
                      <span>
                        {p.label}
                        {p.hint && <span className="block text-xs text-slate-400">{p.hint}</span>}
                      </span>
                    </label>
                  ))}
                </div>
              </section>
            )
          })}
        </div>

        {error && <p className="text-sm font-medium text-red-600">{error}</p>}

        <DialogFooter className="sticky bottom-0 -mx-6 -mb-6 border-t border-slate-100 bg-white/95 px-6 py-3 backdrop-blur">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" variant="primary" loading={busy} onClick={submit}>
            {role ? 'Save role' : 'Create role'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
