import { describe, expect, it } from 'vitest'
import {
  applyAdjustment,
  chargeLinesForPeriod,
  composeInvoice,
  dailyCollection,
  invoiceState,
  isLikelyDuplicate,
  planAllocation,
  prorationFor,
  releaseAllocations,
  rentForPeriod,
  rentOnDay,
  rentSegments,
  reverseAllocations,
  revisionDelta,
  unallocatedOf,
  type ChargeLike,
  type LedgerLike,
} from '@/lib/billing-calc'

const d = (y: number, m: number, day: number, h = 0) => new Date(y, m - 1, day, h)
const period = (y: number, m: number) => [d(y, m, 1), new Date(y, m, 0)] as const

function charge(over: Partial<ChargeLike> & Pick<ChargeLike, 'id' | 'kind'>): ChargeLike {
  return {
    category: 'OTHER',
    label: over.id,
    amount: 0,
    startDate: d(2026, 1, 1),
    endDate: null,
    billedInvoiceId: null,
    voidedAt: null,
    ...over,
  }
}

describe('charges on a monthly invoice', () => {
  const charges: ChargeLike[] = [
    charge({ id: 'laundry', kind: 'RECURRING', category: 'LAUNDRY', label: 'Laundry', amount: 600 }),
    charge({ id: 'disc', kind: 'DISCOUNT', category: 'DISCOUNT', label: 'Student discount', amount: 300 }),
    charge({ id: 'joining', kind: 'ONE_TIME', category: 'JOINING', label: 'Joining fee', amount: 1000, startDate: d(2026, 9, 16) }),
    // Not billed: voided, already billed, ended, starts later, one-time dated after the period.
    charge({ id: 'void', kind: 'RECURRING', amount: 999, voidedAt: d(2026, 8, 1) }),
    charge({ id: 'billed', kind: 'ONE_TIME', amount: 500, billedInvoiceId: 'inv-old' }),
    charge({ id: 'ended', kind: 'DISCOUNT', amount: 200, endDate: d(2026, 8, 31) }),
    charge({ id: 'later', kind: 'RECURRING', amount: 400, startDate: d(2026, 10, 1) }),
    charge({ id: 'fine-later', kind: 'ONE_TIME', category: 'FINE', amount: 250, startDate: d(2026, 10, 2) }),
  ]

  it('bills recurring + discount pro-rata and one-time in full for a part month', () => {
    const [start, end] = period(2026, 9) // September: 30 days
    const proration = prorationFor(d(2026, 9, 16), start, end) // 15 of 30 days
    expect(proration).toMatchObject({ billableDays: 15, totalDays: 30, proRated: true })

    const billing = chargeLinesForPeriod(charges, start, end, proration)
    expect(billing.lines.map((l) => [l.kind, l.unitPrice])).toEqual([
      ['LAUNDRY', 300],
      ['DISCOUNT', -150],
      ['JOINING', 1000],
    ])
    expect(billing.recurringIds).toEqual(['laundry'])
    expect(billing.discountIds).toEqual(['disc'])
    expect(billing.oneTimeIds).toEqual(['joining'])
    expect(billing.lines[0].label).toContain('(15/30 days)')

    const invoice = composeInvoice([{ kind: 'RENT', label: 'Rent', unitPrice: 4500 }], billing, 0)
    expect(invoice.subtotal).toBe(4500 + 300 + 1000)
    expect(invoice.discount).toBe(150)
    expect(invoice.total).toBe(5650)
    // Lines always add up to the total (discounts are negative lines).
    expect(invoice.lines.reduce((s, l) => s + l.unitPrice, 0)).toBe(invoice.total)
  })

  it('bills full amounts in a full month and picks up a charge that starts mid-month', () => {
    const [start, end] = period(2026, 10)
    const proration = prorationFor(d(2025, 1, 1), start, end)
    const billing = chargeLinesForPeriod(charges, start, end, proration)
    expect(billing.lines.map((l) => [l.label, l.unitPrice])).toEqual([
      ['Laundry', 600],
      ['Student discount', -300],
      ['Joining fee', 1000],
      ['later', 400],
      ['fine-later', 250],
    ])
  })

  it('never lets discounts take an invoice below zero', () => {
    const invoice = composeInvoice(
      [{ kind: 'RENT', label: 'Rent', unitPrice: 1000 }],
      { lines: [{ kind: 'DISCOUNT', label: 'Big', unitPrice: -800 }] },
      500,
    )
    expect(invoice.discount).toBe(1000)
    expect(invoice.total).toBe(0)
    expect(invoice.lines.filter((l) => l.kind === 'DISCOUNT').map((l) => l.unitPrice)).toEqual([-500, -500])
  })
})

describe('rent revisions', () => {
  // Rent went 8000 → 9000 from 15 Oct 2026; Resident.rentAmount holds 9000.
  const revisions = [{ oldRent: 8000, newRent: 9000, effectiveFrom: d(2026, 10, 15) }]

  it('uses the old rent before the effective date and the new rent from it', () => {
    expect(rentOnDay(d(2026, 10, 14, 18), 9000, revisions)).toBe(8000)
    expect(rentOnDay(d(2026, 10, 15), 9000, revisions)).toBe(9000)
    expect(rentOnDay(d(2026, 12, 1), 9000, revisions)).toBe(9000)
  })

  it('bills earlier months entirely at the old rent and later months at the new', () => {
    const [sep, sepEnd] = period(2026, 9)
    const [nov, novEnd] = period(2026, 11)
    const joined = d(2025, 1, 1)
    expect(rentForPeriod(sep, prorationFor(joined, sep, sepEnd), 9000, revisions)).toBe(8000)
    expect(rentForPeriod(nov, prorationFor(joined, nov, novEnd), 9000, revisions)).toBe(9000)
  })

  it('splits the month of the change by days (14 days old + 17 days new of 31)', () => {
    const [oct, octEnd] = period(2026, 10)
    const segments = rentSegments(oct, prorationFor(d(2025, 1, 1), oct, octEnd), 9000, revisions)
    expect(segments.map((s) => [s.fromDay, s.toDay, s.monthlyRent])).toEqual([
      [1, 14, 8000],
      [15, 31, 9000],
    ])
    expect(segments.reduce((s, x) => s + x.amount, 0)).toBe(Math.round((8000 * 14) / 31) + Math.round((9000 * 17) / 31))
  })

  it('works out the note for an already-invoiced month from the effective date only', () => {
    const [oct, octEnd] = period(2026, 10)
    const proration = prorationFor(d(2025, 1, 1), oct, octEnd)
    // Before: flat 8000, no revisions. After: the revision above.
    const delta = revisionDelta(oct, proration, 8000, [], 9000, revisions)
    expect(delta).toBe(Math.round((9000 * 17) / 31) - Math.round((8000 * 17) / 31))
    // A cut produces a negative delta (credit note).
    const cut = [{ oldRent: 8000, newRent: 7000, effectiveFrom: d(2026, 10, 1) }]
    expect(revisionDelta(oct, proration, 8000, [], 7000, cut)).toBe(-1000)
  })
})

describe('invoice adjustments', () => {
  const due = d(2026, 10, 5)
  const today = d(2026, 10, 3)

  it('a credit note reduces total and balance; a partly paid invoice stays partly paid', () => {
    const r = applyAdjustment({ total: 9000, amountPaid: 4000, dueDate: due, status: 'PARTIALLY_PAID' }, 'CREDIT', 1000, today)
    expect(r).toMatchObject({ total: 8000, amountPaid: 4000, balance: 4000, status: 'PARTIALLY_PAID', excessPaid: 0 })
  })

  it('a credit that clears the balance marks it paid', () => {
    const r = applyAdjustment({ total: 9000, amountPaid: 8500, dueDate: due, status: 'PARTIALLY_PAID' }, 'CREDIT', 500, today)
    expect(r).toMatchObject({ total: 8500, balance: 0, status: 'PAID' })
  })

  it('a credit on a paid invoice releases the excess as an advance', () => {
    const r = applyAdjustment({ total: 9000, amountPaid: 9000, dueDate: due, status: 'PAID' }, 'CREDIT', 1500, today)
    expect(r).toMatchObject({ total: 7500, amountPaid: 7500, balance: 0, status: 'PAID', excessPaid: 1500 })
    const released = releaseAllocations(
      [
        { id: 'a1', amount: 5000, createdAt: d(2026, 10, 1) },
        { id: 'a2', amount: 4000, createdAt: d(2026, 10, 2) },
      ],
      1500,
    )
    expect(released).toEqual([{ id: 'a2', amount: 2500, release: 1500 }])
  })

  it('a debit note reopens a paid invoice, and overdue once past due', () => {
    const paid = { total: 9000, amountPaid: 9000, dueDate: due, status: 'PAID' as const }
    expect(applyAdjustment(paid, 'DEBIT', 700, today)).toMatchObject({ total: 9700, balance: 700, status: 'PARTIALLY_PAID' })
    expect(applyAdjustment(paid, 'DEBIT', 700, d(2026, 10, 9))).toMatchObject({ balance: 700, status: 'OVERDUE' })
  })

  it('a waiver credits the remaining balance and marks the invoice waived', () => {
    const r = applyAdjustment({ total: 9000, amountPaid: 3000, dueDate: due, status: 'OVERDUE' }, 'CREDIT', 6000, today, { waiver: true })
    expect(r).toMatchObject({ total: 3000, amountPaid: 3000, balance: 0, status: 'WAIVED' })
  })

  it('refuses a credit above the invoice total', () => {
    expect(() => applyAdjustment({ total: 100, amountPaid: 0, dueDate: due, status: 'PENDING' }, 'CREDIT', 101, today)).toThrow()
  })

  it('invoiceState keeps cancelled invoices cancelled', () => {
    expect(invoiceState({ total: 100, amountPaid: 0, dueDate: due, status: 'CANCELLED' }, today).status).toBe('CANCELLED')
  })
})

describe('payment allocation', () => {
  const open = [
    { id: 'aug', balance: 3000, dueDate: d(2026, 8, 5) },
    { id: 'oct', balance: 9000, dueDate: d(2026, 10, 5) },
    { id: 'sep', balance: 9000, dueDate: d(2026, 9, 5) },
  ]

  it('pays oldest due first by default and keeps the rest as advance', () => {
    expect(planAllocation(open, 25000)).toEqual({
      allocations: [
        { invoiceId: 'aug', amount: 3000 },
        { invoiceId: 'sep', amount: 9000 },
        { invoiceId: 'oct', amount: 9000 },
      ],
      advance: 4000,
    })
  })

  it('pays the chosen invoices first, in the chosen order, then oldest-first', () => {
    expect(planAllocation(open, 10000, ['oct'])).toEqual({
      allocations: [
        { invoiceId: 'oct', amount: 9000 },
        { invoiceId: 'aug', amount: 1000 },
      ],
      advance: 0,
    })
  })

  it('ignores chosen ids that are not open', () => {
    expect(planAllocation(open, 2000, ['nope', 'sep']).allocations).toEqual([{ invoiceId: 'sep', amount: 2000 }])
  })

  it('counts refunds when working out unapplied money', () => {
    expect(unallocatedOf({ amount: 10000, refundedAmount: 1500, allocations: [{ amount: 6000 }] })).toBe(2500)
  })
})

describe('payment reversal', () => {
  it('restores the balances the payment cleared, and reopens paid invoices', () => {
    const today = d(2026, 10, 3)
    const before = [
      { id: 'sep', total: 9000, amountPaid: 9000, balance: 0, dueDate: d(2026, 9, 5), status: 'PAID' as const },
      { id: 'oct', total: 9000, amountPaid: 4000, balance: 5000, dueDate: d(2026, 10, 5), status: 'PARTIALLY_PAID' as const },
    ]
    // The reversed payment paid 6000 of Sep and 2000 of Oct.
    const after = reverseAllocations(
      before,
      [
        { invoiceId: 'sep', amount: 6000 },
        { invoiceId: 'oct', amount: 2000 },
      ],
      today,
    )
    expect(after.map((i) => [i.id, i.amountPaid, i.balance, i.status])).toEqual([
      ['sep', 3000, 6000, 'OVERDUE'],
      ['oct', 2000, 7000, 'PARTIALLY_PAID'],
    ])
    // Applying the same payment again gives back the original state.
    const reapplied = planAllocation(
      after.map((i) => ({ id: i.id, balance: i.balance, dueDate: i.dueDate })),
      8000,
      ['sep', 'oct'],
    )
    expect(reapplied.allocations).toEqual([
      { invoiceId: 'sep', amount: 6000 },
      { invoiceId: 'oct', amount: 2000 },
    ])
  })

  it('a fully reversed invoice with nothing paid goes back to pending', () => {
    const [inv] = reverseAllocations(
      [{ id: 'x', total: 500, amountPaid: 500, dueDate: d(2026, 10, 5), status: 'PAID' as const }],
      [{ invoiceId: 'x', amount: 500 }],
      d(2026, 10, 1),
    )
    expect(inv).toMatchObject({ amountPaid: 0, balance: 500, status: 'PENDING' })
  })
})

describe('duplicate payments', () => {
  const now = d(2026, 10, 7, 12)
  const existing = [
    { receipt: 'R1', amount: 9000, utr: '4278 1234 5678', reference: null, paidAt: d(2026, 10, 7, 9), createdAt: d(2026, 10, 7, 9), status: 'SUCCESS' },
    { receipt: 'R2', amount: 5000, utr: null, reference: 'CHQ-11', paidAt: d(2026, 10, 7, 9), createdAt: d(2026, 10, 7, 9), status: 'REVERSED' },
  ]

  it('flags the same amount and UTR within a day', () => {
    expect(isLikelyDuplicate({ amount: 9000, utr: '427812345678', paidAt: now }, existing, now)?.receipt).toBe('R1')
  })
  it('allows a different amount, a reversed original, or no reference at all', () => {
    expect(isLikelyDuplicate({ amount: 9001, utr: '427812345678', paidAt: now }, existing, now)).toBeNull()
    expect(isLikelyDuplicate({ amount: 5000, reference: 'CHQ-11', paidAt: now }, existing, now)).toBeNull()
    expect(isLikelyDuplicate({ amount: 9000, paidAt: now }, existing, now)).toBeNull()
  })
})

describe('daily collection report', () => {
  let n = 0
  const e = (residentId: string, at: Date, kind: string, debit: number, credit: number): LedgerLike => ({
    id: `e${++n}`,
    residentId,
    entryDate: at,
    kind,
    label: kind,
    debit,
    credit,
  })

  // Asha owes 9000 from September, Ravi has 2000 advance, Meena is clear.
  const ledger: LedgerLike[] = [
    e('asha', d(2026, 9, 1), 'CHARGE', 9000, 0),
    e('ravi', d(2026, 9, 1), 'CHARGE', 8000, 0),
    e('ravi', d(2026, 9, 3, 10), 'PAYMENT', 0, 10000),
    e('meena', d(2026, 9, 1), 'CHARGE', 7000, 0),
    e('meena', d(2026, 9, 2, 11), 'PAYMENT', 0, 7000),
    e('meena', d(2026, 9, 2, 11), 'DEPOSIT', 0, 0), // memo line
    // The day: 1 Oct 2026
    e('asha', d(2026, 10, 1), 'CHARGE', 9000, 0),
    e('ravi', d(2026, 10, 1), 'CHARGE', 8000, 0),
    e('meena', d(2026, 10, 1), 'CHARGE', 7000, 0),
    e('asha', d(2026, 10, 1, 9), 'PAYMENT', 0, 12000),
    e('meena', d(2026, 10, 1, 13), 'PAYMENT', 0, 7000),
    e('ravi', d(2026, 10, 1, 15), 'ADJUSTMENT', 0, 500), // credit note
    e('meena', d(2026, 10, 1, 17), 'ADJUSTMENT', 7000, 0), // payment reversed (bounced)
    e('asha', d(2026, 10, 1, 18), 'CHARGE', 300, 0), // late fee
    e('asha', d(2026, 10, 1, 19), 'WAIVER', 0, 300),
    // The next day — must not leak in.
    e('asha', d(2026, 10, 2, 9), 'PAYMENT', 0, 6000),
  ]

  it('opening + invoiced − collected ± adjustments = closing, and matches the ledger', () => {
    const r = dailyCollection(ledger, d(2026, 10, 1), new Date(2026, 9, 1, 23, 59, 59, 999))
    expect(r.opening).toBe(9000 - 2000 + 0)
    expect(r.invoiced).toBe(9000 + 8000 + 7000 + 300)
    expect(r.collected).toBe(12000 + 7000)
    expect(r.adjustments).toBe(-500 + 7000 - 300)
    expect(r.closing).toBe(r.opening + r.invoiced - r.collected + r.adjustments)

    // Independent check: the closing figure is the ledger summed to the end of the day.
    const endOfDay = new Date(2026, 9, 1, 23, 59, 59, 999)
    const ledgerClosing = ledger.filter((x) => x.entryDate <= endOfDay).reduce((s, x) => s + x.debit - x.credit, 0)
    expect(r.closing).toBe(ledgerClosing)

    // The lists behind each number add up to it.
    expect(r.entries.invoiced.reduce((s, x) => s + x.debit, 0)).toBe(r.invoiced)
    expect(r.entries.collected.reduce((s, x) => s + x.credit, 0)).toBe(r.collected)
    expect(r.entries.adjustments.reduce((s, x) => s + x.debit - x.credit, 0)).toBe(r.adjustments)
    expect([...r.openingByResident.values()].reduce((s, v) => s + v, 0)).toBe(r.opening)
    expect(r.openingByResident.get('ravi')).toBe(-2000)
  })

  it('chains: one day closing is the next day opening', () => {
    const day1 = dailyCollection(ledger, d(2026, 10, 1), new Date(2026, 9, 1, 23, 59, 59, 999))
    const day2 = dailyCollection(ledger, d(2026, 10, 2), new Date(2026, 9, 2, 23, 59, 59, 999))
    expect(day2.opening).toBe(day1.closing)
    expect(day2.collected).toBe(6000)
    expect(day2.closing).toBe(day1.closing - 6000)
  })
})
