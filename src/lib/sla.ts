import { z } from 'zod'

/**
 * Complaint SLA helpers (PRD §43), shared by server and client: the settings
 * schema, the hours-for-priority lookup and the countdown chip maths.
 */

export type SlaPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'

export type SlaHours = {
  slaUrgentHours: number
  slaHighHours: number
  slaMediumHours: number
  slaLowHours: number
}

export const DEFAULT_SLA_HOURS: SlaHours = {
  slaUrgentHours: 2,
  slaHighHours: 4,
  slaMediumHours: 12,
  slaLowHours: 24,
}

const slaHoursField = z.coerce
  .number({ invalid_type_error: 'Enter a number of hours' })
  .int('Enter whole hours')
  .min(1, 'At least 1 hour')
  .max(168, 'At most 168 hours (one week)')

/** Partial so older clients that do not send SLA fields keep working. */
export const slaSettingsSchema = z.object({
  slaUrgentHours: slaHoursField.optional(),
  slaHighHours: slaHoursField.optional(),
  slaMediumHours: slaHoursField.optional(),
  slaLowHours: slaHoursField.optional(),
})

export function slaHoursFor(priority: SlaPriority, hours: Partial<SlaHours> | null | undefined) {
  const h = { ...DEFAULT_SLA_HOURS, ...(hours ?? {}) }
  switch (priority) {
    case 'URGENT':
      return h.slaUrgentHours
    case 'HIGH':
      return h.slaHighHours
    case 'LOW':
      return h.slaLowHours
    default:
      return h.slaMediumHours
  }
}

export function slaDueFrom(createdAt: Date, priority: SlaPriority, hours: Partial<SlaHours> | null | undefined) {
  return new Date(createdAt.getTime() + slaHoursFor(priority, hours) * 3_600_000)
}

/** "3h 20m", "2d 4h", "45m". */
export function formatSpan(ms: number) {
  const totalMinutes = Math.max(1, Math.round(Math.abs(ms) / 60_000))
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return hours ? `${days}d ${hours}h` : `${days}d`
  if (hours > 0) return minutes ? `${hours}h ${minutes}m` : `${hours}h`
  return `${minutes}m`
}

export type SlaTone = 'resolved' | 'critical' | 'high' | 'medium' | 'calm' | 'none'

export type SlaState = {
  tone: SlaTone
  label: string
  overdue: boolean
}

const DONE = new Set(['RESOLVED', 'CLOSED', 'REJECTED'])

/**
 * Countdown chip state. Colour follows PRD §11: overdue → critical red,
 * under 25% of the window left (or < 1h) → high orange, under 50% → medium
 * amber, resolved → green.
 */
export function slaState(input: {
  status: string
  slaDueAt: Date | string | null | undefined
  createdAt?: Date | string | null
  resolvedAt?: Date | string | null
  now?: number
}): SlaState {
  const due = input.slaDueAt ? new Date(input.slaDueAt).getTime() : null
  if (DONE.has(input.status)) {
    const resolvedAt = input.resolvedAt ? new Date(input.resolvedAt).getTime() : null
    const created = input.createdAt ? new Date(input.createdAt).getTime() : null
    if (resolvedAt && created) {
      const late = due !== null && resolvedAt > due
      return {
        tone: 'resolved',
        label: `Resolved in ${formatSpan(resolvedAt - created)}${late ? ' (late)' : ''}`,
        overdue: false,
      }
    }
    return { tone: 'resolved', label: 'Resolved', overdue: false }
  }
  if (due === null) return { tone: 'none', label: 'No SLA', overdue: false }

  const now = input.now ?? Date.now()
  const left = due - now
  if (left <= 0) return { tone: 'critical', label: `Overdue by ${formatSpan(left)}`, overdue: true }

  const created = input.createdAt ? new Date(input.createdAt).getTime() : null
  const windowMs = created ? Math.max(due - created, 1) : null
  const fraction = windowMs ? left / windowMs : 1
  const tone: SlaTone = left < 3_600_000 || fraction < 0.25 ? 'high' : fraction < 0.5 ? 'medium' : 'calm'
  return { tone, label: `Due in ${formatSpan(left)}`, overdue: false }
}
