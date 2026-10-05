/**
 * Runs once when the server boots, before any request. Pins the timezone so
 * date math is IST even on a UTC host (see lib/timezone).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./lib/timezone')
  }
}
