'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Save } from 'lucide-react'
import { api } from '@/lib/client'
import { cn } from '@/lib/utils'
import { Icon } from '@/lib/icons'
import { OPTIONAL_MODULES } from '@/lib/modules'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/primitives'

/**
 * Super Admin: choose which plan-gated modules this client gets. A switched-off
 * row stores featureOverrides[flag] = false; the owner then sees it as
 * "Not included in your plan".
 */
export function AdminFeatureOverrides({
  organizationId,
  withheld: initial,
  globallyOff,
  ownerDisabled,
}: {
  organizationId: string
  /** Flag keys withheld for this org by override. */
  withheld: string[]
  /** Flag keys switched off for everyone. */
  globallyOff: string[]
  /** Module keys the owner switched off themselves. */
  ownerDisabled: string[]
}) {
  const router = useRouter()
  const toast = useToast()
  const [withheld, setWithheld] = React.useState(() => new Set(initial))
  const [busy, setBusy] = React.useState(false)
  const dirty = withheld.size !== initial.length || initial.some((f) => !withheld.has(f))
  const gated = OPTIONAL_MODULES.filter((m) => m.flag)

  async function save() {
    setBusy(true)
    try {
      const res = await api.post<{ message: string }>('/api/admin/organizations', {
        action: 'SET_FEATURE_OVERRIDES',
        organizationId,
        withheld: [...withheld],
      })
      toast.success('Saved', `${res.message}. Their data is untouched.`)
      router.refresh()
    } catch (error) {
      toast.fromError(error, 'update features')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-slate-100">
        {gated.map((m) => {
          const flag = m.flag!
          const global = globallyOff.includes(flag)
          const included = !withheld.has(flag)
          return (
            <li key={m.key} className="flex items-center gap-3 py-2.5">
              <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', included && !global ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-400')}>
                <Icon name={m.icon} className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-800">{m.label}</p>
                <p className="text-xs text-slate-400">
                  <code>{flag}</code>
                  {global && ' · off for everyone (global flag)'}
                  {ownerDisabled.includes(m.key) && ' · owner switched it off'}
                </p>
              </div>
              {global ? (
                <Badge variant="warning" size="sm">Global off</Badge>
              ) : (
                <Badge variant={included ? 'success' : 'outline'} size="sm">
                  {included ? 'Included' : 'Withheld'}
                </Badge>
              )}
              <Switch
                checked={included}
                aria-label={`${m.label} for this client`}
                onCheckedChange={(c) =>
                  setWithheld((cur) => {
                    const next = new Set(cur)
                    if (c) next.delete(flag)
                    else next.add(flag)
                    return next
                  })
                }
              />
            </li>
          )
        })}
      </ul>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500">Withholding hides a feature; it never deletes the client’s data.</p>
        <Button type="button" size="sm" variant="primary" disabled={!dirty} loading={busy} onClick={save}>
          {!busy && <Save className="size-3.5" />}
          Save
        </Button>
      </div>
    </div>
  )
}
