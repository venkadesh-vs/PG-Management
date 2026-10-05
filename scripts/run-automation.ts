/**
 * Runs the daily automation from the command line: `npm run cron`.
 *
 * This is exactly what POST /api/cron/run executes, so a scheduler and a
 * manual run can never behave differently.
 */
import { runDailyAutomation } from '../src/server/services/automation'
import { prisma } from '../src/lib/prisma'

async function main() {
  const started = Date.now()
  console.log('\nStayFlow automation\n' + '─'.repeat(40))

  const report = await runDailyAutomation()

  console.log(`  invoices generated   ${report.invoices.created} (${report.invoices.skipped} skipped)`)
  console.log(`  marked overdue       ${report.overdue.flagged} (${report.overdue.feesApplied} late fees)`)
  console.log(`  reminders sent       ${report.reminders.sent}`)
  console.log(
    `  subscriptions        ${report.subscriptions.billed} charged, ${report.subscriptions.failed} failed, ${report.subscriptions.suspended} suspended`,
  )
  console.log(`  occupancy snapshots  ${report.occupancy.snapshots}`)
  console.log(`  meal counts          ${report.meals.refreshed}`)

  if (report.errors.length) {
    console.log('\n  errors:')
    for (const error of report.errors) console.log(`   - ${error}`)
  }

  console.log('─'.repeat(40))
  console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)}s\n`)
}

main()
  .catch((error) => {
    console.error('Automation failed:', error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
