/**
 * Runs once when the server boots, before any request. Pins the timezone so
 * date math is IST even on a UTC host (see lib/timezone).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./lib/timezone')
  }
}

/**
 * Every server-side error (pages, route handlers, server actions) lands
 * here. It is written as one structured JSON line — searchable in Netlify /
 * any log drain — and, when ERROR_WEBHOOK_URL is set, posted to a Slack /
 * Discord / Google Chat webhook so someone is told without watching logs.
 */
export async function onRequestError(
  err: unknown,
  request: { path: string; method: string },
  context: { routerKind: string; routePath: string; routeType: string },
) {
  const error = err instanceof Error ? err : new Error(String(err))
  const digest =
    typeof err === 'object' && err !== null && 'digest' in err ? String((err as { digest: unknown }).digest) : undefined
  const entry = {
    level: 'error',
    at: new Date().toISOString(),
    message: error.message,
    digest,
    method: request.method,
    path: request.path,
    route: context.routePath,
    kind: context.routeType,
    stack: error.stack?.split('\n').slice(0, 8).join('\n'),
  }
  console.error(JSON.stringify(entry))

  const hook = process.env.ERROR_WEBHOOK_URL
  if (hook) {
    try {
      await fetch(hook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // `text` (Slack/Google Chat) and `content` (Discord) cover the common hooks.
        body: JSON.stringify({
          text: `StayFlow error on ${entry.method} ${entry.path}: ${entry.message}${digest ? ` (ref ${digest})` : ''}`,
          content: `StayFlow error on ${entry.method} ${entry.path}: ${entry.message}${digest ? ` (ref ${digest})` : ''}`,
        }),
        signal: AbortSignal.timeout(3000),
      })
    } catch {
      // Reporting must never take the request down with it.
    }
  }
}
