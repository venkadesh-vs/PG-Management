import { describe, expect, it } from 'vitest'
import {
  SETUP_STEPS,
  STEP_KEYS,
  completionPercent,
  defaultStartNumber,
  floorName,
  markStep,
  missingFloorLevels,
  missingRequired,
  needsProperty,
  nextStep,
  normalizeData,
  plannedRoomNumbers,
  prevStep,
  resumeStep,
  type OnboardingData,
} from '@/app/(owner)/app/setup/steps'

const counted = SETUP_STEPS.filter((s) => s.counted).length

describe('step ordering', () => {
  it('runs welcome first, done last, review just before done', () => {
    expect(STEP_KEYS[0]).toBe('welcome')
    expect(STEP_KEYS.at(-1)).toBe('done')
    expect(STEP_KEYS.at(-2)).toBe('review')
  })

  it('builds the PG before floors, rooms and beds, and money after', () => {
    const at = (k: string) => STEP_KEYS.indexOf(k as never)
    expect(at('basics')).toBeLessThan(at('address'))
    expect(at('config')).toBeLessThan(at('floors'))
    expect(at('floors')).toBeLessThan(at('rooms'))
    expect(at('rooms')).toBeLessThan(at('beds'))
    expect(at('beds')).toBeLessThan(at('rent'))
  })

  it('moves forward and back within bounds', () => {
    expect(nextStep('welcome')).toBe('basics')
    expect(nextStep('done')).toBe('done')
    expect(prevStep('welcome')).toBe('welcome')
    expect(prevStep('rooms')).toBe('floors')
  })

  it('marks integration steps optional and the PG steps required', () => {
    const optional = SETUP_STEPS.filter((s) => !s.required).map((s) => s.key)
    expect(optional).toEqual(['food', 'payments', 'whatsapp', 'staff', 'import'])
  })

  it('knows which steps need the PG to exist', () => {
    expect(needsProperty('basics')).toBe(false)
    expect(needsProperty('config')).toBe(false)
    expect(needsProperty('floors')).toBe(true)
    expect(needsProperty('review')).toBe(true)
    expect(needsProperty('done')).toBe(false)
  })
})

describe('completionPercent', () => {
  it('is 0 for a fresh start and 100 once completed', () => {
    expect(completionPercent({})).toBe(0)
    expect(completionPercent({}, new Date())).toBe(100)
  })

  it('counts completed and skipped steps, not welcome', () => {
    let data: OnboardingData = {}
    data = markStep(data, 'basics', 'complete')
    data = markStep(data, 'address', 'complete')
    data = markStep(data, 'payments', 'skip')
    expect(completionPercent(data)).toBe(Math.round((3 / counted) * 100))
    expect(completionPercent(markStep(data, 'welcome', 'complete'))).toBe(Math.round((3 / counted) * 100))
  })

  it('reaches 100 when every counted step is done', () => {
    let data: OnboardingData = {}
    for (const s of SETUP_STEPS) if (s.counted) data = markStep(data, s.key, 'complete')
    expect(completionPercent(data)).toBe(100)
  })
})

describe('markStep', () => {
  it('is idempotent and keeps step order', () => {
    let data: OnboardingData = {}
    data = markStep(data, 'rooms', 'complete')
    data = markStep(data, 'basics', 'complete')
    data = markStep(data, 'rooms', 'complete')
    expect(data.completed).toEqual(['basics', 'rooms'])
  })

  it('never skips a required step', () => {
    const data = markStep({}, 'rent', 'skip')
    expect(data.completed).toEqual(['rent'])
    expect(data.skipped).toEqual([])
  })

  it('moves a skipped step to completed when finished later', () => {
    let data = markStep({}, 'whatsapp', 'skip')
    data = markStep(data, 'whatsapp', 'complete')
    expect(data.skipped).toEqual([])
    expect(data.completed).toEqual(['whatsapp'])
  })
})

describe('missingRequired', () => {
  it('lists unfinished required steps, ignoring optional ones and review', () => {
    const data = markStep(markStep({}, 'basics', 'complete'), 'food', 'skip')
    const missing = missingRequired(data)
    expect(missing).not.toContain('basics')
    expect(missing).not.toContain('food')
    expect(missing).not.toContain('review')
    expect(missing).toContain('rent')
  })
})

describe('resumeStep', () => {
  it('uses the saved step when valid', () => {
    expect(resumeStep('rent', { propertyId: 'p1' })).toBe('rent')
  })

  it('falls back to the first unfinished step', () => {
    const data = markStep({ propertyId: 'p1' }, 'basics', 'complete')
    expect(resumeStep(null, data)).toBe('address')
    expect(resumeStep('nonsense', data)).toBe('address')
  })

  it('never resumes past configuration without a PG', () => {
    expect(resumeStep('rooms', {})).toBe('basics')
    expect(resumeStep('rooms', markStep({}, 'address', 'complete'))).toBe('config')
  })
})

describe('normalizeData', () => {
  it('drops junk from stored JSON', () => {
    expect(normalizeData(null)).toEqual({})
    expect(normalizeData([1, 2])).toEqual({})
    const data = normalizeData({ propertyId: 'p', completed: ['basics', 'bogus', 'basics'], skipped: 'x', answers: 3 })
    expect(data).toEqual({ propertyId: 'p', completed: ['basics'], skipped: [], answers: {} })
  })
})

describe('room helpers', () => {
  it('numbers rooms by floor', () => {
    expect(defaultStartNumber(0)).toBe(1)
    expect(defaultStartNumber(1)).toBe(101)
    expect(defaultStartNumber(3)).toBe(301)
    expect(plannedRoomNumbers('A', 101, 3)).toEqual(['A101', 'A102', 'A103'])
    expect(plannedRoomNumbers('', 1, 0)).toEqual([])
  })

  it('names floors', () => {
    expect(floorName(0)).toBe('Ground floor')
    expect(floorName(1)).toBe('1st floor')
    expect(floorName(2)).toBe('2nd floor')
    expect(floorName(3)).toBe('3rd floor')
    expect(floorName(11)).toBe('11th floor')
    expect(floorName(22)).toBe('22nd floor')
  })

  it('only plans floors that do not exist yet (idempotent re-runs)', () => {
    expect(missingFloorLevels([], 3, true)).toEqual([0, 1, 2])
    expect(missingFloorLevels([0, 1], 3, true)).toEqual([2])
    expect(missingFloorLevels([0, 1, 2], 3, true)).toEqual([])
    expect(missingFloorLevels([], 2, false)).toEqual([1, 2])
  })
})
