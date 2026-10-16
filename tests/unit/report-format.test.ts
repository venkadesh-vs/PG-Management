import { describe, expect, it } from 'vitest'
import { columnKinds, displayCell, pdfTable, prettyStatus } from '@/lib/report-format'

describe('report formatting', () => {
  it('reads statuses and keeps acronyms', () => {
    expect(prettyStatus('PENDING_APPROVAL')).toBe('Pending approval')
    expect(prettyStatus('UPI')).toBe('UPI')
    expect(prettyStatus('upi')).toBe('UPI')
    expect(prettyStatus('BANK_TRANSFER')).toBe('Bank transfer')
    expect(prettyStatus('emandate')).toBe('eMandate')
  })

  it('formats dates as Indian calendar days and money with ₹', () => {
    expect(displayCell('date', '2026-10-07')).toBe('07 Oct 2026')
    expect(displayCell('money', 175000)).toBe('₹1,75,000')
    expect(displayCell('money', '')).toBe('')
  })

  it('detects column kinds', () => {
    const kinds = columnKinds(['Date', 'Title', 'Amount', 'Status'], [['2026-10-01', 'Rice', 2480, 'APPROVED']])
    expect(kinds).toEqual(['date', 'text', 'money', 'status'])
  })

  it('picks the PDF columns, drops empty ones and totals without voided rows', () => {
    const header = ['Date', 'PG', 'Category', 'Title', 'Amount', 'Vendor', 'Bill number', 'Mode', 'Reference', 'Status', 'Approved by', 'Recurring', 'Repeats from', 'Attachment', 'Void reason', 'Notes', 'Recorded by']
    const row = (amount: number, status: string) => ['2026-10-07', 'Men PG', 'electricity', 'Pump repair', amount, '', '', 'UPI', '', status, '', 'no', '', '', '', '', 'Kalai']
    const t = pdfTable('expenses', header, [row(7500, 'APPROVED'), row(7500, 'VOIDED'), row(240, 'PENDING')])
    expect(t.columns.map((c) => c.label)).toEqual(['Date', 'PG', 'Category', 'Title', 'Mode', 'Status', 'Recorded by', 'Amount'])
    expect(t.rows[0]).toEqual(['07 Oct 2026', 'Men PG', 'Electricity', 'Pump repair', 'UPI', 'Approved', 'Kalai', '₹7,500'])
    expect(t.totals?.at(-1)).toBe('₹7,740')
    expect(t.totals?.[0]).toBe('Total (excl. 1 inactive)')
  })
})
