import { describe, expect, it } from 'vitest'

import { resolveAccess } from '@/lib/access'
import { enabledModules, moduleForPath, MODULES } from '@/lib/modules'
import { ALL_PERMISSIONS, MODULE_OF_PERMISSION, ROLE_TEMPLATES } from '@/lib/permission-catalog'

const managerTemplate = ROLE_TEMPLATES.find((t) => t.name === 'Manager')!.permissions

describe('enabledModules', () => {
  it('turns everything on when nothing is disabled', () => {
    expect(enabledModules([]).size).toBe(MODULES.length)
  })

  it('never turns off a core module', () => {
    const on = enabledModules(['residents', 'rent', 'settings', 'expenses'])
    expect(on.has('residents')).toBe(true)
    expect(on.has('rent')).toBe(true)
    expect(on.has('settings')).toBe(true)
    expect(on.has('expenses')).toBe(false)
  })

  it('cascades requires: staff app is off when staff is off', () => {
    const on = enabledModules(['staff'])
    expect(on.has('staff')).toBe(false)
    expect(on.has('staffApp')).toBe(false)
  })

  it('treats platform-withheld modules as off', () => {
    const on = enabledModules([], ['food'])
    expect(on.has('food')).toBe(false)
    expect(on.has('grocery')).toBe(true)
  })
})

describe('moduleForPath', () => {
  it('maps the dashboard root only exactly', () => {
    expect(moduleForPath('/app')).toBe('dashboard')
    expect(moduleForPath('/app/unknown')).toBeNull()
  })

  it('matches nested routes by prefix', () => {
    expect(moduleForPath('/app/residents/abc')).toBe('residents')
    expect(moduleForPath('/app/beds')).toBe('properties')
    expect(moduleForPath('/app/expenses/new')).toBe('expenses')
    expect(moduleForPath('/app/settings/team')).toBe('settings')
  })

  it('does not match a route that only shares a prefix string', () => {
    expect(moduleForPath('/app/rentals')).toBeNull()
  })
})

describe('resolveAccess', () => {
  it('gives the owner every permission when all modules are on', () => {
    const a = resolveAccess({ role: 'OWNER', rolePermissions: null, disabledModules: [], flagsOff: [] })
    expect(new Set(a.permissions)).toEqual(new Set(ALL_PERMISSIONS))
  })

  it('gives the owner only permissions of enabled modules', () => {
    const a = resolveAccess({ role: 'OWNER', rolePermissions: null, disabledModules: ['expenses', 'food'], flagsOff: [] })
    expect(a.modules).not.toContain('expenses')
    expect(a.permissions).not.toContain('expenses.manage')
    expect(a.permissions).not.toContain('food.view')
    expect(a.permissions).toContain('residents.manage')
    for (const p of a.permissions) expect(a.modules).toContain(MODULE_OF_PERMISSION[p])
  })

  it('gives a manager without a custom role the Manager template', () => {
    const a = resolveAccess({ role: 'MANAGER', rolePermissions: null, disabledModules: [], flagsOff: [] })
    expect(new Set(a.permissions)).toEqual(new Set(managerTemplate))
    expect(a.permissions).not.toContain('team.manage')
    expect(a.permissions).not.toContain('billing.manage')
  })

  it('uses the custom role permissions when present', () => {
    const a = resolveAccess({ role: 'MANAGER', rolePermissions: ['rent.view', 'payments.record'], disabledModules: [], flagsOff: [] })
    expect(a.permissions.sort()).toEqual(['payments.record', 'rent.view'])
  })

  it('removes permissions of a disabled module from a custom role', () => {
    const a = resolveAccess({ role: 'MANAGER', rolePermissions: ['expenses.manage', 'rent.view'], disabledModules: ['expenses'], flagsOff: [] })
    expect(a.permissions).toEqual(['rent.view'])
  })

  it('removes staff-app permissions through the requires cascade', () => {
    const a = resolveAccess({ role: 'WORKER', rolePermissions: ['attendance.self', 'tasks.work'], disabledModules: ['staff'], flagsOff: [] })
    expect(a.modules).not.toContain('staffApp')
    expect(a.permissions).toEqual(['tasks.work'])
  })

  it('withholds a module whose platform flag is off', () => {
    const a = resolveAccess({ role: 'OWNER', rolePermissions: null, disabledModules: [], flagsOff: ['whatsapp_reminders', 'food_module'] })
    expect(a.modules).not.toContain('whatsapp')
    expect(a.modules).not.toContain('food')
    expect(a.permissions).not.toContain('messages.view')
    expect(a.permissions).not.toContain('food.manage')
  })

  it('gives tenants no permissions', () => {
    const a = resolveAccess({ role: 'TENANT', rolePermissions: null, disabledModules: [], flagsOff: [] })
    expect(a.permissions).toEqual([])
    expect(a.modules).toContain('residentApp')
  })

  it('ignores unknown permission keys', () => {
    const a = resolveAccess({ role: 'MANAGER', rolePermissions: ['made.up', 'rent.view'], disabledModules: [], flagsOff: [] })
    expect(a.permissions).toEqual(['rent.view'])
  })
})
