/**
 * Owner onboarding wizard — the step list and the pure progress maths.
 * No server or browser dependencies, so the wizard UI, the onboarding
 * service and the unit tests all share one definition.
 */

export const SETUP_STEPS = [
  { key: 'welcome', title: 'Welcome', short: 'Welcome', required: true, counted: false },
  { key: 'basics', title: 'PG basics', short: 'Basics', required: true, counted: true },
  { key: 'address', title: 'Address & contact', short: 'Address', required: true, counted: true },
  { key: 'config', title: 'PG configuration', short: 'Setup', required: true, counted: true },
  { key: 'floors', title: 'Floors', short: 'Floors', required: true, counted: true },
  { key: 'rooms', title: 'Rooms', short: 'Rooms', required: true, counted: true },
  { key: 'beds', title: 'Beds review', short: 'Beds', required: true, counted: true },
  { key: 'rent', title: 'Rent rules', short: 'Rent', required: true, counted: true },
  { key: 'deposit', title: 'Deposit', short: 'Deposit', required: true, counted: true },
  { key: 'food', title: 'Food', short: 'Food', required: false, counted: true },
  { key: 'payments', title: 'Payment setup', short: 'Payments', required: false, counted: true },
  { key: 'whatsapp', title: 'WhatsApp', short: 'WhatsApp', required: false, counted: true },
  { key: 'staff', title: 'Team & staff', short: 'Staff', required: false, counted: true },
  { key: 'import', title: 'Import residents', short: 'Residents', required: false, counted: true },
  { key: 'review', title: 'Final check', short: 'Review', required: true, counted: true },
  { key: 'done', title: 'All set', short: 'Done', required: true, counted: false },
] as const

export type SetupStepKey = (typeof SETUP_STEPS)[number]['key']
export type SetupStep = (typeof SETUP_STEPS)[number]

export const STEP_KEYS: SetupStepKey[] = SETUP_STEPS.map((s) => s.key)

export function isStepKey(value: unknown): value is SetupStepKey {
  return typeof value === 'string' && (STEP_KEYS as string[]).includes(value)
}

export function stepIndex(key: SetupStepKey) {
  return STEP_KEYS.indexOf(key)
}

export function stepMeta(key: SetupStepKey): SetupStep {
  return SETUP_STEPS[stepIndex(key)]
}

export function nextStep(key: SetupStepKey): SetupStepKey {
  const i = stepIndex(key)
  return STEP_KEYS[Math.min(i + 1, STEP_KEYS.length - 1)]
}

export function prevStep(key: SetupStepKey): SetupStepKey {
  const i = stepIndex(key)
  return STEP_KEYS[Math.max(i - 1, 0)]
}

/** Steps that need the PG to exist first (everything after configuration). */
export function needsProperty(key: SetupStepKey) {
  return stepIndex(key) > stepIndex('config') && key !== 'done'
}

/**
 * What the wizard remembers between visits (OrgSetting.onboardingData).
 * Ids of what it created make re-running a step update instead of duplicate.
 */
export type OnboardingData = {
  propertyId?: string
  completed?: SetupStepKey[]
  skipped?: SetupStepKey[]
  /** Answers kept for steps whose values live nowhere else. */
  answers?: {
    sharingTypes?: string[]
    mealPlan?: 'ALL' | 'BREAKFAST_DINNER' | 'DINNER'
    [key: string]: unknown
  }
}

/** Reads untrusted JSON from the database into a safe shape. */
export function normalizeData(raw: unknown): OnboardingData {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const r = raw as Record<string, unknown>
  const keys = (v: unknown) => (Array.isArray(v) ? Array.from(new Set(v.filter(isStepKey))) : [])
  return {
    propertyId: typeof r.propertyId === 'string' && r.propertyId ? r.propertyId : undefined,
    completed: keys(r.completed),
    skipped: keys(r.skipped),
    answers:
      r.answers && typeof r.answers === 'object' && !Array.isArray(r.answers)
        ? (r.answers as OnboardingData['answers'])
        : {},
  }
}

/** Marks a step completed (or skipped — only optional steps may be skipped). */
export function markStep(data: OnboardingData, key: SetupStepKey, how: 'complete' | 'skip'): OnboardingData {
  const completed = new Set(data.completed ?? [])
  const skipped = new Set(data.skipped ?? [])
  if (how === 'skip' && stepMeta(key).required) how = 'complete'
  if (how === 'complete') {
    completed.add(key)
    skipped.delete(key)
  } else {
    skipped.add(key)
    completed.delete(key)
  }
  return { ...data, completed: STEP_KEYS.filter((k) => completed.has(k)), skipped: STEP_KEYS.filter((k) => skipped.has(k)) }
}

/** Whole-number percent of counted steps that are done or skipped. */
export function completionPercent(data: OnboardingData, completedAt?: Date | string | null): number {
  if (completedAt) return 100
  const counted = SETUP_STEPS.filter((s) => s.counted)
  const finished = new Set([...(data.completed ?? []), ...(data.skipped ?? [])])
  const done = counted.filter((s) => finished.has(s.key)).length
  return Math.round((done / counted.length) * 100)
}

/** First required step that is not finished — the review step's blocker list. */
export function missingRequired(data: OnboardingData): SetupStepKey[] {
  const done = new Set(data.completed ?? [])
  return SETUP_STEPS.filter((s) => s.counted && s.required && s.key !== 'review' && !done.has(s.key)).map((s) => s.key)
}

/**
 * Where to resume: the saved step if valid, else the first unfinished step.
 * A step past the PG configuration can't open before the PG exists.
 */
export function resumeStep(saved: unknown, data: OnboardingData): SetupStepKey {
  const finished = new Set([...(data.completed ?? []), ...(data.skipped ?? [])])
  let step: SetupStepKey = isStepKey(saved)
    ? saved
    : (STEP_KEYS.find((k) => k !== 'welcome' && !finished.has(k)) ?? 'welcome')
  if (!data.propertyId && needsProperty(step)) step = finished.has('address') ? 'config' : 'basics'
  return step
}

// -------------------------------------------------------------- rooms ----

export const SHARING_OPTIONS = [
  { type: 'SINGLE', label: 'Single', capacity: 1 },
  { type: 'DOUBLE', label: '2 sharing', capacity: 2 },
  { type: 'TRIPLE', label: '3 sharing', capacity: 3 },
  { type: 'QUAD', label: '4 sharing', capacity: 4 },
  { type: 'DORM', label: 'Dorm (5+)', capacity: 6 },
] as const

export type SharingType = (typeof SHARING_OPTIONS)[number]['type']

/** Default room numbering for a floor: ground 1, 2, 3…; first 101, 102… */
export function defaultStartNumber(level: number) {
  return level <= 0 ? 1 : level * 100 + 1
}

export function floorName(level: number) {
  if (level === 0) return 'Ground floor'
  const suffix = level % 10 === 1 && level !== 11 ? 'st' : level % 10 === 2 && level !== 12 ? 'nd' : level % 10 === 3 && level !== 13 ? 'rd' : 'th'
  return `${level}${suffix} floor`
}

/** Room numbers a bulk add would create, e.g. A101…A105. */
export function plannedRoomNumbers(prefix: string, start: number, count: number) {
  return Array.from({ length: Math.max(0, count) }, (_, i) => `${prefix}${start + i}`)
}

/** Levels still to create so the PG has `count` floors (from ground or 1st). */
export function missingFloorLevels(existing: number[], count: number, fromGround: boolean) {
  const first = fromGround ? 0 : 1
  const have = new Set(existing)
  return Array.from({ length: Math.max(0, count) }, (_, i) => first + i).filter((l) => !have.has(l))
}
