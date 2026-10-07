import 'server-only'

import { prisma } from './prisma'
import { ipFromHeaders } from './client-ip'

export { ipFromHeaders }

/** What clientIp() returns when no trustworthy IP header is present. */
export const UNKNOWN_IP = 'unknown'

/**
 * Per-IP keys ("…:ip:unknown") for callers whose IP we cannot trust are not
 * counted: one shared bucket would let a single attacker lock out everyone.
 * Per-email/per-account keys still apply.
 */
const untracked = (key: string) => key.endsWith(`:ip:${UNKNOWN_IP}`)

/**
 * Sliding-window limiter backed by Postgres, so it holds across serverless
 * instances (an in-memory Map resets with every cold start). Each attempt is
 * one RateLimitHit row; the daily job sweeps old rows.
 */
export async function isRateLimited(key: string, limit: number, windowMinutes: number) {
  if (untracked(key)) return false
  const since = new Date(Date.now() - windowMinutes * 60_000)
  const count = await prisma.rateLimitHit.count({ where: { key, createdAt: { gte: since } } })
  return count >= limit
}

export async function recordHit(key: string) {
  if (untracked(key)) return
  await prisma.rateLimitHit.create({ data: { key } })
}

export async function clearHits(key: string) {
  await prisma.rateLimitHit.deleteMany({ where: { key } })
}

/** Deletes hits older than a day. Called from the daily automation. */
export async function sweepRateLimits() {
  const { count } = await prisma.rateLimitHit.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - 86_400_000) } },
  })
  return count
}

/** Client IP for rate limits, or UNKNOWN_IP when no trustworthy header is present. */
export async function clientIp() {
  // Imported lazily so the daily CLI job can use this module outside Next.
  const { headers } = await import('next/headers')
  const h = await headers()
  return ipFromHeaders((name) => h.get(name)) ?? UNKNOWN_IP
}
