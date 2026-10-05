import { describe, expect, it } from 'vitest'
import { generateTempPassword, passwordProblem } from '@/lib/password'

const READABLE = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'

describe('passwordProblem', () => {
  it('accepts letters + digits between 8 and 128 characters', () => {
    expect(passwordProblem('abcdefg1')).toBeNull()
    expect(passwordProblem('StayFlow@2026')).toBeNull()
    expect(passwordProblem('a1'.repeat(64))).toBeNull()
  })

  it('rejects short and long passwords', () => {
    expect(passwordProblem('abc1234')).toMatch(/at least 8/)
    expect(passwordProblem('a1'.repeat(64) + 'x')).toMatch(/at most 128/)
  })

  it('requires both letters and numbers', () => {
    expect(passwordProblem('abcdefgh')).toMatch(/letters and numbers/)
    expect(passwordProblem('12345678')).toMatch(/letters and numbers/)
    expect(passwordProblem('!@#$%^&*()')).toMatch(/letters and numbers/)
  })
})

describe('generateTempPassword', () => {
  it('has the requested length (default 10)', () => {
    expect(generateTempPassword()).toHaveLength(10)
    expect(generateTempPassword(16)).toHaveLength(16)
    expect(generateTempPassword(8)).toHaveLength(8)
  })

  it('uses only the readable alphabet (no 0/O/1/l/I)', () => {
    for (let i = 0; i < 200; i++) {
      for (const ch of generateTempPassword()) expect(READABLE).toContain(ch)
    }
  })

  it('always contains a digit and passes the password rule', () => {
    for (let i = 0; i < 500; i++) {
      const p = generateTempPassword()
      expect(p).toMatch(/\d/)
      expect(passwordProblem(p)).toBeNull()
    }
  })

  it('is random', () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateTempPassword()))
    expect(seen.size).toBe(500)
  })

  it('draws characters roughly uniformly', () => {
    const counts = new Map<string, number>()
    const draws = 20000
    for (let i = 0; i < draws / 20; i++) {
      for (const ch of generateTempPassword(20)) counts.set(ch, (counts.get(ch) ?? 0) + 1)
    }
    const expected = draws / READABLE.length
    expect(counts.size).toBe(READABLE.length)
    for (const n of counts.values()) {
      expect(n).toBeGreaterThan(expected * 0.6)
      expect(n).toBeLessThan(expected * 1.5)
    }
  })
})
