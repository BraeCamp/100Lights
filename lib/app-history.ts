'use client'

// Per-app saved-work history for the /apps mini-apps. Each app namespaces its
// own list in localStorage; the shared AppChrome renders it as a "History"
// sheet where a user can reopen or delete past work. Payload is app-defined
// (whatever that app needs to restore a session). Paying-member online sync can
// layer on top later via an /api route — the shape here is the source of truth.

import { useCallback, useEffect, useState } from 'react'

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
const MAX_ENTRIES = 60

function read(slug: string): AppHistoryEntry[] {
  try {
    const raw = localStorage.getItem(keyFor(slug))
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr : []
  } catch { return [] }
}

function write(slug: string, entries: AppHistoryEntry[]) {
  try { localStorage.setItem(keyFor(slug), JSON.stringify(entries.slice(0, MAX_ENTRIES))) } catch { /* quota/off */ }
}

const newId = () => {
  try { return crypto.randomUUID() } catch { return `h-${Date.now()}-${Math.floor(Math.random() * 1e6)}` }
}

export function useAppHistory(slug: string) {
  const [entries, setEntries] = useState<AppHistoryEntry[]>([])

  useEffect(() => { setEntries(read(slug)) }, [slug])

  const commit = useCallback((next: AppHistoryEntry[]) => {
    const capped = next.slice(0, MAX_ENTRIES)
    setEntries(capped)
    write(slug, capped)
  }, [slug])

  /** Save new work (or update an existing entry when `id` is supplied). Returns the id. */
  const save = useCallback((entry: { id?: string; title: string; subtitle?: string; thumb?: string; data: unknown }): string => {
    const id = entry.id ?? newId()
    const row: AppHistoryEntry = { id, title: entry.title, subtitle: entry.subtitle, thumb: entry.thumb, data: entry.data, ts: Date.now() }
    setEntries(prev => {
      const rest = prev.filter(e => e.id !== id)
      const next = [row, ...rest].slice(0, MAX_ENTRIES)
      write(slug, next)
      return next
    })
    return id
  }, [slug])

  const remove = useCallback((id: string) => {
    setEntries(prev => { const next = prev.filter(e => e.id !== id); write(slug, next); return next })
  }, [slug])

  const clear = useCallback(() => commit([]), [commit])

  return { entries, save, remove, clear }
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
