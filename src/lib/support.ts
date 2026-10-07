import { z } from 'zod'

/**
 * Support tickets between a PG account and the StayFlow team.
 * Pure rules shared by the API, the owner pages and the admin inbox.
 */

export const TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED', 'CLOSED'] as const
export type TicketStatus = (typeof TICKET_STATUSES)[number]

export const TICKET_CATEGORIES = [
  { value: 'BILLING', label: 'Subscription & billing' },
  { value: 'PAYMENTS', label: 'Rent payments & Razorpay' },
  { value: 'WHATSAPP', label: 'WhatsApp messages' },
  { value: 'IMPORT', label: 'Importing data' },
  { value: 'ACCOUNT', label: 'Login, team & roles' },
  { value: 'BUG', label: 'Something is not working' },
  { value: 'FEATURE', label: 'Feature request' },
  { value: 'OTHER', label: 'Something else' },
] as const
export type TicketCategory = (typeof TICKET_CATEGORIES)[number]['value']

export const TICKET_PRIORITIES = [
  { value: 'LOW', label: 'Low', hint: 'A question, no rush' },
  { value: 'NORMAL', label: 'Normal', hint: 'Needs an answer this week' },
  { value: 'HIGH', label: 'High', hint: 'Blocking part of my work' },
  { value: 'URGENT', label: 'Urgent', hint: 'Residents or payments are affected right now' },
] as const
export type TicketPriority = (typeof TICKET_PRIORITIES)[number]['value']

export const TICKET_STATUS_STYLE: Record<TicketStatus, { label: string; chip: string }> = {
  OPEN: { label: 'Open', chip: 'bg-sky-50 text-sky-700 border-sky-200' },
  IN_PROGRESS: { label: 'In progress', chip: 'bg-violet-50 text-violet-700 border-violet-200' },
  WAITING_ON_CUSTOMER: { label: 'Waiting for you', chip: 'bg-amber-50 text-amber-700 border-amber-200' },
  RESOLVED: { label: 'Resolved', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  CLOSED: { label: 'Closed', chip: 'bg-slate-100 text-slate-500 border-slate-200' },
}

/** The admin inbox calls WAITING_ON_CUSTOMER by what it means for the team. */
export const ADMIN_STATUS_LABEL: Record<TicketStatus, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  WAITING_ON_CUSTOMER: 'Waiting on customer',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
}

export const PRIORITY_STYLE: Record<TicketPriority, string> = {
  LOW: 'bg-slate-50 text-slate-600 border-slate-200',
  NORMAL: 'bg-blue-50 text-blue-700 border-blue-200',
  HIGH: 'bg-orange-50 text-orange-700 border-orange-200',
  URGENT: 'bg-red-50 text-red-700 border-red-200',
}

export const categoryLabel = (value: string) =>
  TICKET_CATEGORIES.find((c) => c.value === value)?.label ?? value
export const priorityLabel = (value: string) =>
  TICKET_PRIORITIES.find((p) => p.value === value)?.label ?? value

/** Tickets still needing someone's attention. */
export const isActiveStatus = (status: TicketStatus) => status !== 'RESOLVED' && status !== 'CLOSED'

/**
 * Which status changes the StayFlow team may make. A closed ticket can only
 * be reopened; everything else can move anywhere except to itself.
 */
const ADMIN_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  OPEN: ['IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED', 'CLOSED'],
  IN_PROGRESS: ['OPEN', 'WAITING_ON_CUSTOMER', 'RESOLVED', 'CLOSED'],
  WAITING_ON_CUSTOMER: ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'],
  RESOLVED: ['OPEN', 'IN_PROGRESS', 'CLOSED'],
  CLOSED: ['OPEN'],
}

export function canAdminMove(from: TicketStatus, to: TicketStatus) {
  return ADMIN_TRANSITIONS[from].includes(to)
}

/** The customer may close their own ticket while it is not already closed. */
export function canCustomerClose(status: TicketStatus) {
  return status !== 'CLOSED'
}

/** A closed ticket takes no more replies — the customer opens a new one. */
export function canReply(status: TicketStatus) {
  return status !== 'CLOSED'
}

/**
 * Status after a reply, unless the team picks one explicitly.
 * - Customer replies put the ticket back in the team's queue (reopens a
 *   resolved one).
 * - The team's first reply on an open ticket moves it to in progress.
 */
export function statusAfterReply(current: TicketStatus, fromStaff: boolean): TicketStatus {
  if (current === 'CLOSED') return current
  if (fromStaff) return current === 'OPEN' ? 'IN_PROGRESS' : current
  return current === 'WAITING_ON_CUSTOMER' || current === 'RESOLVED' ? 'OPEN' : current
}

/** resolvedAt follows the status: stamped when it settles, cleared on reopen. */
export function resolvedAtFor(next: TicketStatus, previous: Date | null, now = new Date()): Date | null {
  if (next === 'RESOLVED' || next === 'CLOSED') return previous ?? now
  return null
}

// ------------------------------------------------------------------ schemas

const attachment = z
  .string()
  .trim()
  .regex(/^\/api\/uploads\/[A-Za-z0-9_-]+$/, 'Attach the file using the upload button')
  .optional()
  .or(z.literal(''))

const message = z
  .string()
  .trim()
  .min(5, 'Write a few words about the problem')
  .max(4000, 'Keep the message under 4,000 characters')

export const createTicketSchema = z.object({
  subject: z.string().trim().min(5, 'Give the ticket a short subject').max(140, 'Keep the subject under 140 characters'),
  category: z.enum(TICKET_CATEGORIES.map((c) => c.value) as [TicketCategory, ...TicketCategory[]], {
    errorMap: () => ({ message: 'Choose what this is about' }),
  }),
  priority: z
    .enum(TICKET_PRIORITIES.map((p) => p.value) as [TicketPriority, ...TicketPriority[]])
    .default('NORMAL'),
  message,
  attachmentUrl: attachment,
})

const replyBody = z.string().trim().min(1, 'Write a reply').max(4000, 'Keep the reply under 4,000 characters')

export const ticketActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('REPLY'),
    body: replyBody,
    attachmentUrl: attachment,
    /** Team only: set the status in the same step. */
    status: z.enum(TICKET_STATUSES).optional(),
  }),
  z.object({ action: z.literal('CLOSE') }),
  z.object({
    action: z.literal('STATUS'),
    status: z.enum(TICKET_STATUSES),
    note: z.string().trim().max(500).optional(),
  }),
  z.object({ action: z.literal('ASSIGN'), assigneeId: z.string().min(1).nullable() }),
  z.object({
    action: z.literal('PRIORITY'),
    priority: z.enum(TICKET_PRIORITIES.map((p) => p.value) as [TicketPriority, ...TicketPriority[]]),
  }),
])
export type TicketAction = z.infer<typeof ticketActionSchema>

/** Team-only actions; the customer may only REPLY and CLOSE. */
export const ADMIN_ONLY_ACTIONS: TicketAction['action'][] = ['STATUS', 'ASSIGN', 'PRIORITY']
