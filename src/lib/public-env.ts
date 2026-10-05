/**
 * Values that are safe to render in the browser.
 *
 * Kept in its own module so client components never import `lib/env.ts`,
 * which also holds the server-only secrets accessor.
 *
 * Next inlines `process.env.NEXT_PUBLIC_*` at build time, so each one must be
 * referenced as a full literal expression rather than looked up dynamically.
 */
export const publicEnv = {
  appName: process.env.NEXT_PUBLIC_APP_NAME || 'StayFlow',
  businessWhatsapp: process.env.NEXT_PUBLIC_BUSINESS_WHATSAPP || '',
  contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL || 'hello@stayflow.app',
  contactPhone: process.env.NEXT_PUBLIC_CONTACT_PHONE || '',
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
  // Business identity for legal pages and invoices (Razorpay and the DPDP Act
  // require a real legal entity, address and grievance contact).
  legalName: process.env.NEXT_PUBLIC_LEGAL_NAME || '',
  businessAddress: process.env.NEXT_PUBLIC_BUSINESS_ADDRESS || '',
  jurisdictionCity: process.env.NEXT_PUBLIC_JURISDICTION_CITY || '',
  grievanceOfficer: process.env.NEXT_PUBLIC_GRIEVANCE_OFFICER || '',
  grievanceEmail: process.env.NEXT_PUBLIC_GRIEVANCE_EMAIL || '',
  analyticsProvider: process.env.NEXT_PUBLIC_ANALYTICS_PROVIDER || '',
  analyticsDomain: process.env.NEXT_PUBLIC_ANALYTICS_DOMAIN || '',
  analyticsScript: process.env.NEXT_PUBLIC_ANALYTICS_SCRIPT || '',
}

/** Builds a wa.me link with a pre-filled message, or null when unconfigured. */
export function whatsappLink(message: string, phone?: string): string | null {
  const number = (phone || publicEnv.businessWhatsapp).replace(/\D/g, '')
  if (!number) return null
  const withCode = number.length === 10 ? `91${number}` : number
  return `https://wa.me/${withCode}?text=${encodeURIComponent(message)}`
}
