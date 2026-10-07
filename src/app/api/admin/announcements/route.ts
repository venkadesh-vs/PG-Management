import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ok, route } from '@/lib/api-helpers'
import { NotFoundError, ValidationError } from '@/lib/tenancy'
import { recordActivity } from '@/server/events'

const date = z
  .union([z.string().trim(), z.null()])
  .optional()
  .transform((v, ctx) => {
    if (v === undefined) return undefined
    if (v === null || v === '') return null
    const d = new Date(v)
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: 'custom', message: 'Pick a valid date' })
      return z.NEVER
    }
    return d
  })

const fields = {
  title: z.string().trim().min(3, 'Give it a short title').max(120),
  body: z.string().trim().min(3, 'Write the message').max(1000),
  audience: z.enum(['ALL', 'TRIAL', 'ACTIVE', 'SUSPENDED']),
  severity: z.enum(['INFO', 'SUCCESS', 'WARNING', 'CRITICAL']),
  startsAt: date,
  endsAt: date,
}

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('CREATE'), ...fields }),
  z.object({ action: z.literal('UPDATE'), id: z.string().min(1), ...fields }),
  z.object({ action: z.literal('END'), id: z.string().min(1) }),
])

function snapshot(a: { title: string; body: string; audience: string; severity: string; startsAt: Date; endsAt: Date | null }) {
  return {
    title: a.title,
    body: a.body,
    audience: a.audience,
    severity: a.severity,
    startsAt: a.startsAt.toISOString(),
    endsAt: a.endsAt?.toISOString() ?? null,
  }
}

/** Platform announcements shown to PG owners as a banner. Super Admin only. */
export const POST = route(
  async ({ user, request }) => {
    let raw: unknown
    try {
      raw = await request.json()
    } catch {
      throw new ValidationError('Request body must be valid JSON')
    }
    const body = schema.parse(raw)
    const actor = { actorId: user.id, actorName: user.name, actorRole: user.role }

    if (body.action === 'END') {
      const current = await prisma.platformAnnouncement.findUnique({ where: { id: body.id } })
      if (!current) throw new NotFoundError('Announcement not found')
      const updated = await prisma.platformAnnouncement.update({ where: { id: current.id }, data: { endsAt: new Date() } })
      await recordActivity({
        ...actor,
        event: 'ADMIN_ACTION',
        entityType: 'PlatformAnnouncement',
        entityId: current.id,
        summary: `Ended announcement "${current.title}"`,
        before: snapshot(current) as Prisma.InputJsonValue,
        after: snapshot(updated) as Prisma.InputJsonValue,
      })
      return ok({ announcement: updated, message: 'Announcement ended — owners no longer see it' })
    }

    const startsAt = body.startsAt ?? new Date()
    if (body.endsAt && body.endsAt <= startsAt) throw new ValidationError('The end must be after the start')
    const data = {
      title: body.title,
      body: body.body,
      audience: body.audience,
      severity: body.severity,
      startsAt,
      endsAt: body.endsAt ?? null,
    }

    if (body.action === 'CREATE') {
      const created = await prisma.platformAnnouncement.create({ data: { ...data, createdBy: user.name } })
      await recordActivity({
        ...actor,
        event: 'ADMIN_ACTION',
        entityType: 'PlatformAnnouncement',
        entityId: created.id,
        summary: `Published announcement "${created.title}" to ${created.audience.toLowerCase()} customers`,
        after: snapshot(created) as Prisma.InputJsonValue,
      })
      return ok({ announcement: created, message: 'Announcement published' }, { status: 201 })
    }

    const current = await prisma.platformAnnouncement.findUnique({ where: { id: body.id } })
    if (!current) throw new NotFoundError('Announcement not found')
    const updated = await prisma.platformAnnouncement.update({ where: { id: current.id }, data })
    await recordActivity({
      ...actor,
      event: 'ADMIN_ACTION',
      entityType: 'PlatformAnnouncement',
      entityId: current.id,
      summary: `Edited announcement "${updated.title}"`,
      before: snapshot(current) as Prisma.InputJsonValue,
      after: snapshot(updated) as Prisma.InputJsonValue,
    })
    return ok({ announcement: updated, message: 'Announcement saved' })
  },
  { roles: ['SUPER_ADMIN'] },
)
