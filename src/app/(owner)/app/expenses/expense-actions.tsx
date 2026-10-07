'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Ban, Check, MoreHorizontal, Paperclip, Pencil, X } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, Textarea } from '@/components/ui/input'
import { ExpenseForm, type ExpenseFormValues } from './expense-form'

type Option = { id: string; name: string }

/**
 * The "⋯" menu on an expense: edit, view the bill, approve / reject (owner or
 * money sign-off) and void with a reason. Expenses are never deleted.
 */
export function ExpenseActions({
  expense,
  status,
  canManage,
  canApprove,
  categories,
  summary,
}: {
  expense: ExpenseFormValues & { id: string }
  status: 'APPROVED' | 'PENDING' | 'REJECTED' | 'VOIDED'
  canManage: boolean
  canApprove: boolean
  categories: Option[]
  /** "EB bill · ₹2,400 on 3 Oct" for the confirm dialogs. */
  summary: string
}) {
  const [dialog, setDialog] = React.useState<'edit' | 'void' | 'reject' | null>(null)
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = React.useState(false)

  const voided = status === 'VOIDED'
  if (!canManage && !expense.receiptUrl) return null

  async function act(action: 'APPROVE' | 'REJECT' | 'VOID', text?: string) {
    setBusy(true)
    try {
      const body = action === 'VOID' ? { action, reason: text } : { action, note: text || undefined }
      const result = await api.post<{ message?: string }>(`/api/expenses/${expense.id}`, body)
      toast.success(
        action === 'APPROVE' ? 'Expense approved' : action === 'REJECT' ? 'Expense rejected' : 'Expense voided',
        result?.message,
      )
      setDialog(null)
      router.refresh()
    } catch (error) {
      toast.error('That did not go through', error instanceof ApiError ? error.message : 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${expense.title}`}>
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {expense.receiptUrl && (
            <DropdownMenuItem onSelect={() => window.open(expense.receiptUrl, '_blank', 'noopener')}>
              <Paperclip />
              View bill
            </DropdownMenuItem>
          )}
          {canManage && !voided && (
            <DropdownMenuItem onSelect={() => setDialog('edit')}>
              <Pencil />
              Edit
            </DropdownMenuItem>
          )}
          {canManage && canApprove && !voided && status !== 'APPROVED' && (
            <DropdownMenuItem disabled={busy} onSelect={() => void act('APPROVE')}>
              <Check />
              Approve
            </DropdownMenuItem>
          )}
          {canManage && canApprove && status === 'PENDING' && (
            <DropdownMenuItem onSelect={() => setDialog('reject')}>
              <X />
              Reject
            </DropdownMenuItem>
          )}
          {canManage && !voided && (
            <DropdownMenuItem destructive onSelect={() => setDialog('void')}>
              <Ban />
              Void
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {canManage && !voided && (
        <ExpenseForm
          properties={[]}
          categories={categories}
          initial={expense}
          open={dialog === 'edit'}
          onOpenChange={(open) => setDialog(open ? 'edit' : null)}
        />
      )}

      <ReasonDialog
        open={dialog === 'void' || dialog === 'reject'}
        onOpenChange={(open) => !open && setDialog(null)}
        title={dialog === 'reject' ? 'Reject this expense?' : 'Void this expense?'}
        description={
          dialog === 'reject'
            ? `${summary}. It stays on record but out of every total.`
            : `${summary}. A voided expense stays on record (struck through) but no longer counts in expenses, P&L or reports. This cannot be undone — record it again if needed.`
        }
        label={dialog === 'reject' ? 'Why is it rejected?' : 'Why is it being voided?'}
        confirmLabel={dialog === 'reject' ? 'Reject' : 'Void expense'}
        busy={busy}
        onConfirm={(text) => act(dialog === 'reject' ? 'REJECT' : 'VOID', text)}
      />
    </>
  )
}

function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  confirmLabel,
  busy,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  label: string
  confirmLabel: string
  busy: boolean
  onConfirm: (reason: string) => void
}) {
  const [reason, setReason] = React.useState('')
  const [error, setError] = React.useState('')
  React.useEffect(() => {
    if (open) {
      setReason('')
      setError('')
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent size="sm">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (reason.trim().length < 3) {
              setError('A few words, please — this goes in the activity log.')
              return
            }
            onConfirm(reason.trim())
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div className="py-3">
            <Field label={label} required error={error}>
              <Textarea rows={2} value={reason} placeholder="Entered twice by mistake" onChange={(e) => setReason(e.target.value)} />
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" loading={busy}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
