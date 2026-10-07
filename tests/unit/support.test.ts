import { describe, expect, it } from 'vitest'
import {
  canAdminMove,
  canCustomerClose,
  canReply,
  createTicketSchema,
  isActiveStatus,
  resolvedAtFor,
  statusAfterReply,
  ticketActionSchema,
  TICKET_STATUSES,
} from '@/lib/support'
import { HELP_ARTICLES, helpArticle, searchHelp } from '@/lib/help-articles'

describe('support ticket status rules', () => {
  it('never allows a move to the same status', () => {
    for (const s of TICKET_STATUSES) expect(canAdminMove(s, s)).toBe(false)
  })

  it('only reopens a closed ticket', () => {
    expect(canAdminMove('CLOSED', 'OPEN')).toBe(true)
    for (const s of ['IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED'] as const) {
      expect(canAdminMove('CLOSED', s)).toBe(false)
    }
  })

  it('lets the team move an open ticket anywhere', () => {
    for (const s of ['IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED', 'CLOSED'] as const) {
      expect(canAdminMove('OPEN', s)).toBe(true)
    }
  })

  it('takes no replies on a closed ticket, but the customer may close anything else', () => {
    expect(canReply('CLOSED')).toBe(false)
    expect(canReply('RESOLVED')).toBe(true)
    expect(canCustomerClose('CLOSED')).toBe(false)
    expect(canCustomerClose('RESOLVED')).toBe(true)
  })

  it('puts the ticket back in the queue when the customer replies', () => {
    expect(statusAfterReply('WAITING_ON_CUSTOMER', false)).toBe('OPEN')
    expect(statusAfterReply('RESOLVED', false)).toBe('OPEN')
    expect(statusAfterReply('IN_PROGRESS', false)).toBe('IN_PROGRESS')
    expect(statusAfterReply('OPEN', false)).toBe('OPEN')
  })

  it('moves an open ticket to in progress on the team’s first reply', () => {
    expect(statusAfterReply('OPEN', true)).toBe('IN_PROGRESS')
    expect(statusAfterReply('WAITING_ON_CUSTOMER', true)).toBe('WAITING_ON_CUSTOMER')
    expect(statusAfterReply('CLOSED', true)).toBe('CLOSED')
  })

  it('stamps resolvedAt once and clears it on reopen', () => {
    const now = new Date('2026-10-07T10:00:00Z')
    const earlier = new Date('2026-10-01T10:00:00Z')
    expect(resolvedAtFor('RESOLVED', null, now)).toEqual(now)
    expect(resolvedAtFor('CLOSED', earlier, now)).toEqual(earlier)
    expect(resolvedAtFor('OPEN', earlier, now)).toBeNull()
  })

  it('treats resolved and closed as done', () => {
    expect(isActiveStatus('OPEN')).toBe(true)
    expect(isActiveStatus('WAITING_ON_CUSTOMER')).toBe(true)
    expect(isActiveStatus('RESOLVED')).toBe(false)
    expect(isActiveStatus('CLOSED')).toBe(false)
  })
})

describe('support ticket schemas', () => {
  const valid = { subject: 'Reminders not sent', category: 'WHATSAPP', message: 'No reminders went out today' }

  it('defaults priority to normal', () => {
    expect(createTicketSchema.parse(valid).priority).toBe('NORMAL')
  })

  it('rejects unknown categories, short subjects and outside attachment links', () => {
    expect(createTicketSchema.safeParse({ ...valid, category: 'HACK' }).success).toBe(false)
    expect(createTicketSchema.safeParse({ ...valid, subject: 'hey' }).success).toBe(false)
    expect(createTicketSchema.safeParse({ ...valid, attachmentUrl: 'https://evil.example/x.png' }).success).toBe(false)
    expect(createTicketSchema.safeParse({ ...valid, attachmentUrl: '/api/uploads/abc123' }).success).toBe(true)
  })

  it('parses each action and rejects unknown ones', () => {
    expect(ticketActionSchema.parse({ action: 'REPLY', body: 'Thanks' }).action).toBe('REPLY')
    expect(ticketActionSchema.parse({ action: 'ASSIGN', assigneeId: null }).action).toBe('ASSIGN')
    expect(ticketActionSchema.safeParse({ action: 'STATUS', status: 'DONE' }).success).toBe(false)
    expect(ticketActionSchema.safeParse({ action: 'DELETE' }).success).toBe(false)
    expect(ticketActionSchema.safeParse({ action: 'REPLY', body: '   ' }).success).toBe(false)
  })
})

describe('help centre', () => {
  it('has unique slugs and links only to app pages', () => {
    const slugs = HELP_ARTICLES.map((a) => a.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const a of HELP_ARTICLES) for (const l of a.links) expect(l.href.startsWith('/app')).toBe(true)
  })

  it('finds articles by any keyword, all words must match', () => {
    expect(searchHelp('razorpay').map((a) => a.slug)).toContain('razorpay')
    expect(searchHelp('LATE fee').map((a) => a.slug)).toContain('rent-and-payments')
    expect(searchHelp('razorpay zebra')).toHaveLength(0)
    expect(searchHelp('  ')).toHaveLength(HELP_ARTICLES.length)
    expect(helpArticle('nope')).toBeUndefined()
  })
})
