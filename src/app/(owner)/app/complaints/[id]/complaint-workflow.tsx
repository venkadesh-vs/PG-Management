'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Check, CheckCircle2, Flag, PauseCircle, PlayCircle, UserCog, XCircle } from 'lucide-react'
import type { ComplaintPriority, ComplaintStatus } from '@prisma/client'
import { api, ApiError } from '@/lib/client'
import { PhotoUpload } from '@/components/app/photo-upload'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, Select, Textarea } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown'

/**
 * Drives the complaint through its states. Assigning also creates the
 * worker's task; resolving closes that task — the two never drift apart.
 */
export function ComplaintWorkflow({
  complaint,
  staff,
  roleLabels = {},
  canAssign = true,
  canManage = true,
}: {
  complaint: {
    id: string
    code: string
    status: ComplaintStatus
    assignedStaffId: string | null
    priority?: ComplaintPriority
    residentId?: string | null
  }
  staff: { id: string; name: string; role: string }[]
  /** STAFF_ROLE value → label. */
  roleLabels?: Record<string, string>
  /** complaints.assign */
  canAssign?: boolean
  /** complaints.manage — status changes. */
  canManage?: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const [assignOpen, setAssignOpen] = React.useState(false)
  const [resolveOpen, setResolveOpen] = React.useState(false)
  const [staffId, setStaffId] = React.useState(complaint.assignedStaffId ?? '')
  const [note, setNote] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [celebrate, setCelebrate] = React.useState(false)
  const [resolutionPhoto, setResolutionPhoto] = React.useState<string[]>([])
  const [uploading, setUploading] = React.useState(false)

  const done = complaint.status === 'CLOSED' || complaint.status === 'RESOLVED'

  async function setPriority(priority: ComplaintPriority) {
    if (priority === complaint.priority) return
    setBusy(true)
    try {
      const result = await api.patch<{ message: string }>('/api/complaints', {
        complaintId: complaint.id,
        action: 'PRIORITY',
        priority,
      })
      toast.success('Priority changed', result.message)
      router.refresh()
    } catch (error) {
      toast.fromError(error, 'change the priority')
    } finally {
      setBusy(false)
    }
  }

  async function setStatus(status: ComplaintStatus, message?: string, photoUrl?: string) {
    setBusy(true)
    try {
      const result = await api.patch<{ message: string }>('/api/complaints', {
        complaintId: complaint.id,
        action: 'STATUS',
        status,
        message,
        photoUrl,
      })
      if (status === 'RESOLVED') {
        setCelebrate(true)
        setTimeout(() => setCelebrate(false), 1600)
      }
      toast.success(
        status === 'RESOLVED' ? 'Complaint marked as resolved' : 'Status updated',
        result.message,
      )
      setResolveOpen(false)
      setNote('')
      setResolutionPhoto([])
      router.refresh()
    } catch (error) {
      toast.error(
        'Something went wrong',
        error instanceof ApiError ? error.message : 'Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function assign() {
    if (!staffId) {
      toast.error('Choose a worker', 'Pick who should handle this.')
      return
    }
    setBusy(true)
    try {
      const result = await api.patch<{ message: string }>('/api/complaints', {
        complaintId: complaint.id,
        action: 'ASSIGN',
        staffId,
        message: note || undefined,
      })
      toast.success('Worker assigned', `${result.message} — they will see it in their app.`)
      setAssignOpen(false)
      setNote('')
      router.refresh()
    } catch (error) {
      toast.error(
        'Unable to assign',
        error instanceof ApiError ? error.message : 'Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {celebrate && (
        <motion.div
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: [0, 1, 1, 0], scale: [0.6, 1.1, 1, 1] }}
          transition={{ duration: 1.6, times: [0, 0.25, 0.7, 1] }}
          className="pointer-events-none fixed inset-0 z-[90] flex items-center justify-center"
        >
          <div className="flex size-24 items-center justify-center rounded-full bg-emerald-500 shadow-float">
            <Check className="size-12 text-white" strokeWidth={3} />
          </div>
        </motion.div>
      )}

      {!done && canAssign && (
        <Button variant="outline" onClick={() => setAssignOpen(true)}>
          <UserCog className="size-4" />
          {complaint.assignedStaffId ? 'Reassign' : 'Assign worker'}
        </Button>
      )}

      {canManage && complaint.status !== 'RESOLVED' && complaint.status !== 'CLOSED' && (
        <Button variant="success" loading={busy} onClick={() => setResolveOpen(true)}>
          <CheckCircle2 className="size-4" />
          Mark resolved
        </Button>
      )}

      {canManage && (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" aria-label="Change status">
            <PlayCircle className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuLabel>Change status</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => setStatus('IN_PROGRESS')}>
            <PlayCircle />
            In progress
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setStatus('ON_HOLD')}>
            <PauseCircle />
            On hold
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setStatus('CLOSED')}>
            <CheckCircle2 />
            Close
          </DropdownMenuItem>
          {complaint.priority && !done && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Priority (resets the SLA)</DropdownMenuLabel>
              {(['URGENT', 'HIGH', 'MEDIUM', 'LOW'] as const).map((p) => (
                <DropdownMenuItem key={p} onSelect={() => setPriority(p)}>
                  <Flag className={p === 'URGENT' ? 'text-red-500' : p === 'HIGH' ? 'text-orange-500' : p === 'MEDIUM' ? 'text-amber-500' : 'text-slate-400'} />
                  {p.charAt(0) + p.slice(1).toLowerCase()}
                  {p === complaint.priority && <Check className="ml-auto" />}
                </DropdownMenuItem>
              ))}
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem destructive onSelect={() => setStatus('REJECTED')}>
            <XCircle />
            Reject
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      )}

      {/* ----------------------------------------------------- Assign */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Assign {complaint.code}</DialogTitle>
            <DialogDescription>
              The worker gets a task in their app with the room and the details. The resident is
              told someone is on it.
            </DialogDescription>
          </DialogHeader>
          <Field label="Worker" required>
            <Select value={staffId} onChange={(e) => setStaffId(e.target.value)}>
              <option value="">Select a worker</option>
              {staff.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name} — {roleLabels[member.role] ?? member.role.replace('_', ' ').toLowerCase()}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Instructions">
            <Textarea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Anything the worker should know before starting"
            />
          </Field>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAssignOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy} onClick={assign}>
              Assign worker
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------------------------------------------------- Resolve */}
      <Dialog open={resolveOpen} onOpenChange={setResolveOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Mark {complaint.code} resolved</DialogTitle>
            <DialogDescription>
              The resident is notified with your note, and the worker&apos;s task closes
              automatically.
            </DialogDescription>
          </DialogHeader>
          <Field label="What was done?" required>
            <Textarea
              rows={3}
              autoFocus
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Replaced the tap washer and checked for leaks."
            />
          </Field>
          <Field label="After photo" hint="Optional — shows the resident the fix">
            <PhotoUpload
              value={resolutionPhoto}
              onChange={setResolutionPhoto}
              purpose="COMPLAINT"
              residentId={complaint.residentId ?? undefined}
              max={1}
              label="Add photo"
              hint="One photo of the finished work."
              onBusyChange={setUploading}
            />
          </Field>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setResolveOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="success"
              loading={busy}
              disabled={uploading}
              onClick={() => setStatus('RESOLVED', note || 'Issue resolved', resolutionPhoto[0])}
            >
              <CheckCircle2 className="size-4" />
              Mark resolved
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
