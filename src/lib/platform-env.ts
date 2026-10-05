import 'server-only'

/**
 * StayFlow's own GST identity, printed on SaaS tax invoices.
 *
 * PLATFORM_GSTIN       — empty = not GST-registered: invoices carry no tax.
 * PLATFORM_LEGAL_NAME  — legal name as on the GST certificate.
 * PLATFORM_STATE_CODE  — 2-digit GST state code of the place of business
 *                        ('33' Tamil Nadu). Defaults to the GSTIN's first two digits.
 * PLATFORM_ADDRESS     — registered address (one line; use ' | ' for breaks).
 */
export const platformEnv = {
  get gstin() {
    return (process.env.PLATFORM_GSTIN ?? '').trim().toUpperCase()
  },
  get legalName() {
    return (process.env.PLATFORM_LEGAL_NAME ?? '').trim() || 'StayFlow'
  },
  get stateCode() {
    const explicit = (process.env.PLATFORM_STATE_CODE ?? '').trim()
    if (/^\d{2}$/.test(explicit)) return explicit
    const fromGstin = this.gstin.slice(0, 2)
    return /^\d{2}$/.test(fromGstin) ? fromGstin : ''
  },
  get address() {
    return (process.env.PLATFORM_ADDRESS ?? '').trim()
  },
  /** True when StayFlow charges GST on subscriptions. */
  get gstRegistered() {
    return this.gstin.length === 15
  },
}
