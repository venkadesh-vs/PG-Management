import 'server-only'

import { NextResponse } from 'next/server'
import { ZodError, type ZodSchema } from 'zod'
import { Prisma } from '@prisma/client'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from './tenancy'
import { getSessionUser, type SessionUser } from './auth'
import type { UserRole } from '@prisma/client'

/**
 * Route-handler plumbing: one place that turns domain errors into HTTP
 * responses, so no handler ever leaks a stack trace or a Prisma message to
 * the browser.
 */

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data as object, init)
}

export function fail(message: string, status = 400, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status })
}

export function handleError(error: unknown) {
  if (error instanceof ZodError) {
    const first = error.issues[0]
    return fail(first ? `${first.path.join('.')}: ${first.message}` : 'Invalid input', 422, error.issues)
  }
  if (
    error instanceof ValidationError ||
    error instanceof ForbiddenError ||
    error instanceof NotFoundError ||
    error instanceof ConflictError
  ) {
    return fail(error.message, error.status)
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return fail('That record already exists', 409)
    if (error.code === 'P2025') return fail('Not found', 404)
    if (error.code === 'P2003') return fail('This record is still linked to something else', 409)
  }
  console.error('[api]', error)
  return fail('Something went wrong on our side', 500)
}

/** Wraps a handler with auth + error handling. */
export function route<T>(
  handler: (ctx: { user: SessionUser; request: Request }) => Promise<T>,
  options?: { roles?: UserRole[]; public?: boolean },
) {
  return async (request: Request) => {
    try {
      const user = await getSessionUser()
      if (!options?.public) {
        if (!user) return fail('Please sign in', 401)
        if (options?.roles && !options.roles.includes(user.role)) {
          return fail('You do not have permission to do that', 403)
        }
      }
      const result = await handler({ user: user as SessionUser, request })
      return result instanceof NextResponse ? result : ok(result)
    } catch (error) {
      return handleError(error)
    }
  }
}

export async function parseBody<T>(request: Request, schema: ZodSchema<T>): Promise<T> {
  let json: unknown
  try {
    json = await request.json()
  } catch {
    throw new ValidationError('Request body must be valid JSON')
  }
  return schema.parse(json)
}

export function parseQuery<T>(request: Request, schema: ZodSchema<T>): T {
  const url = new URL(request.url)
  return schema.parse(Object.fromEntries(url.searchParams.entries()))
}
