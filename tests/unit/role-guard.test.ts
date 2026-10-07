import { describe, expect, it } from 'vitest'
import { grantProblem, memberActionProblem, pgScopeProblem, roleEditProblem } from '@/lib/role-guard'

const owner = { role: 'OWNER', permissions: [] as string[] }
const manager = { role: 'MANAGER', permissions: ['team.manage', 'residents.view', 'residents.manage', 'rent.view'] }

describe('grantProblem', () => {
  it('lets the owner grant anything', () => {
    expect(grantProblem(owner, ['billing.manage', 'settings.manage', 'team.manage'])).toBeNull()
    expect(grantProblem({ role: 'SUPER_ADMIN', permissions: [] }, ['billing.manage'])).toBeNull()
  })
  it('lets a manager grant a subset of their own access', () => {
    expect(grantProblem(manager, ['residents.view', 'rent.view'])).toBeNull()
    expect(grantProblem(manager, [])).toBeNull()
  })
  it('refuses access the manager does not hold', () => {
    expect(grantProblem(manager, ['residents.view', 'invoices.waive'])).toMatch(/only give access that you have/)
  })
  it('refuses owner-level permissions even when the manager holds them', () => {
    expect(grantProblem(manager, ['team.manage'])).toMatch(/Only the PG owner/)
    expect(grantProblem({ ...manager, permissions: [...manager.permissions, 'settings.manage'] }, ['settings.manage'])).toMatch(
      /Only the PG owner/,
    )
  })
})

describe('roleEditProblem', () => {
  it('allows removing access and adding owned access', () => {
    expect(roleEditProblem(manager, ['residents.view', 'expenses.view'], ['residents.view'])).toBeNull()
    expect(roleEditProblem(manager, ['expenses.view'], ['expenses.view', 'rent.view'])).toBeNull()
  })
  it('refuses adding access the manager lacks', () => {
    expect(roleEditProblem(manager, ['residents.view'], ['residents.view', 'billing.manage'])).not.toBeNull()
    expect(roleEditProblem(manager, ['residents.view'], ['residents.view', 'invoices.waive'])).not.toBeNull()
  })
  it('keeps roles with owner-level access out of a manager’s hands', () => {
    expect(roleEditProblem(manager, ['team.manage', 'residents.view'], ['residents.view'])).toMatch(/owner-level/)
  })
  it('never limits the owner', () => {
    expect(roleEditProblem(owner, ['team.manage'], ['team.manage', 'billing.manage'])).toBeNull()
  })
})

describe('pgScopeProblem', () => {
  it('leaves unrestricted inviters alone', () => {
    expect(pgScopeProblem([], [])).toBeNull()
    expect(pgScopeProblem([], ['p1', 'p9'])).toBeNull()
  })
  it('requires a restricted inviter to pick PGs within their own', () => {
    expect(pgScopeProblem(['p1', 'p2'], [])).toMatch(/Choose the PGs/)
    expect(pgScopeProblem(['p1', 'p2'], ['p1', 'p3'])).toMatch(/PGs you look after/)
    expect(pgScopeProblem(['p1', 'p2'], ['p2'])).toBeNull()
  })
})

describe('memberActionProblem', () => {
  it('only lets owners act on owner logins', () => {
    expect(memberActionProblem({ role: 'MANAGER' }, { role: 'OWNER' })).not.toBeNull()
    expect(memberActionProblem({ role: 'OWNER' }, { role: 'OWNER' })).toBeNull()
    expect(memberActionProblem({ role: 'MANAGER' }, { role: 'MANAGER' })).toBeNull()
  })
})
