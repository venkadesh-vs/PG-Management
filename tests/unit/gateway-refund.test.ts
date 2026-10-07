import { describe, expect, it } from 'vitest'
import { planGatewayRefund } from '@/lib/gateway-refund'

const base = { paymentAmount: 10000, alreadyRefunded: 0, gatewayRefunded: 0, unallocated: 0, status: 'SUCCESS' }

describe('planGatewayRefund', () => {
  it('does nothing when the refund is already reflected', () => {
    expect(planGatewayRefund({ ...base, alreadyRefunded: 2000, gatewayRefunded: 2000, unallocated: 3000 })).toEqual({
      action: 'none',
      reason: 'refund already recorded',
    })
  })

  it('does nothing for a reversed payment', () => {
    expect(planGatewayRefund({ ...base, gatewayRefunded: 10000, status: 'REVERSED' }).action).toBe('none')
  })

  it('refunds from the unapplied part', () => {
    expect(planGatewayRefund({ ...base, gatewayRefunded: 1500, unallocated: 2000 })).toEqual({ action: 'refund', amount: 1500 })
  })

  it('applies only the new part of a second partial refund', () => {
    expect(planGatewayRefund({ ...base, alreadyRefunded: 1000, gatewayRefunded: 2500, unallocated: 2000 })).toEqual({
      action: 'refund',
      amount: 1500,
    })
  })

  it('reverses a full refund of an applied payment', () => {
    expect(planGatewayRefund({ ...base, gatewayRefunded: 10000, unallocated: 0 })).toEqual({ action: 'reverse' })
  })

  it('refunds rather than reverses when the whole payment is unapplied', () => {
    expect(planGatewayRefund({ ...base, gatewayRefunded: 10000, unallocated: 10000 })).toEqual({ action: 'refund', amount: 10000 })
  })

  it('asks for review when applied money is partly refunded', () => {
    expect(planGatewayRefund({ ...base, gatewayRefunded: 4000, unallocated: 1000 })).toEqual({ action: 'review', amount: 4000 })
  })

  it('asks for review on a full refund after an earlier partial one', () => {
    expect(planGatewayRefund({ ...base, alreadyRefunded: 1000, gatewayRefunded: 10000, unallocated: 0 })).toEqual({
      action: 'review',
      amount: 9000,
    })
  })

  it('caps the gateway total at the payment amount', () => {
    expect(planGatewayRefund({ ...base, gatewayRefunded: 99999, unallocated: 10000 })).toEqual({ action: 'refund', amount: 10000 })
  })
})
