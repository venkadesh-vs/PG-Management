'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Copy, CreditCard, Loader2, QrCode, Receipt, ShieldCheck, Smartphone, Wallet } from 'lucide-react'
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

type StartResult = {
  mode: 'razorpay' | 'demo' | 'upi'
  demo: boolean
  orderId: string | null
  amount: number
  upiLink: string | null
  upiId: string | null
  invoiceNumber: string | null
  gatewayError?: string | null
  // razorpay only
  keyId?: string
  amountPaise?: number
  currency?: string
  name?: string
  description?: string
  prefill?: { name?: string; email?: string; contact?: string }
  notes?: Record<string, string>
}

type ReceiptResult = { receiptNumber: string; amount: number; demo: boolean }

/**
 * Resident rent payment.
 *  • PG connected Razorpay → Razorpay Checkout (UPI, cards, netbanking) into
 *    the owner's account; the server verifies with Razorpay before recording.
 *  • otherwise → UPI deep link / copy UPI ID (the owner reconciles), and on a
 *    demo deployment an explicit, labelled demo payment.
 * `invoice` omitted = pay the whole outstanding balance.
 */
export function PayRentButton({
  invoice,
  amount: amountProp,
  propertyType,
  label,
  variant = 'primary',
  size,
}: {
  /** `balance` is accepted for older call sites; `amount` wins when given. */
  invoice?: { id: string; number: string; balance?: number } | null
  amount?: number
  propertyType: 'MENS' | 'WOMENS' | 'COLIVE'
  label?: string
  variant?: 'primary' | 'pink' | 'outline'
  size?: 'sm' | 'default' | 'lg'
}) {
  const amount = amountProp ?? invoice?.balance ?? 0
  const router = useRouter()
  const toast = useToast()
  const [open, setOpen] = React.useState(false)
  const [starting, setStarting] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [order, setOrder] = React.useState<StartResult | null>(null)
  const [receipt, setReceipt] = React.useState<ReceiptResult | null>(null)

  const buttonVariant = variant === 'primary' && propertyType === 'WOMENS' ? 'pink' : variant
  const brand = propertyType === 'WOMENS' ? '#db2777' : '#2563eb'
  const subject = invoice ? invoice.number : 'All outstanding rent'

  async function checkout(start: StartResult) {
    if (start.mode !== 'razorpay' || !start.orderId || !start.keyId || !start.amountPaise) return
    setBusy(true)
    // Radix's modal blocks pointer events outside itself, which would freeze
    // Razorpay's iframe — hide ours while Checkout is open.
    setOpen(false)
    try {
      const result = await openRazorpayCheckout({
        keyId: start.keyId,
        orderId: start.orderId,
        amountPaise: start.amountPaise,
        currency: start.currency,
        name: start.name ?? 'Rent',
        description: start.description,
        prefill: start.prefill,
        notes: start.notes,
        color: brand,
      })
      setOpen(true)
      const verified = await api.post<{ receiptNumber: string; amount: number; message: string }>(
        '/api/tenant/pay',
        { action: 'VERIFY', ...result },
      )
      setReceipt({ receiptNumber: verified.receiptNumber, amount: verified.amount, demo: false })
      toast.success('Payment received', verified.message)
      router.refresh()
    } catch (error) {
      // Back to our dialog: retry, or the UPI fallback.
      setOpen(true)
      if (error instanceof CheckoutDismissed) return
      toast.error(
        'Payment not confirmed',
        error instanceof ApiError || error instanceof Error ? error.message : 'Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function start() {
    setOpen(true)
    setReceipt(null)
    setOrder(null)
    setStarting(true)
    try {
      const result = await api.post<StartResult>('/api/tenant/pay', {
        action: 'START',
        invoiceId: invoice?.id,
      })
      setOrder(result)
      if (result.mode === 'razorpay') void checkout(result)
    } catch (error) {
      toast.error(
        'Unable to start the payment',
        error instanceof ApiError ? error.message : 'Please try again.',
      )
      setOpen(false)
    } finally {
      setStarting(false)
    }
  }

  async function confirmDemo() {
    if (!order?.orderId) return
    setBusy(true)
    try {
      const result = await api.post<{ receiptNumber: string; amount: number; message: string }>(
        '/api/tenant/pay',
        { action: 'CONFIRM', invoiceId: invoice?.id, orderId: order.orderId },
      )
      setReceipt({ receiptNumber: result.receiptNumber, amount: result.amount, demo: true })
      toast.success('Payment recorded', result.message)
      router.refresh()
    } catch (error) {
      toast.error('Payment failed', error instanceof ApiError ? error.message : 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  function copyUpi() {
    if (!order?.upiId) return
    navigator.clipboard.writeText(order.upiId).then(
      () => toast.success('UPI ID copied', order.upiId!),
      () => toast.error('Could not copy', 'Please copy it manually.'),
    )
  }

  return (
    <>
      <Button variant={buttonVariant} size={size} onClick={start}>
        <Wallet className="size-4" />
        {label ?? `Pay ${formatMoney(amount)}`}
      </Button>

      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent size="sm">
          <AnimatePresence mode="wait">
            {receipt ? (
              <motion.div
                key="done"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                className="space-y-4 text-center"
              >
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 320, damping: 18 }}
                  className="mx-auto flex size-16 items-center justify-center rounded-full bg-emerald-100"
                >
                  <Check className="size-8 text-emerald-600" strokeWidth={3} />
                </motion.div>
                <DialogTitle>{receipt.demo ? 'Payment recorded' : 'Payment successful'}</DialogTitle>
                <DialogDescription>
                  {formatMoney(receipt.amount)} · {subject}
                </DialogDescription>
                <div className="mx-auto flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <Receipt className="size-4 text-slate-400" />
                  <span className="font-mono text-sm font-semibold text-slate-800">
                    {receipt.receiptNumber}
                  </span>
                </div>
                {receipt.demo && (
                  <p className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-left text-xs leading-relaxed text-amber-800">
                    This was a demo payment. No money left your account — the record exists so you
                    can see how the receipt, ledger and your PG owner&apos;s dashboard update together.
                  </p>
                )}
                <Button variant="primary" className="w-full" onClick={() => setOpen(false)}>
                  Done
                </Button>
              </motion.div>
            ) : (
              <motion.div key="pay" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <DialogHeader>
                  <DialogTitle>Pay rent</DialogTitle>
                  <DialogDescription>
                    {subject} · {formatMoney(order?.amount ?? amount)}
                  </DialogDescription>
                </DialogHeader>

                {starting || !order ? (
                  <div className="flex items-center justify-center py-10 text-sm text-slate-500">
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Preparing your payment…
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 text-center">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Amount</p>
                      <p className="font-display text-3xl font-semibold text-slate-900 tabular">
                        {formatMoney(order.amount)}
                      </p>
                    </div>

                    {order.mode === 'razorpay' && (
                      <div className="space-y-2">
                        <Button
                          variant={buttonVariant === 'outline' ? 'primary' : buttonVariant}
                          className="w-full"
                          loading={busy}
                          onClick={() => checkout(order)}
                        >
                          <CreditCard className="size-4" />
                          Pay online — UPI, card or netbanking
                        </Button>
                        <p className="flex items-center justify-center gap-1.5 text-[11px] text-slate-500">
                          <ShieldCheck className="size-3.5 text-emerald-600" />
                          Secured by Razorpay · paid directly to your PG
                        </p>
                      </div>
                    )}

                    {order.gatewayError && (
                      <p className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-800">
                        {order.gatewayError} You can still pay by UPI below.
                      </p>
                    )}

                    {(order.upiLink || order.upiId) && order.mode === 'razorpay' && (
                      <p className="text-center text-[11px] uppercase tracking-wide text-slate-400">
                        or pay by UPI yourself
                      </p>
                    )}

                    {order.upiLink && (
                      <a
                        href={order.upiLink}
                        className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 transition-colors hover:bg-slate-50"
                      >
                        <div className="flex size-9 items-center justify-center rounded-lg bg-emerald-50">
                          <Smartphone className="size-4 text-emerald-600" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-slate-800">Pay by UPI app</p>
                          <p className="truncate text-xs text-slate-500">
                            Opens GPay, PhonePe or Paytm
                          </p>
                        </div>
                      </a>
                    )}

                    {order.upiId && (
                      <button
                        type="button"
                        onClick={copyUpi}
                        className="flex w-full items-center gap-3 rounded-xl border border-slate-200 p-3 text-left transition-colors hover:bg-slate-50"
                      >
                        <div className="flex size-9 items-center justify-center rounded-lg bg-sky-50">
                          <QrCode className="size-4 text-sky-600" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-slate-800">Copy UPI ID</p>
                          <p className="truncate font-mono text-xs text-slate-500">{order.upiId}</p>
                        </div>
                        <Copy className="size-4 shrink-0 text-slate-400" />
                      </button>
                    )}

                    {order.mode === 'upi' && (
                      <p className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-xs leading-relaxed text-slate-600">
                        Paying by UPI goes straight to your PG owner. They will mark it received and
                        your receipt will appear here.
                      </p>
                    )}

                    {order.mode === 'demo' && (
                      <div className="space-y-3">
                        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-xs leading-relaxed text-amber-800">
                          <strong className="font-semibold">Demo mode.</strong> This PG has not
                          connected a payment gateway yet, so the button below simply records the
                          payment for demonstration. No money is taken, and the record is marked as
                          a demo payment everywhere it appears.
                        </div>
                        <Button variant="success" className="w-full" loading={busy} onClick={confirmDemo}>
                          Record a demo payment of {formatMoney(order.amount)}
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                <DialogFooter>
                  <Button variant="ghost" className="w-full" disabled={busy} onClick={() => setOpen(false)}>
                    Close
                  </Button>
                </DialogFooter>
              </motion.div>
            )}
          </AnimatePresence>
        </DialogContent>
      </Dialog>
    </>
  )
}
