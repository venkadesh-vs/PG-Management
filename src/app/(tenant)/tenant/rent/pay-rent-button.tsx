'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Copy, Loader2, QrCode, Receipt, ShieldCheck, Smartphone, Wallet } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import {
  formatMoney,
} from '@/lib/utils'
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

type StartResult = {
  orderId: string
  amount: number
  demo: boolean
  upiLink: string | null
  upiId: string | null
  invoiceNumber: string
}

/**
 * Resident rent payment. In demo mode the confirmation step is explicit and
 * labelled — the resident is never shown a fake "payment successful" screen
 * for money that did not move.
 */
export function PayRentButton({
  invoice,
  propertyType,
  variant = 'primary',
  size,
}: {
  invoice: { id: string; number: string; balance: number }
  propertyType: 'MENS' | 'WOMENS' | 'COLIVE'
  variant?: 'primary' | 'pink' | 'outline'
  size?: 'sm' | 'default' | 'lg'
}) {
  const router = useRouter()
  const toast = useToast()
  const [open, setOpen] = React.useState(false)
  const [starting, setStarting] = React.useState(false)
  const [confirming, setConfirming] = React.useState(false)
  const [order, setOrder] = React.useState<StartResult | null>(null)
  const [receipt, setReceipt] = React.useState<{ receiptNumber: string; amount: number } | null>(
    null,
  )

  const buttonVariant = variant === 'primary' && propertyType === 'WOMENS' ? 'pink' : variant

  async function start() {
    setOpen(true)
    setReceipt(null)
    setStarting(true)
    try {
      const result = await api.post<StartResult>('/api/tenant/pay', {
        action: 'START',
        invoiceId: invoice.id,
      })
      setOrder(result)
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

  async function confirm() {
    if (!order) return
    setConfirming(true)
    try {
      const result = await api.post<{ receiptNumber: string; amount: number; message: string }>(
        '/api/tenant/pay',
        { action: 'CONFIRM', invoiceId: invoice.id, orderId: order.orderId },
      )
      setReceipt(result)
      toast.success('Payment recorded', result.message)
      router.refresh()
    } catch (error) {
      toast.error(
        'Payment failed',
        error instanceof ApiError ? error.message : 'Please try again.',
      )
    } finally {
      setConfirming(false)
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
        Pay {formatMoney(invoice.balance)}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
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
                <DialogTitle>Payment recorded</DialogTitle>
                <DialogDescription>
                  {formatMoney(receipt.amount)} against {invoice.number}
                </DialogDescription>
                <div className="mx-auto flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <Receipt className="size-4 text-slate-400" />
                  <span className="font-mono text-sm font-semibold text-slate-800">
                    {receipt.receiptNumber}
                  </span>
                </div>
                <p className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-left text-xs leading-relaxed text-amber-800">
                  This was a demo payment. No money left your account — the record exists so you can
                  see how the receipt, ledger and your PG owner&apos;s dashboard update together.
                </p>
                <Button variant="primary" className="w-full" onClick={() => setOpen(false)}>
                  Done
                </Button>
              </motion.div>
            ) : (
              <motion.div key="pay" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <DialogHeader>
                  <DialogTitle>Pay rent</DialogTitle>
                  <DialogDescription>
                    {invoice.number} · {formatMoney(invoice.balance)}
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

                    {order.upiLink && (
                      <a
                        href={order.upiLink}
                        className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 transition-colors hover:bg-slate-50"
                      >
                        <div className="flex size-9 items-center justify-center rounded-lg bg-emerald-50">
                          <Smartphone className="size-4 text-emerald-600" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-slate-800">Pay by UPI</p>
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

                    {order.demo ? (
                      <div className="space-y-3">
                        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-xs leading-relaxed text-amber-800">
                          <strong className="font-semibold">Demo mode.</strong> This PG has not
                          connected a payment gateway yet, so the button below simply records the
                          payment for demonstration. No money is taken, and the record is marked as
                          a demo payment everywhere it appears.
                        </div>
                        <Button
                          variant="success"
                          className="w-full"
                          loading={confirming}
                          onClick={confirm}
                        >
                          Record a demo payment of {formatMoney(order.amount)}
                        </Button>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-xs leading-relaxed text-emerald-800">
                        <p className="flex items-center gap-1.5 font-semibold">
                          <ShieldCheck className="size-3.5" />
                          Secure payment
                        </p>
                        <p className="mt-1">
                          Complete the payment in your UPI app. Your receipt appears here
                          automatically once your bank confirms it — usually within a minute.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                <DialogFooter>
                  <Button variant="ghost" className="w-full" onClick={() => setOpen(false)}>
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
