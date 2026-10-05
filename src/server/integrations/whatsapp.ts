import 'server-only'

import { prisma } from '@/lib/prisma'
import { serverEnv } from '@/lib/env'
import { decryptJson } from '@/lib/crypto'
import type { MessageStatus, OutboundMessage, Prisma } from '@prisma/client'
import {
  getTemplate,
  prepareVariables,
  type WhatsAppTemplateDef,
  type WhatsAppTemplateName,
} from './whatsapp-templates'

/**
 * WhatsApp Business delivery.
 *
 * Three channels, resolved per message, never blurred:
 *   own      — the organization connected its own WhatsApp Business number
 *              (IntegrationCredential WHATSAPP_META). Takes precedence.
 *   platform — StayFlow's one WhatsApp Business number, from
 *              WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN.
 *   demo     — nothing leaves this server. The message is stored with status
 *              DEMO_NOT_SENT and surfaced in the in-app outbox so a PG owner
 *              can see exactly what a resident would receive. It is never
 *              reported as delivered.
 *
 * Live sends use an approved template from whatsapp-templates.ts. Variables
 * are sanitised and counted before Meta is called, stored on the row so a
 * failed send can be retried exactly, and delivery receipts arrive later
 * through /api/webhooks/whatsapp.
 */

export type WhatsAppTemplate = WhatsAppTemplateName

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

/** 'disabled' — the organization switched the WhatsApp module off; nothing was stored or sent. */
export type WhatsAppOutcome = 'sent' | 'demo' | 'failed' | 'opted_out' | 'invalid' | 'disabled'

export type WhatsAppResult = {
  id: string
  status: MessageStatus
  delivered: boolean
  demo: boolean
  outcome?: WhatsAppOutcome
  error?: string
}

/** Error text prefixes. Rows failing with these are never retried automatically. */
export const OPT_OUT_ERROR = 'Recipient opted out'
export const INVALID_PREFIX = 'Not sent:'
export const REJECTED_PREFIX = 'Rejected by WhatsApp:'

export const MAX_ATTEMPTS = 3

// --------------------------------------------------------------------------
// Channel (credentials) resolution
// --------------------------------------------------------------------------

export type WhatsAppChannel =
  | { mode: 'demo' }
  | {
      mode: 'platform' | 'own'
      phoneNumberId: string
      accessToken: string
      apiVersion: string
    }

/** Decrypted contents of an org's WHATSAPP_META credential. */
export type OrgWhatsAppSecret = {
  accessToken: string
  wabaId?: string
  appSecret?: string
  displayPhoneNumber?: string
  verifiedName?: string
}

/** Platform-level mode, for the super-admin settings page. */
export function whatsappMode(): 'demo' | 'meta' {
  return serverEnv.whatsapp.isLive ? 'meta' : 'demo'
}

/**
 * The org's own active number, else the platform number, else demo. A
 * credential that cannot be decrypted (missing DATA_ENCRYPTION_KEY) falls
 * back rather than blocking every message.
 */
export async function resolveWhatsAppChannel(organizationId: string | null): Promise<WhatsAppChannel> {
  if (organizationId) {
    const credential = await prisma.integrationCredential.findUnique({
      where: { organizationId_kind: { organizationId, kind: 'WHATSAPP_META' } },
    })
    if (credential?.active) {
      try {
        const secret = decryptJson<OrgWhatsAppSecret>(credential.secretCipher)
        if (secret.accessToken && credential.publicId) {
          return {
            mode: 'own',
            phoneNumberId: credential.publicId,
            accessToken: secret.accessToken,
            apiVersion: serverEnv.whatsapp.apiVersion,
          }
        }
      } catch (error) {
        console.error('[whatsapp] could not read org credential, falling back', {
          organizationId,
          error: (error as Error).message,
        })
      }
    }
  }
  if (serverEnv.whatsapp.isLive) {
    return {
      mode: 'platform',
      phoneNumberId: serverEnv.whatsapp.phoneNumberId,
      accessToken: serverEnv.whatsapp.accessToken,
      apiVersion: serverEnv.whatsapp.apiVersion,
    }
  }
  return { mode: 'demo' }
}

export type WhatsAppConnection = {
  /** Which number the org's messages go out from right now. */
  mode: 'demo' | 'platform' | 'own'
  platformLive: boolean
  own: {
    phoneNumberId: string
    displayPhoneNumber: string | null
    verifiedName: string | null
    wabaId: string | null
    hasAppSecret: boolean
    active: boolean
    verifiedAt: string | null
    lastError: string | null
    /** False when the stored secret cannot be decrypted (key changed). */
    readable: boolean
  } | null
}

/** For the settings UI: never includes the access token. */
export async function getWhatsAppConnection(organizationId: string): Promise<WhatsAppConnection> {
  const credential = await prisma.integrationCredential.findUnique({
    where: { organizationId_kind: { organizationId, kind: 'WHATSAPP_META' } },
  })
  let secret: OrgWhatsAppSecret | null = null
  if (credential) {
    try {
      secret = decryptJson<OrgWhatsAppSecret>(credential.secretCipher)
    } catch {
      secret = null
    }
  }
  const channel = await resolveWhatsAppChannel(organizationId)
  return {
    mode: channel.mode,
    platformLive: serverEnv.whatsapp.isLive,
    own: credential
      ? {
          phoneNumberId: credential.publicId,
          displayPhoneNumber: secret?.displayPhoneNumber || null,
          verifiedName: secret?.verifiedName || null,
          wabaId: secret?.wabaId || null,
          hasAppSecret: Boolean(secret?.appSecret),
          active: credential.active,
          verifiedAt: credential.verifiedAt?.toISOString() ?? null,
          lastError: credential.lastError,
          readable: Boolean(secret),
        }
      : null,
  }
}

function providerFor(channel: WhatsAppChannel) {
  return channel.mode === 'demo' ? 'demo' : channel.mode === 'own' ? 'meta:org' : 'meta'
}

// --------------------------------------------------------------------------
// Opt-out
// --------------------------------------------------------------------------

/** True when a resident of this org with this number replied STOP. */
export async function isOptedOut(organizationId: string | null, phone: string): Promise<boolean> {
  if (!organizationId) return false
  const last10 = phone.slice(-10)
  if (last10.length < 10) return false
  const candidates = await prisma.resident.findMany({
    where: {
      organizationId,
      whatsappOptOutAt: { not: null },
      OR: [{ phone: { contains: last10 } }, { whatsappPhone: { contains: last10 } }],
    },
    select: { phone: true, whatsappPhone: true },
  })
  return candidates.some(
    (r) => normalisePhone(r.phone) === phone || (r.whatsappPhone && normalisePhone(r.whatsappPhone) === phone),
  )
}

// --------------------------------------------------------------------------
// Validation
// --------------------------------------------------------------------------

type Checked = { ok: true; def: WhatsAppTemplateDef; variables: string[] } | { ok: false; error: string }

function checkRequest(template: string, phone: string, raw: unknown[] | undefined): Checked {
  const def = getTemplate(template)
  if (!def) return { ok: false, error: `${INVALID_PREFIX} unknown template "${template}"` }
  const given = raw ?? []
  if (given.length !== def.variables.length) {
    return {
      ok: false,
      error: `${INVALID_PREFIX} template "${template}" needs ${def.variables.length} variables (${def.variables.join(', ')}), got ${given.length}`,
    }
  }
  if (phone.length < 10 || phone.length > 15) {
    return { ok: false, error: `${INVALID_PREFIX} invalid phone number` }
  }
  return { ok: true, def, variables: prepareVariables(def, given) }
}

// --------------------------------------------------------------------------
// Module switch
// --------------------------------------------------------------------------

/** Login links still go out with WhatsApp switched off: people must be able to sign in. */
const LOGIN_CRITICAL_TEMPLATES = new Set<string>(['account_invite', 'password_reset'])

export const WHATSAPP_DISABLED_ERROR = 'WhatsApp is switched off for this PG'

/** True when the organization has the WhatsApp module switched off (Settings → Features). */
export async function isWhatsAppDisabled(organizationId: string | null): Promise<boolean> {
  if (!organizationId) return false
  const settings = await prisma.orgSetting.findUnique({
    where: { organizationId },
    select: { disabledModules: true },
  })
  return settings?.disabledModules.includes('whatsapp') ?? false
}

function disabledResult(): WhatsAppResult {
  return { id: '', status: 'FAILED', delivered: false, demo: false, outcome: 'disabled', error: WHATSAPP_DISABLED_ERROR }
}

// --------------------------------------------------------------------------
// Send
// --------------------------------------------------------------------------

export async function sendWhatsApp(req: WhatsAppRequest): Promise<WhatsAppResult> {
  // Module off: no Meta call and no outbox row (login links excepted).
  if (!LOGIN_CRITICAL_TEMPLATES.has(req.template) && (await isWhatsAppDisabled(req.organizationId))) {
    return disabledResult()
  }
  const phone = normalisePhone(req.toPhone)
  const channel = await resolveWhatsAppChannel(req.organizationId)
  const live = channel.mode !== 'demo'
  const checked = checkRequest(req.template, phone, req.variables)

  const base = {
    organizationId: req.organizationId,
    channel: 'WHATSAPP' as const,
    provider: providerFor(channel),
    toName: req.toName,
    toAddress: phone,
    template: req.template,
    body: req.body,
    isDemo: !live,
    refType: req.refType,
    refId: req.refId,
    variables: (checked.ok ? checked.variables : (req.variables ?? [])) as Prisma.InputJsonValue,
  }

  if (!live) {
    // Demo mode stops here — deliberately. Nothing is sent, and the stored
    // status says so. A template mistake is still worth knowing before
    // going live.
    if (!checked.ok) console.warn('[whatsapp] demo message would be rejected live:', checked.error)
    const record = await prisma.outboundMessage.create({ data: { ...base, status: 'DEMO_NOT_SENT' } })
    return { id: record.id, status: 'DEMO_NOT_SENT', delivered: false, demo: true, outcome: 'demo' }
  }

  if (!checked.ok) {
    const record = await prisma.outboundMessage.create({
      data: { ...base, status: 'FAILED', error: checked.error },
    })
    return { id: record.id, status: 'FAILED', delivered: false, demo: false, outcome: 'invalid', error: checked.error }
  }

  if (!checked.def.bypassOptOut && (await isOptedOut(req.organizationId, phone))) {
    const record = await prisma.outboundMessage.create({
      data: { ...base, status: 'FAILED', error: OPT_OUT_ERROR },
    })
    return { id: record.id, status: 'FAILED', delivered: false, demo: false, outcome: 'opted_out', error: OPT_OUT_ERROR }
  }

  const record = await prisma.outboundMessage.create({ data: { ...base, status: 'QUEUED' } })
  return deliver(record.id, channel, req.template, checked.def, phone, checked.variables)
}

type MetaError = {
  message?: string
  code?: number
  error_subcode?: number
  error_user_title?: string
  error_user_msg?: string
  error_data?: { details?: string }
}

/**
 * Meta error codes that will fail the same way however often we retry:
 * template / parameter problems, unsupported or invalid recipient, user
 * blocked marketing. Auth (190) and rate limits are left retryable — the
 * owner can fix a token and the retry then goes through.
 */
const PERMANENT_CODES = new Set([
  100, 131008, 131009, 131021, 131026, 131050, 131051, 132000, 132001, 132005, 132007, 132012, 132015,
  132016, 132068, 132069,
])

export function describeMetaError(error: MetaError | undefined, status?: number): string {
  const code = error?.code
  const text =
    error?.error_data?.details || error?.error_user_msg || error?.message || `WhatsApp API returned ${status ?? 'an error'}`
  const prefix = code && PERMANENT_CODES.has(code) ? REJECTED_PREFIX : 'WhatsApp error:'
  return `${prefix} ${text}${code ? ` (#${code})` : ''}`.slice(0, 500)
}

/** One delivery attempt for an existing QUEUED row. */
async function deliver(
  id: string,
  channel: Extract<WhatsAppChannel, { mode: 'platform' | 'own' }>,
  template: string,
  def: WhatsAppTemplateDef,
  phone: string,
  variables: string[],
): Promise<WhatsAppResult> {
  const attemptAt = new Date()
  const fail = async (error: string): Promise<WhatsAppResult> => {
    await prisma.outboundMessage.update({
      where: { id },
      data: { status: 'FAILED', error, attempts: { increment: 1 }, lastAttemptAt: attemptAt },
    })
    return { id, status: 'FAILED', delivered: false, demo: false, outcome: 'failed', error }
  }

  try {
    const res = await fetch(
      `https://graph.facebook.com/${channel.apiVersion}/${channel.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${channel.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: phone,
          type: 'template',
          template: {
            name: template,
            language: { code: def.language },
            components: variables.length
              ? [
                  {
                    type: 'body',
                    parameters: variables.map((text) => ({ type: 'text', text })),
                  },
                ]
              : undefined,
          },
        }),
        signal: AbortSignal.timeout(15000),
      },
    )

    const payload = (await res.json().catch(() => ({}))) as {
      messages?: { id: string }[]
      error?: MetaError
    }

    if (!res.ok) return fail(describeMetaError(payload.error, res.status))

    await prisma.outboundMessage.update({
      where: { id },
      data: {
        status: 'SENT',
        error: null,
        sentAt: attemptAt,
        providerMessageId: payload.messages?.[0]?.id ?? null,
        attempts: { increment: 1 },
        lastAttemptAt: attemptAt,
      },
    })
    return { id, status: 'SENT', delivered: true, demo: false, outcome: 'sent' }
  } catch (error) {
    return fail(`WhatsApp error: ${(error as Error).message}`.slice(0, 500))
  }
}

// --------------------------------------------------------------------------
// Retries
// --------------------------------------------------------------------------

/**
 * Resends one FAILED message with its stored variables. Re-checks the
 * template and the opt-out, and re-resolves the channel (the org may have
 * connected or fixed its number since). The row is claimed first, so two
 * overlapping retries never double-send.
 */
export async function retryWhatsAppMessage(message: OutboundMessage): Promise<WhatsAppResult> {
  const base = { id: message.id, delivered: false }
  if (message.channel !== 'WHATSAPP' || message.status !== 'FAILED' || !message.template) {
    return { ...base, status: message.status, demo: message.isDemo, outcome: 'invalid', error: 'Only failed WhatsApp messages can be retried' }
  }
  const variables = Array.isArray(message.variables) ? (message.variables as unknown[]).map(String) : null
  if (!variables) {
    return { ...base, status: 'FAILED', demo: false, outcome: 'invalid', error: 'This message has no stored variables to resend' }
  }

  if (!LOGIN_CRITICAL_TEMPLATES.has(message.template) && (await isWhatsAppDisabled(message.organizationId))) {
    return { ...disabledResult(), id: message.id }
  }

  const channel = await resolveWhatsAppChannel(message.organizationId)
  if (channel.mode === 'demo') {
    return { ...base, status: 'FAILED', demo: true, outcome: 'demo', error: 'WhatsApp is not connected, so nothing can be sent' }
  }

  const checked = checkRequest(message.template, message.toAddress, variables)
  if (!checked.ok) {
    await prisma.outboundMessage.update({ where: { id: message.id }, data: { error: checked.error } })
    return { ...base, status: 'FAILED', demo: false, outcome: 'invalid', error: checked.error }
  }
  if (!checked.def.bypassOptOut && (await isOptedOut(message.organizationId, message.toAddress))) {
    await prisma.outboundMessage.update({ where: { id: message.id }, data: { error: OPT_OUT_ERROR } })
    return { ...base, status: 'FAILED', demo: false, outcome: 'opted_out', error: OPT_OUT_ERROR }
  }

  const claim = await prisma.outboundMessage.updateMany({
    where: { id: message.id, status: 'FAILED', attempts: message.attempts },
    data: { status: 'QUEUED', provider: providerFor(channel), isDemo: false },
  })
  if (claim.count !== 1) {
    return { ...base, status: 'QUEUED', demo: false, outcome: 'invalid', error: 'This message is already being retried' }
  }
  return deliver(message.id, channel, message.template, checked.def, message.toAddress, checked.variables)
}

/**
 * Automatic retry pass (daily automation): FAILED live messages that failed
 * transiently, with fewer than MAX_ATTEMPTS attempts, last tried more than
 * 30 minutes ago. Opt-outs and validation failures have zero attempts and
 * Meta's permanent rejections are marked, so neither is picked up.
 */
export async function retryFailedWhatsApp(options?: {
  organizationId?: string
  now?: Date
  batchSize?: number
}): Promise<{ retried: number; sent: number; failed: number }> {
  const now = options?.now ?? new Date()
  // Organizations with WhatsApp switched off keep their failed rows as they are.
  const off = (
    await prisma.orgSetting.findMany({
      where: { disabledModules: { has: 'whatsapp' } },
      select: { organizationId: true },
    })
  ).map((s) => s.organizationId)
  const candidates = await prisma.outboundMessage.findMany({
    where: {
      ...(off.length ? { OR: [{ organizationId: null }, { organizationId: { notIn: off } }] } : {}),
      channel: 'WHATSAPP',
      status: 'FAILED',
      isDemo: false,
      attempts: { gte: 1, lt: MAX_ATTEMPTS },
      lastAttemptAt: { lt: new Date(now.getTime() - 30 * 60 * 1000) },
      // Retries are for recent messages; a week-old reminder is stale.
      createdAt: { gte: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000) },
      NOT: [
        { error: { startsWith: OPT_OUT_ERROR } },
        { error: { startsWith: INVALID_PREFIX } },
        { error: { startsWith: REJECTED_PREFIX } },
      ],
      ...(options?.organizationId ? { organizationId: options.organizationId } : {}),
    },
    orderBy: { lastAttemptAt: 'asc' },
    take: options?.batchSize ?? 25,
  })

  const report = { retried: 0, sent: 0, failed: 0 }
  for (const message of candidates) {
    const result = await retryWhatsAppMessage(message).catch(
      (error: unknown): WhatsAppResult => ({
        id: message.id,
        status: 'FAILED',
        delivered: false,
        demo: false,
        outcome: 'failed',
        error: (error as Error).message,
      }),
    )
    if (result.outcome === 'demo') break
    if (result.outcome === 'disabled') continue
    report.retried++
    if (result.outcome === 'sent') report.sent++
    else report.failed++
  }
  return report
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

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
