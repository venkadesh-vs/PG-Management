/**
 * GST for StayFlow's SaaS invoices (SAC 998314 — IT infrastructure / hosting
 * services, 18%). Pure functions so the billing service and the tax-invoice
 * PDF compute exactly the same split.
 *
 * Intra-state supply (client state = platform state) → CGST 9% + SGST 9%.
 * Inter-state → IGST 18%. Unregistered platform → no tax.
 */

export const SAAS_SAC = '998314'
export const SAAS_GST_RATE = 18

/** GST state codes (as used in the first two digits of a GSTIN). */
export const GST_STATE_CODES: Record<string, string> = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
}

const normalise = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z]/g, '')

const ALIASES: Record<string, string> = {
  tn: '33',
  newdelhi: '07',
  orissa: '21',
  pondicherry: '34',
  jandk: '01',
  jammukashmir: '01',
  ap: '37',
  ka: '29',
  mh: '27',
  ts: '36',
  up: '09',
  wb: '19',
}

/** State code for a recipient: GSTIN prefix first, else the state name. */
export function stateCodeFor(params: { gstin?: string | null; state?: string | null }): string | null {
  const prefix = params.gstin?.trim().slice(0, 2)
  if (prefix && GST_STATE_CODES[prefix]) return prefix
  if (!params.state) return null
  const key = normalise(params.state)
  if (ALIASES[key]) return ALIASES[key]
  const match = Object.entries(GST_STATE_CODES).find(([, name]) => normalise(name) === key)
  return match?.[0] ?? null
}

export type GstSplit = {
  taxable: number
  rate: number
  cgst: number
  sgst: number
  igst: number
  tax: number
  total: number
  intraState: boolean
  /** Two-digit state code used as the place of supply. */
  placeOfSupply: string | null
}

/**
 * Splits GST on a taxable value (whole rupees). When the recipient's state is
 * unknown the supply is treated as intra-state (same state as the platform).
 */
export function computeGst(params: {
  taxable: number
  registered: boolean
  platformStateCode: string
  recipient: { gstin?: string | null; state?: string | null }
}): GstSplit {
  const recipientState = stateCodeFor(params.recipient)
  const placeOfSupply = recipientState ?? (params.platformStateCode || null)
  if (!params.registered) {
    return {
      taxable: params.taxable,
      rate: 0,
      cgst: 0,
      sgst: 0,
      igst: 0,
      tax: 0,
      total: params.taxable,
      intraState: true,
      placeOfSupply,
    }
  }
  const tax = Math.round((params.taxable * SAAS_GST_RATE) / 100)
  const intraState = !recipientState || recipientState === params.platformStateCode
  const cgst = intraState ? Math.round(tax / 2) : 0
  const sgst = intraState ? tax - cgst : 0
  return {
    taxable: params.taxable,
    rate: SAAS_GST_RATE,
    cgst,
    sgst,
    igst: intraState ? 0 : tax,
    tax,
    total: params.taxable + tax,
    intraState,
    placeOfSupply,
  }
}

/** Indian financial year label for a date: Apr 2026 – Mar 2027 → "26-27". */
export function financialYear(date: Date) {
  const start = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1
  return `${String(start).slice(-2)}-${String(start + 1).slice(-2)}`
}
