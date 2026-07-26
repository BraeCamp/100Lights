'use client'

// Official sound catalog — upload sounds that ship to EVERY user's library.
// Distinct from the device-local Sound Library panel: these live server-side
// (catalog_sounds + R2) and sync to all accounts via /api/catalog.

import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw, Trash2, Pencil, Check, X, Upload } from 'lucide-react'
import { LIBRARY_CATEGORIES, CATEGORY_LABELS, type LibraryCategory } from '@/lib/sound-library'

interface CatalogItem {
  id: string; name: string; category: string; url: string; duration: number
  folder?: string; parentFolder?: string; tags?: string[]; key?: string; bpm?: number
}

const inputS: React.CSSProperties = { fontSize: 12, padding: '5px 8px', borderRadius: 6, background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-primary)', outline: 'none' }

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

export default function CatalogPanel() {
  const [items, setItems] = useState<CatalogItem[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [category, setCategory] = useState<LibraryCategory>('custom')
  const [folder, setFolder] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<Partial<CatalogItem>>({})
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/catalog')
      const d = await r.json()
      setItems(d.items ?? [])
    } catch { setItems([]) }
  }, [])
  useEffect(() => { void load() }, [load])

  async function upload(files: FileList) {
    setBusy(true); setMsg('')
    try {
      let n = 0
      for (const file of Array.from(files)) {
        if (!/^audio\//.test(file.type) && !/\.(wav|mp3|ogg|m4a|webm)$/i.test(file.name)) continue
        const name = file.name.replace(/\.[^.]+$/, '')
        const duration = await fileDuration(file)
        const qs = new URLSearchParams({ name, category, duration: String(duration) })
        if (folder.trim()) qs.set('folder', folder.trim())
        const r = await fetch(`/api/admin/catalog?${qs.toString()}`, { method: 'POST', headers: { 'Content-Type': file.type || 'audio/mpeg' }, body: file })
        if (r.ok) n++
        else { const e = await r.json().catch(() => ({})); setMsg(e.error || `Upload failed for ${name}`) }
      }
      if (n) setMsg(`${n} sound${n === 1 ? '' : 's'} added to the catalog ✓`)
      await load()
    } finally { setBusy(false); if (fileRef.current) fileRef.current.value = '' }
  }

  async function saveEdit(id: string) {
    const body = { id, name: draft.name, category: draft.category, folder: draft.folder || null, tags: draft.tags ?? null, key: draft.key || null, bpm: draft.bpm ?? null }
    const r = await fetch('/api/admin/catalog', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
    if (!r?.ok) { setMsg('Edit failed'); return }
    setEditing(null); setMsg('Updated ✓'); await load()
  }

  async function remove(it: CatalogItem) {
    if (!confirm(`Remove "${it.name}" from the catalog for ALL users? This deletes the file too.`)) return
    const r = await fetch(`/api/admin/catalog?id=${it.id}`, { method: 'DELETE' }).catch(() => null)
    if (!r?.ok) { setMsg('Delete failed'); return }
    setMsg('Removed from catalog ✓'); await load()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Upload */}
      <div style={{ border: '1px solid rgba(52,211,153,0.35)', background: 'rgba(52,211,153,0.05)', borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: '#34d399' }}>Add sounds to the catalog — ships to every user</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>Category
            <select value={category} onChange={e => setCategory(e.target.value as LibraryCategory)} style={{ ...inputS, marginLeft: 6, cursor: 'pointer' }}>
              {LIBRARY_CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>Folder (optional)
            <input value={folder} onChange={e => setFolder(e.target.value)} placeholder="e.g. Vintage Kicks" style={{ ...inputS, marginLeft: 6, width: 160 }} />
          </label>
          <label style={{ fontSize: 12, fontWeight: 700, padding: '7px 14px', borderRadius: 8, border: 'none', background: '#059669', color: '#fff', cursor: busy ? 'default' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, opacity: busy ? 0.6 : 1 }}>
            <Upload size={13} /> {busy ? 'Uploading…' : 'Upload audio'}
            <input ref={fileRef} type="file" accept="audio/*" multiple style={{ display: 'none' }} disabled={busy} onChange={e => { if (e.target.files?.length) void upload(e.target.files) }} />
          </label>
        </div>
        <span style={{ fontSize: 10.5, color: msg.includes('✓') ? '#34d399' : msg ? '#f59e0b' : 'var(--text-muted)' }}>
          {msg || 'Uploaded sounds appear in the editor Sound Library for all users within ~1 minute. WAV/MP3/OGG/M4A, up to 25 MB each.'}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{items?.length ?? '…'} catalog sounds</span>
        <button onClick={() => void load()} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}>
          <RefreshCw size={11} /> Refresh
        </button>
      </div>

      {items?.map(it => (
        <div key={it.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', background: 'var(--bg-card)', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {editing === it.id ? (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <input value={draft.name ?? ''} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} placeholder="Name" style={{ ...inputS, flex: '1 1 160px' }} />
              <select value={draft.category ?? 'custom'} onChange={e => setDraft(d => ({ ...d, category: e.target.value }))} style={{ ...inputS, cursor: 'pointer' }}>
                {LIBRARY_CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</option>)}
              </select>
              <input value={draft.folder ?? ''} onChange={e => setDraft(d => ({ ...d, folder: e.target.value }))} placeholder="Folder" style={{ ...inputS, width: 120 }} />
              <input value={(draft.tags ?? []).join(', ')} onChange={e => setDraft(d => ({ ...d, tags: e.target.value.split(',').map(t => t.trim()).filter(Boolean) }))} placeholder="tags, comma-sep" style={{ ...inputS, width: 140 }} />
              <input value={draft.key ?? ''} onChange={e => setDraft(d => ({ ...d, key: e.target.value }))} placeholder="key" style={{ ...inputS, width: 56 }} />
              <input value={draft.bpm ?? ''} onChange={e => setDraft(d => ({ ...d, bpm: Number(e.target.value) || undefined }))} placeholder="bpm" type="number" style={{ ...inputS, width: 64 }} />
              <button onClick={() => void saveEdit(it.id)} style={{ display: 'flex', padding: 5, borderRadius: 6, border: 'none', background: '#059669', color: '#fff', cursor: 'pointer' }}><Check size={14} /></button>
              <button onClick={() => setEditing(null)} style={{ display: 'flex', padding: 5, borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={14} /></button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>{it.name}</span>
              <span style={{ fontSize: 9.5, padding: '1px 7px', borderRadius: 99, background: 'var(--bg-base)', color: 'var(--text-muted)' }}>{CATEGORY_LABELS[it.category as LibraryCategory] ?? it.category}</span>
              {it.folder && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>📁 {it.folder}</span>}
              {it.tags?.length ? <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{it.tags.join(' · ')}</span> : null}
              {it.key && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{it.key}</span>}
              {it.bpm ? <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{it.bpm} BPM</span> : null}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                <button onClick={() => { setEditing(it.id); setDraft({ name: it.name, category: it.category, folder: it.folder, tags: it.tags, key: it.key, bpm: it.bpm }) }} title="Edit" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', padding: 2 }}><Pencil size={13} /></button>
                <button onClick={() => void remove(it)} title="Remove from catalog" style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', display: 'flex', padding: 2 }}><Trash2 size={13} /></button>
              </div>
            </div>
          )}
          <audio controls preload="none" src={it.url} style={{ width: '100%', height: 30, display: 'block' }} />
        </div>
      ))}
      {items?.length === 0 && <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>No catalog sounds yet — upload some above.</p>}
    </div>
  )
}
