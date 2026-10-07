/**
 * RFC 4180 CSV reading and writing, with no dependencies. Safe to import on
 * the client and the server.
 *
 * The parser handles a UTF-8 BOM, quoted fields with embedded commas, quotes
 * ("") and line breaks, CRLF / LF / lone CR line endings and a missing final
 * newline. Excel's "CSV UTF-8" and plain "CSV" exports both read correctly.
 */

export type CsvRow = string[]

export function parseCsv(input: string, options?: { delimiter?: string }): CsvRow[] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  const delimiter = options?.delimiter ?? detectDelimiter(text)
  const rows: CsvRow[] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  const n = text.length

  const endField = () => {
    row.push(field)
    field = ''
  }
  const endRow = () => {
    endField()
    rows.push(row)
    row = []
  }

  while (i < n) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }
    if (ch === '"' && field.trim() === '') {
      // An opening quote (leading spaces before it are dropped).
      field = ''
      inQuotes = true
      i++
      continue
    }
    if (ch === delimiter) {
      endField()
      i++
      continue
    }
    if (ch === '\r') {
      endRow()
      i += text[i + 1] === '\n' ? 2 : 1
      continue
    }
    if (ch === '\n') {
      endRow()
      i++
      continue
    }
    field += ch
    i++
  }
  // Last row without a trailing newline (but not a phantom empty row).
  if (field !== '' || row.length > 0 || inQuotes) endRow()

  // Drop fully blank lines.
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

/**
 * Excel in locales that use a decimal comma saves CSV with semicolons. Look at
 * the header line only (outside quotes) and pick whichever separator wins.
 */
function detectDelimiter(text: string): string {
  let commas = 0
  let semis = 0
  let tabs = 0
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') inQuotes = !inQuotes
    else if (!inQuotes) {
      if (ch === '\n' || ch === '\r') break
      if (ch === ',') commas++
      else if (ch === ';') semis++
      else if (ch === '\t') tabs++
    }
  }
  if (semis > commas && semis >= tabs) return ';'
  if (tabs > commas && tabs > semis) return '\t'
  return ','
}

/** Parses CSV text into objects keyed by the header row. */
export function parseCsvObjects(input: string): { headers: string[]; rows: Record<string, string>[] } {
  const [head, ...body] = parseCsv(input)
  if (!head) return { headers: [], rows: [] }
  const headers = head.map((h) => h.trim())
  const rows = body.map((cells) => {
    const obj: Record<string, string> = {}
    headers.forEach((h, idx) => {
      obj[h] = (cells[idx] ?? '').trim()
    })
    return obj
  })
  return { headers, rows }
}

/** One CSV cell, quoted when needed and guarded against spreadsheet formulas. */
export function csvCell(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined) return ''
  const text = String(value)
  const safe = typeof value === 'string' && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** CSV with a UTF-8 BOM (so Excel shows Indian names and ₹ correctly). */
export function toCsv(header: string[], rows: (string | number | boolean | null | undefined)[][]) {
  return '﻿' +[header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

/**
 * Error report for an import preview: row number, the row's original values
 * and its problems, for every row that has errors or warnings (or every row
 * with `all`). Opens straight in Excel so the owner can fix and re-upload.
 */
export function errorReportCsv(
  headers: string[],
  rows: { line: number; cells: string[] }[],
  checks: { row: number; status: string; errors: string[]; warnings: string[] }[],
  options?: { all?: boolean },
) {
  const byRow = new Map(checks.map((c) => [c.row, c]))
  const out: (string | number)[][] = []
  for (const r of rows) {
    const c = byRow.get(r.line)
    if (!c) continue
    if (!options?.all && !c.errors.length && !c.warnings.length) continue
    const status = c.status === 'ready' ? 'Ready' : c.status === 'skip' ? 'Skipped' : 'Error'
    out.push([
      r.line,
      status,
      c.errors.join('; '),
      c.warnings.join('; '),
      ...headers.map((_, i) => r.cells[i] ?? ''),
    ])
  }
  return toCsv(['Row', 'Status', 'Errors', 'Warnings', ...headers], out)
}
