'use client'

import { useCallback, useEffect, useState } from 'react'

// The content queue — the marketing pipeline's review→approve→publish, in-app.
// Each card is one rendered song-video: preview it, edit the drafted caption,
// pick platforms, approve, then publish (dry-run first). Admin-only route behind
// every action; a normal user can neither see nor reach any of this.

type Result = { id?: string; url?: string; error?: string }
interface Post {
  id: string; createdAt: string; slug: string; format: string
  title: string; caption: string; platforms: string[]
  status: 'draft' | 'approved' | 'published' | 'failed'
  results: Record<string, Result>; error: string | null; publishedAt: string | null
}

const STATUS_COLOR: Record<Post['status'], string> = {
  draft: '#8b88a8', approved: '#3b82f6', published: '#4ade80', failed: '#f87171',
}

export default function ContentQueuePanel() {
  const [posts, setPosts] = useState<Post[]>([])
  const [platforms, setPlatforms] = useState<string[]>(['youtube', 'instagram', 'tiktok'])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [note, setNote] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/admin/content')
      const j = await r.json()
      if (r.ok) { setPosts(j.posts || []); if (j.platforms) setPlatforms(j.platforms) }
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const patch = async (id: string, body: object) => {
    setBusyId(id)
    try {
      const r = await fetch(`/api/admin/content/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (r.ok) setNote(n => ({ ...n, [id]: 'Saved' }))
      await load()
    } finally { setBusyId(null); setTimeout(() => setNote(n => ({ ...n, [id]: '' })), 2000) }
  }
  const approve = async (id: string, approved: boolean) => {
    setBusyId(id)
    try { await fetch(`/api/admin/content/${id}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approved }) }); await load() }
    finally { setBusyId(null) }
  }
  const publish = async (id: string, dryRun: boolean, visibility: string) => {
    setBusyId(id); setNote(n => ({ ...n, [id]: dryRun ? 'Dry run…' : 'Publishing…' }))
    try {
      const r = await fetch(`/api/admin/content/${id}/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dryRun, visibility }) })
      const j = await r.json()
      setNote(n => ({ ...n, [id]: r.ok ? (dryRun ? 'Dry run OK — nothing posted' : 'Published') : `Error: ${j.error}` }))
      await load()
    } finally { setBusyId(null) }
  }
  const del = async (id: string) => {
    if (!confirm('Delete this queued video?')) return
    setBusyId(id)
    try { await fetch(`/api/admin/content/${id}`, { method: 'DELETE' }); await load() } finally { setBusyId(null) }
  }

  if (loading && !posts.length) return <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading queue…</p>
  if (!posts.length) return (
    <p style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>
      Nothing queued. Open a project&rsquo;s video maker (Song Videos tab), pick a format, and hit <b>Send to queue</b> — it lands here for review.
    </p>
  )

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {posts.map(p => <Card key={p.id} p={p} platforms={platforms} busy={busyId === p.id} note={note[p.id]}
        onSave={patch} onApprove={approve} onPublish={publish} onDelete={del} />)}
    </div>
  )
}

function Card({ p, platforms, busy, note, onSave, onApprove, onPublish, onDelete }: {
  p: Post; platforms: string[]; busy: boolean; note?: string
  onSave: (id: string, body: object) => void
  onApprove: (id: string, approved: boolean) => void
  onPublish: (id: string, dryRun: boolean, visibility: string) => void
  onDelete: (id: string) => void
}) {
  const [title, setTitle] = useState(p.title)
  const [caption, setCaption] = useState(p.caption)
  const [sel, setSel] = useState<string[]>(p.platforms)
  const [vis, setVis] = useState('private')
  const dirty = title !== p.title || caption !== p.caption || sel.join() !== p.platforms.join()
  const toggle = (pl: string) => setSel(s => s.includes(pl) ? s.filter(x => x !== pl) : [...s, pl])

  return (
    <div style={{ display: 'flex', gap: 16, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
      {/* Preview */}
      <div style={{ flexShrink: 0, width: 116 }}>
        <video src={`/api/admin/content/${p.id}/video`} controls playsInline
          style={{ width: 116, aspectRatio: '9 / 16', borderRadius: 8, background: '#08070c', display: 'block' }} />
      </div>

      {/* Body */}
      <div style={{ flex: 1, minWidth: 0, display: 'grid', gap: 9 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', color: STATUS_COLOR[p.status], border: `1px solid ${STATUS_COLOR[p.status]}55`, borderRadius: 99, padding: '2px 9px' }}>{p.status}</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{p.slug} · {p.format}</span>
          <button onClick={() => onDelete(p.id)} disabled={busy} style={{ ...ghost, marginLeft: 'auto', color: '#f87171' }}>Delete</button>
        </div>

        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title" style={field} maxLength={100} />
        <textarea value={caption} onChange={e => setCaption(e.target.value)} rows={4} placeholder="Caption" style={{ ...field, resize: 'vertical', fontFamily: 'inherit' }} />

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {platforms.map(pl => (
            <label key={pl} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: 'var(--text-secondary)', cursor: 'pointer' }}>
              <input type="checkbox" checked={sel.includes(pl)} onChange={() => toggle(pl)} /> {pl}
            </label>
          ))}
          {dirty && <button onClick={() => onSave(p.id, { title, caption, platforms: sel })} disabled={busy} style={{ ...ghost, color: 'var(--accent-light)' }}>Save edits</button>}
        </div>

        {/* Per-platform results */}
        {Object.keys(p.results).length > 0 && (
          <div style={{ display: 'grid', gap: 3, fontSize: 12 }}>
            {Object.entries(p.results).map(([pl, r]) => (
              <div key={pl} style={{ color: r.error ? '#f87171' : 'var(--text-secondary)' }}>
                <b>{pl}:</b> {r.error ? r.error : r.url ? <a href={r.url} target="_blank" rel="noreferrer" style={{ color: '#4ade80' }}>{r.url}</a> : (r.id || 'ok')}
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 2 }}>
          {p.status === 'draft' && <button onClick={() => onApprove(p.id, true)} disabled={busy} style={primary}>Approve</button>}
          {p.status === 'approved' && <>
            <button onClick={() => onApprove(p.id, false)} disabled={busy} style={ghost}>Unapprove</button>
            <select value={vis} onChange={e => setVis(e.target.value)} style={{ ...field, width: 'auto', padding: '5px 8px' }} title="YouTube visibility">
              <option value="private">private</option>
              <option value="unlisted">unlisted</option>
              <option value="public">public</option>
            </select>
            <button onClick={() => onPublish(p.id, true, vis)} disabled={busy} style={ghost}>Dry run</button>
            <button onClick={() => onPublish(p.id, false, vis)} disabled={busy} style={{ ...primary, background: '#4ade80' }}>Publish</button>
          </>}
          {(p.status === 'published' || p.status === 'failed') && <button onClick={() => onPublish(p.id, false, vis)} disabled={busy} style={ghost}>Re-run</button>}
          {note && <span style={{ fontSize: 12, color: note.startsWith('Error') ? '#f87171' : '#4ade80' }}>{note}</span>}
        </div>
      </div>
    </div>
  )
}

const field: React.CSSProperties = { width: '100%', boxSizing: 'border-box', fontSize: 13, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text-primary)', outline: 'none' }
const ghost: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', background: 'transparent', border: '1px solid var(--border)', borderRadius: 7, padding: '5px 11px', cursor: 'pointer' }
const primary: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, color: '#0a0812', background: 'var(--accent)', border: 'none', borderRadius: 7, padding: '6px 14px', cursor: 'pointer' }
