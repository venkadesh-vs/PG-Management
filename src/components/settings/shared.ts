/** Colours a role can wear (stored on OrgRole.color). */
export const ROLE_COLORS = ['blue', 'emerald', 'violet', 'amber', 'sky', 'rose', 'teal', 'slate'] as const
export type RoleColor = (typeof ROLE_COLORS)[number]

export const ROLE_DOT: Record<string, string> = {
  blue: 'bg-blue-500',
  emerald: 'bg-emerald-500',
  violet: 'bg-violet-500',
  amber: 'bg-amber-500',
  sky: 'bg-sky-500',
  rose: 'bg-rose-500',
  teal: 'bg-teal-500',
  slate: 'bg-slate-500',
}

export type RoleRow = {
  id: string
  name: string
  description: string | null
  app: 'DASHBOARD' | 'STAFF_APP'
  color: string
  permissions: string[]
  isTemplate: boolean
  userCount: number
}

export const APP_LABEL: Record<RoleRow['app'], string> = {
  DASHBOARD: 'Dashboard',
  STAFF_APP: 'Staff app',
}

/** Lookup type backed by the ExpenseCategory model instead of OrgLookup. */
export const EXPENSE_LOOKUP = 'EXPENSE_CATEGORY'

export type LookupItem = {
  id: string
  value: string
  label: string
  sortOrder: number
  active: boolean
  /** Records using it (expense categories only). */
  usage?: number
}

/** "Wi-Fi / Internet" → "WI_FI_INTERNET". */
export function toLookupValue(label: string) {
  const v = label
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, ' ')
    .trim()
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_')
    .toUpperCase()
    .slice(0, 40)
  return v || 'OPTION'
}

export const SETTINGS_TABS = ['billing', 'reminders', 'organization', 'features', 'roles', 'team', 'lookups', 'integrations'] as const
export type SettingsTab = (typeof SETTINGS_TABS)[number]
