/**
 * Sales CRM vocabulary for platform leads (PG owners who asked for a demo).
 * Plain constants and pure helpers only, so both server pages and client
 * components can import them.
 */

export const LEAD_PIPELINE = [
  'NEW',
  'CONTACTED',
  'DEMO_SCHEDULED',
  'DEMO_COMPLETED',
  'TRIAL',
  'CONVERTED',
  'ACTIVE_CUSTOMER',
] as const

/** Side lanes: parked, dropped or not a fit. */
export const LEAD_SIDE = ['FOLLOW_UP', 'LOST', 'DISQUALIFIED'] as const

export const LEAD_STATUSES = [...LEAD_PIPELINE, ...LEAD_SIDE] as const
export type CrmLeadStatus = (typeof LEAD_STATUSES)[number]

/** A lead in one of these is finished — no follow-ups expected. */
export const CLOSED_LEAD_STATUSES: readonly string[] = ['CONVERTED', 'ACTIVE_CUSTOMER', 'LOST', 'DISQUALIFIED']

export const CRM_LEAD_STYLE: Record<string, { label: string; chip: string; dot: string }> = {
  NEW: { label: 'New', chip: 'bg-sky-50 text-sky-700 border-sky-200', dot: 'bg-sky-500' },
  CONTACTED: { label: 'Contacted', chip: 'bg-violet-50 text-violet-700 border-violet-200', dot: 'bg-violet-500' },
  DEMO_SCHEDULED: { label: 'Demo scheduled', chip: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
  DEMO_COMPLETED: { label: 'Demo done', chip: 'bg-indigo-50 text-indigo-700 border-indigo-200', dot: 'bg-indigo-500' },
  TRIAL: { label: 'On trial', chip: 'bg-cyan-50 text-cyan-700 border-cyan-200', dot: 'bg-cyan-500' },
  CONVERTED: { label: 'Converted', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  ACTIVE_CUSTOMER: { label: 'Active customer', chip: 'bg-green-50 text-green-700 border-green-200', dot: 'bg-green-600' },
  FOLLOW_UP: { label: 'Follow up later', chip: 'bg-orange-50 text-orange-700 border-orange-200', dot: 'bg-orange-500' },
  LOST: { label: 'Lost', chip: 'bg-slate-100 text-slate-500 border-slate-200', dot: 'bg-slate-400' },
  DISQUALIFIED: { label: 'Not a fit', chip: 'bg-slate-100 text-slate-500 border-slate-200', dot: 'bg-slate-300' },
}

export function leadStyle(status: string) {
  return CRM_LEAD_STYLE[status] ?? { label: status.toLowerCase(), chip: 'bg-slate-100 text-slate-600 border-slate-200', dot: 'bg-slate-400' }
}

export const LEAD_SOURCES = [
  { value: 'website', label: 'Website' },
  { value: 'referral', label: 'Referral' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'phone', label: 'Phone call' },
  { value: 'event', label: 'Event / field visit' },
  { value: 'ads', label: 'Ads' },
  { value: 'other', label: 'Other' },
] as const

export const LOST_REASONS = ['Price', 'Using another software', 'Too small', 'Not interested', 'No response', 'Other'] as const

export type FollowUpState = 'overdue' | 'today' | 'upcoming' | 'none'

/**
 * Where a lead's follow-up stands relative to `now` (local day boundaries):
 * before today → overdue, any time today → today, later → upcoming. Closed
 * leads and leads with no date are 'none'.
 */
export function followUpState(
  followUpAt: Date | string | null | undefined,
  now: Date = new Date(),
  status?: string,
): FollowUpState {
  if (!followUpAt) return 'none'
  if (status && CLOSED_LEAD_STATUSES.includes(status)) return 'none'
  const at = new Date(followUpAt)
  if (Number.isNaN(at.getTime())) return 'none'
  const dayStart = new Date(now)
  dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(now)
  dayEnd.setHours(23, 59, 59, 999)
  if (at < dayStart) return 'overdue'
  if (at <= dayEnd) return 'today'
  return 'upcoming'
}
