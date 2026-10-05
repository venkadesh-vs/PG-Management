import { headers } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { fail, handleError, ok, parseBody } from '@/lib/api-helpers'
import { leadSchema } from '@/lib/validation'
import { notifySuperAdmins, recordActivity } from '@/server/events'

/**
 * POST /api/leads — the public demo-request endpoint.
 *
 * This is the only unauthenticated write in the product, so it is rate
 * limited per IP and stores nothing that is ever rendered publicly.
 */
const RATE_LIMIT = { windowMs: 60_000, max: 3 }
const attempts = new Map<string, { count: number; resetAt: number }>()

function rateLimited(ip: string) {
  const now = Date.now()
  const entry = attempts.get(ip)
  if (!entry || entry.resetAt < now) {
    attempts.set(ip, { count: 1, resetAt: now + RATE_LIMIT.windowMs })
    return false
  }
  entry.count++
  return entry.count > RATE_LIMIT.max
}

export async function POST(request: Request) {
  try {
    const hdrs = await headers()
    const ip = (hdrs.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || 'local'

    if (rateLimited(ip)) {
      return fail('Too many enquiries from this connection. Please try again in a minute.', 429)
    }

    const body = await parseBody(request, leadSchema)

    // A repeat enquiry from the same number updates the existing lead rather
    // than creating a duplicate for the sales team to reconcile.
    const existing = await prisma.lead.findFirst({
      where: { phone: body.phone, status: { notIn: ['CONVERTED', 'LOST'] } },
      orderBy: { createdAt: 'desc' },
    })

    const data = {
      name: body.name,
      phone: body.phone,
      whatsapp: body.whatsapp || body.phone,
      email: body.email || null,
      pgName: body.pgName || null,
      pgCount: body.pgCount,
      pgTypes: body.pgTypes ?? null,
      bedCount: body.bedCount ?? null,
      rentRange: body.rentRange || null,
      currentMethod: body.currentMethod || null,
      city: body.city || null,
      preferredDemoAt: body.preferredDemoAt ? new Date(body.preferredDemoAt) : null,
      message: body.message || null,
      source: body.source || 'website',
    }

    const lead = existing
      ? await prisma.lead.update({ where: { id: existing.id }, data })
      : await prisma.lead.create({ data })

    if (existing) {
      await prisma.leadNote.create({
        data: {
          leadId: lead.id,
          authorName: 'Website',
          body: 'Submitted the demo form again with updated details.',
        },
      })
    }

    await recordActivity({
      actorName: 'Website',
      event: 'LEAD_CREATED',
      entityType: 'Lead',
      entityId: lead.id,
      summary: `${lead.name} requested a demo — ${lead.pgCount} PG${lead.pgCount === 1 ? '' : 's'}${
        lead.city ? ` in ${lead.city}` : ''
      }`,
      ip,
    })

    await notifySuperAdmins({
      kind: 'LEAD',
      title: existing ? 'Returning demo request' : 'New demo request',
      body: `${lead.name} · ${lead.pgName ?? 'PG'} · ${lead.city ?? '—'} · ${lead.pgCount} PG${
        lead.pgCount === 1 ? '' : 's'
      }`,
      link: '/admin/leads',
    })

    // Deliberately minimal: the response never echoes stored lead data back.
    return ok({ received: true }, { status: 201 })
  } catch (error) {
    return handleError(error)
  }
}
