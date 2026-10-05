'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Send } from 'lucide-react'
import type { UserRole } from '@prisma/client'
import { api, ApiError } from '@/lib/client'
import { cn, initials, relativeTime } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { Avatar, AvatarFallback } from '@/components/ui/primitives'
import { PhotoGallery } from '@/components/app/photo-upload'

type Update = {
  id: string
  authorName: string
  authorRole: UserRole
  message: string
  statusTo: string | null
  createdAt: string
  photoUrl?: string | null
}

const ROLE_TONE: Record<string, string> = {
  TENANT: 'bg-blue-50 text-blue-700',
  WORKER: 'bg-amber-50 text-amber-700',
  MANAGER: 'bg-violet-50 text-violet-700',
  OWNER: 'bg-slate-900 text-white',
  SUPER_ADMIN: 'bg-slate-900 text-white',
}

/**
 * One conversation per complaint, shared by the resident, the owner and the
 * worker — which is the thing WhatsApp groups cannot do.
 */
export function ComplaintThread({
  complaintId,
  updates,
  compact,
}: {
  complaintId: string
  updates: Update[]
  compact?: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const [message, setMessage] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  async function send() {
    if (!message.trim()) return
    setBusy(true)
    try {
      await api.patch('/api/complaints', {
        complaintId,
        action: 'COMMENT',
        message: message.trim(),
      })
      setMessage('')
      toast.success('Message added', 'The other side has been notified.')
      router.refresh()
    } catch (error) {
      toast.error(
        'Unable to send',
        error instanceof ApiError ? error.message : 'Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <ol className="space-y-3">
        {updates.map((update, i) => (
          <motion.li
            key={update.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i * 0.04, 0.3) }}
            className="flex gap-3"
          >
            <Avatar className="size-8 shrink-0">
              <AvatarFallback className={cn('text-[10px]', ROLE_TONE[update.authorRole])}>
                {initials(update.authorName)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm font-medium text-slate-800">{update.authorName}</span>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                  {update.authorRole.replace('_', ' ').toLowerCase()}
                </span>
                <time className="text-xs text-slate-400">{relativeTime(update.createdAt)}</time>
              </div>
              <p className="mt-0.5 text-sm leading-relaxed text-slate-600">{update.message}</p>
              {update.photoUrl && <PhotoGallery urls={[update.photoUrl]} size="sm" className="mt-1.5" />}
              {update.statusTo && (
                <span className="mt-1 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                  → {update.statusTo.replace('_', ' ').toLowerCase()}
                </span>
              )}
            </div>
          </motion.li>
        ))}
      </ol>

      {!compact && (
        <div className="space-y-2 border-t border-slate-100 pt-4">
          <Textarea
            rows={2}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Add an update for the resident and the worker…"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send()
            }}
          />
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-slate-400">⌘ + Enter to send</p>
            <Button
              size="sm"
              variant="primary"
              loading={busy}
              onClick={send}
              disabled={!message.trim()}
            >
              <Send className="size-3.5" />
              Send
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
