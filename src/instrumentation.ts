/**
 * Runs once when the server boots, before any request. Pins the timezone so
 * date math is IST even on a UTC host (see lib/timezone).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./lib/timezone')
    // A client deployment with no payment gateway cannot take subscription
    // payments, and demo payments stay off (DEMO_MODE is not true). Not fatal —
    // owners can still pay by bank transfer — but it must be noticed.
    const provider = (process.env.PAYMENT_PROVIDER ?? 'demo').toLowerCase()
    const paymentLive = provider !== 'demo' && Boolean(process.env.PAYMENT_KEY_ID) && Boolean(process.env.PAYMENT_KEY_SECRET)
    if (process.env.NODE_ENV === 'production' && process.env.DEMO_MODE !== 'true' && !paymentLive) {
      const { log } = await import('./lib/logger')
      log('error', 'config.payments_not_live', {
        code: 'INTEGRATION_FAILED',
        detail:
          'PAYMENT_PROVIDER/PAYMENT_KEY_ID/PAYMENT_KEY_SECRET are not set and DEMO_MODE is not true: online subscription payments are unavailable and demo payments are disabled.',
      })
    }
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
