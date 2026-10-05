import type { IconName } from './icons'

/**
 * Every part of the product, as the owner sees it in Settings → Features.
 *
 * Core modules are what a PG cannot run without and are always on. Optional
 * modules can be switched off per organization (OrgSetting.disabledModules):
 * a switched-off module disappears from navigation, dashboards and the phone
 * apps, its pages show a "turned off" screen, its APIs refuse, and the daily
 * automation skips it. The platform can also withhold a module from a plan
 * (FeatureFlag), which hides it from the owner's list entirely.
 */

export type ModuleKey =
  | 'dashboard'
  | 'properties'
  | 'residents'
  | 'rent'
  | 'settings'
  | 'leads'
  | 'expenses'
  | 'complaints'
  | 'food'
  | 'grocery'
  | 'inventory'
  | 'staff'
  | 'visitors'
  | 'announcements'
  | 'whatsapp'
  | 'reports'
  | 'activity'
  | 'residentApp'
  | 'staffApp'

export type ModuleDef = {
  key: ModuleKey
  label: string
  description: string
  icon: IconName
  core: boolean
  /** Other optional modules that must stay on while this one is on. */
  requires?: ModuleKey[]
  /** Owner-dashboard routes that belong to this module. */
  routes: string[]
  /** Platform FeatureFlag key that gates it by plan, if any. */
  flag?: string
}

export const MODULES: ModuleDef[] = [
  { key: 'dashboard', label: 'Dashboard', description: 'Today at a glance.', icon: 'dashboard', core: true, routes: ['/app'] },
  { key: 'properties', label: 'PGs, rooms & beds', description: 'Your buildings, floors, rooms and the bed map.', icon: 'building', core: true, routes: ['/app/properties', '/app/beds'] },
  { key: 'residents', label: 'Residents', description: 'Check-in, check-out, KYC and each resident’s ledger.', icon: 'user', core: true, routes: ['/app/residents'] },
  { key: 'rent', label: 'Rent & payments', description: 'Monthly invoices, receipts, dues and deposits.', icon: 'wallet', core: true, routes: ['/app/rent', '/app/payments'] },
  { key: 'settings', label: 'Settings & billing', description: 'Your account, team, roles and subscription.', icon: 'settings', core: true, routes: ['/app/settings', '/app/subscription', '/app/notifications'] },

  { key: 'leads', label: 'Enquiries & bookings', description: 'Track people asking for a bed, visits, token payments and bookings.', icon: 'clipboard', core: false, routes: ['/app/leads', '/app/bookings'] },
  { key: 'expenses', label: 'Expenses', description: 'Record spending and see profit per PG.', icon: 'receipt', core: false, routes: ['/app/expenses'] },
  { key: 'complaints', label: 'Complaints & maintenance', description: 'Residents raise issues; staff fix them with tasks.', icon: 'wrench', core: false, routes: ['/app/complaints'] },
  { key: 'food', label: 'Food & meals', description: 'Menus, meal plans, opt-outs and meal counts.', icon: 'utensils', core: false, routes: ['/app/food'], flag: 'food_module' },
  { key: 'grocery', label: 'Grocery & stock', description: 'Kitchen stock, low-stock alerts and purchases.', icon: 'cart', core: false, routes: ['/app/grocery'], flag: 'grocery_module' },
  { key: 'inventory', label: 'Inventory & assets', description: 'Furniture, appliances and where they are.', icon: 'boxes', core: false, routes: ['/app/inventory'] },
  { key: 'staff', label: 'Staff & attendance', description: 'Your team, daily attendance and salaries.', icon: 'users', core: false, routes: ['/app/staff'] },
  { key: 'visitors', label: 'Visitor log', description: 'Who came in, whom they met and when they left.', icon: 'userPlus', core: false, routes: ['/app/visitors'] },
  { key: 'announcements', label: 'Announcements', description: 'Notices to residents in the app and on WhatsApp.', icon: 'megaphone', core: false, routes: ['/app/announcements'] },
  { key: 'whatsapp', label: 'WhatsApp messages', description: 'Automatic rent reminders, receipts and updates on WhatsApp.', icon: 'messages', core: false, routes: ['/app/messages'], flag: 'whatsapp_reminders' },
  { key: 'reports', label: 'Reports', description: 'Occupancy, collections, expenses and profit.', icon: 'chart', core: false, routes: ['/app/reports'], flag: 'advanced_reports' },
  { key: 'activity', label: 'Activity log', description: 'Every change, who made it and when.', icon: 'history', core: false, routes: ['/app/activity'] },
  { key: 'residentApp', label: 'Resident app', description: 'Residents pay rent, raise complaints and read notices on their phone.', icon: 'smartphone', core: false, routes: [], flag: 'tenant_app' },
  { key: 'staffApp', label: 'Staff app', description: 'Staff see their tasks, kitchen board and attendance on their phone.', icon: 'smartphone', core: false, requires: ['staff'], routes: [], flag: 'worker_app' },
]

export const MODULE_BY_KEY = Object.fromEntries(MODULES.map((m) => [m.key, m])) as Record<ModuleKey, ModuleDef>

export const OPTIONAL_MODULES = MODULES.filter((m) => !m.core)

/**
 * The modules an organization actually has on.
 * `platformOff` = module keys withheld by the platform (plan / feature flag).
 */
export function enabledModules(disabledByOwner: string[], platformOff: string[] = []): Set<ModuleKey> {
  const off = new Set([...disabledByOwner, ...platformOff])
  const on = new Set<ModuleKey>()
  for (const m of MODULES) {
    if (m.core || !off.has(m.key)) on.add(m.key)
  }
  // A module whose dependency is off is off too (staff app without staff).
  for (const m of MODULES) {
    if (on.has(m.key) && m.requires?.some((r) => !on.has(r))) on.delete(m.key)
  }
  return on
}

/** Which module an owner-dashboard path belongs to (longest prefix wins). */
export function moduleForPath(pathname: string): ModuleKey | null {
  let best: { key: ModuleKey; len: number } | null = null
  for (const m of MODULES) {
    for (const r of m.routes) {
      const match = r === '/app' ? pathname === '/app' : pathname === r || pathname.startsWith(`${r}/`)
      if (match && (!best || r.length > best.len)) best = { key: m.key, len: r.length }
    }
  }
  return best?.key ?? null
}
