/**
 * The PG's rent card: one price per sharing type, non-AC and AC. Every room
 * takes its rent from the card, and the PG's standard rent (which prices the
 * StayFlow subscription) is worked out from the beds, never typed in.
 * Pure rules, unit-tested in tests/unit/rent-card.test.ts.
 */

export const SHARING = [
  { type: 'SINGLE', label: '1 sharing', short: '1', capacity: 1 },
  { type: 'DOUBLE', label: '2 sharing', short: '2', capacity: 2 },
  { type: 'TRIPLE', label: '3 sharing', short: '3', capacity: 3 },
  { type: 'QUAD', label: '4 sharing', short: '4', capacity: 4 },
  { type: 'FIVE', label: '5 sharing', short: '5', capacity: 5 },
  { type: 'DORM', label: 'Dorm (6+)', short: '6+', capacity: 6 },
] as const

export type SharingType = (typeof SHARING)[number]['type']
export type RentCard = Partial<Record<SharingType, { nonAc?: number | null; ac?: number | null }>>

export function sharingFor(capacity: number): SharingType {
  if (capacity <= 1) return 'SINGLE'
  if (capacity === 2) return 'DOUBLE'
  if (capacity === 3) return 'TRIPLE'
  if (capacity === 4) return 'QUAD'
  if (capacity === 5) return 'FIVE'
  return 'DORM'
}

export function capacityFor(type: SharingType): number {
  return SHARING.find((s) => s.type === type)!.capacity
}

const money = (v: unknown) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) && n > 0 && n <= 10_000_000 ? Math.round(n) : null
}

/** Untrusted JSON (from the database or a form) → a clean card. */
export function normaliseRentCard(raw: unknown): RentCard {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const card: RentCard = {}
  for (const { type } of SHARING) {
    const row = (raw as Record<string, unknown>)[type]
    if (!row || typeof row !== 'object') continue
    const nonAc = money((row as Record<string, unknown>).nonAc)
    const ac = money((row as Record<string, unknown>).ac)
    if (nonAc || ac) card[type] = { nonAc, ac }
  }
  return card
}

/**
 * Monthly rent per bed for a room of this sharing and AC. An AC room with no
 * AC price falls back to the non-AC price, and the other way round.
 */
export function cardRent(card: RentCard, type: SharingType, hasAC: boolean): number | null {
  const row = card[type]
  if (!row) return null
  return (hasAC ? (row.ac ?? row.nonAc) : (row.nonAc ?? row.ac)) ?? null
}

/** The rent each bed really carries: its own, else its room's, else the PG's. */
export function bedRent(bed: { rent: number | null }, room: { baseRent: number | null }, fallback: number): number {
  return bed.rent ?? room.baseRent ?? fallback
}

/**
 * The PG's standard rent: the average rent of its beds, rounded to the
 * nearest ₹10. With no beds yet, the average of the prices on the card.
 */
export function standardRentFrom(bedRents: number[], card: RentCard = {}): number {
  const rents = bedRents.filter((r) => r > 0)
  const source = rents.length
    ? rents
    : Object.values(card).flatMap((row) => [row?.nonAc, row?.ac].filter((v): v is number => typeof v === 'number' && v > 0))
  if (!source.length) return 0
  const avg = source.reduce((s, r) => s + r, 0) / source.length
  return Math.round(avg / 10) * 10
}

/** India PIN code prefix → state, so the owner never types the state. */
const PIN_STATES: [number, number, string][] = [
  [11, 11, 'Delhi'], [12, 13, 'Haryana'], [14, 16, 'Punjab'], [17, 17, 'Himachal Pradesh'], [18, 19, 'Jammu and Kashmir'],
  [20, 28, 'Uttar Pradesh'], [30, 34, 'Rajasthan'], [36, 39, 'Gujarat'], [40, 44, 'Maharashtra'], [45, 48, 'Madhya Pradesh'],
  [49, 49, 'Chhattisgarh'], [50, 50, 'Telangana'], [51, 53, 'Andhra Pradesh'], [56, 59, 'Karnataka'], [60, 64, 'Tamil Nadu'],
  [67, 69, 'Kerala'], [70, 74, 'West Bengal'], [75, 77, 'Odisha'], [78, 78, 'Assam'], [79, 79, 'Arunachal Pradesh'],
  [80, 85, 'Bihar'],
]

export function stateFromPincode(pincode: string): string | null {
  if (!/^\d{6}$/.test(pincode)) return null
  if (pincode.startsWith('403')) return 'Goa'
  if (pincode.startsWith('605')) return 'Puducherry'
  if (pincode.startsWith('682')) return 'Kerala'
  const prefix = Number(pincode.slice(0, 2))
  return PIN_STATES.find(([from, to]) => prefix >= from && prefix <= to)?.[2] ?? null
}

/** "Sri Balaji Men's PG" → "SBMP": a short code nobody has to invent. */
export function codeFromName(name: string): string {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean)
  const initials = words.map((w) => w[0]).join('')
  const code = initials.length >= 2 ? initials : (words[0] ?? 'PG').slice(0, 4)
  return code.slice(0, 6) || 'PG'
}

/**
 * A first rent card for a PG that never had one: for each sharing and AC,
 * the rent most of those rooms already carry.
 */
export function deriveRentCard(
  rooms: { type: string; capacity: number; hasAC: boolean; baseRent: number | null }[],
  fallback: number,
): { card: RentCard; used: SharingType[] } {
  const counts = new Map<string, Map<number, number>>()
  const used = new Set<SharingType>()
  for (const room of rooms) {
    const type = SHARING.some((s) => s.type === room.type) ? (room.type as SharingType) : sharingFor(room.capacity)
    used.add(type)
    const key = `${type}|${room.hasAC ? 'ac' : 'nonAc'}`
    const rent = room.baseRent ?? fallback
    const tally = counts.get(key) ?? new Map<number, number>()
    tally.set(rent, (tally.get(rent) ?? 0) + 1)
    counts.set(key, tally)
  }
  const raw: Record<string, Record<string, number>> = {}
  for (const [key, tally] of counts) {
    const [type, which] = key.split('|')
    const common = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0]
    raw[type] = { ...(raw[type] ?? {}), [which]: common }
  }
  return { card: normaliseRentCard(raw), used: SHARING.map((s) => s.type).filter((t) => used.has(t)) }
}

/** "DOUBLE" → "2 sharing", "FIVE" → "5 sharing", "DORM" → "dorm": how a room type reads on screen. */
export function roomTypeLabel(type: string): string {
  const map: Record<string, string> = {
    SINGLE: 'single',
    DOUBLE: '2 sharing',
    TRIPLE: '3 sharing',
    QUAD: '4 sharing',
    FIVE: '5 sharing',
    DORM: 'dorm',
  }
  return map[type] ?? type.toLowerCase()
}

export type PlanPricing = {
  pricingBasis: string
  multiplier: number
  perBedPrice: number
  flatPrice: number
  minAmount: number
  maxAmount: number
}

/** The monthly subscription a PG would pay, the same rule the server bills with. */
export function subscriptionPreview(standardRent: number, beds: number, plan: PlanPricing): number {
  const raw =
    plan.pricingBasis === 'STANDARD_RENT'
      ? Math.round((standardRent * plan.multiplier) / 100)
      : plan.pricingBasis === 'PER_BED'
        ? beds * plan.perBedPrice
        : plan.flatPrice
  return Math.min(plan.maxAmount, Math.max(plan.minAmount, raw))
}
