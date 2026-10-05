/**
 * Every rent date in this product is an Indian calendar date: "due on the 5th"
 * means the 5th in IST, whether the server runs in Mumbai or in a UTC data
 * centre. Pinning the process timezone makes every local-date helper in
 * lib/utils (startOfDay, startOfMonth, getDate…) mean IST everywhere.
 *
 * Node re-reads TZ whenever it is assigned, so importing this module first
 * is enough. Serverless hosts reserve the TZ env var, hence doing it in code.
 */
export const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Kolkata'

if (typeof process !== 'undefined' && process.env && process.env.TZ !== APP_TIMEZONE) {
  process.env.TZ = APP_TIMEZONE
}
