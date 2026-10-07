import { describe, expect, it } from 'vitest'
import { areaForPath, errorCodeFor, isErrorCode, newRef, sanitizeRequestId } from '@/lib/error-codes'
import { cleanFields, logLine } from '@/lib/logger'
import { integrationVerdict } from '@/lib/integration-health'
import { consolidatePgs, withPgScope } from '@/lib/pg-scope'
import {
  effectiveMeteredLimit,
  istMonthKey,
  istMonthStart,
  MB,
  storageAllowed,
  storageLimitMessage,
  toMb,
  whatsappAllowed,
  whatsappLimitMessage,
} from '@/lib/plan-entitlements'

describe('error codes', () => {
  it('names server failures by area', () => {
    expect(errorCodeFor(500, '/api/payments/abc')).toBe('PAYMENT_FAILED')
    expect(errorCodeFor(500, '/api/webhooks/razorpay/platform')).toBe('WEBHOOK_FAILED')
    expect(errorCodeFor(500, '/api/cron/run')).toBe('CRON_FAILED')
    expect(errorCodeFor(500, '/api/imports/rooms')).toBe('IMPORT_FAILED')
    expect(errorCodeFor(502, '/api/uploads')).toBe('INTEGRATION_FAILED')
    expect(errorCodeFor(500, '/api/residents')).toBe('INTERNAL_ERROR')
    expect(errorCodeFor(500)).toBe('INTERNAL_ERROR')
  })

  it('follows the HTTP status for request problems', () => {
    expect(errorCodeFor(401, '/api/payments')).toBe('AUTH_REQUIRED')
    expect(errorCodeFor(403)).toBe('AUTH_FORBIDDEN')
    expect(errorCodeFor(404)).toBe('NOT_FOUND')
    expect(errorCodeFor(409)).toBe('CONFLICT')
    expect(errorCodeFor(422)).toBe('VALIDATION_FAILED')
    expect(errorCodeFor(429)).toBe('RATE_LIMITED')
    expect(errorCodeFor(418)).toBe('VALIDATION_FAILED')
  })

  it('lets an explicit known code win and ignores unknown ones', () => {
    expect(errorCodeFor(402, '/api/properties', 'PLAN_LIMIT')).toBe('PLAN_LIMIT')
    expect(errorCodeFor(403, null, 'MADE_UP')).toBe('AUTH_FORBIDDEN')
    expect(isErrorCode('toString')).toBe(false)
    expect(isErrorCode('CRON_FAILED')).toBe(true)
  })

  it('classifies paths', () => {
    expect(areaForPath('/api/subscription/checkout')).toBe('PAYMENT')
    expect(areaForPath('/api/integrations/whatsapp/test')).toBe('INTEGRATION')
    expect(areaForPath('/API/AUTH/login')).toBe('AUTH')
    expect(areaForPath(undefined)).toBe('APP')
  })

  it('makes short readable references and accepts only safe incoming ids', () => {
    const ref = newRef()
    expect(ref).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/)
    expect(newRef(() => 0)).toBe('AAAA-AAAA')
    expect(sanitizeRequestId(ref)).toBe(ref)
    expect(sanitizeRequestId('abc')).toBeNull()
    expect(sanitizeRequestId('<script>alert(1)</script>')).toBeNull()
    expect(sanitizeRequestId('x'.repeat(65))).toBeNull()
    expect(sanitizeRequestId(null)).toBeNull()
  })
})

describe('structured logs', () => {
  it('writes one JSON line with level, time and event', () => {
    const line = logLine('warn', 'request.refused', { requestId: 'ABCD-EFGH', organizationId: 'org1', status: 403 }, new Date('2026-10-07T00:00:00Z'))
    expect(JSON.parse(line)).toEqual({
      level: 'warn',
      at: '2026-10-07T00:00:00.000Z',
      event: 'request.refused',
      requestId: 'ABCD-EFGH',
      organizationId: 'org1',
      status: 403,
    })
  })

  it('masks secrets and drops undefined fields', () => {
    expect(cleanFields({ password: 'x', accessToken: 'y', apiKey: 'z', Authorization: 'Bearer', user: 'u', skip: undefined })).toEqual({
      password: '[redacted]',
      accessToken: '[redacted]',
      apiKey: '[redacted]',
      Authorization: '[redacted]',
      user: 'u',
    })
  })
})

describe('integration verdict', () => {
  const base = { live: true, lastSuccessAt: null, lastFailureAt: null, failures: 0, successes: 0 }
  const t = (h: number) => new Date(Date.UTC(2026, 9, 7, h))

  it('is demo when nothing is live or connected', () => {
    expect(integrationVerdict({ ...base, live: false })).toBe('demo')
    expect(integrationVerdict({ ...base, live: false, ownConnections: 1 })).toBe('idle')
  })

  it('is idle with no traffic and healthy with no failures', () => {
    expect(integrationVerdict(base)).toBe('idle')
    expect(integrationVerdict({ ...base, successes: 5, lastSuccessAt: t(1) })).toBe('healthy')
  })

  it('is failing when nothing succeeded or failures dominate the latest outcome', () => {
    expect(integrationVerdict({ ...base, failures: 2, lastFailureAt: t(2) })).toBe('failing')
    expect(integrationVerdict({ ...base, failures: 3, successes: 2, lastSuccessAt: t(1), lastFailureAt: t(2) })).toBe('failing')
  })

  it('is degraded when successes are more recent or more numerous', () => {
    expect(integrationVerdict({ ...base, failures: 1, successes: 9, lastSuccessAt: t(1), lastFailureAt: t(2) })).toBe('degraded')
    expect(integrationVerdict({ ...base, failures: 5, successes: 1, lastSuccessAt: t(3), lastFailureAt: t(2) })).toBe('degraded')
  })
})

describe('metered plan limits', () => {
  it('takes the most generous plan; any unlimited plan means unlimited', () => {
    expect(effectiveMeteredLimit([], 'whatsapp')).toBeNull()
    expect(effectiveMeteredLimit([{ name: 'A', whatsappMonthlyLimit: 500 }, { name: 'B', whatsappMonthlyLimit: 2000 }], 'whatsapp')).toBe(2000)
    expect(effectiveMeteredLimit([{ name: 'A', whatsappMonthlyLimit: 500 }, { name: 'B', whatsappMonthlyLimit: null }], 'whatsapp')).toBeNull()
    expect(effectiveMeteredLimit([{ name: 'A', storageLimitMb: 1024 }], 'storage')).toBe(1024)
    expect(effectiveMeteredLimit([{ name: 'A' }], 'storage')).toBeNull()
  })

  it('starts the month at IST midnight on the 1st', () => {
    // 1 Oct 2026 00:10 IST = 30 Sep 18:40 UTC: already October in India.
    expect(istMonthStart(new Date('2026-09-30T18:40:00Z')).toISOString()).toBe('2026-09-30T18:30:00.000Z')
    expect(istMonthKey(new Date('2026-09-30T18:40:00Z'))).toBe('2026-10')
    // 30 Sep 23:59 IST is still September.
    expect(istMonthKey(new Date('2026-09-30T18:29:00Z'))).toBe('2026-09')
    expect(istMonthStart(new Date('2026-12-31T20:00:00Z')).toISOString()).toBe('2026-12-31T18:30:00.000Z')
  })

  it('allows WhatsApp until the allowance is used', () => {
    expect(whatsappAllowed(0, 0)).toBe(false)
    expect(whatsappAllowed(499, 500)).toBe(true)
    expect(whatsappAllowed(500, 500)).toBe(false)
    expect(whatsappAllowed(10_000, null)).toBe(true)
  })

  it('refuses a file that would overflow storage', () => {
    expect(storageAllowed(0, 5 * MB, 5)).toBe(true)
    expect(storageAllowed(1, 5 * MB, 5)).toBe(false)
    expect(storageAllowed(99 * MB, MB, 100)).toBe(true)
    expect(storageAllowed(10_000 * MB, MB, null)).toBe(true)
    expect(toMb(1.25 * MB)).toBe(1.3)
  })

  it('explains the limit in plain words', () => {
    expect(whatsappLimitMessage('Starter', 500)).toContain('500 WhatsApp messages a month')
    expect(storageLimitMessage('Starter', 2048)).toContain('2 GB')
    expect(storageLimitMessage('Starter', 500)).toContain('500 MB')
  })
})

describe('multi-PG helpers', () => {
  it('carries the picked PG onto owner links only', () => {
    expect(withPgScope('/app/residents', 'pg1')).toBe('/app/residents?property=pg1')
    expect(withPgScope('/app', 'pg1')).toBe('/app?property=pg1')
    expect(withPgScope('/app/rent?status=OVERDUE', 'pg1')).toBe('/app/rent?status=OVERDUE&property=pg1')
    expect(withPgScope('/app/reports#pg-performance', 'pg1')).toBe('/app/reports?property=pg1#pg-performance')
    expect(withPgScope('/app/residents?property=pg2', 'pg1')).toBe('/app/residents?property=pg2')
    expect(withPgScope('/app/settings', 'pg1')).toBe('/app/settings')
    expect(withPgScope('/app/settings/whatsapp', 'pg1')).toBe('/app/settings/whatsapp')
    expect(withPgScope('/app/subscription', 'pg1')).toBe('/app/subscription')
    expect(withPgScope('/admin/organizations', 'pg1')).toBe('/admin/organizations')
    expect(withPgScope('/application', 'pg1')).toBe('/application')
    expect(withPgScope('/app/residents', null)).toBe('/app/residents')
    expect(withPgScope('/app/residents', 'bad id&x=1')).toBe('/app/residents')
  })

  it('totals PGs and recomputes occupancy from beds', () => {
    const totals = consolidatePgs([
      { beds: 10, occupied: 10, residents: 10, collection: 50_000, pending: 5_000, expenses: 20_000, complaints: 1 },
      { beds: 90, occupied: 45, residents: 46, collection: 200_000, pending: 0, expenses: 250_000, complaints: 3 },
    ])
    // Averaging rates would say 75%; by beds it is 55 of 100.
    expect(totals.occupancyRate).toBe(55)
    expect(totals).toMatchObject({ beds: 100, occupied: 55, residents: 56, collection: 250_000, pending: 5_000, expenses: 270_000, net: -20_000, complaints: 4 })
    expect(consolidatePgs([]).occupancyRate).toBe(0)
  })
})
