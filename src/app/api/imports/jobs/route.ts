import { NextResponse } from 'next/server'
import { route } from '@/lib/api-helpers'
import { ForbiddenError, hasPermission } from '@/lib/tenancy'
import { jobResultsCsv, listJobs } from '@/server/services/import-jobs'

/**
 * GET /api/imports/jobs               → the last 20 imports
 * GET /api/imports/jobs?id=…          → one import's per-row results as CSV
 */
export const GET = route(async ({ user, request }) => {
  if (!['residents.manage', 'properties.manage', 'payments.record'].some((p) => hasPermission(user, p))) {
    throw new ForbiddenError('Your role does not allow this. Ask the PG owner for access.')
  }
  const id = new URL(request.url).searchParams.get('id')
  if (!id) return { jobs: await listJobs(user.organizationId!) }
  const { csv, fileName } = await jobResultsCsv(user.organizationId!, id)
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'no-store',
    },
  })
})
