'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { FileText, Loader2, Paperclip, Send, X } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { cn, formatDateTime, initials } from '@/lib/utils'
import {
  ADMIN_STATUS_LABEL,
  canAdminMove,
  canReply,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  type TicketStatus,
} from '@/lib/support'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Field, Select, Textarea } from '@/components/ui/input'

/**
 * A support ticket's conversation and reply box. The customer side can attach
 * a file and close the ticket; the StayFlow side (`team`) also sets status,
 * priority and the assignee.
 */

export type ThreadMessage = {
  id: string
  authorName: string
  fromStaff: boolean
  body: string
  attachmentUrl: string | null
  createdAt: string
}

export function SupportThread({
  ticketId,
  status,
  messages,
  team = false,
  priority,
  assignedTo,
  teamMembers = [],
  currentUserId,
}: {
  ticketId: string
  status: TicketStatus
  messages: ThreadMessage[]
  team?: boolean
  priority?: string
  assignedTo?: string | null
  teamMembers?: { id: string; name: string }[]
  currentUserId?: string
}) {
  const router = useRouter()
  const toast = useToast()
  const [body, setBody] = React.useState('')
  const [attachment, setAttachment] = React.useState('')
  const [nextStatus, setNextStatus] = React.useState('')
  const [busy, setBusy] = React.useState<string | null>(null)
  const [uploading, setUploading] = React.useState(false)
  const endRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' })
  }, [messages.length])

  async function act(key: string, payload: Record<string, unknown>, success?: string) {
    setBusy(key)
    try {
      const result = await api.post<{ message?: string }>(`/api/support/${ticketId}`, payload)
      toast.success(success ?? result?.message ?? 'Saved')
      router.refresh()
      return true
    } catch (error) {
      toast.error('Could not update the ticket', error instanceof ApiError ? error.message : undefined)
      return false
    } finally {
      setBusy(null)
    }
  }

  async function attach(file: File | undefined) {
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      toast.error('That file is too large', 'Screenshots and PDFs up to 5 MB can be attached.')
      return
    }
    setUploading(true)
    try {
      const form = new FormData()
      form.set('file', file)
      form.set('purpose', 'OTHER')
      const res = await fetch('/api/uploads', { method: 'POST', body: form, credentials: 'same-origin' })
      const data = (await res.json().catch(() => null)) as { url?: string; error?: string } | null
      if (!res.ok || !data?.url) throw new Error(data?.error ?? 'The file could not be uploaded.')
      setAttachment(data.url)
    } catch (error) {
      toast.error('Upload failed', (error as Error).message)
    } finally {
      setUploading(false)
    }
  }

  async function reply(event: React.FormEvent) {
    event.preventDefault()
    if (!body.trim()) {
      toast.error('Write a reply first')
      return
    }
    const done = await act('reply', {
      action: 'REPLY',
      body,
      attachmentUrl: attachment || undefined,
      ...(team && nextStatus ? { status: nextStatus } : {}),
    })
    if (done) {
      setBody('')
      setAttachment('')
      setNextStatus('')
    }
  }

  const open = canReply(status)

  return (
    <div className="space-y-4">
      {team && (
        <Card>
          <CardContent className="grid gap-3 p-4 sm:grid-cols-3">
            <Field label="Status">
              <Select
                value={status}
                disabled={busy !== null}
                onChange={(e) => act('status', { action: 'STATUS', status: e.target.value })}
                aria-label="Ticket status"
              >
                {TICKET_STATUSES.map((s) => (
                  <option key={s} value={s} disabled={s !== status && !canAdminMove(status, s)}>
                    {ADMIN_STATUS_LABEL[s]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Priority">
              <Select
                value={priority}
                disabled={busy !== null}
                onChange={(e) => act('priority', { action: 'PRIORITY', priority: e.target.value })}
                aria-label="Ticket priority"
              >
                {TICKET_PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Assigned to">
              <Select
                value={assignedTo ?? ''}
                disabled={busy !== null}
                onChange={(e) => act('assign', { action: 'ASSIGN', assigneeId: e.target.value || null })}
                aria-label="Assignee"
              >
                <option value="">Nobody yet</option>
                {teamMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                    {m.id === currentUserId ? ' (me)' : ''}
                  </option>
                ))}
              </Select>
            </Field>
          </CardContent>
        </Card>
      )}

      <ol className="space-y-3" aria-label="Conversation">
        {messages.map((m) => {
          const mine = team ? m.fromStaff : !m.fromStaff
          return (
            <li key={m.id} className={cn('flex gap-2.5', mine && 'flex-row-reverse')}>
              <div
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                  m.fromStaff ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700',
                )}
                aria-hidden
              >
                {m.fromStaff ? 'SF' : initials(m.authorName)}
              </div>
              <div
                className={cn(
                  'min-w-0 max-w-[85%] rounded-2xl border px-3.5 py-2.5 sm:max-w-[75%]',
                  m.fromStaff ? 'border-blue-100 bg-blue-50/70' : 'border-slate-200 bg-white',
                )}
              >
                <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-slate-500">
                  <span className="font-semibold text-slate-700">{m.authorName}</span>
                  <time dateTime={m.createdAt}>{formatDateTime(m.createdAt)}</time>
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-800">{m.body}</p>
                {m.attachmentUrl && (
                  <a
                    href={m.attachmentUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50"
                  >
                    <FileText className="size-3.5" />
                    Attachment
                  </a>
                )}
              </div>
            </li>
          )
        })}
      </ol>
      <div ref={endRef} />

      {open ? (
        <Card>
          <CardContent className="p-4">
            <form onSubmit={reply} className="space-y-3">
              <Field label={team ? 'Reply to the customer' : 'Add a reply'} htmlFor="support-reply">
                <Textarea
                  id="support-reply"
                  value={body}
                  maxLength={4000}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder={team ? 'Explain the fix or ask for what you need…' : 'Add details, or tell us if it is fixed…'}
                />
              </Field>
              <div className="flex flex-wrap items-center gap-2">
                {!team &&
                  (attachment ? (
                    <span className="inline-flex min-w-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700">
                      <FileText className="size-3.5 shrink-0" />
                      File attached
                      <button
                        type="button"
                        onClick={() => setAttachment('')}
                        className="rounded p-0.5 text-slate-400 hover:text-slate-700"
                        aria-label="Remove attachment"
                      >
                        <X className="size-3.5" />
                      </button>
                    </span>
                  ) : (
                    <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
                      {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Paperclip className="size-3.5" />}
                      {uploading ? 'Uploading…' : 'Attach screenshot or PDF'}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,application/pdf"
                        className="sr-only"
                        disabled={uploading}
                        onChange={(e) => {
                          void attach(e.target.files?.[0])
                          e.target.value = ''
                        }}
                      />
                    </label>
                  ))}
                {team && (
                  <Select
                    value={nextStatus}
                    onChange={(e) => setNextStatus(e.target.value)}
                    className="h-9 w-auto min-w-0 text-xs"
                    aria-label="Status after reply"
                  >
                    <option value="">Status: automatic</option>
                    {TICKET_STATUSES.filter((s) => s !== status && canAdminMove(status, s)).map((s) => (
                      <option key={s} value={s}>
                        Then mark {ADMIN_STATUS_LABEL[s].toLowerCase()}
                      </option>
                    ))}
                  </Select>
                )}
                <div className="ml-auto flex flex-wrap gap-2">
                  {!team && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => {
                        if (window.confirm('Close this ticket? You can open a new one any time.')) {
                          void act('close', { action: 'CLOSE' }, 'Ticket closed')
                        }
                      }}
                    >
                      {busy === 'close' && <Loader2 className="size-4 animate-spin" />}
                      Close ticket
                    </Button>
                  )}
                  <Button type="submit" size="sm" disabled={busy !== null || uploading}>
                    {busy === 'reply' ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                    Send reply
                  </Button>
                </div>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : (
        <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-sm text-slate-500">
          {team
            ? 'This ticket is closed. Reopen it from the status menu to reply.'
            : 'This ticket is closed. Open a new ticket if you still need help.'}
        </p>
      )}
    </div>
  )
}
