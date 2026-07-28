'use client'

import { useCallback, useEffect, useState } from 'react'

interface Notice {
  id: string
  complainantName: string
  email: string
  workDescription: string
  infringingUrl: string
  signature: string
  status: 'open' | 'resolved'
  createdAt: string
}

export default function DmcaPanel() {
  const [rows, setRows] = useState<Notice[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const res = await fetch('/api/admin/dmca')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setRows((await res.json() as { notices: Notice[] }).notices)
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed to load notices') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  async function setStatus(n: Notice, status: 'open' | 'resolved') {
    try {
      const res = await fetch('/api/admin/dmca', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: n.id, status }),
      })
      if (!res.ok) throw new Error()
      await load()
    } catch { /* ignore */ }
  }

  const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const open = rows.filter(r => r.status === 'open')

  if (loading) return <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading notices…</p>
  if (err) return <p style={{ fontSize: 12, color: 'var(--error)' }}>{err}</p>
  if (rows.length === 0) return <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No copyright notices. The public form is at <span style={{ fontFamily: 'monospace', color: 'var(--accent-light)' }}>/legal/dmca</span>.</p>

  return (
    <>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>{open.length} open · {rows.length} total</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map(n => (
          <div key={n.id} className="rounded-xl border p-4" style={{ borderColor: n.status === 'open' ? 'color-mix(in srgb, #f59e0b 34%, var(--border))' : 'var(--border)', background: 'var(--bg-card)', opacity: n.status === 'resolved' ? 0.6 : 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px', borderRadius: 999, background: n.status === 'open' ? 'rgba(245,158,11,0.15)' : 'var(--bg-surface)', color: n.status === 'open' ? '#f59e0b' : 'var(--text-muted)' }}>{n.status}</span>
              <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 13 }}>{n.complainantName}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{n.email}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>{fmt(n.createdAt)}</span>
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginBottom: 5, lineHeight: 1.5 }}><strong style={{ color: 'var(--text-primary)' }}>Work:</strong> {n.workDescription}</div>
            <div style={{ fontSize: 12, marginBottom: 8 }}><strong style={{ color: 'var(--text-primary)' }}>Location:</strong>{' '}
              <a href={/^https?:\/\//.test(n.infringingUrl) ? n.infringingUrl : undefined} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-light)', wordBreak: 'break-all' }}>{n.infringingUrl}</a>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>Signed: {n.signature}</span>
              <button onClick={() => setStatus(n, n.status === 'open' ? 'resolved' : 'open')} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 11, fontWeight: 600 }}>
                {n.status === 'open' ? 'Mark resolved' : 'Reopen'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
