'use client'

// Sound Targets — the owner's ground-truth of what things should sound like.
// Add a target (label + category + "what it should sound like" description,
// optional reference clip + tags + app link), then play / edit / delete the
// list. Writes go through /api/admin/app-targets (isAdmin-guarded).

import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw, Trash2, Pencil, Check, X, Upload, Play, Download } from 'lucide-react'
import { MINI_APPS } from '@/lib/apps-registry'

interface Target {
  id: string; label: string; category: string; description: string
  r2Key: string | null; contentType: string; duration: number | null
  tags: string[]; appSlug: string | null; audioUrl: string | null
  createdAt?: string
}

const inputS: React.CSSProperties = { fontSize: 12, padding: '5px 8px', borderRadius: 6, background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-primary)', outline: 'none' }
const labelS: React.CSSProperties = { fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 3, display: 'block' }

// Free-text but seeded with the buckets the pipeline expects.
const CATEGORY_SUGGESTIONS = ['instrument', 'genre', 'app', 'detection']

function fileDuration(file: File): Promise<number> {
  return new Promise(res => {
    const url = URL.createObjectURL(file)
    const a = new Audio()
    const done = (d: number) => { URL.revokeObjectURL(url); res(Number.isFinite(d) ? d : 0) }
    a.onloadedmetadata = () => done(a.duration)
    a.onerror = () => done(0)
    a.src = url
    setTimeout(() => done(a.duration || 0), 4000)
  })
}

export default function AppTargetsPanel() {
  const [items, setItems] = useState<Target[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  // Add form
  const [label, setLabel] = useState('')
  const [category, setCategory] = useState('app')
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState('')
  const [appSlug, setAppSlug] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Edit
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<Partial<Target>>({})

  // Playback (resolved presigned URLs, per target id)
  const [playing, setPlaying] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/app-targets')
      const d = await r.json()
      setItems(d.items ?? [])
    } catch { setItems([]) }
  }, [])
  useEffect(() => { void load() }, [load])

  const resetForm = () => { setLabel(''); setCategory('app'); setDescription(''); setTags(''); setAppSlug(''); setFile(null); if (fileRef.current) fileRef.current.value = '' }

  async function add() {
    if (!label.trim()) { setMsg('A label is required'); return }
    setBusy(true); setMsg('')
    try {
      const tagList = tags.split(',').map(t => t.trim()).filter(Boolean)
      let r: Response
      if (file) {
        const duration = await fileDuration(file)
        const qs = new URLSearchParams({ label: label.trim(), category: category.trim() || 'app', description, duration: String(duration) })
        if (tagList.length) qs.set('tags', tagList.join(','))
        if (appSlug) qs.set('appSlug', appSlug)
        r = await fetch(`/api/admin/app-targets?${qs.toString()}`, { method: 'POST', headers: { 'Content-Type': file.type || 'audio/mpeg' }, body: file })
      } else {
        r = await fetch('/api/admin/app-targets', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label: label.trim(), category: category.trim() || 'app', description, tags: tagList, appSlug: appSlug || null }),
        })
      }
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      setMsg('Target added ✓'); resetForm(); await load()
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Add failed') }
    finally { setBusy(false) }
  }

  async function saveEdit(id: string) {
    const body = { id, label: draft.label, category: draft.category, description: draft.description, tags: draft.tags ?? null, appSlug: draft.appSlug ?? null }
    const r = await fetch('/api/admin/app-targets', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
    if (!r?.ok) { setMsg('Edit failed'); return }
    setEditing(null); setMsg('Updated ✓'); await load()
  }

  async function remove(t: Target) {
    if (!confirm(`Delete sound target "${t.label}"?${t.r2Key ? ' This deletes its reference clip too.' : ''}`)) return
    const r = await fetch(`/api/admin/app-targets?id=${encodeURIComponent(t.id)}`, { method: 'DELETE' }).catch(() => null)
    if (!r?.ok) { setMsg('Delete failed'); return }
    setMsg('Deleted ✓'); await load()
  }

  async function play(t: Target) {
    if (playing[t.id]) return
    try {
      const r = await fetch(`/api/admin/app-targets?download=${encodeURIComponent(t.id)}`)
      const d = await r.json().catch(() => ({}))
      if (!r.ok || !d.url) throw new Error(d.error || 'No audio')
      setPlaying(p => ({ ...p, [t.id]: d.url }))
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Playback failed') }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* ── Add form ─────────────────────────────────────────────────────── */}
      <div style={{ border: '1px solid rgba(245,158,11,0.35)', background: 'rgba(245,158,11,0.05)', borderRadius: 10, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: '#f59e0b' }}>Add a sound target — tell the AI what it should sound like</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          <div>
            <label style={labelS}>Label</label>
            <input value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Warm analog bass" style={{ ...inputS, width: '100%' }} />
          </div>
          <div>
            <label style={labelS}>Category</label>
            <input value={category} onChange={e => setCategory(e.target.value)} list="target-cats" placeholder="app / instrument / genre / detection" style={{ ...inputS, width: '100%' }} />
            <datalist id="target-cats">{CATEGORY_SUGGESTIONS.map(c => <option key={c} value={c} />)}</datalist>
          </div>
          <div>
            <label style={labelS}>For app <span style={{ fontWeight: 400 }}>(optional)</span></label>
            <select value={appSlug} onChange={e => setAppSlug(e.target.value)} style={{ ...inputS, width: '100%', cursor: 'pointer' }}>
              <option value="">— none —</option>
              {MINI_APPS.map(a => <option key={a.slug} value={a.slug}>{a.title}</option>)}
            </select>
          </div>
          <div>
            <label style={labelS}>Tags <span style={{ fontWeight: 400 }}>(comma-sep)</span></label>
            <input value={tags} onChange={e => setTags(e.target.value)} placeholder="warm, vintage, sub" style={{ ...inputS, width: '100%' }} />
          </div>
        </div>
        <div>
          <label style={labelS}>What it should sound like</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
            placeholder="Describe the target sound in plain language — timbre, dynamics, references. This is the ground truth generation/detection is tuned toward."
            style={{ ...inputS, width: '100%', resize: 'vertical', lineHeight: 1.5 }} />
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12, fontWeight: 700, padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Upload size={13} /> {file ? file.name.slice(0, 28) : 'Reference audio (optional)'}
            <input ref={fileRef} type="file" accept="audio/*" style={{ display: 'none' }} onChange={e => setFile(e.target.files?.[0] ?? null)} />
          </label>
          {file && <button onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = '' }} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11 }}>clear</button>}
          <button onClick={() => void add()} disabled={busy} style={{
            marginLeft: 'auto', padding: '7px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700, border: 'none',
            background: '#d97706', color: '#fff', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
          }}>{busy ? 'Adding…' : '+ Add target'}</button>
        </div>
        <span style={{ fontSize: 10.5, color: msg.includes('✓') ? '#34d399' : msg ? '#f59e0b' : 'var(--text-muted)' }}>
          {msg || 'A reference clip is optional — a description alone is a valid target. Clips: WAV/MP3/OGG/M4A up to 25 MB. Targets live in Postgres + R2; the Node pipeline (composer / ML) reads them via the JSON export at /api/admin/app-targets?export=1 — wiring that into compose/ML is a later step.'}
        </span>
      </div>

      {/* ── List ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{items?.length ?? '…'} target{items?.length === 1 ? '' : 's'}</span>
        <button onClick={() => void load()} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}>
          <RefreshCw size={11} /> Refresh
        </button>
        <a href="/api/admin/app-targets?export=1" target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--accent-light)', textDecoration: 'none', marginLeft: 'auto' }}>
          <Download size={11} /> Export JSON
        </a>
      </div>

      {items?.map(t => (
        <div key={t.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', background: 'var(--bg-card)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {editing === t.id ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <input value={draft.label ?? ''} onChange={e => setDraft(d => ({ ...d, label: e.target.value }))} placeholder="Label" style={{ ...inputS, flex: '1 1 160px' }} />
                <input value={draft.category ?? ''} onChange={e => setDraft(d => ({ ...d, category: e.target.value }))} placeholder="category" style={{ ...inputS, width: 130 }} />
                <select value={draft.appSlug ?? ''} onChange={e => setDraft(d => ({ ...d, appSlug: e.target.value || null }))} style={{ ...inputS, cursor: 'pointer' }}>
                  <option value="">— no app —</option>
                  {MINI_APPS.map(a => <option key={a.slug} value={a.slug}>{a.title}</option>)}
                </select>
                <input value={(draft.tags ?? []).join(', ')} onChange={e => setDraft(d => ({ ...d, tags: e.target.value.split(',').map(x => x.trim()).filter(Boolean) }))} placeholder="tags" style={{ ...inputS, width: 150 }} />
              </div>
              <textarea value={draft.description ?? ''} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))} rows={2} placeholder="What it should sound like" style={{ ...inputS, width: '100%', resize: 'vertical' }} />
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => void saveEdit(t.id)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 6, border: 'none', background: '#d97706', color: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}><Check size={13} /> Save</button>
                <button onClick={() => setEditing(null)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11 }}><X size={13} /> Cancel</button>
              </div>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{t.label}</span>
                <span style={{ fontSize: 9.5, padding: '1px 7px', borderRadius: 99, background: 'var(--bg-base)', color: 'var(--text-muted)' }}>{t.category}</span>
                {t.appSlug && <span style={{ fontSize: 10, color: 'var(--accent-light)', fontFamily: 'monospace' }}>{t.appSlug}</span>}
                {t.tags.length > 0 && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{t.tags.join(' · ')}</span>}
                {t.r2Key
                  ? <span style={{ fontSize: 9.5, color: '#34d399' }}>♪ reference</span>
                  : <span style={{ fontSize: 9.5, color: 'var(--text-muted)' }}>description only</span>}
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  {t.r2Key && !playing[t.id] && (
                    <button onClick={() => void play(t)} title="Play reference" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', padding: 2 }}><Play size={13} /></button>
                  )}
                  <button onClick={() => { setEditing(t.id); setDraft({ label: t.label, category: t.category, description: t.description, tags: t.tags, appSlug: t.appSlug }) }} title="Edit" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', padding: 2 }}><Pencil size={13} /></button>
                  <button onClick={() => void remove(t)} title="Delete" style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', display: 'flex', padding: 2 }}><Trash2 size={13} /></button>
                </div>
              </div>
              {t.description && <p style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>{t.description}</p>}
              {playing[t.id] && <audio controls autoPlay preload="none" src={playing[t.id]} style={{ width: '100%', height: 30, display: 'block' }} />}
            </>
          )}
        </div>
      ))}
      {items?.length === 0 && <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>No sound targets yet — add one above.</p>}
    </div>
  )
}
