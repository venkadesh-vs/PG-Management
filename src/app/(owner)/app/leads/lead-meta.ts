/**
 * Client-safe labels and colours for the enquiry pipeline and bookings.
 * (The services hold the rules; this only describes how things look.)
 */

export type LeadStatus =
  | 'NEW'
  | 'CONTACTED'
  | 'VISIT_SCHEDULED'
  | 'VISITED'
  | 'INTERESTED'
  | 'TOKEN_PAID'
  | 'BOOKED'
  | 'CHECKED_IN'
  | 'LOST'

export const PIPELINE: { status: LeadStatus; label: string; dot: string; chip: string; column: string }[] = [
  { status: 'NEW', label: 'New', dot: 'bg-sky-500', chip: 'bg-sky-50 text-sky-700 border-sky-200', column: 'from-sky-50/80' },
  { status: 'CONTACTED', label: 'Contacted', dot: 'bg-violet-500', chip: 'bg-violet-50 text-violet-700 border-violet-200', column: 'from-violet-50/80' },
  { status: 'VISIT_SCHEDULED', label: 'Visit scheduled', dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-700 border-amber-200', column: 'from-amber-50/80' },
  { status: 'VISITED', label: 'Visited', dot: 'bg-orange-500', chip: 'bg-orange-50 text-orange-700 border-orange-200', column: 'from-orange-50/80' },
  { status: 'INTERESTED', label: 'Interested', dot: 'bg-indigo-500', chip: 'bg-indigo-50 text-indigo-700 border-indigo-200', column: 'from-indigo-50/80' },
  { status: 'TOKEN_PAID', label: 'Token paid', dot: 'bg-teal-500', chip: 'bg-teal-50 text-teal-700 border-teal-200', column: 'from-teal-50/80' },
  { status: 'BOOKED', label: 'Booked', dot: 'bg-blue-600', chip: 'bg-blue-50 text-blue-700 border-blue-200', column: 'from-blue-50/80' },
  { status: 'CHECKED_IN', label: 'Checked in', dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200', column: 'from-emerald-50/80' },
  { status: 'LOST', label: 'Lost', dot: 'bg-slate-400', chip: 'bg-slate-100 text-slate-500 border-slate-200', column: 'from-slate-100/80' },
]

export const STATUS_META = Object.fromEntries(PIPELINE.map((p) => [p.status, p])) as Record<
  LeadStatus,
  (typeof PIPELINE)[number]
>

/** Statuses only bookings / check-in can set — not drop targets. */
export const SYSTEM_STATUSES: LeadStatus[] = ['TOKEN_PAID', 'BOOKED', 'CHECKED_IN']

export const SOURCES = [
  { value: 'PHONE', label: 'Phone call' },
  { value: 'WALK_IN', label: 'Walk-in' },
  { value: 'WHATSAPP', label: 'WhatsApp' },
  { value: 'WEBSITE', label: 'Website' },
  { value: 'REFERRAL', label: 'Referral' },
  { value: 'PORTAL', label: 'Listing portal' },
  { value: 'OTHER', label: 'Other' },
] as const

export const SOURCE_LABEL: Record<string, string> = Object.fromEntries(SOURCES.map((s) => [s.value, s.label]))

export const LOST_REASONS = ['Price', 'Location', 'Competitor', 'No availability', 'Not interested', 'Other'] as const

export const ROOM_PREFS = [
  { value: '', label: 'No preference' },
  { value: 'SINGLE', label: 'Single' },
  { value: 'DOUBLE', label: 'Double sharing' },
  { value: 'TRIPLE', label: 'Triple sharing' },
  { value: 'QUAD', label: 'Four sharing' },
  { value: 'DORM', label: 'Dorm' },
]

export const BOOKING_STATUS: Record<string, { label: string; chip: string; dot: string }> = {
  PENDING: { label: 'Pending', chip: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
  CONFIRMED: { label: 'Confirmed', chip: 'bg-blue-50 text-blue-700 border-blue-200', dot: 'bg-blue-600' },
  CHECKED_IN: { label: 'Checked in', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  CANCELLED: { label: 'Cancelled', chip: 'bg-slate-100 text-slate-500 border-slate-200', dot: 'bg-slate-400' },
  EXPIRED: { label: 'Expired', chip: 'bg-red-50 text-red-700 border-red-200', dot: 'bg-red-500' },
}

export const TOKEN_METHODS = [
  { value: 'UPI', label: 'UPI' },
  { value: 'CASH', label: 'Cash' },
  { value: 'BANK_TRANSFER', label: 'Bank transfer' },
  { value: 'CARD', label: 'Card' },
  { value: 'CHEQUE', label: 'Cheque' },
] as const

/** wa.me wants the country code and digits only. */
export function whatsappLink(phone: string, text?: string) {
  const digits = phone.replace(/\D/g, '')
  const full = digits.length === 10 ? `91${digits}` : digits
  return `https://wa.me/${full}${text ? `?text=${encodeURIComponent(text)}` : ''}`
}

export function telLink(phone: string) {
  const digits = phone.replace(/\D/g, '')
  return `tel:${digits.length === 10 ? `+91${digits}` : `+${digits}`}`
}

/** For <input type="datetime-local">. */
export function toLocalInput(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** A serialisable lead as the board renders it. */
export type LeadCardData = {
  id: string
  name: string
  phone: string
  email: string | null
  status: LeadStatus
  source: string
  budget: number | null
  moveInDate: string | null
  nextFollowUpAt: string | null
  visitAt: string | null
  lostReason: string | null
  roomTypePref: string | null
  property: { id: string; name: string } | null
  updatedAt: string
  createdAt: string
}
