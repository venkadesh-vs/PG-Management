/**
 * Migration wizard — the pure part: which StayFlow fields each import kind
 * has, how spreadsheet headers map onto them, and how raw cell text becomes
 * phones, amounts and dates. No database and no Next runtime, so it is unit
 * tested directly and shared by every import kind.
 */

export const IMPORT_KINDS = ['residents', 'rooms', 'balances'] as const
export type ImportKind = (typeof IMPORT_KINDS)[number]

export const MAX_IMPORT_ROWS = 2000
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024

export type FieldDef = {
  key: string
  label: string
  required?: boolean
  /** Header spellings that map to this field (compared after normHeader). */
  synonyms: string[]
  hint?: string
}

export const IMPORT_FIELDS: Record<ImportKind, FieldDef[]> = {
  residents: [
    { key: 'fullName', label: 'Resident name', required: true, synonyms: ['fullname', 'name', 'residentname', 'resident', 'tenantname', 'tenant', 'studentname', 'guestname'] },
    { key: 'phone', label: 'Phone', required: true, synonyms: ['phone', 'mobile', 'mobileno', 'phoneno', 'phonenumber', 'mobilenumber', 'contact', 'contactno', 'contactnumber', 'cell'], hint: '10-digit mobile' },
    { key: 'pg', label: 'PG name', required: true, synonyms: ['pgname', 'pg', 'property', 'propertyname', 'hostel', 'hostelname', 'branch', 'building'] },
    { key: 'room', label: 'Room', required: true, synonyms: ['room', 'roomno', 'roomnumber', 'roomnum'] },
    { key: 'bed', label: 'Bed', required: true, synonyms: ['bed', 'bedno', 'bedlabel', 'bednumber', 'bednum', 'cot', 'cotno'] },
    { key: 'joiningDate', label: 'Joining date', required: true, synonyms: ['joiningdate', 'joindate', 'joined', 'joining', 'doj', 'dateofjoining', 'checkindate', 'checkin', 'admissiondate', 'startdate'], hint: 'DD/MM/YYYY' },
    { key: 'rent', label: 'Monthly rent', required: true, synonyms: ['monthlyrent', 'rent', 'rentamount', 'rentpermonth', 'fee', 'monthlyfee', 'fees'] },
    { key: 'deposit', label: 'Deposit', synonyms: ['deposit', 'securitydeposit', 'depositamount', 'advancedeposit', 'advance', 'caution', 'cautiondeposit'] },
    { key: 'depositCollected', label: 'Deposit collected (yes/no)', synonyms: ['depositcollected', 'depositcollectedyesno', 'depositpaid', 'depositreceived'] },
    { key: 'email', label: 'Email', synonyms: ['email', 'emailid', 'emailaddress', 'mail'] },
    { key: 'whatsapp', label: 'WhatsApp', synonyms: ['whatsapp', 'whatsappnumber', 'whatsappno', 'whatsappphone'] },
    { key: 'guardianName', label: 'Guardian name', synonyms: ['guardianname', 'guardian', 'parentname', 'parent', 'fathername', 'father'] },
    { key: 'guardianPhone', label: 'Guardian phone', synonyms: ['guardianphone', 'guardianmobile', 'guardiancontact', 'parentphone', 'parentmobile', 'parentcontact', 'fatherphone', 'fathermobile'] },
    { key: 'city', label: 'City', synonyms: ['city', 'hometown', 'nativeplace', 'native', 'town'] },
    { key: 'idType', label: 'ID type', synonyms: ['idtype', 'idprooftype', 'kyctype', 'idproof', 'prooftype'] },
    { key: 'idNumber', label: 'ID number', synonyms: ['idnumber', 'idno', 'idproofnumber', 'idproofno', 'aadhaarnumber', 'aadhaar', 'aadhar', 'aadharno', 'aadhaarno'] },
    { key: 'food', label: 'Food (yes/no)', synonyms: ['food', 'foodyesno', 'meals', 'foodoptin', 'mess'] },
  ],
  rooms: [
    { key: 'pg', label: 'PG name', required: true, synonyms: ['pgname', 'pg', 'property', 'propertyname', 'hostel', 'hostelname', 'branch', 'building'] },
    { key: 'floor', label: 'Floor', synonyms: ['floor', 'floorno', 'floorname', 'floornumber', 'level'], hint: 'Ground, 1, 2… (guessed from the room number when empty)' },
    { key: 'room', label: 'Room', required: true, synonyms: ['room', 'roomno', 'roomnumber', 'roomnum'] },
    { key: 'beds', label: 'Beds / sharing', synonyms: ['beds', 'sharing', 'noofbeds', 'numberofbeds', 'bedcount', 'capacity', 'sharingtype', 'occupancy', 'roomtype', 'type'], hint: '1–12, or Single / Double / 3 sharing' },
    { key: 'bed', label: 'Bed label', synonyms: ['bed', 'bedno', 'bedlabel', 'bednumber', 'cot', 'cotno'], hint: 'Use when the sheet has one row per bed' },
    { key: 'rent', label: 'Rent per bed', synonyms: ['rent', 'monthlyrent', 'rentperbed', 'bedrent', 'rentamount', 'baserent'] },
    { key: 'ac', label: 'AC (yes/no)', synonyms: ['ac', 'aircondition', 'airconditioned', 'acnonac', 'isac'] },
  ],
  balances: [
    { key: 'phone', label: 'Phone', synonyms: ['phone', 'mobile', 'mobileno', 'phoneno', 'phonenumber', 'mobilenumber', 'contact', 'contactno', 'contactnumber'], hint: 'Phone or resident code is needed' },
    { key: 'code', label: 'Resident code', synonyms: ['residentcode', 'code', 'residentid', 'tenantcode', 'tenantid'] },
    { key: 'fullName', label: 'Resident name', synonyms: ['fullname', 'name', 'residentname', 'resident', 'tenantname', 'tenant'], hint: 'Only used to double-check the match' },
    { key: 'asOfDate', label: 'As of date', synonyms: ['asofdate', 'asof', 'date', 'balancedate', 'openingdate'], hint: 'Today when empty' },
    { key: 'outstanding', label: 'Rent outstanding', synonyms: ['outstanding', 'rentoutstanding', 'due', 'dues', 'balance', 'balancedue', 'pending', 'pendingrent', 'rentdue', 'amountdue', 'openingbalance'] },
    { key: 'advance', label: 'Advance paid', synonyms: ['advancepaid', 'advance', 'rentadvance', 'credit', 'excesspaid', 'prepaid'] },
    { key: 'depositHeld', label: 'Deposit held', synonyms: ['depositheld', 'deposit', 'securitydeposit', 'depositcollected', 'depositpaid', 'cautiondeposit'] },
  ],
}

export const KIND_LABELS: Record<ImportKind, { title: string; noun: string; nounPlural: string }> = {
  residents: { title: 'Residents', noun: 'resident', nounPlural: 'residents' },
  rooms: { title: 'Rooms & beds', noun: 'room', nounPlural: 'rooms' },
  balances: { title: 'Opening balances', noun: 'balance', nounPlural: 'balances' },
}

// ------------------------------------------------------------------ mapping

/** "Room No." → "roomno", "Tenant Name" → "tenantname". */
export const normHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '')

/** fieldKey → column index in the sheet (unmapped fields are absent). */
export type ColumnMapping = Record<string, number>

/**
 * Suggests a column for every field. A header remembered from the last import
 * of this kind wins, then an exact field label, then a synonym. One column is
 * never given to two fields.
 */
export function suggestMapping(
  kind: ImportKind,
  headers: string[],
  remembered?: Record<string, string> | null,
): ColumnMapping {
  const normed = headers.map(normHeader)
  const taken = new Set<number>()
  const mapping: ColumnMapping = {}
  const fields = IMPORT_FIELDS[kind]

  const claim = (fieldKey: string, idx: number) => {
    if (idx < 0 || taken.has(idx) || mapping[fieldKey] !== undefined) return
    mapping[fieldKey] = idx
    taken.add(idx)
  }

  if (remembered) {
    for (const f of fields) {
      const header = remembered[f.key]
      if (header) claim(f.key, normed.indexOf(normHeader(header)))
    }
  }
  for (const f of fields) claim(f.key, normed.indexOf(normHeader(f.label)))
  // Synonyms in priority order: the first synonym a field lists is its best match.
  for (const f of fields) {
    for (const s of f.synonyms) {
      const idx = normed.findIndex((n, i) => n === s && !taken.has(i))
      if (idx >= 0) {
        claim(f.key, idx)
        break
      }
    }
  }
  return mapping
}

/** Header names for a mapping, so the next import of this kind can reuse it. */
export function mappingToHeaders(mapping: ColumnMapping, headers: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, idx] of Object.entries(mapping)) {
    if (headers[idx]) out[key] = headers[idx]
  }
  return out
}

/** Required fields with no column — the wizard will not continue without them. */
export function missingRequired(kind: ImportKind, mapping: ColumnMapping): FieldDef[] {
  const missing = IMPORT_FIELDS[kind].filter((f) => f.required && mapping[f.key] === undefined)
  if (kind === 'balances' && mapping.phone === undefined && mapping.code === undefined) {
    missing.push(IMPORT_FIELDS.balances[0])
  }
  return missing
}

// ------------------------------------------------------------------- values

/** 98765 43210, +91-9876543210, 09876543210, 9.87654321E9 → 9876543210 (or null). */
export function normalizePhone(value: string): string | null {
  let v = value.trim()
  // Excel shows long numbers in scientific notation when a CSV is re-saved.
  if (/^\d(\.\d+)?e\+?\d+$/i.test(v)) v = String(Math.round(Number(v)))
  let digits = v.replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2)
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)
  return /^[6-9]\d{9}$/.test(digits) ? digits : null
}

/** Excel's day serial (1 = 1 Jan 1900, with its 1900 leap-year bug) → local Date. */
export function excelSerialToDate(serial: number): Date | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2_958_465) return null
  const whole = Math.floor(serial)
  // Serial 60 is the phantom 29 Feb 1900; from 61 on, day 0 is 30 Dec 1899.
  const base = whole < 60 ? new Date(1899, 11, 31) : new Date(1899, 11, 30)
  const date = new Date(base.getFullYear(), base.getMonth(), base.getDate() + whole)
  return date
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
}

function makeDate(y: number, m: number, d: number): Date | null {
  if (y < 100) y += 2000
  const date = new Date(y, m - 1, d)
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null
  return date
}

/**
 * DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, YYYY-MM-DD, 5-Sep-2026 and Excel serial
 * numbers (a date cell that lost its format) → local Date, or null. Indian
 * sheets are day-first, so 03/04/2026 is 3 April.
 */
export function parseImportDate(value: string): Date | null {
  const v = value.trim()
  if (!v) return null
  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(v)
  if (match) return makeDate(Number(match[1]), Number(match[2]), Number(match[3]))
  match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})$/.exec(v)
  if (match) return makeDate(Number(match[3]), Number(match[2]), Number(match[1]))
  match = /^(\d{1,2})[-/. ]([a-z]{3,9})[-/., ]+(\d{4}|\d{2})$/i.exec(v)
  if (match) {
    const m = MONTHS[match[2].toLowerCase().slice(0, 3)]
    return m ? makeDate(Number(match[3]), m, Number(match[1])) : null
  }
  // A bare number between 1982 and 2119 as an Excel serial.
  if (/^\d{5}(\.\d+)?$/.test(v)) {
    const n = Number(v)
    if (n >= 30000 && n <= 80000) return excelSerialToDate(n)
  }
  return null
}

export type AmountResult = { ok: true; value: number } | { ok: false; error: 'invalid' | 'negative' }

/** "₹ 8,500", "Rs.8500", "8500.00", "8,500/-" → 8500 (whole rupees). */
export function parseAmount(value: string): AmountResult {
  const clean = value.replace(/₹|rs\.?|inr|,|\/-|\s/gi, '')
  if (/^-\d+(\.\d+)?$/.test(clean) || /^\(\d+(\.\d+)?\)$/.test(clean)) return { ok: false, error: 'negative' }
  if (!/^\d+(\.\d+)?$/.test(clean)) return { ok: false, error: 'invalid' }
  return { ok: true, value: Math.round(Number(clean)) }
}

export function parseYesNo(value: string): boolean | null {
  const v = value.trim().toLowerCase()
  if (!v) return null
  if (['yes', 'y', 'true', '1', 'paid', 'collected', 'received', 'ac', 'veg', 'nonveg', 'non-veg'].includes(v)) return true
  if (['no', 'n', 'false', '0', 'pending', 'not paid', 'unpaid', 'non ac', 'non-ac', 'nonac', 'none'].includes(v)) return false
  return null
}

/** "Single" → 1, "3 sharing" → 3, "Double" → 2, "4" → 4, or null. */
export function parseSharing(value: string): number | null {
  const v = value.trim().toLowerCase()
  if (!v) return null
  const words: Record<string, number> = {
    single: 1, one: 1, double: 2, two: 2, twin: 2, triple: 3, three: 3, quad: 4, four: 4, five: 5, six: 6,
  }
  for (const [w, n] of Object.entries(words)) if (new RegExp(`\\b${w}\\b`).test(v)) return n
  const digits = /(\d{1,2})/.exec(v)
  return digits ? Number(digits[1]) : null
}

/** "Ground", "G", "0" → 0; "1st floor", "First", "F2" → 1, 2; or null. */
export function parseFloorLevel(value: string): number | null {
  const v = value.trim().toLowerCase()
  if (!v) return null
  if (/^(g|gf|ground|ground floor|groundfloor)$/.test(v) || v.startsWith('ground')) return 0
  if (/^(b|basement|lower ground|lg)/.test(v)) return -1
  const words = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth']
  const w = words.findIndex((word) => v.includes(word))
  if (w >= 0) return w + 1
  const digits = /(-?\d{1,2})/.exec(v)
  return digits ? Number(digits[1]) : null
}

/** Room 101 → floor 1, 1203 → 12, G04 → 0. null when it cannot be told. */
export function floorFromRoomNumber(room: string): number | null {
  const v = room.trim().toUpperCase()
  if (/^G\d+$/.test(v)) return 0
  if (/^\d{3,4}$/.test(v)) return Math.floor(Number(v) / 100)
  return null
}

export function floorName(level: number) {
  if (level === 0) return 'Ground floor'
  if (level < 0) return 'Basement'
  const suffix = level % 10 === 1 && level % 100 !== 11 ? 'st' : level % 10 === 2 && level % 100 !== 12 ? 'nd' : level % 10 === 3 && level % 100 !== 13 ? 'rd' : 'th'
  return `${level}${suffix} floor`
}

export function roomTypeFor(beds: number): 'SINGLE' | 'DOUBLE' | 'TRIPLE' | 'QUAD' | 'DORM' {
  return beds <= 1 ? 'SINGLE' : beds === 2 ? 'DOUBLE' : beds === 3 ? 'TRIPLE' : beds === 4 ? 'QUAD' : 'DORM'
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Case- and space-insensitive key for matching names, rooms and beds. */
export const matchKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

export function displayDate(d: Date) {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

/**
 * For each position whose key already appeared earlier, the earlier position.
 * Empty keys are ignored. Used for "same phone as row 4 in this file".
 */
export function findDuplicates(keys: (string | null | undefined)[]): Map<number, number> {
  const first = new Map<string, number>()
  const dups = new Map<number, number>()
  keys.forEach((k, i) => {
    if (!k) return
    const seen = first.get(k)
    if (seen === undefined) first.set(k, i)
    else dups.set(i, seen)
  })
  return dups
}

// ----------------------------------------------------------------- rows

/** One data row of the sheet: `line` is its row number as the user sees it. */
export type SheetRow = { line: number; cells: string[] }

export type RowCheck = {
  row: number
  /** ready = will import; skip = nothing to do (already exists); error = must be fixed. */
  status: 'ready' | 'skip' | 'error'
  title: string
  subtitle: string
  errors: string[]
  warnings: string[]
}

export type RowOutcome = {
  row: number
  status: 'imported' | 'skipped' | 'failed'
  title: string
  message?: string
  link?: string
}

/** Reads one mapped cell, trimmed ('' when unmapped). */
export function cellOf(row: SheetRow, mapping: ColumnMapping, key: string) {
  const idx = mapping[key]
  return idx === undefined ? '' : (row.cells[idx] ?? '').trim()
}

export function countChecks(checks: RowCheck[]) {
  return {
    ready: checks.filter((c) => c.status === 'ready').length,
    skip: checks.filter((c) => c.status === 'skip').length,
    error: checks.filter((c) => c.status === 'error').length,
  }
}

/**
 * Plan room for a batch: how many of `wanted` fit under `limit` given `used`.
 * null limit = unlimited.
 */
export function planHeadroom(used: number, wanted: number, limit: number | null) {
  if (limit == null) return { fits: wanted, over: 0 }
  const room = Math.max(0, limit - used)
  return { fits: Math.min(wanted, room), over: Math.max(0, wanted - room) }
}

// ---------------------------------------------------------------- templates

const TEMPLATE_EXAMPLES: Record<ImportKind, Record<string, string>[]> = {
  residents: [
    {
      fullName: 'Arun Kumar', phone: '9876543210', pg: 'Sunrise Mens PG', room: '101', bed: 'A',
      joiningDate: '01/09/2026', rent: '8500', deposit: '10000', depositCollected: 'yes',
      email: 'arun@example.com', whatsapp: '', guardianName: 'Kumar S', guardianPhone: '9876500000',
      city: 'Madurai', idType: 'Aadhaar', idNumber: '', food: 'yes',
    },
  ],
  rooms: [
    { pg: 'Sunrise Mens PG', floor: 'Ground', room: 'G01', beds: '2', bed: '', rent: '8500', ac: 'no' },
    { pg: 'Sunrise Mens PG', floor: '1', room: '101', beds: '3 sharing', bed: '', rent: '7500', ac: 'yes' },
  ],
  balances: [
    { phone: '9876543210', code: '', fullName: 'Arun Kumar', asOfDate: '30/09/2026', outstanding: '4250', advance: '', depositHeld: '10000' },
    { phone: '', code: 'R0012', fullName: 'Priya S', asOfDate: '30/09/2026', outstanding: '', advance: '2000', depositHeld: '' },
  ],
}

/** Header row (required fields starred) and example rows for a kind's template. */
export function templateRows(kind: ImportKind) {
  const fields = IMPORT_FIELDS[kind]
  return {
    headers: fields.map((f) => (f.required ? `${f.label}*` : f.label)),
    rows: TEMPLATE_EXAMPLES[kind].map((ex) => fields.map((f) => ex[f.key] ?? '')),
  }
}
