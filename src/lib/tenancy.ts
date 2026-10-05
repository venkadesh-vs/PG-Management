import 'server-only'

import { randomBytes } from 'node:crypto'
import type { UserRole } from '@prisma/client'

import { prisma } from './prisma'
import type { SessionUser } from './auth'
import { PERMISSIONS } from './permissions'

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
  if (!user.organizationId) throw new ForbiddenError('User is not attached to an organization')

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

/** The property a WORKER is assigned to (null when unassigned). */
export async function workerPropertyId(user: SessionUser): Promise<string | null> {
  if (!user.staffId) return null
  const staff = await prisma.staff.findFirst({
    where: { id: user.staffId, organizationId: user.organizationId ?? '__none__' },
    select: { propertyId: true },
  })
  return staff?.propertyId ?? null
}

/**
 * Throws unless the property belongs to the user's organization and access
 * set. Workers are limited to the PG they are assigned to, residents to the
 * PG they live in.
 */
export async function assertPropertyAccess(user: SessionUser, propertyId: string) {
  if (user.role === 'SUPER_ADMIN') return
  if (user.role === 'WORKER') {
    const own = await workerPropertyId(user)
    if (!own || own !== propertyId) {
      throw new ForbiddenError('That PG is not the one you are assigned to')
    }
  } else if (user.role === 'TENANT') {
    const resident = user.residentId
      ? await prisma.resident.findUnique({
          where: { id: user.residentId },
          select: { propertyId: true },
        })
      : null
    if (!resident || resident.propertyId !== propertyId) {
      throw new ForbiddenError('You do not have access to this property')
    }
  }
  // Note: the id filter must be combined, not spread — a second `id` key
  // would silently replace the equality check.
  if (user.propertyIds.length && !user.propertyIds.includes(propertyId)) {
    throw new ForbiddenError('You do not have access to this property')
  }
  const property = await prisma.property.findFirst({
    where: { id: propertyId, organizationId: user.organizationId ?? '__none__' },
    select: { id: true },
  })
  if (!property) throw new ForbiddenError('You do not have access to this property')
}

/** Throws unless the resident belongs to the user's organization and access set. */
export async function assertResidentAccess(user: SessionUser, residentId: string) {
  if (user.role === 'SUPER_ADMIN') return
  if (user.role === 'TENANT') {
    if (user.residentId !== residentId) throw new ForbiddenError('Not your record')
    return
  }
  let workerProperty: string | null = null
  if (user.role === 'WORKER') {
    workerProperty = await workerPropertyId(user)
    if (!workerProperty) throw new ForbiddenError('You do not have access to this resident')
  }
  const resident = await prisma.resident.findFirst({
    where: {
      id: residentId,
      organizationId: user.organizationId ?? '__none__',
      ...(user.propertyIds.length ? { propertyId: { in: user.propertyIds } } : {}),
    },
    select: { id: true, propertyId: true },
  })
  if (!resident) throw new ForbiddenError('You do not have access to this resident')
  if (workerProperty && resident.propertyId !== workerProperty) {
    throw new ForbiddenError('You do not have access to this resident')
  }
}

/**
 * Property ids an org user is limited to, or null when unrestricted (no
 * PropertyAccess rows, as for an OWNER).
 */
export function restrictedPropertyIds(user: SessionUser): string[] | null {
  if (user.role === 'SUPER_ADMIN') return null
  return user.propertyIds.length ? user.propertyIds : null
}

/** True when a record's propertyId is inside the user's access set. */
export function inScope(user: SessionUser, propertyId: string | null | undefined) {
  const restricted = restrictedPropertyIds(user)
  if (!restricted) return true
  return Boolean(propertyId && restricted.includes(propertyId))
}

/** Throws unless a record's propertyId is inside the user's access set. */
export function assertInScope(
  user: SessionUser,
  propertyId: string | null | undefined,
  message = 'You do not have access to this PG',
) {
  if (!inScope(user, propertyId)) throw new ForbiddenError(message)
}

/** Throws unless the room exists in the given property. */
export async function assertRoomInProperty(roomId: string, propertyId: string) {
  const room = await prisma.room.findFirst({
    where: { id: roomId, propertyId },
    select: { id: true },
  })
  if (!room) throw new ValidationError('That room is not in this PG')
}

/** Throws unless the floor exists in the given property. */
export async function assertFloorInProperty(floorId: string, propertyId: string) {
  const floor = await prisma.floor.findFirst({
    where: { id: floorId, propertyId },
    select: { id: true },
  })
  if (!floor) throw new ValidationError('That floor is not in this PG')
}

/** Throws unless the resident lives in the given property of the organization. */
export async function assertResidentInProperty(
  residentId: string,
  organizationId: string,
  propertyId: string,
) {
  const resident = await prisma.resident.findFirst({
    where: { id: residentId, organizationId, propertyId },
    select: { id: true },
  })
  if (!resident) throw new ValidationError('That resident is not in this PG')
}

/** Throws unless the staff member is active in the org and can work at the property. */
export async function assertStaffForProperty(
  staffId: string,
  organizationId: string,
  propertyId: string,
) {
  const staff = await prisma.staff.findFirst({
    where: {
      id: staffId,
      organizationId,
      active: true,
      OR: [{ propertyId }, { propertyId: null }],
    },
    select: { id: true },
  })
  if (!staff) throw new ValidationError('That staff member does not work at this PG')
}

// --------------------------------------------------------------------------
// Permissions. lib/auth.ts owns the shared PERMISSIONS map; the entries below
// extend it for server-side enforcement.
// --------------------------------------------------------------------------

export const SERVER_PERMISSIONS = {
  ...PERMISSIONS,
  'property:create': ['OWNER'],
  'invoice:waive': ['OWNER'],
  'staff:login': ['OWNER'],
} as const satisfies Record<string, readonly UserRole[]>

export type ServerPermission = keyof typeof SERVER_PERMISSIONS

export function hasPermission(
  user: Pick<SessionUser, 'role'> | null,
  permission: ServerPermission,
): boolean {
  if (!user) return false
  if (user.role === 'SUPER_ADMIN') return true
  return (SERVER_PERMISSIONS[permission] as readonly UserRole[]).includes(user.role)
}

/** Throws ForbiddenError unless the user's role holds the permission. */
export function requirePermission(
  user: Pick<SessionUser, 'role'> | null,
  permission: ServerPermission,
) {
  if (!hasPermission(user, permission)) {
    throw new ForbiddenError('You do not have permission to do that')
  }
}

// --------------------------------------------------------------------------
// Sensitive data
// --------------------------------------------------------------------------

/** Government ID numbers (Aadhaar etc.) are shown in full to the OWNER only. */
export function maskIdNumber(value: string | null | undefined, role: UserRole): string | null {
  if (!value) return null
  if (role === 'OWNER') return value
  const clean = value.replace(/[\s-]/g, '')
  return `XXXX-XXXX-${clean.slice(-4)}`
}

/** Returns the record with `idNumber` masked for anyone but the OWNER. */
export function withMaskedId<T extends { idNumber?: string | null }>(record: T, role: UserRole): T {
  if (!('idNumber' in record)) return record
  return { ...record, idNumber: maskIdNumber(record.idNumber, role) }
}

const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'

/** A random password from a readable alphabet (no 0/O, 1/l/I look-alikes). */
export function generatePassword(length = 10) {
  // Rejection sampling keeps every character equally likely.
  const limit = 256 - (256 % PASSWORD_ALPHABET.length)
  let out = ''
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte < limit) out += PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length]
      if (out.length === length) break
    }
  }
  return out
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
