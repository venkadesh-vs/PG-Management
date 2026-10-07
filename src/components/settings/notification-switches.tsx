'use client'

import * as React from 'react'
import { Bell, Lock, Mail, MessageCircle } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { useToast } from '@/components/ui/toast'
import { Switch } from '@/components/ui/primitives'
import {
  CHANNEL_LABEL,
  NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_KEYS,
  type NotificationType,
  type NotificationTypeDef,
  type PrefChannel,
} from '@/lib/notification-prefs'

type Grid = Record<NotificationType, Partial<Record<PrefChannel, boolean>>>

const CHANNEL_ICON: Record<PrefChannel, React.ComponentType<{ className?: string }>> = {
  IN_APP: Bell,
  WHATSAPP: MessageCircle,
  EMAIL: Mail,
}

/**
 * Per-type, per-channel switches. Each flip saves straight away (and is
 * audited); a failed save puts the switch back.
 */
export function NotificationSwitches({
  initialGrid,
  canEdit,
  whatsappModuleOn,
  only,
}: {
  initialGrid: Grid
  canEdit: boolean
  /** With the WhatsApp module off, its switches have no effect: say so. */
  whatsappModuleOn: boolean
  /** Restrict to one channel (the WhatsApp settings page). */
  only?: PrefChannel
}) {
  const toast = useToast()
  const [grid, setGrid] = React.useState(initialGrid)
  const [busy, setBusy] = React.useState<string | null>(null)

  async function flip(type: NotificationType, channel: PrefChannel, enabled: boolean) {
    const key = `${type}:${channel}`
    const previous = grid
    setBusy(key)
    setGrid({ ...grid, [type]: { ...grid[type], [channel]: enabled } })
    try {
      const res = await api.post<{ grid: Grid }>('/api/settings/notifications', {
        changes: [{ type, channel, enabled }],
      })
      setGrid(res.grid)
      toast.success(
        `${NOTIFICATION_TYPES[type].label}: ${CHANNEL_LABEL[channel]} ${enabled ? 'on' : 'off'}`,
      )
    } catch (error) {
      setGrid(previous)
      toast.error('Could not save', error instanceof ApiError ? error.message : 'Please try again')
    } finally {
      setBusy(null)
    }
  }

  const types = NOTIFICATION_TYPE_KEYS.filter((t) => !only || (NOTIFICATION_TYPES[t] as NotificationTypeDef).channels.includes(only))

  return (
    <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
      {types.map((type) => {
        const def: NotificationTypeDef = NOTIFICATION_TYPES[type]
        const channels = def.channels.filter((c) => !only || c === only)
        return (
          <div key={type} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-medium text-slate-900">
                {def.label}
                {def.locked && <Lock className="size-3.5 text-slate-400" aria-label="Always on" />}
              </p>
              <p className="text-xs text-slate-500">{def.description}</p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2">
              {channels.map((channel) => {
                const Icon = CHANNEL_ICON[channel]
                const on = grid[type]?.[channel] ?? true
                const inert = channel === 'WHATSAPP' && !whatsappModuleOn
                return (
                  <label
                    key={channel}
                    className="flex items-center gap-2 text-xs font-medium text-slate-600"
                    title={inert ? 'The WhatsApp feature is switched off in Settings → Features' : undefined}
                  >
                    <Icon className="size-3.5 text-slate-400" />
                    {CHANNEL_LABEL[channel]}
                    <Switch
                      checked={on}
                      disabled={!canEdit || def.locked || busy === `${type}:${channel}`}
                      onCheckedChange={(value) => flip(type, channel, value)}
                      aria-label={`${def.label} by ${CHANNEL_LABEL[channel]}`}
                    />
                  </label>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
