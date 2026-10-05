'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, FileText, MessageCircle, Zap } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
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

/**
 * Manual triggers for the rent automations. They call exactly the same
 * services the nightly job runs, so results can never differ.
 */
export function RentToolbar({ currentMonth }: { currentMonth: string }) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = React.useState<string | null>(null)
  const [confirm, setConfirm] = React.useState<'generate' | 'remind' | null>(null)

  async function run(action: 'GENERATE' | 'REMIND' | 'REFRESH_OVERDUE', label: string) {
    setBusy(action)
    setConfirm(null)
    try {
      const result = await api.post<{ message: string }>('/api/invoices', { action })
      toast.success(label, result.message)
      router.refresh()
    } catch (error) {
      toast.error(
        'Something went wrong',
        error instanceof ApiError ? error.message : 'Please try again.',
      )
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        loading={busy === 'REFRESH_OVERDUE'}
        onClick={() => run('REFRESH_OVERDUE', 'Overdue refreshed')}
      >
        <AlertTriangle className="size-4" />
        Refresh overdue
      </Button>
      <Button variant="outline" size="sm" onClick={() => setConfirm('remind')}>
        <MessageCircle className="size-4" />
        Send reminders
      </Button>
      <Button variant="primary" size="sm" onClick={() => setConfirm('generate')}>
        <FileText className="size-4" />
        Generate rent
      </Button>

      <Dialog open={confirm === 'generate'} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Generate rent for {currentMonth}</DialogTitle>
            <DialogDescription>
              Creates one invoice per active resident for this month, pro-rated from their joining
              date. Anyone who already has an invoice for {currentMonth} is skipped, so this is safe
              to run more than once.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={busy === 'GENERATE'}
              onClick={() => run('GENERATE', 'Rent generated')}
            >
              <Zap className="size-4" />
              Generate now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirm === 'remind'} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Send rent reminders</DialogTitle>
            <DialogDescription>
              Sends to residents whose rent is due in three days, due today, or already overdue —
              whichever applies. Nobody gets two reminders on the same day.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-800">
            WhatsApp is running in demo mode on this deployment. Messages are written to the outbox
            so you can read exactly what a resident would receive — nothing is actually delivered
            until WhatsApp Business credentials are configured.
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={busy === 'REMIND'}
              onClick={() => run('REMIND', 'Reminders queued')}
            >
              <MessageCircle className="size-4" />
              Send reminders
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
