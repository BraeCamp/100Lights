/**
 * 100Lights service worker — offline shell caching.
 *
 * Strategy:
 *  - /_next/static/*  → cache-first (content-hashed, immutable)
 *  - public assets    → stale-while-revalidate
 *  - navigations      → network-first, falling back to the cached copy of the
 *    same page, then to any cached editor page, so the app opens offline
 *  - /api/*, non-GET, and cross-origin requests (R2, Clerk, PostHog, Sentry)
 *    are never touched
 */

const VERSION = 'v1'
const STATIC_CACHE = `100l-static-${VERSION}`
const PAGE_CACHE = `100l-pages-${VERSION}`
const ASSET_CACHE = `100l-assets-${VERSION}`
const KEEP = new Set([STATIC_CACHE, PAGE_CACHE, ASSET_CACHE])

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => !KEEP.has(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

function cacheFirst(request, cacheName) {
  return caches.open(cacheName).then(cache =>
    cache.match(request).then(hit => {
      if (hit) return hit
      return fetch(request).then(res => {
        if (res.ok) cache.put(request, res.clone())
        return res
      })
    })
  )
}

function staleWhileRevalidate(request, cacheName) {
  return caches.open(cacheName).then(cache =>
    cache.match(request).then(hit => {
      const refresh = fetch(request)
        .then(res => {
          if (res.ok) cache.put(request, res.clone())
          return res
        })
        .catch(() => hit)
      return hit || refresh
    })
  )
}

function networkFirstNavigation(request) {
  return caches.open(PAGE_CACHE).then(cache =>
    fetch(request)
      .then(res => {
        if (res.ok) cache.put(request, res.clone())
        return res
      })
      .catch(async () => {
        const exact = await cache.match(request)
        if (exact) return exact
        // Same path, different query (e.g. /new?modules=audio&…)
        const samePath = await cache.match(request, { ignoreSearch: true })
        if (samePath) return samePath
        return new Response(
          '<!doctype html><html><body style="background:#0d0d14;color:#e5e5e5;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h1 style="font-size:20px">You&rsquo;re offline</h1><p style="color:#9a9aa5;font-size:13px">This page hasn&rsquo;t been cached yet. Reconnect and try again.</p></div></body></html>',
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        )
      })
  )
}

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request, STATIC_CACHE))
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request))
    return
  }

  if (/\.(?:js|css|woff2?|svg|png|jpe?g|webp|ico|wav|mp3|webm)$/.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request, ASSET_CACHE))
  }
})
