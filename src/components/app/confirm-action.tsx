'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle } from 'lucide-react'
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
 * A confirm step for destructive actions (delete, archive, dispose). Calls
 * the endpoint, toasts the API's own message and refreshes the page. The API
 * message is surfaced as-is on failure, so "this room has residents" style
 * refusals reach the user verbatim.
 */
export type ConfirmActionProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: React.ReactNode
  endpoint: string
  method?: 'DELETE' | 'POST' | 'PATCH'
  body?: Record<string, unknown>
  confirmLabel?: string
  successTitle: string
  /** `destructive` (red) for deletes, `default` for reversible actions. */
  tone?: 'destructive' | 'default'
  onSuccess?: (result: { message?: string } & Record<string, unknown>) => void
}

export function ConfirmAction({
  open,
  onOpenChange,
  title,
  description,
  endpoint,
  method = 'DELETE',
  body,
  confirmLabel = 'Delete',
  successTitle,
  tone = 'destructive',
  onSuccess,
}: ConfirmActionProps) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = React.useState(false)

  async function confirm() {
    setBusy(true)
    try {
      const send = method === 'POST' ? api.post : method === 'PATCH' ? api.patch : api.delete
      const result = await send<{ message?: string } & Record<string, unknown>>(endpoint, body)
      toast.success(successTitle, result?.message)
      onOpenChange(false)
      onSuccess?.(result ?? {})
      router.refresh()
    } catch (error) {
      toast.error(
        'That did not go through',
        error instanceof ApiError ? error.message : 'Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {tone === 'destructive' && <AlertTriangle className="size-4 text-red-500" />}
            {title}
          </DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={tone === 'destructive' ? 'destructive' : 'primary'}
            loading={busy}
            onClick={confirm}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
