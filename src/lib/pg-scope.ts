/**
 * Multi-PG helpers, pure and client-safe: keeping the PG switcher's choice
 * while moving between pages, and the consolidated "All PGs" totals.
 */

/** Owner pages that are about the whole account, not one PG. */
const ACCOUNT_PAGES = ['/app/settings', '/app/subscription', '/app/setup', '/app/notifications', '/app/support', '/app/help', '/app/import']

/**
 * Carries the switcher's `property` choice onto an owner link, so moving
 * between pages keeps the same PG instead of silently going back to All PGs.
 * Account-wide pages and links that already pick a PG are left alone.
 */
export function withPgScope(href: string, propertyId: string | null | undefined): string {
  if (!propertyId || !/^[A-Za-z0-9_-]{1,64}$/.test(propertyId)) return href
  const [pathAndQuery, hash = ''] = href.split('#')
  const [path, query = ''] = pathAndQuery.split('?')
  if (path !== '/app' && !path.startsWith('/app/')) return href
  if (ACCOUNT_PAGES.some((p) => path === p || path.startsWith(`${p}/`))) return href
  const params = new URLSearchParams(query)
  if (params.has('property')) return href
  params.set('property', propertyId)
  return `${path}?${params.toString()}${hash ? `#${hash}` : ''}`
}

export type PgComparisonRow = {
  beds: number
  occupied: number
  residents: number
  collection: number
  pending: number
  expenses: number
  complaints: number
}

export type PgTotals = PgComparisonRow & { occupancyRate: number; net: number }

/**
 * Totals across PGs. Occupancy is recomputed from beds (occupied ÷ total),
 * never averaged across PGs of different sizes.
 */
export function consolidatePgs(rows: PgComparisonRow[]): PgTotals {
  const sum = (pick: (r: PgComparisonRow) => number) => rows.reduce((s, r) => s + pick(r), 0)
  const beds = sum((r) => r.beds)
  const occupied = sum((r) => r.occupied)
  const collection = sum((r) => r.collection)
  const expenses = sum((r) => r.expenses)
  return {
    beds,
    occupied,
    residents: sum((r) => r.residents),
    collection,
    pending: sum((r) => r.pending),
    expenses,
    complaints: sum((r) => r.complaints),
    occupancyRate: beds ? Math.round((occupied / beds) * 100) : 0,
    net: collection - expenses,
  }
}
