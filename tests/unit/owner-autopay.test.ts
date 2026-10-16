import { describe, expect, it } from 'vitest'
import { planNotices } from '@/lib/autopay'
import { groupBills, ownerAutopayLimit } from '@/lib/owner-autopay'

describe('ownerAutopayLimit', () => {
  it('is about twice the bill, rounded up to ₹500', () => {
    expect(ownerAutopayLimit(1_770, 'UPI')).toBe(4_000)
    expect(ownerAutopayLimit(5_900, 'EMANDATE')).toBe(12_000)
  })

  it('stops at the method ceiling', () => {
    expect(ownerAutopayLimit(9_000, 'UPI')).toBe(15_000)
    expect(ownerAutopayLimit(9_000, 'CARD')).toBe(15_000)
    expect(ownerAutopayLimit(9_000, 'EMANDATE')).toBe(18_000)
  })

  it('rules a method out when the bill itself is above its ceiling', () => {
    expect(ownerAutopayLimit(16_000, 'UPI')).toBeNull()
    expect(ownerAutopayLimit(16_000, 'CARD')).toBeNull()
    expect(ownerAutopayLimit(16_000, 'EMANDATE')).toBe(32_000)
  })
})

describe('groupBills', () => {
  const day = (d: number, h = 0) => new Date(2026, 10, d, h)

  it('groups unpaid lines by due day and adds up what is owed', () => {
    const bills = groupBills([
      { id: 'a', dueDate: day(5), total: 1_180, amountPaid: 0, status: 'PENDING' },
      { id: 'b', dueDate: day(5, 9), total: 2_360, amountPaid: 360, status: 'PARTIALLY_PAID' },
      { id: 'c', dueDate: day(5), total: 900, amountPaid: 900, status: 'PAID' },
      { id: 'd', dueDate: new Date(2026, 9, 5), total: 1_000, amountPaid: 0, status: 'OVERDUE' },
    ])
    expect(bills).toHaveLength(2)
    expect(bills[0]).toMatchObject({ balance: 1_000, lineIds: ['d'] })
    expect(bills[1]).toMatchObject({ balance: 3_180, lineIds: ['a', 'b'], dueDate: day(5) })
  })

  it('feeds planNotices: a notice the day before the due day', () => {
    const bills = groupBills([{ id: 'a', dueDate: day(5), total: 3_000, amountPaid: 0, status: 'PENDING' }])
    const early = planNotices({ today: day(3, 6), offsetDays: 0, maxAmount: 6_000, mandateActive: true, invoices: bills, attempts: [] })
    expect(early).toEqual([])
    const plans = planNotices({ today: day(4, 6), offsetDays: 0, maxAmount: 6_000, mandateActive: true, invoices: bills, attempts: [] })
    expect(plans).toEqual([{ invoiceId: bills[0].id, action: 'notify', amount: 3_000, chargeDate: day(5) }])
    const over = planNotices({ today: day(4, 6), offsetDays: 0, maxAmount: 2_000, mandateActive: true, invoices: bills, attempts: [] })
    expect(over[0].action).toBe('skip')
  })
})
