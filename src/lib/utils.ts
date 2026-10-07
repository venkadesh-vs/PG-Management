import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// --------------------------------------------------------------------------
// Money. Every amount in this product is a whole-rupee integer (see schema).
// --------------------------------------------------------------------------

export function formatMoney(amount: number, opts?: { compact?: boolean }): string {
  if (!Number.isFinite(amount)) return '₹0'
  if (opts?.compact) return `₹${compactNumber(amount)}`
  return `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(amount))}`
}

/** Indian short form: 1,20,000 -> 1.2L, 85,00,000 -> 85L, 1,20,00,000 -> 1.2Cr */
export function compactNumber(value: number): string {
  const n = Math.round(value)
  const abs = Math.abs(n)
  if (abs >= 10000000) return trimZero(n / 10000000) + 'Cr'
  if (abs >= 100000) return trimZero(n / 100000) + 'L'
  if (abs >= 1000) return trimZero(n / 1000) + 'K'
  return String(n)
}

function trimZero(n: number) {
  return n.toFixed(1).replace(/\.0$/, '')
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-IN').format(value)
}

export function percent(part: number, total: number): number {
  if (!total) return 0
  return Math.round((part / total) * 100)
}

// --------------------------------------------------------------------------
// Dates
// --------------------------------------------------------------------------

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? new Date(date) : date
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(d)
}

export function formatDateLong(date: Date | string | null | undefined): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? new Date(date) : date
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(d)
}

export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? new Date(date) : date
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d)
}

export function formatMonth(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric' }).format(d)
}

export function relativeTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const diff = Date.now() - d.getTime()
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return formatDate(d)
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / 86400000)
}

export function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export function endOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(23, 59, 59, 999)
  return x
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

export function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999)
}

export function addMonths(d: Date, months: number): Date {
  const x = new Date(d)
  const day = x.getDate()
  x.setMonth(x.getMonth() + months)
  // Guard against month-end rollover (31 Jan + 1 month must not become 3 Mar).
  if (x.getDate() < day) x.setDate(0)
  return x
}

export function addDays(d: Date, days: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + days)
  return x
}

export function daysInMonth(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
}

/** Clamp a preferred day-of-month to a month that may be shorter. */
export function dayOfMonth(year: number, month: number, day: number): Date {
  const last = new Date(year, month + 1, 0).getDate()
  return new Date(year, month, Math.min(day, last))
}

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`
}

// --------------------------------------------------------------------------
// Text
// --------------------------------------------------------------------------

export function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function maskId(value?: string | null): string {
  if (!value) return '—'
  const clean = value.replace(/\s/g, '')
  if (clean.length <= 4) return clean
  return `${'X'.repeat(Math.max(0, clean.length - 4))}${clean.slice(-4)}`
}

/** 919876543210 -> +91 98765 43210 */
export function formatPhone(phone?: string | null): string {
  if (!phone) return '—'
  const digits = phone.replace(/\D/g, '')
  const local = digits.length > 10 ? digits.slice(-10) : digits
  if (local.length !== 10) return phone
  return `+91 ${local.slice(0, 5)} ${local.slice(5)}`
}

