import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ok, route } from '@/lib/api-helpers'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/tenancy'
import { createClientSchema } from '@/lib/validation'
import { bootstrapOrganization, sendAccessLink } from '@/server/services/accounts'
import { recordActivity } from '@/server/events'
import { LEAD_STATUSES, leadStyle } from '@/app/(admin)/admin/leads/lead-meta'

const convertSchema = createClientSchema.extend({
  action: z.literal('CONVERT'),
  leadId: z.string().min(1),
  /** TRIAL = "Start trial", CONVERTED = "Convert to customer". Both create the account. */
  mode: z.enum(['TRIAL', 'CONVERTED']).default('CONVERTED'),
})

const text = (max: number) => z.string().trim().max(max).nullable().optional()
const optionalInt = z
  .union([z.coerce.number().int().min(0).max(100000), z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === '' ? null : v))
const optionalDate = z
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

/** Editable lead fields. Absent = unchanged; null / '' = clear. */
const fieldsSchema = z.object({
  name: z.string().trim().min(2, 'Enter the owner name').max(120).optional(),
  phone: z
    .string()
    .trim()
    .regex(/^(\+?91[-\s]?)?[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number')
    .optional(),
  whatsapp: text(20),
  email: z.union([z.string().trim().email('Enter a valid email'), z.literal(''), z.null()]).optional(),
  pgName: text(120),
  city: text(80),
  bedCount: optionalInt,
  pgCount: optionalInt,
  currentSoftware: text(120),
  source: text(40),
  salesOwnerId: z.string().nullable().optional(),
  followUpAt: optionalDate,
  demoAt: optionalDate,
  lostReason: text(200),
})

const updateSchema = fieldsSchema.extend({
  leadId: z.string().min(1),
  status: z.enum(LEAD_STATUSES).optional(),
  note: z.string().trim().max(2000).optional(),
})

const createSchema = fieldsSchema.extend({
  action: z.literal('CREATE_LEAD'),
  name: z.string().trim().min(2, 'Enter the owner name').max(120),
  phone: z
    .string()
    .trim()
    .regex(/^(\+?91[-\s]?)?[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number'),
  note: z.string().trim().max(2000).optional(),
})

const AUDITED = [
  'status',
  'name',
  'phone',
  'whatsapp',
  'email',
  'pgName',
  'city',
  'bedCount',
  'pgCount',
  'currentSoftware',
  'source',
  'salesOwnerId',
  'followUpAt',
  'demoAt',
  'lostReason',
  'convertedOrgId',
] as const

type LeadRow = Awaited<ReturnType<typeof prisma.lead.findUniqueOrThrow>>

function pick(lead: Partial<LeadRow>) {
  const out: Record<string, unknown> = {}
  for (const key of AUDITED) {
    const v = lead[key as keyof LeadRow]
    out[key] = v instanceof Date ? v.toISOString() : (v ?? null)
  }
  return out
}

/** Only the fields that actually changed, as {before, after}. */
function diff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const b: Record<string, unknown> = {}
  const a: Record<string, unknown> = {}
  for (const key of Object.keys(after)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      b[key] = before[key]
      a[key] = after[key]
    }
  }
  return { before: b, after: a, changed: Object.keys(a) }
}

async function assertSalesOwner(id: string | null | undefined) {
  if (!id) return
  const owner = await prisma.user.findFirst({ where: { id, role: 'SUPER_ADMIN' }, select: { id: true } })
  if (!owner) throw new ValidationError('The sales owner must be a StayFlow admin')
}

function fieldData(body: z.infer<typeof fieldsSchema>): Prisma.LeadUncheckedUpdateInput {
  const data: Prisma.LeadUncheckedUpdateInput = {}
  const blankToNull = (v: string | null | undefined) => (v === undefined ? undefined : v?.trim() ? v.trim() : null)
  if (body.name !== undefined) data.name = body.name
  if (body.phone !== undefined) data.phone = body.phone
  if (body.whatsapp !== undefined) data.whatsapp = blankToNull(body.whatsapp)
  if (body.email !== undefined) data.email = blankToNull(body.email)
  if (body.pgName !== undefined) data.pgName = blankToNull(body.pgName)
  if (body.city !== undefined) data.city = blankToNull(body.city)
  if (body.bedCount !== undefined) data.bedCount = body.bedCount
  if (body.pgCount !== undefined && body.pgCount !== null) data.pgCount = Math.max(1, body.pgCount)
  if (body.currentSoftware !== undefined) data.currentSoftware = blankToNull(body.currentSoftware)
  if (body.source !== undefined && body.source) data.source = body.source
  if (body.salesOwnerId !== undefined) data.salesOwnerId = body.salesOwnerId || null
  if (body.followUpAt !== undefined) data.followUpAt = body.followUpAt
  if (body.demoAt !== undefined) data.demoAt = body.demoAt
  if (body.lostReason !== undefined) data.lostReason = blankToNull(body.lostReason)
  return data
}

/**
 * Sales CRM for platform leads (Super Admin only):
 * - default: edit fields / move status / add a note
 * - action CREATE_LEAD: add a lead by hand (phone call, referral…)
 * - action CONVERT: create the client account (Start trial / Convert to customer)
 * Every change is audited as LEAD_UPDATED with before/after.
 */
export const POST = route(
  async ({ user, request }) => {
    let raw: unknown
    try {
      raw = await request.json()
    } catch {
      throw new ValidationError('Request body must be valid JSON')
    }
    const action = (raw as { action?: string } | null)?.action
    const actor = { actorId: user.id, actorName: user.name, actorRole: user.role }

    if (action === 'CREATE_LEAD') {
      const body = createSchema.parse(raw)
      await assertSalesOwner(body.salesOwnerId)
      const lead = await prisma.lead.create({
        data: {
          ...(fieldData(body) as Prisma.LeadUncheckedCreateInput),
          name: body.name,
          phone: body.phone,
          source: body.source || 'phone',
          salesOwnerId: body.salesOwnerId || user.id,
        },
      })
      if (body.note?.trim()) {
        await prisma.leadNote.create({
          data: { leadId: lead.id, authorId: user.id, authorName: user.name, body: body.note.trim() },
        })
      }
      await recordActivity({
        ...actor,
        event: 'LEAD_UPDATED',
        entityType: 'Lead',
        entityId: lead.id,
        summary: `Lead ${lead.name} added by hand`,
        after: pick(lead) as Prisma.InputJsonValue,
      })
      return ok({ lead, message: `${lead.name} added to the pipeline` }, { status: 201 })
    }

    if (action === 'CONVERT') {
      const input = convertSchema.parse(raw)
      const lead = await prisma.lead.findUnique({ where: { id: input.leadId } })
      if (!lead) throw new NotFoundError('Lead not found')
      if (lead.convertedOrgId) throw new ConflictError('This lead already has a client account')

      const { organization, owner } = await bootstrapOrganization({
        orgName: input.orgName,
        ownerName: input.ownerName,
        email: input.email,
        phone: input.phone,
        city: input.city || null,
        source: 'LEAD',
        actor: { id: user.id, name: user.name, role: user.role },
      })
      const updated = await prisma.lead.update({
        where: { id: lead.id },
        data: { status: input.mode, convertedOrgId: organization.id, lastContactedAt: new Date(), followUpAt: null },
      })
      await prisma.leadNote.create({
        data: {
          leadId: lead.id,
          authorId: user.id,
          authorName: user.name,
          body:
            input.mode === 'TRIAL'
              ? `Trial started — client account ${organization.name} created`
              : `Converted to customer — client account ${organization.name} created`,
          statusTo: input.mode,
        },
      })
      await recordActivity({
        ...actor,
        event: 'LEAD_UPDATED',
        entityType: 'Lead',
        entityId: lead.id,
        summary:
          input.mode === 'TRIAL'
            ? `${lead.name} started a trial as ${organization.name}`
            : `${lead.name} converted to client ${organization.name}`,
        before: { status: lead.status, convertedOrgId: null },
        after: { status: input.mode, convertedOrgId: organization.id },
      })
      const access = await sendAccessLink(owner.id)
      return ok(
        {
          lead: updated,
          organization: { id: organization.id, name: organization.name },
          ...access,
          message:
            input.mode === 'TRIAL'
              ? `${organization.name} is on a free trial`
              : `${organization.name} created from this lead`,
        },
        { status: 201 },
      )
    }

    const body = updateSchema.parse(raw)
    const lead = await prisma.lead.findUnique({ where: { id: body.leadId } })
    if (!lead) throw new NotFoundError('Lead not found')
    await assertSalesOwner(body.salesOwnerId)

    const data = fieldData(body)
    const statusChanged = Boolean(body.status && body.status !== lead.status)
    if (statusChanged) {
      data.status = body.status
      if (body.status === 'LOST' && !(body.lostReason?.trim() || lead.lostReason)) {
        throw new ValidationError('Pick a reason before marking this lead lost')
      }
      if (body.status === 'DEMO_SCHEDULED' && !(body.demoAt || lead.demoAt)) {
        throw new ValidationError('Pick the demo date and time')
      }
    }
    const noteText = body.note?.trim()
    // A call, a note or a status move counts as contact; quiet field edits do not.
    if (noteText || statusChanged) data.lastContactedAt = new Date()

    const updated = await prisma.lead.update({ where: { id: lead.id }, data })
    const change = diff(pick(lead), pick(updated))

    if (noteText || statusChanged) {
      await prisma.leadNote.create({
        data: {
          leadId: lead.id,
          authorId: user.id,
          authorName: user.name,
          body: noteText || `Status changed to ${leadStyle(updated.status).label.toLowerCase()}`,
          statusTo: statusChanged ? updated.status : undefined,
        },
      })
    }

    if (change.changed.length) {
      await recordActivity({
        ...actor,
        event: 'LEAD_UPDATED',
        entityType: 'Lead',
        entityId: lead.id,
        summary: statusChanged
          ? `${updated.name} moved to ${leadStyle(updated.status).label.toLowerCase()}`
          : `${updated.name} updated (${change.changed.join(', ')})`,
        before: change.before as Prisma.InputJsonValue,
        after: change.after as Prisma.InputJsonValue,
      })
    }

    return ok({
      lead: updated,
      message: statusChanged
        ? `${updated.name} is now ${leadStyle(updated.status).label.toLowerCase()}`
        : change.changed.length
          ? 'Lead saved'
          : noteText
            ? 'Note saved'
            : 'Nothing changed',
    })
  },
  { roles: ['SUPER_ADMIN'] },
)
