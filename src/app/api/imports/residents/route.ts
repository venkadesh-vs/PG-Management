import { NextResponse } from 'next/server'
import { z } from 'zod'
import { parseBody, route } from '@/lib/api-helpers'
import { resolveScope } from '@/lib/tenancy'
import {
  importTemplateCsv,
  MAX_IMPORT_ROWS,
  runImport,
  validateImport,
} from '@/server/services/resident-import'

/**
 * Bulk resident import (residents.manage).
 *
 * GET  /api/imports/residents                    → CSV template with one example row
 * POST /api/imports/residents { dryRun: true }   → validate every row, nothing written
 * POST /api/imports/residents { dryRun: false }  → re-validate, then check each valid
 *                                                  row in through the check-in service
 */

export const maxDuration = 300

const bodySchema = z.object({
  csv: z
    .string()
    .min(1, 'Choose a CSV file to upload')
    // ~500 rows of generous width; anything bigger is not a resident list.
    .max(2_000_000, `The file is too large. Import at most ${MAX_IMPORT_ROWS} residents at a time.`),
  dryRun: z.boolean().default(true),
  createLogins: z.boolean().default(false),
  sendWelcome: z.boolean().default(false),
})

export const GET = route(
  async () =>
    new NextResponse(importTemplateCsv(), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="stayflow-residents-template.csv"',
        'Cache-Control': 'no-store',
      },
    }),
  { module: 'residents', permission: 'residents.manage' },
)

export const POST = route(
  async ({ user, request }) => {
    const body = await parseBody(request, bodySchema)
    const scope = await resolveScope(user)
    const importScope = { organizationId: scope.organizationId, propertyIds: scope.allowedPropertyIds }

    if (body.dryRun !== false) {
      const { rows, valid, invalid } = await validateImport(importScope, body.csv)
      return { rows, valid, invalid }
    }

    const result = await runImport({
      scope: importScope,
      csv: body.csv,
      // Logins are for the resident app; WhatsApp needs its module too.
      createLogins: body.createLogins === true && user.modules.includes('residentApp'),
      sendWelcome: body.sendWelcome === true && user.modules.includes('whatsapp'),
      actor: { id: user.id, name: user.name },
    })
    return {
      ...result,
      message: `${result.imported} resident${result.imported === 1 ? '' : 's'} imported${
        result.failed ? `, ${result.failed} failed` : ''
      }${result.skipped ? `, ${result.skipped} skipped with errors` : ''}`,
    }
  },
  { module: 'residents', permission: 'residents.manage' },
)
