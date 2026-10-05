import { buildManifest, PWA_APPS, type PwaAppKey } from '@/lib/pwa'

/** One manifest per role app: `/manifests/tenant.webmanifest` and so on. */

export function generateStaticParams() {
  return Object.keys(PWA_APPS).map((app) => ({ file: `${app}.webmanifest` }))
}

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params
  const app = file.replace(/\.webmanifest$/, '') as PwaAppKey
  if (!(app in PWA_APPS)) return new Response('Not found', { status: 404 })

  return new Response(JSON.stringify(buildManifest(app)), {
    headers: { 'Content-Type': 'application/manifest+json' },
  })
}
