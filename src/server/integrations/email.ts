import 'server-only'

import { prisma } from '@/lib/prisma'
import { serverEnv } from '@/lib/env'

/**
 * Transactional email (invites, password resets, receipts).
 *
 *   demo   — nothing leaves the server; the message is stored in the outbox
 *            with status DEMO_NOT_SENT, exactly like WhatsApp demo mode.
 *   resend — sent through the Resend HTTP API (EMAIL_PROVIDER=resend,
 *            RESEND_API_KEY, EMAIL_FROM on a verified domain).
 */

export type EmailRequest = {
  organizationId: string | null
  to: string
  toName?: string
  subject: string
  /** Plain-text body; an HTML version is derived from it. */
  text: string
  template?: string
  refType?: string
  refId?: string
}

export type EmailResult = { id: string; delivered: boolean; demo: boolean }

export function emailMode(): 'demo' | 'resend' {
  return serverEnv.email.isLive ? 'resend' : 'demo'
}

export async function sendEmail(req: EmailRequest): Promise<EmailResult> {
  const live = serverEnv.email.isLive
  const record = await prisma.outboundMessage.create({
    data: {
      organizationId: req.organizationId,
      channel: 'EMAIL',
      provider: live ? 'resend' : 'demo',
      toName: req.toName,
      toAddress: req.to,
      template: req.template,
      subject: req.subject,
      body: req.text,
      status: live ? 'QUEUED' : 'DEMO_NOT_SENT',
      isDemo: !live,
      refType: req.refType,
      refId: req.refId,
      attempts: live ? 1 : 0,
      lastAttemptAt: live ? new Date() : null,
    },
  })
  if (!live) return { id: record.id, delivered: false, demo: true }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serverEnv.email.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: serverEnv.email.from,
        to: [req.to],
        subject: req.subject,
        text: req.text,
        html: toHtml(req.text),
      }),
    })
    const payload = (await res.json().catch(() => ({}))) as { id?: string; message?: string }
    if (!res.ok) throw new Error(payload.message ?? `Resend returned ${res.status}`)
    await prisma.outboundMessage.update({
      where: { id: record.id },
      data: { status: 'SENT', sentAt: new Date(), providerMessageId: payload.id ?? null },
    })
    return { id: record.id, delivered: true, demo: false }
  } catch (error) {
    await prisma.outboundMessage.update({
      where: { id: record.id },
      data: { status: 'FAILED', error: (error as Error).message.slice(0, 500) },
    })
    return { id: record.id, delivered: false, demo: false }
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

/** Minimal, client-safe HTML: paragraphs, and URLs turned into links. */
function toHtml(text: string) {
  const body = text
    .split(/\n{2,}/)
    .map((para) =>
      escapeHtml(para)
        .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#2563eb">$1</a>')
        .replace(/\n/g, '<br>'),
    )
    .map((p) => `<p style="margin:0 0 14px">${p}</p>`)
    .join('')
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.55;color:#0f172a;max-width:560px">${body}</div>`
}
