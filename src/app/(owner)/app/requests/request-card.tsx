'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Bed, Check, CheckCheck, Phone, UtensilsCrossed, X } from 'lucide-react'
import type { PropertyType, ResidentRequestKind, ResidentRequestStatus } from '@prisma/client'
import { api } from '@/lib/client'
import { cn, formatDate, formatDateTime, formatPhone, relativeTime } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { StatusChip } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, Textarea } from '@/components/ui/input'
import { KIND_META, STATUS_META, cleanDetails, hasMealsPaused } from '@/app/(tenant)/tenant/requests/request-meta'

export type InboxRequest = {
  id: string
  kind: ResidentRequestKind
  status: ResidentRequestStatus
  title: string
  details: string | null
  fromDate: string | null
  toDate: string | null
  visitorName: string | null
  visitorPhone: string | null
  visitorCount: number | null
  decidedBy: string | null
  decidedAt: string | null
  decisionNote: string | null
  createdAt: string
  property: { name: string; type: PropertyType }
  resident: { id: string; name: string; phone: string; room: string | null; bed: string | null }
}

type Action = 'APPROVE' | 'REJECT' | 'DONE'

export function RequestCard({
  request,
  canManage,
  canCreateTask,
}: {
  request: InboxRequest
  canManage: boolean
  canCreateTask: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const [dialog, setDialog] = React.useState<Action | null>(null)
  const [note, setNote] = React.useState('')
  const [withTask, setWithTask] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const meta = KIND_META[request.kind]
  const status = STATUS_META[request.status]
  const Icon = meta.icon
  const details = cleanDetails(request.details)
  const pending = request.status === 'PENDING'
  const transferHref = `/app/residents/${request.resident.id}?transfer=1`

  async function decide(action: Action, opts?: { thenOpenTransfer?: boolean }) {
    setBusy(true)
    try {
      const result = await api.patch<{ effects: string[] }>(`/api/requests/${request.id}`, {
        action,
        note: note.trim() || undefined,
        createTask: request.kind === 'SERVICE' && action === 'APPROVE' ? withTask && canCreateTask : undefined,
      })
      const title = action === 'APPROVE' ? 'Approved' : action === 'REJECT' ? 'Declined' : 'Marked done'
      toast.success(title, [`${request.resident.name} has been notified.`, ...result.effects].join(' '))
      setDialog(null)
      setNote('')
      if (opts?.thenOpenTransfer) router.push(transferHref)
      else router.refresh()
    } catch (error) {
      toast.fromError(error, 'update this request')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="h-full">
      <CardContent className="flex h-full flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl', meta.tint)}>
            <Icon className={cn('size-5', meta.iconTint)} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-slate-900">{request.title}</p>
            <p className="truncate text-xs text-slate-500">
              {meta.label} · {relativeTime(request.createdAt)} · {request.property.name}
            </p>
          </div>
          <StatusChip label={status.label} chip={status.chip} dot={status.dot} />
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-slate-50 px-3 py-2 text-sm">
          <Link href={`/app/residents/${request.resident.id}`} className="font-medium text-slate-800 hover:text-blue-700">
            {request.resident.name}
          </Link>
          {request.resident.room && (
            <span className="flex items-center gap-1 text-xs text-slate-500">
              <Bed className="size-3.5" />
              Room {request.resident.room}
              {request.resident.bed ? ` / ${request.resident.bed}` : ''}
            </span>
          )}
          <a href={`tel:${request.resident.phone}`} className="flex items-center gap-1 text-xs text-slate-500 hover:text-blue-700">
            <Phone className="size-3.5" />
            {formatPhone(request.resident.phone)}
          </a>
        </div>

        <div className="space-y-1 text-sm text-slate-600">
          {request.kind === 'LEAVE' && request.fromDate && request.toDate && (
            <p>
              Away <span className="font-medium text-slate-800">{formatDate(request.fromDate)}</span> to{' '}
              <span className="font-medium text-slate-800">{formatDate(request.toDate)}</span>
            </p>
          )}
          {request.kind === 'VISITOR' && (
            <p>
              <span className="font-medium text-slate-800">{request.visitorName}</span>
              {request.visitorCount && request.visitorCount > 1 ? ` + ${request.visitorCount - 1} more` : ''}
              {request.visitorPhone ? ` · ${formatPhone(request.visitorPhone)}` : ''}
              {request.fromDate ? ` · ${formatDateTime(request.fromDate)}` : ''}
            </p>
          )}
          {request.kind === 'ROOM_CHANGE' && request.fromDate && <p>From {formatDate(request.fromDate)}</p>}
          {details && <p className="whitespace-pre-line">{details}</p>}
          {hasMealsPaused(request.kind, request.details) && (
            <p className="flex items-center gap-1.5 text-xs text-slate-500">
              <UtensilsCrossed className="size-3.5" />
              Meals will be paused on approval
            </p>
          )}
          {request.decisionNote && (
            <p className="text-xs text-slate-500">
              <span className="font-medium">{request.decidedBy ?? 'Note'}:</span> {request.decisionNote}
            </p>
          )}
        </div>

        {canManage && (pending || request.status === 'APPROVED') && (
          <div className="mt-auto flex flex-wrap gap-2 pt-1">
            {pending && (
              <>
                {request.kind === 'ROOM_CHANGE' ? (
                  <Button variant="primary" size="sm" loading={busy} onClick={() => decide('APPROVE', { thenOpenTransfer: true })}>
                    <Check className="size-3.5" />
                    Approve &amp; open transfer
                  </Button>
                ) : (
                  <Button variant="primary" size="sm" onClick={() => setDialog('APPROVE')}>
                    <Check className="size-3.5" />
                    Approve
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => setDialog('REJECT')}>
                  <X className="size-3.5" />
                  Decline
                </Button>
              </>
            )}
            {request.status === 'APPROVED' && (
              <>
                <Button variant="outline" size="sm" loading={busy} onClick={() => decide('DONE')}>
                  <CheckCheck className="size-3.5" />
                  Mark done
                </Button>
                {request.kind === 'ROOM_CHANGE' && (
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={transferHref}>Open transfer</Link>
                  </Button>
                )}
              </>
            )}
          </div>
        )}
      </CardContent>

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog === 'REJECT' ? 'Decline this request?' : 'Approve this request?'}</DialogTitle>
            <DialogDescription>
              {dialog === 'REJECT'
                ? `Let ${request.resident.name.split(' ')[0]} know why. They will see your note in the app.`
                : request.kind === 'VISITOR'
                  ? 'The visitor will show as expected in the visitor log on the day, so the gate can sign them in quickly.'
                  : hasMealsPaused(request.kind, request.details)
                    ? 'Their meals will be paused for these dates, and they will be notified.'
                    : `${request.resident.name.split(' ')[0]} will be notified straight away.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field label={dialog === 'REJECT' ? 'Reason' : 'Note'} required={dialog === 'REJECT'} hint={dialog === 'REJECT' ? undefined : 'Optional'}>
              <Textarea
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={dialog === 'REJECT' ? 'No beds free in a 2-sharing room this month.' : 'Have a safe trip!'}
              />
            </Field>
            {dialog === 'APPROVE' && request.kind === 'SERVICE' && canCreateTask && (
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 accent-blue-600"
                  checked={withTask}
                  onChange={(e) => setWithTask(e.target.checked)}
                />
                <span>
                  <span className="block text-sm font-medium text-slate-800">Create a maintenance task</span>
                  <span className="block text-xs text-slate-500">So your staff see it on their task list.</span>
                </span>
              </label>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              variant={dialog === 'REJECT' ? 'destructive' : 'primary'}
              loading={busy}
              disabled={dialog === 'REJECT' && note.trim().length < 3}
              onClick={() => dialog && decide(dialog)}
            >
              {dialog === 'REJECT' ? 'Decline' : 'Approve'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
