'use client'
import { useCallback, useEffect, useState } from 'react'
import { BG_CATEGORIES } from '@/lib/bg-library'

interface Row {
  id: string; title: string; mp4: string; poster: string; category: string
  brightness: string; speed: string; tags: string[]; author: string; status: string; blockEdits?: string[]
}
const BRIGHT = ['dark', 'mid', 'bright']
const SPEED = ['slow', 'standard', 'fast']
// Auto-editor effects that can be enabled/disabled per clip (matches EDIT_CMDS in LightningBug).
const EFFECTS = ['cut', 'zoom', 'crop', 'skip', 'shake', 'flash', 'freeze', 'blink', 'spin', 'mirror', 'rgb', 'strobe', 'huespin', 'invert']

const sel = { padding: '4px 6px', borderRadius: 7, fontSize: 12, border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text-secondary)' } as const

export default function PexelsAdmin() {
  const [rows, setRows] = useState<Row[]>([])
  const [total, setTotal] = useState(0)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('any')
  const [loading, setLoading] = useState(false)
  // fetch controls
  const [fq, setFq] = useState('')
  const [fcat, setFcat] = useState('Abstract')
  const [fcount, setFcount] = useState(15)
  const [fetching, setFetching] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(`/api/admin/pexels?status=${status}&q=${encodeURIComponent(q)}&limit=120`)
      const d = await r.json()
      setRows(d.rows ?? []); setTotal(d.total ?? 0)
    } finally { setLoading(false) }
  }, [q, status])
  useEffect(() => { load() }, [load])

  const doFetch = async (random: boolean) => {
    setFetching(true); setMsg(null)
    try {
      const r = await fetch('/api/admin/pexels', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(random ? { random: true, count: fcount } : { query: fq, category: fcat, count: fcount }) })
      const d = await r.json()
      if (!r.ok) setMsg(d.error || 'Fetch failed')
      else { setMsg(`“${d.query}” → fetched ${d.fetched}, added ${d.added} new`); await load() }
    } catch { setMsg('Fetch failed') } finally { setFetching(false) }
  }
  const patch = async (id: string, p: Partial<Row>) => {
    setRows(rs => rs.map(r => r.id === id ? { ...r, ...p } : r))
    await fetch('/api/admin/pexels', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, ...p }) })
  }
  const del = async (id: string) => {
    setRows(rs => rs.filter(r => r.id !== id)); setTotal(t => Math.max(0, t - 1))
    await fetch(`/api/admin/pexels?id=${id}`, { method: 'DELETE' })
  }

  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 20px' }}>
        Fetch background videos from Pexels (we store only the stream link + tags, never the file), preview them,
        correct tags, and delete ones that don’t fit. <strong>{total}</strong> active in the catalog.
      </p>

      {/* Fetch */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: 14, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-card)', marginBottom: 14 }}>
        <input value={fq} onChange={e => setFq(e.target.value)} placeholder="Pexels search (e.g. ink in water)" style={{ ...sel, minWidth: 220, flex: '1 1 220px', padding: '8px 10px' }} />
        <select value={fcat} onChange={e => setFcat(e.target.value)} style={{ ...sel, padding: '8px 10px' }}>{BG_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select>
        <select value={fcount} onChange={e => setFcount(Number(e.target.value))} style={{ ...sel, padding: '8px 10px' }}>{[10, 15, 20, 30].map(n => <option key={n} value={n}>{n} clips</option>)}</select>
        <button type="button" onClick={() => doFetch(false)} disabled={fetching || !fq.trim()} style={{ padding: '8px 16px', borderRadius: 9, fontSize: 13, fontWeight: 800, cursor: 'pointer', border: 'none', background: 'var(--accent)', color: '#0e0d12', opacity: fetching || !fq.trim() ? 0.5 : 1 }}>Fetch</button>
        <button type="button" onClick={() => doFetch(true)} disabled={fetching} style={{ padding: '8px 16px', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', opacity: fetching ? 0.5 : 1 }}>{fetching ? 'Fetching…' : 'Fetch random'}</button>
        {msg && <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--accent)' }}>{msg}</span>}
      </div>

      {/* Filter */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter catalog by tag / category / title" style={{ ...sel, minWidth: 240, flex: '1 1 240px', padding: '8px 10px' }} />
        <select value={status} onChange={e => setStatus(e.target.value)} style={{ ...sel, padding: '8px 10px' }}>
          <option value="any">All</option><option value="active">Active</option><option value="hidden">Hidden</option>
        </select>
        {loading && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading…</span>}
      </div>

      {/* Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
        {rows.map(r => (
          <div key={r.id} style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--bg-card)', opacity: r.status === 'hidden' ? 0.5 : 1 }}>
            <div style={{ position: 'relative', aspectRatio: '16 / 9', background: '#08070d' }} onMouseEnter={() => setHover(r.id)} onMouseLeave={() => setHover(h => (h === r.id ? null : h))}>
              <img src={r.poster} alt="" loading="lazy" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
              {hover === r.id && <video src={r.mp4} autoPlay muted loop playsInline style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />}
              <span style={{ position: 'absolute', top: 6, left: 6, padding: '2px 7px', borderRadius: 999, fontSize: 10, fontWeight: 800, background: 'rgba(0,0,0,0.6)', color: '#fff' }}>{r.title}</span>
            </div>
            <div style={{ padding: 10, display: 'grid', gap: 6 }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <select value={r.category} onChange={e => patch(r.id, { category: e.target.value })} style={sel}>{BG_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select>
                <select value={r.brightness} onChange={e => patch(r.id, { brightness: e.target.value })} style={sel}>{BRIGHT.map(b => <option key={b}>{b}</option>)}</select>
                <select value={r.speed} onChange={e => patch(r.id, { speed: e.target.value })} style={sel}>{SPEED.map(s => <option key={s}>{s}</option>)}</select>
              </div>
              <input defaultValue={r.tags.join(', ')} onBlur={e => { const tags = e.target.value.split(',').map(t => t.trim()).filter(Boolean); patch(r.id, { tags }) }} placeholder="tags, comma separated" style={{ ...sel, padding: '5px 8px' }} />
              {/* Per-clip auto-editor effects: click to disable one on this video (dim = off). Green = allowed. */}
              <div>
                <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>Effects</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {EFFECTS.map(fx => {
                    const off = (r.blockEdits ?? []).includes(fx)
                    return <button key={fx} type="button" title={off ? 'Disabled on this clip — click to enable' : 'Enabled — click to disable'}
                      onClick={() => { const cur = new Set(r.blockEdits ?? []); if (cur.has(fx)) cur.delete(fx); else cur.add(fx); patch(r.id, { blockEdits: [...cur] }) }}
                      style={{ padding: '2px 7px', borderRadius: 999, fontSize: 10.5, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', textDecoration: off ? 'line-through' : 'none', background: off ? 'transparent' : 'rgba(52,211,153,0.16)', color: off ? 'var(--text-muted)' : '#34d399', opacity: off ? 0.55 : 1 }}>{fx}</button>
                  })}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button type="button" onClick={() => patch(r.id, { status: r.status === 'hidden' ? 'active' : 'hidden' })} style={{ flex: 1, padding: '5px 8px', borderRadius: 7, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)' }}>{r.status === 'hidden' ? 'Unhide' : 'Hide'}</button>
                <button type="button" onClick={() => del(r.id)} style={{ padding: '5px 10px', borderRadius: 7, fontSize: 11.5, fontWeight: 800, cursor: 'pointer', border: '1px solid #7f1d1d', background: 'transparent', color: '#f87171' }}>Delete</button>
              </div>
              {r.author && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Pexels · {r.author}</span>}
            </div>
          </div>
        ))}
        {!loading && rows.length === 0 && <p style={{ gridColumn: '1 / -1', fontSize: 13, color: 'var(--text-muted)' }}>Nothing yet — use “Fetch random” above to pull some in.</p>}
      </div>
    </div>
  )
}
