import 'server-only'

import { prisma } from '@/lib/prisma'
import { ConflictError, ValidationError } from '@/lib/tenancy'
import { formatMoney } from '@/lib/utils'
import { recordActivity } from '../events'
import { isUniqueViolation } from './billing'
import { nextBedLabels } from './bed-layout'
import { assertWithinPlan } from './plan-limits'
import {
  cellOf,
  floorFromRoomNumber,
  floorName,
  matchKey,
  parseAmount,
  parseFloorLevel,
  parseSharing,
  parseYesNo,
  roomTypeFor,
  type ColumnMapping,
  type RowCheck,
  type RowOutcome,
  type SheetRow,
} from './import-fields'
import { applyPlanLimit } from './import-jobs'
import type { ImportScope } from './resident-import'

/**
 * Rooms & beds import. A row is either a room ("101, 3 sharing") or one bed
 * of a room ("101, bed B"). Missing floors and rooms are created with their
 * beds; a bed row for an existing room adds just that bed. Rooms and beds
 * that already exist are skipped, so the same sheet can be uploaded twice.
 * Each room is written in its own transaction.
 */

type RowPlan = {
  line: number
  propertyId: string
  propertyName: string
  floorLevel: number
  floorId?: string
  room: string
  beds: number | null
  bedLabel: string | null
  rent: number | null
  ac: boolean | null
  existingRoomId?: string
}

export type RoomGroup = {
  key: string
  propertyId: string
  propertyName: string
  floorLevel: number
  floorId?: string
  room: string
  existingRoomId?: string
  /** Every bed label this group creates. */
  labels: string[]
  rent: number | null
  ac: boolean
  lines: number[]
}

export type RoomValidation = { checks: RowCheck[]; notes: string[]; groups: RoomGroup[] }

const MAX_BEDS = 12

export async function validateRoomRows(
  scope: ImportScope,
  rows: SheetRow[],
  mapping: ColumnMapping,
): Promise<RoomValidation> {
  const properties = await prisma.property.findMany({
    where: { id: { in: scope.propertyIds }, organizationId: scope.organizationId, archivedAt: null },
    select: {
      id: true,
      name: true,
      code: true,
      floors: { select: { id: true, name: true, level: true } },
      rooms: { select: { id: true, number: true, beds: { select: { label: true } } } },
    },
  })
  const propertyByKey = new Map<string, (typeof properties)[number]>()
  for (const p of properties) propertyByKey.set(matchKey(p.name), p)
  for (const p of properties) if (!propertyByKey.has(matchKey(p.code))) propertyByKey.set(matchKey(p.code), p)

  const get = (row: SheetRow, key: string) => cellOf(row, mapping, key)
  const checks: RowCheck[] = []
  const plans = new Map<number, RowPlan>()
  const roomRowSeen = new Map<string, number>()
  const bedSeen = new Map<string, number>()

  for (const row of rows) {
    const errors: string[] = []
    const warnings: string[] = []
    const roomText = get(row, 'room')
    const bedLabel = get(row, 'bed') || null
    const check: RowCheck = {
      row: row.line,
      status: 'ready',
      title: roomText ? `Room ${roomText}${bedLabel ? ` · Bed ${bedLabel}` : ''}` : '—',
      subtitle: [get(row, 'pg'), get(row, 'floor') && `Floor ${get(row, 'floor')}`, get(row, 'beds') && `${get(row, 'beds')} beds`]
        .filter(Boolean)
        .join(' · '),
      errors,
      warnings,
    }
    checks.push(check)

    if (!get(row, 'pg')) errors.push('PG name is missing')
    if (!roomText) errors.push('Room is missing')
    else if (roomText.length > 20) errors.push('Room number is too long (20 characters at most)')
    if (bedLabel && bedLabel.length > 10) errors.push('Bed label is too long (10 characters at most)')

    const property = get(row, 'pg') ? propertyByKey.get(matchKey(get(row, 'pg'))) : undefined
    if (get(row, 'pg') && !property) errors.push(`PG "${get(row, 'pg')}" not found, or you do not have access to it`)

    let beds: number | null = null
    if (get(row, 'beds')) {
      beds = parseSharing(get(row, 'beds'))
      if (beds === null || beds < 1 || beds > MAX_BEDS) {
        errors.push(`Beds "${get(row, 'beds')}" should be a number from 1 to ${MAX_BEDS} (or Single / Double / 3 sharing)`)
        beds = null
      }
    }
    if (!get(row, 'beds') && !bedLabel) errors.push('Give the number of beds (sharing) or a bed label')

    let rent: number | null = null
    if (get(row, 'rent')) {
      const r = parseAmount(get(row, 'rent'))
      if (!r.ok) errors.push(r.error === 'negative' ? 'Rent cannot be negative' : `Rent "${get(row, 'rent')}" is not a number`)
      else rent = r.value
    }
    const ac = get(row, 'ac') ? parseYesNo(get(row, 'ac')) : false
    if (ac === null) errors.push('AC must be yes or no')

    // Floor: an existing floor by name, a level ("Ground", "2nd"), or a guess from the room number.
    let floorLevel = 0
    let floorId: string | undefined
    const floorText = get(row, 'floor')
    const byName = property && floorText ? property.floors.find((f) => matchKey(f.name) === matchKey(floorText)) : undefined
    if (byName) {
      floorLevel = byName.level
      floorId = byName.id
    } else if (floorText) {
      const level = parseFloorLevel(floorText)
      if (level === null || level < -1 || level > 99) errors.push(`Floor "${floorText}" is not clear — use Ground, 1, 2…`)
      else floorLevel = level
    } else if (roomText) {
      const guess = floorFromRoomNumber(roomText)
      floorLevel = guess ?? 0
      warnings.push(guess === null ? 'No floor given — room goes on the Ground floor' : `No floor given — ${floorName(floorLevel)} (from the room number)`)
    }
    if (property && floorId === undefined) floorId = property.floors.find((f) => f.level === floorLevel)?.id

    if (errors.length || !property) {
      check.status = 'error'
      continue
    }

    const groupKey = `${property.id}|${matchKey(roomText)}`
    const existing = property.rooms.find((r) => matchKey(r.number) === matchKey(roomText))
    if (existing) {
      if (!bedLabel) {
        check.status = 'skip'
        warnings.length = 0
        warnings.push(`Room ${existing.number} already exists in ${property.name}`)
        continue
      }
      if (existing.beds.some((b) => matchKey(b.label) === matchKey(bedLabel))) {
        check.status = 'skip'
        warnings.length = 0
        warnings.push(`Bed ${bedLabel} in room ${existing.number} already exists`)
        continue
      }
      warnings.length = 0
      warnings.push(`Adds bed ${bedLabel} to existing room ${existing.number}`)
    }

    if (bedLabel) {
      const bKey = `${groupKey}|${matchKey(bedLabel)}`
      const dup = bedSeen.get(bKey)
      if (dup) {
        errors.push(`Same room and bed as row ${dup} in this file`)
        check.status = 'error'
        continue
      }
      bedSeen.set(bKey, row.line)
    } else {
      const dup = roomRowSeen.get(groupKey)
      if (dup) {
        errors.push(`Room ${roomText} is already listed in row ${dup} — use one row per room, or one row per bed with a bed label`)
        check.status = 'error'
        continue
      }
      roomRowSeen.set(groupKey, row.line)
    }

    check.subtitle = [
      property.name,
      floorName(floorLevel),
      beds ? `${beds} bed${beds === 1 ? '' : 's'}` : null,
      rent ? `${formatMoney(rent)}/bed` : null,
      ac ? 'AC' : null,
    ]
      .filter(Boolean)
      .join(' · ')
    plans.set(row.line, {
      line: row.line,
      propertyId: property.id,
      propertyName: property.name,
      floorLevel,
      floorId,
      room: existing?.number ?? roomText,
      beds,
      bedLabel,
      rent,
      ac,
      existingRoomId: existing?.id,
    })
  }

  // Plan check on the beds the file would add. Bed rows cost one bed; a room
  // row costs its sharing count minus the bed rows that name its beds.
  const preliminary = buildGroups(checks, plans)
  const cost = new Map<number, number>()
  for (const g of preliminary) {
    const labelled = g.lines.filter((l) => plans.get(l)?.bedLabel)
    for (const l of labelled) cost.set(l, 1)
    const head = g.lines.find((l) => !plans.get(l)?.bedLabel) ?? g.lines[0]
    cost.set(head, (cost.get(head) ?? 0) + g.labels.length - labelled.length)
  }
  const notes: string[] = []
  const planNote = await applyPlanLimit(scope.organizationId, 'beds', checks, (c) => cost.get(c.row) ?? 0)
  if (planNote) notes.push(planNote)

  return { checks, notes, groups: buildGroups(checks, plans) }
}

/** Ready rows → one group per room, with the final bed labels. */
function buildGroups(checks: RowCheck[], plans: Map<number, RowPlan>): RoomGroup[] {
  const groups = new Map<string, RoomGroup & { capacity: number; named: string[] }>()
  for (const check of checks) {
    if (check.status !== 'ready') continue
    const p = plans.get(check.row)
    if (!p) continue
    const key = `${p.propertyId}|${matchKey(p.room)}`
    let g = groups.get(key)
    if (!g) {
      g = {
        key,
        propertyId: p.propertyId,
        propertyName: p.propertyName,
        floorLevel: p.floorLevel,
        floorId: p.floorId,
        room: p.room,
        existingRoomId: p.existingRoomId,
        labels: [],
        rent: p.rent,
        ac: Boolean(p.ac),
        lines: [],
        capacity: 0,
        named: [],
      }
      groups.set(key, g)
    }
    g.lines.push(p.line)
    if (p.bedLabel) g.named.push(p.bedLabel)
    if (p.beds) {
      if (g.capacity && g.capacity !== p.beds) check.warnings.push(`Room ${p.room} has different bed counts in this file — the larger is used`)
      g.capacity = Math.max(g.capacity, p.beds)
    }
    if (g.rent == null && p.rent != null) g.rent = p.rent
    if (p.ac) g.ac = true
  }
  return [...groups.values()].map(({ capacity, named, ...g }) => {
    // Existing rooms only get the beds named in the file.
    const extra = g.existingRoomId ? [] : nextBedLabels(named, Math.max(0, capacity - named.length))
    return { ...g, labels: [...named, ...extra] }
  })
}

export async function importRoomGroups(params: {
  scope: ImportScope
  validation: RoomValidation
  actor: { id: string; name: string; role?: string }
}): Promise<RowOutcome[]> {
  const { scope, validation, actor } = params
  const outcomes = new Map<number, RowOutcome>()
  for (const check of validation.checks) {
    if (check.status === 'ready') continue
    outcomes.set(check.row, {
      row: check.row,
      title: check.title,
      status: check.status === 'skip' ? 'skipped' : 'failed',
      message: check.status === 'skip' ? check.warnings[0] : check.errors.join('; ') || 'Not imported',
    })
  }
  const titleOf = new Map(validation.checks.map((c) => [c.row, c.title]))

  for (const g of validation.groups) {
    const record = (status: RowOutcome['status'], message?: string) => {
      for (const line of g.lines) outcomes.set(line, { row: line, title: titleOf.get(line) ?? `Room ${g.room}`, status, message, link: `/app/properties/${g.propertyId}` })
    }
    try {
      await assertWithinPlan(scope.organizationId, 'beds', g.labels.length)
      const summary = await prisma.$transaction(async (tx) => {
        // Floors are unique per (PG, level), so an upsert is safe under races.
        const floor = g.floorId
          ? { id: g.floorId }
          : await tx.floor.upsert({
              where: { propertyId_level: { propertyId: g.propertyId, level: g.floorLevel } },
              create: { propertyId: g.propertyId, level: g.floorLevel, name: floorName(g.floorLevel) },
              update: {},
              select: { id: true },
            })

        if (g.existingRoomId) {
          const room = await tx.room.findFirstOrThrow({
            where: { id: g.existingRoomId, propertyId: g.propertyId },
            select: { id: true, floorId: true, baseRent: true, number: true, beds: { select: { label: true } } },
          })
          const have = new Set(room.beds.map((b) => matchKey(b.label)))
          const add = g.labels.filter((l) => !have.has(matchKey(l)))
          if (!add.length) return { status: 'skipped' as const, message: 'These beds already exist' }
          await tx.bed.createMany({
            data: add.map((label) => ({
              propertyId: g.propertyId,
              floorId: room.floorId,
              roomId: room.id,
              label,
              status: 'AVAILABLE' as const,
              rent: g.rent ?? room.baseRent,
            })),
          })
          await tx.room.update({ where: { id: room.id }, data: { capacity: room.beds.length + add.length } })
          await recordActivity(
            {
              organizationId: scope.organizationId,
              propertyId: g.propertyId,
              actorId: actor.id,
              actorName: actor.name,
              event: 'PROPERTY_UPDATED',
              entityType: 'Room',
              entityId: room.id,
              summary: `Import: ${add.length} bed${add.length === 1 ? '' : 's'} added to room ${room.number}`,
            },
            tx,
          )
          return { status: 'imported' as const, message: `Bed ${add.join(', ')} added` }
        }

        if (!g.labels.length) throw new ValidationError('No beds to create for this room')
        const room = await tx.room.create({
          data: {
            propertyId: g.propertyId,
            floorId: floor.id,
            number: g.room,
            type: roomTypeFor(g.labels.length),
            capacity: g.labels.length,
            baseRent: g.rent,
            hasAC: g.ac,
            beds: {
              create: g.labels.map((label) => ({
                propertyId: g.propertyId,
                floorId: floor.id,
                label,
                status: 'AVAILABLE' as const,
                rent: g.rent,
              })),
            },
          },
          select: { id: true, number: true },
        })
        await recordActivity(
          {
            organizationId: scope.organizationId,
            propertyId: g.propertyId,
            actorId: actor.id,
            actorName: actor.name,
            event: 'PROPERTY_UPDATED',
            entityType: 'Room',
            entityId: room.id,
            summary: `Import: room ${room.number} added with ${g.labels.length} beds`,
          },
          tx,
        )
        return {
          status: 'imported' as const,
          message: `Room ${room.number} created on ${floorName(g.floorLevel)} with beds ${g.labels.join(', ')}`,
        }
      })
      record(summary.status, summary.message)
    } catch (error) {
      if (isUniqueViolation(error)) {
        record('skipped', `Room ${g.room} already exists in ${g.propertyName}`)
        continue
      }
      const known = error instanceof ValidationError || error instanceof ConflictError
      if (!known) console.error('[import-rooms] room failed', { room: g.room, error })
      record('failed', known ? (error as Error).message : `Could not create room ${g.room}. Try again.`)
    }
  }

  return [...outcomes.values()].sort((a, b) => a.row - b.row)
}
