import { describe, expect, it } from 'vitest'
import { checkBulkMeterRows, liveEstimate, parseReadingInput, suggestMeterNumber } from '@/lib/electricity-setup'

const row = (roomId: string, roomNumber: string, meterNumber: string, initialReading: string) => ({ roomId, roomNumber, meterNumber, initialReading })

describe('suggestMeterNumber', () => {
  it('builds a readable default from the room number', () => {
    expect(suggestMeterNumber('101')).toBe('MTR-101')
    expect(suggestMeterNumber(' 2b ')).toBe('MTR-2B')
    expect(suggestMeterNumber('Room 3')).toBe('MTR-ROOM-3')
  })
})

describe('parseReadingInput', () => {
  it('accepts whole numbers and one decimal place', () => {
    expect(parseReadingInput('1250')).toBe(1250)
    expect(parseReadingInput('1250.5')).toBe(1250.5)
    expect(parseReadingInput(' 0 ')).toBe(0)
  })
  it('rejects negatives, two decimals and text', () => {
    expect(parseReadingInput('-1')).toBeNull()
    expect(parseReadingInput('12.55')).toBeNull()
    expect(parseReadingInput('abc')).toBeNull()
    expect(parseReadingInput('')).toBeNull()
  })
})

describe('checkBulkMeterRows', () => {
  it('passes a clean batch', () => {
    expect(checkBulkMeterRows([row('a', '101', 'MTR-101', '1250'), row('b', '102', 'MTR-102', '980.5')])).toEqual({})
  })
  it('flags repeated meter numbers on both rooms, case-insensitively', () => {
    const p = checkBulkMeterRows([row('a', '101', 'mtr-1', '10'), row('b', '102', 'MTR-1', '20')])
    expect(Object.keys(p).sort()).toEqual(['a', 'b'])
    expect(p.a).toMatch(/used twice/)
  })
  it('flags blank numbers and bad readings', () => {
    const p = checkBulkMeterRows([row('a', '101', ' ', '10'), row('b', '102', 'M2', ''), row('c', '103', 'M3', '-5')])
    expect(p.a).toMatch(/meter number/)
    expect(p.b).toMatch(/starting reading/)
    expect(p.c).toMatch(/numbers only/)
  })
  it('flags the same room listed twice', () => {
    const p = checkBulkMeterRows([row('a', '101', 'M1', '10'), row('a', '101', 'M2', '20')])
    expect(p.a).toMatch(/listed twice/)
  })
})

describe('liveEstimate', () => {
  it('works out units and the room bill at the month rate', () => {
    expect(liveEstimate(1250, '1340', 13)).toEqual({ state: 'ok', units: 90, amount: 1170 })
    expect(liveEstimate(1340, '1450', 14)).toEqual({ state: 'ok', units: 110, amount: 1540 })
  })
  it('handles decimals without float noise', () => {
    expect(liveEstimate(100.3, '100.5', 10)).toEqual({ state: 'ok', units: 0.2, amount: 2 })
  })
  it('reports lower, empty and invalid input', () => {
    expect(liveEstimate(1250, '1200', 13).state).toBe('lower')
    expect(liveEstimate(1250, '', 13).state).toBe('empty')
    expect(liveEstimate(1250, '12a', 13).state).toBe('invalid')
  })
  it('leaves the amount empty when the month has no rate yet', () => {
    expect(liveEstimate(1250, '1340', null)).toEqual({ state: 'ok', units: 90, amount: null })
  })
})
