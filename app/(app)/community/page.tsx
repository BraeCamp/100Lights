'use client'

import { useEffect, useState } from 'react'
import { ArrowBigUp, Download, Upload, Trash2, Music, Piano, BookOpen, X } from 'lucide-react'
import { listCommunity, toggleVote, importItem, shareSample, sharePreset, type CommunityItem } from '@/lib/community'
import { getPresets, noteRangeLabel, type MidiPreset } from '@/lib/midi-presets'
import { libraryGetAll, initLibrary, type LibraryEntry } from '@/lib/sound-library'
import { useUser } from '@clerk/nextjs'

type Kind = 'all' | 'sample' | 'preset' | 'recipe'

const KIND_META: Record<Exclude<Kind, 'all'>, { label: string; color: string; icon: typeof Music }> = {
  sample: { label: 'Sample', color: '#3b82f6', icon: Music },
  preset: { label: 'Preset', color: '#a78bfa', icon: Piano },
  recipe: { label: 'Recipe', color: '#f59e0b', icon: BookOpen },
}

export default function CommunityPage() {
  const { user, isLoaded } = useUser()
  const [items, setItems] = useState<CommunityItem[] | null>(null)
  const [kind, setKind] = useState<Kind>('all')
  const [sort, setSort] = useState<'top' | 'new'>('top')
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [showUpload, setShowUpload] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { if (isLoaded) initLibrary(user?.id ?? null) }, [isLoaded, user?.id])

  async function load() {
    try {
      setItems(await listCommunity(kind === 'all' ? undefined : kind, sort))
      setError(null)
    } catch {
      setError('Could not load the community feed.')
    }
  }
  useEffect(() => { void load() }, [kind, sort]) // eslint-disable-line react-hooks/exhaustive-deps

  function flash(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3500) }

  async function handleVote(item: CommunityItem) {
    try {
      const r = await toggleVote(item.id)
      setItems(prev => prev?.map(i => i.id === item.id ? { ...i, votes: r.votes, votedByMe: r.votedByMe } : i) ?? prev)
    } catch { flash('Vote failed') }
  }

  async function handleImport(item: CommunityItem) {
    setBusy(item.id)
    try {
      flash(await importItem(item))
      setItems(prev => prev?.map(i => i.id === item.id ? { ...i, downloads: i.downloads + 1 } : i) ?? prev)
    } catch (e) { flash(e instanceof Error ? e.message : 'Import failed') }
    finally { setBusy(null) }
  }

  async function handleDelete(item: CommunityItem) {
    if (!confirm(`Remove "${item.name}" from the community?`)) return
    await fetch(`/api/community/${item.id}`, { method: 'DELETE' }).catch(() => {})
    void load()
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: 'var(--bg-base)' }}>
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '28px 20px 60px' }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>Community</h1>
          <button onClick={() => setShowUpload(true)} style={{
            marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700,
            padding: '7px 14px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer',
          }}><Upload size={13} /> Share something</button>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 18px' }}>
          Samples, presets, and recipes shared by other producers. Vote up what sounds good; import anything straight into your library.
        </p>

        {/* Filters */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14 }}>
          {(['all', 'sample', 'preset', 'recipe'] as Kind[]).map(k => (
            <button key={k} onClick={() => setKind(k)} style={{
              fontSize: 11, fontWeight: 600, padding: '5px 12px', borderRadius: 6, cursor: 'pointer', textTransform: 'capitalize',
              background: kind === k ? 'var(--bg-card)' : 'transparent',
              border: kind === k ? '1px solid var(--border)' : '1px solid transparent',
              color: kind === k ? 'var(--text-primary)' : 'var(--text-muted)',
            }}>{k === 'all' ? 'All' : `${k}s`}</button>
          ))}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            {(['top', 'new'] as const).map(s => (
              <button key={s} onClick={() => setSort(s)} style={{
                fontSize: 11, fontWeight: 600, padding: '5px 10px', borderRadius: 6, cursor: 'pointer', textTransform: 'capitalize',
                background: sort === s ? 'var(--bg-card)' : 'transparent',
                border: sort === s ? '1px solid var(--border)' : '1px solid transparent',
                color: sort === s ? 'var(--text-primary)' : 'var(--text-muted)',
              }}>{s}</button>
            ))}
          </div>
        </div>

        {error && <p style={{ color: '#ef4444', fontSize: 13 }}>{error}</p>}
        {items === null && !error && <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</p>}
        {items?.length === 0 && (
          <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            Nothing here yet — be the first to share {kind === 'all' ? 'something' : `a ${kind}`}.
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items?.map(item => {
            const meta = KIND_META[item.kind]
            const Icon = meta.icon
            return (
              <div key={item.id} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
                background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
              }}>
                {/* Vote */}
                <button onClick={() => handleVote(item)} title={item.votedByMe ? 'Remove vote' : 'Vote up'} style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0, width: 40, flexShrink: 0,
                  padding: '4px 0', borderRadius: 8, cursor: 'pointer',
                  background: item.votedByMe ? 'rgba(124,58,237,0.18)' : 'transparent',
                  border: item.votedByMe ? '1px solid rgba(167,139,250,0.5)' : '1px solid var(--border)',
                  color: item.votedByMe ? '#a78bfa' : 'var(--text-muted)',
                }}>
                  <ArrowBigUp size={16} />
                  <span style={{ fontSize: 12, fontWeight: 700 }}>{item.votes}</span>
                </button>

                <div style={{
                  width: 34, height: 34, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: `${meta.color}1c`, color: meta.color,
                }}><Icon size={16} /></div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
                    <span style={{ fontSize: 9, fontWeight: 700, color: meta.color, letterSpacing: '0.06em', textTransform: 'uppercase', flexShrink: 0 }}>{meta.label}</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.description || '—'} · by {item.authorName} · {item.downloads} import{item.downloads !== 1 ? 's' : ''}
                  </div>
                </div>

                {item.mine && (
                  <button onClick={() => handleDelete(item)} title="Remove your item" style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}>
                    <Trash2 size={14} />
                  </button>
                )}
                <button onClick={() => handleImport(item)} disabled={busy === item.id} style={{
                  display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, fontSize: 11.5, fontWeight: 700,
                  padding: '7px 13px', borderRadius: 7, cursor: 'pointer', border: '1px solid var(--border)',
                  background: 'var(--bg-surface)', color: 'var(--text-primary)', opacity: busy === item.id ? 0.5 : 1,
                }}><Download size={13} /> {busy === item.id ? 'Importing…' : 'Import'}</button>
              </div>
            )
          })}
        </div>
      </div>

      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 1000,
          background: '#1e1e1e', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 18px',
          fontSize: 12.5, color: 'var(--text-primary)', boxShadow: '0 8px 30px rgba(0,0,0,0.5)', maxWidth: '80vw',
        }}>{toast}</div>
      )}

      {showUpload && <UploadModal onClose={() => setShowUpload(false)} onShared={() => { setShowUpload(false); flash('Shared!'); void load() }} />}
    </div>
  )
}

// ── Upload modal ──────────────────────────────────────────────────────────────

function UploadModal({ onClose, onShared }: { onClose: () => void; onShared: () => void }) {
  const [mode, setMode] = useState<'sample' | 'preset'>('sample')
  const [description, setDescription] = useState('')
  const [working, setWorking] = useState(false)
  const [err, setErr] = useState('')
  const [entries, setEntries] = useState<LibraryEntry[]>([])
  const [presets, setPresets] = useState<MidiPreset[]>([])
  const [pickedEntry, setPickedEntry] = useState('')
  const [pickedPreset, setPickedPreset] = useState('')

  useEffect(() => {
    // Own recordings/imports only — sharing the built-in library back would be noise
    libraryGetAll().then(all => setEntries(all.filter(e => !e.id.startsWith('seed:') && !e.id.startsWith('community:')))).catch(() => {})
    setPresets(getPresets().filter(p => !p.builtIn))
  }, [])

  async function submit() {
    setWorking(true); setErr('')
    try {
      if (mode === 'sample') {
        const entry = entries.find(e => e.id === pickedEntry)
        if (!entry) throw new Error('Pick a sample from your library')
        await shareSample(entry, description)
      } else {
        const preset = presets.find(p => p.id === pickedPreset)
        if (!preset) throw new Error('Pick one of your custom presets')
        await sharePreset(preset, description)
      }
      onShared()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Share failed')
      setWorking(false)
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1001, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 440, maxWidth: 'calc(100vw - 40px)', background: '#161616', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>Share to the community</span>
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={16} /></button>
        </div>

        <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
          {(['sample', 'preset'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)} style={{
              fontSize: 11, fontWeight: 600, padding: '5px 12px', borderRadius: 6, cursor: 'pointer', textTransform: 'capitalize',
              background: mode === m ? 'var(--bg-card)' : 'transparent',
              border: mode === m ? '1px solid var(--border)' : '1px solid transparent',
              color: mode === m ? 'var(--text-primary)' : 'var(--text-muted)',
            }}>{m}</button>
          ))}
          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-muted)', alignSelf: 'center' }}>
            Recipes: right-click a MIDI clip in the editor
          </span>
        </div>

        {mode === 'sample' ? (
          <select value={pickedEntry} onChange={e => setPickedEntry(e.target.value)} style={selStyle}>
            <option value="">Pick a sample from your library…</option>
            {entries.map(e => <option key={e.id} value={e.id}>{e.name}{e.folder ? ` (${e.folder})` : ''}</option>)}
          </select>
        ) : (
          <select value={pickedPreset} onChange={e => setPickedPreset(e.target.value)} style={selStyle}>
            <option value="">Pick one of your custom presets…</option>
            {presets.map(p => <option key={p.id} value={p.id}>{p.name} — {noteRangeLabel(p)}</option>)}
          </select>
        )}
        {mode === 'preset' && presets.length === 0 && (
          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '6px 0 0' }}>No custom presets yet — create one from the piano roll’s sound menu (+ New Preset).</p>
        )}
        {mode === 'sample' && entries.length === 0 && (
          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '6px 0 0' }}>No shareable samples yet — record or import something first (built-ins are excluded).</p>
        )}

        <textarea
          value={description} onChange={e => setDescription(e.target.value)} placeholder="Short description (what is it, how to use it)…"
          style={{ width: '100%', marginTop: 12, height: 64, resize: 'none', background: '#101010', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-primary)', fontSize: 12, padding: '8px 10px', boxSizing: 'border-box', outline: 'none' }}
        />

        {err && <p style={{ color: '#ef4444', fontSize: 11.5, margin: '8px 0 0' }}>{err}</p>}

        <button onClick={submit} disabled={working} style={{
          marginTop: 14, width: '100%', padding: '9px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
          background: 'var(--accent)', color: '#fff', fontSize: 12.5, fontWeight: 700, opacity: working ? 0.6 : 1,
        }}>{working ? 'Sharing…' : 'Share'}</button>
      </div>
    </div>
  )
}

const selStyle: React.CSSProperties = {
  width: '100%', background: '#101010', border: '1px solid var(--border)', borderRadius: 7,
  color: 'var(--text-primary)', fontSize: 12, padding: '8px 10px', outline: 'none',
}
