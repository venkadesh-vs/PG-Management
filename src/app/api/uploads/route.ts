import { prisma } from '@/lib/prisma'
import { fail, ok, route } from '@/lib/api-helpers'
import { isRateLimited, recordHit } from '@/lib/rate-limit'
import { assertResidentAccess, ForbiddenError, ValidationError } from '@/lib/tenancy'
import { newStorageKey, putObject } from '@/server/storage'
import { assertStorageAvailable } from '@/server/services/plan-limits'
import { logError } from '@/lib/logger'

/**
 * POST /api/uploads — multipart upload (field `file`, `purpose`, optional
 * `residentId`). Returns `{ id, url }` where url is `/api/uploads/<id>`;
 * that string is what gets stored on complaints and tasks.
 */

export const runtime = 'nodejs'

const MAX_BYTES = 5 * 1024 * 1024
const PURPOSES = ['KYC', 'COMPLAINT', 'TASK_PROOF', 'OTHER'] as const
type Purpose = (typeof PURPOSES)[number]
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const

/** The real type, from the file's first bytes — the browser's header is only a hint. */
function sniff(bytes: Buffer): (typeof ALLOWED)[number] | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png'
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp'
  }
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf'
  return null
}

/** Which purposes each role may upload for. */
function allowedPurposes(role: string): Purpose[] {
  if (role === 'TENANT') return ['COMPLAINT', 'KYC']
  if (role === 'WORKER') return ['COMPLAINT', 'TASK_PROOF']
  return [...PURPOSES]
}

export const POST = route(async ({ user, request }) => {
  if (!user.organizationId) throw new ForbiddenError('Uploads belong to a PG account')

  // Refuse obviously oversized bodies before buffering them.
  const declared = Number(request.headers.get('content-length') ?? 0)
  if (declared > MAX_BYTES + 64 * 1024) return fail('That file is larger than 5 MB. Please choose a smaller one.', 413)

  const rateKey = `upload:${user.id}`
  if (await isRateLimited(rateKey, 30, 60)) {
    return fail('You have uploaded a lot of files in the last hour. Please try again a little later.', 429)
  }
  await recordHit(rateKey)

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    throw new ValidationError('Send the file as a form upload')
  }

  const file = form.get('file')
  if (!file || typeof file === 'string') throw new ValidationError('Choose a file to upload')
  if (file.size === 0) throw new ValidationError('That file is empty')
  if (file.size > MAX_BYTES) return fail('That file is larger than 5 MB. Please choose a smaller one.', 413)

  const purposeRaw = String(form.get('purpose') ?? 'OTHER').toUpperCase()
  if (!PURPOSES.includes(purposeRaw as Purpose)) throw new ValidationError('Unknown upload purpose')
  const purpose = purposeRaw as Purpose
  if (!allowedPurposes(user.role).includes(purpose)) {
    throw new ForbiddenError('You cannot upload this kind of file')
  }

  // Tenants' files are always tied to their own record.
  let residentId: string | null = null
  const residentRaw = form.get('residentId')
  if (user.role === 'TENANT') {
    if (!user.residentId) throw new ForbiddenError('Resident record not found')
    residentId = user.residentId
  } else if (typeof residentRaw === 'string' && residentRaw.trim()) {
    residentId = residentRaw.trim()
    await assertResidentAccess(user, residentId)
  }

  const bytes = Buffer.from(await file.arrayBuffer())
  const contentType = sniff(bytes)
  if (!contentType) {
    throw new ValidationError('Only JPG, PNG, WebP photos or PDF files can be uploaded')
  }
  // The claimed type must agree with the content (a renamed file is refused).
  const claimed = (file.type || '').toLowerCase()
  if (claimed && claimed !== 'application/octet-stream' && claimed !== contentType) {
    throw new ValidationError('That file does not look like what its name says. Please choose another.')
  }

  // Plan storage allowance (Settings → Subscription shows usage).
  await assertStorageAvailable(user.organizationId, bytes.length)

  const key = newStorageKey(user.organizationId, contentType)
  try {
    await putObject(key, bytes, contentType)
  } catch (error) {
    void logError('storage.put_failed', error, {
      code: 'INTEGRATION_FAILED',
      route: '/api/uploads',
      organizationId: user.organizationId,
      userId: user.id,
      purpose,
    })
    return fail('We could not save that file right now. Please try again in a moment.', 502, undefined, {
      code: 'INTEGRATION_FAILED',
    })
  }

  const row = await prisma.uploadedFile.create({
    data: {
      organizationId: user.organizationId,
      key,
      contentType,
      size: bytes.length,
      purpose,
      residentId,
      uploadedById: user.id,
    },
    select: { id: true },
  })

  return ok({ id: row.id, url: `/api/uploads/${row.id}`, contentType, size: bytes.length }, { status: 201 })
})
