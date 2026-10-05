import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

// Unit tests for pure logic only — no database, no Next runtime.
export default defineConfig({
  resolve: {
    alias: [
      { find: /^server-only$/, replacement: r('./tests/stubs/empty.ts') },
      { find: /^@\//, replacement: r('./src') + '/' },
    ],
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    env: {
      // Production runs in India; date helpers must hold in IST.
      TZ: 'Asia/Kolkata',
      // Test-only key (32 bytes, base64). Never use outside tests.
      DATA_ENCRYPTION_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
    },
  },
})
