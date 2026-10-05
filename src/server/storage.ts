import 'server-only'

import { createHash, createHmac, randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * File storage for uploads (complaint photos, task proof, KYC scans).
 *
 * Two providers, picked by STORAGE_PROVIDER:
 *  - `local` (default): files under ./storage/uploads/<orgId>/<random>.<ext>.
 *    Never inside public/ — every read goes through GET /api/uploads/[id],
 *    which checks who is asking. Fine for one server; serverless hosts
 *    (Netlify, Vercel) have no lasting disk, so use `s3` there.
 *  - `s3`: any S3-compatible bucket (AWS S3, Cloudflare R2, MinIO, Wasabi).
 *    Uploads are PUT server-side; downloads are 5-minute presigned GET URLs.
 *    Signed with AWS Signature V4 using node:crypto — no SDK dependency.
 *
 * Keys stored in the database look like `<orgId>/<random>.<ext>`; the S3
 * object key is that with an `uploads/` prefix.
 */

export type StorageProvider = 'local' | 's3'

export function storageProvider(): StorageProvider {
  return process.env.STORAGE_PROVIDER === 's3' ? 's3' : 'local'
}

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
}

/** A fresh, unguessable key for an organization's file. */
export function newStorageKey(organizationId: string, contentType: string) {
  const safeOrg = organizationId.replace(/[^a-zA-Z0-9_-]/g, '')
  return `${safeOrg}/${randomBytes(18).toString('base64url')}.${EXT[contentType] ?? 'bin'}`
}

function assertSafeKey(key: string) {
  if (!/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\.[a-z0-9]+$/.test(key)) {
    throw new Error('Invalid storage key')
  }
}

// ----------------------------------------------------------------- local ----

function localRoot() {
  return path.resolve(process.cwd(), 'storage', 'uploads')
}

function localPath(key: string) {
  assertSafeKey(key)
  const root = localRoot()
  const full = path.resolve(root, key)
  // Belt and braces on top of the key pattern: stay inside the root.
  if (!full.startsWith(root + path.sep)) throw new Error('Invalid storage key')
  return full
}

/** Reads a locally stored file. Throws if missing. */
export async function readLocal(key: string): Promise<Buffer> {
  return readFile(localPath(key))
}

// -------------------------------------------------------------------- s3 ----

type S3Config = {
  endpoint: URL
  pathStyle: boolean
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
}

function s3Config(): S3Config {
  const bucket = process.env.S3_BUCKET ?? ''
  const accessKeyId = process.env.S3_ACCESS_KEY_ID ?? ''
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY ?? ''
  const region = process.env.S3_REGION || 'auto'
  if (!bucket || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'STORAGE_PROVIDER=s3 needs S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY. See docs/storage-setup.md.',
    )
  }
  // A custom endpoint (R2, MinIO…) is addressed path-style: https://host/bucket/key.
  // Plain AWS uses virtual-hosted style: https://bucket.s3.region.amazonaws.com/key.
  if (process.env.S3_ENDPOINT) {
    return {
      endpoint: new URL(process.env.S3_ENDPOINT),
      pathStyle: true,
      region,
      bucket,
      accessKeyId,
      secretAccessKey,
    }
  }
  const awsRegion = region === 'auto' ? 'us-east-1' : region
  return {
    endpoint: new URL(`https://${bucket}.s3.${awsRegion}.amazonaws.com`),
    pathStyle: false,
    region: awsRegion,
    bucket,
    accessKeyId,
    secretAccessKey,
  }
}

/** RFC 3986 encoding as SigV4 expects (encodeURIComponent leaves !'()* alone). */
function rfc3986(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

function sha256Hex(data: string | Buffer | Uint8Array) {
  return createHash('sha256').update(data).digest('hex')
}

function hmac(key: Buffer | string, data: string) {
  return createHmac('sha256', key).update(data).digest()
}

function amzDates(now = new Date()) {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '') // 20261005T101500Z
  return { amzDate, dateStamp: amzDate.slice(0, 8) }
}

function signingKey(cfg: S3Config, dateStamp: string) {
  const kDate = hmac(`AWS4${cfg.secretAccessKey}`, dateStamp)
  const kRegion = hmac(kDate, cfg.region)
  const kService = hmac(kRegion, 's3')
  return hmac(kService, 'aws4_request')
}

function objectLocation(cfg: S3Config, key: string) {
  const objectKey = `uploads/${key}`
  const encodedKey = objectKey.split('/').map(rfc3986).join('/')
  const basePath = cfg.endpoint.pathname.replace(/\/+$/, '')
  const canonicalUri = cfg.pathStyle
    ? `${basePath}/${rfc3986(cfg.bucket)}/${encodedKey}`
    : `${basePath}/${encodedKey}`
  return { host: cfg.endpoint.host, canonicalUri, origin: `${cfg.endpoint.protocol}//${cfg.endpoint.host}` }
}

async function s3Put(key: string, bytes: Buffer, contentType: string) {
  const cfg = s3Config()
  const { host, canonicalUri, origin } = objectLocation(cfg, key)
  const { amzDate, dateStamp } = amzDates()
  const payloadHash = sha256Hex(bytes)

  const headers: Record<string, string> = {
    'content-type': contentType,
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  }
  const signedHeaders = Object.keys(headers).sort().join(';')
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((h) => `${h}:${headers[h].trim()}\n`)
    .join('')
  const canonicalRequest = ['PUT', canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n')
  const scope = `${dateStamp}/${cfg.region}/s3/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n')
  const signature = createHmac('sha256', signingKey(cfg, dateStamp)).update(stringToSign).digest('hex')

  const res = await fetch(`${origin}${canonicalUri}`, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      Authorization: `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body: new Uint8Array(bytes),
  })
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300)
    throw new Error(`S3 upload failed (${res.status}): ${detail}`)
  }
}

/** A presigned GET URL for the object, valid for `expiresSeconds` (default 5 min). */
function s3PresignedGet(key: string, expiresSeconds = 300) {
  const cfg = s3Config()
  const { host, canonicalUri, origin } = objectLocation(cfg, key)
  const { amzDate, dateStamp } = amzDates()
  const scope = `${dateStamp}/${cfg.region}/s3/aws4_request`

  const query: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${cfg.accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresSeconds),
    'X-Amz-SignedHeaders': 'host',
  }
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${rfc3986(k)}=${rfc3986(query[k])}`)
    .join('&')
  const canonicalRequest = [
    'GET',
    canonicalUri,
    canonicalQuery,
    `host:${host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n')
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n')
  const signature = createHmac('sha256', signingKey(cfg, dateStamp)).update(stringToSign).digest('hex')
  return `${origin}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`
}

// ---------------------------------------------------------------- public ----

/** Stores the bytes under `key` with the active provider. */
export async function putObject(key: string, bytes: Buffer, contentType: string) {
  assertSafeKey(key)
  if (storageProvider() === 's3') {
    await s3Put(key, bytes, contentType)
    return
  }
  const full = localPath(key)
  await mkdir(path.dirname(full), { recursive: true })
  await writeFile(full, bytes, { flag: 'wx' })
}

/**
 * Where the browser should fetch the bytes: a short-lived presigned URL for
 * S3, or null for local storage (the caller streams via readLocal).
 */
export function getDownloadUrl(key: string): string | null {
  assertSafeKey(key)
  return storageProvider() === 's3' ? s3PresignedGet(key) : null
}
