import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'

import { errorReportCsv, parseCsv } from '@/lib/csv'
import {
  excelSerialToDate,
  findDuplicates,
  floorFromRoomNumber,
  missingRequired,
  normalizePhone,
  parseAmount,
  parseFloorLevel,
  parseImportDate,
  parseSharing,
  planHeadroom,
  suggestMapping,
  templateRows,
} from '@/server/services/import-fields'
import { cellText, pickHeaderIndex, readWorkbook } from '@/server/services/import-sheet'

const ymd = (d: Date | null) =>
  d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : null

describe('suggestMapping (header synonyms)', () => {
  it('maps common resident sheet headers', () => {
    const headers = ['S.No', 'Tenant Name', 'Mobile', 'PG', 'Room No', 'Bed No', 'DOJ', 'Monthly Rent', 'Advance Deposit', 'Remarks']
    const m = suggestMapping('residents', headers)
    expect(m).toMatchObject({ fullName: 1, phone: 2, pg: 3, room: 4, bed: 5, joiningDate: 6, rent: 7, deposit: 8 })
    expect(Object.values(m)).not.toContain(0)
    expect(Object.values(m)).not.toContain(9)
    expect(missingRequired('residents', m)).toEqual([])
  })

  it('understands Name / Contact / Check-in Date / Rent', () => {
    const m = suggestMapping('residents', ['Name', 'Contact', 'Check-in Date', 'Rent'])
    expect(m).toEqual({ fullName: 0, phone: 1, joiningDate: 2, rent: 3 })
    expect(missingRequired('residents', m).map((f) => f.key)).toEqual(['pg', 'room', 'bed'])
  })

  it('accepts its own template header row', () => {
    const { headers } = templateRows('residents')
    const m = suggestMapping('residents', headers)
    expect(Object.keys(m)).toHaveLength(headers.length)
  })

  it('prefers the remembered mapping and never gives one column to two fields', () => {
    const m = suggestMapping('residents', ['Name', 'Guardian', 'Phone'], { fullName: 'Guardian' })
    expect(m.fullName).toBe(1)
    expect(m.guardianName).toBeUndefined()
    expect(m.phone).toBe(2)
  })

  it('balances need a phone or a resident code', () => {
    expect(missingRequired('balances', suggestMapping('balances', ['Name', 'Due'])).length).toBe(1)
    expect(missingRequired('balances', suggestMapping('balances', ['Resident Code', 'Due']))).toEqual([])
  })
})

describe('parseImportDate', () => {
  it.each([
    ['05/09/2026', '2026-09-05'],
    ['5-9-2026', '2026-09-05'],
    ['05.09.2026', '2026-09-05'],
    ['2026-09-05', '2026-09-05'],
    ['2026-09-05T00:00:00.000Z', '2026-09-05'],
    ['5-Sep-2026', '2026-09-05'],
    ['05/09/26', '2026-09-05'],
  ])('%s → %s', (input, out) => {
    expect(ymd(parseImportDate(input))).toBe(out)
  })

  it('rejects impossible and garbage dates', () => {
    expect(parseImportDate('31/02/2026')).toBeNull()
    expect(parseImportDate('13/13/2026')).toBeNull()
    expect(parseImportDate('soon')).toBeNull()
    expect(parseImportDate('')).toBeNull()
  })

  it('reads Excel serial numbers', () => {
    expect(ymd(excelSerialToDate(1))).toBe('1900-01-01')
    expect(ymd(excelSerialToDate(61))).toBe('1900-03-01')
    expect(ymd(excelSerialToDate(45658))).toBe('2025-01-01')
    expect(ymd(parseImportDate('46270'))).toBe('2026-09-05')
    expect(parseImportDate('12345')).toBeNull()
  })
})

describe('phone and amount validation', () => {
  it.each([
    ['98765 43210', '9876543210'],
    ['+91-98765-43210', '9876543210'],
    ['09876543210', '9876543210'],
    ['919876543210', '9876543210'],
    ['9.87654321E+09', '9876543210'],
  ])('%s is a valid phone', (input, out) => {
    expect(normalizePhone(input)).toBe(out)
  })

  it.each(['12345', '1234567890', '98765432101', 'abc'])('%s is not a valid phone', (input) => {
    expect(normalizePhone(input)).toBeNull()
  })

  it('parses rupee amounts', () => {
    expect(parseAmount('₹ 8,500')).toEqual({ ok: true, value: 8500 })
    expect(parseAmount('Rs.8500/-')).toEqual({ ok: true, value: 8500 })
    expect(parseAmount('8500.50')).toEqual({ ok: true, value: 8501 })
    expect(parseAmount('0')).toEqual({ ok: true, value: 0 })
    expect(parseAmount('-500')).toEqual({ ok: false, error: 'negative' })
    expect(parseAmount('eight thousand')).toEqual({ ok: false, error: 'invalid' })
  })

  it('parses sharing and floors', () => {
    expect(parseSharing('3 sharing')).toBe(3)
    expect(parseSharing('Double')).toBe(2)
    expect(parseSharing('4')).toBe(4)
    expect(parseSharing('?')).toBeNull()
    expect(parseFloorLevel('Ground')).toBe(0)
    expect(parseFloorLevel('2nd floor')).toBe(2)
    expect(parseFloorLevel('First')).toBe(1)
    expect(floorFromRoomNumber('305')).toBe(3)
    expect(floorFromRoomNumber('G04')).toBe(0)
    expect(floorFromRoomNumber('A')).toBeNull()
  })
})

describe('duplicate detection', () => {
  it('points later duplicates at the first occurrence and ignores blanks', () => {
    const d = findDuplicates(['9876543210', null, '9123456789', '9876543210', '', '9876543210'])
    expect([...d.entries()]).toEqual([
      [3, 0],
      [5, 0],
    ])
  })

  it('plan headroom', () => {
    expect(planHeadroom(8, 5, 10)).toEqual({ fits: 2, over: 3 })
    expect(planHeadroom(8, 5, null)).toEqual({ fits: 5, over: 0 })
  })
})

describe('errorReportCsv', () => {
  it('lists problem rows with original values and problems', () => {
    const csv = errorReportCsv(
      ['Name', 'Phone'],
      [
        { line: 2, cells: ['Arun', '9876543210'] },
        { line: 3, cells: ['=cmd', '123'] },
      ],
      [
        { row: 2, status: 'ready', errors: [], warnings: [] },
        { row: 3, status: 'error', errors: ['Phone is not valid', 'Name too short'], warnings: [] },
      ],
    )
    const rows = parseCsv(csv)
    expect(rows[0]).toEqual(['Row', 'Status', 'Errors', 'Warnings', 'Name', 'Phone'])
    expect(rows).toHaveLength(2)
    expect(rows[1]).toEqual(['3', 'Error', 'Phone is not valid; Name too short', '', "'=cmd", '123'])
  })
})

describe('sheet reading', () => {
  it('turns cells into text', () => {
    expect(cellText(new Date(Date.UTC(2026, 8, 5)))).toBe('2026-09-05')
    expect(cellText({ richText: [{ text: 'Arun ' }, { text: 'Kumar' }] })).toBe('Arun Kumar')
    expect(cellText({ formula: 'A1*2', result: 17000 })).toBe('17000')
    expect(cellText(8500.0000001)).toBe('8500')
    expect(cellText(null)).toBe('')
  })

  it('skips a title line above the header', () => {
    expect(pickHeaderIndex([['Sunrise PG — residents'], ['Name', 'Phone', 'Room'], ['A', '1', '2']])).toBe(1)
  })

  it('reads an .xlsx workbook with real date cells and picks a sheet', async () => {
    const wb = new ExcelJS.Workbook()
    wb.addWorksheet('Notes').addRow(['ignore me'])
    const ws = wb.addWorksheet('Residents')
    ws.addRow(['Tenant Name', 'Mobile', 'DOJ', 'Rent'])
    ws.addRow(['Arun', 9876543210, new Date(Date.UTC(2026, 8, 5)), 8500])
    const buf = await wb.xlsx.writeBuffer()
    const sheet = await readWorkbook('t.xlsx', buf as ArrayBuffer, 'Residents')
    expect(sheet.sheets).toEqual(['Notes', 'Residents'])
    expect(sheet.headers).toEqual(['Tenant Name', 'Mobile', 'DOJ', 'Rent'])
    expect(sheet.rows).toEqual([{ line: 2, cells: ['Arun', '9876543210', '2026-09-05', '8500'] }])
  })
})
