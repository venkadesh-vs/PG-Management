import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Next 16 writes AGENTS.md/CLAUDE.md into the repo root on dev start; this
  // project documents itself in README.md instead.
  agentRules: false,
  serverExternalPackages: ['@prisma/client', 'bcryptjs'],
  images: { remotePatterns: [{ protocol: 'https', hostname: '**' }] },
}

export default nextConfig
