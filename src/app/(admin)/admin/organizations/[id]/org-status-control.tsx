'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Ban, CheckCircle2, ShieldCheck } from 'lucide-react'
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
import { Field, Textarea } from '@/components/ui/input'

/**
 * Suspending an account is destructive for the PG owner, so it always asks
 * first and records why.
 */
export function OrgStatusControl({
  organizationId,
  status,
  name,
}: {
  organizationId: string
  status: string
  name: string
}) {
  const router = useRouter()
  const toast = useToast()
  const [confirming, setConfirming] = React.useState<'SUSPEND' | 'ACTIVATE' | null>(null)
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  const suspended = status === 'SUSPENDED'

  async function apply(next: 'ACTIVE' | 'SUSPENDED') {
    setBusy(true)
    try {
      await api.post('/api/admin/organizations', {
        action: 'SET_STATUS',
        organizationId,
        status: next,
        note: reason || undefined,
      })
      toast.success(
        next === 'ACTIVE' ? 'Account reactivated' : 'Account suspended',
        next === 'ACTIVE'
          ? `${name} has full access again.`
          : `${name} can sign in but the app is restricted.`,
      )
      setConfirming(null)
      setReason('')
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

  return (
    <>
      {suspended ? (
        <Button variant="success" onClick={() => setConfirming('ACTIVATE')}>
          <CheckCircle2 className="size-4" />
          Reactivate
        </Button>
      ) : (
        <Button variant="outline" onClick={() => setConfirming('SUSPEND')}>
          <Ban className="size-4" />
          Suspend account
        </Button>
      )}

      <Dialog open={confirming !== null} onOpenChange={(o) => !o && setConfirming(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>
              {confirming === 'SUSPEND' ? `Suspend ${name}?` : `Reactivate ${name}?`}
            </DialogTitle>
            <DialogDescription>
              {confirming === 'SUSPEND'
                ? 'The owner keeps their data and can still sign in, but the app is restricted until the account is reactivated. Their residents are not affected.'
                : 'Full access is restored immediately.'}
            </DialogDescription>
          </DialogHeader>

          <Field label="Reason" hint="Recorded in the audit log">
            <Textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                confirming === 'SUSPEND' ? 'Subscription unpaid past grace period' : 'Payment received'
              }
            />
          </Field>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button
              variant={confirming === 'SUSPEND' ? 'destructive' : 'success'}
              loading={busy}
              onClick={() => apply(confirming === 'SUSPEND' ? 'SUSPENDED' : 'ACTIVE')}
            >
              <ShieldCheck className="size-4" />
              {confirming === 'SUSPEND' ? 'Suspend' : 'Reactivate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
