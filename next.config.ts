import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Next 16 writes AGENTS.md/CLAUDE.md into the repo root on dev start; this
  // project documents itself in README.md instead.
  agentRules: false,
  serverExternalPackages: ['@prisma/client', 'bcryptjs'],
  // next/image is not used for remote files; an open pattern would turn the
  // optimizer into a free image proxy. Add the storage host here when needed.
  images: { remotePatterns: [] },
  // Lets a phone on the same Wi-Fi open the dev server by the PC's LAN IP.
  allowedDevOrigins: ['192.168.*.*', '10.*.*.*'],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=(self)' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
        ],
      },
      {
        // The service worker must always be re-checked so app updates land.
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ]
  },
}

export default nextConfig
