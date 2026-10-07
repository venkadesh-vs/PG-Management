import { createHash } from 'node:crypto'

/**
 * The idempotency key for an inbound webhook: the provider's own event id
 * (Razorpay sends it as the `x-razorpay-event-id` header; some payloads carry
 * an `id`), else a SHA-256 of the raw body so an identical redelivery is
 * still recognised.
 */
export function webhookEventKey(params: {
  headerId?: string | null
  rawBody: string
  parsed?: { id?: unknown } | null
}): string {
  const header = params.headerId?.trim()
  if (header) return header.slice(0, 200)
  const bodyId = params.parsed && typeof params.parsed.id === 'string' ? params.parsed.id.trim() : ''
  if (bodyId) return bodyId.slice(0, 200)
  return `sha256:${createHash('sha256').update(params.rawBody).digest('hex')}`
}
