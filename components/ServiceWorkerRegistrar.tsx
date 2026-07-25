'use client'

import { useEffect } from 'react'

/**
 * Registers the offline-shell service worker (public/sw.js).
 * Production only — a SW in dev serves stale chunks and fights HMR.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    if (process.env.NODE_ENV !== 'production') {
      // A service worker left over from a production build caches chunks
      // cache-first and serves them stale in dev (which silently masked code
      // changes — e.g. a fixed bug still looked broken). Actively clear it.
      navigator.serviceWorker.getRegistrations()
        .then(regs => regs.forEach(r => r.unregister()))
        .catch(() => {})
      if (window.caches) caches.keys().then(ks => ks.forEach(k => caches.delete(k))).catch(() => {})
      return
    }
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  }, [])
  return null
}
