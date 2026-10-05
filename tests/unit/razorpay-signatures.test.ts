import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  fromPaise,
  toPaise,
  verifyCheckoutSignature,
  verifyWebhookSignature,
} from '@/server/integrations/razorpay'

const hmac = (secret: string, body: string) => createHmac('sha256', secret).update(body).digest('hex')

describe('verifyWebhookSignature', () => {
  const secret = 'whsec_test_123'
  const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1' } } } })

  it('accepts the HMAC-SHA256 of the raw body', () => {
    expect(verifyWebhookSignature(body, hmac(secret, body), secret)).toBe(true)
  })

  it('rejects a modified body, a wrong secret or a malformed signature', () => {
    expect(verifyWebhookSignature(body + ' ', hmac(secret, body), secret)).toBe(false)
    expect(verifyWebhookSignature(body, hmac('other', body), secret)).toBe(false)
    expect(verifyWebhookSignature(body, 'abc', secret)).toBe(false)
    expect(verifyWebhookSignature(body, hmac(secret, body).toUpperCase(), secret)).toBe(false)
  })

  it('rejects when the signature or secret is missing', () => {
    expect(verifyWebhookSignature(body, null, secret)).toBe(false)
    expect(verifyWebhookSignature(body, '', secret)).toBe(false)
    expect(verifyWebhookSignature(body, hmac('', body), '')).toBe(false)
    expect(verifyWebhookSignature(body, hmac(secret, body), undefined)).toBe(false)
  })
})

describe('verifyCheckoutSignature', () => {
  const keySecret = 'rzp_key_secret'
  const orderId = 'order_ABC'
  const paymentId = 'pay_XYZ'
  const good = hmac(keySecret, `${orderId}|${paymentId}`)

  it('accepts HMAC-SHA256(orderId|paymentId, keySecret)', () => {
    expect(verifyCheckoutSignature({ orderId, paymentId, signature: good, keySecret })).toBe(true)
  })

  it('rejects swapped ids, another order, or another secret', () => {
    expect(verifyCheckoutSignature({ orderId: paymentId, paymentId: orderId, signature: good, keySecret })).toBe(false)
    expect(verifyCheckoutSignature({ orderId: 'order_OTHER', paymentId, signature: good, keySecret })).toBe(false)
    expect(verifyCheckoutSignature({ orderId, paymentId, signature: good, keySecret: 'nope' })).toBe(false)
  })

  it('rejects an empty signature or secret', () => {
    expect(verifyCheckoutSignature({ orderId, paymentId, signature: '', keySecret })).toBe(false)
    expect(verifyCheckoutSignature({ orderId, paymentId, signature: hmac('', `${orderId}|${paymentId}`), keySecret: '' })).toBe(false)
  })
})

describe('paise conversion', () => {
  it('converts whole rupees both ways', () => {
    expect(toPaise(4500)).toBe(450000)
    expect(fromPaise(450000)).toBe(4500)
    expect(toPaise(19.99)).toBe(1999)
  })
})
