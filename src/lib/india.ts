/**
 * Indian formats, shared by the inputs (src/components/ui/india-inputs.tsx),
 * the Zod schemas and the services, so a value the form accepts is a value
 * the server accepts.
 */

export const INDIA = {
  /** 10-digit mobile, starting 6–9. */
  mobile: /^[6-9]\d{9}$/,
  pincode: /^[1-9]\d{5}$/,
  aadhaar: /^[2-9]\d{11}$/,
  pan: /^[A-Z]{5}\d{4}[A-Z]$/,
  gstin: /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/,
  ifsc: /^[A-Z]{4}0[A-Z0-9]{6}$/,
  accountNumber: /^\d{9,18}$/,
  upi: /^[a-zA-Z0-9.\-_]{2,}@[a-zA-Z]{2,}$/,
  passport: /^[A-Z][0-9]{7}$/,
  voterId: /^[A-Z]{3}\d{7}$/,
  drivingLicence: /^[A-Z]{2}\d{2}[ -]?\d{4}\d{7}$/,
} as const

export const INDIA_MESSAGE = {
  mobile: 'Enter a valid 10-digit mobile number',
  pincode: 'PIN code must be 6 digits',
  aadhaar: 'Aadhaar number must be 12 digits',
  pan: 'Enter a valid PAN, like ABCDE1234F',
  gstin: 'Enter a valid 15-character GSTIN',
  ifsc: 'Enter a valid IFSC, like SBIN0001234',
  accountNumber: 'Account number must be 9–18 digits',
  upi: 'Enter a UPI ID like name@okaxis',
} as const

/** The rule for a government ID, by its type (the ID_TYPE lookup values). */
export function idNumberRule(idType: string | null | undefined): { re: RegExp; message: string; clean: (raw: string) => string } | null {
  const upper = (max: number) => (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, max)
  switch ((idType ?? '').toUpperCase().replace(/[\s-]+/g, '_')) {
    case 'AADHAAR':
    case 'AADHAR':
      return { re: INDIA.aadhaar, message: INDIA_MESSAGE.aadhaar, clean: (raw) => raw.replace(/\D/g, '').slice(0, 12) }
    case 'PAN':
    case 'PAN_CARD':
      return { re: INDIA.pan, message: INDIA_MESSAGE.pan, clean: upper(10) }
    case 'PASSPORT':
      return { re: INDIA.passport, message: 'Passport number is 1 letter and 7 digits, like K1234567', clean: upper(8) }
    case 'VOTER_ID':
      return { re: INDIA.voterId, message: 'Voter ID is 3 letters and 7 digits, like ABC1234567', clean: upper(10) }
    default:
      return null
  }
}

/** Error message for an ID number of this type, or null when it is fine (or empty). */
export function idNumberProblem(idType: string | null | undefined, idNumber: string | null | undefined) {
  const value = (idNumber ?? '').trim()
  if (!value) return null
  const rule = idNumberRule(idType)
  if (!rule) return null
  return rule.re.test(rule.clean(value)) ? null : rule.message
}

/** How the ID number box should look for a type: placeholder, length, keypad. Null = free text. */
export function idNumberFormat(idType: string | null | undefined) {
  const t = (idType ?? '').toUpperCase()
  if (!idNumberRule(t)) return null
  if (t.startsWith('AADH')) return { placeholder: '12-digit Aadhaar number', maxLength: 12, numeric: true }
  if (t.startsWith('PAN')) return { placeholder: 'ABCDE1234F', maxLength: 10, numeric: false }
  if (t === 'PASSPORT') return { placeholder: 'K1234567', maxLength: 8, numeric: false }
  return { placeholder: 'ABC1234567', maxLength: 10, numeric: false }
}
