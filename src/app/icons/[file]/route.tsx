import { ImageResponse } from 'next/og'
import { PWA_APPS, type PwaAppKey } from '@/lib/pwa'

/**
 * Home-screen icons, drawn from the StayFlow mark so there are no binary
 * assets to keep in sync. `/icons/tenant-192.png`, `/icons/owner-512-maskable.png`…
 * Maskable icons fill the whole square so Android can crop them to any shape.
 */

const FILE = /^(tenant|worker|owner|admin)-(\d{2,4})(-maskable)?\.png$/
const SIZES = [180, 192, 512]

export function generateStaticParams() {
  return (Object.keys(PWA_APPS) as PwaAppKey[]).flatMap((app) =>
    SIZES.flatMap((size) => [{ file: `${app}-${size}.png` }, { file: `${app}-${size}-maskable.png` }]),
  )
}

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params
  const match = FILE.exec(file)
  const size = match ? Number(match[2]) : 0
  if (!match || !SIZES.includes(size)) return new Response('Not found', { status: 404 })

  const color = PWA_APPS[match[1] as PwaAppKey].color
  const maskable = Boolean(match[3])
  // iOS rounds the 180px touch icon itself and paints transparent corners
  // black, so it is drawn full-bleed like the maskable ones.
  const fullBleed = maskable || size === 180
  // Maskable art must sit inside the central 80% safe zone.
  const glyph = Math.round(size * (maskable ? 0.5 : 0.62))

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: fullBleed ? 0 : size * 0.22,
          backgroundColor: color,
          backgroundImage: 'linear-gradient(135deg, rgba(255,255,255,0.16), rgba(0,0,0,0.22))',
        }}
      >
        <svg width={glyph} height={glyph} viewBox="0 0 24 24" fill="none">
          <path
            d="M4 20V7.5a1 1 0 0 1 .55-.9l7-3.4a1 1 0 0 1 .9 0l7 3.4a1 1 0 0 1 .55.9V20"
            stroke="white"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M8 16.5v-3.2h8v3.2" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M7 16.5h10" stroke="white" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="10" cy="11.4" r="1.15" fill="white" />
          <path d="M3 20h18" stroke="white" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </div>
    ),
    { width: size, height: size },
  )
}
