/**
 * URL filters for the message centre (/app/messages). Pure, so the parsing
 * rules are unit-tested; anything unrecognised is ignored, never an error.
 */

export const CENTRE_CHANNELS = ['WHATSAPP', 'EMAIL', 'SMS', 'IN_APP'] as const
export type CentreChannel = (typeof CENTRE_CHANNELS)[number]

/** RETRIED = sent more than once (manual or automatic retry). */
export const CENTRE_STATUSES = ['QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'DEMO_NOT_SENT', 'RETRIED'] as const
export type CentreStatus = (typeof CENTRE_STATUSES)[number]

export const CENTRE_STATUS_LABEL: Record<CentreStatus, string> = {
  QUEUED: 'Queued / sending',
  SENT: 'Sent',
  DELIVERED: 'Delivered',
  READ: 'Read',
  FAILED: 'Failed',
  DEMO_NOT_SENT: 'Demo — not sent',
  RETRIED: 'Retried',
}

export const CENTRE_CHANNEL_LABEL: Record<CentreChannel, string> = {
  WHATSAPP: 'WhatsApp',
  EMAIL: 'Email',
  SMS: 'SMS',
  IN_APP: 'In-app',
}

export type CentreFilters = {
  channel: CentreChannel | null
  status: CentreStatus | null
  group: string | null
  resident: string | null
  q: string
  /** Inclusive start of the from-day (local midnight). */
  from: Date | null
  /** Exclusive: midnight after the to-day. */
  to: Date | null
  page: number
}

function day(value: string | undefined): Date | null {
  const m = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) || d.getMonth() !== Number(m[2]) - 1 ? null : d
}

function pick<T extends string>(list: readonly T[], value: string | undefined): T | null {
  return value && (list as readonly string[]).includes(value) ? (value as T) : null
}

export function centreFilters(params: Record<string, string | undefined>): CentreFilters {
  const from = day(params.from)
  const toDay = day(params.to)
  const to = toDay ? new Date(toDay.getFullYear(), toDay.getMonth(), toDay.getDate() + 1) : null
  return {
    channel: pick(CENTRE_CHANNELS, params.channel),
    status: pick(CENTRE_STATUSES, params.status),
    group: params.group?.trim() || null,
    resident: params.resident?.trim() || null,
    q: (params.q ?? '').trim().slice(0, 100),
    from,
    to,
    page: Math.max(1, Math.floor(Number(params.page)) || 1),
  }
}
