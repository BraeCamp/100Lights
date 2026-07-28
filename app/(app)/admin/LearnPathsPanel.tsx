'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'

type Level = 'beginner' | 'intermediate' | 'advanced'

interface AdminPath {
  slug: string
  title: string
  goal: string
  description: string
  emoji: string
  level: Level
  articleSlugs: string[]
  active: boolean
  sortOrder: number | null
  source: 'builtin' | 'edited' | 'custom'
}
interface ArticleRef { slug: string; title: string; draft: boolean }

const BLANK = { slug: '', title: '', emoji: '📚', level: 'beginner' as Level, goal: '', description: '', active: true }

const SOURCE_BADGE: Record<AdminPath['source'], { label: string; color: string; bg: string }> = {
  builtin: { label: 'built-in', color: 'var(--text-muted)', bg: 'var(--bg-surface)' },
  edited: { label: 'edited', color: 'var(--accent-light)', bg: 'rgba(139,92,246,0.14)' },
  custom: { label: 'custom', color: '#34d399', bg: 'rgba(52,211,153,0.14)' },
}

export default function LearnPathsPanel() {
  const [paths, setPaths] = useState<AdminPath[]>([])
  const [articles, setArticles] = useState<ArticleRef[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const [editing, setEditing] = useState<string | null>(null) // slug being edited, null = new
  const [form, setForm] = useState({ ...BLANK })
  const [slugsText, setSlugsText] = useState('')
  const [saving, setSaving] = useState(false)
  const [pick, setPick] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const res = await fetch('/api/admin/learn-paths')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { paths: AdminPath[]; articles: ArticleRef[] }
      setPaths(data.paths); setArticles(data.articles)
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed to load paths') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2600) }
  const known = useMemo(() => new Map(articles.map(a => [a.slug, a])), [articles])
  const slugLines = slugsText.split('\n').map(s => s.trim()).filter(Boolean)
  const unknownSlugs = slugLines.filter(s => !known.has(s))

  function editPath(p: AdminPath) {
    setEditing(p.slug)
    setForm({ slug: p.slug, title: p.title, emoji: p.emoji, level: p.level, goal: p.goal, description: p.description, active: p.active })
    setSlugsText(p.articleSlugs.join('\n'))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  function resetForm() { setEditing(null); setForm({ ...BLANK }); setSlugsText(''); setPick('') }

  function appendSlug(slug: string) {
    setSlugsText(t => (t.split('\n').map(s => s.trim()).includes(slug) ? t : (t ? t + '\n' : '') + slug))
  }

  async function save(e: React.FormEvent) {
    e.preventDefault(); setSaving(true)
    try {
      const res = await fetch('/api/admin/learn-paths', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, articleSlugs: slugLines }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      showToast(editing ? `Saved ${data.slug}` : `Created ${data.slug}`)
      resetForm(); await load()
    } catch (e) { showToast(e instanceof Error ? e.message : 'Save failed') }
    finally { setSaving(false) }
  }

  async function remove(p: AdminPath) {
    const msg = p.source === 'custom' ? `Delete custom path “${p.title}”?` : `Reset “${p.title}” to its built-in default?`
    if (!confirm(msg)) return
    try {
      const res = await fetch(`/api/admin/learn-paths/${encodeURIComponent(p.slug)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      showToast(p.source === 'custom' ? 'Deleted' : 'Reset to default'); await load()
      if (editing === p.slug) resetForm()
    } catch { showToast('Action failed') }
  }

  const inputStyle: React.CSSProperties = { padding: '7px 10px', borderRadius: 8, fontSize: 13, border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text-primary)', outline: 'none', width: '100%' }
  const labelStyle: React.CSSProperties = { fontSize: 10.5, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }

  const pickList = articles.filter(a => !pick || a.slug.includes(pick.toLowerCase()) || a.title.toLowerCase().includes(pick.toLowerCase())).slice(0, 40)

  return (
    <>
      {/* ── Editor ──────────────────────────────────────────────────────── */}
      <form onSubmit={save} className="rounded-xl border p-4 mb-5" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{editing ? `Editing: ${editing}` : 'New path'}</span>
          {editing && <button type="button" onClick={resetForm} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer' }}>+ New instead</button>}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, marginBottom: 12 }}>
          <div><label style={labelStyle}>Title</label><input required value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Make Your First Beat" style={inputStyle} /></div>
          <div><label style={labelStyle}>Slug {editing && <span style={{ fontWeight: 400 }}>(locked)</span>}</label><input required disabled={!!editing} value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} placeholder="make-your-first-beat" style={{ ...inputStyle, opacity: editing ? 0.6 : 1 }} /></div>
          <div><label style={labelStyle}>Emoji</label><input value={form.emoji} onChange={e => setForm(f => ({ ...f, emoji: e.target.value }))} maxLength={4} style={inputStyle} /></div>
          <div><label style={labelStyle}>Level</label>
            <select value={form.level} onChange={e => setForm(f => ({ ...f, level: e.target.value as Level }))} style={inputStyle}>
              <option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option>
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: 'var(--text-secondary)', cursor: 'pointer' }}>
              <input type="checkbox" checked={form.active} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} /> Visible
            </label>
          </div>
        </div>

        <div style={{ marginBottom: 12 }}><label style={labelStyle}>Goal <span style={{ fontWeight: 400 }}>(the promise — what they’ll be able to do)</span></label>
          <input value={form.goal} onChange={e => setForm(f => ({ ...f, goal: e.target.value }))} placeholder="Go from never opening a DAW to a beat with groove." style={inputStyle} /></div>
        <div style={{ marginBottom: 14 }}><label style={labelStyle}>Card description</label>
          <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Short blurb shown on the path card." style={inputStyle} /></div>

        {/* Article list editor */}
        <label style={labelStyle}>Articles, one slug per line — order = reading order</label>
        <textarea value={slugsText} onChange={e => setSlugsText(e.target.value)} rows={Math.max(4, slugLines.length + 1)} spellCheck={false}
          placeholder={'what-is-a-daw-beginners-guide\nwhat-are-bars-and-beats'} style={{ ...inputStyle, fontFamily: 'monospace', resize: 'vertical', lineHeight: 1.6 }} />
        <div style={{ fontSize: 11, color: unknownSlugs.length ? '#f59e0b' : 'var(--text-muted)', margin: '5px 0 12px' }}>
          {slugLines.length} article{slugLines.length === 1 ? '' : 's'}
          {unknownSlugs.length > 0 && ` · ${unknownSlugs.length} unknown slug${unknownSlugs.length === 1 ? '' : 's'}: ${unknownSlugs.join(', ')}`}
        </div>

        {/* Click-to-add picker */}
        <details style={{ marginBottom: 14 }}>
          <summary style={{ fontSize: 12, color: 'var(--accent-light)', cursor: 'pointer' }}>Add from existing articles ({articles.length})</summary>
          <input value={pick} onChange={e => setPick(e.target.value)} placeholder="Filter articles…" style={{ ...inputStyle, margin: '10px 0' }} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 180, overflowY: 'auto' }}>
            {pickList.map(a => {
              const added = slugLines.includes(a.slug)
              return (
                <button type="button" key={a.slug} onClick={() => appendSlug(a.slug)} disabled={added} title={a.slug} style={{
                  fontSize: 11, padding: '4px 9px', borderRadius: 7, cursor: added ? 'default' : 'pointer',
                  border: '1px solid var(--border)', background: added ? 'var(--accent-subtle)' : 'var(--bg-surface)',
                  color: added ? 'var(--accent-light)' : 'var(--text-secondary)', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{added ? '✓ ' : '+ '}{a.title}{a.draft ? ' · draft' : ''}</button>
              )
            })}
          </div>
        </details>

        <button type="submit" disabled={saving} style={{
          padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: saving ? 'default' : 'pointer',
          background: 'rgba(139,92,246,0.2)', color: 'var(--accent-light)', border: '1px solid rgba(139,92,246,0.35)', opacity: saving ? 0.6 : 1,
        }}>{saving ? 'Saving…' : editing ? 'Save changes' : '+ Create path'}</button>
      </form>

      {/* ── List ────────────────────────────────────────────────────────── */}
      {loading ? <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading paths…</p>
        : err ? <p style={{ fontSize: 12, color: 'var(--error)' }}>{err}</p>
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {paths.map(p => {
              const badge = SOURCE_BADGE[p.source]
              const liveN = p.articleSlugs.filter(s => known.get(s) && !known.get(s)!.draft).length
              return (
                <div key={p.slug} className="rounded-xl border p-3" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)', opacity: p.active ? 1 : 0.55 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span aria-hidden style={{ fontSize: 22 }}>{p.emoji}</span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{p.title}</span>
                        <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', padding: '2px 7px', borderRadius: 999, color: badge.color, background: badge.bg }}>{badge.label}</span>
                        {!p.active && <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>hidden</span>}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>
                        <span style={{ fontFamily: 'monospace' }}>{p.slug}</span> · {p.level} · {p.articleSlugs.length} article{p.articleSlugs.length === 1 ? '' : 's'} ({liveN} live)
                      </div>
                    </div>
                    <a href={`/learn/paths/${p.slug}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11.5, color: 'var(--text-muted)', textDecoration: 'none' }}>view ↗</a>
                    <button onClick={() => editPath(p)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 12 }}>Edit</button>
                    {p.source !== 'builtin' && (
                      <button onClick={() => remove(p)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: p.source === 'custom' ? '#ef4444' : 'var(--text-muted)', fontSize: 12 }}>
                        {p.source === 'custom' ? 'Delete' : 'Reset'}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9001, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 16px', fontSize: 13, color: 'var(--text-primary)', boxShadow: '0 4px 20px rgba(0,0,0,0.3)' }}>{toast}</div>
      )}
    </>
  )
}
