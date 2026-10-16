import 'server-only'

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage, type RGB } from 'pdf-lib'
import { platformEnv } from '@/lib/platform-env'
import { getPlatformPaymentDetails } from '@/server/services/owner-billing'

/**
 * StayFlow's PDF documents (invoices, receipts, settlements) and PDF reports
 * (every list export), on one design:
 *
 *   ┌ brand band ───────────────────────────────────────────────┐
 *   │ PG name (large)                         DOCUMENT TITLE     │
 *   │ PG address                              reference · status │
 *   │ Operated by <business> · phone · GSTIN                     │
 *   ├────────────────────────────────────────────────────────────┤
 *   │ body                                                       │
 *   ├────────────────────────────────────────────────────────────┤
 *   │ <company> · address · email · phone            Page 1 of 2 │
 *   │ © 2026 <company>. All rights reserved.                     │
 *   └────────────────────────────────────────────────────────────┘
 *
 * Noto Sans is embedded (subset) so ₹ and © print properly; if the font
 * files cannot be read, Helvetica is used and ₹ is written as "Rs.".
 */

const A4 = { w: 595.28, h: 841.89 }
const M = 44
const INK = rgb(0.06, 0.09, 0.16)
const MUTED = rgb(0.39, 0.45, 0.55)
const FAINT = rgb(0.58, 0.63, 0.7)
const LINE = rgb(0.89, 0.91, 0.94)
const SOFT = rgb(0.965, 0.973, 0.984)
const BRAND = rgb(0.15, 0.39, 0.92)
const BRAND_SOFT = rgb(0.93, 0.95, 1)
const GOLD = rgb(0.85, 0.65, 0.2)
const FOOTER_H = 46

export function rs(amount: number) {
  const sign = amount < 0 ? '- ' : ''
  return `${sign}₹${new Intl.NumberFormat('en-IN').format(Math.abs(amount))}`
}

type Fonts = { font: PDFFont; bold: PDFFont; unicode: boolean }

const FONT_DIR = path.join(process.cwd(), 'src', 'server', 'documents', 'fonts')
let fontBytes: Promise<[Uint8Array, Uint8Array] | null> | null = null

async function loadFonts(pdf: PDFDocument): Promise<Fonts> {
  fontBytes ??= Promise.all([readFile(path.join(FONT_DIR, 'NotoSans-Regular.ttf')), readFile(path.join(FONT_DIR, 'NotoSans-Bold.ttf'))]).catch((error) => {
    console.error('[pdf] Noto Sans not found, falling back to Helvetica', error)
    return null
  })
  const bytes = await fontBytes
  if (bytes) {
    pdf.registerFontkit(fontkit)
    return { font: await pdf.embedFont(bytes[0]), bold: await pdf.embedFont(bytes[1]), unicode: true }
  }
  return { font: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold), unicode: false }
}

/** Text the font can draw: everything with Noto; WinAnsi only (₹ → Rs.) with Helvetica. */
function cleaner(unicode: boolean) {
  return (text: string) => {
    const s = String(text ?? '').replace(/[\r\n\t]+/g, ' ')
    if (unicode) return s.replace(/(?![©®™])\p{Extended_Pictographic}/gu, '').replace(/[^\p{L}\p{M}\p{N}\p{P}\p{S}\p{Zs}]/gu, '')
    return s.replace(/₹/g, 'Rs.').replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\x20-\x7E\xA0-\xFF]/g, '')
  }
}

/** StayFlow's own company details, for every footer. */
export async function platformCompany() {
  const details = await getPlatformPaymentDetails().catch(() => null)
  const contact = [details?.supportEmail, details?.supportWhatsapp ? `+91 ${details.supportWhatsapp.replace(/\D/g, '').slice(-10)}` : null].filter(Boolean)
  return {
    name: platformEnv.legalName,
    address: platformEnv.address.split('|').map((l) => l.trim()).filter(Boolean).join(', '),
    contact: contact.join(' · '),
    gstin: platformEnv.gstin,
  }
}

export type Party = { label?: string; name: string; lines: string[] }

type Canvas = {
  pdf: PDFDocument
  fonts: Fonts
  clean: (s: string) => string
  w: number
  h: number
  text: (p: PDFPage, s: string, x: number, y: number, size?: number, f?: PDFFont, color?: RGB) => void
  right: (p: PDFPage, s: string, xRight: number, y: number, size?: number, f?: PDFFont, color?: RGB) => void
  width: (s: string, size: number, f?: PDFFont) => number
  fit: (s: string, maxWidth: number, size: number, f?: PDFFont) => string
}

function canvas(pdf: PDFDocument, fonts: Fonts, size: { w: number; h: number }): Canvas {
  const clean = cleaner(fonts.unicode)
  const width = (s: string, sz: number, f: PDFFont = fonts.font) => f.widthOfTextAtSize(clean(s), sz)
  const fit = (s: string, maxWidth: number, sz: number, f: PDFFont = fonts.font) => {
    let t = clean(s)
    if (f.widthOfTextAtSize(t, sz) <= maxWidth) return t
    while (t.length > 1 && f.widthOfTextAtSize(`${t}…`, sz) > maxWidth) t = t.slice(0, -1)
    return `${t.trimEnd()}…`
  }
  const text: Canvas['text'] = (p, s, x, y, sz = 10, f = fonts.font, color = INK) => {
    const t = clean(s)
    if (t) p.drawText(t, { x, y, size: sz, font: f, color })
  }
  const right: Canvas['right'] = (p, s, xRight, y, sz = 10, f = fonts.font, color = INK) => text(p, s, xRight - width(s, sz, f), y, sz, f, color)
  return { pdf, fonts, clean, w: size.w, h: size.h, text, right, width, fit }
}

/**
 * The letterhead: the PG (or company) on the left, the document title on the
 * right, the owning business underneath. Returns the y below it.
 */
function letterhead(
  c: Canvas,
  page: PDFPage,
  head: { issuer: Party; business?: Party; title: string; reference: string; status?: string },
) {
  const { w, h, fonts } = c
  page.drawRectangle({ x: 0, y: h - 8, width: w, height: 8, color: BRAND })
  page.drawRectangle({ x: 0, y: h - 10, width: w, height: 2, color: GOLD })
  let y = h - M - 6
  const leftW = w * 0.55
  if (head.issuer.label) {
    c.text(page, head.issuer.label.toUpperCase(), M, y + 19, 7.5, fonts.bold, BRAND)
  }
  c.text(page, c.fit(head.issuer.name, leftW, 18, fonts.bold), M, y, 18, fonts.bold)
  c.right(page, head.title.toUpperCase(), w - M, y + 2, 15, fonts.bold, BRAND)
  c.right(page, head.reference, w - M, y - 14, 9.5, fonts.font, MUTED)
  if (head.status) {
    const label = head.status.toUpperCase()
    const tw = c.width(label, 7.5, fonts.bold) + 14
    page.drawRectangle({ x: w - M - tw, y: y - 36, width: tw, height: 15, color: BRAND_SOFT })
    c.text(page, label, w - M - tw + 7, y - 31.5, 7.5, fonts.bold, BRAND)
  }
  y -= 16
  for (const line of head.issuer.lines.filter(Boolean)) {
    c.text(page, c.fit(line, leftW, 9), M, y, 9, fonts.font, MUTED)
    y -= 12
  }
  if (head.business) {
    y -= 4
    const label = `${head.business.label ?? 'Operated by'}  `
    c.text(page, label, M, y, 8.5, fonts.font, FAINT)
    c.text(page, c.fit(head.business.name, leftW - c.width(label, 8.5), 9, fonts.bold), M + c.width(label, 8.5), y, 9, fonts.bold)
    y -= 12
    for (const line of head.business.lines.filter(Boolean)) {
      c.text(page, c.fit(line, leftW, 8.5), M, y, 8.5, fonts.font, MUTED)
      y -= 11
    }
  }
  y = Math.min(y, h - M - 50) - 8
  page.drawLine({ start: { x: M, y }, end: { x: w - M, y }, thickness: 0.8, color: LINE })
  return y - 22
}

/** Footer on every page: company, ©, generated note and page numbers. */
function footers(c: Canvas, company: Awaited<ReturnType<typeof platformCompany>>, note: string) {
  const pages = c.pdf.getPages()
  const year = new Date().getFullYear()
  const companyLine = [company.name, company.address, company.contact, company.gstin ? `GSTIN ${company.gstin}` : ''].filter(Boolean).join('  ·  ')
  pages.forEach((page, i) => {
    const { width: pw } = page.getSize()
    page.drawRectangle({ x: 0, y: 0, width: pw, height: FOOTER_H, color: SOFT })
    page.drawLine({ start: { x: 0, y: FOOTER_H }, end: { x: pw, y: FOOTER_H }, thickness: 0.6, color: LINE })
    const pageLabel = `Page ${i + 1} of ${pages.length}`
    const room = pw - 2 * M - c.width(pageLabel, 7.5) - 16
    c.text(page, c.fit(note, room, 7.5), M, FOOTER_H - 14, 7.5, c.fonts.font, MUTED)
    c.right(page, pageLabel, pw - M, FOOTER_H - 14, 7.5, c.fonts.bold, MUTED)
    c.text(page, c.fit(companyLine, pw - 2 * M, 7.5), M, FOOTER_H - 26, 7.5, c.fonts.font, FAINT)
    const copy = c.fonts.unicode ? `© ${year} ${company.name}. All rights reserved.` : `(c) ${year} ${company.name}. All rights reserved.`
    c.text(page, copy, M, FOOTER_H - 38, 7.5, c.fonts.bold, FAINT)
  })
}

// --------------------------------------------------------------------------
// Documents: invoice, receipt, settlement
// --------------------------------------------------------------------------

export type DocSpec = {
  title: string
  /** e.g. "INV-202610-0001" */
  reference: string
  /** Top-left: the PG for rent documents, StayFlow for its own invoices. */
  issuer: Party
  /** The business behind it ("Operated by …", or "For PG …"). */
  business?: Party
  billTo: Party & { label: string }
  meta: [string, string][]
  items: { label: string; qty?: number; amount: number }[]
  totals: [string, string, boolean?][]
  stamp?: { text: string; tone: 'paid' | 'due' | 'demo' }
  notes?: string[]
  footer: string
}

export async function renderDocument(spec: DocSpec): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const fonts = await loadFonts(pdf)
  const c = canvas(pdf, fonts, A4)
  pdf.setTitle(c.clean(`${spec.title} ${spec.reference} · ${spec.issuer.name}`))
  pdf.setAuthor(c.clean(spec.business?.name ?? spec.issuer.name))
  pdf.setProducer('StayFlow')
  pdf.setCreator('StayFlow')
  const company = await platformCompany()
  const { font, bold } = fonts
  const { w } = c

  let page = pdf.addPage([A4.w, A4.h])
  let y = letterhead(c, page, { issuer: spec.issuer, business: spec.business, title: spec.title, reference: spec.reference, status: spec.stamp?.text })

  // Bill-to card (left) and details card (right)
  const colW = (w - 2 * M - 16) / 2
  const billLines = spec.billTo.lines.filter(Boolean)
  const cardH = Math.max(34 + billLines.length * 12 + 6, 18 + spec.meta.length * 15 + 6)
  page.drawRectangle({ x: M, y: y - cardH + 12, width: colW, height: cardH, color: SOFT })
  page.drawRectangle({ x: M + colW + 16, y: y - cardH + 12, width: colW, height: cardH, color: SOFT })
  let by = y - 4
  c.text(page, spec.billTo.label.toUpperCase(), M + 12, by, 7.5, bold, BRAND)
  by -= 16
  c.text(page, c.fit(spec.billTo.name, colW - 24, 11.5, bold), M + 12, by, 11.5, bold)
  for (const line of billLines) {
    by -= 12
    c.text(page, c.fit(line, colW - 24, 9), M + 12, by, 9, font, MUTED)
  }
  let my = y - 4
  c.text(page, 'DETAILS', M + colW + 28, my, 7.5, bold, BRAND)
  my -= 16
  for (const [k, v] of spec.meta) {
    c.text(page, k, M + colW + 28, my, 9, font, MUTED)
    c.right(page, c.fit(v, colW * 0.6, 9, bold), w - M - 12, my, 9, bold)
    my -= 15
  }
  y = y - cardH - 10

  // Items table
  const header = (yy: number) => {
    page.drawRectangle({ x: M, y: yy - 7, width: w - 2 * M, height: 22, color: INK })
    c.text(page, 'DESCRIPTION', M + 10, yy, 7.5, bold, rgb(1, 1, 1))
    c.right(page, 'QTY', w - M - 120, yy, 7.5, bold, rgb(1, 1, 1))
    c.right(page, 'AMOUNT', w - M - 10, yy, 7.5, bold, rgb(1, 1, 1))
    return yy - 24
  }
  const room = (needed: number) => {
    if (y - needed > FOOTER_H + 24) return false
    page = pdf.addPage([A4.w, A4.h])
    y = letterhead(c, page, { issuer: spec.issuer, title: spec.title, reference: `${spec.reference} (continued)` })
    return true
  }
  y = header(y)
  spec.items.forEach((item, i) => {
    if (room(22)) y = header(y)
    if (i % 2 === 1) page.drawRectangle({ x: M, y: y - 7, width: w - 2 * M, height: 21, color: SOFT })
    c.text(page, c.fit(item.label, w - 2 * M - 180, 9.5), M + 10, y, 9.5)
    c.right(page, String(item.qty ?? 1), w - M - 120, y, 9.5, font, MUTED)
    c.right(page, rs(item.amount), w - M - 10, y, 9.5)
    y -= 21
  })
  page.drawLine({ start: { x: M, y: y + 13 }, end: { x: w - M, y: y + 13 }, thickness: 0.8, color: LINE })

  // Totals, right-aligned; the strong rows on a brand panel
  y -= 6
  room(spec.totals.length * 20 + 30)
  const tx = w - M - 230
  for (const [label, value, strong] of spec.totals) {
    if (strong) {
      page.drawRectangle({ x: tx - 10, y: y - 8, width: w - M - tx + 10, height: 24, color: BRAND_SOFT })
      c.text(page, label, tx, y, 10.5, bold, INK)
      c.right(page, value, w - M - 10, y, 12, bold, BRAND)
      y -= 26
    } else {
      c.text(page, label, tx, y, 9.5, font, MUTED)
      c.right(page, value, w - M - 10, y, 9.5, font)
      y -= 18
    }
  }

  // Stamp
  if (spec.stamp) {
    const color = spec.stamp.tone === 'paid' ? rgb(0.02, 0.59, 0.41) : spec.stamp.tone === 'demo' ? rgb(0.85, 0.47, 0.02) : rgb(0.86, 0.15, 0.15)
    const sw = c.width(spec.stamp.text, 14, bold) + 24
    const sy = y + spec.totals.length * 18
    page.drawRectangle({ x: M, y: sy - 2, width: sw, height: 30, borderColor: color, borderWidth: 1.8, color: rgb(1, 1, 1), opacity: 0.9 })
    c.text(page, spec.stamp.text, M + 12, sy + 8, 14, bold, color)
  }

  // Notes
  if (spec.notes?.length) {
    y -= 10
    room(30)
    c.text(page, 'NOTES', M, y, 7.5, bold, BRAND)
    y -= 14
    for (const note of spec.notes) {
      room(14)
      c.text(page, c.fit(note, w - 2 * M, 8.5), M, y, 8.5, font, MUTED)
      y -= 12
    }
  }

  footers(c, company, spec.footer)
  return pdf.save()
}

// --------------------------------------------------------------------------
// Reports: any list export as a landscape table
// --------------------------------------------------------------------------

export type ReportSpec = {
  title: string
  /** The owner's business. */
  business: Party
  /** Which PG(s) the report covers, e.g. "Sri Balaji Men's PG" or "All PGs (3)". */
  pgLabel: string
  /** Extra context lines: period, filters. */
  context: string[]
  columns: string[]
  rows: (string | number | null | undefined)[][]
  generatedBy: string
}

const LANDSCAPE = { w: A4.h, h: A4.w }

export async function renderReport(spec: ReportSpec): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const fonts = await loadFonts(pdf)
  const c = canvas(pdf, fonts, LANDSCAPE)
  pdf.setTitle(c.clean(`${spec.title} · ${spec.pgLabel}`))
  pdf.setAuthor(c.clean(spec.business.name))
  pdf.setProducer('StayFlow')
  pdf.setCreator('StayFlow')
  const company = await platformCompany()
  const { font, bold } = fonts
  const { w } = c

  const cells = spec.rows.map((r) => r.map((v) => (v === null || v === undefined ? '' : typeof v === 'number' ? new Intl.NumberFormat('en-IN').format(v) : String(v))))
  // Amounts and counts align right; phone numbers and long ids (6+ plain digits) stay left.
  const numeric = spec.columns.map((_, i) => cells.length > 0 && cells.every((r) => r[i] === '' || (/^-?[\d,]+(\.\d+)?$/.test(r[i]) && !/^\d{6,}$/.test(r[i]))))

  // Column widths from content, scaled to the page; long text is truncated.
  const size = spec.columns.length > 12 ? 6.8 : spec.columns.length > 8 ? 7.5 : 8.5
  const avail = w - 2 * M
  const natural = spec.columns.map((col, i) => {
    const sample = cells.slice(0, 300).map((r) => c.width(r[i] ?? '', size))
    const longest = Math.max(c.width(col, size - 0.5, bold), ...sample, 20)
    return Math.min(longest + 10, avail * 0.32)
  })
  const total = natural.reduce((s, x) => s + x, 0)
  const widths = natural.map((x) => (x * avail) / total)

  let page = pdf.addPage([LANDSCAPE.w, LANDSCAPE.h])
  const head = () =>
    letterhead(c, page, {
      issuer: { label: 'PG', name: spec.pgLabel, lines: spec.context },
      business: spec.business,
      title: spec.title,
      reference: `${cells.length} ${cells.length === 1 ? 'record' : 'records'}`,
    })
  let y = head()
  const tableHeader = () => {
    const hh = 20
    page.drawRectangle({ x: M, y: y - hh + 13, width: avail, height: hh, color: INK })
    let x = M
    spec.columns.forEach((col, i) => {
      const label = c.fit(col.toUpperCase(), widths[i] - 8, size - 0.8, bold)
      if (numeric[i]) c.right(page, label, x + widths[i] - 4, y, size - 0.8, bold, rgb(1, 1, 1))
      else c.text(page, label, x + 4, y, size - 0.8, bold, rgb(1, 1, 1))
      x += widths[i]
    })
    y -= hh + 2
  }
  tableHeader()
  const rowH = size + 8
  if (!cells.length) {
    c.text(page, 'No records for this selection.', M + 4, y - 4, 10, font, MUTED)
  }
  cells.forEach((row, r) => {
    if (y - rowH < FOOTER_H + 16) {
      page = pdf.addPage([LANDSCAPE.w, LANDSCAPE.h])
      y = head()
      tableHeader()
    }
    if (r % 2 === 1) page.drawRectangle({ x: M, y: y - rowH + size + 3, width: avail, height: rowH, color: SOFT })
    let x = M
    row.forEach((cell, i) => {
      const t = c.fit(cell, widths[i] - 8, size)
      if (numeric[i]) c.right(page, t, x + widths[i] - 4, y, size, font)
      else c.text(page, t, x + 4, y, size, font)
      x += widths[i]
    })
    y -= rowH
  })
  page.drawLine({ start: { x: M, y: y + size + 3 }, end: { x: w - M, y: y + size + 3 }, thickness: 0.8, color: LINE })

  footers(c, company, `${spec.title} · generated by ${spec.generatedBy} on ${new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} · StayFlow`)
  return pdf.save()
}
