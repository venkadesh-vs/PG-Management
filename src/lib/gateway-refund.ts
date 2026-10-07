/**
 * Decides what StayFlow does when Razorpay reports a refund on a rent payment.
 * Pure, so it can be unit tested; the webhook applies the decision.
 *
 * The gateway's running total (`gatewayRefunded`) is authoritative. Only the
 * part not yet reflected in StayFlow (`gatewayRefunded - alreadyRefunded`) is
 * applied, so a repeated or out-of-order event is a no-op.
 */

export type GatewayRefundInput = {
  /** Payment amount in rupees. */
  paymentAmount: number
  /** Rupees StayFlow already shows as refunded on this payment. */
  alreadyRefunded: number
  /** Rupees Razorpay reports as refunded in total (amount_refunded). */
  gatewayRefunded: number
  /** Rupees of the payment not applied to any invoice. */
  unallocated: number
  status: 'SUCCESS' | 'REFUNDED' | 'REVERSED' | string
}

export type GatewayRefundPlan =
  | { action: 'none'; reason: string }
  /** Refund `amount` from the unapplied part of the payment. */
  | { action: 'refund'; amount: number }
  /** The whole payment went back: reverse it, which reopens its invoices. */
  | { action: 'reverse' }
  /** Money applied to invoices was refunded: the owner must decide (credit note or reversal). */
  | { action: 'review'; amount: number }

export function planGatewayRefund(input: GatewayRefundInput): GatewayRefundPlan {
  if (input.status === 'REVERSED') return { action: 'none', reason: 'payment already reversed' }
  const gatewayRefunded = Math.min(Math.max(0, Math.round(input.gatewayRefunded)), input.paymentAmount)
  const delta = gatewayRefunded - input.alreadyRefunded
  if (delta <= 0) return { action: 'none', reason: 'refund already recorded' }
  if (delta <= input.unallocated) return { action: 'refund', amount: delta }
  if (input.alreadyRefunded === 0 && gatewayRefunded >= input.paymentAmount) return { action: 'reverse' }
  return { action: 'review', amount: delta }
}
