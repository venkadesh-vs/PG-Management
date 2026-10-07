'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Check, ExternalLink, Hourglass, Repeat, ShieldCheck, X } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { cn, formatMoney } from '@/lib/utils'
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
import { Field, Input, Select } from '@/components/ui/input'

/**
 * AutoPay mandate setup.
 * Live: creates a Razorpay Subscription and sends the owner to Razorpay's
 *       hosted page to authorise UPI AutoPay / card / eMandate. The mandate
 *       turns ACTIVE when Razorpay's webhook confirms it, and Razorpay charges
 *       each month (the webhook settles the invoice).
 * Demo: a local, clearly-labelled mandate; the nightly job simulates debits.
 */
export function AutopayPanel({
  subscriptionId,
  propertyName,
  amount,
  autopayEnabled,
  mandateStatus,
  methodLabel,
  demo,
  unavailable = false,
  authUrl = null,
}: {
  subscriptionId: string
  propertyName: string
  amount: number
  autopayEnabled: boolean
  mandateStatus: string
  methodLabel: string | null
  demo: boolean
  /** No gateway and not a demo deployment: AutoPay cannot be set up yet. */
  unavailable?: boolean
  /** Razorpay hosted authorisation link while the mandate is PENDING. */
  authUrl?: string | null
}) {
  const router = useRouter()
  const toast = useToast()
  const [open, setOpen] = React.useState(false)
  const [kind, setKind] = React.useState('UPI_AUTOPAY')
  const [reference, setReference] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  async function setupLive() {
    setBusy(true)
    try {
      const result = await api.post<{ redirectUrl: string | null; message?: string }>(
        '/api/subscription',
        { action: 'SETUP_AUTOPAY', subscriptionId },
      )
      if (result.redirectUrl) {
        window.location.href = result.redirectUrl
        return
      }
      router.refresh()
    } catch (error) {
      toast.error(
        'Unable to set up AutoPay',
        error instanceof ApiError ? error.message : 'Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function setup() {
    if (!demo) return setupLive()
    setBusy(true)
    try {
      const label =
        kind === 'UPI_AUTOPAY'
          ? `UPI AutoPay${reference ? ` — ${reference}` : ''}`
          : kind === 'CARD'
            ? `Card${reference ? ` ending ${reference.slice(-4)}` : ''}`
            : `NACH mandate${reference ? ` — ${reference}` : ''}`

      const result = await api.post<{ message?: string }>('/api/subscription', {
        action: 'SETUP_AUTOPAY',
        subscriptionId,
        kind,
        label,
        maskedRef: reference || undefined,
      })
      toast.success(
        'AutoPay is active',
        result.message ??
          `${propertyName} will be charged ${formatMoney(amount)} automatically each month.`,
      )
      setOpen(false)
      router.refresh()
    } catch (error) {
      toast.error(
        'Unable to set up AutoPay',
        error instanceof ApiError ? error.message : 'Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function cancel() {
    setBusy(true)
    try {
      await api.post('/api/subscription', { action: 'CANCEL_AUTOPAY', subscriptionId })
      toast.info('AutoPay switched off', 'You will need to pay each invoice with Pay now.')
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

  const active = autopayEnabled && mandateStatus === 'ACTIVE'
  const pending = !active && mandateStatus === 'PENDING' && Boolean(authUrl)
  const failed = !active && mandateStatus === 'FAILED'

  return (
    <>
      <motion.div
        layout
        className={cn(
          'rounded-xl border p-3',
          active ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-200 bg-slate-50/60',
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <div
              className={cn(
                'flex size-8 shrink-0 items-center justify-center rounded-lg',
                active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500',
              )}
            >
              {active ? (
                <ShieldCheck className="size-4" />
              ) : pending ? (
                <Hourglass className="size-4" />
              ) : (
                <Repeat className="size-4" />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-800">
                {active
                  ? `AutoPay is on${demo ? ' (demo)' : ''}`
                  : pending
                    ? 'Waiting for your authorisation'
                    : failed
                      ? 'AutoPay stopped'
                      : 'AutoPay is not set up'}
              </p>
              <p className="text-xs text-slate-500">
                {active
                  ? (methodLabel ?? 'Recurring mandate active')
                  : pending
                    ? 'Approve the mandate on Razorpay to finish. This updates automatically.'
                    : failed
                      ? 'Repeated charges failed. Pay any open invoice and set AutoPay up again.'
                      : 'Set it up once and the monthly invoice settles itself.'}
              </p>
            </div>
          </div>
          {active ? (
            <Button variant="ghost" size="sm" loading={busy} onClick={cancel}>
              <X className="size-3.5" />
              Turn off
            </Button>
          ) : pending ? (
            <div className="flex shrink-0 flex-col items-end gap-1">
              <Button variant="primary" size="sm" asChild>
                <a href={authUrl ?? '#'}>
                  <ExternalLink className="size-3.5" />
                  Authorise
                </a>
              </Button>
              <Button variant="ghost" size="sm" loading={busy} onClick={cancel}>
                Cancel
              </Button>
            </div>
          ) : unavailable ? (
            <span className="shrink-0 text-xs text-slate-400">Not available yet</span>
          ) : (
            <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
              Set up
            </Button>
          )}
        </div>
      </motion.div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Set up AutoPay</DialogTitle>
            <DialogDescription>
              {formatMoney(amount)} will be collected each month for {propertyName}, on the billing
              date.
            </DialogDescription>
          </DialogHeader>

          {demo && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-xs leading-relaxed text-amber-800">
              This deployment has no payment gateway configured. Setting up AutoPay here creates a
              clearly-labelled demo mandate so you can see the billing, failure and grace-period
              flow. No real mandate is created and no money moves.
            </div>
          )}

          {!demo && (
            <div className="rounded-xl border border-sky-200 bg-sky-50/70 p-3 text-xs leading-relaxed text-sky-800">
              You will be taken to Razorpay to approve a monthly mandate of up to{' '}
              {formatMoney(amount)} by UPI AutoPay, card or bank eMandate. Payments go to StayFlow;
              you can turn AutoPay off here at any time.
            </div>
          )}

          {demo && (
          <>
          <Field label="Method" required>
            <Select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="UPI_AUTOPAY">UPI AutoPay</option>
              <option value="NACH">NACH / bank mandate</option>
              <option value="CARD">Card</option>
            </Select>
          </Field>

          <Field
            label={kind === 'CARD' ? 'Card number' : kind === 'NACH' ? 'Bank account' : 'UPI ID'}
            hint="Stored masked, for your reference only"
          >
            <Input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder={kind === 'UPI_AUTOPAY' ? 'yourpg@okicici' : '••••'}
            />
          </Field>
          </>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy} onClick={setup}>
              <Check className="size-4" />
              {demo ? 'Activate demo AutoPay' : 'Continue to Razorpay'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
