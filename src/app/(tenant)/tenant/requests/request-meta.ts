import { CalendarDays, DoorOpen, HelpCircle, Sparkles, UserPlus } from 'lucide-react'
import type { ResidentRequestKind, ResidentRequestStatus } from '@prisma/client'

/** Labels and styles shared by the resident app and the owner inbox. */

export const MEALS_PAUSED_LINE = 'Please pause my meals while I am away.'

export const KIND_META: Record<
  ResidentRequestKind,
  { label: string; icon: React.ElementType; tint: string; iconTint: string }
> = {
  LEAVE: { label: 'Leave', icon: CalendarDays, tint: 'bg-sky-50', iconTint: 'text-sky-600' },
  VISITOR: { label: 'Visitor', icon: UserPlus, tint: 'bg-violet-50', iconTint: 'text-violet-600' },
  ROOM_CHANGE: { label: 'Room change', icon: DoorOpen, tint: 'bg-amber-50', iconTint: 'text-amber-600' },
  SERVICE: { label: 'Service', icon: Sparkles, tint: 'bg-emerald-50', iconTint: 'text-emerald-600' },
  OTHER: { label: 'Other', icon: HelpCircle, tint: 'bg-slate-100', iconTint: 'text-slate-500' },
}

export const STATUS_META: Record<ResidentRequestStatus, { label: string; chip: string; dot: string }> = {
  PENDING: { label: 'Waiting', chip: 'border-amber-200 bg-amber-50 text-amber-700', dot: 'bg-amber-500' },
  APPROVED: { label: 'Approved', chip: 'border-emerald-200 bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
  REJECTED: { label: 'Declined', chip: 'border-red-200 bg-red-50 text-red-700', dot: 'bg-red-500' },
  CANCELLED: { label: 'Cancelled', chip: 'border-slate-200 bg-slate-100 text-slate-600', dot: 'bg-slate-400' },
  DONE: { label: 'Done', chip: 'border-blue-200 bg-blue-50 text-blue-700', dot: 'bg-blue-500' },
}

/** Request details without the internal meals marker line. */
export function cleanDetails(details: string | null) {
  if (!details) return null
  const text = details.replace(MEALS_PAUSED_LINE, '').trim()
  return text || null
}

export function hasMealsPaused(kind: ResidentRequestKind, details: string | null) {
  return kind === 'LEAVE' && Boolean(details?.includes(MEALS_PAUSED_LINE))
}
