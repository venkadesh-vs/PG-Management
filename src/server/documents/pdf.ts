import 'server-only'

import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib'

/**
 * A deliberately small A4 document builder for invoices and receipts:
 * header band, two-column details, an itemised table, totals and a footer.
 * Standard PDF fonts have no ₹ glyph, so amounts are written as "Rs.".
 */

const A4 = { w: 595.28, h: 841.89 }
const M = 48
const INK = rgb(0.06, 0.09, 0.16)
const MUTED = rgb(0.39, 0.45, 0.55)
const LINE = rgb(0.89, 0.91, 0.94)
const BRAND = rgb(0.15, 0.39, 0.92)

export function rs(amount: number) {
  return `Rs. ${new Intl.NumberFormat('en-IN').format(amount)}`
}

/** Strips characters the standard WinAnsi fonts cannot encode. */
function safe(text: string) {
  return text.replace(/₹/g, 'Rs.').replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\x20-\x7E\xA0-\xFF]/g, '')
}

export type DocSpec = {
  title: string
  /** e.g. "Invoice INV-202610-0001" */
  reference: string
  issuer: { name: string; lines: string[] }
  billTo: { label: string; name: string; lines: string[] }
  meta: [string, string][]
  items: { label: string; qty?: number; amount: number }[]
  totals: [string, string, boolean?][]
  stamp?: { text: string; tone: 'paid' | 'due' | 'demo' }
  notes?: string[]
  footer: string
}

export async function renderDocument(spec: DocSpec): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(safe(`${spec.title} ${spec.reference}`))
  pdf.setProducer('StayFlow')
  let page = pdf.addPage([A4.w, A4.h])
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const text = (p: PDFPage, s: string, x: number, y: number, size = 10, f: PDFFont = font, color = INK) =>
    p.drawText(safe(s), { x, y, size, font: f, color })
  const right = (p: PDFPage, s: string, xRight: number, y: number, size = 10, f: PDFFont = font, color = INK) =>
    text(p, s, xRight - f.widthOfTextAtSize(safe(s), size), y, size, f, color)

  // Header band
  page.drawRectangle({ x: 0, y: A4.h - 6, width: A4.w, height: 6, color: BRAND })
  let y = A4.h - M - 4
  text(page, spec.issuer.name, M, y, 16, bold)
  right(page, spec.title.toUpperCase(), A4.w - M, y, 16, bold, BRAND)
  y -= 16
  right(page, spec.reference, A4.w - M, y, 10, font, MUTED)
  for (const line of spec.issuer.lines) {
    text(page, line, M, y, 9, font, MUTED)
    y -= 12
  }

  // Bill-to and meta
  y -= 16
  const top = y
  text(page, spec.billTo.label.toUpperCase(), M, y, 8, bold, MUTED)
  y -= 14
  text(page, spec.billTo.name, M, y, 11, bold)
  for (const line of spec.billTo.lines) {
    y -= 13
    text(page, line, M, y, 9, font, MUTED)
  }
  let my = top
  for (const [k, v] of spec.meta) {
    right(page, k, A4.w - M - 120, my, 9, font, MUTED)
    right(page, v, A4.w - M, my, 9, bold)
    my -= 14
  }
  y = Math.min(y, my) - 24

  // Items table
  page.drawRectangle({ x: M, y: y - 6, width: A4.w - 2 * M, height: 22, color: rgb(0.97, 0.98, 0.99) })
  text(page, 'DESCRIPTION', M + 8, y, 8, bold, MUTED)
  right(page, 'QTY', A4.w - M - 110, y, 8, bold, MUTED)
  right(page, 'AMOUNT', A4.w - M - 8, y, 8, bold, MUTED)
  y -= 24
  // Long documents (a settlement with many lines) continue on a new page.
  const room = (needed: number) => {
    if (y - needed > M + 30) return
    page = pdf.addPage([A4.w, A4.h])
    page.drawRectangle({ x: 0, y: A4.h - 6, width: A4.w, height: 6, color: BRAND })
    y = A4.h - M
    text(page, `${spec.title} ${spec.reference} (continued)`, M, y, 9, font, MUTED)
    y -= 24
  }
  for (const item of spec.items) {
    room(24)
    text(page, item.label.slice(0, 80), M + 8, y, 10)
    right(page, String(item.qty ?? 1), A4.w - M - 110, y, 10)
    right(page, rs(item.amount), A4.w - M - 8, y, 10)
    y -= 8
    page.drawLine({ start: { x: M, y }, end: { x: A4.w - M, y }, thickness: 0.6, color: LINE })
    y -= 14
  }

  // Totals
  y -= 4
  room(spec.totals.length * 16 + 40)
  for (const [label, value, strong] of spec.totals) {
    right(page, label, A4.w - M - 120, y, strong ? 11 : 10, strong ? bold : font, strong ? INK : MUTED)
    right(page, value, A4.w - M - 8, y, strong ? 11 : 10, strong ? bold : font)
    y -= 16
  }

  // Stamp
  if (spec.stamp) {
    const color = spec.stamp.tone === 'paid' ? rgb(0.02, 0.59, 0.41) : spec.stamp.tone === 'demo' ? rgb(0.85, 0.47, 0.02) : rgb(0.86, 0.15, 0.15)
    const w = bold.widthOfTextAtSize(spec.stamp.text, 14) + 20
    page.drawRectangle({ x: M, y: y + 2, width: w, height: 26, borderColor: color, borderWidth: 1.5, color: rgb(1, 1, 1) })
    text(page, spec.stamp.text, M + 10, y + 10, 14, bold, color)
    y -= 20
  }

  // Notes
  if (spec.notes?.length) {
    y -= 16
    for (const note of spec.notes) {
      room(14)
      text(page, note.slice(0, 110), M, y, 9, font, MUTED)
      y -= 13
    }
  }

  // Footer (last page)
  page.drawLine({ start: { x: M, y: M + 18 }, end: { x: A4.w - M, y: M + 18 }, thickness: 0.6, color: LINE })
  text(page, spec.footer, M, M, 8, font, MUTED)

  return pdf.save()
}
