'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Lock, ShieldCheck, Sparkles } from 'lucide-react'
import { api } from '@/lib/client'
import { cn } from '@/lib/utils'
import { Icon } from '@/lib/icons'
import { MODULES, MODULE_BY_KEY, OPTIONAL_MODULES, type ModuleKey } from '@/lib/modules'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/primitives'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/** Modules that depend on `key` (turning `key` off turns these off too). */
function dependents(key: ModuleKey) {
  return OPTIONAL_MODULES.filter((m) => m.requires?.includes(key)).map((m) => m.key)
}

export function FeaturesPanel({
  disabledModules,
  withheld,
  canManage,
}: {
  disabledModules: string[]
  /** Withheld by the StayFlow plan; the owner can't switch these on. */
  withheld: string[]
  canManage: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const [off, setOff] = React.useState<Set<string>>(() => new Set(disabledModules))
  const [busy, setBusy] = React.useState<string | null>(null)
  const [confirm, setConfirm] = React.useState<{ key: ModuleKey; also: ModuleKey[] } | null>(null)
  const withheldSet = React.useMemo(() => new Set(withheld), [withheld])

  React.useEffect(() => setOff(new Set(disabledModules)), [disabledModules])

  const isOn = (key: ModuleKey) =>
    !off.has(key) && !withheldSet.has(key) && !(MODULE_BY_KEY[key].requires ?? []).some((r) => off.has(r) || withheldSet.has(r))

  async function save(next: Set<string>, key: ModuleKey, turningOn: boolean, also: ModuleKey[] = []) {
    const previous = off
    setOff(next) // optimistic
    setBusy(key)
    try {
      await api.post('/api/settings/modules', { disabledModules: [...next] })
      const label = MODULE_BY_KEY[key].label
      const extra = also.length ? ` (${also.map((k) => MODULE_BY_KEY[k].label).join(', ')} too)` : ''
      if (turningOn) toast.success(`${label} is on`, 'It’s back in the menu for everyone with access.')
      else toast.success(`${label} switched off${extra}`, 'Nothing was deleted — turn it back on any time.')
      router.refresh()
    } catch (error) {
      setOff(previous)
      toast.fromError(error, `switch ${MODULE_BY_KEY[key].label.toLowerCase()}`)
    } finally {
      setBusy(null)
    }
  }

  function toggle(key: ModuleKey, on: boolean) {
    const next = new Set(off)
    if (on) {
      next.delete(key)
      return save(next, key, true)
    }
    const also = dependents(key).filter((d) => !off.has(d))
    if (also.length) {
      setConfirm({ key, also })
      return
    }
    next.add(key)
    return save(next, key, false)
  }

  function confirmOff() {
    if (!confirm) return
    const next = new Set(off)
    next.add(confirm.key)
    confirm.also.forEach((k) => next.add(k))
    setConfirm(null)
    save(next, confirm.key, false, confirm.also)
  }

  const core = MODULES.filter((m) => m.core)

  return (
    <div className="space-y-4">
      <Card className="border-blue-100 bg-gradient-to-br from-blue-50/80 to-white">
        <CardContent className="flex items-start gap-3 p-4 sm:p-5">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white">
            <Sparkles className="size-4" />
          </div>
          <div className="text-sm text-slate-700">
            <p className="font-semibold text-slate-900">Use only what your PG needs</p>
            <p className="mt-0.5 text-slate-600">
              Switching a feature off hides it from menus, dashboards and the phone apps.{' '}
              <span className="font-medium text-slate-800">Nothing is ever deleted</span> — switch it back on and
              everything is exactly where you left it.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        {OPTIONAL_MODULES.map((m, i) => {
          const planOff = withheldSet.has(m.key)
          const blockedBy = (m.requires ?? []).filter((r) => off.has(r) || withheldSet.has(r))
          const on = isOn(m.key)
          const disabled = !canManage || planOff || blockedBy.length > 0 || busy !== null
          return (
            <motion.div
              key={m.key}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.03, 0.3), duration: 0.3 }}
            >
              <label
                className={cn(
                  'flex h-full items-start gap-3 rounded-2xl border bg-white p-4 shadow-sm transition-colors',
                  on ? 'border-blue-200' : 'border-slate-200',
                  planOff && 'bg-slate-50',
                  !disabled && 'cursor-pointer hover:border-blue-300',
                )}
              >
                <div
                  className={cn(
                    'flex size-10 shrink-0 items-center justify-center rounded-xl transition-colors',
                    on ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-400',
                  )}
                >
                  <Icon name={m.icon} className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className={cn('text-sm font-semibold', planOff ? 'text-slate-500' : 'text-slate-900')}>{m.label}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{m.description}</p>
                  {planOff ? (
                    <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-amber-700">
                      <Lock className="size-3" />
                      Not included in your plan — contact StayFlow
                    </p>
                  ) : blockedBy.length > 0 ? (
                    <p className="mt-2 text-xs font-medium text-amber-700">
                      Needs {blockedBy.map((r) => MODULE_BY_KEY[r].label).join(', ')} — switch that on first.
                    </p>
                  ) : null}
                </div>
                <Switch
                  checked={on}
                  disabled={disabled}
                  aria-label={`${m.label} ${on ? 'on' : 'off'}`}
                  onCheckedChange={(c) => toggle(m.key, c)}
                />
              </label>
            </motion.div>
          )
        })}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ShieldCheck className="size-4 text-slate-400" />
            Always on
          </CardTitle>
          <p className="text-xs text-slate-500">The essentials every PG runs on.</p>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {core.map((m) => (
            <Badge key={m.key} variant="outline" className="gap-1.5 py-1">
              <Icon name={m.icon} className="size-3.5 text-blue-600" />
              {m.label}
            </Badge>
          ))}
        </CardContent>
      </Card>

      {!canManage && (
        <p className="text-sm text-slate-500">Only the owner, or someone allowed to manage the team, can switch features.</p>
      )}

      <Dialog open={Boolean(confirm)} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Switch off {confirm ? MODULE_BY_KEY[confirm.key].label : ''}?</DialogTitle>
            <DialogDescription>
              {confirm?.also.map((k) => MODULE_BY_KEY[k].label).join(', ')} needs it, so that switches off too. Nothing is
              deleted — turn them back on whenever you like.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setConfirm(null)}>
              Keep it on
            </Button>
            <Button type="button" variant="primary" onClick={confirmOff}>
              Switch both off
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
