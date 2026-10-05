import 'server-only'

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { serverEnv } from './env'

/**
 * AES-256-GCM for secrets we must be able to read back (a client's Razorpay
 * key secret, their WhatsApp access token). Format: v1.<iv>.<tag>.<data>,
 * all base64url. Passwords are never stored this way — they are hashed.
 */

function key() {
  const raw = serverEnv.dataEncryptionKey
  const buf = Buffer.from(raw, 'base64')
  if (buf.length !== 32) {
    throw new Error(
      'DATA_ENCRYPTION_KEY must be 32 random bytes, base64-encoded. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    )
  }
  return buf
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return ['v1', iv, tag, data].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join('.')
}

export function decryptSecret(token: string): string {
  const [version, iv, tag, data] = token.split('.')
  // `data` is legitimately empty when the encrypted secret was an empty string.
  if (version !== 'v1' || !iv || !tag || data === undefined) throw new Error('Unrecognised secret format')
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8')
}

/** Encrypts a JSON object (several secrets for one integration). */
export function encryptJson(value: Record<string, string>) {
  return encryptSecret(JSON.stringify(value))
}

export function decryptJson<T extends Record<string, string>>(token: string): T {
  return JSON.parse(decryptSecret(token)) as T
}

/** For display: "••••••1234". */
export function maskTail(value: string, visible = 4) {
  return value.length <= visible ? '•'.repeat(value.length) : `${'•'.repeat(6)}${value.slice(-visible)}`
}
