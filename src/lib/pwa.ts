import type { MetadataRoute } from 'next'
import { publicEnv } from '@/lib/public-env'

/**
 * Each role installs as its own home-screen app: residents and workers get a
 * phone app that opens straight into their area, owners and admins get the
 * dashboard. The scope stays at `/` so signing in and out never drops the
 * installed app back into a browser tab.
 */
export type PwaAppKey = 'tenant' | 'worker' | 'owner' | 'admin'

export const PWA_APPS: Record<
  PwaAppKey,
  { name: string; shortName: string; description: string; startUrl: string; color: string }
> = {
  tenant: {
    name: `${publicEnv.appName} Resident`,
    shortName: publicEnv.appName,
    description: 'Pay rent, raise complaints, check the menu and read notices from your PG.',
    startUrl: '/tenant',
    color: '#2563eb',
  },
  worker: {
    name: `${publicEnv.appName} Staff`,
    shortName: `${publicEnv.appName} Staff`,
    description: 'Your tasks, kitchen board, shopping list and attendance.',
    startUrl: '/worker',
    color: '#d97706',
  },
  owner: {
    name: `${publicEnv.appName} Owner`,
    shortName: `${publicEnv.appName}`,
    description: 'Run your PGs: residents, beds, rent, complaints, food, staff and reports.',
    startUrl: '/app',
    color: '#1d4ed8',
  },
  admin: {
    name: `${publicEnv.appName} Admin`,
    shortName: `${publicEnv.appName} Admin`,
    description: 'Platform administration for organizations, plans and billing.',
    startUrl: '/admin',
    color: '#0f172a',
  },
}

export const PWA_ICON_SIZES = [192, 512] as const

export function pwaIconUrl(app: PwaAppKey, size: number, maskable = false) {
  return `/icons/${app}-${size}${maskable ? '-maskable' : ''}.png`
}

export function buildManifest(app: PwaAppKey): MetadataRoute.Manifest {
  const def = PWA_APPS[app]
  return {
    id: def.startUrl,
    name: def.name,
    short_name: def.shortName,
    description: def.description,
    start_url: def.startUrl,
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f8fafc',
    theme_color: def.color,
    categories: ['business', 'productivity', 'lifestyle'],
    icons: PWA_ICON_SIZES.flatMap((size) => [
      { src: pwaIconUrl(app, size), sizes: `${size}x${size}`, type: 'image/png', purpose: 'any' as const },
      {
        src: pwaIconUrl(app, size, true),
        sizes: `${size}x${size}`,
        type: 'image/png',
        purpose: 'maskable' as const,
      },
    ]),
  }
}

/** Layout metadata that points a role's pages at its own manifest and icon. */
export function pwaMetadata(app: PwaAppKey) {
  const def = PWA_APPS[app]
  return {
    manifest: `/manifests/${app}.webmanifest`,
    appleWebApp: { capable: true, title: def.shortName, statusBarStyle: 'default' as const },
    icons: { apple: [{ url: pwaIconUrl(app, 180), sizes: '180x180' }] },
  }
}
