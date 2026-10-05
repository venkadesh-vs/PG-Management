import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { fail, route } from '@/lib/api-helpers'
import type { SessionUser } from '@/lib/auth'
import { assertResidentAccess, ForbiddenError, inScope, NotFoundError, workerPropertyId } from '@/lib/tenancy'
import { getDownloadUrl, readLocal } from '@/server/storage'

/**
 * GET /api/uploads/[id] — serves an uploaded file to people allowed to see
 * it. Local files are streamed with private cache headers; S3 files are a
 * 302 to a 5-minute presigned URL.
 *
 *  - Everyone: same organization only.
 *  - TENANT: files on their own record, or photos on their own complaints
 *    (including the worker's resolution photo).
 *  - WORKER: complaint / task-proof photos of their PG or their own tasks.
 *  - OWNER / MANAGER: files of residents and complaints in their PG scope.
 */

export const runtime = 'nodejs'

type FileRow = {
  id: string
  organizationId: string
  key: string
  contentType: string
  purpose: string
  residentId: string | null
  uploadedById: string | null
}

/** Complaints and tasks that reference this file's URL. */
async function referencingRecords(file: FileRow) {
  const url = `/api/uploads/${file.id}`
  const [complaints, tasks] = await Promise.all([
    prisma.complaint.findMany({
      where: {
        organizationId: file.organizationId,
        OR: [
          { photoUrls: { has: url } },
          { resolutionPhotoUrl: url },
          { updates: { some: { photoUrl: url } } },
        ],
      },
      select: { propertyId: true, residentId: true, assignedStaffId: true },
      take: 5,
    }),
    prisma.maintenanceTask.findMany({
      where: { organizationId: file.organizationId, completionPhotoUrl: url },
      select: { propertyId: true, assignedStaffId: true },
      take: 5,
    }),
  ])
  return { complaints, tasks }
}

async function assertCanRead(user: SessionUser, file: FileRow) {
  if (!user.organizationId || user.organizationId !== file.organizationId) throw new NotFoundError('File not found')

  if (user.role === 'TENANT') {
    if (!user.residentId) throw new ForbiddenError()
    if (file.residentId === user.residentId) return
    if (file.purpose === 'COMPLAINT' && file.uploadedById === user.id) return
    const refs = await referencingRecords(file)
    if (refs.complaints.some((c) => c.residentId === user.residentId)) return
    throw new ForbiddenError('You cannot open this file')
  }

  if (user.role === 'WORKER') {
    if (file.purpose !== 'COMPLAINT' && file.purpose !== 'TASK_PROOF') throw new ForbiddenError('You cannot open this file')
    if (file.uploadedById === user.id) return
    const own = await workerPropertyId(user)
    const mine = (r: { propertyId: string; assignedStaffId: string | null }) =>
      (own && r.propertyId === own) || (user.staffId && r.assignedStaffId === user.staffId)
    const refs = await referencingRecords(file)
    if (refs.complaints.some(mine) || refs.tasks.some(mine)) return
    throw new ForbiddenError('You cannot open this file')
  }

  // Owners / managers: stay within their PG access set.
  if (file.residentId) {
    await assertResidentAccess(user, file.residentId)
    return
  }
  if (user.propertyIds.length) {
    const refs = await referencingRecords(file)
    const records = [...refs.complaints, ...refs.tasks]
    // Unreferenced files (just uploaded, not yet attached) stay visible to the uploader only.
    if (!records.length && file.uploadedById !== user.id) throw new ForbiddenError('You cannot open this file')
    if (records.length && !records.some((r) => inScope(user, r.propertyId))) {
      throw new ForbiddenError('You cannot open this file')
    }
  }
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return route(async ({ user }) => {
    const file = await prisma.uploadedFile.findUnique({
      where: { id },
      select: {
        id: true,
        organizationId: true,
        key: true,
        contentType: true,
        purpose: true,
        residentId: true,
        uploadedById: true,
      },
    })
    if (!file) throw new NotFoundError('File not found')
    await assertCanRead(user, file)

    const remote = getDownloadUrl(file.key)
    if (remote) {
      return NextResponse.redirect(remote, {
        status: 302,
        headers: { 'Cache-Control': 'private, no-store' },
      })
    }

    let bytes: Buffer
    try {
      bytes = await readLocal(file.key)
    } catch {
      return fail('This file is no longer available', 404)
    }
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': file.contentType,
        'Content-Length': String(bytes.length),
        // Files never change once uploaded; keep them out of shared caches.
        'Cache-Control': 'private, max-age=3600, immutable',
        'Content-Disposition': `inline; filename="${file.id}.${file.key.split('.').pop()}"`,
        'X-Content-Type-Options': 'nosniff',
        // Images get a locked-down CSP; PDFs need the browser's viewer, which a sandbox blocks.
        ...(file.contentType.startsWith('image/')
          ? { 'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox" }
          : {}),
      },
    })
  })(request)
}
