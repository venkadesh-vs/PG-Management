import { MODULES, OPTIONAL_MODULES, type ModuleKey } from './modules'

/**
 * Pure plan entitlements: usage limits and which modules a plan includes.
 * Shared by the session access computation, the plan-limits service, the
 * owner subscription page and the unit tests.
 */

export type LimitKey = 'properties' | 'beds' | 'residents' | 'staff'

export type PlanLimits = {
  name: string
  maxProperties: number | null
  maxBeds: number | null
  maxResidents: number | null
  maxStaff: number | null
}

export const LIMIT_FIELD: Record<LimitKey, keyof Omit<PlanLimits, 'name'>> = {
  properties: 'maxProperties',
  beds: 'maxBeds',
  residents: 'maxResidents',
  staff: 'maxStaff',
}

export const LIMIT_NOUN: Record<LimitKey, [singular: string, plural: string]> = {
  properties: ['PG', 'PGs'],
  beds: ['bed', 'beds'],
  residents: ['active resident', 'active residents'],
  staff: ['staff member', 'staff members'],
}

export const LIMIT_KEYS: LimitKey[] = ['properties', 'beds', 'residents', 'staff']

export const UPGRADE_PATH = '/app/subscription'

/**
 * The organization's limit for one dimension: the most generous among the
 * plans of its live subscriptions (null = unlimited). With no plans at all
 * there is no limit.
 */
export function effectiveLimit(plans: PlanLimits[], key: LimitKey): number | null {
  if (!plans.length) return null
  const values = plans.map((p) => p[LIMIT_FIELD[key]])
  if (values.some((v) => v == null)) return null
  return Math.max(...(values as number[]))
}

/** Whether `adding` more fits under `limit` given `used`. */
export function fitsLimit(used: number, adding: number, limit: number | null): boolean {
  if (limit == null) return true
  return used + adding <= limit
}

/** "Your Starter plan allows 2 PGs. Upgrade to add more." */
export function limitMessage(planName: string, key: LimitKey, limit: number): string {
  const [one, many] = LIMIT_NOUN[key]
  return `Your ${planName} plan allows ${limit} ${limit === 1 ? one : many}. Upgrade to add more at ${UPGRADE_PATH}.`
}

export type UsageRow = { key: LimitKey; used: number; limit: number | null }

/**
 * Dimensions where current usage would not fit the target limits — why a
 * downgrade is refused. Empty when the move is allowed.
 */
export function downgradeBlockers(
  usage: Record<LimitKey, number>,
  target: PlanLimits[],
): { key: LimitKey; used: number; limit: number; message: string }[] {
  const out: { key: LimitKey; used: number; limit: number; message: string }[] = []
  for (const key of LIMIT_KEYS) {
    const limit = effectiveLimit(target, key)
    if (limit != null && usage[key] > limit) {
      const [one, many] = LIMIT_NOUN[key]
      out.push({
        key,
        used: usage[key],
        limit,
        message: `You have ${usage[key]} ${usage[key] === 1 ? one : many}; that plan allows ${limit}.`,
      })
    }
  }
  return out
}

// ------------------------------------------------------------ features ----

const CORE_KEYS = MODULES.filter((m) => m.core).map((m) => m.key)
const OPTIONAL_KEYS = new Set<string>(OPTIONAL_MODULES.map((m) => m.key))

/**
 * A plan's features[] is a module entitlement list when it names every core
 * module (the plan editor always saves them). Older plans stored free-form
 * marketing tags ("rooms", "tenant_app"…) — those, and an empty list, mean
 * "all features", so existing plans keep working.
 */
export function isModuleEntitlementList(features: string[]): boolean {
  return features.length > 0 && CORE_KEYS.every((k) => features.includes(k))
}

/** Optional modules one plan does not include ([] = everything included). */
export function planExcludedModulesFor(features: string[]): ModuleKey[] {
  if (!isModuleEntitlementList(features)) return []
  return OPTIONAL_MODULES.filter((m) => !features.includes(m.key)).map((m) => m.key)
}

/**
 * Optional modules the organization's plans withhold: a module is excluded
 * only when none of its live subscriptions' plans includes it (an org on
 * two plans gets the union).
 */
export function planExcludedModules(planFeatureLists: string[][]): ModuleKey[] {
  if (!planFeatureLists.length) return []
  const excludedEach = planFeatureLists.map((f) => new Set(planExcludedModulesFor(f)))
  return OPTIONAL_MODULES.filter((m) => excludedEach.every((s) => s.has(m.key))).map((m) => m.key)
}

/** Sanitises an editor's feature selection: known module keys + all core keys. */
export function normalisePlanFeatures(selected: string[]): string[] {
  const optional = selected.filter((k) => OPTIONAL_KEYS.has(k))
  return [...CORE_KEYS, ...new Set(optional)]
}

// ------------------------------------------------------- metered limits ----

/**
 * Usage limits measured over time rather than counted records: WhatsApp
 * messages per calendar month (IST) and total file storage. null = unlimited.
 */
export type MeteredKey = 'whatsapp' | 'storage'

export type MeteredPlanLimits = {
  name: string
  whatsappMonthlyLimit?: number | null
  storageLimitMb?: number | null
}

export const METERED_FIELD: Record<MeteredKey, 'whatsappMonthlyLimit' | 'storageLimitMb'> = {
  whatsapp: 'whatsappMonthlyLimit',
  storage: 'storageLimitMb',
}

/** Most generous among the org's plans; any unlimited plan (or none) = unlimited. */
export function effectiveMeteredLimit(plans: MeteredPlanLimits[], key: MeteredKey): number | null {
  if (!plans.length) return null
  const values = plans.map((p) => p[METERED_FIELD[key]])
  if (values.some((v) => v == null)) return null
  return Math.max(...(values as number[]))
}

const IST_OFFSET_MS = 330 * 60 * 1000

/** First instant of the current calendar month in India, as a UTC Date. */
export function istMonthStart(now: Date): Date {
  const ist = new Date(now.getTime() + IST_OFFSET_MS)
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - IST_OFFSET_MS)
}

/** "2026-10": the IST month a moment falls in (for once-a-month notices). */
export function istMonthKey(now: Date): string {
  const ist = new Date(now.getTime() + IST_OFFSET_MS)
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}`
}

/** Whether another WhatsApp message may go out this month. */
export function whatsappAllowed(sentThisMonth: number, limit: number | null): boolean {
  return limit == null || sentThisMonth < limit
}

export const MB = 1024 * 1024

/** Whether a file of `addingBytes` fits in the storage limit. */
export function storageAllowed(usedBytes: number, addingBytes: number, limitMb: number | null): boolean {
  return limitMb == null || usedBytes + addingBytes <= limitMb * MB
}

/** Megabytes with one decimal, for usage displays. */
export function toMb(bytes: number): number {
  return Math.round((bytes / MB) * 10) / 10
}

export function whatsappLimitMessage(planName: string, limit: number): string {
  return `Your ${planName} plan includes ${limit} WhatsApp message${limit === 1 ? '' : 's'} a month, and this month's are used up. Upgrade at ${UPGRADE_PATH} to keep sending; messages resume on the 1st.`
}

export function storageLimitMessage(planName: string, limitMb: number): string {
  const size = limitMb >= 1024 ? `${Math.round((limitMb / 1024) * 10) / 10} GB` : `${limitMb} MB`
  return `Your ${planName} plan includes ${size} of file storage and it is full. Upgrade at ${UPGRADE_PATH} for more space.`
}
