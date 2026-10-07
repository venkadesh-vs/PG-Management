import 'server-only'

import { createHash, randomBytes } from 'node:crypto'
import { cookies, headers } from 'next/headers'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { SignJWT, jwtVerify } from 'jose'
import type { OrgStatus, UserRole } from '@prisma/client'

import { prisma } from './prisma'
import { serverEnv } from './env'
import { resolveAccess } from './access'
import { ipFromHeaders } from './client-ip'
import { planExcludedModules } from './plan-entitlements'
import type { ModuleKey } from './modules'

export const SESSION_COOKIE = 'stayflow_session'

export type SessionUser = {
  id: string
  name: string
  email: string
  role: UserRole
  organizationId: string | null
  organizationName: string | null
  organizationSlug: string | null
  /** null for platform users. SUSPENDED/CANCELLED orgs are restricted. */
  organizationStatus: OrgStatus | null
  avatarUrl: string | null
  residentId: string | null
  staffId: string | null
  /** Property ids a MANAGER/WORKER is restricted to. Empty = unrestricted. */
  propertyIds: string[]
  /** Generated password still in use — everything is blocked until it changes. */
  mustChangePassword: boolean
  sessionId: string
  /** Modules switched on for this organization. */
  modules: ModuleKey[]
  /** Permission keys this person holds (see lib/permission-catalog). */
  permissions: string[]
  /** Name of their custom role, for display. */
  roleName: string | null
}

// Password helpers live in lib/password.ts so services and CLI scripts can
// hash without importing this module's Next-only navigation helpers.
export { hashPassword, verifyPassword } from './password'

// --------------------------------------------------------------------------
// Session tokens
//
// The cookie carries a signed JWT whose `jti` is the opaque session secret.
// Only the SHA-256 of that secret is stored, so a leaked database row cannot
// be replayed as a session. Every request re-checks the DB row, which makes
// revocation (logout, suspension) immediate.
// --------------------------------------------------------------------------

function secretKey() {
  return new TextEncoder().encode(serverEnv.authSecret)
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export async function createSession(userId: string) {
  const raw = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + serverEnv.sessionHours * 3600_000)

  const hdrs = await headers()
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(raw),
      expiresAt,
      userAgent: hdrs.get('user-agent')?.slice(0, 250) ?? null,
      ip: ipFromHeaders((name) => hdrs.get(name)),
    },
  })

  const jwt = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setJti(raw)
    .setExpirationTime(expiresAt)
    .sign(secretKey())

  const store = await cookies()
  store.set(SESSION_COOKIE, jwt, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  })

  return { expiresAt }
}

export async function destroySession() {
  const store = await cookies()
  const jwt = store.get(SESSION_COOKIE)?.value
  if (jwt) {
    try {
      const { payload } = await jwtVerify(jwt, secretKey())
      if (payload.jti) {
        await prisma.session.updateMany({
          where: { tokenHash: hashToken(payload.jti) },
          data: { revokedAt: new Date() },
        })
      }
    } catch {
      // A malformed or expired cookie simply gets cleared.
    }
  }
  store.delete(SESSION_COOKIE)
}

/**
 * Resolves the signed-in user for the current request. Cached per-request so
 * a page rendering ten server components hits the database once.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const store = await cookies()
  const jwt = store.get(SESSION_COOKIE)?.value
  if (!jwt) return null

  let jti: string | undefined
  try {
    const { payload } = await jwtVerify(jwt, secretKey())
    jti = payload.jti
  } catch {
    return null
  }
  if (!jti) return null

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(jti) },
    include: {
      user: {
        include: {
          organization: {
            select: {
              id: true,
              name: true,
              slug: true,
              status: true,
              featureOverrides: true,
              settings: { select: { disabledModules: true } },
              subscriptions: {
                where: { status: { not: 'CANCELLED' } },
                select: { plan: { select: { features: true } } },
              },
            },
          },
          orgRole: { select: { name: true, permissions: true } },
          resident: { select: { id: true } },
          staff: { select: { id: true } },
          propertyAccess: { select: { propertyId: true } },
        },
      },
    },
  })

  if (!session || session.revokedAt || session.expiresAt < new Date()) return null
  const user = session.user
  if (!user || user.status === 'SUSPENDED' || user.status === 'ARCHIVED') return null

  // Platform switches: a flag turned off globally, or overridden off for this org.
  const overrides = (user.organization?.featureOverrides ?? {}) as Record<string, unknown>
  const flagsOff = [
    ...(await prisma.featureFlag.findMany({ where: { enabled: false }, select: { key: true } })).map((f) => f.key),
    ...Object.entries(overrides)
      .filter(([, v]) => v === false)
      .map(([k]) => k),
  ]
  const access = resolveAccess({
    role: user.role,
    rolePermissions: user.orgRole?.permissions ?? null,
    disabledModules: user.organization?.settings?.disabledModules ?? [],
    flagsOff,
    // Modules the org's plan(s) do not include. Plans with an empty / legacy
    // feature list include everything.
    planOff: planExcludedModules((user.organization?.subscriptions ?? []).map((s) => s.plan.features)),
  })

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    organizationId: user.organizationId,
    organizationName: user.organization?.name ?? null,
    organizationSlug: user.organization?.slug ?? null,
    organizationStatus: user.organization?.status ?? null,
    avatarUrl: user.avatarUrl,
    residentId: user.resident?.id ?? null,
    staffId: user.staff?.id ?? null,
    propertyIds: user.propertyAccess.map((p) => p.propertyId),
    mustChangePassword: user.mustChangePassword,
    sessionId: session.id,
    modules: access.modules,
    permissions: access.permissions,
    roleName: user.role === 'OWNER' ? 'Owner' : (user.orgRole?.name ?? null),
  }
})

/** Signs the user out of every other device, e.g. after a password change. */
export async function revokeOtherSessions(userId: string, keepSessionId: string) {
  await prisma.session.updateMany({
    where: { userId, id: { not: keepSessionId }, revokedAt: null },
    data: { revokedAt: new Date() },
  })
}

// --------------------------------------------------------------------------
// Guards. Server components and route handlers call these — never rely on
// client-side routing for access control.
// --------------------------------------------------------------------------

export const HOME_FOR_ROLE: Record<UserRole, string> = {
  SUPER_ADMIN: '/admin',
  OWNER: '/app',
  MANAGER: '/app',
  WORKER: '/worker',
  TENANT: '/tenant',
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  if (user.mustChangePassword) redirect('/change-password')
  return user
}

export async function requireRole(...roles: UserRole[]): Promise<SessionUser> {
  const user = await requireUser()
  if (!roles.includes(user.role)) redirect(HOME_FOR_ROLE[user.role])
  return user
}

/** True when the organization has lost access for non-payment or cancellation. */
export function isOrgRestricted(user: Pick<SessionUser, 'organizationStatus'>) {
  return user.organizationStatus === 'SUSPENDED' || user.organizationStatus === 'CANCELLED'
}

/** OWNER or MANAGER of an organization. */
export async function requireOrgUser(): Promise<SessionUser & { organizationId: string }> {
  const user = await requireRole('OWNER', 'MANAGER')
  if (!user.organizationId) redirect('/login')
  return user as SessionUser & { organizationId: string }
}

/**
 * Page guard for the owner dashboard: the module must be on and the person
 * must hold the permission. Sends them to a friendly explanation otherwise,
 * never a blank page or a 403.
 */
export async function requireAccess(opts: { module?: ModuleKey; permission?: string }) {
  const user = await requireOrgUser()
  if (opts.module && !user.modules.includes(opts.module)) redirect(`/app/feature-off?module=${opts.module}`)
  if (opts.permission && !user.permissions.includes(opts.permission)) redirect('/app/no-access')
  return user
}

export async function requireSuperAdmin(): Promise<SessionUser> {
  return requireRole('SUPER_ADMIN')
}

export async function requireTenant(): Promise<SessionUser & { residentId: string }> {
  const user = await requireRole('TENANT')
  if (!user.residentId) redirect('/login')
  if (isOrgRestricted(user)) redirect('/service-paused')
  if (!user.modules.includes('residentApp')) redirect('/app-unavailable')
  return user as SessionUser & { residentId: string }
}

export async function requireWorker(): Promise<SessionUser & { staffId: string }> {
  const user = await requireRole('WORKER')
  if (!user.staffId) redirect('/login')
  if (isOrgRestricted(user)) redirect('/service-paused')
  if (!user.modules.includes('staffApp')) redirect('/app-unavailable')
  return user as SessionUser & { staffId: string }
}

// Permissions live in lib/permissions so CLI scripts and services can use
// them without pulling in next/navigation.
export { PERMISSIONS, can, type Permission } from './permissions'
