'use client'

import * as React from 'react'
import Link from 'next/link'
import { ArrowRight, Globe, Monitor, UserRound } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Card, CardContent } from '@/components/ui/card'
import { ActivityTimeline } from '@/components/app/activity-timeline'
import { diffValues, formatDiffValue, labelForPath, type DiffEntry } from '@/lib/audit-diff'
import { EVENT_LABEL } from '@/lib/events-meta'
import { cn, formatDate } from '@/lib/utils'
import type { AuditEntry } from '@/server/services/audit-log'

/** Short device name from a user agent ("Chrome on Android"). */
function device(ua: string | null) {
  if (!ua) return null
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : /node|undici|curl/i.test(ua)
            ? 'Script / API'
            : 'Browser'
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad/.test(ua)
      ? 'iOS'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : ''
  return os ? `${browser} on ${os}` : browser
}

const KIND_STYLE: Record<DiffEntry['kind'], string> = {
  added: 'bg-emerald-50 text-emerald-700',
  removed: 'bg-red-50 text-red-700',
  changed: 'bg-amber-50 text-amber-700',
}

/**
 * The audit trail grouped by day. Tapping an entry opens its details: who,
 * when, from where, and a field-by-field before/after diff. Read-only.
 */
export function AuditLogView({ entries, showOrganization }: { entries: AuditEntry[]; showOrganization?: boolean }) {
  const [openId, setOpenId] = React.useState<string | null>(null)
  const selected = entries.find((e) => e.id === openId) ?? null

  const diffs = React.useMemo(() => {
    const map = new Map<string, DiffEntry[]>()
    for (const e of entries) map.set(e.id, diffValues(e.before, e.after))
    return map
  }, [entries])

  const byDay = React.useMemo(() => {
    const groups = new Map<string, AuditEntry[]>()
    for (const e of entries) {
      const d = new Date(e.createdAt)
      const key = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString()
      groups.set(key, [...(groups.get(key) ?? []), e])
    }
    return [...groups.entries()]
  }, [entries])

  const selectedDiff = selected ? diffs.get(selected.id) ?? [] : []

  return (
    <>
      <div className="space-y-5">
        {byDay.map(([day, items]) => (
          <div key={day}>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">{formatDate(day)}</p>
            <Card>
              <CardContent className="p-4 sm:p-5">
                <ActivityTimeline
                  onSelect={setOpenId}
                  items={items.map((e) => {
                    const changed = diffs.get(e.id)?.length ?? 0
                    const context = [showOrganization ? e.organizationName : null, e.propertyName].filter(Boolean).join(' · ')
                    return {
                      id: e.id,
                      event: e.event,
                      summary: context ? `${e.summary} — ${context}` : e.summary,
                      actorName: e.actorName ?? 'System',
                      createdAt: e.createdAt,
                      entityType: e.entityType,
                      entityId: e.entityId,
                      badge: changed ? `${changed} field${changed === 1 ? '' : 's'} changed` : undefined,
                    }
                  })}
                />
              </CardContent>
            </Card>
          </div>
        ))}
      </div>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setOpenId(null)}>
        <DialogContent size="lg">
          {selected && (
            <div className="min-w-0 space-y-5">
              <div className="pr-8">
                <DialogTitle>{EVENT_LABEL[selected.event] ?? selected.event}</DialogTitle>
                <DialogDescription className="mt-1 break-words">{selected.summary}</DialogDescription>
              </div>

              <dl className="grid grid-cols-1 gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
                <Fact label="When">
                  {new Date(selected.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'medium' })}
                </Fact>
                <Fact label="Who" icon={UserRound}>
                  {selected.actorName ?? 'System (automation)'}
                  {selected.actorRole && <span className="text-slate-400"> · {selected.actorRole.toLowerCase().replace('_', ' ')}</span>}
                </Fact>
                {showOrganization && selected.organizationName && <Fact label="Organization">{selected.organizationName}</Fact>}
                {selected.propertyName && <Fact label="PG">{selected.propertyName}</Fact>}
                {selected.entityType && (
                  <Fact label="Record">
                    {selected.entityType}
                    {selected.entityId && <span className="break-all text-slate-400"> · {selected.entityId}</span>}
                  </Fact>
                )}
                <Fact label="IP address" icon={Globe}>
                  {selected.ip ?? '—'}
                </Fact>
                <Fact label="Device" icon={Monitor}>
                  <span title={selected.userAgent ?? undefined}>{device(selected.userAgent) ?? '—'}</span>
                </Fact>
              </dl>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Changes</p>
                {selectedDiff.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-sm text-slate-500">
                    {selected.before || selected.after
                      ? 'No field values changed.'
                      : 'This entry records an action, not a field change.'}
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                    {selectedDiff.map((d) => (
                      <li key={d.path} className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="min-w-0 truncate text-sm font-medium text-slate-800">{labelForPath(d.path)}</span>
                          <span className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-medium', KIND_STYLE[d.kind])}>{d.kind}</span>
                        </div>
                        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-xs">
                          <span className="max-w-full break-all rounded bg-red-50/70 px-1.5 py-0.5 text-red-800 line-through decoration-red-300">
                            {formatDiffValue(d.before)}
                          </span>
                          <ArrowRight className="size-3 shrink-0 text-slate-400" />
                          <span className="max-w-full break-all rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-800">
                            {formatDiffValue(d.after)}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {selected.meta != null && typeof selected.meta === 'object' && Object.keys(selected.meta as object).length > 0 && (
                <details className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
                  <summary className="cursor-pointer text-slate-600">More details</summary>
                  <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs text-slate-600 scrollbar-slim">
                    {JSON.stringify(selected.meta, null, 2)}
                  </pre>
                </details>
              )}

              {selected.entityHref && (
                <Link
                  href={selected.entityHref}
                  className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700"
                >
                  Open the record <ArrowRight className="size-3.5" />
                </Link>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

function Fact({ label, icon: Icon, children }: { label: string; icon?: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1 text-xs text-slate-400">
        {Icon && <Icon className="size-3" />}
        {label}
      </dt>
      <dd className="mt-0.5 break-words text-slate-700">{children}</dd>
    </div>
  )
}
