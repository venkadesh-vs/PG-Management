import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { webhookEventKey } from '@/lib/webhook-key'
import { logError } from '@/lib/logger'

export { webhookEventKey }

/**
 * Inbound webhook log. Every delivery is recorded BEFORE it is processed;
 * the unique (provider, eventId) makes a redelivery harmless: an event that
 * was already PROCESSED or IGNORED is acknowledged without running again. A
 * FAILED (or stuck RECEIVED) event is processed again on redelivery, with
 * its attempt count bumped.
 */

export type WebhookClaim =
  | { duplicate: true; id: string; status: string }
  | { duplicate: false; id: string }

function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002'
}

export async function claimWebhook(params: {
  provider: string
  eventId: string
  type: string
  payload: unknown
}): Promise<WebhookClaim> {
  const where = { provider_eventId: { provider: params.provider, eventId: params.eventId } }
  try {
    const row = await prisma.webhookEvent.create({
      data: {
        provider: params.provider,
        eventId: params.eventId,
        type: params.type.slice(0, 120) || 'unknown',
        payload: (params.payload ?? {}) as Prisma.InputJsonValue,
      },
      select: { id: true },
    })
    return { duplicate: false, id: row.id }
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
  }

  const existing = await prisma.webhookEvent.findUnique({ where, select: { id: true, status: true } })
  if (!existing) throw new Error('webhook row vanished')
  if (existing.status === 'PROCESSED' || existing.status === 'IGNORED') {
    return { duplicate: true, id: existing.id, status: existing.status }
  }
  // FAILED earlier (or a crash mid-way): claim it again, but only once even
  // when two redeliveries race.
  const reclaimed = await prisma.webhookEvent.updateMany({
    where: { id: existing.id, status: existing.status },
    data: { attempts: { increment: 1 }, status: 'RECEIVED', error: null },
  })
  if (reclaimed.count !== 1) return { duplicate: true, id: existing.id, status: 'RECEIVED' }
  return { duplicate: false, id: existing.id }
}

export async function finishWebhook(
  id: string,
  outcome: { status: 'PROCESSED' | 'IGNORED' | 'FAILED'; error?: string | null },
) {
  await prisma.webhookEvent
    .update({
      where: { id },
      data: {
        status: outcome.status,
        error: outcome.error ? outcome.error.slice(0, 2000) : null,
        processedAt: new Date(),
      },
    })
    .catch((error) => console.error('[webhook-log] could not update', id, error))
}

/** FAILED events still worth another go (for the nightly replay). */
export async function failedWebhooks(provider: string, maxAttempts = 5, take = 50) {
  return prisma.webhookEvent.findMany({
    where: { provider, status: 'FAILED', attempts: { lt: maxAttempts } },
    orderBy: { receivedAt: 'asc' },
    take,
  })
}

/** Marks a FAILED event as being retried (returns false if someone else took it). */
export async function reclaimFailedWebhook(id: string) {
  const res = await prisma.webhookEvent.updateMany({
    where: { id, status: 'FAILED' },
    data: { attempts: { increment: 1 }, status: 'RECEIVED' },
  })
  return res.count === 1
}

export type LoggedOutcome =
  | { duplicate: true; status: string }
  | { duplicate: false; status: 'PROCESSED' | 'IGNORED' | 'FAILED'; handled: boolean; note: string }

/**
 * Records the event, runs `handler` once, and stores how it went:
 * handled → PROCESSED, not handled (unknown/irrelevant event) → IGNORED,
 * thrown → FAILED with the error. Never throws for a handler failure, so
 * the route can still answer 200 and Razorpay does not hammer us; the
 * stored payload lets the nightly job replay it.
 */
export async function runLoggedWebhook(params: {
  provider: string
  eventId: string
  type: string
  payload: unknown
  handler: () => Promise<{ handled: boolean; note: string }>
}): Promise<LoggedOutcome> {
  const claim = await claimWebhook(params)
  if (claim.duplicate) return { duplicate: true, status: claim.status }
  try {
    const result = await params.handler()
    const status = result.handled ? 'PROCESSED' : 'IGNORED'
    await finishWebhook(claim.id, { status, error: result.handled ? null : result.note })
    return { duplicate: false, status, ...result }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    void logError('webhook.failed', error, {
      code: 'WEBHOOK_FAILED',
      provider: params.provider,
      webhookType: params.type,
      eventId: params.eventId,
    })
    await finishWebhook(claim.id, { status: 'FAILED', error: message })
    return { duplicate: false, status: 'FAILED', handled: false, note: 'processing failed; logged for retry' }
  }
}
