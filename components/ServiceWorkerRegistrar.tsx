'use client'

import { useEffect } from 'react'

/**
 * Bump this to force every browser to throw its caches away, once.
 *
 * ⚠️ THE REASON THIS EXISTS. Brae: "It works on safari, but not Brave" — the
 * same deploy, the same code, and two different Apollo engines, because Brave
 * had a service worker holding a months-old /apollo/engine.js and Safari had
 * never registered one. Hours of real fixes went out and never reached the
 * browser that needed them, and from the outside that is indistinguishable from
 * fixes that did not work.
 *
 * Shipping a new service worker fixes it eventually. Eventually is not good
 * enough when somebody is stuck: a browser only re-checks sw.js on its own
 * schedule, and until it does, the old worker keeps answering.
 *
 * So this is the switch that does not wait to be asked. Raise it and every
 * browser, on its next load, drops every Cache Storage entry and re-registers.
 * It runs ONCE per browser per value — the flag is written before the reload,
 * so a failure cannot turn it into a loop.
 */
const PURGE_ID = '2026-09-02-stale-apollo-worklet'
const PURGE_KEY = '100l.cache.purge'

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

    void (async () => {
      // ── The forced reset ──────────────────────────────────────────────────
      let done = ''
      try { done = localStorage.getItem(PURGE_KEY) ?? '' } catch { /* private mode */ }
      if (done !== PURGE_ID) {
        // ⚠️ WRITTEN FIRST, so a browser that fails halfway through still only
        // tries once. A reload loop is a far worse bug than a stale cache.
        try { localStorage.setItem(PURGE_KEY, PURGE_ID) } catch { /* private mode */ }
        try {
          // ⚠️ CACHES ONLY. IndexedDB holds the sound library and offline
          // projects — things that took real time to make and that the server
          // cannot simply send again. Cache Storage holds copies of files it
          // can. Never confuse the two: this is exactly what "clear site data"
          // gets wrong, and why it is the wrong advice to give anybody.
          if (window.caches) {
            const keys = await caches.keys()
            await Promise.all(keys.map(k => caches.delete(k)))
          }
          const regs = await navigator.serviceWorker.getRegistrations()
          await Promise.all(regs.map(r => r.unregister()))
        } catch { /* nothing to clear */ }
        // Straight back in on a clean slate. replace(), not reload(), so the
        // purge does not become an entry in the back history.
        location.replace(location.href)
        return
      }

      const reg = await navigator.serviceWorker.register('/sw.js').catch(() => null)
      if (!reg) return

      // ⚠️ ASK, EVERY LOAD. Browsers re-check sw.js on their own schedule, and
      // a stuck one can keep serving an old worker for a long time. update() is
      // cheap — a conditional request — and it is the difference between a fix
      // landing today and landing whenever.
      reg.update().catch(() => {})

      // A new worker taking over mid-session means the page is running old code
      // against new caches. One reload settles it; the guard stops the reload
      // that the purge above already performed from happening twice.
      let reloading = false
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloading) return
        reloading = true
        location.reload()
      })
    })()
  }, [])
  return null
}
