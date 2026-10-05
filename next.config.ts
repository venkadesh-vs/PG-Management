import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Next 16 writes AGENTS.md/CLAUDE.md into the repo root on dev start; this
  // project documents itself in README.md instead.
  agentRules: false,
  serverExternalPackages: ['@prisma/client', 'bcryptjs'],
  images: { remotePatterns: [{ protocol: 'https', hostname: '**' }] },
  // Lets a phone on the same Wi-Fi open the dev server by the PC's LAN IP.
  allowedDevOrigins: ['192.168.*.*', '10.*.*.*'],
  async headers() {
    return [
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
