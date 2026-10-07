import 'server-only'

import type { SessionUser } from '@/lib/auth'
import { ForbiddenError, hasPermission, requireModule, resolveScope, ValidationError } from '@/lib/tenancy'
import type { ModuleKey } from '@/lib/modules'
import { recordActivity } from '../events'
import {
  countChecks,
  IMPORT_FIELDS,
  KIND_LABELS,
  mappingToHeaders,
  missingRequired,
  type ColumnMapping,
  type ImportKind,
  type RowCheck,
  type RowOutcome,
  type SheetRow,
} from './import-fields'
import { createPreviewJob, finishJob, startJob } from './import-jobs'
import { importBalanceRows, validateBalanceRows } from './import-balances'
import { importRoomGroups, validateRoomRows } from './import-rooms'
import { importResidentRows, validateResidentRows, type ImportScope } from './resident-import'

/**
 * One entry point for every import kind: check access, validate the mapped
 * rows (preview), then — after the person confirms — re-validate against
 * fresh data and import the ready rows, recording each row's outcome on the
 * ImportJob.
 */

export const KIND_ACCESS: Record<ImportKind, { modules: ModuleKey[]; permissions: string[] }> = {
  residents: { modules: ['residents'], permissions: ['residents.manage'] },
  rooms: { modules: ['properties'], permissions: ['residents.manage', 'properties.manage'] },
  balances: { modules: ['residents', 'rent'], permissions: ['residents.manage', 'payments.record'] },
}

export function canImport(user: Pick<SessionUser, 'role' | 'permissions' | 'modules'>, kind: ImportKind) {
  const access = KIND_ACCESS[kind]
  return (
    access.permissions.every((p) => hasPermission(user, p)) &&
    (user.role === 'SUPER_ADMIN' || access.modules.every((m) => user.modules.includes(m)))
  )
}

export function assertCanImport(user: SessionUser, kind: ImportKind) {
  for (const m of KIND_ACCESS[kind].modules) requireModule(user, m)
  if (!KIND_ACCESS[kind].permissions.every((p) => hasPermission(user, p))) {
    throw new ForbiddenError(
      `Your role does not allow importing ${KIND_LABELS[kind].nounPlural}. Ask the PG owner for access.`,
    )
  }
}

export type ImportPayload = {
  fileName: string
  headers: string[]
  rows: SheetRow[]
  mapping: ColumnMapping
}

function cleanMapping(kind: ImportKind, payload: ImportPayload): ColumnMapping {
  const known = new Set(IMPORT_FIELDS[kind].map((f) => f.key))
  const mapping: ColumnMapping = {}
  const used = new Set<number>()
  for (const [key, idx] of Object.entries(payload.mapping)) {
    if (!known.has(key) || !Number.isInteger(idx) || idx < 0 || idx >= payload.headers.length) continue
    if (used.has(idx)) {
      throw new ValidationError(`The column "${payload.headers[idx]}" is mapped to two fields. Pick one.`)
    }
    used.add(idx)
    mapping[key] = idx
  }
  const missing = missingRequired(kind, mapping)
  if (missing.length) {
    throw new ValidationError(`Choose a column for: ${missing.map((f) => f.label).join(', ')}.`)
  }
  return mapping
}

async function scopeFor(user: SessionUser): Promise<ImportScope> {
  const scope = await resolveScope(user)
  return { organizationId: scope.organizationId, propertyIds: scope.allowedPropertyIds }
}

async function validate(kind: ImportKind, scope: ImportScope, rows: SheetRow[], mapping: ColumnMapping) {
  switch (kind) {
    case 'residents':
      return { kind, v: await validateResidentRows(scope, rows, mapping) } as const
    case 'rooms':
      return { kind, v: await validateRoomRows(scope, rows, mapping) } as const
    case 'balances':
      return { kind, v: await validateBalanceRows(scope, rows, mapping) } as const
  }
}

export type PreviewResult = {
  jobId: string
  checks: RowCheck[]
  notes: string[]
  counts: { ready: number; skip: number; error: number }
}

export async function previewImport(user: SessionUser, kind: ImportKind, payload: ImportPayload): Promise<PreviewResult> {
  assertCanImport(user, kind)
  const mapping = cleanMapping(kind, payload)
  const scope = await scopeFor(user)
  if (!scope.propertyIds.length) throw new ValidationError('Add a PG first — there is nowhere to import into yet.')
  const { v } = await validate(kind, scope, payload.rows, mapping)
  const jobId = await createPreviewJob({
    organizationId: scope.organizationId,
    kind,
    fileName: payload.fileName,
    mapping: mappingToHeaders(mapping, payload.headers),
    checks: v.checks,
    createdBy: user.name,
  })
  return { jobId, checks: v.checks, notes: v.notes, counts: countChecks(v.checks) }
}

export async function runImportJob(
  user: SessionUser,
  kind: ImportKind,
  payload: ImportPayload & { jobId: string },
  options: { stopOnErrors: boolean; createLogins: boolean; sendWelcome: boolean },
) {
  assertCanImport(user, kind)
  const mapping = cleanMapping(kind, payload)
  const scope = await scopeFor(user)
  const actor = { id: user.id, name: user.name }

  // Fresh check right before writing: beds fill and residents arrive meanwhile.
  const validated = await validate(kind, scope, payload.rows, mapping)
  const counts = countChecks(validated.v.checks)
  if (options.stopOnErrors && counts.error > 0) {
    throw new ValidationError(
      `${counts.error} row${counts.error === 1 ? ' has' : 's have'} errors, and "Stop if any row has errors" is on. Fix them and upload again, or turn the option off to import only the ready rows.`,
    )
  }
  if (!counts.ready) throw new ValidationError('No rows are ready to import.')

  await startJob(scope.organizationId, payload.jobId, kind, mappingToHeaders(mapping, payload.headers))

  let outcomes: RowOutcome[] = []
  try {
    if (validated.kind === 'residents') {
      outcomes = await importResidentRows({
        scope,
        validation: validated.v,
        createLogins: options.createLogins && user.modules.includes('residentApp'),
        sendWelcome: options.sendWelcome && user.modules.includes('whatsapp'),
        actor,
      })
    } else if (validated.kind === 'rooms') {
      outcomes = await importRoomGroups({ scope, validation: validated.v, actor })
    } else {
      outcomes = await importBalanceRows({ validation: validated.v, actor })
    }
  } catch (error) {
    console.error('[import] job crashed', { jobId: payload.jobId, kind, error })
    await finishJob(payload.jobId, outcomes, true)
    throw error
  }

  const totals = await finishJob(payload.jobId, outcomes)
  await recordActivity({
    organizationId: scope.organizationId,
    actorId: user.id,
    actorName: user.name,
    actorRole: user.role,
    event: 'IMPORT_COMPLETED',
    entityType: 'ImportJob',
    entityId: payload.jobId,
    summary: `Imported ${KIND_LABELS[kind].nounPlural} from ${payload.fileName}: ${totals.imported} imported, ${totals.skipped} skipped, ${totals.failed} failed`,
    meta: { kind, ...totals },
  }).catch(() => undefined)

  return { jobId: payload.jobId, outcomes, ...totals }
}
