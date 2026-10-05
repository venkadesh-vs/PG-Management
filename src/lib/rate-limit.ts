import 'server-only'

import { prisma } from './prisma'

/**
 * Sliding-window limiter backed by Postgres, so it holds across serverless
 * instances (an in-memory Map resets with every cold start). Each attempt is
 * one RateLimitHit row; the daily job sweeps old rows.
 */
export async function isRateLimited(key: string, limit: number, windowMinutes: number) {
  const since = new Date(Date.now() - windowMinutes * 60_000)
  const count = await prisma.rateLimitHit.count({ where: { key, createdAt: { gte: since } } })
  return count >= limit
}

export async function recordHit(key: string) {
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

/**
 * Best-effort client IP. Behind Netlify/Vercel the platform sets these; the
 * left-most x-forwarded-for entry can be spoofed, so the platform header wins.
 */
export async function clientIp() {
  // Imported lazily so the daily CLI job can use this module outside Next.
  const { headers } = await import('next/headers')
  const h = await headers()
  return (
    h.get('x-nf-client-connection-ip') ??
    h.get('x-real-ip') ??
    (h.get('x-forwarded-for') ?? '').split(',').pop()?.trim() ??
    'unknown'
  )
}
