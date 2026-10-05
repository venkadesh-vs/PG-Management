import { afterEach, describe, expect, it } from 'vitest'
import { decryptJson, decryptSecret, encryptJson, encryptSecret, maskTail } from '@/lib/crypto'

const TEST_KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY='

afterEach(() => {
  process.env.DATA_ENCRYPTION_KEY = TEST_KEY
})

/** Flips one character of a base64url segment to a different valid one. */
function tamper(segment: string) {
  const c = segment[0] === 'A' ? 'B' : 'A'
  return c + segment.slice(1)
}

describe('encryptSecret / decryptSecret', () => {
  it('round-trips text, including unicode and empty strings', () => {
    for (const s of ['rzp_test_secret_123', '', 'नमस्ते ₹500 🔐', 'x'.repeat(5000)]) {
      expect(decryptSecret(encryptSecret(s))).toBe(s)
    }
  })

  it('produces the v1.<iv>.<tag>.<data> format with a fresh IV each time', () => {
    const a = encryptSecret('same')
    const b = encryptSecret('same')
    expect(a).not.toBe(b)
    const parts = a.split('.')
    expect(parts).toHaveLength(4)
    expect(parts[0]).toBe('v1')
    expect(Buffer.from(parts[1], 'base64url')).toHaveLength(12)
    expect(Buffer.from(parts[2], 'base64url')).toHaveLength(16)
    expect(a).not.toContain('same')
  })

  it('detects tampering with the ciphertext, tag or IV', () => {
    const token = encryptSecret('top secret value')
    const [v, iv, tag, data] = token.split('.')
    expect(() => decryptSecret([v, iv, tag, tamper(data)].join('.'))).toThrow()
    expect(() => decryptSecret([v, iv, tamper(tag), data].join('.'))).toThrow()
    expect(() => decryptSecret([v, tamper(iv), tag, data].join('.'))).toThrow()
  })

  it('rejects unknown formats', () => {
    expect(() => decryptSecret('garbage')).toThrow(/Unrecognised/)
    expect(() => decryptSecret('v2.a.b.c')).toThrow(/Unrecognised/)
  })

  it('cannot be decrypted with a different key', () => {
    const token = encryptSecret('hello')
    process.env.DATA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
    expect(() => decryptSecret(token)).toThrow()
  })

  it('refuses a key that is not 32 bytes', () => {
    process.env.DATA_ENCRYPTION_KEY = Buffer.alloc(16, 1).toString('base64')
    expect(() => encryptSecret('x')).toThrow(/32 random bytes/)
    process.env.DATA_ENCRYPTION_KEY = ''
    expect(() => encryptSecret('x')).toThrow(/32 random bytes/)
  })
})

describe('encryptJson / decryptJson', () => {
  it('round-trips an object of secrets', () => {
    const value = { keyId: 'rzp_live_abc', keySecret: 's3cr3t', webhookSecret: 'wh' }
    expect(decryptJson(encryptJson(value))).toEqual(value)
  })
})

describe('maskTail', () => {
  it('shows only the last characters', () => {
    expect(maskTail('abcdef1234')).toBe('••••••1234')
    expect(maskTail('abc')).toBe('•••')
  })
})
