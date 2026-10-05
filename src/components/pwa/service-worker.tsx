'use client'

import { useEffect } from 'react'

/**
 * Registers /sw.js in production builds. Dev skips it so edits are never
 * served from a stale asset cache.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {
      // Installing still works without it; there is just no offline screen.
    })
  }, [])
  return null
}
