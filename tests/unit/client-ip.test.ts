import { describe, expect, it } from 'vitest'
import { ipFromHeaders } from '@/lib/client-ip'

const headers = (h: Record<string, string>) => (name: string) => h[name] ?? null

describe('ipFromHeaders', () => {
  it('always trusts the Netlify header', () => {
    expect(ipFromHeaders(headers({ 'x-nf-client-connection-ip': '1.2.3.4', 'x-real-ip': '9.9.9.9' }), false)).toBe('1.2.3.4')
  })
  it('ignores client-settable headers unless a trusted proxy is configured', () => {
    expect(ipFromHeaders(headers({ 'x-real-ip': '9.9.9.9', 'x-forwarded-for': '8.8.8.8' }), false)).toBeNull()
  })
  it('uses proxy headers when trusted, taking the right-most forwarded entry', () => {
    expect(ipFromHeaders(headers({ 'x-real-ip': '9.9.9.9' }), true)).toBe('9.9.9.9')
    expect(ipFromHeaders(headers({ 'x-forwarded-for': 'spoofed, 5.6.7.8' }), true)).toBe('5.6.7.8')
    expect(ipFromHeaders(headers({}), true)).toBeNull()
  })
})
