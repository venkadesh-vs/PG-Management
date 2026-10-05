'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import { Crown, Monitor, Pencil, Plus, ShieldCheck, Smartphone, Trash2, Users } from 'lucide-react'
import { api } from '@/lib/client'
import { cn } from '@/lib/utils'
import type { ModuleKey } from '@/lib/modules'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Select } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { RoleEditor, summarise } from './role-editor'
import { APP_LABEL, ROLE_DOT, type RoleRow } from './shared'

export function RolesPanel({
  roles: initial,
  enabledModules,
  canManage,
}: {
  roles: RoleRow[]
  enabledModules: ModuleKey[]
  canManage: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const [roles, setRoles] = React.useState(initial)
  const [editing, setEditing] = React.useState<RoleRow | null>(null)
  const [editorOpen, setEditorOpen] = React.useState(false)
  const [deleting, setDeleting] = React.useState<RoleRow | null>(null)
  const [reassignTo, setReassignTo] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => setRoles(initial), [initial])

  function saved(next: RoleRow[]) {
    setRoles(next)
    router.refresh()
  }

  function openEditor(role: RoleRow | null) {
    setEditing(role)
    setEditorOpen(true)
  }

  async function remove() {
    if (!deleting) return
    setBusy(true)
    try {
      const res = await api.post<{ roles: RoleRow[]; message: string }>('/api/roles', {
        action: 'DELETE',
        id: deleting.id,
        reassignToId: deleting.userCount > 0 ? reassignTo || undefined : undefined,
      })
      toast.success('Role deleted', deleting.userCount > 0 ? 'Everyone was moved to the new role first.' : res.message)
      setDeleting(null)
      saved(res.roles)
    } catch (error) {
      toast.fromError(error, 'delete the role')
    } finally {
      setBusy(false)
    }
  }

  const alternatives = deleting ? roles.filter((r) => r.id !== deleting.id && r.app === deleting.app) : []

  const groups: { app: RoleRow['app']; title: string; icon: React.ElementType; hint: string }[] = [
    { app: 'DASHBOARD', title: 'Dashboard roles', icon: Monitor, hint: 'Managers and office staff who use the full dashboard.' },
    { app: 'STAFF_APP', title: 'Staff app roles', icon: Smartphone, hint: 'Cooks, cleaners and other staff on their phone.' },
  ]

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-sm">
                <ShieldCheck className="size-4 text-slate-400" />
                Roles & permissions
              </CardTitle>
              <p className="mt-1 max-w-xl text-xs text-slate-500">
                A role is a set of things someone may do. Give each person a role in the Team tab — change a role here
                and everyone with it gets the change straight away.
              </p>
            </div>
            {canManage && (
              <Button type="button" variant="primary" size="sm" onClick={() => openEditor(null)}>
                <Plus className="size-3.5" />
                Create role
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-start gap-3 rounded-xl border border-marigold-200 bg-marigold-50/60 p-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-marigold-400 text-slate-950">
              <Crown className="size-4" />
            </span>
            <div>
              <p className="text-sm font-semibold text-slate-900">Owner — full access</p>
              <p className="text-xs text-slate-600">Owners can do everything, always. This can’t be changed.</p>
            </div>
          </div>

          {groups.map((g) => {
            const list = roles.filter((r) => r.app === g.app)
            return (
              <div key={g.app} className="space-y-2">
                <div className="flex items-center gap-2">
                  <g.icon className="size-4 text-slate-400" />
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{g.title}</p>
                </div>
                <p className="text-xs text-slate-400">{g.hint}</p>
                {list.length === 0 && (
                  <p className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-sm text-slate-500">
                    No roles here yet.
                  </p>
                )}
                <ul className="space-y-2">
                  <AnimatePresence initial={false}>
                    {list.map((role) => (
                      <motion.li
                        key={role.id}
                        layout
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, height: 0 }}
                        className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                            <span className={cn('size-2.5 shrink-0 rounded-full', ROLE_DOT[role.color] ?? ROLE_DOT.blue)} />
                            {role.name}
                            <Badge variant={role.app === 'DASHBOARD' ? 'blue' : 'violet'} size="sm">
                              {APP_LABEL[role.app]}
                            </Badge>
                          </p>
                          {role.description && <p className="mt-0.5 text-xs text-slate-500">{role.description}</p>}
                          <p className="mt-1 line-clamp-2 text-xs text-slate-400">{summarise(role.permissions, 4)}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="flex items-center gap-1 text-xs text-slate-500">
                            <Users className="size-3.5" />
                            {role.userCount} {role.userCount === 1 ? 'person' : 'people'}
                          </span>
                          {canManage && (
                            <>
                              <Button type="button" size="sm" variant="outline" onClick={() => openEditor(role)}>
                                <Pencil className="size-3.5" />
                                Edit
                              </Button>
                              <Button
                                type="button"
                                size="icon-sm"
                                variant="ghost"
                                aria-label={`Delete ${role.name}`}
                                onClick={() => {
                                  setReassignTo('')
                                  setDeleting(role)
                                }}
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </>
                          )}
                        </div>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              </div>
            )
          })}
        </CardContent>
      </Card>

      {canManage && (
        <RoleEditor
          open={editorOpen}
          onOpenChange={setEditorOpen}
          role={editing}
          roles={roles}
          enabledModules={enabledModules}
          onSaved={saved}
        />
      )}

      <Dialog open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Delete {deleting?.name}?</DialogTitle>
            <DialogDescription>
              {deleting && deleting.userCount > 0
                ? `${deleting.userCount} ${deleting.userCount === 1 ? 'person has' : 'people have'} this role. Choose where to move them, then it’s deleted.`
                : 'Nobody has this role, so it can go. Nothing else changes.'}
            </DialogDescription>
          </DialogHeader>
          {deleting && deleting.userCount > 0 && (
            alternatives.length ? (
              <Field label="Move them to">
                <Select value={reassignTo} onChange={(e) => setReassignTo(e.target.value)}>
                  <option value="">Choose a role</option>
                  {alternatives.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <p className="text-sm text-amber-700">
                Create another {APP_LABEL[deleting.app].toLowerCase()} role first, so they have somewhere to go.
              </p>
            )
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setDeleting(null)}>
              Keep it
            </Button>
            <Button
              type="button"
              variant="destructive"
              loading={busy}
              disabled={Boolean(deleting && deleting.userCount > 0 && !reassignTo)}
              onClick={remove}
            >
              {deleting && deleting.userCount > 0 ? 'Move & delete' : 'Delete role'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
