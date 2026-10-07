import 'server-only'

import { prisma } from '@/lib/prisma'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/tenancy'
import { formatMoney } from '@/lib/utils'
import { checkInResident } from './residents'
import {
  cellOf,
  displayDate,
  EMAIL_RE,
  findDuplicates,
  matchKey,
  normalizePhone,
  parseAmount,
  parseImportDate,
  parseYesNo,
  type ColumnMapping,
  type RowCheck,
  type RowOutcome,
  type SheetRow,
} from './import-fields'
import { applyPlanLimit } from './import-jobs'

/**
 * Bulk resident import for PGs moving off notebooks and spreadsheets.
 *
 * validateResidentRows() checks every mapped row against the PGs the person
 * can reach — nothing is written. importResidentRows() checks each ready row
 * in through checkInResident on its own (one transaction per resident), so
 * beds, invoices, ledgers, deposits and logins are created exactly as a
 * manual check-in would, and one bad row never undoes the others.
 */

export type ImportScope = { organizationId: string; propertyIds: string[] }

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

export type ResidentValidation = {
  checks: RowCheck[]
  notes: string[]
  parsed: Map<number, ParsedRow>
}

const REQUIRED: { key: string; label: string }[] = [
  { key: 'fullName', label: 'Resident name' },
  { key: 'phone', label: 'Phone' },
  { key: 'pg', label: 'PG name' },
  { key: 'room', label: 'Room' },
  { key: 'bed', label: 'Bed' },
  { key: 'joiningDate', label: 'Joining date' },
  { key: 'rent', label: 'Monthly rent' },
]

export async function validateResidentRows(
  scope: ImportScope,
  rows: SheetRow[],
  mapping: ColumnMapping,
): Promise<ResidentValidation> {
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
  for (const p of properties) propertyByKey.set(matchKey(p.name), p)
  for (const p of properties) if (!propertyByKey.has(matchKey(p.code))) propertyByKey.set(matchKey(p.code), p)

  const current = await prisma.resident.findMany({
    where: { organizationId: scope.organizationId, status: { in: ['PENDING', 'ACTIVE', 'NOTICE'] } },
    select: { phone: true, code: true, fullName: true },
  })
  const currentByPhone = new Map<string, string>()
  for (const r of current) {
    const p = normalizePhone(r.phone)
    if (p) currentByPhone.set(p, `${r.fullName} (${r.code})`)
  }

  const get = (row: SheetRow, key: string) => cellOf(row, mapping, key)
  const phones = rows.map((r) => normalizePhone(get(r, 'phone')))
  const phoneDups = findDuplicates(phones)

  const bedsSeen = new Map<string, number>()
  const checks: RowCheck[] = []
  const parsed = new Map<number, ParsedRow>()
  const today = new Date()

  rows.forEach((row, i) => {
    const errors: string[] = []
    const warnings: string[] = []
    const check: RowCheck = {
      row: row.line,
      status: 'ready',
      title: get(row, 'fullName') || '—',
      subtitle: [get(row, 'phone'), get(row, 'pg'), get(row, 'room') && `Room ${get(row, 'room')}`, get(row, 'bed') && `Bed ${get(row, 'bed')}`]
        .filter(Boolean)
        .join(' · '),
      errors,
      warnings,
    }
    checks.push(check)

    for (const f of REQUIRED) if (!get(row, f.key)) errors.push(`${f.label} is missing`)

    const fullName = get(row, 'fullName')
    if (fullName && (fullName.length < 2 || fullName.length > 120)) errors.push('Name must be 2–120 characters')

    const phone = phones[i]
    if (get(row, 'phone') && !phone) errors.push(`Phone "${get(row, 'phone')}" is not a valid 10-digit mobile number`)
    if (phone) {
      const dup = phoneDups.get(i)
      if (dup !== undefined) errors.push(`Same phone as row ${rows[dup].line} in this file`)
      const holder = currentByPhone.get(phone)
      if (holder) {
        check.status = 'skip'
        check.errors.length = 0
        check.warnings.push(`Already in StayFlow: ${holder}`)
        return
      }
    }

    let property: (typeof properties)[number] | undefined
    let bedId: string | undefined
    if (get(row, 'pg')) {
      property = propertyByKey.get(matchKey(get(row, 'pg')))
      if (!property) errors.push(`PG "${get(row, 'pg')}" not found, or you do not have access to it`)
    }
    if (property && get(row, 'room')) {
      const room = property.rooms.find((r) => matchKey(r.number) === matchKey(get(row, 'room')))
      if (!room) errors.push(`Room ${get(row, 'room')} not found in ${property.name} — import rooms & beds first`)
      else if (get(row, 'bed')) {
        const bed = room.beds.find((b) => matchKey(b.label) === matchKey(get(row, 'bed')))
        if (!bed) {
          errors.push(
            `Bed ${get(row, 'bed')} not found in room ${room.number} (beds: ${room.beds.map((b) => b.label).join(', ') || 'none'})`,
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
          else bedsSeen.set(bed.id, row.line)
          bedId = bed.id
        }
      }
    }

    const joiningDate = get(row, 'joiningDate') ? parseImportDate(get(row, 'joiningDate')) : null
    if (get(row, 'joiningDate') && !joiningDate) {
      errors.push(`Joining date "${get(row, 'joiningDate')}" is not a date — use DD/MM/YYYY`)
    }
    if (joiningDate) {
      const ageDays = (today.getTime() - joiningDate.getTime()) / 86_400_000
      if (ageDays < -365) errors.push('Joining date is more than a year in the future')
      else if (ageDays > 45) {
        warnings.push(
          `First rent invoice is raised for ${joiningDate.toLocaleString('en-IN', { month: 'short', year: 'numeric' })}; import opening balances afterwards instead of back-dated rent`,
        )
      }
    }

    let rent: number | null = null
    if (get(row, 'rent')) {
      const r = parseAmount(get(row, 'rent'))
      if (!r.ok) errors.push(r.error === 'negative' ? 'Monthly rent cannot be negative' : `Monthly rent "${get(row, 'rent')}" is not a number`)
      else if (r.value <= 0) errors.push('Monthly rent must be more than 0')
      else if (r.value > 500_000) errors.push('Monthly rent looks too high — check the amount')
      else rent = r.value
    }

    let deposit = property?.standardDeposit ?? 0
    if (get(row, 'deposit')) {
      const d = parseAmount(get(row, 'deposit'))
      if (!d.ok) errors.push(d.error === 'negative' ? 'Deposit cannot be negative' : `Deposit "${get(row, 'deposit')}" is not a number`)
      else deposit = d.value
    } else if (property) {
      warnings.push(`No deposit given — the PG standard ${formatMoney(deposit)} is used`)
    }

    const depositCollected = get(row, 'depositCollected') ? parseYesNo(get(row, 'depositCollected')) : false
    if (depositCollected === null) errors.push('Deposit collected must be yes or no')

    const food = get(row, 'food') ? parseYesNo(get(row, 'food')) : (property?.foodIncluded ?? true)
    if (food === null) errors.push('Food must be yes or no')

    const email = get(row, 'email')
    if (email && !EMAIL_RE.test(email)) errors.push(`Email "${email}" is not valid`)
    const whatsapp = get(row, 'whatsapp') ? normalizePhone(get(row, 'whatsapp')) : null
    if (get(row, 'whatsapp') && !whatsapp) errors.push('WhatsApp must be a 10-digit mobile number')
    const guardianPhone = get(row, 'guardianPhone') ? normalizePhone(get(row, 'guardianPhone')) : null
    if (get(row, 'guardianPhone') && !guardianPhone) warnings.push('Guardian phone is not a 10-digit number — left empty')

    if (errors.length) {
      check.status = 'error'
      return
    }
    if (property && bedId && phone && joiningDate && rent && depositCollected !== null && food !== null) {
      check.subtitle = `${phone} · ${property.name} · Room ${get(row, 'room')} · Bed ${get(row, 'bed')} · ${displayDate(joiningDate)} · ${formatMoney(rent)}`
      parsed.set(row.line, {
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
        guardianName: get(row, 'guardianName') || undefined,
        guardianPhone: guardianPhone ?? undefined,
        city: get(row, 'city') || undefined,
        idType: get(row, 'idType') || undefined,
        idNumber: get(row, 'idNumber') || undefined,
      })
    } else {
      check.status = 'error'
      errors.push('This row could not be read')
    }
  })

  const notes: string[] = []
  const planNote = await applyPlanLimit(scope.organizationId, 'residents', checks, () => 1)
  if (planNote) {
    notes.push(planNote)
    for (const c of checks) if (c.status === 'error') parsed.delete(c.row)
  }
  return { checks, notes, parsed }
}

export async function importResidentRows(params: {
  scope: ImportScope
  validation: ResidentValidation
  createLogins: boolean
  sendWelcome: boolean
  actor: { id: string; name: string }
}): Promise<RowOutcome[]> {
  const outcomes: RowOutcome[] = []
  for (const check of params.validation.checks) {
    const data = params.validation.parsed.get(check.row)
    if (!data || check.status !== 'ready') {
      outcomes.push({
        row: check.row,
        title: check.title,
        status: check.status === 'skip' ? 'skipped' : 'failed',
        message: check.status === 'skip' ? check.warnings[0] : check.errors.join('; ') || 'Not imported',
      })
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
      outcomes.push({
        row: check.row,
        title: `${data.fullName} (${result.resident.code})`,
        status: 'imported',
        link: `/app/residents/${result.resident.id}`,
        message: result.firstInvoiceError ? `Checked in; first invoice not raised: ${result.firstInvoiceError}` : undefined,
      })
    } catch (error) {
      const known =
        error instanceof ValidationError || error instanceof ConflictError || error instanceof NotFoundError
      if (!known) console.error('[resident-import] row failed', { row: check.row, error })
      outcomes.push({
        row: check.row,
        title: data.fullName,
        status: 'failed',
        message: known ? error.message : 'Could not check this resident in. Try this row again.',
      })
    }
  }
  return outcomes
}
