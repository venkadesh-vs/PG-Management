import { describe, expect, it } from 'vitest'

import {
  cyclePrice,
  describeStatus,
  isStaleFailureEvent,
  nextRetryAt,
  nextStatus,
  prorate,
  retriesExhausted,
  RETRY_DAYS,
  yearlySaving,
} from '@/lib/subscription-math'
import {
  downgradeBlockers,
  effectiveLimit,
  fitsLimit,
  isModuleEntitlementList,
  limitMessage,
  normalisePlanFeatures,
  planExcludedModules,
  type PlanLimits,
} from '@/lib/plan-entitlements'
import { resolveAccess } from '@/lib/access'
import { webhookEventKey } from '@/lib/webhook-key'

const d = (s: string) => new Date(`${s}T00:00:00+05:30`)

describe('cyclePrice (yearly billing)', () => {
  it('monthly is the monthly amount', () => {
    expect(cyclePrice(3000, 'MONTHLY', 17)).toBe(3000)
  })
  it('yearly = 12 × monthly × (100 − discount)%', () => {
    expect(cyclePrice(3000, 'YEARLY', 17)).toBe(29880)
    expect(cyclePrice(2500, 'YEARLY', 0)).toBe(30000)
    expect(cyclePrice(1999, 'YEARLY', 10)).toBe(Math.round(12 * 1999 * 0.9))
  })
  it('clamps silly discounts', () => {
    expect(cyclePrice(1000, 'YEARLY', 150)).toBe(0)
    expect(cyclePrice(1000, 'YEARLY', -5)).toBe(12000)
  })
  it('quarterly / half-yearly are plain multiples', () => {
    expect(cyclePrice(1000, 'QUARTERLY', 17)).toBe(3000)
    expect(cyclePrice(1000, 'HALF_YEARLY', 17)).toBe(6000)
  })
  it('yearly saving', () => {
    expect(yearlySaving(3000, 17)).toBe(36000 - 29880)
  })
})

describe('prorate (upgrade mid-period)', () => {
  const periodStart = d('2026-10-01')
  const periodEnd = d('2026-10-31')

  it('charges the difference for the days left', () => {
    const p = prorate({ currentCyclePrice: 3000, targetCyclePrice: 6000, periodStart, periodEnd, now: d('2026-10-16') })
    expect(p.totalDays).toBe(30)
    expect(p.remainingDays).toBe(15)
    expect(p.amount).toBe(1500)
  })
  it('full difference on day one, nothing at the end', () => {
    expect(prorate({ currentCyclePrice: 3000, targetCyclePrice: 4500, periodStart, periodEnd, now: periodStart }).amount).toBe(1500)
    expect(prorate({ currentCyclePrice: 3000, targetCyclePrice: 4500, periodStart, periodEnd, now: periodEnd }).amount).toBe(0)
  })
  it('never refunds on a downgrade', () => {
    expect(prorate({ currentCyclePrice: 6000, targetCyclePrice: 3000, periodStart, periodEnd, now: d('2026-10-10') }).amount).toBe(0)
  })
  it('counts a partial day as a day left', () => {
    const now = new Date(d('2026-10-30').getTime() + 6 * 3600_000)
    expect(prorate({ currentCyclePrice: 0, targetCyclePrice: 3000, periodStart, periodEnd, now }).remainingDays).toBe(1)
  })
  it('handles a now outside the period', () => {
    expect(prorate({ currentCyclePrice: 0, targetCyclePrice: 3000, periodStart, periodEnd, now: d('2026-09-01') }).remainingDays).toBe(30)
  })
})

describe('retry schedule', () => {
  const first = d('2026-10-01')
  it('retries 1, 3 and 5 days after the first failure', () => {
    expect(RETRY_DAYS).toEqual([1, 3, 5])
    expect(nextRetryAt(first, 1)).toEqual(d('2026-10-02'))
    expect(nextRetryAt(first, 2)).toEqual(d('2026-10-04'))
    expect(nextRetryAt(first, 3)).toEqual(d('2026-10-06'))
  })
  it('stops after the third retry', () => {
    expect(nextRetryAt(first, 4)).toBeNull()
    expect(nextRetryAt(first, 0)).toBeNull()
    expect(retriesExhausted(3)).toBe(false)
    expect(retriesExhausted(4)).toBe(true)
  })
})

describe('nextStatus (lifecycle)', () => {
  it('trial → past due when the first invoice is unpaid, → active on payment', () => {
    expect(nextStatus('TRIALING', { type: 'INVOICE_UNPAID' })).toBe('PAST_DUE')
    expect(nextStatus('TRIALING', { type: 'PAYMENT_SUCCEEDED' })).toBe('ACTIVE')
  })
  it('missed charge → past due while retries remain, then grace, then suspended', () => {
    expect(nextStatus('ACTIVE', { type: 'PAYMENT_FAILED', retriesLeft: true })).toBe('PAST_DUE')
    expect(nextStatus('PAST_DUE', { type: 'PAYMENT_FAILED', retriesLeft: true })).toBe('PAST_DUE')
    expect(nextStatus('PAST_DUE', { type: 'PAYMENT_FAILED', retriesLeft: false })).toBe('GRACE')
    expect(nextStatus('PAST_DUE', { type: 'GRACE_STARTED' })).toBe('GRACE')
    expect(nextStatus('GRACE', { type: 'GRACE_EXPIRED' })).toBe('SUSPENDED')
  })
  it('a suspended subscription reactivates instantly on payment', () => {
    expect(nextStatus('SUSPENDED', { type: 'PAYMENT_SUCCEEDED' })).toBe('ACTIVE')
    expect(nextStatus('GRACE', { type: 'PAYMENT_SUCCEEDED' })).toBe('ACTIVE')
  })
  it('never moves backwards on a late failure', () => {
    expect(nextStatus('SUSPENDED', { type: 'PAYMENT_FAILED', retriesLeft: true })).toBe('SUSPENDED')
    expect(nextStatus('CANCELLED', { type: 'PAYMENT_FAILED', retriesLeft: false })).toBe('CANCELLED')
    expect(nextStatus('GRACE', { type: 'PAYMENT_FAILED', retriesLeft: true })).toBe('GRACE')
    expect(nextStatus('TRIALING', { type: 'GRACE_EXPIRED' })).toBe('TRIALING')
  })
  it('cancellation and reactivation', () => {
    expect(nextStatus('ACTIVE', { type: 'CANCELLED' })).toBe('CANCELLED')
    expect(nextStatus('CANCELLED', { type: 'PAYMENT_SUCCEEDED' })).toBe('CANCELLED')
    expect(nextStatus('CANCELLED', { type: 'REACTIVATED', paidUp: true })).toBe('ACTIVE')
    expect(nextStatus('CANCELLED', { type: 'REACTIVATED', paidUp: false })).toBe('PAST_DUE')
    expect(nextStatus('ACTIVE', { type: 'REACTIVATED', paidUp: true })).toBe('ACTIVE')
  })
  it('extending a trial', () => {
    expect(nextStatus('PAST_DUE', { type: 'TRIAL_EXTENDED' })).toBe('TRIALING')
    expect(nextStatus('CANCELLED', { type: 'TRIAL_EXTENDED' })).toBe('CANCELLED')
  })
})

describe('describeStatus', () => {
  it('shows trial days remaining', () => {
    expect(describeStatus({ status: 'TRIALING', now: d('2026-10-01'), trialEndsAt: d('2026-10-11') })).toBe(
      'Free trial — 10 days left',
    )
  })
  it('mentions a scheduled cancellation', () => {
    expect(
      describeStatus({ status: 'ACTIVE', now: d('2026-10-01'), currentPeriodEnd: d('2026-10-02'), cancelAtPeriodEnd: true }),
    ).toContain('1 day')
  })
})

describe('isStaleFailureEvent (out-of-order webhooks)', () => {
  it('a failure older than the last success is stale', () => {
    expect(isStaleFailureEvent({ eventCreatedAt: d('2026-10-01'), lastSuccessAt: d('2026-10-02') })).toBe(true)
  })
  it('a fresh failure is not', () => {
    expect(isStaleFailureEvent({ eventCreatedAt: d('2026-10-03'), lastSuccessAt: d('2026-10-02') })).toBe(false)
    expect(isStaleFailureEvent({ eventCreatedAt: null, lastSuccessAt: d('2026-10-02') })).toBe(false)
  })
  it('a failure for an already paid invoice is stale', () => {
    expect(isStaleFailureEvent({ eventCreatedAt: null, lastSuccessAt: null, invoiceAlreadyPaid: true })).toBe(true)
  })
})

describe('plan limits', () => {
  const starter: PlanLimits = { name: 'Starter', maxProperties: 2, maxBeds: 40, maxResidents: 40, maxStaff: 3 }
  const growth: PlanLimits = { name: 'Growth', maxProperties: 5, maxBeds: null, maxResidents: 200, maxStaff: 10 }

  it('takes the most generous live plan; null is unlimited', () => {
    expect(effectiveLimit([starter], 'properties')).toBe(2)
    expect(effectiveLimit([starter, growth], 'properties')).toBe(5)
    expect(effectiveLimit([starter, growth], 'beds')).toBeNull()
    expect(effectiveLimit([], 'staff')).toBeNull()
  })
  it('fits', () => {
    expect(fitsLimit(1, 1, 2)).toBe(true)
    expect(fitsLimit(2, 1, 2)).toBe(false)
    expect(fitsLimit(30, 12, 40)).toBe(false)
    expect(fitsLimit(999, 1, null)).toBe(true)
  })
  it('friendly message', () => {
    expect(limitMessage('Starter', 'properties', 2)).toMatch(/^Your Starter plan allows 2 PGs\. Upgrade to add more/)
    expect(limitMessage('Solo', 'properties', 1)).toContain('allows 1 PG.')
  })
  it('refuses a downgrade when usage exceeds the target', () => {
    const usage = { properties: 3, beds: 30, residents: 20, staff: 4 }
    const blockers = downgradeBlockers(usage, [starter])
    expect(blockers.map((b) => b.key)).toEqual(['properties', 'staff'])
    expect(downgradeBlockers(usage, [growth])).toEqual([])
  })
})

describe('plan features → modules', () => {
  const core = ['dashboard', 'properties', 'residents', 'rent', 'settings']

  it('legacy / empty feature lists include everything', () => {
    expect(isModuleEntitlementList([])).toBe(false)
    expect(isModuleEntitlementList(['residents', 'rooms', 'rent', 'complaints', 'whatsapp'])).toBe(false)
    expect(planExcludedModules([['residents', 'rooms', 'rent', 'complaints', 'whatsapp']])).toEqual([])
    expect(planExcludedModules([])).toEqual([])
  })
  it('a module list excludes the optional modules it does not name', () => {
    const excluded = planExcludedModules([[...core, 'complaints', 'expenses']])
    expect(excluded).toContain('food')
    expect(excluded).toContain('reports')
    expect(excluded).not.toContain('complaints')
    expect(excluded).not.toContain('expenses')
  })
  it('two plans give the union of their modules', () => {
    const excluded = planExcludedModules([[...core, 'food'], [...core, 'reports']])
    expect(excluded).not.toContain('food')
    expect(excluded).not.toContain('reports')
    expect(excluded).toContain('grocery')
    // A legacy plan alongside includes everything.
    expect(planExcludedModules([[...core, 'food'], []])).toEqual([])
  })
  it('normalise keeps known optional keys and always adds the core ones', () => {
    const f = normalisePlanFeatures(['food', 'bogus', 'food', 'dashboard'])
    expect(f).toEqual([...core, 'food'])
    expect(isModuleEntitlementList(f)).toBe(true)
  })
  it('resolveAccess switches plan-excluded modules off', () => {
    const access = resolveAccess({ role: 'OWNER', rolePermissions: null, disabledModules: [], flagsOff: [], planOff: ['food'] })
    expect(access.modules).not.toContain('food')
    expect(access.modules).toContain('rent')
    const legacy = resolveAccess({ role: 'OWNER', rolePermissions: null, disabledModules: [], flagsOff: [] })
    expect(legacy.modules).toContain('food')
  })
})

describe('webhookEventKey (dedupe)', () => {
  it('prefers the x-razorpay-event-id header', () => {
    expect(webhookEventKey({ headerId: ' evt_123 ', rawBody: '{}', parsed: { id: 'other' } })).toBe('evt_123')
  })
  it('falls back to the payload id', () => {
    expect(webhookEventKey({ headerId: null, rawBody: '{}', parsed: { id: 'evt_body' } })).toBe('evt_body')
  })
  it('falls back to a stable hash of the body', () => {
    const a = webhookEventKey({ rawBody: '{"event":"payment.captured"}' })
    const b = webhookEventKey({ rawBody: '{"event":"payment.captured"}', headerId: '' })
    const c = webhookEventKey({ rawBody: '{"event":"payment.failed"}' })
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })
})
