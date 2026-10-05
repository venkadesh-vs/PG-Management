import type { MetadataRoute } from 'next'
import { buildManifest } from '@/lib/pwa'

/**
 * Manifest for the public pages and sign-in. Installing from here opens the
 * owner dashboard; the resident, staff and admin areas link their own.
 */
export default function manifest(): MetadataRoute.Manifest {
  return buildManifest('owner')
}
