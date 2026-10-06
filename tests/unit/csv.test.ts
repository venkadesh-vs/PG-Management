import { describe, expect, it } from 'vitest'

import { csvCell, parseCsv, parseCsvObjects, toCsv } from '@/lib/csv'

describe('parseCsv', () => {
  it('reads plain rows', () => {
    expect(parseCsv('a,b,c\n1,2,3\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ])
  })

  it('handles a missing final newline', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('keeps commas inside quoted fields', () => {
    expect(parseCsv('name,address\n"Kumar, Arun","12, Main Rd, Chennai"\n')).toEqual([
      ['name', 'address'],
      ['Kumar, Arun', '12, Main Rd, Chennai'],
    ])
  })

  it('unescapes doubled quotes', () => {
    expect(parseCsv('note\n"He said ""hi"""\n')).toEqual([['note'], ['He said "hi"']])
  })

  it('keeps line breaks inside quoted fields', () => {
    expect(parseCsv('a,b\n"line 1\r\nline 2",x\n')).toEqual([
      ['a', 'b'],
      ['line 1\r\nline 2', 'x'],
    ])
  })

  it('reads CRLF, LF and lone CR line endings alike', () => {
    const expected = [
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]
    expect(parseCsv('a,b\r\n1,2\r\n3,4\r\n')).toEqual(expected)
    expect(parseCsv('a,b\n1,2\n3,4\n')).toEqual(expected)
    expect(parseCsv('a,b\r1,2\r3,4')).toEqual(expected)
  })

  it('strips a UTF-8 BOM', () => {
    const rows = parseCsv('﻿Full name*,Phone*\r\nArun,9876543210\r\n')
    expect(rows[0][0]).toBe('Full name*')
    expect(rows[1]).toEqual(['Arun', '9876543210'])
  })

  it('drops empty and whitespace-only lines', () => {
    expect(parseCsv('a,b\n\n1,2\n   \n,\n\n3,4\n\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ])
  })

  it('keeps empty cells within a row', () => {
    expect(parseCsv('a,b,c\n1,,3\n,,x\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '', '3'],
      ['', '', 'x'],
    ])
  })

  it('detects semicolon-separated files from the header', () => {
    expect(parseCsv('name;rent\n"Arun; K";8500\n')).toEqual([
      ['name', 'rent'],
      ['Arun; K', '8500'],
    ])
  })

  it('returns no rows for empty input', () => {
    expect(parseCsv('')).toEqual([])
    expect(parseCsv('﻿')).toEqual([])
    expect(parseCsv('\r\n\r\n')).toEqual([])
  })
})

describe('parseCsvObjects', () => {
  it('keys rows by trimmed headers and fills missing cells', () => {
    expect(parseCsvObjects(' name , phone \nArun , 98765\nBala\n')).toEqual({
      headers: ['name', 'phone'],
      rows: [
        { name: 'Arun', phone: '98765' },
        { name: 'Bala', phone: '' },
      ],
    })
  })
})

describe('writing', () => {
  it('quotes cells with commas, quotes or line breaks', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('two\nlines')).toBe('"two\nlines"')
    expect(csvCell(8500)).toBe('8500')
    expect(csvCell(null)).toBe('')
  })

  it('guards spreadsheet formulas in text cells', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)")
    expect(csvCell('+91 98765')).toBe("'+91 98765")
    expect(csvCell(-5)).toBe('-5')
  })

  it('writes a BOM and CRLF, and round-trips through the parser', () => {
    const text = toCsv(['Name', 'Address'], [['Arun', '12, Main Rd'], ['Bala "B"', '']])
    expect(text.startsWith('﻿')).toBe(true)
    expect(text).toContain('\r\n')
    expect(parseCsv(text)).toEqual([
      ['Name', 'Address'],
      ['Arun', '12, Main Rd'],
      ['Bala "B"', ''],
    ])
  })
})
