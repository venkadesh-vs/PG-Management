/**
 * Helpers for setting up every room's meter in one go, and for the
 * monthly "type the readings" screen. Pure: safe in the browser and on
 * the server. The server stays the source of truth for every bill.
 */

export type BulkMeterRow = { roomId: string; roomNumber: string; meterNumber: string; initialReading: string }

/** A suggested meter number for a room; the owner can change it. */
export function suggestMeterNumber(roomNumber: string, propertyCode?: string | null) {
  // Meter numbers are unique across the whole account, and two PGs often both have a
  // room 101, so the PG's short code goes in front when there is one (SFM-101).
  const clean = (v: string) => v.trim().replace(/\s+/g, '-').toUpperCase()
  const prefix = propertyCode?.trim() ? clean(propertyCode) : 'MTR'
  return `${prefix}-${clean(roomNumber)}`
}

/** Parses a reading typed by a person: up to one decimal place, never negative. */
export function parseReadingInput(text: string): number | null {
  const t = text.trim()
  if (!/^\d+(\.\d)?$/.test(t)) return null
  return Number(t)
}

/**
 * Problems in a batch before it is sent: blank or repeated meter numbers,
 * the same room twice, missing or invalid starting readings. Keyed by roomId.
 */
export function checkBulkMeterRows(rows: BulkMeterRow[]): Record<string, string> {
  const problems: Record<string, string> = {}
  const numbers = new Map<string, number>()
  const rooms = new Map<string, number>()
  for (const r of rows) {
    const key = r.meterNumber.trim().toUpperCase()
    if (key) numbers.set(key, (numbers.get(key) ?? 0) + 1)
    rooms.set(r.roomId, (rooms.get(r.roomId) ?? 0) + 1)
  }
  for (const r of rows) {
    const key = r.meterNumber.trim().toUpperCase()
    if (!key) problems[r.roomId] = 'Enter the meter number'
    else if ((numbers.get(key) ?? 0) > 1) problems[r.roomId] = `Meter number ${r.meterNumber.trim()} is used twice`
    else if ((rooms.get(r.roomId) ?? 0) > 1) problems[r.roomId] = `Room ${r.roomNumber} is listed twice`
    else if (r.initialReading.trim() === '') problems[r.roomId] = 'Enter the starting reading'
    else if (parseReadingInput(r.initialReading) === null) problems[r.roomId] = 'Use numbers only, with at most one decimal (e.g. 1250 or 1250.5)'
  }
  return problems
}

/**
 * What the monthly screen shows while typing: units and an estimate of the
 * room bill. Display only — the real bill is calculated by the server.
 */
export function liveEstimate(lastReading: number, typed: string, ratePerUnit: number | null) {
  const value = parseReadingInput(typed)
  if (value === null) return { state: typed.trim() ? ('invalid' as const) : ('empty' as const) }
  if (value < lastReading) return { state: 'lower' as const }
  const units = Math.round((value - lastReading) * 10) / 10
  const amount = ratePerUnit === null ? null : Math.round(units * ratePerUnit)
  return { state: 'ok' as const, units, amount }
}
