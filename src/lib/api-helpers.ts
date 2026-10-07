import 'server-only'

import { NextResponse } from 'next/server'
import { ZodError, type ZodSchema } from 'zod'
import { Prisma } from '@prisma/client'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from './tenancy'
import { getSessionUser, isOrgRestricted, type SessionUser } from './auth'
import type { UserRole } from '@prisma/client'
import type { ModuleKey } from './modules'
import { errorCodeFor, newRef, sanitizeRequestId, type ErrorCode } from './error-codes'
import { log, logError } from './logger'

/**
 * Route-handler plumbing: one place that turns domain errors into HTTP
 * responses, so no handler ever leaks a stack trace or a Prisma message to
 * the browser.
 */

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data as object, init)
}

/**
 * Error response: `{ error, details, code, ref }`. `error` is the sentence
 * shown to people; `code` (lib/error-codes) and `ref` (the request id, also in
 * the logs and the `x-request-id` header) are for support.
 */
export function fail(
  message: string,
  status = 400,
  details?: unknown,
  meta?: { code?: ErrorCode; ref?: string; path?: string | null },
) {
  const code = errorCodeFor(status, meta?.path, meta?.code)
  const ref = meta?.ref
  const response = NextResponse.json({ error: message, details, code, ...(ref ? { ref } : {}) }, { status })
  if (ref) response.headers.set('x-request-id', ref)
  return response
}

/** What the logs should know about the request an error came from. */
export type ErrorContext = {
  requestId?: string
  path?: string | null
  method?: string
  organizationId?: string | null
  userId?: string | null
}

/** An error may carry its own code (`error.code = 'PAYMENT_FAILED'`). */
function explicitCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'errorCode' in error
    ? (error as { errorCode: unknown }).errorCode
    : undefined
}

export function handleError(error: unknown, ctx: ErrorContext = {}) {
  const ref = ctx.requestId ?? newRef()
  const meta = (status: number, code?: ErrorCode) => ({
    ref,
    path: ctx.path,
    code: (code ?? explicitCode(error)) as ErrorCode | undefined,
  })
  const fields = {
    requestId: ref,
    route: ctx.path ?? null,
    method: ctx.method ?? null,
    organizationId: ctx.organizationId ?? null,
    userId: ctx.userId ?? null,
  }
  if (error instanceof ZodError) {
    const first = error.issues[0]
    return fail(first ? humanizeIssue(first) : 'Please check the form and try again.', 422, error.issues, meta(422))
  }
  if (
    error instanceof ValidationError ||
    error instanceof ForbiddenError ||
    error instanceof NotFoundError ||
    error instanceof ConflictError
  ) {
    const status = error.status
    const code = error.name === 'PlanLimitError' ? 'PLAN_LIMIT' : undefined
    const response = fail(
      error.message,
      status,
      error instanceof ValidationError ? error.details : undefined,
      meta(status, code),
    )
    // Refusals worth noticing in the logs: access denials and money conflicts.
    if (status === 403 || status === 409 || status === 402) {
      log('warn', 'request.refused', { ...fields, status, code: errorCodeFor(status, ctx.path, code ?? explicitCode(error)), message: error.message })
    }
    return response
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return fail('That record already exists', 409, undefined, meta(409))
    if (error.code === 'P2025') return fail('Not found', 404, undefined, meta(404))
    if (error.code === 'P2003') return fail('This record is still linked to something else', 409, undefined, meta(409))
  }
  const code = errorCodeFor(500, ctx.path, explicitCode(error))
  void logError('request.failed', error, { ...fields, status: 500, code })
  return fail(
    `Something went wrong on our side. Please try again in a moment. If it keeps happening, share reference ${ref} with support.`,
    500,
    undefined,
    { ...meta(500), code },
  )
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
    /** Catalog permission required (lib/permission-catalog). Owners always pass. */
    permission?: string
    /** Module that must be switched on (lib/modules). */
    module?: ModuleKey
  },
) {
  return async (request: Request) => {
    const requestId = sanitizeRequestId(request.headers.get('x-request-id')) ?? newRef()
    const path = safePath(request.url)
    const deny = (message: string, status: number, code: ErrorCode) =>
      fail(message, status, undefined, { code, ref: requestId, path })
    let user: SessionUser | null = null
    try {
      user = await getSessionUser()
      if (!options?.public) {
        if (!user) return deny('Please sign in', 401, 'AUTH_REQUIRED')
        if (user.mustChangePassword && !options?.allowPendingPassword) {
          return deny('Set a new password before continuing', 403, 'AUTH_PASSWORD_CHANGE')
        }
        // A suspended organization can read its data but change nothing until
        // the subscription is paid.
        if (
          request.method !== 'GET' &&
          isOrgRestricted(user) &&
          user.role !== 'SUPER_ADMIN' &&
          !options?.allowRestricted
        ) {
          return deny('Your StayFlow subscription is suspended. Pay the pending invoice to continue.', 402, 'SUBSCRIPTION_SUSPENDED')
        }
        if (options?.module && user.role !== 'SUPER_ADMIN' && !user.modules.includes(options.module)) {
          return deny('This feature is switched off for your PG. The owner can turn it on in Settings → Features.', 403, 'AUTH_MODULE_OFF')
        }
        if (options?.permission && user.role !== 'SUPER_ADMIN' && !user.permissions.includes(options.permission)) {
          return deny('Your role does not allow this. Ask the PG owner for access.', 403, 'AUTH_FORBIDDEN')
        }
        if (options?.roles && !options.roles.includes(user.role)) {
          return deny('You do not have permission to do that', 403, 'AUTH_FORBIDDEN')
        }
      }
      const result = await handler({ user: user as SessionUser, request })
      const response = result instanceof NextResponse ? result : ok(result)
      if (!response.headers.has('x-request-id')) response.headers.set('x-request-id', requestId)
      return response
    } catch (error) {
      return handleError(error, {
        requestId,
        path,
        method: request.method,
        organizationId: user?.organizationId ?? null,
        userId: user?.id ?? null,
      })
    }
  }
}

function safePath(url: string): string | null {
  try {
    return new URL(url).pathname
  } catch {
    return null
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
