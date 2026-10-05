import type { UserRole } from '@prisma/client'
import type { IconName } from './icons'

export type NavItem = {
  label: string
  href: string
  /** Registry name — a component cannot cross the RSC boundary. */
  icon: IconName
  /** Matches child routes too (e.g. /app/residents/abc). */
  exact?: boolean
  badge?: 'complaints' | 'notifications' | 'tasks' | 'leads'
}

export type NavSection = { title?: string; items: NavItem[] }

/** PG Owner / Manager */
export const OWNER_NAV: NavSection[] = [
  {
    items: [
      { label: 'Dashboard', href: '/app', icon: 'dashboard', exact: true },
      { label: 'Properties', href: '/app/properties', icon: 'building' },
      { label: 'Rooms & Beds', href: '/app/beds', icon: 'bed' },
      { label: 'Residents', href: '/app/residents', icon: 'user' },
    ],
  },
  {
    title: 'Money',
    items: [
      { label: 'Rent & Payments', href: '/app/rent', icon: 'wallet' },
      { label: 'Payments', href: '/app/payments', icon: 'card' },
      { label: 'Expenses', href: '/app/expenses', icon: 'receipt' },
    ],
  },
  {
    title: 'Operations',
    items: [
      { label: 'Complaints', href: '/app/complaints', icon: 'wrench', badge: 'complaints' },
      { label: 'Food', href: '/app/food', icon: 'utensils' },
      { label: 'Grocery', href: '/app/grocery', icon: 'cart' },
      { label: 'Staff', href: '/app/staff', icon: 'users' },
      { label: 'Visitors', href: '/app/visitors', icon: 'userPlus' },
      { label: 'Inventory', href: '/app/inventory', icon: 'boxes' },
    ],
  },
  {
    title: 'Insight',
    items: [
      { label: 'Announcements', href: '/app/announcements', icon: 'megaphone' },
      { label: 'Reports', href: '/app/reports', icon: 'chart' },
      { label: 'Activity', href: '/app/activity', icon: 'history' },
      { label: 'WhatsApp Outbox', href: '/app/messages', icon: 'messages' },
    ],
  },
  {
    title: 'Account',
    items: [
      { label: 'Subscription', href: '/app/subscription', icon: 'sparkles' },
      { label: 'Notifications', href: '/app/notifications', icon: 'bell', badge: 'notifications' },
      { label: 'Settings', href: '/app/settings', icon: 'settings' },
    ],
  },
]

/** Platform Super Admin */
export const ADMIN_NAV: NavSection[] = [
  {
    items: [
      { label: 'Dashboard', href: '/admin', icon: 'gauge', exact: true },
      { label: 'Organizations', href: '/admin/organizations', icon: 'building' },
      { label: 'PG Properties', href: '/admin/properties', icon: 'door' },
      { label: 'Leads', href: '/admin/leads', icon: 'clipboard', badge: 'leads' },
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
      { label: 'Support', href: '/admin/support', icon: 'messages' },
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
  { label: 'Complaints', href: '/tenant/complaints', icon: 'wrench' },
  { label: 'Food', href: '/tenant/food', icon: 'utensils' },
  { label: 'Profile', href: '/tenant/profile', icon: 'user' },
]

export const TENANT_MORE: NavItem[] = [
  { label: 'Announcements', href: '/tenant/announcements', icon: 'megaphone' },
  { label: 'Documents', href: '/tenant/documents', icon: 'file' },
  { label: 'Notifications', href: '/tenant/notifications', icon: 'bell', badge: 'notifications' },
]

/** Worker app — deliberately small. */
export const WORKER_NAV: NavItem[] = [
  { label: 'Home', href: '/worker', icon: 'dashboard', exact: true },
  { label: 'My Tasks', href: '/worker/tasks', icon: 'clipboard', badge: 'tasks' },
  { label: 'Food', href: '/worker/food', icon: 'utensils' },
  { label: 'Grocery', href: '/worker/grocery', icon: 'cart' },
  { label: 'Profile', href: '/worker/profile', icon: 'user' },
]

export function navForRole(role: UserRole): NavSection[] {
  if (role === 'SUPER_ADMIN') return ADMIN_NAV
  return OWNER_NAV
}

export function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href
  return pathname === item.href || pathname.startsWith(`${item.href}/`)
}
