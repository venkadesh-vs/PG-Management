import 'server-only'

import { prisma } from './prisma'
import type { SessionUser } from './auth'

/**
 * Multi-tenant scoping. Never build a query from a client-supplied
 * organizationId or propertyId without passing it through here first.
 */

export type PropertyScope = {
  organizationId: string
  /** null = every property in the org, otherwise a specific one. */
  propertyId: string | null
  /** The full set of property ids this user may read. */
  allowedPropertyIds: string[]
}

/** Resolve the property filter for an org user, honouring PropertyAccess. */
export async function resolveScope(
  user: SessionUser,
  requestedPropertyId?: string | null,
): Promise<PropertyScope> {
  if (!user.organizationId) throw new Error('User is not attached to an organization')

  const properties = await prisma.property.findMany({
    where: {
      organizationId: user.organizationId,
      archivedAt: null,
      ...(user.propertyIds.length ? { id: { in: user.propertyIds } } : {}),
    },
    select: { id: true },
  })
  const allowed = properties.map((p) => p.id)

  // A requested property the user cannot see is silently ignored rather than
  // leaking whether it exists.
  const propertyId =
    requestedPropertyId && allowed.includes(requestedPropertyId) ? requestedPropertyId : null

  return { organizationId: user.organizationId, propertyId, allowedPropertyIds: allowed }
}

/** Prisma `where` fragment matching every row visible in this scope. */
export function scopeWhere(scope: PropertyScope) {
  return {
    organizationId: scope.organizationId,
    propertyId: scope.propertyId ?? { in: scope.allowedPropertyIds },
  }
}

/** Same, for models that key off propertyId alone (Floor, Room, Bed…). */
export function propertyWhere(scope: PropertyScope) {
  return scope.propertyId ? { id: scope.propertyId } : { id: { in: scope.allowedPropertyIds } }
}

export function propertyIdFilter(scope: PropertyScope) {
  return scope.propertyId ?? { in: scope.allowedPropertyIds }
}

/** Throws unless the property belongs to the user's organization and access set. */
export async function assertPropertyAccess(user: SessionUser, propertyId: string) {
  if (user.role === 'SUPER_ADMIN') return
  const property = await prisma.property.findFirst({
    where: {
      id: propertyId,
      organizationId: user.organizationId ?? '__none__',
      ...(user.propertyIds.length ? { id: { in: user.propertyIds } } : {}),
    },
    select: { id: true },
  })
  if (!property) throw new ForbiddenError('You do not have access to this property')
}

/** Throws unless the resident belongs to the user's organization. */
export async function assertResidentAccess(user: SessionUser, residentId: string) {
  if (user.role === 'SUPER_ADMIN') return
  if (user.role === 'TENANT') {
    if (user.residentId !== residentId) throw new ForbiddenError('Not your record')
    return
  }
  const resident = await prisma.resident.findFirst({
    where: {
      id: residentId,
      organizationId: user.organizationId ?? '__none__',
      ...(user.propertyIds.length ? { propertyId: { in: user.propertyIds } } : {}),
    },
    select: { id: true },
  })
  if (!resident) throw new ForbiddenError('You do not have access to this resident')
}

export class ForbiddenError extends Error {
  status = 403
  constructor(message = 'Forbidden') {
    super(message)
    this.name = 'ForbiddenError'
  }
}

export class NotFoundError extends Error {
  status = 404
  constructor(message = 'Not found') {
    super(message)
    this.name = 'NotFoundError'
  }
}

export class ValidationError extends Error {
  status = 422
  details?: unknown
  constructor(message: string, details?: unknown) {
    super(message)
    this.name = 'ValidationError'
    this.details = details
  }
}

export class ConflictError extends Error {
  status = 409
  constructor(message: string) {
    super(message)
    this.name = 'ConflictError'
  }
}
