import 'server-only'

import { createHash, randomBytes } from 'node:crypto'
import type { AuthTokenKind, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { serverEnv } from '@/lib/env'

/**
 * Single-use links for invitations, password resets and email verification.
 * The raw token only ever exists in the link; the database keeps its hash.
 */

const TTL_HOURS: Record<AuthTokenKind, number> = {
  INVITE: 72,
  PASSWORD_RESET: 1,
  EMAIL_VERIFY: 72,
}

const PATH: Record<AuthTokenKind, string> = {
  INVITE: '/invite',
  PASSWORD_RESET: '/reset-password',
  EMAIL_VERIFY: '/verify-email',
}

function hash(raw: string) {
  return createHash('sha256').update(raw).digest('hex')
}

/**
 * Issues a fresh token and invalidates earlier unused ones of the same kind,
 * so only the newest link works. Returns the absolute URL to send.
 */
export async function issueAuthToken(
  userId: string,
  kind: AuthTokenKind,
  tx: Prisma.TransactionClient = prisma,
) {
  const raw = randomBytes(32).toString('base64url')
  await tx.authToken.updateMany({
    where: { userId, kind, usedAt: null },
    data: { usedAt: new Date() },
  })
  await tx.authToken.create({
    data: {
      userId,
      kind,
      tokenHash: hash(raw),
      expiresAt: new Date(Date.now() + TTL_HOURS[kind] * 3600_000),
    },
  })
  return { token: raw, url: `${serverEnv.appUrl}${PATH[kind]}?token=${raw}` }
}

/** Looks a token up without using it (to render the page). */
export async function peekAuthToken(raw: string, kind: AuthTokenKind) {
  if (!raw) return null
  const row = await prisma.authToken.findUnique({
    where: { tokenHash: hash(raw) },
    include: { user: { select: { id: true, name: true, email: true, role: true, status: true } } },
  })
  if (!row || row.kind !== kind || row.usedAt || row.expiresAt < new Date()) return null
  if (row.user.status === 'ARCHIVED') return null
  return row
}

/**
 * Marks the token used, atomically: two simultaneous submissions of the same
 * link cannot both succeed. Returns the user id, or null if invalid.
 */
export async function consumeAuthToken(
  raw: string,
  kind: AuthTokenKind,
  tx: Prisma.TransactionClient = prisma,
) {
  const row = await tx.authToken.findUnique({ where: { tokenHash: hash(raw) } })
  if (!row || row.kind !== kind) return null
  const { count } = await tx.authToken.updateMany({
    where: { id: row.id, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  })
  return count === 1 ? row.userId : null
}
