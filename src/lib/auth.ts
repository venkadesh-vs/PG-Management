import 'server-only'

import { createHash, randomBytes } from 'node:crypto'
import { cookies, headers } from 'next/headers'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { SignJWT, jwtVerify } from 'jose'
import type { UserRole } from '@prisma/client'

import { prisma } from './prisma'
import { serverEnv } from './env'

export const SESSION_COOKIE = 'stayflow_session'

export type SessionUser = {
  id: string
  name: string
  email: string
  role: UserRole
  organizationId: string | null
  organizationName: string | null
  organizationSlug: string | null
  avatarUrl: string | null
  residentId: string | null
  staffId: string | null
  /** Property ids a MANAGER/WORKER is restricted to. Empty = unrestricted. */
  propertyIds: string[]
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
      ip: (hdrs.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null,
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
          organization: { select: { id: true, name: true, slug: true, status: true } },
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

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    organizationId: user.organizationId,
    organizationName: user.organization?.name ?? null,
    organizationSlug: user.organization?.slug ?? null,
    avatarUrl: user.avatarUrl,
    residentId: user.resident?.id ?? null,
    staffId: user.staff?.id ?? null,
    propertyIds: user.propertyAccess.map((p) => p.propertyId),
  }
})

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
  return user
}

export async function requireRole(...roles: UserRole[]): Promise<SessionUser> {
  const user = await requireUser()
  if (!roles.includes(user.role)) redirect(HOME_FOR_ROLE[user.role])
  return user
}

/** OWNER or MANAGER of an organization. */
export async function requireOrgUser(): Promise<SessionUser & { organizationId: string }> {
  const user = await requireRole('OWNER', 'MANAGER')
  if (!user.organizationId) redirect('/login')
  return user as SessionUser & { organizationId: string }
}

export async function requireSuperAdmin(): Promise<SessionUser> {
  return requireRole('SUPER_ADMIN')
}

export async function requireTenant(): Promise<SessionUser & { residentId: string }> {
  const user = await requireRole('TENANT')
  if (!user.residentId) redirect('/login')
  return user as SessionUser & { residentId: string }
}

export async function requireWorker(): Promise<SessionUser & { staffId: string }> {
  const user = await requireRole('WORKER')
  if (!user.staffId) redirect('/login')
  return user as SessionUser & { staffId: string }
}

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

export function can(user: Pick<SessionUser, 'role'> | null, permission: Permission): boolean {
  if (!user) return false
  if (user.role === 'SUPER_ADMIN') return true
  return (PERMISSIONS[permission] as readonly UserRole[]).includes(user.role)
}
