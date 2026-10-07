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
 * Every unhandled server-side error (pages, route handlers, server actions)
 * lands here and goes through lib/logger: one structured JSON line, plus an
 * ERROR_WEBHOOK_URL alert when configured.
 */
export async function onRequestError(
  err: unknown,
  request: { path: string; method: string },
  context: { routerKind: string; routePath: string; routeType: string },
) {
  const digest =
    typeof err === 'object' && err !== null && 'digest' in err ? String((err as { digest: unknown }).digest) : undefined
  const { logError } = await import('./lib/logger')
  const { errorCodeFor } = await import('./lib/error-codes')
  await logError('request.unhandled', err, {
    requestId: digest,
    method: request.method,
    route: request.path,
    routePath: context.routePath,
    kind: context.routeType,
    code: errorCodeFor(500, request.path),
  })
}
