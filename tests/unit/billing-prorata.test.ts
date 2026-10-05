import { describe, expect, it, vi } from 'vitest'

// buildInvoiceLines is pure, but billing.ts imports the database client and
// notification modules at load time. Stub those so no DB or Next runtime is touched.
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/tenancy', () => ({
  ConflictError: class extends Error {},
  NotFoundError: class extends Error {},
  ValidationError: class extends Error {},
}))
vi.mock('@/server/events', () => ({ notifyOrgAdmins: vi.fn(), notifyResident: vi.fn(), recordActivity: vi.fn() }))
vi.mock('@/server/integrations/whatsapp', () => ({ buildUpiLink: vi.fn(), sendWhatsApp: vi.fn() }))

const { buildInvoiceLines } = await import('@/server/services/billing')
const { endOfMonth, startOfMonth } = await import('@/lib/utils')

type ResidentLike = Parameters<typeof buildInvoiceLines>[0]

function resident(over: Partial<ResidentLike> = {}): ResidentLike {
  return {
    rentAmount: 9000,
    maintenanceFee: 0,
    foodOptIn: false,
    foodCharge: 0,
    discountAmount: 0,
    joiningDate: new Date(2025, 0, 1),
    ...over,
  }
}

function period(year: number, month: number) {
  const start = startOfMonth(new Date(year, month, 1))
  return [start, endOfMonth(start)] as const
}

describe('buildInvoiceLines (pro-rata)', () => {
  it('bills a full month for a resident who joined earlier', () => {
    const { lines, subtotal } = buildInvoiceLines(resident(), ...period(2026, 5))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ kind: 'RENT', unitPrice: 9000 })
    expect(lines[0].label).not.toMatch(/days/)
    expect(subtotal).toBe(9000)
  })

  it('bills a full month when joining on the 1st of the period', () => {
    const { subtotal } = buildInvoiceLines(resident({ joiningDate: new Date(2026, 5, 1) }), ...period(2026, 5))
    expect(subtotal).toBe(9000)
  })

  it('pro-rates from the joining day inclusive (18 June → 13/30 days)', () => {
    const { lines, subtotal } = buildInvoiceLines(
      resident({ joiningDate: new Date(2026, 5, 18, 14, 0) }),
      ...period(2026, 5),
    )
    expect(lines[0].label).toContain('(13/30 days)')
    expect(subtotal).toBe(Math.round((9000 * 13) / 30))
  })

  it('bills one day when joining on the last day of a 31-day month', () => {
    const { subtotal } = buildInvoiceLines(resident({ rentAmount: 3100, joiningDate: new Date(2026, 6, 31) }), ...period(2026, 6))
    expect(subtotal).toBe(100)
  })

  it('uses 28 days for February', () => {
    const { lines } = buildInvoiceLines(resident({ joiningDate: new Date(2026, 1, 15) }), ...period(2026, 1))
    expect(lines[0].label).toContain('(14/28 days)')
  })

  it('pro-rates maintenance and food with the same factor and caps the discount', () => {
    const { lines, subtotal, discount } = buildInvoiceLines(
      resident({
        rentAmount: 6000,
        maintenanceFee: 600,
        foodOptIn: true,
        foodCharge: 3000,
        discountAmount: 50000,
        joiningDate: new Date(2026, 8, 16), // 15 of 30 days
      }),
      ...period(2026, 8),
    )
    expect(lines.map((l) => [l.kind, l.unitPrice])).toEqual([
      ['RENT', 3000],
      ['MAINTENANCE', 300],
      ['FOOD', 1500],
    ])
    expect(subtotal).toBe(4800)
    expect(discount).toBe(4800)
  })

  it('omits food when the resident has not opted in', () => {
    const { lines } = buildInvoiceLines(resident({ foodOptIn: false, foodCharge: 3000 }), ...period(2026, 5))
    expect(lines.map((l) => l.kind)).toEqual(['RENT'])
  })
})
