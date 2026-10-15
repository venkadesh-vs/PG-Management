import { describe, expect, it } from 'vitest'
import { bedRent, cardRent, codeFromName, deriveRentCard, normaliseRentCard, sharingFor, standardRentFrom, stateFromPincode } from '@/lib/rent-card'

describe('rent card', () => {
  const card = normaliseRentCard({
    SINGLE: { nonAc: 12000, ac: 15000 },
    DOUBLE: { nonAc: '9000', ac: 11000 },
    TRIPLE: { nonAc: 7500 },
    QUAD: { ac: 8000 },
    DORM: { nonAc: 0, ac: '' },
    BOGUS: { nonAc: 1 },
  })

  it('keeps only real prices and sharing types', () => {
    expect(card.DOUBLE).toEqual({ nonAc: 9000, ac: 11000 })
    expect(card.DORM).toBeUndefined()
    expect(Object.keys(card)).not.toContain('BOGUS')
  })

  it('prices a room by sharing and AC, falling back between AC and non-AC', () => {
    expect(cardRent(card, 'SINGLE', true)).toBe(15000)
    expect(cardRent(card, 'SINGLE', false)).toBe(12000)
    expect(cardRent(card, 'TRIPLE', true)).toBe(7500)
    expect(cardRent(card, 'QUAD', false)).toBe(8000)
    expect(cardRent(card, 'DORM', false)).toBeNull()
  })

  it('maps capacity to sharing', () => {
    expect([1, 2, 3, 4, 5, 6, 8].map(sharingFor)).toEqual(['SINGLE', 'DOUBLE', 'TRIPLE', 'QUAD', 'FIVE', 'DORM', 'DORM'])
  })

  it('uses the bed, then the room, then the PG rent', () => {
    expect(bedRent({ rent: 7000 }, { baseRent: 9000 }, 8000)).toBe(7000)
    expect(bedRent({ rent: null }, { baseRent: 9000 }, 8000)).toBe(9000)
    expect(bedRent({ rent: null }, { baseRent: null }, 8000)).toBe(8000)
  })
})

describe('first rent card for an existing PG', () => {
  it('takes the most common rent per sharing and AC', () => {
    const { card, used } = deriveRentCard(
      [
        { type: 'DOUBLE', capacity: 2, hasAC: false, baseRent: 9000 },
        { type: 'DOUBLE', capacity: 2, hasAC: false, baseRent: 9000 },
        { type: 'DOUBLE', capacity: 2, hasAC: false, baseRent: 8500 },
        { type: 'DOUBLE', capacity: 2, hasAC: true, baseRent: null },
        { type: 'FIVE', capacity: 5, hasAC: false, baseRent: 6000 },
      ],
      10000,
    )
    expect(card.DOUBLE).toEqual({ nonAc: 9000, ac: 10000 })
    expect(card.FIVE).toEqual({ nonAc: 6000, ac: null })
    expect(used).toEqual(['DOUBLE', 'FIVE'])
  })
})

describe('standard rent', () => {
  it('is the average bed rent, to the nearest ₹10', () => {
    // 2 beds at 9,000 + 3 beds at 7,500 → 8,100
    expect(standardRentFrom([9000, 9000, 7500, 7500, 7500])).toBe(8100)
    expect(standardRentFrom([8333, 8334])).toBe(8330)
  })

  it('falls back to the card prices before any beds exist', () => {
    expect(standardRentFrom([], { DOUBLE: { nonAc: 9000, ac: 11000 } })).toBe(10000)
    expect(standardRentFrom([], {})).toBe(0)
  })
})

describe('address helpers', () => {
  it('finds the state from the PIN code', () => {
    expect(stateFromPincode('600097')).toBe('Tamil Nadu')
    expect(stateFromPincode('560001')).toBe('Karnataka')
    expect(stateFromPincode('500032')).toBe('Telangana')
    expect(stateFromPincode('400001')).toBe('Maharashtra')
    expect(stateFromPincode('605001')).toBe('Puducherry')
    expect(stateFromPincode('12345')).toBeNull()
  })

  it('makes a short code from the PG name', () => {
    expect(codeFromName("Sri Balaji Men's PG")).toBe('SBMSP')
    expect(codeFromName('Lotus')).toBe('LOTU')
    expect(codeFromName('')).toBe('PG')
  })
})
