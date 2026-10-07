import { NextResponse } from 'next/server'
import { route } from '@/lib/api-helpers'
import { toCsv } from '@/lib/csv'
import { AUDIT_CSV_HEADER, parseAuditFilters } from '@/lib/audit-filters'
import { toISODate } from '@/lib/utils'
import { auditCsvRows, platformAuditWhere } from '@/server/services/audit-log'

/**
 * GET /api/admin/audit?org=&event=&group=&actor=&entity=&from=&to=&range=&q=
 * CSV of the platform audit log with the same filters as /admin/audit.
 * Super Admin only. Read-only: the audit log has no edit or delete endpoint.
 */
export const GET = route(
  async ({ request }) => {
    const filters = parseAuditFilters(new URL(request.url).searchParams)
    const rows = await auditCsvRows(platformAuditWhere(filters), true)
    return new NextResponse(toCsv(['Organization', ...AUDIT_CSV_HEADER], rows), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="stayflow-platform-audit-${toISODate(new Date())}.csv"`,
        'Cache-Control': 'private, no-store',
      },
    })
  },
  { roles: ['SUPER_ADMIN'] },
)
