import 'server-only'

import type { NotificationChannel } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { integrationVerdict, type IntegrationSignals, type IntegrationVerdict } from '@/lib/integration-health'
import { paymentMode } from '@/server/integrations/payments'
import { whatsappMode } from '@/server/integrations/whatsapp'
import { emailMode } from '@/server/integrations/email'
import { storageProvider } from '@/server/storage'

/**
 * Per-provider health for Super Admin → System health, read from what is
 * already recorded: WebhookEvent (Razorpay, last 7 days), OutboundMessage
 * (WhatsApp, email) and UploadedFile (storage). Storage failures are not
 * stored in the database — they are in the logs as INTEGRATION_FAILED.
 */

export type IntegrationHealth = IntegrationSignals & {
  key: 'payment' | 'whatsapp' | 'email' | 'storage'
  name: string
  mode: string
  verdict: IntegrationVerdict
  lastError: string | null
  note: string
}

const WINDOW_DAYS = 7
const SENT_STATUSES = ['SENT', 'DELIVERED', 'READ'] as const

async function messageSignals(channel: NotificationChannel, since: Date) {
  const live = { channel, isDemo: false }
  const [lastSuccess, lastFailure, successes, failures] = await Promise.all([
    prisma.outboundMessage.findFirst({
      where: { ...live, status: { in: [...SENT_STATUSES] } },
      orderBy: { createdAt: 'desc' },
      select: { sentAt: true, createdAt: true },
    }),
    prisma.outboundMessage.findFirst({
      where: { ...live, status: 'FAILED' },
      orderBy: { createdAt: 'desc' },
      select: { lastAttemptAt: true, createdAt: true, error: true },
    }),
    prisma.outboundMessage.count({ where: { ...live, status: { in: [...SENT_STATUSES] }, createdAt: { gte: since } } }),
    prisma.outboundMessage.count({ where: { ...live, status: 'FAILED', createdAt: { gte: since } } }),
  ])
  return {
    lastSuccessAt: lastSuccess ? (lastSuccess.sentAt ?? lastSuccess.createdAt) : null,
    lastFailureAt: lastFailure ? (lastFailure.lastAttemptAt ?? lastFailure.createdAt) : null,
    lastError: lastFailure?.error ?? null,
    successes,
    failures,
  }
}

export async function integrationHealth(now = new Date()): Promise<IntegrationHealth[]> {
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000)

  const [ownRazorpay, ownWhatsApp, whatsapp, email, payOk, payFail, payOkCount, payFailCount, lastUpload, uploads] =
    await Promise.all([
      prisma.integrationCredential.count({ where: { kind: 'RAZORPAY', active: true } }),
      prisma.integrationCredential.count({ where: { kind: 'WHATSAPP_META', active: true } }),
      messageSignals('WHATSAPP', since),
      messageSignals('EMAIL', since),
      prisma.webhookEvent.findFirst({
        where: { provider: 'razorpay', status: 'PROCESSED' },
        orderBy: { receivedAt: 'desc' },
        select: { receivedAt: true, processedAt: true },
      }),
      prisma.webhookEvent.findFirst({
        where: { provider: 'razorpay', status: 'FAILED' },
        orderBy: { receivedAt: 'desc' },
        select: { receivedAt: true, error: true },
      }),
      prisma.webhookEvent.count({ where: { provider: 'razorpay', status: 'PROCESSED', receivedAt: { gte: since } } }),
      prisma.webhookEvent.count({ where: { provider: 'razorpay', status: 'FAILED', receivedAt: { gte: since } } }),
      prisma.uploadedFile.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      prisma.uploadedFile.count({ where: { createdAt: { gte: since } } }),
    ])

  const rows: Omit<IntegrationHealth, 'verdict'>[] = [
    {
      key: 'payment',
      name: 'Payments (Razorpay)',
      mode: paymentMode() === 'live' ? 'Live keys' : 'Demo',
      live: paymentMode() === 'live',
      ownConnections: ownRazorpay,
      lastSuccessAt: payOk ? (payOk.processedAt ?? payOk.receivedAt) : null,
      lastFailureAt: payFail?.receivedAt ?? null,
      lastError: payFail?.error ?? null,
      successes: payOkCount,
      failures: payFailCount,
      note: 'From Razorpay webhooks (signed, idempotent). Failed events are replayed nightly.',
    },
    {
      key: 'whatsapp',
      name: 'WhatsApp',
      mode: whatsappMode() === 'meta' ? 'Meta Cloud API' : 'Demo',
      live: whatsappMode() === 'meta',
      ownConnections: ownWhatsApp,
      ...whatsapp,
      note: 'Live messages only. Failed sends are retried by the daily run.',
    },
    {
      key: 'email',
      name: 'Email',
      mode: emailMode() === 'resend' ? 'Resend' : 'Demo (outbox)',
      live: emailMode() !== 'demo',
      ...email,
      note: 'Live emails only.',
    },
    {
      key: 'storage',
      name: 'File storage',
      mode: storageProvider() === 's3' ? 'S3 / R2' : 'Local disk',
      live: storageProvider() === 's3',
      lastSuccessAt: lastUpload?.createdAt ?? null,
      lastFailureAt: null,
      lastError: null,
      successes: uploads,
      failures: 0,
      note: 'Upload failures are not stored; search the logs for INTEGRATION_FAILED.',
    },
  ]
  return rows.map((r) => ({ ...r, verdict: integrationVerdict(r) }))
}
