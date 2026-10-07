import { ALL_PERMISSIONS, MODULE_OF_PERMISSION, ROLE_TEMPLATES } from './permission-catalog'
import { enabledModules, MODULES, type ModuleKey } from './modules'

/**
 * Turns what is stored (role, custom role, switched-off modules, platform
 * flags) into the two sets every check reads: which modules are on, and
 * which permissions this person holds. Pure, so the session loader, pages
 * and tests all compute it the same way.
 */
export function resolveAccess(input: {
  role: string
  rolePermissions: string[] | null
  disabledModules: string[]
  /** FeatureFlag keys switched off for this org (globally or by override). */
  flagsOff: string[]
  /** Optional module keys the org's plan does not include (lib/plan-entitlements). */
  planOff?: string[]
}): { modules: ModuleKey[]; permissions: string[] } {
  const platformOff = [
    ...MODULES.filter((m) => m.flag && input.flagsOff.includes(m.flag)).map((m) => m.key),
    ...(input.planOff ?? []),
  ]
  const modules = enabledModules(input.disabledModules, platformOff)

  let granted: string[]
  if (input.role === 'OWNER' || input.role === 'SUPER_ADMIN') granted = ALL_PERMISSIONS
  else if (input.role === 'MANAGER') granted = input.rolePermissions ?? template('Manager')
  else if (input.role === 'WORKER') granted = input.rolePermissions ?? template('General staff')
  else granted = []

  // A switched-off module grants nothing, whatever the role says.
  const permissions = granted.filter((p) => {
    const mod = MODULE_OF_PERMISSION[p]
    return mod ? modules.has(mod) : false
  })
  return { modules: [...modules], permissions: [...new Set(permissions)] }
}

function template(name: string) {
  return ROLE_TEMPLATES.find((t) => t.name === name)?.permissions ?? []
}
