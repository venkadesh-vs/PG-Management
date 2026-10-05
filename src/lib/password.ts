import bcrypt from 'bcryptjs'

/**
 * Password hashing lives on its own so business services can use it without
 * importing `lib/auth.ts`, which pulls in `next/navigation` and cannot run
 * outside a Next request (the seed and CLI scripts need it too).
 */

const ROUNDS = 10

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS)
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}
