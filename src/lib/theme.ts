import type { PropertyType, BedStatus, ComplaintStatus, InvoiceStatus } from '@prisma/client'

/**
 * Per-property visual identity. A Men's PG is blue, a Women's PG is pink and
 * a co-living property is violet — applied consistently to headers, occupancy
 * indicators, bed maps and charts so an owner always knows which PG they are
 * looking at.
 */
export type PropertyTheme = {
  key: 'blue' | 'pink' | 'violet'
  label: string
  /** Tailwind classes, grouped by the role they play. */
  text: string
  textSoft: string
  bg: string
  bgSoft: string
  bgSolid: string
  border: string
  ring: string
  gradient: string
  softGradient: string
  chip: string
  /** Raw hex for Recharts / SVG, which cannot read Tailwind classes. */
  hex: string
  hexSoft: string
}

export const PROPERTY_THEMES: Record<PropertyType, PropertyTheme> = {
  MENS: {
    key: 'blue',
    label: "Men's PG",
    text: 'text-blue-700',
    textSoft: 'text-blue-600',
    bg: 'bg-blue-50',
    bgSoft: 'bg-blue-100/60',
    bgSolid: 'bg-blue-600',
    border: 'border-blue-200',
    ring: 'ring-blue-500/20',
    gradient: 'from-blue-600 via-blue-600 to-sky-500',
    softGradient: 'from-blue-50 to-sky-50',
    chip: 'bg-blue-50 text-blue-700 border-blue-200',
    hex: '#2563eb',
    hexSoft: '#93c5fd',
  },
  WOMENS: {
    key: 'pink',
    label: "Women's PG",
    text: 'text-pink-700',
    textSoft: 'text-pink-600',
    bg: 'bg-pink-50',
    bgSoft: 'bg-pink-100/60',
    bgSolid: 'bg-pink-600',
    border: 'border-pink-200',
    ring: 'ring-pink-500/20',
    gradient: 'from-pink-600 via-rose-500 to-fuchsia-500',
    softGradient: 'from-pink-50 to-rose-50',
    chip: 'bg-pink-50 text-pink-700 border-pink-200',
    hex: '#db2777',
    hexSoft: '#f9a8d4',
  },
  COLIVE: {
    key: 'violet',
    label: 'Co-living',
    text: 'text-violet-700',
    textSoft: 'text-violet-600',
    bg: 'bg-violet-50',
    bgSoft: 'bg-violet-100/60',
    bgSolid: 'bg-violet-600',
    border: 'border-violet-200',
    ring: 'ring-violet-500/20',
    gradient: 'from-violet-600 via-purple-600 to-indigo-500',
    softGradient: 'from-violet-50 to-indigo-50',
    chip: 'bg-violet-50 text-violet-700 border-violet-200',
    hex: '#7c3aed',
    hexSoft: '#c4b5fd',
  },
}

export function themeFor(type: PropertyType | null | undefined): PropertyTheme {
  return PROPERTY_THEMES[type ?? 'MENS']
}

/** The neutral brand theme used when "All PGs" is selected. */
export const BRAND_THEME: PropertyTheme = {
  key: 'violet',
  label: 'All PGs',
  text: 'text-slate-800',
  textSoft: 'text-slate-600',
  bg: 'bg-slate-50',
  bgSoft: 'bg-slate-100',
  bgSolid: 'bg-slate-900',
  border: 'border-slate-200',
  ring: 'ring-slate-500/20',
  gradient: 'from-slate-900 via-slate-800 to-slate-700',
  softGradient: 'from-slate-50 to-slate-100',
  chip: 'bg-slate-100 text-slate-700 border-slate-200',
  hex: '#0f172a',
  hexSoft: '#94a3b8',
}

// --------------------------------------------------------------------------
// Status tokens — one definition, reused by badges, bed maps and legends.
// --------------------------------------------------------------------------

export const BED_STATUS_STYLE: Record<
  BedStatus,
  { label: string; dot: string; chip: string; tile: string; tileText: string }
> = {
  AVAILABLE: {
    label: 'Available',
    dot: 'bg-emerald-500',
    chip: 'bg-emerald-50 text-emerald-700 border-emerald-200/70',
    tile: 'bg-emerald-50 border-emerald-200 hover:border-emerald-400',
    tileText: 'text-emerald-700',
  },
  OCCUPIED: {
    label: 'Occupied',
    dot: 'bg-slate-700',
    chip: 'bg-slate-100 text-slate-700 border-slate-300',
    tile: 'bg-white border-slate-200 hover:border-slate-400',
    tileText: 'text-slate-800',
  },
  RESERVED: {
    label: 'Reserved',
    dot: 'bg-amber-500',
    chip: 'bg-amber-50 text-amber-800 border-amber-200/70',
    tile: 'bg-amber-50 border-amber-200 hover:border-amber-400',
    tileText: 'text-amber-700',
  },
  MAINTENANCE: {
    label: 'Maintenance',
    dot: 'bg-slate-500 ring-2 ring-slate-200',
    chip: 'bg-slate-100 text-slate-600 border-slate-200',
    tile: 'bg-slate-50 border-dashed border-slate-300 hover:border-slate-400',
    tileText: 'text-slate-500',
  },
  BLOCKED: {
    label: 'Blocked',
    dot: 'bg-slate-400',
    chip: 'bg-slate-100 text-slate-500 border-slate-200',
    tile: 'bg-slate-100 border-slate-200 hover:border-slate-300',
    tileText: 'text-slate-500',
  },
}

export const INVOICE_STATUS_STYLE: Record<InvoiceStatus, { label: string; chip: string }> = {
  DRAFT: { label: 'Draft', chip: 'bg-slate-100 text-slate-600 border-slate-200' },
  PENDING: { label: 'Pending', chip: 'bg-amber-50 text-amber-800 border-amber-200/70' },
  PARTIALLY_PAID: { label: 'Part paid', chip: 'bg-sky-50 text-sky-700 border-sky-200/70' },
  PAID: { label: 'Paid', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200/70' },
  OVERDUE: { label: 'Overdue', chip: 'bg-rose-50 text-rose-700 border-rose-200/70' },
  WAIVED: { label: 'Waived', chip: 'bg-slate-100 text-slate-600 border-slate-200' },
  CANCELLED: { label: 'Cancelled', chip: 'bg-slate-100 text-slate-500 border-slate-200' },
}

export const COMPLAINT_STATUS_STYLE: Record<ComplaintStatus, { label: string; chip: string }> = {
  OPEN: { label: 'Open', chip: 'bg-rose-50 text-rose-700 border-rose-200/70' },
  ASSIGNED: { label: 'Assigned', chip: 'bg-amber-50 text-amber-800 border-amber-200/70' },
  IN_PROGRESS: { label: 'In progress', chip: 'bg-sky-50 text-sky-700 border-sky-200/70' },
  ON_HOLD: { label: 'On hold', chip: 'bg-slate-100 text-slate-600 border-slate-200' },
  RESOLVED: { label: 'Resolved', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200/70' },
  CLOSED: { label: 'Closed', chip: 'bg-slate-100 text-slate-600 border-slate-200' },
  REJECTED: { label: 'Rejected', chip: 'bg-slate-100 text-slate-500 border-slate-200' },
}

export const PRIORITY_STYLE: Record<string, { label: string; chip: string }> = {
  LOW: { label: 'Low', chip: 'bg-slate-100 text-slate-600 border-slate-200' },
  MEDIUM: { label: 'Medium', chip: 'bg-sky-50 text-sky-700 border-sky-200/70' },
  HIGH: { label: 'High', chip: 'bg-amber-50 text-amber-800 border-amber-200/70' },
  URGENT: { label: 'Urgent', chip: 'bg-rose-50 text-rose-700 border-rose-200/70' },
}

export const RESIDENT_STATUS_STYLE: Record<string, { label: string; chip: string }> = {
  PENDING: { label: 'Pending', chip: 'bg-amber-50 text-amber-800 border-amber-200/70' },
  ACTIVE: { label: 'Active', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200/70' },
  NOTICE: { label: 'On notice', chip: 'bg-amber-50 text-amber-800 border-amber-200/70' },
  CHECKED_OUT: { label: 'Checked out', chip: 'bg-slate-100 text-slate-600 border-slate-200' },
}

export const SUBSCRIPTION_STATUS_STYLE: Record<string, { label: string; chip: string }> = {
  TRIALING: { label: 'Trial', chip: 'bg-blue-50 text-blue-700 border-blue-200/70' },
  ACTIVE: { label: 'Active', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200/70' },
  PAST_DUE: { label: 'Past due', chip: 'bg-amber-50 text-amber-800 border-amber-200/70' },
  GRACE: { label: 'Grace period', chip: 'bg-amber-50 text-amber-800 border-amber-200/70' },
  SUSPENDED: { label: 'Suspended', chip: 'bg-rose-50 text-rose-700 border-rose-200/70' },
  CANCELLED: { label: 'Cancelled', chip: 'bg-slate-100 text-slate-500 border-slate-200' },
}

/** Chart palette — brand-consistent, colour-blind safe ordering. */
export const CHART_COLORS = [
  // Brand indigo first, then calm companions; red/amber are kept for meaning.
  '#5248e0',
  '#94a3b8',
  '#0d9488',
  '#f59e0b',
  '#8582f6',
  '#e11d48',
  '#0ea5e9',
  '#57524d',
]
