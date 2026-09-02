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
 *
 * ⚠️ IT RUNS ONLY WHERE IT CAN REMEMBER HAVING RUN. Writing the flag first was
 * not enough — where storage throws, the write was swallowed and the purge
 * reloaded anyway, so the next load did it again. The flag is read back, and no
 * purge happens unless it stuck. A stale cache is a bad day; an app that never
 * finishes loading is a broken product.
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
        // ⚠️ ONLY IF THE FLAG ACTUALLY STUCK — and it is READ BACK to find out.
        //
        // Writing it first was not enough. Where storage is unavailable —
        // Brave with shields blocking it, a partitioned third-party context, a
        // full quota, private mode — setItem THROWS, the catch swallowed it,
        // and the purge reloaded anyway. The next load found no flag and did it
        // again: an app that never finishes loading.
        //
        // Brae: "It still will load in safari and won't load in Brave." That
        // was this, shipped by me an hour earlier. A stale cache is a bad day;
        // a reload loop is a broken product, so when the flag cannot be proven
        // to persist, the purge simply does not happen.
        let recorded = false
        try {
          localStorage.setItem(PURGE_KEY, PURGE_ID)
          recorded = localStorage.getItem(PURGE_KEY) === PURGE_ID
        } catch { recorded = false }
        if (!recorded) {
          // No way to remember having done this, so never start. Register
          // normally; the service worker's own version bump still clears the
          // old caches, just on the browser's schedule rather than at once.
          await navigator.serviceWorker.register('/sw.js').catch(() => {})
          return
        }
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
      // against new caches, and one reload settles it.
      //
      // ⚠️ ONLY WHEN ONE WAS ALREADY IN CHARGE. controllerchange also fires the
      // FIRST time a worker claims an uncontrolled page, which is the ordinary
      // first visit — reloading there is a reload for no reason, and on a
      // browser that keeps re-installing it is another way to spin forever.
      // An UPDATE is the case worth reloading for, and an update by definition
      // replaces a controller that was already there.
      const hadController = !!navigator.serviceWorker.controller
      let reloading = false
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController || reloading) return
        reloading = true
        location.reload()
      })
    })()
  }, [])
  return null
}
