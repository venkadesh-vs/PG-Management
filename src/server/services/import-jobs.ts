import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { toCsv } from '@/lib/csv'
import { ConflictError, NotFoundError } from '@/lib/tenancy'
import { effectiveLimit, limitMessage, type LimitKey } from '@/lib/plan-entitlements'
import { countUsage, orgPlans } from './plan-limits'
import { KIND_LABELS, type ImportKind, type RowCheck, type RowOutcome } from './import-fields'

/**
 * ImportJob bookkeeping: one row per previewed file, moved to IMPORTING once
 * (so a double click cannot import twice) and closed with every row's
 * outcome. The mapping of the latest job of a kind is offered next time.
 */

export type ImportJobStatus = 'PREVIEWED' | 'IMPORTING' | 'COMPLETED' | 'FAILED'

export async function lastMapping(organizationId: string, kind: ImportKind): Promise<Record<string, string> | null> {
  const job = await prisma.importJob.findFirst({
    where: { organizationId, kind },
    orderBy: { createdAt: 'desc' },
    select: { mapping: true },
  })
  const m = job?.mapping
  return m && typeof m === 'object' && !Array.isArray(m) ? (m as Record<string, string>) : null
}

export async function createPreviewJob(params: {
  organizationId: string
  kind: ImportKind
  fileName: string
  mapping: Record<string, string>
  checks: RowCheck[]
  createdBy: string
}) {
  const job = await prisma.importJob.create({
    data: {
      organizationId: params.organizationId,
      kind: params.kind,
      fileName: params.fileName.slice(0, 200),
      status: 'PREVIEWED',
      totalRows: params.checks.length,
      mapping: params.mapping,
      createdBy: params.createdBy,
    },
    select: { id: true },
  })
  return job.id
}

/** Claims a previewed job for importing. Throws if it already ran. */
export async function startJob(organizationId: string, jobId: string, kind: ImportKind, mapping: Record<string, string>) {
  const claimed = await prisma.importJob.updateMany({
    where: { id: jobId, organizationId, kind, status: 'PREVIEWED' },
    data: { status: 'IMPORTING', mapping },
  })
  if (claimed.count === 1) return
  const job = await prisma.importJob.findFirst({ where: { id: jobId, organizationId }, select: { status: true } })
  if (!job) throw new NotFoundError('This import was not found. Upload the file again.')
  throw new ConflictError(
    job.status === 'IMPORTING'
      ? 'This file is already being imported. Wait for it to finish.'
      : 'This file was already imported. Upload it again to run a fresh check.',
  )
}

export async function finishJob(jobId: string, outcomes: RowOutcome[], crashed = false) {
  const imported = outcomes.filter((o) => o.status === 'imported').length
  const skipped = outcomes.filter((o) => o.status === 'skipped').length
  const failed = outcomes.filter((o) => o.status === 'failed').length
  await prisma.importJob.update({
    where: { id: jobId },
    data: {
      status: crashed || (imported === 0 && failed > 0) ? 'FAILED' : 'COMPLETED',
      imported,
      skipped,
      failed,
      results: outcomes as unknown as Prisma.InputJsonValue,
      finishedAt: new Date(),
    },
  })
  return { imported, skipped, failed }
}

export async function listJobs(organizationId: string, take = 20) {
  return prisma.importJob.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      id: true,
      kind: true,
      fileName: true,
      status: true,
      totalRows: true,
      imported: true,
      skipped: true,
      failed: true,
      createdBy: true,
      createdAt: true,
      finishedAt: true,
    },
  })
}

/** The per-row results of a finished job as CSV. */
export async function jobResultsCsv(organizationId: string, jobId: string) {
  const job = await prisma.importJob.findFirst({ where: { id: jobId, organizationId } })
  if (!job) throw new NotFoundError('Import not found')
  const outcomes = (Array.isArray(job.results) ? job.results : []) as unknown as RowOutcome[]
  const csv = toCsv(
    ['Row', 'Result', 'Item', 'Details'],
    outcomes.map((o) => [o.row, o.status, o.title, o.message ?? '']),
  )
  const kind = (KIND_LABELS[job.kind as ImportKind]?.nounPlural ?? job.kind).replace(/\s+/g, '-')
  const stamp = job.createdAt.toISOString().slice(0, 10)
  return { csv, fileName: `stayflow-import-${kind}-${stamp}-results.csv` }
}

// -------------------------------------------------------------- plan limits

/**
 * Whole-batch plan check. Marks rows past the plan's headroom as errors (in
 * file order) and returns a note explaining how many would exceed. `cost`
 * is how much of `key` each ready row uses (beds per room, 1 per resident).
 */
export async function applyPlanLimit(
  organizationId: string,
  key: LimitKey,
  checks: RowCheck[],
  cost: (check: RowCheck) => number,
): Promise<string | null> {
  const [plans, usage] = await Promise.all([orgPlans(organizationId), countUsage(organizationId)])
  const limit = effectiveLimit(plans, key)
  if (limit == null) return null
  const used = usage[key]
  let left = Math.max(0, limit - used)
  let wanted = 0
  let blocked = 0
  for (const check of checks) {
    if (check.status !== 'ready') continue
    const n = cost(check)
    wanted += n
    if (n <= left) {
      left -= n
      continue
    }
    blocked++
    check.status = 'error'
    check.errors.push('Over your plan limit — upgrade your plan to import this row')
  }
  if (!blocked) return null
  const plan = plans.find((p) => effectiveLimit([p], key) === limit) ?? plans[0]
  const noun = key === 'beds' ? 'beds' : key === 'residents' ? 'residents' : key
  return `${limitMessage(plan.name, key, limit)} You have ${used} ${noun} now and this file adds ${wanted}, so ${blocked} row${blocked === 1 ? '' : 's'} cannot be imported.`
}
