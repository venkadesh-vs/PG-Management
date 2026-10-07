import 'server-only'

import { parseCsv } from '@/lib/csv'
import { ValidationError } from '@/lib/tenancy'
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, type SheetRow } from './import-fields'

/**
 * Reads an uploaded .xlsx or .csv into a header row and data rows of plain
 * text. Workbooks are parsed here on the server (exceljs), never in the
 * browser. Real Excel date cells become YYYY-MM-DD so the date parser does
 * not have to guess the day/month order of a formatted value.
 */

export type ParsedSheet = {
  fileName: string
  sheets: string[]
  sheet: string
  headers: string[]
  rows: SheetRow[]
}

type CellValue = unknown

function pad(n: number) {
  return String(n).padStart(2, '0')
}

/** One exceljs cell value → text. */
export function cellText(value: CellValue): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)))
  }
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (value instanceof Date) {
    // exceljs gives date cells as UTC midnight of the calendar date.
    if (Number.isNaN(value.getTime())) return ''
    return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`
  }
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>
    if (Array.isArray(v.richText)) return (v.richText as { text?: string }[]).map((t) => t.text ?? '').join('')
    if ('result' in v) return cellText(v.result)
    if ('formula' in v || 'sharedFormula' in v) return ''
    if (typeof v.text === 'string') return v.text
    if ('error' in v) return ''
  }
  return String(value)
}

/**
 * The header is the first of the top rows that is "wide": sheets often have a
 * title line ("Sunrise PG — March 2026") above the real header.
 */
export function pickHeaderIndex(rows: string[][]): number {
  const top = rows.slice(0, 10)
  const widths = top.map((r) => r.filter((c) => c.trim() !== '').length)
  const widest = Math.max(0, ...widths)
  const need = Math.max(2, Math.ceil(widest / 2))
  const idx = widths.findIndex((w) => w >= need)
  return idx < 0 ? 0 : idx
}

function toSheet(fileName: string, sheets: string[], sheet: string, grid: { line: number; cells: string[] }[]): ParsedSheet {
  const nonBlank = grid.filter((r) => r.cells.some((c) => c.trim() !== ''))
  if (!nonBlank.length) {
    throw new ValidationError(
      sheets.length > 1
        ? `The sheet "${sheet}" is empty. Pick the sheet that has your data.`
        : 'The file is empty. Put one row per item under a header row.',
    )
  }
  const headerIdx = pickHeaderIndex(nonBlank.map((r) => r.cells))
  const headerRow = nonBlank[headerIdx]
  const body = nonBlank.slice(headerIdx + 1)
  // Trailing header cells that are blank are dropped; blank ones in the middle get a name.
  let width = headerRow.cells.length
  while (width > 0 && !headerRow.cells[width - 1]?.trim()) width--
  const headers = headerRow.cells.slice(0, width).map((h, i) => h.trim() || `Column ${i + 1}`)
  if (!body.length) throw new ValidationError('The file has a header row but no data rows under it.')
  if (body.length > MAX_IMPORT_ROWS) {
    throw new ValidationError(
      `The file has ${body.length.toLocaleString('en-IN')} rows. Import at most ${MAX_IMPORT_ROWS.toLocaleString('en-IN')} at a time — split it into smaller files.`,
    )
  }
  return {
    fileName,
    sheets,
    sheet,
    headers,
    rows: body.map((r) => ({ line: r.line, cells: headers.map((_, i) => (r.cells[i] ?? '').trim()) })),
  }
}

export function readCsvSheet(fileName: string, text: string): ParsedSheet {
  if (text.includes('\u0000')) {
    throw new ValidationError('This file is not a readable CSV. Upload the .xlsx workbook or save it as "CSV UTF-8".')
  }
  const grid = parseCsv(text).map((cells, i) => ({ line: i + 1, cells }))
  return toSheet(fileName, ['CSV'], 'CSV', grid)
}

export async function readWorkbook(fileName: string, data: ArrayBuffer, sheetName?: string | null): Promise<ParsedSheet> {
  const ExcelJS = (await import('exceljs')).default
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(data)
  } catch {
    throw new ValidationError('We could not open this workbook. Save it again in Excel as .xlsx (or CSV) and retry.')
  }
  const worksheets = workbook.worksheets.filter((w) => w.state !== 'veryHidden')
  if (!worksheets.length) throw new ValidationError('This workbook has no sheets.')
  const ws = (sheetName && worksheets.find((w) => w.name === sheetName)) || worksheets[0]

  const grid: { line: number; cells: string[] }[] = []
  ws.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = []
    // row.values is 1-based with a hole at 0.
    const values = row.values as CellValue[]
    for (let c = 1; c < values.length; c++) cells.push(cellText(values[c]).trim())
    grid.push({ line: row.number, cells })
  })
  return toSheet(fileName, worksheets.map((w) => w.name), ws.name, grid)
}

/** Reads an uploaded File: .xlsx (by content or name) or CSV. */
export async function readUpload(file: File, sheetName?: string | null): Promise<ParsedSheet> {
  if (file.size > MAX_IMPORT_BYTES) {
    throw new ValidationError('The file is larger than 5 MB. Split it into smaller files, or remove photos and extra sheets.')
  }
  if (!file.size) throw new ValidationError('The file is empty.')
  const name = file.name || 'upload'
  const data = await file.arrayBuffer()
  const head = new Uint8Array(data.slice(0, 4))
  const isZip = head[0] === 0x50 && head[1] === 0x4b
  if (/\.xls$/i.test(name) && !isZip) {
    throw new ValidationError('Old .xls files are not supported. In Excel choose File → Save As → Excel Workbook (.xlsx) and upload that.')
  }
  if (isZip || /\.xlsx$/i.test(name)) return readWorkbook(name, data, sheetName)
  const text = new TextDecoder('utf-8').decode(data)
  return readCsvSheet(name, text)
}
