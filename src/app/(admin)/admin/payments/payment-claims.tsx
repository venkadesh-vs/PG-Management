'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { BadgeCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { api, ApiError } from '@/lib/client'
import { formatDateTime, formatMoney } from '@/lib/utils'

export type ClaimRow = {
  id: string
  organizationName: string
  invoiceNumber: string
  amount: number
  method: string
  utr: string
  proofUrl: string | null
  note: string | null
  createdByName: string
  createdAt: string
}

/** "I've paid" reports from owners, waiting for a Super Admin to check the bank. */
export function PaymentClaims({ claims }: { claims: ClaimRow[] }) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = React.useState<string | null>(null)
  const [rejecting, setRejecting] = React.useState<string | null>(null)
  const [reason, setReason] = React.useState('')

  async function act(claimId: string, action: 'APPROVE_CLAIM' | 'REJECT_CLAIM') {
    setBusy(claimId)
    try {
      const res = await api.post<{ message: string }>('/api/admin/billing', {
        action,
        claimId,
        ...(action === 'REJECT_CLAIM' ? { reason: reason.trim() } : {}),
      })
      toast.success(res.message)
      setRejecting(null)
      setReason('')
      router.refresh()
    } catch (error) {
      toast.error('Not done', error instanceof ApiError || error instanceof Error ? error.message : 'Please try again.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section id="claims" className="rounded-xl border border-sky-200 bg-white">
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
        <BadgeCheck className="size-4 text-sky-600" />
        <h2 className="text-sm font-semibold text-slate-900">Payments to verify</h2>
        <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">{claims.length}</span>
      </div>
      <ul className="divide-y divide-slate-100">
        {claims.map((c) => (
          <li key={c.id} className="space-y-2 px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900">
                  {c.organizationName} · {c.invoiceNumber}
                </p>
                <p className="text-xs text-slate-500">
                  {formatMoney(c.amount)} by {c.method === 'UPI' ? 'UPI' : 'bank transfer'} · UTR{' '}
                  <span className="select-all font-mono text-slate-700">{c.utr}</span> · {c.createdByName},{' '}
                  {formatDateTime(c.createdAt)}
                </p>
                {c.note && <p className="mt-1 text-xs text-slate-600">“{c.note}”</p>}
                {c.proofUrl && (
                  <a href={c.proofUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs font-medium text-blue-700 hover:underline">
                    View screenshot
                  </a>
                )}
              </div>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" variant="primary" disabled={busy === c.id} onClick={() => act(c.id, 'APPROVE_CLAIM')}>
                  Verified — mark paid
                </Button>
                <Button size="sm" variant="outline" disabled={busy === c.id} onClick={() => setRejecting(rejecting === c.id ? null : c.id)}>
                  Reject
                </Button>
              </div>
            </div>
            {rejecting === c.id && (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Why — e.g. no credit with this UTR yet"
                  aria-label="Reason for rejecting"
                />
                <Button size="sm" variant="destructive" disabled={busy === c.id || reason.trim().length < 3} onClick={() => act(c.id, 'REJECT_CLAIM')}>
                  Reject and tell the owner
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
