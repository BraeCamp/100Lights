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
      // ⚠️ The cache reset itself lives in <head> (see app/layout.tsx), so that
      // it can decide BEFORE the bundle starts loading rather than after. By
      // the time this component exists the question is already settled — doing
      // it again here would be a second reload for the same reason.
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
