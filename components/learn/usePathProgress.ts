'use client'

import { useCallback, useEffect, useState } from 'react'

// Lightweight, guest-friendly reading progress for learning paths. We only need
// "which articles has this browser read" — stored as a slug list in
// localStorage, no account required. Signed-in cross-device sync is a future
// extension (mirror this set to a per-user row).

const KEY = '100lights-read-articles'

function readSet(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(KEY) || '[]') as string[]) }
  catch { return new Set() }
}

/** Mark an article read (idempotent). Safe to call from anywhere client-side. */
export function markArticleRead(slug: string): void {
  try {
    const s = readSet()
    if (!s.has(slug)) {
      s.add(slug)
      localStorage.setItem(KEY, JSON.stringify([...s]))
      // Nudge any hooks in this tab (storage event only fires cross-tab).
      window.dispatchEvent(new Event('100lights-progress'))
    }
    // Best-effort account sync — server no-ops for guests (200, no error).
    fetch('/api/learn/progress', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug }),
    }).catch(() => {})
  } catch { /* private mode — progress just won't persist */ }
}

// Once per app session, reconcile the local set with the signed-in account:
// pull the server's reads down, push any local-only ones up. Guests are a no-op.
let syncStarted = false
async function syncWithServer(): Promise<void> {
  try {
    const res = await fetch('/api/learn/progress')
    if (!res.ok) return
    const data = await res.json() as { signedIn: boolean; reads?: string[] }
    if (!data.signedIn) return
    const server = new Set(data.reads ?? [])
    const local = readSet()
    const localOnly = [...local].filter(s => !server.has(s))
    if (localOnly.length) {
      fetch('/api/learn/progress', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slugs: localOnly }),
      }).catch(() => {})
    }
    let changed = false
    for (const s of server) if (!local.has(s)) { local.add(s); changed = true }
    if (changed || localOnly.length) {
      localStorage.setItem(KEY, JSON.stringify([...local]))
      window.dispatchEvent(new Event('100lights-progress'))
    }
  } catch { /* offline / disabled — local set stands */ }
}

/** Reactive read-set for rendering checkmarks / resume state. */
export function useReadArticles(): { read: Set<string>; ready: boolean } {
  const [read, setRead] = useState<Set<string>>(new Set())
  const [ready, setReady] = useState(false)
  const refresh = useCallback(() => { setRead(readSet()); setReady(true) }, [])
  useEffect(() => {
    refresh()
    // Reconcile with the signed-in account once per session; the resulting
    // localStorage write fires '100lights-progress', which refreshes us.
    if (!syncStarted) { syncStarted = true; void syncWithServer() }
    window.addEventListener('storage', refresh)
    window.addEventListener('100lights-progress', refresh)
    return () => {
      window.removeEventListener('storage', refresh)
      window.removeEventListener('100lights-progress', refresh)
    }
  }, [refresh])
  return { read, ready }
}
