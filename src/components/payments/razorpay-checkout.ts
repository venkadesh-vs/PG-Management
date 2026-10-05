'use client'

/**
 * Razorpay Checkout in the browser. Loads checkout.js once and wraps the
 * modal in a promise:
 *   resolves  → the handler's {orderId, paymentId, signature}, which the
 *               caller POSTs to the server for verification (the server
 *               re-checks everything with Razorpay — this is not proof);
 *   rejects   → CheckoutDismissed when the user closes the modal, or
 *               CheckoutFailed with Razorpay's reason.
 */

const SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js'

type RazorpayHandlerResponse = {
  razorpay_payment_id: string
  razorpay_order_id: string
  razorpay_signature: string
}

type RazorpayInstance = {
  open: () => void
  on: (event: 'payment.failed', cb: (response: { error?: { description?: string; reason?: string } }) => void) => void
}

type RazorpayConstructor = new (options: Record<string, unknown>) => RazorpayInstance

declare global {
  interface Window {
    Razorpay?: RazorpayConstructor
  }
}

export class CheckoutDismissed extends Error {
  constructor() {
    super('Payment was cancelled')
    this.name = 'CheckoutDismissed'
  }
}

export class CheckoutFailed extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CheckoutFailed'
  }
}

let loading: Promise<RazorpayConstructor> | null = null

export function loadRazorpay(): Promise<RazorpayConstructor> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Checkout needs a browser'))
  if (window.Razorpay) return Promise.resolve(window.Razorpay)
  if (loading) return loading
  loading = new Promise<RazorpayConstructor>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT_SRC
    script.async = true
    script.onload = () =>
      window.Razorpay ? resolve(window.Razorpay) : reject(new Error('Razorpay Checkout did not load'))
    script.onerror = () => {
      loading = null
      script.remove()
      reject(new Error('Could not load Razorpay Checkout. Check your connection and try again.'))
    }
    document.body.appendChild(script)
  })
  return loading
}

export type CheckoutOptions = {
  keyId: string
  orderId: string
  amountPaise: number
  currency?: string
  name: string
  description?: string
  prefill?: { name?: string; email?: string; contact?: string }
  notes?: Record<string, string>
  /** Brand colour for the modal. */
  color?: string
}

export type CheckoutResult = { orderId: string; paymentId: string; signature: string }

export async function openRazorpayCheckout(options: CheckoutOptions): Promise<CheckoutResult> {
  const Razorpay = await loadRazorpay()
  return new Promise<CheckoutResult>((resolve, reject) => {
    let settled = false
    const instance = new Razorpay({
      key: options.keyId,
      order_id: options.orderId,
      amount: options.amountPaise,
      currency: options.currency ?? 'INR',
      name: options.name,
      description: options.description,
      prefill: options.prefill,
      notes: options.notes,
      theme: { color: options.color ?? '#2563eb' },
      retry: { enabled: true },
      handler: (response: RazorpayHandlerResponse) => {
        settled = true
        resolve({
          orderId: response.razorpay_order_id,
          paymentId: response.razorpay_payment_id,
          signature: response.razorpay_signature,
        })
      },
      modal: {
        ondismiss: () => {
          if (!settled) reject(new CheckoutDismissed())
        },
      },
    })
    instance.on('payment.failed', (response) => {
      // Checkout lets the user retry inside the modal; only remember the reason.
      const reason = response.error?.description || response.error?.reason || 'Payment failed'
      console.warn('[razorpay] payment failed:', reason)
    })
    instance.open()
  })
}
