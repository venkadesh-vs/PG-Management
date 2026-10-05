import bcrypt from 'bcryptjs'

/**
 * Password hashing lives on its own so business services can use it without
 * importing `lib/auth.ts`, which pulls in `next/navigation` and cannot run
 * outside a Next request (the seed and CLI scripts need it too).
 */

const ROUNDS = 12

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS)
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}

/** Shared rule for every password a person chooses. */
export function passwordProblem(plain: string): string | null {
  if (plain.length < 8) return 'Use at least 8 characters'
  if (plain.length > 128) return 'Use at most 128 characters'
  if (!/[a-zA-Z]/.test(plain) || !/\d/.test(plain)) return 'Use both letters and numbers'
  return null
}

const READABLE = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'

/**
 * A one-time password for a new resident or staff login. Random (never
 * derived from a phone number), readable aloud, and always paired with
 * `mustChangePassword` so it is replaced at first sign-in.
 */
export function generateTempPassword(length = 10): string {
  // Rejection sampling keeps every character equally likely.
  const limit = 256 - (256 % READABLE.length)
  let out = ''
  while (out.length < length) {
    for (const b of crypto.getRandomValues(new Uint8Array(length))) {
      if (b < limit && out.length < length) out += READABLE[b % READABLE.length]
    }
  }
  // Guarantee it passes passwordProblem() even if the draw had no digit.
  return /\d/.test(out) ? out : `${out.slice(0, -1)}7`
}
