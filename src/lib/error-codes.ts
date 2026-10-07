/**
 * Error codes returned with every API error (`{ error, code, ref }`) and
 * written to the structured logs. The message is for the person using the
 * app; the code and the reference let support find the log line.
 *
 * Pure and client-safe: shared by route handlers, the logger, the client
 * fetch wrapper and the unit tests.
 */

export const ERROR_CODES = {
  // Request problems the person can fix
  VALIDATION_FAILED: 'The form has a mistake',
  NOT_FOUND: 'Record not found',
  CONFLICT: 'Clashes with an existing record',
  FILE_TOO_LARGE: 'File too large',
  RATE_LIMITED: 'Too many attempts',
  // Access
  AUTH_REQUIRED: 'Not signed in',
  AUTH_FORBIDDEN: 'Role or PG access does not allow this',
  AUTH_PASSWORD_CHANGE: 'Password change pending',
  AUTH_MODULE_OFF: 'Feature switched off',
  SUBSCRIPTION_SUSPENDED: 'Subscription suspended',
  PLAN_LIMIT: 'Plan limit reached',
  // Failures on our side, by area
  PAYMENT_FAILED: 'Payment processing failed',
  WEBHOOK_FAILED: 'Webhook processing failed',
  CRON_FAILED: 'Scheduled job failed',
  IMPORT_FAILED: 'Import failed',
  INTEGRATION_FAILED: 'Provider (WhatsApp, email, storage) failed',
  INTERNAL_ERROR: 'Unexpected server error',
} as const

export type ErrorCode = keyof typeof ERROR_CODES

export type ErrorArea = 'PAYMENT' | 'WEBHOOK' | 'CRON' | 'IMPORT' | 'INTEGRATION' | 'AUTH' | 'APP'

/** Which part of the product an API path belongs to. */
export function areaForPath(path: string | null | undefined): ErrorArea {
  const p = (path ?? '').toLowerCase()
  if (p.startsWith('/api/webhooks')) return 'WEBHOOK'
  if (p.startsWith('/api/cron')) return 'CRON'
  if (p.startsWith('/api/imports')) return 'IMPORT'
  if (p.startsWith('/api/integrations') || p.startsWith('/api/uploads')) return 'INTEGRATION'
  if (p.startsWith('/api/payments') || p.startsWith('/api/subscription') || p.startsWith('/api/admin/billing')) {
    return 'PAYMENT'
  }
  if (p.startsWith('/api/auth')) return 'AUTH'
  return 'APP'
}

const SERVER_CODE: Record<ErrorArea, ErrorCode> = {
  PAYMENT: 'PAYMENT_FAILED',
  WEBHOOK: 'WEBHOOK_FAILED',
  CRON: 'CRON_FAILED',
  IMPORT: 'IMPORT_FAILED',
  INTEGRATION: 'INTEGRATION_FAILED',
  AUTH: 'INTERNAL_ERROR',
  APP: 'INTERNAL_ERROR',
}

const STATUS_CODE: Record<number, ErrorCode> = {
  400: 'VALIDATION_FAILED',
  401: 'AUTH_REQUIRED',
  402: 'SUBSCRIPTION_SUSPENDED',
  403: 'AUTH_FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'FILE_TOO_LARGE',
  422: 'VALIDATION_FAILED',
  429: 'RATE_LIMITED',
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ERROR_CODES, value)
}

/**
 * The code for an error response. An explicit code (set by the thrower)
 * wins; server failures (5xx, 502 from a provider) are named by area; the
 * rest follow the HTTP status.
 */
export function errorCodeFor(status: number, path?: string | null, explicit?: unknown): ErrorCode {
  if (isErrorCode(explicit)) return explicit
  if (status >= 500) return SERVER_CODE[areaForPath(path)]
  return STATUS_CODE[status] ?? (status >= 400 ? 'VALIDATION_FAILED' : 'INTERNAL_ERROR')
}

const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** Short reference shown to people ("Ref K7Q2-9XMA") and logged as requestId. */
export function newRef(random: () => number = Math.random): string {
  let out = ''
  for (let i = 0; i < 8; i++) {
    if (i === 4) out += '-'
    out += REF_ALPHABET[Math.floor(random() * REF_ALPHABET.length)]
  }
  return out
}

/** Accept an incoming request id only when it is short and harmless. */
export function sanitizeRequestId(value: string | null | undefined): string | null {
  if (!value) return null
  const v = value.trim()
  return /^[A-Za-z0-9._-]{4,64}$/.test(v) ? v : null
}
