/**
 * Who may hand out which access. Pure, so the roles and team APIs and the
 * tests share one rule set.
 *
 * - The owner (and platform staff) may grant anything.
 * - Anyone else may only grant permissions they hold themselves, and never
 *   the owner-level ones below: those let a person rewrite roles, change
 *   integrations or pay the subscription.
 * - A PG-limited person may only give access to PGs they look after.
 * - Nobody but an owner may act on an owner's login.
 */

export const OWNER_ONLY_PERMISSIONS = ['team.manage', 'billing.manage', 'settings.manage'] as const

type Actor = { role: string; permissions: readonly string[] }

const isOwnerLevel = (role: string) => role === 'OWNER' || role === 'SUPER_ADMIN'

/** Why `actor` may not give out `permissions`, or null when they may. */
export function grantProblem(actor: Actor, permissions: readonly string[]): string | null {
  if (isOwnerLevel(actor.role)) return null
  if (permissions.some((p) => (OWNER_ONLY_PERMISSIONS as readonly string[]).includes(p))) {
    return 'Only the PG owner can give access to roles, settings or the subscription.'
  }
  const own = new Set(actor.permissions)
  if (permissions.some((p) => !own.has(p))) {
    return 'You can only give access that you have yourself. Ask the PG owner to add the rest.'
  }
  return null
}

/**
 * Why `actor` may not change a role from `before` to `after` permissions, or
 * null. Only what is being added has to be within the actor's own access, but
 * a role that holds owner-level access stays the owner's to edit.
 */
export function roleEditProblem(actor: Actor, before: readonly string[], after: readonly string[]): string | null {
  if (isOwnerLevel(actor.role)) return null
  const ownerOnly = OWNER_ONLY_PERMISSIONS as readonly string[]
  if (before.some((p) => ownerOnly.includes(p))) {
    return 'This role has owner-level access, so only the PG owner can change it.'
  }
  const had = new Set(before)
  return grantProblem(actor, after.filter((p) => !had.has(p)))
}

/** Why a PG-limited actor may not give access to `requested` PGs, or null. Empty `requested` = all PGs. */
export function pgScopeProblem(actorPropertyIds: readonly string[], requested: readonly string[]): string | null {
  if (!actorPropertyIds.length) return null
  if (!requested.length) return 'Choose the PGs they will look after. You can only give access to your own PGs.'
  const own = new Set(actorPropertyIds)
  if (requested.some((id) => !own.has(id))) return 'You can only give access to PGs you look after.'
  return null
}

/** Why `actor` may not act on `member`'s login, or null. */
export function memberActionProblem(actor: { role: string }, member: { role: string }): string | null {
  if (member.role === 'OWNER' && !isOwnerLevel(actor.role)) return 'Only an owner can change an owner’s login.'
  return null
}
