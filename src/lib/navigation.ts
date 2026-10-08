import type { IconName } from './icons'
import type { ModuleKey } from './modules'

export type NavItem = {
  label: string
  href: string
  /** Registry name — a component cannot cross the RSC boundary. */
  icon: IconName
  /** Matches child routes too (e.g. /app/residents/abc). */
  exact?: boolean
  badge?: 'complaints' | 'notifications' | 'tasks' | 'leads'
  /** Hidden when this module is switched off. */
  module?: ModuleKey
  /** Hidden unless the person holds this permission. */
  permission?: string
}

export type NavSection = { title?: string; items: NavItem[] }

/** PG Owner / Manager */
export const OWNER_NAV: NavSection[] = [
  {
    items: [
      { label: 'Dashboard', href: '/app', icon: 'dashboard', exact: true, module: 'dashboard', permission: 'dashboard.view' },
      { label: 'Properties', href: '/app/properties', icon: 'building', module: 'properties', permission: 'properties.view' },
      { label: 'Rooms & Beds', href: '/app/beds', icon: 'bed', module: 'properties', permission: 'properties.view' },
      { label: 'Vacancy', href: '/app/vacancy', icon: 'trendingDown', module: 'properties', permission: 'properties.view' },
      { label: 'Residents', href: '/app/residents', icon: 'user', module: 'residents', permission: 'residents.view' },
      { label: 'Enquiries', href: '/app/leads', icon: 'clipboard', module: 'leads', permission: 'leads.view' },
      { label: 'Bookings', href: '/app/bookings', icon: 'calendar', module: 'leads', permission: 'leads.view' },
      { label: 'Import data', href: '/app/import', icon: 'upload', module: 'residents', permission: 'residents.manage' },
    ],
  },
  {
    title: 'Money',
    items: [
      { label: 'Rent & Payments', href: '/app/rent', icon: 'wallet', module: 'rent', permission: 'rent.view' },
      { label: 'Payments', href: '/app/payments', icon: 'card', module: 'rent', permission: 'rent.view' },
      { label: 'Expenses', href: '/app/expenses', icon: 'receipt', module: 'expenses', permission: 'expenses.view' },
      { label: 'Electricity', href: '/app/electricity', icon: 'zap', module: 'electricity', permission: 'electricity.view' },
      { label: 'Profit & loss', href: '/app/reports/pnl', icon: 'trendingUp', module: 'reports', permission: 'reports.view' },
    ],
  },
  {
    title: 'Operations',
    items: [
      { label: 'Complaints', href: '/app/complaints', icon: 'wrench', badge: 'complaints', module: 'complaints', permission: 'complaints.view' },
      { label: 'Requests', href: '/app/requests', icon: 'list', module: 'requests', permission: 'requests.view' },
      { label: 'Food', href: '/app/food', icon: 'utensils', module: 'food', permission: 'food.view' },
      { label: 'Grocery', href: '/app/grocery', icon: 'cart', module: 'grocery', permission: 'grocery.view' },
      { label: 'Staff', href: '/app/staff', icon: 'users', module: 'staff', permission: 'staff.view' },
      { label: 'Visitors', href: '/app/visitors', icon: 'userPlus', module: 'visitors', permission: 'visitors.view' },
      { label: 'Inventory', href: '/app/inventory', icon: 'boxes', module: 'inventory', permission: 'inventory.view' },
    ],
  },
  {
    title: 'Insight',
    items: [
      { label: 'Announcements', href: '/app/announcements', icon: 'megaphone', module: 'announcements', permission: 'announcements.send' },
      { label: 'Reports', href: '/app/reports', icon: 'chart', module: 'reports', permission: 'reports.view' },
      { label: 'Activity', href: '/app/activity', icon: 'history', module: 'activity', permission: 'activity.view' },
      { label: 'Message centre', href: '/app/messages', icon: 'messages', permission: 'messages.view' },
    ],
  },
  {
    title: 'Account',
    items: [
      { label: 'Subscription', href: '/app/subscription', icon: 'sparkles', module: 'settings', permission: 'billing.manage' },
      { label: 'Notifications', href: '/app/notifications', icon: 'bell', badge: 'notifications' },
      { label: 'Settings', href: '/app/settings', icon: 'settings', module: 'settings' },
      { label: 'Help centre', href: '/app/help', icon: 'help' },
      { label: 'Support', href: '/app/support', icon: 'lifebuoy', permission: 'settings.manage' },
    ],
  },
]

/** Platform Super Admin */
export const ADMIN_NAV: NavSection[] = [
  {
    items: [
      { label: 'Dashboard', href: '/admin', icon: 'gauge', exact: true },
      { label: 'Customers', href: '/admin/organizations', icon: 'building' },
      { label: 'PG Properties', href: '/admin/properties', icon: 'door' },
      { label: 'Sales CRM', href: '/admin/leads', icon: 'clipboard', badge: 'leads' },
    ],
  },
  {
    title: 'Billing',
    items: [
      { label: 'Subscriptions', href: '/admin/subscriptions', icon: 'sparkles' },
      { label: 'Payments', href: '/admin/payments', icon: 'card' },
      { label: 'Plans & Pricing', href: '/admin/plans', icon: 'tags' },
    ],
  },
  {
    title: 'Platform',
    items: [
      { label: 'Feature Controls', href: '/admin/features', icon: 'shield' },
      { label: 'System Health', href: '/admin/health', icon: 'alert' },
      { label: 'Announcements', href: '/admin/announcements', icon: 'megaphone' },
      { label: 'Support & health', href: '/admin/support', icon: 'lifebuoy' },
      { label: 'Notifications', href: '/admin/notifications', icon: 'bell', badge: 'notifications' },
      { label: 'Audit Logs', href: '/admin/audit', icon: 'history' },
      { label: 'System Settings', href: '/admin/settings', icon: 'settings' },
    ],
  },
]

/** Resident app — mobile first, five primary destinations. */
export const TENANT_NAV: NavItem[] = [
  { label: 'Home', href: '/tenant', icon: 'dashboard', exact: true },
  { label: 'Rent', href: '/tenant/rent', icon: 'wallet' },
  { label: 'Complaints', href: '/tenant/complaints', icon: 'wrench', module: 'complaints' },
  { label: 'Food', href: '/tenant/food', icon: 'utensils', module: 'food' },
  { label: 'Profile', href: '/tenant/profile', icon: 'user' },
]

export const TENANT_MORE: NavItem[] = [
  { label: 'Announcements', href: '/tenant/announcements', icon: 'megaphone', module: 'announcements' },
  { label: 'Requests', href: '/tenant/requests', icon: 'list', module: 'requests' },
  { label: 'Documents', href: '/tenant/documents', icon: 'file' },
  { label: 'Notifications', href: '/tenant/notifications', icon: 'bell', badge: 'notifications' },
]

/** Worker app — deliberately small. */
export const WORKER_NAV: NavItem[] = [
  { label: 'Home', href: '/worker', icon: 'dashboard', exact: true },
  { label: 'My Tasks', href: '/worker/tasks', icon: 'clipboard', badge: 'tasks', module: 'complaints', permission: 'tasks.work' },
  { label: 'Food', href: '/worker/food', icon: 'utensils', module: 'food', permission: 'food.view' },
  { label: 'Grocery', href: '/worker/grocery', icon: 'cart', module: 'grocery', permission: 'grocery.view' },
  { label: 'Profile', href: '/worker/profile', icon: 'user' },
]

export const WORKER_MORE: NavItem[] = [
  { label: 'Meter readings', href: '/worker/meters', icon: 'zap', module: 'electricity', permission: 'electricity.readings' },
]

type Access = { role: string; modules: string[]; permissions: string[] }

function visible(item: NavItem, access: Access) {
  if (item.module && !access.modules.includes(item.module)) return false
  if (item.permission && access.role !== 'OWNER' && !access.permissions.includes(item.permission)) return false
  return true
}

/** The owner-dashboard menu this person should see. */
export function filterNavSections(sections: NavSection[], access: Access): NavSection[] {
  return sections
    .map((s) => ({ ...s, items: s.items.filter((i) => visible(i, access)) }))
    .filter((s) => s.items.length > 0)
}

/** The phone-app tabs this person should see. */
export function filterNavItems(items: NavItem[], access: Access): NavItem[] {
  return items.filter((i) => visible(i, access))
}

export function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href
  return pathname === item.href || pathname.startsWith(`${item.href}/`)
}
