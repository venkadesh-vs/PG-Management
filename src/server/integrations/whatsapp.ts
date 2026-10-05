import 'server-only'

import { prisma } from '@/lib/prisma'
import { serverEnv } from '@/lib/env'
import type { MessageStatus } from '@prisma/client'

/**
 * WhatsApp Business delivery.
 *
 * Two modes, never blurred:
 *   demo — nothing leaves this server. The message is stored with status
 *          DEMO_NOT_SENT and surfaced in the in-app WhatsApp simulator so a
 *          PG owner can see exactly what a resident would receive. It is
 *          never reported as delivered.
 *   meta — a real WhatsApp Business Cloud API call using an approved template.
 *          Only reachable when WHATSAPP_PHONE_NUMBER_ID and
 *          WHATSAPP_ACCESS_TOKEN are both configured.
 */

export type WhatsAppTemplate =
  | 'rent_reminder_upcoming'
  | 'rent_reminder_due_today'
  | 'rent_reminder_overdue'
  | 'payment_receipt'
  | 'complaint_update'
  | 'announcement'
  | 'welcome_resident'
  | 'checkout_settlement'

export type WhatsAppRequest = {
  organizationId: string | null
  toName: string
  toPhone: string
  template: WhatsAppTemplate
  /** Pre-rendered human-readable body, also used verbatim in demo mode. */
  body: string
  /** Ordered variables for the approved template in live mode. */
  variables?: string[]
  refType?: string
  refId?: string
}

export type WhatsAppResult = {
  id: string
  status: MessageStatus
  delivered: boolean
  demo: boolean
}

export function whatsappMode(): 'demo' | 'meta' {
  return serverEnv.whatsapp.isLive ? 'meta' : 'demo'
}

export async function sendWhatsApp(req: WhatsAppRequest): Promise<WhatsAppResult> {
  const live = serverEnv.whatsapp.isLive
  const phone = normalisePhone(req.toPhone)

  const record = await prisma.outboundMessage.create({
    data: {
      organizationId: req.organizationId,
      channel: 'WHATSAPP',
      provider: live ? 'meta' : 'demo',
      toName: req.toName,
      toAddress: phone,
      template: req.template,
      body: req.body,
      status: live ? 'QUEUED' : 'DEMO_NOT_SENT',
      isDemo: !live,
      refType: req.refType,
      refId: req.refId,
    },
  })

  if (!live) {
    // Demo mode stops here — deliberately. Nothing is sent, and the stored
    // status says so.
    return { id: record.id, status: 'DEMO_NOT_SENT', delivered: false, demo: true }
  }

  try {
    const res = await fetch(
      `https://graph.facebook.com/${serverEnv.whatsapp.apiVersion}/${serverEnv.whatsapp.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${serverEnv.whatsapp.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: phone,
          type: 'template',
          template: {
            name: req.template,
            language: { code: 'en' },
            components: req.variables?.length
              ? [
                  {
                    type: 'body',
                    parameters: req.variables.map((text) => ({ type: 'text', text })),
                  },
                ]
              : undefined,
          },
        }),
      },
    )

    const payload = (await res.json().catch(() => ({}))) as {
      messages?: { id: string }[]
      error?: { message?: string }
    }

    if (!res.ok) {
      const message = payload.error?.message ?? `WhatsApp API returned ${res.status}`
      await prisma.outboundMessage.update({
        where: { id: record.id },
        data: { status: 'FAILED', error: message },
      })
      return { id: record.id, status: 'FAILED', delivered: false, demo: false }
    }

    await prisma.outboundMessage.update({
      where: { id: record.id },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        providerMessageId: payload.messages?.[0]?.id ?? null,
      },
    })
    return { id: record.id, status: 'SENT', delivered: true, demo: false }
  } catch (error) {
    await prisma.outboundMessage.update({
      where: { id: record.id },
      data: { status: 'FAILED', error: (error as Error).message },
    })
    return { id: record.id, status: 'FAILED', delivered: false, demo: false }
  }
}

/** India-first: bare 10-digit numbers get the 91 country code. */
export function normalisePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `91${digits}`
  if (digits.length === 12 && digits.startsWith('91')) return digits
  if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`
  return digits
}

/** Builds a `upi://pay` deep link a resident can tap to pay rent. */
export function buildUpiLink(params: {
  upiId: string
  payeeName: string
  amount: number
  note: string
}): string {
  const q = new URLSearchParams({
    pa: params.upiId,
    pn: params.payeeName,
    am: String(params.amount),
    cu: 'INR',
    tn: params.note,
  })
  return `upi://pay?${q.toString()}`
}
