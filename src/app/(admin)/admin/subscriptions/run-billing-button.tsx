'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { PlayCircle, Zap } from 'lucide-react'
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
 * Runs the same billing pass the nightly automation runs — raising invoices
 * that are due, attempting AutoPay, and moving unpaid accounts into grace.
 */
export function RunBillingButton() {
  const router = useRouter()
  const toast = useToast()
  const [open, setOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  async function run() {
    setBusy(true)
    try {
      const result = await api.post<{
        message: string
        billed: number
        failed: number
        suspended: number
      }>('/api/admin/billing', { action: 'RUN' })
      toast.success('Billing run complete', result.message)
      setOpen(false)
      router.refresh()
    } catch (error) {
      toast.error(
        'Billing run failed',
        error instanceof ApiError ? error.message : 'Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <PlayCircle className="size-4" />
        Run billing now
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Run the billing pass</DialogTitle>
            <DialogDescription>
              Raises invoices for every subscription whose billing date has arrived, attempts
              AutoPay where a mandate exists, and moves unpaid accounts into their grace period.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-xs leading-relaxed text-amber-800">
            No payment gateway is configured on this deployment, so AutoPay runs as a labelled
            simulation. Every payment record it writes is flagged as a demo payment.
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy} onClick={run}>
              <Zap className="size-4" />
              Run now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
