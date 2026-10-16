import { describe, expect, it } from 'vitest'
import {
  alignedBillDate,
  allocate,
  applyCredit,
  billStage,
  clampDueDay,
  lateFee,
  lateFeeDate,
  nextBillDate,
  pauseDate,
  prorated,
  referralCredit,
} from '@/lib/owner-bill'

const d = (s: string) => new Date(`${s}T00:00:00`)

describe('owner due day', () => {
  it('stays between the 1st and the 10th', () => {
    expect(clampDueDay(0)).toBe(1)
    expect(clampDueDay(15)).toBe(10)
    expect(clampDueDay(7.4)).toBe(7)
    expect(clampDueDay(Number.NaN)).toBe(5)
  })
  it('finds the next bill date', () => {
    expect(nextBillDate(5, d('2026-10-03'))).toEqual(d('2026-10-05'))
    expect(nextBillDate(5, d('2026-10-05'))).toEqual(d('2026-10-05'))
    expect(nextBillDate(5, d('2026-10-06'))).toEqual(d('2026-11-05'))
    expect(nextBillDate(10, d('2026-12-20'))).toEqual(d('2027-01-10'))
  })
  it('changing the due day back and forth never pushes the bill months ahead', () => {
    // Trial ends 29 Oct; the owner clicks day 5, 1, 10, 1, 7, 1 in a row.
    let sub = { nextBillingDate: d('2026-10-29'), alignedFrom: null as Date | null }
    for (const day of [5, 1, 10, 1, 7, 1]) {
      const target = alignedBillDate(day, sub, d('2026-10-16'))
      sub = { nextBillingDate: target, alignedFrom: sub.alignedFrom ?? sub.nextBillingDate }
    }
    expect(sub.nextBillingDate).toEqual(d('2026-11-01'))
    // A date that already drifted is pulled back once the original is known.
    expect(alignedBillDate(1, { nextBillingDate: d('2027-06-01'), alignedFrom: d('2026-10-29') }, d('2026-10-16'))).toEqual(d('2026-11-01'))
    // Never a date in the past.
    expect(alignedBillDate(1, { nextBillingDate: d('2026-12-01'), alignedFrom: d('2026-10-29') }, d('2026-11-03'))).toEqual(d('2026-12-01'))
  })
})

describe('late payment stages (due on the 10th)', () => {
  const due = d('2026-10-10')
  it('warns on the 11th and 12th, fees on the 13th, pauses 21 days after', () => {
    expect(billStage(due, d('2026-10-09'))).toBe('upcoming')
    expect(billStage(due, d('2026-10-10'))).toBe('due')
    expect(billStage(due, d('2026-10-11'))).toBe('warning')
    expect(billStage(due, d('2026-10-12'))).toBe('warning')
    expect(billStage(due, d('2026-10-13'))).toBe('late')
    expect(billStage(due, d('2026-10-30'))).toBe('late')
    expect(billStage(due, d('2026-10-31'))).toBe('paused')
    expect(lateFeeDate(due)).toEqual(d('2026-10-13'))
    expect(pauseDate(due)).toEqual(d('2026-10-31'))
  })
  it('charges 1% once', () => {
    expect(lateFee(32000)).toBe(320)
    expect(lateFee(0)).toBe(0)
    expect(lateFee(40)).toBe(1)
  })
})

describe('referral credit', () => {
  it('is half of the friend’s first month, whatever their PG count', () => {
    expect(referralCredit(14000)).toBe(7000)
    expect(referralCredit(8000)).toBe(4000)
  })
  it('comes off the bill and carries what is left', () => {
    expect(applyCredit(32000, 7000)).toEqual({ used: 7000, left: 0 })
    expect(applyCredit(5000, 7000)).toEqual({ used: 2500, left: 4500 })
  })

  it('never takes more than half a bill: one PG at 7,000 with 20,000 credit', () => {
    let credit = 20000
    const paid: number[] = []
    while (credit > 0) {
      const { used, left } = applyCredit(7000, credit)
      paid.push(7000 - used)
      credit = left
    }
    expect(paid).toEqual([3500, 3500, 3500, 3500, 3500, 4500])
  })
})

describe('one payment for the whole bill', () => {
  it('pays each PG line in order and reports any extra', () => {
    const lines = [
      { id: 'a', due: 8000 },
      { id: 'b', due: 8000 },
      { id: 'c', due: 0 },
    ]
    expect(allocate(16000, lines)).toEqual({ parts: [{ id: 'a', amount: 8000 }, { id: 'b', amount: 8000 }], unallocated: 0 })
    expect(allocate(10000, lines)).toEqual({ parts: [{ id: 'a', amount: 8000 }, { id: 'b', amount: 2000 }], unallocated: 0 })
    expect(allocate(17000, lines).unallocated).toBe(1000)
  })
})

describe('part-month for a PG added mid-cycle', () => {
  it('charges only the days used', () => {
    // Added on the 20th, bill on the 5th: 16 of 31 days of ₹8,000.
    expect(prorated(8000, d('2026-10-20'), d('2026-11-05'))).toBe(4129)
    expect(prorated(8000, d('2026-11-05'), d('2026-11-05'))).toBe(0)
  })
})
