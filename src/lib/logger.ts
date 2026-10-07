/**
 * Structured server logs: one JSON line per event, searchable in Netlify or
 * any log drain. Errors are also posted to ERROR_WEBHOOK_URL (Slack /
 * Discord / Google Chat) when it is set, so someone is told without watching
 * logs. Logging never throws and never blocks a request for long.
 *
 * Never log secrets, passwords, tokens or full card/bank details.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type LogFields = {
  requestId?: string | null
  organizationId?: string | null
  userId?: string | null
  route?: string | null
  method?: string | null
  code?: string | null
  status?: number | null
  [key: string]: unknown
}

const SECRET_KEY = /pass(word)?|secret|token|authorization|cookie|api[-_]?key|otp/i

/** Drops undefined values and masks anything that looks like a secret. */
export function cleanFields(fields: LogFields): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue
    out[key] = SECRET_KEY.test(key) ? '[redacted]' : value
  }
  return out
}

export function logLine(level: LogLevel, event: string, fields: LogFields = {}, now = new Date()) {
  return JSON.stringify({ level, at: now.toISOString(), event, ...cleanFields(fields) })
}

export function log(level: LogLevel, event: string, fields: LogFields = {}) {
  try {
    const line = logLine(level, event, fields)
    if (level === 'error') console.error(line)
    else if (level === 'warn') console.warn(line)
    else console.log(line)
  } catch {
    // A log that cannot be serialised must not break the request.
  }
}

/** Posts a one-line alert to the configured chat webhook. Silent on failure. */
export async function sendAlert(text: string) {
  const hook = process.env.ERROR_WEBHOOK_URL
  if (!hook) return
  try {
    await fetch(hook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // `text` (Slack/Google Chat) and `content` (Discord) cover the common hooks.
      body: JSON.stringify({ text, content: text }),
      signal: AbortSignal.timeout(3000),
    })
  } catch {
    // Reporting must never take the request down with it.
  }
}

/** Logs an error with its stack and alerts the team. */
export async function logError(event: string, error: unknown, fields: LogFields = {}) {
  const err = error instanceof Error ? error : new Error(String(error))
  log('error', event, {
    ...fields,
    message: err.message,
    stack: err.stack?.split('\n').slice(0, 8).join('\n'),
  })
  const where = [fields.method, fields.route].filter(Boolean).join(' ')
  const ref = fields.requestId ? ` (ref ${fields.requestId})` : ''
  const code = fields.code ? ` [${fields.code}]` : ''
  await sendAlert(`StayFlow error${code}${where ? ` on ${where}` : ''}: ${err.message}${ref}`)
}
