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
  PlayCircle,
  Wrench,
} from 'lucide-react'
import { api, ApiError } from '@/lib/client'
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
      })
      if (action === 'COMPLETE') {
        setJustDone(true)
        setCompleting(false)
        setTimeout(() => router.refresh(), 900)
      } else {
        router.refresh()
      }
      toast.success(result.message, action === 'COMPLETE' ? 'The resident has been told.' : undefined)
    } catch (error) {
      toast.error(
        'Something went wrong',
        error instanceof ApiError ? error.message : 'Please try again.',
      )
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
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {task.status !== 'COMPLETED' && !justDone && (
            <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
              {task.status === 'PENDING' && (
                <Button variant="outline" size="sm" loading={busy} onClick={() => act('ACCEPT')}>
                  <Check className="size-3.5" />
                  Accept
                </Button>
              )}
              {(task.status === 'PENDING' || task.status === 'ACCEPTED') && (
                <Button variant="outline" size="sm" loading={busy} onClick={() => act('START')}>
                  <PlayCircle className="size-3.5" />
                  Start work
                </Button>
              )}
              <Button variant="success" size="sm" onClick={() => setCompleting(true)}>
                <CheckCircle2 className="size-3.5" />
                Mark done
              </Button>
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
          <Textarea
            rows={3}
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Replaced the tap washer and checked for leaks."
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCompleting(false)}>
              Cancel
            </Button>
            <Button variant="success" loading={busy} onClick={() => act('COMPLETE')}>
              <CheckCircle2 className="size-4" />
              Mark done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
