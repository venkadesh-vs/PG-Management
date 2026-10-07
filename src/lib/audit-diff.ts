/**
 * Before/after diff for audit log entries (ActivityLog.before / .after).
 * Pure and dependency-free so it runs on the server, the client and in tests.
 */

export type DiffKind = 'added' | 'removed' | 'changed'

export type DiffEntry = {
  /** Dotted path, e.g. "rentAmount" or "address.city". */
  path: string
  kind: DiffKind
  before: unknown
  after: unknown
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date)

function same(a: unknown, b: unknown) {
  if (a === b) return true
  if (a instanceof Date || b instanceof Date) {
    return new Date(a as string).getTime() === new Date(b as string).getTime()
  }
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
    return JSON.stringify(a) === JSON.stringify(b)
  }
  return false
}

const absent = (v: unknown) => v === undefined || v === null

/**
 * Field-by-field changes between two snapshots. Nested objects are walked up
 * to `maxDepth` levels (deeper values and arrays compare as a whole). Keys that
 * are null/absent on both sides are skipped. Output is sorted by path.
 */
export function diffValues(before: unknown, after: unknown, maxDepth = 3): DiffEntry[] {
  const out: DiffEntry[] = []
  walk(before, after, '', 0)
  return out.sort((a, b) => a.path.localeCompare(b.path))

  function walk(a: unknown, b: unknown, path: string, depth: number) {
    // A missing snapshot on one side still lists the other side field by field.
    if (absent(a) && isPlainObject(b)) a = {}
    if (absent(b) && isPlainObject(a)) b = {}
    if (isPlainObject(a) && isPlainObject(b) && depth < maxDepth) {
      const keys = new Set([...Object.keys(a), ...Object.keys(b)])
      for (const key of keys) walk(a[key], b[key], path ? `${path}.${key}` : key, depth + 1)
      return
    }
    if (absent(a) && absent(b)) return
    if (same(a, b)) return
    const kind: DiffKind = absent(a) ? 'added' : absent(b) ? 'removed' : 'changed'
    out.push({ path: path || '(value)', kind, before: a ?? null, after: b ?? null })
  }
}

/** Human-readable cell for a diff value. */
export function formatDiffValue(value: unknown, maxLength = 160): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'string') {
    // ISO timestamps → readable date-time.
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
      const d = new Date(value)
      if (!Number.isNaN(d.getTime())) {
        return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
      }
    }
    return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value
  }
  if (typeof value === 'number') return String(value)
  const text = JSON.stringify(value)
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text
}

/** "rentAmount" → "Rent amount", "address.city" → "Address › City". */
export function labelForPath(path: string): string {
  return path
    .split('.')
    .map((part) => {
      const words = part.replace(/_/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()
      return words.charAt(0).toUpperCase() + words.slice(1)
    })
    .join(' › ')
}
