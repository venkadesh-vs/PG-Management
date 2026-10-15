import { NextResponse } from 'next/server'
import { getDownloadUrl } from '@/server/storage'

/**
 * GET /api/videos/<file> — the how-it-works videos live in the private
 * Backblaze bucket under videos/. This answers with a redirect to a
 * signed link (valid for a few hours, so pausing and seeking keep working);
 * the video bytes never pass through the website's own servers.
 */
const NAME = /^[a-z0-9-]+(\.(en|ta|hi|te))?\.(mp4|jpg|vtt)$/

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params
  if (!NAME.test(file)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // Storage keys allow one dot, so setup.ta.mp4 is stored as videos/setup-ta.mp4.
  const url = getDownloadUrl(`videos/${file.replace(/\.(en|ta|hi|te)\./, '-$1.')}`, 4 * 60 * 60)
  // Local development without S3: the files sit in public/videos.
  const target = url ?? `/videos/${file}`
  return NextResponse.redirect(new URL(target, _request.url), {
    status: 302,
    headers: { 'Cache-Control': 'private, max-age=3000' },
  })
}
