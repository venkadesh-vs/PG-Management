/**
 * Pure verdict for one integration on the System health page, from what the
 * logs and tables show. Shared by the health service and the unit tests.
 */

export type IntegrationVerdict = 'healthy' | 'degraded' | 'failing' | 'demo' | 'idle'

export type IntegrationSignals = {
  /** Platform keys configured (not demo). */
  live: boolean
  /** Organizations connected with their own account (Razorpay / WhatsApp). */
  ownConnections?: number
  lastSuccessAt: Date | null
  lastFailureAt: Date | null
  /** Failures in the look-back window (7 days). */
  failures: number
  /** Successes in the same window. */
  successes: number
}

/**
 * - demo: nothing live, nothing connected — records are simulations.
 * - idle: live but no traffic in the window.
 * - failing: the latest outcome is a failure and nothing succeeded since,
 *   or everything in the window failed.
 * - degraded: some failures, but more recent or more numerous successes.
 * - healthy: no failures in the window.
 */
export function integrationVerdict(s: IntegrationSignals): IntegrationVerdict {
  const connected = s.live || (s.ownConnections ?? 0) > 0
  if (!connected) return 'demo'
  if (s.failures === 0 && s.successes === 0) return 'idle'
  if (s.failures === 0) return 'healthy'
  if (s.successes === 0) return 'failing'
  if (s.lastFailureAt && (!s.lastSuccessAt || s.lastFailureAt > s.lastSuccessAt)) {
    // Latest attempt failed: failing if failures dominate, else degraded.
    return s.failures >= s.successes ? 'failing' : 'degraded'
  }
  return 'degraded'
}

export const VERDICT_LABEL: Record<IntegrationVerdict, string> = {
  healthy: 'Healthy',
  degraded: 'Some failures',
  failing: 'Failing',
  demo: 'Demo',
  idle: 'No traffic',
}

export const VERDICT_VARIANT: Record<IntegrationVerdict, 'success' | 'warning' | 'danger' | 'default' | 'info'> = {
  healthy: 'success',
  degraded: 'warning',
  failing: 'danger',
  demo: 'default',
  idle: 'info',
}
