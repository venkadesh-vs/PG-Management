import { NextResponse } from 'next/server'
import { z } from 'zod'
import { fail, parseBody, route } from '@/lib/api-helpers'
import { toCsv } from '@/lib/csv'
import { MAX_IMPORT_ROWS, templateRows, type ImportKind } from '@/server/services/import-fields'
import { assertCanImport, previewImport, runImportJob } from '@/server/services/import-runner'

/**
 * Shared handlers behind /api/imports/{residents,rooms,balances}.
 *
 * GET                       → CSV template with example rows
 * POST { action: 'preview' } → validate every mapped row, nothing written;
 *                              returns per-row checks and an ImportJob id
 * POST { action: 'import' }  → re-validate, then import the ready rows
 *                              (each row / room / resident in its own
 *                              transaction) and record outcomes on the job
 */

const bodySchema = z.object({
  action: z.enum(['preview', 'import']),
  fileName: z.string().trim().min(1).max(200).default('upload'),
  headers: z.array(z.string().max(200)).min(1, 'The file has no header row').max(100),
  rows: z
    .array(z.object({ line: z.number().int().min(1), cells: z.array(z.string().max(2000)).max(100) }))
    .min(1, 'The file has no data rows')
    .max(MAX_IMPORT_ROWS, `Import at most ${MAX_IMPORT_ROWS} rows at a time — split the file.`),
  mapping: z.record(z.string(), z.number().int().min(0)),
  jobId: z.string().min(1).optional(),
  stopOnErrors: z.boolean().default(false),
  createLogins: z.boolean().default(false),
  sendWelcome: z.boolean().default(false),
})

export function importRoutes(kind: ImportKind) {
  const GET = route(async ({ user }) => {
    assertCanImport(user, kind)
    const { headers, rows } = templateRows(kind)
    return new NextResponse(toCsv(headers, rows), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="stayflow-${kind}-template.csv"`,
        'Cache-Control': 'no-store',
      },
    })
  })

  const POST = route(async ({ user, request }) => {
    const body = await parseBody(request, bodySchema)
    const payload = { fileName: body.fileName ?? 'upload', headers: body.headers, rows: body.rows, mapping: body.mapping }
    if (body.action === 'preview') return previewImport(user, kind, payload)
    if (!body.jobId) return fail('Check the file again before importing.')
    const result = await runImportJob(user, kind, { ...payload, jobId: body.jobId }, {
      stopOnErrors: body.stopOnErrors === true,
      createLogins: body.createLogins === true,
      sendWelcome: body.sendWelcome === true,
    })
    return {
      ...result,
      message: `Imported ${result.imported} · Skipped ${result.skipped} · Failed ${result.failed}`,
    }
  })

  return { GET, POST }
}
