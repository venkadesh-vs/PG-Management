import 'server-only'

import { prisma } from '@/lib/prisma'
import { parseCsv, toCsv } from '@/lib/csv'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/tenancy'
import { formatMoney } from '@/lib/utils'
import { checkInResident } from './residents'

/**
 * Bulk resident import for PGs moving off notebooks and spreadsheets.
 *
 * validateImport() reads the CSV and checks every row against the PGs the
 * person can reach — nothing is written. runImport() re-validates, then
 * checks each valid row in through checkInResident on its own, so beds,
 * invoices, ledgers, deposits and logins are created exactly as a manual
 * check-in would, and one bad row never undoes the others.
 */

export const MAX_IMPORT_ROWS = 500

type FieldKey =
  | 'fullName'
  | 'phone'
  | 'pg'
  | 'room'
  | 'bed'
  | 'joiningDate'
  | 'rent'
  | 'deposit'
  | 'depositCollected'
  | 'email'
  | 'whatsapp'
  | 'guardianName'
  | 'guardianPhone'
  | 'city'
  | 'idType'
  | 'idNumber'
  | 'food'

const COLUMNS: { key: FieldKey; header: string; required?: boolean; aliases: string[] }[] = [
  { key: 'fullName', header: 'Full name*', required: true, aliases: ['fullname', 'name', 'residentname', 'tenantname'] },
  { key: 'phone', header: 'Phone*', required: true, aliases: ['phone', 'mobile', 'phonenumber', 'mobilenumber', 'contact'] },
  { key: 'pg', header: 'PG name*', required: true, aliases: ['pgname', 'pg', 'property', 'propertyname', 'hostel'] },
  { key: 'room', header: 'Room*', required: true, aliases: ['room', 'roomno', 'roomnumber'] },
  { key: 'bed', header: 'Bed*', required: true, aliases: ['bed', 'bedno', 'bedlabel', 'bednumber'] },
  { key: 'joiningDate', header: 'Joining date*', required: true, aliases: ['joiningdate', 'joindate', 'joined', 'checkindate', 'dateofjoining'] },
  { key: 'rent', header: 'Monthly rent*', required: true, aliases: ['monthlyrent', 'rent', 'rentamount'] },
  { key: 'deposit', header: 'Deposit', aliases: ['deposit', 'securitydeposit', 'depositamount'] },
  { key: 'depositCollected', header: 'Deposit collected (yes/no)', aliases: ['depositcollected', 'depositcollectedyesno', 'depositpaid'] },
  { key: 'email', header: 'Email', aliases: ['email', 'emailid', 'emailaddress'] },
  { key: 'whatsapp', header: 'WhatsApp', aliases: ['whatsapp', 'whatsappnumber', 'whatsappphone'] },
  { key: 'guardianName', header: 'Guardian name', aliases: ['guardianname', 'guardian', 'parentname'] },
  { key: 'guardianPhone', header: 'Guardian phone', aliases: ['guardianphone', 'guardianmobile', 'parentphone'] },
  { key: 'city', header: 'City', aliases: ['city', 'hometown', 'nativeplace'] },
  { key: 'idType', header: 'ID type', aliases: ['idtype', 'idprooftype', 'kyctype'] },
  { key: 'idNumber', header: 'ID number', aliases: ['idnumber', 'idno', 'idproofnumber', 'aadhaarnumber', 'aadhaar'] },
  { key: 'food', header: 'Food (yes/no)', aliases: ['food', 'foodyesno', 'meals', 'foodoptin'] },
]

const normHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '')
const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

// ------------------------------------------------------------------ template

export function importTemplateCsv() {
  const example: Record<FieldKey, string> = {
    fullName: 'Arun Kumar',
    phone: '9876543210',
    pg: 'Sunrise Mens PG',
    room: '101',
    bed: 'A',
    joiningDate: '01/09/2026',
    rent: '8500',
    deposit: '10000',
    depositCollected: 'yes',
    email: 'arun@example.com',
    whatsapp: '',
    guardianName: 'Kumar S',
    guardianPhone: '9876500000',
    city: 'Madurai',
    idType: 'Aadhaar',
    idNumber: '',
    food: 'yes',
  }
  return toCsv(
    COLUMNS.map((c) => c.header),
    [COLUMNS.map((c) => example[c.key])],
  )
}

// ------------------------------------------------------------------ parsing

/** 98765 43210, +91-9876543210, 09876543210 → 9876543210 (or null). */
export function normalizePhone(value: string): string | null {
  let digits = value.replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2)
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)
  return /^[6-9]\d{9}$/.test(digits) ? digits : null
}

/** DD/MM/YYYY (also - or .) or YYYY-MM-DD → local Date, or null. */
export function parseImportDate(value: string): Date | null {
  const v = value.trim()
  let y: number, m: number, d: number
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v)
  if (match) {
    ;[y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
  } else {
    match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v)
    if (!match) return null
    ;[d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])]
  }
  const date = new Date(y, m - 1, d)
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null
  return date
}

/** "₹ 8,500", "Rs.8500", "8500.00" → 8500 (whole rupees), or null. */
export function parseRupees(value: string): number | null {
  const clean = value.replace(/₹|rs\.?|inr|,|\s/gi, '')
  if (!/^\d+(\.\d+)?$/.test(clean)) return null
  return Math.round(Number(clean))
}

function parseYesNo(value: string): boolean | null {
  const v = value.trim().toLowerCase()
  if (!v) return null
  if (['yes', 'y', 'true', '1', 'paid', 'collected'].includes(v)) return true
  if (['no', 'n', 'false', '0', 'pending', 'not paid'].includes(v)) return false
  return null
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function displayDate(d: Date) {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

// --------------------------------------------------------------- validation

type ImportScope = { organizationId: string; propertyIds: string[] }

type ParsedRow = {
  fullName: string
  phone: string
  propertyId: string
  bedId: string
  joiningDate: Date
  rent: number
  deposit: number
  depositCollected: boolean
  maintenanceFee: number
  foodOptIn: boolean
  foodCharge: number
  email?: string
  whatsapp?: string
  guardianName?: string
  guardianPhone?: string
  city?: string
  idType?: string
  idNumber?: string
}

export type ImportRowResult = {
  /** Line number in the file (the header is line 1). */
  row: number
  fullName: string
  phone: string
  pg: string
  room: string
  bed: string
  joiningDate: string
  rent: string
  errors: string[]
  warnings: string[]
}

export type ImportValidation = {
  rows: ImportRowResult[]
  valid: number
  invalid: number
  parsed: Map<number, ParsedRow>
}

export async function validateImport(scope: ImportScope, csv: string): Promise<ImportValidation> {
  if (csv.startsWith('PK') || csv.includes('\u0000')) {
    throw new ValidationError(
      'This looks like an Excel (.xlsx) file. In Excel choose File → Save As → "CSV UTF-8 (Comma delimited) (*.csv)" and upload that file.',
    )
  }

  const [headerRow, ...body] = parseCsv(csv)
  if (!headerRow) throw new ValidationError('The file is empty. Download the template and fill one row per resident.')

  // Map each known column to its index in this file.
  const index = new Map<FieldKey, number>()
  headerRow.forEach((h, i) => {
    const n = normHeader(h)
    const col = COLUMNS.find((c) => normHeader(c.header) === n || c.aliases.includes(n))
    if (col && !index.has(col.key)) index.set(col.key, i)
  })
  const missing = COLUMNS.filter((c) => c.required && !index.has(c.key)).map((c) => c.header.replace('*', ''))
  if (missing.length) {
    throw new ValidationError(
      `Missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. Use the template's header row.`,
    )
  }
  if (!body.length) throw new ValidationError('The file has a header row but no residents.')
  if (body.length > MAX_IMPORT_ROWS) {
    throw new ValidationError(
      `The file has ${body.length} rows. Import at most ${MAX_IMPORT_ROWS} at a time — split it into smaller files.`,
    )
  }

  const properties = await prisma.property.findMany({
    where: { id: { in: scope.propertyIds }, organizationId: scope.organizationId, archivedAt: null },
    select: {
      id: true,
      name: true,
      code: true,
      standardDeposit: true,
      maintenanceFee: true,
      foodCharge: true,
      foodIncluded: true,
      rooms: {
        select: {
          number: true,
          beds: { select: { id: true, label: true, status: true, residentId: true } },
        },
      },
    },
  })
  const propertyByKey = new Map<string, (typeof properties)[number]>()
  for (const p of properties) propertyByKey.set(key(p.name), p)
  for (const p of properties) if (!propertyByKey.has(key(p.code))) propertyByKey.set(key(p.code), p)

  const current = await prisma.resident.findMany({
    where: { organizationId: scope.organizationId, status: { in: ['PENDING', 'ACTIVE', 'NOTICE'] } },
    select: { phone: true, code: true, fullName: true },
  })
  const currentByPhone = new Map<string, string>()
  for (const r of current) {
    const p = normalizePhone(r.phone)
    if (p) currentByPhone.set(p, `${r.fullName} (${r.code})`)
  }

  const phonesSeen = new Map<string, number>()
  const bedsSeen = new Map<string, number>()
  const rows: ImportRowResult[] = []
  const parsed = new Map<number, ParsedRow>()
  const today = new Date()

  body.forEach((cells, i) => {
    const line = i + 2
    const get = (k: FieldKey) => {
      const idx = index.get(k)
      return idx === undefined ? '' : (cells[idx] ?? '').trim()
    }
    const errors: string[] = []
    const warnings: string[] = []
    const result: ImportRowResult = {
      row: line,
      fullName: get('fullName'),
      phone: get('phone'),
      pg: get('pg'),
      room: get('room'),
      bed: get('bed'),
      joiningDate: get('joiningDate'),
      rent: get('rent'),
      errors,
      warnings,
    }
    rows.push(result)

    for (const c of COLUMNS) {
      if (c.required && !get(c.key)) errors.push(`${c.header.replace('*', '')} is required`)
    }

    const fullName = get('fullName')
    if (fullName && (fullName.length < 2 || fullName.length > 120)) errors.push('Full name must be 2–120 characters')

    const phone = get('phone') ? normalizePhone(get('phone')) : null
    if (get('phone') && !phone) errors.push('Phone must be a 10-digit Indian mobile number')
    if (phone) {
      const dupLine = phonesSeen.get(phone)
      if (dupLine) errors.push(`Same phone as row ${dupLine} in this file`)
      else phonesSeen.set(phone, line)
      const holder = currentByPhone.get(phone)
      if (holder) errors.push(`Already a current resident with this phone: ${holder}`)
    }

    let property: (typeof properties)[number] | undefined
    let bedId: string | undefined
    if (get('pg')) {
      property = propertyByKey.get(key(get('pg')))
      if (!property) errors.push(`PG "${get('pg')}" not found, or you do not have access to it`)
    }
    if (property && get('room')) {
      const room = property.rooms.find((r) => key(r.number) === key(get('room')))
      if (!room) errors.push(`Room ${get('room')} not found in ${property.name}`)
      else if (get('bed')) {
        const bed = room.beds.find((b) => key(b.label) === key(get('bed')))
        if (!bed) {
          errors.push(
            `Bed ${get('bed')} not found in room ${room.number} (beds: ${room.beds.map((b) => b.label).join(', ') || 'none'})`,
          )
        } else if (bed.residentId || bed.status === 'OCCUPIED') {
          errors.push(`Bed ${bed.label} in room ${room.number} is already occupied`)
        } else if (bed.status !== 'AVAILABLE') {
          errors.push(
            bed.status === 'RESERVED'
              ? `Bed ${bed.label} in room ${room.number} is reserved for a booking`
              : `Bed ${bed.label} in room ${room.number} is marked ${bed.status.toLowerCase()}`,
          )
        } else {
          const dupLine = bedsSeen.get(bed.id)
          if (dupLine) errors.push(`Same bed as row ${dupLine} in this file`)
          else bedsSeen.set(bed.id, line)
          bedId = bed.id
        }
      }
    }

    const joiningDate = get('joiningDate') ? parseImportDate(get('joiningDate')) : null
    if (get('joiningDate') && !joiningDate) errors.push('Joining date must be DD/MM/YYYY or YYYY-MM-DD')
    if (joiningDate) {
      const ageDays = (today.getTime() - joiningDate.getTime()) / 86_400_000
      if (ageDays < -365) errors.push('Joining date is more than a year in the future')
      else if (ageDays > 45) {
        warnings.push(
          `First rent invoice is raised for ${joiningDate.toLocaleString('en-IN', { month: 'short', year: 'numeric' })}; waive it from Rent if already paid`,
        )
      }
      result.joiningDate = displayDate(joiningDate)
    }

    const rent = get('rent') ? parseRupees(get('rent')) : null
    if (get('rent') && (rent === null || rent <= 0)) errors.push('Monthly rent must be a number greater than 0')
    else if (rent && rent > 500_000) errors.push('Monthly rent looks too high — check the amount')

    let deposit = property?.standardDeposit ?? 0
    if (get('deposit')) {
      const d = parseRupees(get('deposit'))
      if (d === null) errors.push('Deposit must be a number')
      else deposit = d
    } else if (property) {
      warnings.push(`No deposit given — the PG standard ${formatMoney(deposit)} is used`)
    }

    const depositCollected = get('depositCollected') ? parseYesNo(get('depositCollected')) : false
    if (depositCollected === null) errors.push('Deposit collected must be yes or no')

    const food = get('food') ? parseYesNo(get('food')) : (property?.foodIncluded ?? true)
    if (food === null) errors.push('Food must be yes or no')

    const email = get('email')
    if (email && !EMAIL_RE.test(email)) errors.push('Email is not valid')
    const whatsapp = get('whatsapp') ? normalizePhone(get('whatsapp')) : null
    if (get('whatsapp') && !whatsapp) errors.push('WhatsApp must be a 10-digit mobile number')
    const guardianPhone = get('guardianPhone') ? normalizePhone(get('guardianPhone')) : null
    if (get('guardianPhone') && !guardianPhone) errors.push('Guardian phone must be a 10-digit mobile number')

    if (
      !errors.length &&
      property &&
      bedId &&
      phone &&
      joiningDate &&
      rent &&
      depositCollected !== null &&
      food !== null
    ) {
      parsed.set(line, {
        fullName,
        phone,
        propertyId: property.id,
        bedId,
        joiningDate,
        rent,
        deposit,
        depositCollected,
        maintenanceFee: property.maintenanceFee,
        foodOptIn: food,
        foodCharge: food ? property.foodCharge : 0,
        email: email || undefined,
        whatsapp: whatsapp ?? undefined,
        guardianName: get('guardianName') || undefined,
        guardianPhone: guardianPhone ?? undefined,
        city: get('city') || undefined,
        idType: get('idType') || undefined,
        idNumber: get('idNumber') || undefined,
      })
    }
  })

  return { rows, valid: parsed.size, invalid: rows.length - parsed.size, parsed }
}

// ------------------------------------------------------------------- commit

export type ImportOutcome = {
  row: number
  fullName: string
  status: 'imported' | 'failed' | 'skipped'
  residentId?: string
  residentCode?: string
  message?: string
}

export async function runImport(params: {
  scope: ImportScope
  csv: string
  createLogins: boolean
  sendWelcome: boolean
  actor: { id: string; name: string }
}) {
  const validation = await validateImport(params.scope, params.csv)
  const outcomes: ImportOutcome[] = []

  for (const row of validation.rows) {
    const data = validation.parsed.get(row.row)
    if (!data) {
      outcomes.push({ row: row.row, fullName: row.fullName, status: 'skipped', message: row.errors[0] })
      continue
    }
    try {
      const result = await checkInResident({
        organizationId: params.scope.organizationId,
        propertyId: data.propertyId,
        bedId: data.bedId,
        fullName: data.fullName,
        phone: data.phone,
        whatsappPhone: data.whatsapp,
        email: data.email,
        guardianName: data.guardianName,
        guardianPhone: data.guardianPhone,
        city: data.city,
        idType: data.idType,
        idNumber: data.idNumber,
        joiningDate: data.joiningDate,
        rentAmount: data.rent,
        depositAmount: data.deposit,
        depositCollected: data.depositCollected,
        maintenanceFee: data.maintenanceFee,
        foodOptIn: data.foodOptIn,
        foodCharge: data.foodCharge,
        createTenantAccount: params.createLogins,
        // The welcome WhatsApp (and the invite on WhatsApp) only goes out
        // with consent, so this switch is what keeps an import quiet.
        whatsappConsent: params.sendWelcome,
        actor: params.actor,
      })
      const notes = [
        result.firstInvoiceError && `First invoice not raised: ${result.firstInvoiceError}`,
      ].filter(Boolean)
      outcomes.push({
        row: row.row,
        fullName: data.fullName,
        status: 'imported',
        residentId: result.resident.id,
        residentCode: result.resident.code,
        message: notes.length ? notes.join('; ') : undefined,
      })
    } catch (error) {
      const known =
        error instanceof ValidationError || error instanceof ConflictError || error instanceof NotFoundError
      if (!known) console.error('[resident-import] row failed', { row: row.row, error })
      outcomes.push({
        row: row.row,
        fullName: data.fullName,
        status: 'failed',
        message: known ? error.message : 'Could not check this resident in. Try this row again.',
      })
    }
  }

  return {
    outcomes,
    imported: outcomes.filter((o) => o.status === 'imported').length,
    failed: outcomes.filter((o) => o.status === 'failed').length,
    skipped: outcomes.filter((o) => o.status === 'skipped').length,
  }
}
