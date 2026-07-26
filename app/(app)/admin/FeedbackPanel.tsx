'use client'

// Feedback inbox — triage everything testers send through the sidebar modal.

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Check, RotateCcw, Trash2 } from 'lucide-react'

interface Entry {
  id: string
  email: string | null
  message: string
  page: string | null
  user_agent: string | null
  created_at: string
  resolved_at: string | null
}

type Filter = 'open' | 'resolved' | 'all'

export default function FeedbackPanel() {
  const [items, setItems] = useState<Entry[] | null>(null)
  const [filter, setFilter] = useState<Filter>('open')
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [counts, setCounts] = useState<{ open: number; total: number }>({ open: 0, total: 0 })
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async (f: Filter, pg: number) => {
    setErr(null)
    try {
      const r = await fetch(`/api/feedback?filter=${f}&page=${pg}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const d = await r.json()
      setItems(d.items ?? [])
      setHasMore(!!d.hasMore)
      setCounts(d.counts ?? { open: 0, total: 0 })
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed to load'); setItems([]) }
  }, [])

  useEffect(() => { void load('open', 0) }, [load])

  function switchFilter(f: Filter) { setFilter(f); setPage(0); void load(f, 0) }
  function go(pg: number) { setPage(pg); void load(filter, pg) }

  async function setResolved(e: Entry, resolved: boolean) {
    setBusy(e.id); setErr(null)
    const r = await fetch('/api/feedback', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: e.id, resolved }) }).catch(() => null)
    setBusy(null)
    if (!r?.ok) { setErr(`Couldn't update${r ? ` (${r.status})` : ''}.`); return }
    void load(filter, page)
  }

  async function remove(e: Entry) {
    if (!confirm('Delete this feedback entry permanently?')) return
    setBusy(e.id); setErr(null)
    const r = await fetch(`/api/feedback?id=${e.id}`, { method: 'DELETE' }).catch(() => null)
    setBusy(null)
    if (!r?.ok) { setErr(`Couldn't delete${r ? ` (${r.status})` : ''}.`); return }
    void load(filter, page)
  }

  const tab = (f: Filter, label: string, n?: number) => (
    <button onClick={() => switchFilter(f)}
      style={{ fontSize: 11, fontWeight: 700, padding: '5px 12px', borderRadius: 99, cursor: 'pointer',
        border: `1px solid ${filter === f ? 'var(--accent)' : 'var(--border)'}`,
        background: filter === f ? 'rgba(124,58,237,0.15)' : 'transparent',
        color: filter === f ? 'var(--accent-light)' : 'var(--text-muted)' }}>
      {label}{n != null && <span style={{ opacity: 0.7 }}> {n}</span>}
    </button>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {tab('open', 'Open', counts.open)}
        {tab('resolved', 'Resolved', counts.total - counts.open)}
        {tab('all', 'All', counts.total)}
        <button onClick={() => void load(filter, page)} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', marginLeft: 'auto' }}>
          <RefreshCw size={11} /> Refresh
        </button>
      </div>
      {err && <div style={{ border: '1px solid rgba(239,68,68,0.5)', background: 'rgba(239,68,68,0.1)', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#f87171' }}>{err}</div>}

      {items?.map(e => (
        <div key={e.id} style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--bg-card)', border: '1px solid var(--border)', opacity: e.resolved_at ? 0.6 : 1 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 10, color: 'var(--text-muted)', marginBottom: 5, flexWrap: 'wrap' }}>
            <span>{new Date(e.created_at).toLocaleString()}</span>
            {e.email && <span>· {e.email}</span>}
            {e.page && <span>· on {e.page}</span>}
            {e.resolved_at && <span style={{ color: '#34d399', fontWeight: 700 }}>· resolved</span>}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
              {e.resolved_at
                ? <button onClick={() => void setResolved(e, false)} disabled={busy === e.id} title="Reopen" style={iconBtn('var(--text-muted)')}><RotateCcw size={13} /></button>
                : <button onClick={() => void setResolved(e, true)} disabled={busy === e.id} title="Mark resolved" style={iconBtn('#34d399')}><Check size={14} /></button>}
              <button onClick={() => void remove(e)} disabled={busy === e.id} title="Delete" style={iconBtn('#ef4444')}><Trash2 size={13} /></button>
            </div>
          </div>
          <p style={{ fontSize: 12.5, color: 'var(--text-primary)', margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{e.message}</p>
        </div>
      ))}
      {items?.length === 0 && <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>{filter === 'open' ? 'Nothing open — inbox zero.' : 'No feedback here.'}</p>}
      {items === null && <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Loading…</p>}

      {(page > 0 || hasMore) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
          <button onClick={() => go(Math.max(0, page - 1))} disabled={page === 0} style={pageBtn(page === 0)}>‹ Prev</button>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Page {page + 1}</span>
          <button onClick={() => go(page + 1)} disabled={!hasMore} style={pageBtn(!hasMore)}>Next ›</button>
        </div>
      )}
    </div>
  )
}

const iconBtn = (color: string): React.CSSProperties => ({ background: 'none', border: 'none', color, cursor: 'pointer', display: 'flex', padding: 2 })
const pageBtn = (disabled: boolean): React.CSSProperties => ({ fontSize: 12, padding: '5px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1 })
