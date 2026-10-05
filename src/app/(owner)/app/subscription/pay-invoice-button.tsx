'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { CreditCard } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { formatMoney } from '@/lib/utils'
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
import { CheckoutDismissed, openRazorpayCheckout } from '@/components/payments/razorpay-checkout'

type StartResult =
  | { mode: 'demo'; invoiceId: string; number: string; amount: number }
  | {
      mode: 'live'
      invoiceId: string
      number: string
      amount: number
      keyId: string
      orderId: string
      amountPaise: number
      currency: string
      description: string
      prefill: { name: string; email: string; contact: string }
      notes: Record<string, string>
    }

type Settled = { message: string; reactivated: boolean }

/**
 * Pay now for one StayFlow invoice. Live: Razorpay Checkout on the platform
 * account, then the server verifies with Razorpay before marking it paid.
 * Demo: an explicit, labelled demo payment.
 */
export function PayInvoiceButton({
  invoiceId,
  number,
  amount,
  demo,
  size = 'sm',
}: {
  invoiceId: string
  number: string
  amount: number
  demo: boolean
  size?: 'sm' | 'default'
}) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = React.useState(false)
  const [demoOpen, setDemoOpen] = React.useState(false)

  function done(result: Settled) {
    toast.success(
      result.reactivated ? 'Paid — your account is active again' : 'Payment received',
      result.message,
    )
    router.refresh()
  }

  function fail(error: unknown) {
    toast.error(
      'Payment not completed',
      error instanceof ApiError || error instanceof Error ? error.message : 'Please try again.',
    )
  }

  async function payLive() {
    setBusy(true)
    try {
      const start = await api.post<StartResult>('/api/subscription', {
        action: 'PAY_INVOICE_START',
        invoiceId,
      })
      if (start.mode !== 'live') {
        setDemoOpen(true)
        return
      }
      const result = await openRazorpayCheckout({
        keyId: start.keyId,
        orderId: start.orderId,
        amountPaise: start.amountPaise,
        currency: start.currency,
        name: 'StayFlow',
        description: start.description,
        prefill: start.prefill,
        notes: start.notes,
      })
      done(
        await api.post<Settled>('/api/subscription', {
          action: 'PAY_INVOICE_VERIFY',
          invoiceId,
          ...result,
        }),
      )
    } catch (error) {
      if (!(error instanceof CheckoutDismissed)) fail(error)
    } finally {
      setBusy(false)
    }
  }

  async function payDemo() {
    setBusy(true)
    try {
      done(await api.post<Settled>('/api/subscription', { action: 'PAY_INVOICE_DEMO', invoiceId }))
      setDemoOpen(false)
    } catch (error) {
      fail(error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button
        variant="primary"
        size={size}
        loading={busy && !demoOpen}
        onClick={demo ? () => setDemoOpen(true) : payLive}
      >
        <CreditCard className="size-3.5" />
        Pay now
      </Button>

      <Dialog open={demoOpen} onOpenChange={(next) => !busy && setDemoOpen(next)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Pay {number}</DialogTitle>
            <DialogDescription>{formatMoney(amount)}</DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-xs leading-relaxed text-amber-800">
            <strong className="font-semibold">Demo mode.</strong> No payment gateway is configured on
            this deployment, so this marks the invoice paid without taking any money. The payment is
            flagged as a demo everywhere it appears.
          </div>
          <DialogFooter>
            <Button variant="ghost" disabled={busy} onClick={() => setDemoOpen(false)}>
              Cancel
            </Button>
            <Button variant="success" loading={busy} onClick={payDemo}>
              Record demo payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
