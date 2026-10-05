/**
 * Netlify Scheduled Function: triggers the daily automation (rent invoices,
 * overdue + late fees, reminders, subscription billing, grace periods,
 * occupancy snapshots) at 06:00 IST every day.
 *
 * It only calls the app's own endpoint with the CRON_SECRET bearer token, so
 * the real work runs inside the Next.js app with its normal auth and logging.
 * Netlify sets URL to the site's primary address.
 */
export default async function dailyAutomation() {
  const base = process.env.URL
  const secret = process.env.CRON_SECRET
  if (!base || !secret) {
    console.error('[daily-automation] URL or CRON_SECRET is not set; skipping run')
    return new Response('not configured', { status: 500 })
  }

  const res = await fetch(`${base}/api/cron/run`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}` },
  })
  const body = await res.text()
  if (!res.ok) {
    console.error(`[daily-automation] failed: ${res.status} ${body.slice(0, 500)}`)
    return new Response('failed', { status: 502 })
  }
  console.log(`[daily-automation] ok: ${body.slice(0, 500)}`)
  return new Response('ok')
}

// 00:30 UTC = 06:00 IST.
export const config = { schedule: '30 0 * * *' }
