import { describe, expect, it } from 'vitest'
import {
  DEFAULT_REMINDER_SCHEDULE,
  daysUntilPause,
  graceBanner,
  lastActiveDay,
  parsePaymentDetails,
  parseReminderSchedule,
  paywallDecision,
  reminderKey,
  remindersDue,
  upiPayLink,
} from '@/lib/owner-billing'

const d = (s: string) => new Date(`${s}T00:00:00`)
const sub = (over: Partial<Parameters<typeof remindersDue>[0]['subscription']> = {}) => ({
  id: 'sub1',
  status: 'TRIALING',
  trialEndsAt: d('2026-10-20'),
  graceEndsAt: null as Date | null,
  autopay: false,
  ...over,
})
const inv = { id: 'inv1', number: 'SF-202610-0001', dueDate: d('2026-10-12'), balance: 8000 }

describe('reminder schedule', () => {
  it('parses stored settings with field-by-field defaults', () => {
    expect(parseReminderSchedule(undefined)).toEqual(DEFAULT_REMINDER_SCHEDULE)
    expect(parseReminderSchedule({ trialDaysBefore: [1, 3, 3, -2, 'x'] })).toEqual({
      ...DEFAULT_REMINDER_SCHEDULE,
      trialDaysBefore: [3, 1],
    })
  })

  it('sends trial-ending reminders 3 days and 1 day before only', () => {
    const at = (day: string) => remindersDue({ today: d(day), subscription: sub(), invoices: [], schedule: DEFAULT_REMINDER_SCHEDULE })
    expect(at('2026-10-17').map((r) => r.kind)).toEqual(['TRIAL_ENDING'])
    expect(at('2026-10-18')).toEqual([])
    expect(at('2026-10-19')[0]).toMatchObject({ kind: 'TRIAL_ENDING', daysBefore: 1 })
    expect(at('2026-10-20')).toEqual([])
  })

  it('sends due-tomorrow and due-today, not for AutoPay', () => {
    const at = (day: string, autopay = false) =>
      remindersDue({ today: d(day), subscription: sub({ status: 'PAST_DUE', autopay }), invoices: [inv], schedule: DEFAULT_REMINDER_SCHEDULE })
    expect(at('2026-10-11')[0]).toMatchObject({ kind: 'DUE_SOON', daysBefore: 1, key: 'due:inv1:1' })
    expect(at('2026-10-12')[0]).toMatchObject({ kind: 'DUE_SOON', daysBefore: 0, key: 'due:inv1:0' })
    expect(at('2026-10-10')).toEqual([])
    expect(at('2026-10-11', true)).toEqual([])
  })

  it('sends grace reminders 3 and 1 days before the pause', () => {
    // Invoice raised 9 Oct, grace 7 days: paused on 16 Oct, last active day 15 Oct.
    const grace = sub({ status: 'GRACE', graceEndsAt: d('2026-10-16') })
    const at = (day: string) => remindersDue({ today: d(day), subscription: grace, invoices: [inv], schedule: DEFAULT_REMINDER_SCHEDULE })
    expect(at('2026-10-13')[0]).toMatchObject({ kind: 'GRACE_REMINDER', daysLeft: 3, key: 'grace:inv1:3' })
    expect(at('2026-10-14')).toEqual([])
    const last = at('2026-10-15')[0]
    expect(last).toMatchObject({ kind: 'GRACE_REMINDER', daysLeft: 1 })
    expect(last.kind === 'GRACE_REMINDER' && last.lastActiveDay.getDate()).toBe(15)
    expect(at('2026-10-16')).toEqual([])
  })

  it('never reminds about a paid invoice', () => {
    expect(
      remindersDue({
        today: d('2026-10-11'),
        subscription: sub({ status: 'PAST_DUE' }),
        invoices: [{ ...inv, balance: 0 }],
        schedule: DEFAULT_REMINDER_SCHEDULE,
      }),
    ).toEqual([])
  })

  it('keys are stable per cycle so reruns never duplicate', () => {
    expect(reminderKey.trialEnding('s', d('2026-10-20'), 3)).toBe('trial:s:2026-10-20:3')
    expect(reminderKey.invoiceRaised('i')).toBe('invoice:i')
    expect(reminderKey.graceStarted('i')).toBe('grace-start:i')
    expect(reminderKey.suspended('s', d('2026-10-16'))).toBe('suspended:s:2026-10-16')
    expect(reminderKey.paymentReceived('i')).toBe('paid:i')
  })
})

describe('grace banner', () => {
  const subs = [{ status: 'GRACE', graceEndsAt: d('2026-10-16') }]
  it('shows the amount, last active day and days left', () => {
    const b = graceBanner({ today: d('2026-10-13'), subscriptions: subs, invoices: [inv] })
    expect(b).toMatchObject({ amount: 8000, daysLeft: 3, tone: 'amber', invoiceNumber: 'SF-202610-0001' })
    expect(b?.lastActiveDay.getDate()).toBe(15)
  })
  it('turns rose on the last day', () => {
    expect(graceBanner({ today: d('2026-10-15'), subscriptions: subs, invoices: [inv] })?.tone).toBe('rose')
  })
  it('is hidden before the due date, after the pause, and when paid', () => {
    expect(graceBanner({ today: d('2026-10-11'), subscriptions: subs, invoices: [inv] })).toBeNull()
    expect(graceBanner({ today: d('2026-10-16'), subscriptions: subs, invoices: [inv] })).toBeNull()
    expect(graceBanner({ today: d('2026-10-13'), subscriptions: subs, invoices: [{ ...inv, balance: 0 }] })).toBeNull()
  })
  it('day helpers', () => {
    expect(lastActiveDay(d('2026-10-16')).getDate()).toBe(15)
    expect(daysUntilPause(d('2026-10-16'), d('2026-10-15'))).toBe(1)
    expect(daysUntilPause(d('2026-10-16'), d('2026-10-17'))).toBe(0)
  })
})

describe('paywall decision', () => {
  it('blocks owners and managers of a paused account', () => {
    expect(paywallDecision({ role: 'OWNER', organizationStatus: 'SUSPENDED', path: '/app' })).toBe('paywall')
    expect(paywallDecision({ role: 'MANAGER', organizationStatus: 'CANCELLED', path: '/app/residents' })).toBe('paywall')
    expect(paywallDecision({ role: 'OWNER', organizationStatus: 'SUSPENDED' })).toBe('paywall')
  })
  it('keeps the subscription page and the paywall open', () => {
    expect(paywallDecision({ role: 'OWNER', organizationStatus: 'SUSPENDED', path: '/app/subscription' })).toBe('allow')
    expect(paywallDecision({ role: 'OWNER', organizationStatus: 'SUSPENDED', path: '/paywall' })).toBe('allow')
    expect(paywallDecision({ role: 'OWNER', organizationStatus: 'SUSPENDED', path: '/app/subscriptionX' })).toBe('paywall')
  })
  it('never blocks active accounts, trials, super admins or residents here', () => {
    expect(paywallDecision({ role: 'OWNER', organizationStatus: 'ACTIVE', path: '/app' })).toBe('allow')
    expect(paywallDecision({ role: 'OWNER', organizationStatus: 'TRIAL', path: '/app' })).toBe('allow')
    expect(paywallDecision({ role: 'SUPER_ADMIN', organizationStatus: 'SUSPENDED', path: '/app' })).toBe('allow')
    expect(paywallDecision({ role: 'TENANT', organizationStatus: 'SUSPENDED', path: '/tenant' })).toBe('allow')
  })
})

describe('payment details', () => {
  it('parses and trims settings, ignoring junk', () => {
    expect(parsePaymentDetails({ upiId: ' pay@okhdfc ', ifsc: 7 })).toMatchObject({ upiId: 'pay@okhdfc', ifsc: '' })
  })
  it('builds a UPI link with the exact amount, or nothing without a UPI ID', () => {
    const link = upiPayLink({ upiId: 'pay@okhdfc', payeeName: 'StayFlow', amount: 8000, note: 'StayFlow SF-1' })
    expect(link).toContain('pa=pay%40okhdfc')
    expect(link).toContain('am=8000')
    expect(upiPayLink({ upiId: '', payeeName: '', amount: 1, note: '' })).toBeNull()
  })
})
