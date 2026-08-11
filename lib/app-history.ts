'use client'

// Per-app saved-work history for the /apps mini-apps.
//
// Device-first: every save writes to localStorage immediately, so it works offline
// and signed-out. When the user is signed in AND online, the same entry is mirrored
// to their account (/api/app-history → the existing DB) so history follows the
// account across devices. Offline changes are queued and flushed on reconnect.
// Payload is app-defined (whatever restores a session).

import { useCallback, useEffect, useRef, useState } from 'react'
import { useUser } from '@clerk/nextjs'

export interface AppHistoryEntry {
  id: string
  /** Human title, e.g. the beat/clip name. */
  title: string
  /** Saved-at epoch ms. */
  ts: number
  /** Short secondary line, e.g. "120 BPM · Boom Bap". */
  subtitle?: string
  /** Optional tiny data-URI preview. */
  thumb?: string
  /** App-specific payload used to restore the session. */
  data: unknown
}

const keyFor = (slug: string) => `100lights-apphist-${slug}`
const queueKey = (slug: string) => `100lights-apphist-queue-${slug}`
const MAX_ENTRIES = 60

function read(slug: string): AppHistoryEntry[] {
  try { const raw = localStorage.getItem(keyFor(slug)); const arr = raw ? JSON.parse(raw) : []; return Array.isArray(arr) ? arr : [] } catch { return [] }
}
function write(slug: string, entries: AppHistoryEntry[]) {
  try { localStorage.setItem(keyFor(slug), JSON.stringify(entries.slice(0, MAX_ENTRIES))) } catch { /* quota/off */ }
}
const newId = () => { try { return crypto.randomUUID() } catch { return `h-${Date.now()}-${Math.floor(Math.random() * 1e6)}` } }
const online = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false)

// ── Account-sync plumbing (no-ops until signed in + online) ─────────────────────
type QueueOp = { op: 'put'; row: AppHistoryEntry } | { op: 'del'; id: string }
function readQueue(slug: string): QueueOp[] {
  try { const raw = localStorage.getItem(queueKey(slug)); const a = raw ? JSON.parse(raw) : []; return Array.isArray(a) ? a : [] } catch { return [] }
}
function writeQueue(slug: string, q: QueueOp[]) { try { localStorage.setItem(queueKey(slug), JSON.stringify(q.slice(-200))) } catch { /* off */ } }
function enqueue(slug: string, op: QueueOp) { writeQueue(slug, [...readQueue(slug).filter(o => !('id' in o && 'id' in op ? sameTarget(o, op) : false)), op]) }
function sameTarget(a: QueueOp, b: QueueOp) { const ai = a.op === 'put' ? a.row.id : a.id; const bi = b.op === 'put' ? b.row.id : b.id; return ai === bi }

async function pushEntry(slug: string, row: AppHistoryEntry): Promise<boolean> {
  try {
    const res = await fetch('/api/app-history', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: row.id, slug, title: row.title, subtitle: row.subtitle, data: row.data }),
    })
    // 413 = too large to sync; treat as "done" so we stop retrying (it stays local).
    return res.ok || res.status === 413
  } catch { return false }
}
async function deleteEntry(slug: string, id: string): Promise<boolean> {
  try { const res = await fetch(`/api/app-history?id=${encodeURIComponent(id)}`, { method: 'DELETE' }); return res.ok } catch { return false }
}

/** Replay any queued offline changes. Safe to call repeatedly. */
async function flushQueue(slug: string) {
  if (!online()) return
  const q = readQueue(slug)
  if (!q.length) return
  const remaining: QueueOp[] = []
  for (const op of q) {
    const ok = op.op === 'put' ? await pushEntry(slug, op.row) : await deleteEntry(slug, op.id)
    if (!ok) remaining.push(op)
  }
  writeQueue(slug, remaining)
}

/** Merge local + account rows by id, newest-wins, capped. */
function merge(local: AppHistoryEntry[], remote: Array<{ id: string; title: string; subtitle?: string; data?: unknown; updatedAt: string }>): AppHistoryEntry[] {
  const byId = new Map<string, AppHistoryEntry>()
  for (const e of local) byId.set(e.id, e)
  for (const r of remote) {
    const ts = Date.parse(r.updatedAt) || 0
    const cur = byId.get(r.id)
    if (!cur || ts >= cur.ts) byId.set(r.id, { id: r.id, title: r.title, subtitle: r.subtitle, data: r.data, ts })
  }
  return Array.from(byId.values()).sort((a, b) => b.ts - a.ts).slice(0, MAX_ENTRIES)
}

export function useAppHistory(slug: string) {
  const { isSignedIn } = useUser()
  const [entries, setEntries] = useState<AppHistoryEntry[]>([])
  const signedInRef = useRef(false); useEffect(() => { signedInRef.current = !!isSignedIn }, [isSignedIn])

  useEffect(() => { setEntries(read(slug)) }, [slug])

  // Pull from the account (merge), then flush any offline changes — when signed in.
  useEffect(() => {
    if (!isSignedIn || !slug) return
    let cancelled = false
    ;(async () => {
      await flushQueue(slug)
      try {
        const res = await fetch(`/api/app-history?slug=${encodeURIComponent(slug)}`)
        if (!res.ok || cancelled) return
        const remote = await res.json()
        if (cancelled || !Array.isArray(remote)) return
        const merged = merge(read(slug), remote)
        write(slug, merged)
        setEntries(merged)
      } catch { /* offline / not ready */ }
    })()
    return () => { cancelled = true }
  }, [isSignedIn, slug])

  // Flush the offline queue whenever the connection returns.
  useEffect(() => {
    const onOnline = () => { if (signedInRef.current) void flushQueue(slug) }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [slug])

  const syncPut = useCallback((row: AppHistoryEntry) => {
    if (!signedInRef.current) return
    if (online()) { void pushEntry(slug, row).then(ok => { if (!ok) enqueue(slug, { op: 'put', row }) }) }
    else enqueue(slug, { op: 'put', row })
  }, [slug])
  const syncDel = useCallback((id: string) => {
    if (!signedInRef.current) return
    if (online()) { void deleteEntry(slug, id).then(ok => { if (!ok) enqueue(slug, { op: 'del', id }) }) }
    else enqueue(slug, { op: 'del', id })
  }, [slug])

  /** Save new work (or update an existing entry when `id` is supplied). Returns the id. */
  const save = useCallback((entry: { id?: string; title: string; subtitle?: string; thumb?: string; data: unknown }): string => {
    const id = entry.id ?? newId()
    const row: AppHistoryEntry = { id, title: entry.title, subtitle: entry.subtitle, thumb: entry.thumb, data: entry.data, ts: Date.now() }
    setEntries(prev => { const next = [row, ...prev.filter(e => e.id !== id)].slice(0, MAX_ENTRIES); write(slug, next); return next })
    syncPut(row)
    return id
  }, [slug, syncPut])

  const remove = useCallback((id: string) => {
    setEntries(prev => { const next = prev.filter(e => e.id !== id); write(slug, next); return next })
    syncDel(id)
  }, [slug, syncDel])

  const clear = useCallback(() => {
    const ids = read(slug).map(e => e.id)
    write(slug, []); setEntries([])
    ids.forEach(id => syncDel(id))
  }, [slug, syncDel])

  return { entries, save, remove, clear, synced: !!isSignedIn }
}

/** Format a timestamp as a short relative label ("just now", "3h ago", "Aug 11"). */
export function relTime(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000))
  if (s < 45) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  try { return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) } catch { return `${d}d ago` }
}
