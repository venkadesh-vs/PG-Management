'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  DoorOpen,
  Camera,
  PlayCircle,
  Wrench,
} from 'lucide-react'
import { api } from '@/lib/client'
import { PhotoGallery, PhotoUpload } from '@/components/app/photo-upload'
import { SlaChip } from '@/components/app/sla-chip'
import { cn, formatDate, relativeTime } from '@/lib/utils'
import { PRIORITY_STYLE, PROPERTY_THEMES } from '@/lib/theme'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { StatusChip } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export type WorkerTask = {
  id: string
  title: string
  description: string | null
  status: string
  priority: string
  kind: string
  dueDate: string | null
  propertyName: string
  propertyType: 'MENS' | 'WOMENS' | 'COLIVE'
  roomNumber: string | null
  complaintCode: string | null
  createdAt: string
  complaintPhotos?: string[]
  completionPhotoUrl?: string | null
  /** SLA of the complaint this task came from. */
  sla?: { status: string; dueAt: string | null; createdAt: string; resolvedAt: string | null } | null
}

const STEPS = [
  { key: 'ACCEPT', label: 'Accept' },
  { key: 'START', label: 'Start' },
  { key: 'COMPLETE', label: 'Complete' },
] as const

function stepIndex(status: string) {
  if (status === 'PENDING') return 0
  if (status === 'ACCEPTED') return 1
  if (status === 'IN_PROGRESS') return 2
  return 3
}

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'New',
  ACCEPTED: 'Accepted',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Done',
  CANCELLED: 'Cancelled',
}

/**
 * One task, with only the actions a worker actually needs: accept it, start
 * it, finish it. Completing a complaint task resolves the complaint and tells
 * the resident — the worker does not have to do anything else.
 */
export function TaskCard({ task }: { task: WorkerTask }) {
  const router = useRouter()
  const toast = useToast()
  const [expanded, setExpanded] = React.useState(false)
  const [completing, setCompleting] = React.useState(false)
  const [note, setNote] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [justDone, setJustDone] = React.useState(false)
  const [proof, setProof] = React.useState<string[]>([])
  const [uploading, setUploading] = React.useState(false)

  const theme = PROPERTY_THEMES[task.propertyType]
  const priority = PRIORITY_STYLE[task.priority]
  const overdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'COMPLETED'

  async function act(action: 'ACCEPT' | 'START' | 'COMPLETE') {
    setBusy(true)
    try {
      const result = await api.patch<{ message: string }>('/api/tasks', {
        taskId: task.id,
        action,
        note: action === 'COMPLETE' ? note || 'Work completed' : undefined,
        photoUrl: action === 'COMPLETE' ? proof[0] : undefined,
      })
      if (action === 'COMPLETE') {
        setJustDone(true)
        setCompleting(false)
        setTimeout(() => router.refresh(), 900)
      } else {
        router.refresh()
      }
      toast.success(
        result.message,
        action === 'COMPLETE'
          ? task.complaintCode
            ? 'Nice work! The resident has been told it is fixed.'
            : 'Nice work! Your PG owner has been told.'
          : action === 'START'
            ? 'Take a photo when you are done. It builds trust with the resident.'
            : 'It is yours now. Tap Start when you begin.',
      )
    } catch (error) {
      toast.fromError(error, action === 'COMPLETE' ? 'complete the task' : 'update the task')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Card
        className={cn(
          'overflow-hidden transition-colors',
          overdue && 'border-red-200',
          justDone && 'border-emerald-300',
        )}
      >
        <CardContent className="p-4">
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="flex w-full items-start gap-3 text-left"
          >
            <div
              className={cn(
                'flex size-10 shrink-0 items-center justify-center rounded-xl',
                justDone ? 'bg-emerald-100' : theme.bg,
              )}
            >
              {justDone ? (
                <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }}>
                  <Check className="size-5 text-emerald-600" strokeWidth={3} />
                </motion.span>
              ) : (
                <Wrench className={cn('size-5', theme.text)} />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="text-sm font-semibold text-slate-900">{task.title}</p>
                <StatusChip label={priority.label} chip={priority.chip} />
                {task.sla && (
                  <SlaChip
                    status={justDone ? 'RESOLVED' : task.sla.status}
                    slaDueAt={task.sla.dueAt}
                    createdAt={task.sla.createdAt}
                    resolvedAt={task.sla.resolvedAt}
                  />
                )}
              </div>
              <p className="mt-0.5 truncate text-xs text-slate-500">
                {task.propertyName}
                {task.roomNumber ? ` · Room ${task.roomNumber}` : ''}
                {task.complaintCode ? ` · ${task.complaintCode}` : ''}
              </p>
              <p
                className={cn(
                  'mt-1 flex items-center gap-1 text-[11px]',
                  overdue ? 'font-medium text-red-600' : 'text-slate-400',
                )}
              >
                <Clock className="size-3" />
                {task.dueDate
                  ? overdue
                    ? `Was due ${formatDate(task.dueDate)}`
                    : `Due ${formatDate(task.dueDate)}`
                  : `Added ${relativeTime(task.createdAt)}`}
                <span className="ml-1 rounded bg-slate-100 px-1.5 text-[10px] font-medium text-slate-500">
                  {STATUS_LABEL[task.status]}
                </span>
              </p>
            </div>

            <ChevronDown
              className={cn(
                'size-4 shrink-0 text-slate-300 transition-transform',
                expanded && 'rotate-180',
              )}
            />
          </button>

          <AnimatePresence initial={false}>
            {expanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-3 border-t border-slate-100 pt-3">
                  {task.description && (
                    <p className="text-sm leading-relaxed text-slate-600">{task.description}</p>
                  )}
                  {task.roomNumber && (
                    <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
                      <DoorOpen className="size-3.5" />
                      Room {task.roomNumber}, {task.propertyName}
                    </p>
                  )}
                  {task.complaintPhotos && task.complaintPhotos.length > 0 && (
                    <div className="mt-3">
                      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                        Photos from the resident
                      </p>
                      <PhotoGallery urls={task.complaintPhotos} size="sm" />
                    </div>
                  )}
                  {task.completionPhotoUrl && (
                    <div className="mt-3">
                      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-600">
                        Your proof photo
                      </p>
                      <PhotoGallery urls={[task.completionPhotoUrl]} size="sm" />
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {task.status !== 'COMPLETED' && task.status !== 'CANCELLED' && !justDone && (
            <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
              {/* Accept -> Start -> Complete (PRD §42) */}
              <ol className="flex items-center gap-1.5" aria-label="Task progress">
                {STEPS.map((step, i) => {
                  const current = stepIndex(task.status)
                  const done = i < current
                  const active = i === current
                  return (
                    <li key={step.key} className="flex flex-1 items-center gap-1.5">
                      <span
                        className={cn(
                          'flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                          done
                            ? 'bg-emerald-500 text-white'
                            : active
                              ? 'bg-blue-600 text-white ring-4 ring-blue-100'
                              : 'bg-slate-100 text-slate-400',
                        )}
                      >
                        {done ? <Check className="size-3" strokeWidth={3} /> : i + 1}
                      </span>
                      <span
                        className={cn(
                          'text-[11px] font-medium',
                          active ? 'text-slate-900' : done ? 'text-emerald-700' : 'text-slate-400',
                        )}
                      >
                        {step.label}
                      </span>
                      {i < STEPS.length - 1 && (
                        <span className={cn('h-px flex-1', done ? 'bg-emerald-300' : 'bg-slate-200')} />
                      )}
                    </li>
                  )
                })}
              </ol>

              {task.status === 'PENDING' && (
                <Button
                  variant="primary"
                  size="lg"
                  className="w-full"
                  loading={busy}
                  onClick={() => act('ACCEPT')}
                >
                  <Check className="size-5" />
                  Accept task
                </Button>
              )}
              {task.status === 'ACCEPTED' && (
                <Button
                  variant="primary"
                  size="lg"
                  className="w-full"
                  loading={busy}
                  onClick={() => act('START')}
                >
                  <PlayCircle className="size-5" />
                  Start work
                </Button>
              )}
              {task.status === 'IN_PROGRESS' && (
                <Button variant="success" size="lg" className="w-full" onClick={() => setCompleting(true)}>
                  <CheckCircle2 className="size-5" />
                  Complete task
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={completing} onOpenChange={setCompleting}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Finish this task</DialogTitle>
            <DialogDescription>
              {task.complaintCode
                ? 'The complaint will be marked resolved and the resident will be told what you did.'
                : 'Add a short note so your PG owner knows what was done.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-slate-700">
                <Camera className="size-4 text-slate-400" />
                Photo proof
                <span className="text-xs font-normal text-slate-400">(recommended)</span>
              </p>
              <PhotoUpload
                value={proof}
                onChange={setProof}
                purpose="TASK_PROOF"
                max={1}
                label="Take photo"
                hint={
                  task.complaintCode
                    ? 'A photo of the finished work reassures the resident and your owner.'
                    : 'A quick photo of the finished work.'
                }
                onBusyChange={setUploading}
              />
            </div>
            <Textarea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What did you do? e.g. Replaced the tap washer and checked for leaks."
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCompleting(false)}>
              Cancel
            </Button>
            <Button
              variant="success"
              size="lg"
              loading={busy}
              disabled={uploading}
              onClick={() => act('COMPLETE')}
            >
              <CheckCircle2 className="size-4" />
              {uploading ? 'Uploading photo…' : proof.length ? 'Complete with photo' : 'Complete task'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
