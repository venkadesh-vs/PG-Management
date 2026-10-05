// Must run before any Date math: pins the process to IST.
import './timezone'
import { PrismaClient } from '@prisma/client'

// Next.js hot-reloads modules in dev; without the global cache every reload
// would open a new pool and exhaust Postgres connections.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export type { Prisma } from '@prisma/client'
