import type { MetadataRoute } from 'next'
import { publicEnv } from '@/lib/public-env'

/**
 * The marketing site is indexable; every signed-in surface and the API are
 * not. Those are behind auth anyway — this keeps them out of results.
 */
export default function robots(): MetadataRoute.Robots {
  const base = publicEnv.siteUrl.replace(/\/$/, '')
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/app/', '/admin/', '/tenant/', '/worker/', '/api/', '/login'],
    },
    sitemap: `${base}/sitemap.xml`,
  }
}
