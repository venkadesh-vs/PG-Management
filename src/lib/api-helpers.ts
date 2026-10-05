import 'server-only'

import { NextResponse } from 'next/server'
import { ZodError, type ZodSchema } from 'zod'
import { Prisma } from '@prisma/client'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from './tenancy'
import { getSessionUser, isOrgRestricted, type SessionUser } from './auth'
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
    return fail(first ? humanizeIssue(first) : 'Please check the form and try again.', 422, error.issues)
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
  return fail('Something went wrong on our side. Please try again in a moment.', 500)
}

/** "fullName" / "guardian.phone" → "Full name" / "Guardian phone". */
function fieldLabel(path: (string | number)[]) {
  const key = path.filter((p) => typeof p === 'string').join(' ')
  if (!key) return 'This field'
  const words = key
    .replace(/Id/g, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[._-]+/g, ' ')
    .trim()
    .toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * Turns a validation issue into a sentence a PG owner can act on. Custom
 * messages written in our schemas ("Enter a valid email address") are kept;
 * Zod's generic defaults are rewritten.
 */
function humanizeIssue(issue: ZodError['issues'][number]) {
  const label = fieldLabel(issue.path)
  const generic = /^(Required|Invalid|Expected|String must|Number must|Array must)/.test(issue.message)
  if (!generic) return issue.message
  switch (issue.code) {
    case 'invalid_type':
      return issue.received === 'undefined' || issue.received === 'null'
        ? `${label} is required.`
        : `${label} is not in the right format.`
    case 'too_small':
      if (issue.type === 'string') return issue.minimum === 1 ? `${label} is required.` : `${label} is too short.`
      if (issue.type === 'array') return `Choose at least ${issue.minimum} for ${label.toLowerCase()}.`
      return `${label} must be at least ${issue.minimum}.`
    case 'too_big':
      if (issue.type === 'string') return `${label} is too long.`
      return `${label} must be ${issue.maximum} or less.`
    case 'invalid_string':
      if (issue.validation === 'email') return 'Enter a valid email address.'
      return `${label} is not in the right format.`
    case 'invalid_enum_value':
      return `Choose a valid option for ${label.toLowerCase()}.`
    case 'invalid_date':
      return `Enter a valid date for ${label.toLowerCase()}.`
    default:
      return `Please check ${label.toLowerCase()}.`
  }
}

/** Wraps a handler with auth + error handling. */
export function route<T>(
  handler: (ctx: { user: SessionUser; request: Request }) => Promise<T>,
  options?: {
    roles?: UserRole[]
    public?: boolean
    allowPendingPassword?: boolean
    /** Lets a suspended organization still call this (billing, sign-out). */
    allowRestricted?: boolean
  },
) {
  return async (request: Request) => {
    try {
      const user = await getSessionUser()
      if (!options?.public) {
        if (!user) return fail('Please sign in', 401)
        if (user.mustChangePassword && !options?.allowPendingPassword) {
          return fail('Set a new password before continuing', 403)
        }
        // A suspended organization can read its data but change nothing until
        // the subscription is paid.
        if (
          request.method !== 'GET' &&
          isOrgRestricted(user) &&
          user.role !== 'SUPER_ADMIN' &&
          !options?.allowRestricted
        ) {
          return fail('Your StayFlow subscription is suspended. Pay the pending invoice to continue.', 402)
        }
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
