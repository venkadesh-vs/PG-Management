/**
 * How a list export looks in the designed formats (PDF report, Excel .xlsx).
 * The CSV stays raw; these rules pick the columns a printed report needs and
 * turn raw cells (2026-10-16, PENDING_APPROVAL, 7500) into what people read
 * (16 Oct 2026, Pending approval, ₹7,500).
 */

export type Cell = string | number | null | undefined
export type ColumnKind = 'text' | 'money' | 'number' | 'date' | 'datetime' | 'status'

/** The columns a PDF report shows, in order (by export header). Others stay in Excel/CSV. */
export const PDF_COLUMNS: Record<string, string[]> = {
  residents: ['Code', 'Name', 'PG', 'Room', 'Bed', 'Phone', 'Joined', 'Rent', 'Deposit', 'Status', 'KYC'],
  invoices: ['Invoice', 'Resident', 'PG', 'Period start', 'Due date', 'Total', 'Paid', 'Balance', 'Status'],
  outstanding: ['Invoice', 'Resident', 'Phone', 'PG', 'Period start', 'Due date', 'Total', 'Paid', 'Balance', 'Status'],
  payments: ['Receipt', 'Date', 'Resident', 'PG', 'Purpose', 'Method', 'Reference', 'Status', 'Amount', 'Refunded'],
  expenses: ['Date', 'PG', 'Category', 'Title', 'Vendor', 'Mode', 'Status', 'Recorded by', 'Amount'],
  'daily-collection': ['Section', 'Time', 'Resident', 'PG', 'Entry', 'Method', 'Amount'],
  complaints: ['Code', 'Raised', 'PG', 'Room', 'Resident', 'Category', 'Title', 'Priority', 'Status', 'Assigned to'],
  maintenance: ['Created', 'PG', 'Room', 'Title', 'Priority', 'Status', 'Assigned to', 'Due', 'Actual cost'],
  assets: ['Name', 'Category', 'PG', 'Room', 'Quantity', 'Condition', 'Status', 'Purchase date', 'Purchase cost'],
  visitors: ['In', 'Out', 'PG', 'Visitor', 'Phone', 'Purpose', 'Resident'],
  staff: ['Code', 'Name', 'Role', 'PG', 'Phone', 'Joined', 'Active', 'Salary'],
  enquiries: ['Received', 'Name', 'Phone', 'PG', 'Source', 'Status', 'Budget', 'Move-in date', 'Next follow-up'],
  bookings: ['Code', 'Booked', 'Name', 'Phone', 'PG', 'Room', 'Bed', 'Check-in date', 'Status', 'Rent', 'Token'],
  deposits: ['Resident', 'PG', 'Status', 'Agreed', 'Collected', 'Deductions', 'Refunded', 'Held now'],
  charges: ['Resident', 'PG', 'Type', 'Label', 'Starts', 'Ends', 'Status', 'Amount'],
  'rent-revisions': ['Resident', 'PG', 'Effective from', 'Reason', 'Old rent', 'New rent', 'Change'],
  activity: ['Time', 'Event', 'Summary', 'Actor', 'PG'],
  electricity: ['PG', 'Room', 'Month', 'Resident', 'Days', 'Units', 'Rate per unit', 'Room bill', 'Share', 'Payment'],
}

/** Reports where adding up a column means nothing (mixed sections, ratios). */
export const NO_TOTALS = new Set(['pnl', 'daily-collection', 'activity', 'rent-revisions'])

const MONEY =
  /^(amount|rent|old rent|new rent|change|deposit|total|subtotal|paid|balance|late fee|refunded|salary|budget|token|estimate|actual cost|purchase cost|current value|agreed|collected|deductions|held now|room bill|share|outstanding|revenue|expenses|net profit)$/i
const STATUS = /^(status|kyc|purpose|method|mode|priority|category|kind|type|source|condition|resident status|bill status|payment|token method|refund method|section|event)$/i
const NOT_SUMMED = /^(rate per unit|old rent|new rent)$/i

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

/** What each column holds, from its header and its values. */
export function columnKinds(header: string[], rows: Cell[][], kind?: string): ColumnKind[] {
  return header.map((h, i) => {
    const values = rows.map((r) => r[i]).filter((v) => v !== null && v !== undefined && v !== '')
    if (kind === 'pnl' && i > 0) return 'number'
    if (MONEY.test(h) && values.every((v) => typeof v === 'number' || /^-?\d+(\.\d+)?$/.test(String(v)))) return 'money'
    if (values.length && values.every((v) => ISO_DATETIME.test(String(v)))) return 'datetime'
    if (values.length && values.every((v) => ISO_DATE.test(String(v)))) return 'date'
    if (STATUS.test(h)) return 'status'
    if (values.length && values.every((v) => typeof v === 'number')) return 'number'
    return 'text'
  })
}

const dateFmt = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
const dateTimeFmt = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
const num = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 })

/** "2026-10-16" → a local Date (an Indian calendar day, not UTC midnight). */
export function parseDay(value: string) {
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d)
}

const ACRONYMS = /\b(upi|kyc|neft|imps|rtgs|gst|ac|id|sla|emandate)\b/gi

/** "PENDING_APPROVAL" / "pending approval" → "Pending approval"; "UPI" stays "UPI". */
export function prettyStatus(value: string) {
  const t = value.replace(/_/g, ' ').trim().toLowerCase()
  if (!t) return ''
  return (t[0].toUpperCase() + t.slice(1)).replace(ACRONYMS, (m) => (m.toLowerCase() === 'emandate' ? 'eMandate' : m.toUpperCase()))
}

/** Rows that never count towards a total (voided, cancelled, reversed, checked out…). */
const NOT_COUNTED = /^(void|voided|cancelled|canceled|reversed|rejected|refunded|checked[ _]out|exited)$/i
export function countsTowardsTotal(header: string[], row: Cell[]) {
  return !header.some((h, i) => /^status$/i.test(h) && NOT_COUNTED.test(String(row[i] ?? '').trim()))
}

/** A cell as people read it in the PDF. */
export function displayCell(kind: ColumnKind, value: Cell): string {
  if (value === null || value === undefined || value === '') return ''
  const s = String(value)
  switch (kind) {
    case 'money':
      return `${Number(s) < 0 ? '- ' : ''}₹${num.format(Math.abs(Number(s)))}`
    case 'number':
      return typeof value === 'number' || /^-?\d+(\.\d+)?$/.test(s) ? num.format(Number(s)) : s
    case 'date':
      return ISO_DATE.test(s) ? dateFmt.format(parseDay(s)) : s
    case 'datetime':
      return dateTimeFmt.format(new Date(s))
    case 'status':
      return prettyStatus(s)
    default:
      return s
  }
}

export type ReportTable = {
  columns: { label: string; kind: ColumnKind }[]
  rows: string[][]
  /** Display totals per column ('' where none), or null. */
  totals: string[] | null
}

/** Picks, formats and totals the columns for the PDF report. */
export function pdfTable(kind: string, header: string[], rows: Cell[][]): ReportTable {
  const kinds = columnKinds(header, rows, kind)
  const wanted = PDF_COLUMNS[kind]
  let idx = wanted ? wanted.map((h) => header.indexOf(h)).filter((i) => i >= 0) : header.map((_, i) => i)
  // Columns with no value in any row only take space.
  idx = idx.filter((i) => rows.some((r) => r[i] !== null && r[i] !== undefined && r[i] !== ''))
  if (!idx.length) idx = header.map((_, i) => i)
  const columns = idx.map((i) => ({ label: header[i], kind: kinds[i] }))
  const body = rows.map((r) => idx.map((i) => displayCell(kinds[i], r[i])))
  const money = idx.map((i) => kinds[i] === 'money' && !NOT_SUMMED.test(header[i]))
  const counted = rows.filter((r) => countsTowardsTotal(header, r))
  const totals =
    !NO_TOTALS.has(kind) && rows.length > 1 && money.some(Boolean)
      ? idx.map((i, c) => (money[c] ? displayCell('money', counted.reduce((s, r) => s + (Number(r[i]) || 0), 0)) : ''))
      : null
  if (totals) {
    const at = totals.findIndex((t) => t === '')
    if (at >= 0) totals[at] = counted.length < rows.length ? `Total (excl. ${rows.length - counted.length} inactive)` : 'Total'
  }
  return { columns, rows: body, totals }
}
