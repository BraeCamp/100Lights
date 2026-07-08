'use client'

import { useEffect } from 'react'

/**
 * Registers the offline-shell service worker (public/sw.js).
 * Production only — a SW in dev serves stale chunks and fights HMR.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  }, [])
  return null
}
