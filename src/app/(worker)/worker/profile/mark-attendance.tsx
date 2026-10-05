'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { CheckCircle2, Clock } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import {
  toISODate,
} from '@/lib/utils'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

/**
 * Self check-in for the day. The owner sees it on the staff page immediately.
 */
export function MarkAttendanceButton({
  staffName,
  currentStatus,
}: {
  staffName: string
  currentStatus: string | null
}) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = React.useState<string | null>(null)

  async function mark(status: 'PRESENT' | 'LEAVE') {
    setBusy(status)
    try {
      const result = await api.post<{ message: string }>('/api/operations', {
        entity: 'ATTENDANCE',
        staffId: 'self',
        date: toISODate(new Date()),
        status,
      })
      toast.success('Attendance marked', result.message)
      router.refresh()
    } catch (error) {
      toast.error(
        'Unable to mark attendance',
        error instanceof ApiError ? error.message : 'Please try again.',
      )
    } finally {
      setBusy(null)
    }
  }

  if (currentStatus) {
    return (
      <Card className="border-emerald-200 bg-emerald-50/50">
        <CardContent className="flex items-center gap-3 p-4">
          <motion.div initial={{ scale: 0.8 }} animate={{ scale: 1 }}>
            <CheckCircle2 className="size-5 shrink-0 text-emerald-600" />
          </motion.div>
          <div>
            <p className="text-sm font-semibold capitalize text-emerald-900">
              Marked {currentStatus.replace('_', ' ').toLowerCase()} today
            </p>
            <p className="text-xs text-emerald-800/80">Your PG owner can see this.</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-amber-200 bg-amber-50/50">
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <Clock className="size-5 shrink-0 text-amber-600" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-amber-900">Mark today&apos;s attendance</p>
            <p className="text-xs text-amber-800/80">{staffName}, are you working today?</p>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <Button
            variant="success"
            size="sm"
            className="flex-1"
            loading={busy === 'PRESENT'}
            onClick={() => mark('PRESENT')}
          >
            I&apos;m here
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            loading={busy === 'LEAVE'}
            onClick={() => mark('LEAVE')}
          >
            On leave
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
