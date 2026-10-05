import type { UserRole } from '@prisma/client'

// --------------------------------------------------------------------------
// Permissions — a single source of truth shared by UI and API.
// --------------------------------------------------------------------------

export const PERMISSIONS = {
  'property:write': ['OWNER', 'MANAGER'],
  'property:delete': ['OWNER'],
  'resident:write': ['OWNER', 'MANAGER'],
  'resident:checkout': ['OWNER', 'MANAGER'],
  'payment:record': ['OWNER', 'MANAGER'],
  'payment:refund': ['OWNER'],
  'expense:write': ['OWNER', 'MANAGER'],
  'complaint:assign': ['OWNER', 'MANAGER'],
  'complaint:resolve': ['OWNER', 'MANAGER', 'WORKER'],
  'staff:write': ['OWNER', 'MANAGER'],
  'grocery:write': ['OWNER', 'MANAGER', 'WORKER'],
  'food:write': ['OWNER', 'MANAGER', 'WORKER'],
  'settings:write': ['OWNER'],
  'subscription:manage': ['OWNER'],
  'platform:manage': ['SUPER_ADMIN'],
} as const satisfies Record<string, readonly UserRole[]>

export type Permission = keyof typeof PERMISSIONS

export function can(user: { role: UserRole } | null, permission: Permission): boolean {
  if (!user) return false
  if (user.role === 'SUPER_ADMIN') return true
  return (PERMISSIONS[permission] as readonly UserRole[]).includes(user.role)
}
