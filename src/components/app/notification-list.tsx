'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import { CheckCheck } from 'lucide-react'
import type { NotificationKind } from '@prisma/client'
import { api } from '@/lib/client'
import { cn, relativeTime } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/feedback'

type Notification = {
  id: string
  kind: NotificationKind
  title: string
  body: string
  link: string | null
  readAt: string | null
  createdAt: string
}

const KIND_TONE: Record<string, { dot: string; label: string }> = {
  RENT: { dot: 'bg-amber-400', label: 'Rent' },
  PAYMENT: { dot: 'bg-emerald-400', label: 'Payment' },
  COMPLAINT: { dot: 'bg-red-400', label: 'Complaint' },
  MAINTENANCE: { dot: 'bg-orange-400', label: 'Maintenance' },
  FOOD: { dot: 'bg-lime-400', label: 'Food' },
  GROCERY: { dot: 'bg-yellow-400', label: 'Grocery' },
  SUBSCRIPTION: { dot: 'bg-violet-400', label: 'Subscription' },
  ANNOUNCEMENT: { dot: 'bg-sky-400', label: 'Announcement' },
  SYSTEM: { dot: 'bg-slate-400', label: 'System' },
  LEAD: { dot: 'bg-blue-400', label: 'Enquiry' },
}

/**
 * Shared notification list for the owner, admin, tenant and worker apps.
 * Marking one read is optimistic — the badge in the sidebar catches up on the
 * next server render.
 */
export function NotificationList({ notifications }: { notifications: Notification[] }) {
  const router = useRouter()
  const toast = useToast()
  const [items, setItems] = React.useState(notifications)
  const [filter, setFilter] = React.useState<'all' | 'unread'>('all')
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => setItems(notifications), [notifications])

  const unread = items.filter((n) => !n.readAt)
  const shown = filter === 'unread' ? unread : items

  async function markRead(id: string) {
    setItems((current) =>
      current.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)),
    )
    await api.patch('/api/notifications', { id }).catch(() => undefined)
    router.refresh()
  }

  async function markAllRead() {
    if (!unread.length) return
    setBusy(true)
    const now = new Date().toISOString()
    setItems((current) => current.map((n) => ({ ...n, readAt: n.readAt ?? now })))
    try {
      await api.patch('/api/notifications', { all: true })
      toast.success('All caught up', `${unread.length} notifications marked as read.`)
      router.refresh()
    } catch {
      toast.error('Something went wrong', 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (!items.length) {
    return (
      <EmptyState
        icon="bell"
        title="No notifications"
        description="Rent due, payments received, new complaints and low stock all show up here."
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          {(['all', 'unread'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors',
                filter === value
                  ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
              )}
            >
              {value}
              {value === 'unread' && unread.length > 0 && ` (${unread.length})`}
            </button>
          ))}
        </div>
        {unread.length > 0 && (
          <Button variant="ghost" size="sm" loading={busy} onClick={markAllRead}>
            <CheckCheck className="size-3.5" />
            Mark all read
          </Button>
        )}
      </div>

      {shown.length === 0 ? (
        <EmptyState compact icon="bell" title="Nothing unread" description="You are all caught up." />
      ) : (
        <ul className="space-y-2">
          <AnimatePresence initial={false}>
            {shown.map((notification) => {
              const tone = KIND_TONE[notification.kind] ?? KIND_TONE.SYSTEM
              const unreadItem = !notification.readAt
              const content = (
                <div
                  className={cn(
                    'flex gap-3 rounded-2xl border p-4 transition-colors',
                    unreadItem
                      ? 'border-blue-200 bg-blue-50/40'
                      : 'border-slate-200 bg-white hover:bg-slate-50/60',
                  )}
                >
                  <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', tone.dot)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <p
                        className={cn(
                          'text-sm',
                          unreadItem ? 'font-semibold text-slate-900' : 'font-medium text-slate-700',
                        )}
                      >
                        {notification.title}
                      </p>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                        {tone.label}
                      </span>
                      <time className="text-xs text-slate-400">
                        {relativeTime(notification.createdAt)}
                      </time>
                    </div>
                    <p className="mt-0.5 text-sm leading-relaxed text-slate-600">
                      {notification.body}
                    </p>
                  </div>
                </div>
              )

              return (
                <motion.li
                  key={notification.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  onClick={() => unreadItem && markRead(notification.id)}
                >
                  {notification.link ? (
                    <Link href={notification.link} className="block">
                      {content}
                    </Link>
                  ) : (
                    <div className="cursor-default">{content}</div>
                  )}
                </motion.li>
              )
            })}
          </AnimatePresence>
        </ul>
      )}

    </div>
  )
}
