'use client'

import * as React from 'react'
import { AlertTriangle, CheckCircle2, Info, Megaphone, X } from 'lucide-react'
import { api } from '@/lib/client'
import { cn } from '@/lib/utils'

type Announcement = { id: string; title: string; body: string; severity: string }

const KEY = 'stayflow:dismissed-announcements'

function readDismissed(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : []
  } catch {
    return []
  }
}

function writeDismissed(ids: string[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(ids.slice(-50)))
  } catch {
    // Private mode / storage blocked: the banner simply returns next visit.
  }
}

const STYLE: Record<string, { box: string; icon: React.ElementType; iconColor: string }> = {
  INFO: { box: 'border-blue-200 bg-blue-50/70', icon: Info, iconColor: 'text-blue-600' },
  SUCCESS: { box: 'border-emerald-200 bg-emerald-50/70', icon: CheckCircle2, iconColor: 'text-emerald-600' },
  WARNING: { box: 'border-amber-200 bg-amber-50/80', icon: AlertTriangle, iconColor: 'text-amber-600' },
  CRITICAL: { box: 'border-red-200 bg-red-50/80', icon: AlertTriangle, iconColor: 'text-red-600' },
}

/** StayFlow-wide announcements for PG owners, dismissible per announcement. */
export function PlatformAnnouncementBanner() {
  const [items, setItems] = React.useState<Announcement[]>([])

  React.useEffect(() => {
    let cancelled = false
    api
      .get<{ announcements: Announcement[] }>('/api/announcements')
      .then((res) => {
        if (cancelled) return
        const dismissed = readDismissed()
        setItems(res.announcements.filter((a) => !dismissed.includes(a.id)))
      })
      .catch(() => {
        // A banner is never worth an error toast.
      })
    return () => {
      cancelled = true
    }
  }, [])

  function dismiss(id: string) {
    writeDismissed([...readDismissed(), id])
    setItems((list) => list.filter((a) => a.id !== id))
  }

  if (!items.length) return null
  return (
    <div className="mb-4 space-y-2">
      {items.map((a) => {
        const style = STYLE[a.severity] ?? STYLE.INFO
        const Icon = a.severity === 'INFO' ? Megaphone : style.icon
        return (
          <div key={a.id} role="status" className={cn('flex items-start gap-3 rounded-2xl border px-4 py-3', style.box)}>
            <Icon className={cn('mt-0.5 size-4 shrink-0', style.iconColor)} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900">{a.title}</p>
              <p className="mt-0.5 whitespace-pre-line text-sm text-slate-700">{a.body}</p>
            </div>
            <button
              type="button"
              onClick={() => dismiss(a.id)}
              aria-label="Dismiss announcement"
              className="-mr-1 rounded-lg p-1 text-slate-400 transition-colors hover:bg-white/70 hover:text-slate-700"
            >
              <X className="size-4" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
