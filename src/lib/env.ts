/**
 * Server-only environment access. Anything read here must never be imported
 * into a client component — the `NEXT_PUBLIC_*` values live in `publicEnv`
 * below and are the only ones safe to ship to the browser.
 */

function required(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback
  if (!value) {
    throw new Error(
      `Missing required environment variable ${key}. Copy .env.example to .env and fill it in.`,
    )
  }
  return value
}

export const serverEnv = {
  get databaseUrl() {
    return required('DATABASE_URL')
  },
  get authSecret() {
    const secret = required('AUTH_SECRET')
    if (process.env.NODE_ENV === 'production' && (secret.length < 32 || secret.startsWith('change-me'))) {
      throw new Error('AUTH_SECRET must be a random string of at least 32 characters in production.')
    }
    return secret
  },
  /**
   * Public demo deployments only: shows the seeded demo accounts and their
   * password on the sign-in page. Never enable on a deployment with clients.
   */
  get demoMode() {
    return process.env.DEMO_MODE === 'true'
  },
  get sessionHours() {
    return Number(process.env.AUTH_SESSION_HOURS ?? 12)
  },
  get cronSecret() {
    return process.env.CRON_SECRET ?? ''
  },
  get seedPassword() {
    return process.env.SEED_PASSWORD ?? 'StayFlow@2026'
  },
  whatsapp: {
    get provider() {
      return (process.env.WHATSAPP_PROVIDER ?? 'demo').toLowerCase()
    },
    get phoneNumberId() {
      return process.env.WHATSAPP_PHONE_NUMBER_ID ?? ''
    },
    get accessToken() {
      return process.env.WHATSAPP_ACCESS_TOKEN ?? ''
    },
    get apiVersion() {
      return process.env.WHATSAPP_API_VERSION ?? 'v21.0'
    },
    /** True only when real credentials are present. */
    get isLive() {
      return (
        (process.env.WHATSAPP_PROVIDER ?? 'demo').toLowerCase() === 'meta' &&
        Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID) &&
        Boolean(process.env.WHATSAPP_ACCESS_TOKEN)
      )
    },
  },
  payment: {
    get provider() {
      return (process.env.PAYMENT_PROVIDER ?? 'demo').toLowerCase()
    },
    get keyId() {
      return process.env.PAYMENT_KEY_ID ?? ''
    },
    get keySecret() {
      return process.env.PAYMENT_KEY_SECRET ?? ''
    },
    get webhookSecret() {
      return process.env.PAYMENT_WEBHOOK_SECRET ?? ''
    },
    get isLive() {
      return (
        (process.env.PAYMENT_PROVIDER ?? 'demo').toLowerCase() !== 'demo' &&
        Boolean(process.env.PAYMENT_KEY_ID) &&
        Boolean(process.env.PAYMENT_KEY_SECRET)
      )
    },
  },
}

// Public values live in lib/public-env.ts so client components can import them
// without pulling this server-only module into the browser bundle.
export { publicEnv, whatsappLink } from './public-env'
