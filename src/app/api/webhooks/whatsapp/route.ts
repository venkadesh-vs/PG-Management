import { createHmac, timingSafeEqual } from 'node:crypto'
import { logError } from '@/lib/logger'
import { NextResponse } from 'next/server'
import type { MessageStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { serverEnv } from '@/lib/env'
import { decryptJson } from '@/lib/crypto'
import {
  describeMetaError,
  normalisePhone,
  type OrgWhatsAppSecret,
} from '@/server/integrations/whatsapp'

/**
 * WhatsApp Business Cloud API webhook.
 *
 * GET  — Meta's one-time subscription check: echo hub.challenge when the
 *        verify token matches WHATSAPP_WEBHOOK_VERIFY_TOKEN.
 * POST — delivery receipts (sent / delivered / read / failed) and inbound
 *        messages, of which only STOP / START are acted on (opt-out).
 *
 * Every POST is authenticated with X-Hub-Signature-256: an HMAC-SHA256 of
 * the raw body keyed with the Meta App secret. The platform app's secret is
 * WHATSAPP_APP_SECRET; an organization that connected its own number under
 * its own Meta app can store that app's secret with the connection, and a
 * payload naming its phone number id is checked against it. Nothing is
 * written before a signature matches.
 */

type StatusUpdate = {
  id?: string
  status?: string
  timestamp?: string
  recipient_id?: string
  errors?: { code?: number; title?: string; message?: string; error_data?: { details?: string } }[]
}

type InboundMessage = {
  from?: string
  type?: string
  text?: { body?: string }
  button?: { text?: string; payload?: string }
}

type WebhookPayload = {
  object?: string
  entry?: {
    changes?: {
      field?: string
      value?: {
        metadata?: { phone_number_id?: string }
        statuses?: StatusUpdate[]
        messages?: InboundMessage[]
      }
    }[]
  }[]
}

export function GET(request: Request) {
  const url = new URL(request.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token') ?? ''
  const challenge = url.searchParams.get('hub.challenge') ?? ''
  const expected = serverEnv.whatsappWebhook.verifyToken

  if (mode === 'subscribe' && expected && safeEqual(token, expected)) {
    return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
  }
  return new Response('Forbidden', { status: 403 })
}

export async function POST(request: Request) {
  const raw = await request.text()
  const signature = request.headers.get('x-hub-signature-256') ?? ''

  let payload: WebhookPayload
  try {
    payload = JSON.parse(raw) as WebhookPayload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const scope = await verifySignature(raw, signature, payload)
  if (!scope) return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })

  // Meta retries anything that is not a quick 200, so processing errors are
  // logged, never returned.
  try {
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value
        if (!value) continue
        for (const status of value.statuses ?? []) await applyStatus(status, scope.restrictTo)
        for (const message of value.messages ?? []) {
          await applyInbound(message, scope.organizationIdFor(value.metadata?.phone_number_id))
        }
      }
    }
  } catch (error) {
    void logError('webhook.failed', error, { code: 'WEBHOOK_FAILED', provider: 'whatsapp', route: '/api/webhooks/whatsapp' })
  }
  return NextResponse.json({ received: true })
}

// --------------------------------------------------------------------------
// Signature
// --------------------------------------------------------------------------

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

function signatureMatches(raw: string, header: string, secret: string) {
  if (!secret || !header.startsWith('sha256=')) return false
  const expected = `sha256=${createHmac('sha256', secret).update(raw, 'utf8').digest('hex')}`
  return safeEqual(header, expected)
}

/**
 * Returns who the payload may affect, or null when no secret matches.
 * Platform-signed: inbound STOP/START applies to every organization's
 * residents with that number unless the receiving number is an org's own.
 * Org-signed: only that organization.
 */
async function verifySignature(raw: string, header: string, payload: WebhookPayload) {
  const phoneNumberIds = new Set<string>()
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const id = change.value?.metadata?.phone_number_id
      if (id) phoneNumberIds.add(id)
    }
  }
  const owned = phoneNumberIds.size
    ? await prisma.integrationCredential.findMany({
        where: { kind: 'WHATSAPP_META', publicId: { in: [...phoneNumberIds] } },
        select: { organizationId: true, publicId: true, secretCipher: true },
      })
    : []
  const orgByNumber = new Map(owned.map((c) => [c.publicId, c.organizationId]))
  const organizationIdFor = (id?: string) => (id ? (orgByNumber.get(id) ?? null) : null)

  if (signatureMatches(raw, header, serverEnv.whatsappWebhook.appSecret)) {
    return { organizationIdFor, restrictTo: null as string | null }
  }
  for (const credential of owned) {
    let appSecret = ''
    try {
      appSecret = decryptJson<OrgWhatsAppSecret>(credential.secretCipher).appSecret ?? ''
    } catch {
      continue
    }
    if (signatureMatches(raw, header, appSecret)) {
      // An org's app may only speak for its own number.
      return { organizationIdFor: () => credential.organizationId, restrictTo: credential.organizationId }
    }
  }
  return null
}

// --------------------------------------------------------------------------
// Delivery receipts
// --------------------------------------------------------------------------

/**
 * Statuses only move forward: QUEUED → SENT → DELIVERED → READ. A late
 * "delivered" never overwrites "read"; "failed" only lands on a message not
 * yet delivered.
 */
const CAN_BECOME: Record<'SENT' | 'DELIVERED' | 'READ' | 'FAILED', MessageStatus[]> = {
  SENT: ['QUEUED'],
  DELIVERED: ['QUEUED', 'SENT', 'FAILED'],
  READ: ['QUEUED', 'SENT', 'DELIVERED', 'FAILED'],
  FAILED: ['QUEUED', 'SENT'],
}

async function applyStatus(status: StatusUpdate, organizationId: string | null) {
  if (!status.id || !status.status) return
  const next = status.status.toUpperCase()
  if (!(next in CAN_BECOME)) return
  const target = next as keyof typeof CAN_BECOME
  const at = status.timestamp ? new Date(Number(status.timestamp) * 1000) : new Date()
  const when = Number.isNaN(at.getTime()) ? new Date() : at
  const where = {
    providerMessageId: status.id,
    channel: 'WHATSAPP' as const,
    ...(organizationId ? { organizationId } : {}),
  }

  if (target === 'SENT') {
    await prisma.outboundMessage.updateMany({
      where: { ...where, status: { in: CAN_BECOME.SENT } },
      data: { status: 'SENT', sentAt: when },
    })
  } else if (target === 'DELIVERED') {
    await prisma.outboundMessage.updateMany({
      where: { ...where, status: { in: CAN_BECOME.DELIVERED } },
      data: { status: 'DELIVERED', deliveredAt: when, error: null },
    })
  } else if (target === 'READ') {
    await prisma.outboundMessage.updateMany({
      where: { ...where, status: { in: CAN_BECOME.READ } },
      data: { status: 'READ', readAt: when, error: null },
    })
    // Read implies delivered; Meta does not always send both.
    await prisma.outboundMessage.updateMany({
      where: { ...where, deliveredAt: null },
      data: { deliveredAt: when },
    })
  } else {
    const first = status.errors?.[0]
    const error = first
      ? describeMetaError({
          code: first.code,
          message: first.title ?? first.message,
          error_data: first.error_data,
        })
      : 'WhatsApp error: delivery failed'
    await prisma.outboundMessage.updateMany({
      where: { ...where, status: { in: CAN_BECOME.FAILED } },
      data: { status: 'FAILED', error },
    })
  }
}

// --------------------------------------------------------------------------
// Inbound: STOP / START
// --------------------------------------------------------------------------

const STOP_WORDS = new Set(['STOP', 'UNSUBSCRIBE', 'STOP PROMOTIONS'])
const START_WORDS = new Set(['START', 'SUBSCRIBE', 'UNSTOP'])

async function applyInbound(message: InboundMessage, organizationId: string | null) {
  if (!message.from) return
  const text = (message.text?.body ?? message.button?.text ?? '').trim().toUpperCase()
  const stop = STOP_WORDS.has(text)
  const start = START_WORDS.has(text)
  if (!stop && !start) return

  const phone = normalisePhone(message.from)
  const last10 = phone.slice(-10)
  if (last10.length < 10) return

  const candidates = await prisma.resident.findMany({
    where: {
      ...(organizationId ? { organizationId } : {}),
      OR: [{ phone: { contains: last10 } }, { whatsappPhone: { contains: last10 } }],
    },
    select: { id: true, phone: true, whatsappPhone: true },
  })
  const ids = candidates
    .filter(
      (r) =>
        normalisePhone(r.phone) === phone || (r.whatsappPhone && normalisePhone(r.whatsappPhone) === phone),
    )
    .map((r) => r.id)
  if (!ids.length) return

  const now = new Date()
  await prisma.resident.updateMany({
    where: { id: { in: ids } },
    data: stop ? { whatsappOptOutAt: now } : { whatsappOptOutAt: null, whatsappConsentAt: now },
  })
}
