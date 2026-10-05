import { NextResponse } from 'next/server'
import { serverEnv } from '@/lib/env'
import { getSessionUser } from '@/lib/auth'
import { handleError } from '@/lib/api-helpers'
import { runDailyAutomation } from '@/server/services/automation'

/**
 * POST /api/cron/run — the daily automation pass.
 *
 * Point any scheduler at this once a day with:
 *   Authorization: Bearer <CRON_SECRET>
 *
 * A signed-in Super Admin may also trigger it, which is how the demo runs it
 * without a scheduler. Every step is idempotent for a given day, so calling
 * this twice is harmless.
 */
export async function POST(request: Request) {
  try {
    const secret = serverEnv.cronSecret
    const header = request.headers.get('authorization') ?? ''
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : ''

    const authorised =
      (secret && bearer && bearer === secret) ||
      (await getSessionUser())?.role === 'SUPER_ADMIN'

    if (!authorised) {
      return NextResponse.json(
        { error: 'This endpoint requires the CRON_SECRET bearer token' },
        { status: 401 },
      )
    }

    const url = new URL(request.url)
    const report = await runDailyAutomation({
      organizationId: url.searchParams.get('organizationId') ?? undefined,
      skipInvoices: url.searchParams.get('skipInvoices') === '1',
    })

    return NextResponse.json({
      ...report,
      message: [
        `${report.invoices.created} invoices generated`,
        `${report.overdue.flagged} marked overdue`,
        `${report.reminders.sent} reminders sent`,
        `${report.subscriptions.billed} subscriptions charged`,
        `${report.occupancy.snapshots} occupancy snapshots`,
      ].join(', '),
    })
  } catch (error) {
    return handleError(error)
  }
}

/** GET is a health check so a scheduler can verify the endpoint exists. */
export async function GET() {
  return NextResponse.json({
    endpoint: 'POST /api/cron/run',
    auth: 'Authorization: Bearer <CRON_SECRET>',
    configured: Boolean(serverEnv.cronSecret),
    steps: [
      'Generate this month\'s rent invoices',
      'Flag overdue invoices and apply late fees',
      'Send rent reminders (before due, on due, after due)',
      'Bill SaaS subscriptions and attempt AutoPay',
      'Enforce grace periods',
      'Snapshot occupancy',
      'Refresh expected meal counts',
    ],
  })
}
