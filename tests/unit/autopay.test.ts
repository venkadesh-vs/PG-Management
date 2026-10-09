import { describe, expect, it } from 'vitest'
import {
  autopayMaxAmount,
  clampDay,
  dayProblem,
  dayWindowProblem,
  nextChargeDate,
  noticeDate,
  ordinal,
  chargeAmount,
  isDueForCharge,
  mandateStatusFromToken,
  nextRetry,
  planNotices,
} from '@/lib/autopay'

const d = (s: string) => new Date(`${s}T00:00:00`)

describe('autopayMaxAmount', () => {
  it('is the monthly bill times the percent, rounded up to the next 500', () => {
    expect(autopayMaxAmount({ monthlyBill: 8_000, percent: 150 })).toBe(12_000)
    expect(autopayMaxAmount({ monthlyBill: 8_300, percent: 150 })).toBe(12_500)
  })
  it('never goes below the bill or below 500, and respects a cap', () => {
    expect(autopayMaxAmount({ monthlyBill: 8_000, percent: 50 })).toBe(8_000)
    expect(autopayMaxAmount({ monthlyBill: 100, percent: 150 })).toBe(500)
    expect(autopayMaxAmount({ monthlyBill: 12_000, percent: 150, cap: 15_000 })).toBe(15_000)
    expect(autopayMaxAmount({ monthlyBill: 8_000, percent: 150, cap: null })).toBe(12_000)
  })
})

describe('planNotices', () => {
  const base = { offsetDays: 0, maxAmount: 12_000, mandateActive: true, attempts: [] }
  const inv = (id: string, due: string, balance = 8_624, status = 'PENDING') => ({ id, dueDate: d(due), balance, status })

  it('sends the notice the day before the due date and debits on the due date', () => {
    const plans = planNotices({ ...base, today: d('2026-11-04'), invoices: [inv('a', '2026-11-05')] })
    expect(plans).toEqual([{ invoiceId: 'a', action: 'notify', amount: 8_624, chargeDate: d('2026-11-05') }])
  })
  it('waits when the due date is more than a day away', () => {
    expect(planNotices({ ...base, today: d('2026-11-02'), invoices: [inv('a', '2026-11-05')] })).toEqual([])
  })
  it('moves an already-due debit to tomorrow so there is always a day of notice', () => {
    const plans = planNotices({ ...base, today: d('2026-11-09'), invoices: [inv('a', '2026-11-05', 8_624, 'OVERDUE')] })
    expect(plans[0]).toMatchObject({ action: 'notify', chargeDate: d('2026-11-10') })
  })
  it('honours the owner offset', () => {
    const plans = planNotices({ ...base, offsetDays: 2, today: d('2026-11-06'), invoices: [inv('a', '2026-11-05')] })
    expect(plans[0]).toMatchObject({ action: 'notify', chargeDate: d('2026-11-07') })
  })
  it('skips amounts above the limit, paid invoices and invoices already handled', () => {
    const plans = planNotices({
      ...base,
      today: d('2026-11-04'),
      invoices: [inv('big', '2026-11-05', 20_000), inv('paid', '2026-11-05', 0, 'PAID'), inv('done', '2026-11-05')],
      attempts: [{ invoiceId: 'done', attemptNumber: 1, status: 'SUCCEEDED' }],
    })
    expect(plans).toHaveLength(1)
    expect(plans[0]).toMatchObject({ invoiceId: 'big', action: 'skip' })
  })
  it('does nothing without an active mandate', () => {
    expect(planNotices({ ...base, mandateActive: false, today: d('2026-11-04'), invoices: [inv('a', '2026-11-05')] })).toEqual([])
  })
})

describe('isDueForCharge', () => {
  const notifiedAt = new Date('2026-11-04T06:00:00')
  it('charges on the charge date once 24 hours have passed since the notice', () => {
    expect(isDueForCharge({ status: 'NOTIFIED', chargeDate: d('2026-11-05'), notifiedAt }, new Date('2026-11-05T06:00:00'))).toBe(true)
  })
  it('never charges early or without a full day of notice', () => {
    expect(isDueForCharge({ status: 'NOTIFIED', chargeDate: d('2026-11-05'), notifiedAt }, new Date('2026-11-04T23:00:00'))).toBe(false)
    expect(isDueForCharge({ status: 'NOTIFIED', chargeDate: d('2026-11-05'), notifiedAt }, new Date('2026-11-05T05:59:00'))).toBe(false)
  })
  it('never charges an attempt twice', () => {
    expect(isDueForCharge({ status: 'INITIATED', chargeDate: d('2026-11-05'), notifiedAt }, new Date('2026-11-06T06:00:00'))).toBe(false)
  })
})

describe('chargeAmount and retries', () => {
  it('charges what the notice said, or less if part was paid', () => {
    expect(chargeAmount(8_624, 8_624)).toBe(8_624)
    expect(chargeAmount(8_624, 5_000)).toBe(5_000)
    expect(chargeAmount(8_624, 9_000)).toBe(8_624)
    expect(chargeAmount(8_624, 0)).toBe(0)
  })
  it('retries the next day until the retry days are used up', () => {
    expect(nextRetry({ attemptNumber: 1, retryDays: 2, today: d('2026-11-05') })).toEqual({ attemptNumber: 2, chargeDate: d('2026-11-06') })
    expect(nextRetry({ attemptNumber: 2, retryDays: 2, today: d('2026-11-06') })).toEqual({ attemptNumber: 3, chargeDate: d('2026-11-07') })
    expect(nextRetry({ attemptNumber: 3, retryDays: 2, today: d('2026-11-07') })).toBeNull()
    expect(nextRetry({ attemptNumber: 1, retryDays: 0, today: d('2026-11-05') })).toBeNull()
  })
  it('maps Razorpay token status', () => {
    expect(mandateStatusFromToken('confirmed')).toBe('ACTIVE')
    expect(mandateStatusFromToken('rejected')).toBe('FAILED')
    expect(mandateStatusFromToken('initiated')).toBe('PENDING')
  })
})


describe('debit day window', () => {
  it('validates the owner window (1 <= min <= max <= 28)', () => {
    expect(dayWindowProblem(1, 10)).toBeNull()
    expect(dayWindowProblem(5, 5)).toBeNull()
    expect(dayWindowProblem(0, 10)).toMatch(/1 or later/)
    expect(dayWindowProblem(1, 29)).toMatch(/28 at most/)
    expect(dayWindowProblem(10, 5)).toMatch(/on or before/)
    expect(dayWindowProblem(1.5, 10)).toMatch(/whole days/)
  })
  it('checks a resident day against the window', () => {
    expect(dayProblem(7, { min: 1, max: 10 })).toBeNull()
    expect(dayProblem(12, { min: 1, max: 10 })).toBe('Pick a day from 1 to 10')
    expect(clampDay(12, { min: 1, max: 10 })).toBe(10)
    expect(clampDay(0, { min: 3, max: 10 })).toBe(3)
  })
  it('finds the next debit date: this month, or next month once the day has passed', () => {
    expect(nextChargeDate(7, d('2026-10-03'))).toEqual(d('2026-10-07'))
    expect(nextChargeDate(7, d('2026-10-07'))).toEqual(d('2026-10-07'))
    expect(nextChargeDate(7, d('2026-10-09'))).toEqual(d('2026-11-07'))
    expect(nextChargeDate(28, d('2027-02-28'))).toEqual(d('2027-02-28'))
    expect(nextChargeDate(5, d('2026-12-20'))).toEqual(d('2027-01-05'))
  })
  it('sends the notice the day before, across month ends', () => {
    expect(noticeDate(d('2026-11-07'))).toEqual(d('2026-11-06'))
    expect(noticeDate(d('2026-11-01'))).toEqual(d('2026-10-31'))
  })
  it('writes ordinals', () => {
    expect([1, 2, 3, 4, 7, 11, 12, 13, 21, 22, 23, 28].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '7th', '11th', '12th', '13th', '21st', '22nd', '23rd', '28th'])
  })
})
