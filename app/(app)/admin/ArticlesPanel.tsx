'use client'

// Admin → Articles: the editorial desk for /learn. List every article (repo
// drafts + DB), edit in markdown with live preview, publish with a toggle
// (DB saves go live instantly — no deploy), and generate new drafts via the
// Anthropic API. Repo articles are editable too: saving one writes a DB row
// with the same slug, which overrides the file.

import { useState, useEffect, useCallback } from 'react'
import { renderMarkdown } from '@/lib/simple-markdown'

interface Row {
  slug: string
  title: string
  description: string
  date: string
  tags: string
  draft: boolean
  body: string
  source: 'repo' | 'db'
}

const input: React.CSSProperties = {
  width: '100%', fontSize: 13, padding: '8px 10px', borderRadius: 8,
  background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-primary)', outline: 'none',
}

export default function ArticlesPanel() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [sel, setSel] = useState<Row | null>(null)
  const [preview, setPreview] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [genTopic, setGenTopic] = useState('')
  const [genNotes, setGenNotes] = useState('')

  const load = useCallback(async () => {
    const r = await fetch('/api/admin/articles').catch(() => null)
    const next: Row[] = r?.ok ? (await r.json()).articles as Row[] : []
    setRows(next)
  }, [])

  useEffect(() => {
    let alive = true
    fetch('/api/admin/articles')
      .then(async r => { if (alive) setRows(r.ok ? (await r.json()).articles as Row[] : []) })
      .catch(() => { if (alive) setRows([]) })
    return () => { alive = false }
  }, [])

  async function save(row: Row, opts?: { thenReload?: boolean }) {
    setBusy('save'); setMsg('')
    try {
      const r = await fetch('/api/admin/articles', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: row.slug, title: row.title, description: row.description, date: row.date, tags: row.tags, draft: row.draft, body: row.body }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? 'Save failed')
      setMsg('Saved ✓')
      if (opts?.thenReload !== false) await load()
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Save failed') } finally { setBusy(null) }
  }

  async function remove(slug: string) {
    if (!window.confirm(`Delete "${slug}" from the database? (A repo file with the same slug would become visible again.)`)) return
    await fetch(`/api/admin/articles?slug=${encodeURIComponent(slug)}`, { method: 'DELETE' })
    setSel(null)
    await load()
  }

  async function generate() {
    if (!genTopic.trim()) return
    setBusy('gen'); setMsg('')
    try {
      const r = await fetch('/api/admin/articles/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: genTopic, notes: genNotes }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? 'Generation failed')
      setSel({
        slug: d.slug, title: d.title, description: d.description,
        date: new Date().toISOString().slice(0, 10), tags: '', draft: true, body: d.body, source: 'db',
      })
      setPreview(true)
      setMsg('Draft generated — review, edit, and save.')
      setGenTopic(''); setGenNotes('')
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Generation failed') } finally { setBusy(null) }
  }

  if (sel) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={() => { setSel(null); setMsg('') }} style={{ fontSize: 12, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}>← All articles</button>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>{msg}</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: sel.draft ? '#f59e0b' : '#34d399', fontWeight: 700, cursor: 'pointer' }}>
            <input type="checkbox" checked={!sel.draft} onChange={e => setSel({ ...sel, draft: !e.target.checked })} />
            {sel.draft ? 'Draft' : 'Published'}
          </label>
          <button onClick={() => setPreview(p => !p)} style={{ fontSize: 12, padding: '6px 12px', borderRadius: 7, border: '1px solid var(--border)', background: preview ? 'var(--bg-card)' : 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            {preview ? 'Edit' : 'Preview'}
          </button>
          <button onClick={() => void save(sel)} disabled={busy === 'save'} style={{ fontSize: 12, fontWeight: 700, padding: '6px 16px', borderRadius: 7, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer' }}>
            {busy === 'save' ? 'Saving…' : 'Save'}
          </button>
        </div>

        {!preview ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10 }}>
              <div>
                <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>TITLE</label>
                <input style={input} value={sel.title} onChange={e => setSel({ ...sel, title: e.target.value })} />
              </div>
              <div>
                <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>SLUG</label>
                <input style={input} value={sel.slug} onChange={e => setSel({ ...sel, slug: e.target.value })} />
              </div>
              <div>
                <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>DATE</label>
                <input style={input} value={sel.date} onChange={e => setSel({ ...sel, date: e.target.value })} />
              </div>
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>DESCRIPTION (meta / list card)</label>
              <input style={input} value={sel.description} onChange={e => setSel({ ...sel, description: e.target.value })} />
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>TAGS (comma-separated)</label>
              <input style={input} value={sel.tags} onChange={e => setSel({ ...sel, tags: e.target.value })} />
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>BODY — markdown; use `@video caption` for a clip slot, `@video(url) caption` once recorded</label>
              <textarea
                style={{ ...input, minHeight: 420, fontFamily: 'var(--font-geist-mono)', fontSize: 12.5, lineHeight: 1.6, resize: 'vertical' }}
                value={sel.body}
                onChange={e => setSel({ ...sel, body: e.target.value })}
              />
            </div>
            <div>
              <button onClick={() => void remove(sel.slug)} style={{ fontSize: 11, background: 'none', border: '1px solid var(--border)', color: '#ef4444', cursor: 'pointer', padding: '5px 12px', borderRadius: 7 }}>Delete from database</button>
            </div>
          </>
        ) : (
          <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '24px 28px', background: 'var(--bg-base)', maxWidth: 760 }}>
            {renderMarkdown(sel.body)}
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Generate */}
      <div style={{ border: '1px solid rgba(139,92,246,0.35)', background: 'rgba(124,58,237,0.06)', borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: '#a78bfa' }}>Generate a draft</span>
        <input style={input} placeholder="Topic — e.g. Recording vocals at home with just a browser" value={genTopic} onChange={e => setGenTopic(e.target.value)} />
        <input style={input} placeholder="Optional direction — angle, audience, things to include…" value={genNotes} onChange={e => setGenNotes(e.target.value)} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => void generate()} disabled={busy === 'gen' || !genTopic.trim()} style={{ fontSize: 12, fontWeight: 700, padding: '7px 16px', borderRadius: 8, border: 'none', background: '#7c3aed', color: '#fff', cursor: 'pointer', opacity: genTopic.trim() ? 1 : 0.5 }}>
            {busy === 'gen' ? 'Writing… (30–60s)' : 'Generate draft'}
          </button>
          <span style={{ fontSize: 11, color: msg.includes('✓') || msg.includes('review') ? '#34d399' : '#ef4444' }}>{msg}</span>
        </div>
      </div>

      {/* New blank */}
      <div>
        <button
          onClick={() => setSel({ slug: '', title: '', description: '', date: new Date().toISOString().slice(0, 10), tags: '', draft: true, body: '# Title\n\nStart writing…', source: 'db' })}
          style={{ fontSize: 12, fontWeight: 700, padding: '7px 14px', borderRadius: 8, border: '1px dashed var(--border)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}
        >+ New article</button>
      </div>

      {/* List */}
      {rows === null && <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading…</p>}
      {rows?.length === 0 && <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No articles yet.</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows?.map(r => (
          <button key={r.slug} onClick={() => { setSel(r); setPreview(false); setMsg('') }} style={{
            display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', padding: '10px 14px',
            borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-card)', cursor: 'pointer',
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</div>
              <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 2 }}>/learn/{r.slug} · {r.date}</div>
            </div>
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.06em', padding: '2px 8px', borderRadius: 99, flexShrink: 0, color: r.source === 'repo' ? '#60a5fa' : '#a78bfa', border: `1px solid ${r.source === 'repo' ? 'rgba(96,165,250,0.4)' : 'rgba(167,139,250,0.4)'}` }}>
              {r.source === 'repo' ? 'REPO' : 'DB'}
            </span>
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.06em', padding: '2px 8px', borderRadius: 99, flexShrink: 0, color: r.draft ? '#f59e0b' : '#34d399', border: `1px solid ${r.draft ? 'rgba(245,158,11,0.4)' : 'rgba(52,211,153,0.4)'}` }}>
              {r.draft ? 'DRAFT' : 'LIVE'}
            </span>
            <a
              href={`/learn/${r.slug}`} target="_blank" rel="noreferrer"
              onClick={e => e.stopPropagation()}
              style={{ fontSize: 11, color: 'var(--text-muted)', textDecoration: 'none', flexShrink: 0 }}
            >View ↗</a>
          </button>
        ))}
      </div>
    </div>
  )
}
