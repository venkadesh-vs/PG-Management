'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Check, Copy, Link2, Send } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { cn } from '@/lib/utils'
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

/** What the team / check-in / staff APIs return after sending a login link. */
export type AccessLink = {
  kind?: 'INVITE' | 'PASSWORD_RESET'
  email: string
  inviteUrl: string | null
  sentVia: ('email' | 'whatsapp')[]
}

export function sentViaLabel(sentVia: AccessLink['sentVia']) {
  if (sentVia.length === 2) return 'WhatsApp and email'
  if (sentVia[0] === 'whatsapp') return 'WhatsApp'
  if (sentVia[0] === 'email') return 'email'
  return null
}

/** "Invite sent via WhatsApp/email" plus the link with a copy button. */
export function InviteLinkPanel({
  link,
  className,
  title = 'Login link',
}: {
  link: AccessLink
  className?: string
  title?: string
}) {
  const [copied, setCopied] = React.useState(false)
  const via = sentViaLabel(link.sentVia)

  async function copy() {
    if (!link.inviteUrl) return
    try {
      await navigator.clipboard.writeText(link.inviteUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className={cn('rounded-2xl border border-blue-100 bg-blue-50/70 p-4', className)}>
      <p className="flex items-center gap-2 text-sm font-semibold text-blue-900">
        <Link2 className="size-4" />
        {title}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-blue-800/80">
        {link.kind === 'PASSWORD_RESET'
          ? `They already have an account, so a password reset link was sent to them${via ? ` via ${via}` : ''}.`
          : via
            ? `Invite sent via ${via}. They set their own password from the link (valid 3 days).`
            : 'Nothing was sent automatically — copy the link below and share it with them.'}
      </p>
      <p className="mt-2 text-xs text-blue-900">
        Signs in with <span className="break-all font-mono">{link.email}</span>
      </p>
      {link.inviteUrl && (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <code className="min-w-0 flex-1 truncate rounded-lg bg-white px-2.5 py-2 font-mono text-[11px] text-slate-600">
            {link.inviteUrl}
          </code>
          <Button type="button" size="sm" variant="outline" onClick={copy}>
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? 'Copied' : 'Copy link'}
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * "Resend login link" — POSTs to /api/team and shows the result (with the
 * link to copy) in a dialog.
 */
export function ResendInviteButton({
  action,
  payload,
  label = 'Resend login link',
  size = 'sm',
  variant = 'outline',
}: {
  action: 'RESEND_RESIDENT_INVITE' | 'RESEND_STAFF_INVITE' | 'RESEND_TEAM_INVITE'
  payload: Record<string, string>
  label?: string
  size?: 'sm' | 'default'
  variant?: 'outline' | 'ghost' | 'primary'
}) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState<AccessLink | null>(null)

  async function send() {
    setBusy(true)
    try {
      const res = await api.post<AccessLink & { message: string }>('/api/team', { action, ...payload })
      setResult(res)
      toast.success('Login link sent', res.message)
      router.refresh()
    } catch (error) {
      toast.error('Could not send the link', error instanceof ApiError ? error.message : 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button type="button" size={size} variant={variant} loading={busy} onClick={send}>
        {!busy && <Send className="size-3.5" />}
        {label}
      </Button>
      <Dialog open={Boolean(result)} onOpenChange={(open) => !open && setResult(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Login link sent</DialogTitle>
            <DialogDescription>Links work once. Sending a new one cancels the previous link.</DialogDescription>
          </DialogHeader>
          {result && <InviteLinkPanel link={result} />}
          <DialogFooter>
            <Button type="button" variant="primary" onClick={() => setResult(null)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
