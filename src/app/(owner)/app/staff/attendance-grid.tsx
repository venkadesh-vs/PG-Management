'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { api, ApiError } from '@/lib/client'
import { cn, formatDate, toISODate } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const STATUS_STYLE: Record<string, { className: string; label: string }> = {
  PRESENT: { className: 'bg-emerald-400', label: 'Present' },
  LATE: { className: 'bg-amber-400', label: 'Late' },
  HALF_DAY: { className: 'bg-sky-300', label: 'Half day' },
  LEAVE: { className: 'bg-violet-300', label: 'Leave' },
  ABSENT: { className: 'bg-red-400', label: 'Absent' },
  WEEKLY_OFF: { className: 'bg-slate-200', label: 'Weekly off' },
}

/**
 * A 30-day attendance strip. Clicking today's cell lets the owner mark
 * attendance without leaving the staff list.
 */
export function AttendanceGrid({
  staffId,
  staffName,
  days,
}: {
  staffId: string
  staffName: string
  days: { date: string; status: string }[]
}) {
  const router = useRouter()
  const toast = useToast()
  const [open, setOpen] = React.useState(false)
  const [status, setStatus] = React.useState('PRESENT')
  const [busy, setBusy] = React.useState(false)

  const today = toISODate(new Date())
  const byDate = new Map(days.map((d) => [d.date.slice(0, 10), d.status]))

  // Oldest first, so the strip reads left to right like a calendar.
  const cells = Array.from({ length: 30 }, (_, i) => {
    const date = new Date()
    date.setDate(date.getDate() - (29 - i))
    const key = toISODate(date)
    return { key, status: byDate.get(key) }
  })

  async function mark() {
    setBusy(true)
    try {
      const result = await api.post<{ message: string }>('/api/operations', {
        entity: 'ATTENDANCE',
        staffId,
        date: today,
        status,
      })
      toast.success('Attendance marked', result.message)
      setOpen(false)
      router.refresh()
    } catch (error) {
      toast.error(
        'Unable to mark attendance',
        error instanceof ApiError ? error.message : 'Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="flex flex-wrap gap-[3px]">
        {cells.map((cell) => {
          const style = cell.status ? STATUS_STYLE[cell.status] : null
          const isToday = cell.key === today
          return (
            <button
              key={cell.key}
              type="button"
              onClick={() => isToday && setOpen(true)}
              disabled={!isToday}
              title={`${formatDate(cell.key)}${style ? ` — ${style.label}` : ' — not marked'}`}
              className={cn(
                'size-3 rounded-[3px] transition-transform',
                style?.className ?? 'bg-slate-100',
                isToday && 'ring-2 ring-slate-900 ring-offset-1 hover:scale-110',
              )}
            />
          )
        })}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Mark attendance</DialogTitle>
            <DialogDescription>
              {staffName} · {formatDate(new Date())}
            </DialogDescription>
          </DialogHeader>
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            {Object.entries(STATUS_STYLE).map(([value, meta]) => (
              <option key={value} value={value}>
                {meta.label}
              </option>
            ))}
          </Select>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy} onClick={mark}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
