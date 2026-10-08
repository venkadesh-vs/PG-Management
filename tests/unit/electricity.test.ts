import { describe, expect, it } from 'vitest'
import {
  billAmount,
  billingMonthLabel,
  computeRoomBill,
  ElectricityError,
  monthKeyOf,
  monthStart,
  occupantDays,
  presentAtEnd,
  shareLabel,
  splitByWeight,
  toPaise,
  toTenths,
  unitsBetween,
  type Stay,
} from '@/lib/electricity'

const d = (s: string) => {
  const [y, m, day] = s.split('-').map(Number)
  return new Date(y, m - 1, day)
}

const fullStay = (id: string, from = '2026-09-01', to: string | null = null): Stay => ({
  residentId: id,
  from: d(from),
  to: to ? d(to) : null,
})

describe('readings and rates', () => {
  it('parses readings to tenths', () => {
    expect(toTenths(1340)).toBe(13400)
    expect(toTenths('1340.5')).toBe(13405)
    expect(toTenths('0')).toBe(0)
    expect(toTenths('12.50')).toBe(125)
  })

  it('refuses negative, non-numeric and over-precise readings', () => {
    expect(() => toTenths(-1)).toThrow(ElectricityError)
    expect(() => toTenths('abc')).toThrow(/number/)
    expect(() => toTenths('10.25')).toThrow(/one decimal/)
  })

  it('parses rates to paise and refuses zero', () => {
    expect(toPaise(13)).toBe(1300)
    expect(toPaise('13.5')).toBe(1350)
    expect(toPaise('7.25')).toBe(725)
    expect(() => toPaise(0)).toThrow(/more than zero/)
    expect(() => toPaise('1.234')).toThrow(/two decimal/)
  })

  it('computes units and refuses a lower current reading', () => {
    expect(unitsBetween(12500, 13400)).toBe(900)
    expect(() => unitsBetween(13400, 12500)).toThrow(/lower than the previous/)
  })

  it('rounds the bill to whole rupees', () => {
    expect(billAmount(900, 1300)).toBe(1170) // 90 × ₹13
    expect(billAmount(1100, 1400)).toBe(1540) // 110 × ₹14
    expect(billAmount(905, 1350)).toBe(1222) // 90.5 × ₹13.50 = 1221.75
    expect(billAmount(0, 1300)).toBe(0)
  })
})

describe('splitByWeight', () => {
  it('always sums to the amount', () => {
    for (const [amount, weights] of [
      [1540, [1, 1, 1]],
      [1000, [31, 15, 7]],
      [1, [1, 1, 1]],
      [999, [3, 3, 3, 3, 3, 3, 3]],
    ] as const) {
      const parts = splitByWeight(amount, [...weights])
      expect(parts.reduce((s, x) => s + x, 0)).toBe(amount)
    }
  })

  it('gives the extra rupee by largest remainder, ties to the first', () => {
    expect(splitByWeight(1540, [1, 1, 1])).toEqual([514, 513, 513])
    expect(splitByWeight(1170, [1, 1, 1])).toEqual([390, 390, 390])
  })

  it('returns zeros for nothing to split', () => {
    expect(splitByWeight(0, [1, 2])).toEqual([0, 0])
    expect(splitByWeight(100, [0, 0])).toEqual([0, 0])
  })
})

describe('occupantDays', () => {
  const periodStart = d('2026-10-01')
  const periodEnd = d('2026-10-31')

  it('counts full stays and partial ones', () => {
    const days = occupantDays({
      stays: [fullStay('a'), { residentId: 'b', from: d('2026-10-16'), to: null }],
      periodStart,
      periodEnd,
    })
    expect(days.get('a')).toBe(30)
    expect(days.get('b')).toBe(15)
  })

  it('handles a transfer out and back in, and moves inside the room', () => {
    const days = occupantDays({
      stays: [
        { residentId: 'a', from: d('2026-09-01'), to: d('2026-10-11') }, // left on the 11th
        { residentId: 'a', from: d('2026-10-21'), to: null }, // came back on the 21st
        { residentId: 'b', from: d('2026-09-01'), to: d('2026-10-05') }, // bed A
        { residentId: 'b', from: d('2026-10-05'), to: null }, // bed B, same room
      ],
      periodStart,
      periodEnd,
    })
    expect(days.get('a')).toBe(10 + 10)
    expect(days.get('b')).toBe(30)
  })

  it('leaves out people who were not there', () => {
    const days = occupantDays({
      stays: [{ residentId: 'gone', from: d('2026-08-01'), to: d('2026-09-30') }],
      periodStart,
      periodEnd,
    })
    expect(days.size).toBe(0)
  })

  it('subtracts leave days (inclusive)', () => {
    const days = occupantDays({
      stays: [fullStay('a')],
      leaves: [{ residentId: 'a', from: d('2026-10-08'), to: d('2026-10-10') }],
      periodStart,
      periodEnd,
    })
    expect(days.get('a')).toBe(27)
  })

  it('refuses a period that does not move forward', () => {
    expect(() => occupantDays({ stays: [], periodStart: periodEnd, periodEnd: periodStart })).toThrow(/after the previous/)
  })

  it('finds who is present on the last day', () => {
    const present = presentAtEnd(
      [fullStay('a'), { residentId: 'b', from: d('2026-09-01'), to: d('2026-10-31') }, { residentId: 'c', from: d('2026-09-01'), to: d('2026-10-20') }],
      periodEnd,
    )
    expect([...present].sort()).toEqual(['a', 'b'])
  })
})

describe('computeRoomBill', () => {
  const base = {
    periodStart: d('2026-10-01'),
    periodEnd: d('2026-10-31'),
    method: 'DAYS_STAYED' as const,
  }

  it('October: 90 units × ₹13 = ₹1,170 ÷ 3 = ₹390 each', () => {
    const bill = computeRoomBill({
      ...base,
      previousReading: 1250,
      currentReading: 1340,
      ratePerUnit: 13,
      stays: [fullStay('a'), fullStay('b'), fullStay('c')],
    })
    expect(bill.units).toBe(90)
    expect(bill.amount).toBe(1170)
    expect(bill.occupantCount).toBe(3)
    expect(bill.shares.map((s) => s.share)).toEqual([390, 390, 390])
  })

  it('November: 110 units × ₹14 = ₹1,540 split 514 / 513 / 513', () => {
    const bill = computeRoomBill({
      ...base,
      periodStart: d('2026-10-31'),
      periodEnd: d('2026-11-30'),
      previousReading: 1340,
      currentReading: 1450,
      ratePerUnit: 14,
      stays: [fullStay('a'), fullStay('b'), fullStay('c')],
    })
    expect(bill.amount).toBe(1540)
    expect(bill.shares.map((s) => s.share).sort((x, y) => y - x)).toEqual([514, 513, 513])
    expect(bill.shares.reduce((s, x) => s + x.share, 0)).toBe(1540)
  })

  it('rooms are independent: 120 × ₹14 ÷ 4 and 60 × ₹13 ÷ 2', () => {
    const r102 = computeRoomBill({ ...base, previousReading: 0, currentReading: 120, ratePerUnit: 14, stays: ['a', 'b', 'c', 'd'].map((x) => fullStay(x)) })
    const r103 = computeRoomBill({ ...base, previousReading: 0, currentReading: 60, ratePerUnit: 13, stays: ['e', 'f'].map((x) => fullStay(x)) })
    expect(r102.shares.map((s) => s.share)).toEqual([420, 420, 420, 420])
    expect(r103.shares.map((s) => s.share)).toEqual([390, 390])
  })

  it('splits by the days people actually lived there, not by beds', () => {
    // 30-day period, ₹1,200: A all month, B joined mid-month (15 days).
    const bill = computeRoomBill({
      ...base,
      previousReading: 0,
      currentReading: 100,
      ratePerUnit: 12,
      stays: [fullStay('a'), { residentId: 'b', from: d('2026-10-16'), to: null }],
    })
    expect(bill.amount).toBe(1200)
    const share = Object.fromEntries(bill.shares.map((s) => [s.residentId, s.share]))
    expect(share).toEqual({ a: 800, b: 400 })
  })

  it('equal split counts only people present on the reading date', () => {
    const bill = computeRoomBill({
      ...base,
      method: 'EQUAL_PRESENT',
      previousReading: 0,
      currentReading: 100,
      ratePerUnit: 12,
      stays: [fullStay('a'), fullStay('b'), { residentId: 'gone', from: d('2026-09-01'), to: d('2026-10-10') }],
    })
    expect(bill.shares.map((s) => s.share)).toEqual([600, 600])
  })

  it('leave days reduce the share when excluded', () => {
    const bill = computeRoomBill({
      ...base,
      previousReading: 0,
      currentReading: 100,
      ratePerUnit: 10,
      stays: [fullStay('a'), fullStay('b')],
      leaves: [{ residentId: 'b', from: d('2026-10-01'), to: d('2026-10-15') }], // 15 days away
    })
    const share = Object.fromEntries(bill.shares.map((s) => [s.residentId, s.share]))
    expect(share.a + share.b).toBe(1000)
    expect(share.a).toBe(667) // 30 of 45 person-days
  })

  it('zero units bills nothing', () => {
    const bill = computeRoomBill({ ...base, previousReading: 500, currentReading: 500, ratePerUnit: 13, stays: [fullStay('a')] })
    expect(bill.amount).toBe(0)
    expect(bill.shares[0].share).toBe(0)
  })

  it('decimal readings and rates', () => {
    const bill = computeRoomBill({ ...base, previousReading: '100.5', currentReading: '191', ratePerUnit: '13.50', stays: [fullStay('a'), fullStay('b')] })
    expect(bill.units).toBe(90.5)
    expect(bill.amount).toBe(1222)
    expect(bill.shares.reduce((s, x) => s + x.share, 0)).toBe(1222)
  })

  it('an empty room needs the owner to absorb it', () => {
    expect(() => computeRoomBill({ ...base, previousReading: 0, currentReading: 10, ratePerUnit: 13, stays: [] })).toThrow(/Nobody lived/)
    const absorbed = computeRoomBill({ ...base, previousReading: 0, currentReading: 10, ratePerUnit: 13, stays: [], ownerAbsorbs: true })
    expect(absorbed.ownerAbsorbed).toBe(true)
    expect(absorbed.amount).toBe(130)
    expect(absorbed.shares).toEqual([])
  })

  it('refuses a lower reading', () => {
    expect(() => computeRoomBill({ ...base, previousReading: 1340, currentReading: 1250, ratePerUnit: 13, stays: [fullStay('a')] })).toThrow(/lower/)
  })
})

describe('labels and months', () => {
  it('formats months', () => {
    expect(billingMonthLabel('2026-10')).toBe('Oct 2026')
    expect(monthKeyOf(d('2026-01-15'))).toBe('2026-01')
    expect(monthStart('2026-11').getMonth()).toBe(10)
    expect(() => monthStart('2026-13')).toThrow()
  })

  it('writes a readable invoice line', () => {
    expect(
      shareLabel({ month: '2026-10', roomNumber: '101', units: 90, rate: 13, amount: 1170, daysStayed: 30, periodDays: 30, method: 'DAYS_STAYED', occupantCount: 3 }),
    ).toBe('Electricity Oct 2026 · Room 101 · 90 units × ₹13 = ₹1170, 30 of 30 days, 3 sharing')
  })
})
