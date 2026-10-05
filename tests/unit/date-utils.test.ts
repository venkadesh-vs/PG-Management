import { describe, expect, it } from 'vitest'
import { addMonths, dayOfMonth, daysInMonth, startOfMonth, toISODate } from '@/lib/utils'

describe('test environment', () => {
  it('runs in India Standard Time', () => {
    expect(process.env.TZ).toBe('Asia/Kolkata')
    // IST is UTC+5:30 all year (no DST): getTimezoneOffset is -330.
    expect(new Date(2026, 0, 15).getTimezoneOffset()).toBe(-330)
    expect(new Date(2026, 6, 15).getTimezoneOffset()).toBe(-330)
  })
})

describe('startOfMonth', () => {
  it('returns local midnight on the 1st', () => {
    const d = startOfMonth(new Date(2026, 4, 17, 15, 42))
    expect(toISODate(d)).toBe('2026-05-01')
    expect([d.getHours(), d.getMinutes(), d.getSeconds()]).toEqual([0, 0, 0])
  })

  it('stays in the local month for an instant that is still the previous day in UTC', () => {
    // 1 June 2026 02:00 IST is 31 May 20:30 UTC.
    const d = startOfMonth(new Date('2026-05-31T20:30:00Z'))
    expect(toISODate(d)).toBe('2026-06-01')
  })
})

describe('addMonths', () => {
  it('adds whole months', () => {
    expect(toISODate(addMonths(new Date(2026, 0, 10), 1))).toBe('2026-02-10')
    expect(toISODate(addMonths(new Date(2026, 10, 5), 3))).toBe('2027-02-05')
    expect(toISODate(addMonths(new Date(2026, 2, 5), -3))).toBe('2025-12-05')
  })

  it('clamps to the last day instead of rolling into the next month', () => {
    expect(toISODate(addMonths(new Date(2026, 0, 31), 1))).toBe('2026-02-28')
    expect(toISODate(addMonths(new Date(2028, 0, 31), 1))).toBe('2028-02-29') // leap year
    expect(toISODate(addMonths(new Date(2026, 2, 31), 1))).toBe('2026-04-30')
    expect(toISODate(addMonths(new Date(2026, 4, 31), -1))).toBe('2026-04-30')
  })

  it('does not mutate its input and keeps the time of day', () => {
    const input = new Date(2026, 0, 31, 9, 30)
    const out = addMonths(input, 1)
    expect(toISODate(input)).toBe('2026-01-31')
    expect([out.getHours(), out.getMinutes()]).toEqual([9, 30])
  })
})

describe('daysInMonth', () => {
  it.each([
    [2026, 0, 31],
    [2026, 1, 28],
    [2028, 1, 29],
    [2100, 1, 28], // not a leap year
    [2000, 1, 29],
    [2026, 3, 30],
    [2026, 11, 31],
  ])('%i-%i has %i days', (y, m, n) => {
    expect(daysInMonth(new Date(y, m, 15))).toBe(n)
  })
})

describe('dayOfMonth', () => {
  it('uses the preferred day when the month has it', () => {
    expect(toISODate(dayOfMonth(2026, 4, 5))).toBe('2026-05-05')
  })

  it('clamps to the last day of a shorter month', () => {
    expect(toISODate(dayOfMonth(2026, 1, 31))).toBe('2026-02-28')
    expect(toISODate(dayOfMonth(2028, 1, 30))).toBe('2028-02-29')
    expect(toISODate(dayOfMonth(2026, 8, 31))).toBe('2026-09-30')
  })

  it('handles a month index past December', () => {
    expect(toISODate(dayOfMonth(2026, 12, 31))).toBe('2027-01-31')
  })
})

describe('toISODate', () => {
  it('formats the local calendar date with zero padding', () => {
    expect(toISODate(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('uses the IST date, not the UTC date', () => {
    // 23:59 IST on 31 Dec is 18:29 UTC the same day; 00:30 IST on 1 Jan is 19:00 UTC on 31 Dec.
    expect(toISODate(new Date('2026-12-31T19:00:00Z'))).toBe('2027-01-01')
    expect(toISODate(new Date('2026-12-31T18:29:00Z'))).toBe('2026-12-31')
  })
})
