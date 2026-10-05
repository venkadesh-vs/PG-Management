/*
 * StayFlow service worker.
 *
 * Keeps the installed apps fast and gives them a proper offline screen.
 * Pages and API responses hold personal, live data (rent, complaints,
 * payments), so they are never cached — only the hashed build assets and
 * icons are, and a page request that fails shows /offline instead.
 */

const VERSION = 'stayflow-v1'
const OFFLINE_URL = '/offline'

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(VERSION)
      const response = await fetch(OFFLINE_URL, { cache: 'reload' })
      await cache.put(OFFLINE_URL, response.clone())
      // Cache the offline page's own CSS/JS so it renders with no network.
      const html = await response.text()
      const assets = [...new Set(html.match(/\/_next\/static\/[^"'\s)]+/g) ?? [])]
      await Promise.all(assets.map((url) => cache.add(url).catch(() => undefined)))
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => (await caches.match(OFFLINE_URL)) ?? Response.error()),
    )
    return
  }

  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request)
        if (cached) return cached
        const response = await fetch(request)
        if (response.ok) {
          const cache = await caches.open(VERSION)
          cache.put(request, response.clone())
        }
        return response
      })(),
    )
  }
})
