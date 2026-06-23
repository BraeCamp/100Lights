'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Play, Square, Upload, Trash2, Pencil, Check, X, FolderPlus } from 'lucide-react'
import {
  libraryGetAll, libraryAdd, libraryUpdate, libraryDelete,
  CATEGORY_LABELS, LIBRARY_CATEGORIES,
  type LibraryEntry, type LibraryCategory,
} from '@/lib/sound-library'

const CAT_COLORS: Record<string, string> = {
  kick: '#ef4444', snare: '#f97316', hihat: '#eab308', 'open-hihat': '#84cc16',
  clap: '#22c55e', tom: '#14b8a6', crash: '#06b6d4', rim: '#3b82f6',
  'guitar-acoustic': '#8b5cf6', 'guitar-electric': '#a855f7', 'piano-grand': '#ec4899',
  'synth-lead': '#f43f5e', 'synth-bass': '#6366f1', voice: '#0ea5e9', custom: '#94a3b8',
}

function colorFor(cat: string) { return CAT_COLORS[cat] ?? '#94a3b8' }

function getBlobDuration(blob: Blob): Promise<number> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(blob)
    const el  = document.createElement('audio')
    el.src    = url
    el.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(isFinite(el.duration) ? el.duration : 0) }
    el.onerror = () => { URL.revokeObjectURL(url); resolve(0) }
    setTimeout(() => { URL.revokeObjectURL(url); resolve(0) }, 4000)
  })
}

function EntryRow({ entry, folders, onDelete, onChanged }: {
  entry: LibraryEntry
  folders: string[]
  onDelete: (id: string) => void
  onChanged: () => void
}) {
  const [playing,      setPlaying]      = useState(false)
  const [editingName,  setEditingName]  = useState(false)
  const [draft,        setDraft]        = useState(entry.name)
  const [editingCat,   setEditingCat]   = useState(false)
  const [editingFolder,setEditingFolder]= useState(false)
  const [folderDraft,  setFolderDraft]  = useState(entry.folder ?? '')
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const urlRef   = useRef<string | null>(null)
  const nameRef  = useRef<HTMLInputElement>(null)

  useEffect(() => () => {
    audioRef.current?.pause()
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
  }, [])

  function togglePlay() {
    if (playing) { audioRef.current?.pause(); setPlaying(false); return }
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    urlRef.current = URL.createObjectURL(entry.audioBlob)
    const audio = audioRef.current ?? new Audio()
    audioRef.current = audio
    audio.src = urlRef.current
    audio.onended = () => setPlaying(false)
    audio.play().catch(() => {})
    setPlaying(true)
  }

  async function saveName() {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== entry.name) {
      await libraryUpdate(entry.id, { name: trimmed })
      onChanged()
    } else {
      setDraft(entry.name)
    }
    setEditingName(false)
  }

  async function saveCategory(cat: LibraryCategory) {
    await libraryUpdate(entry.id, { category: cat })
    setEditingCat(false)
    onChanged()
  }

  async function saveFolder() {
    const f = folderDraft.trim() || undefined
    await libraryUpdate(entry.id, { folder: f })
    setEditingFolder(false)
    onChanged()
  }

  const isCatalog = entry.id.startsWith('100l_')

  return (
    <tr style={{ borderBottom: '1px solid var(--border)' }}>
      {/* Play */}
      <td style={{ padding: '6px 8px', width: 32 }}>
        <button onClick={togglePlay}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: 4, background: playing ? '#dc2626' : 'var(--bg-card)', border: '1px solid var(--border)', color: playing ? '#fff' : 'var(--text-muted)', cursor: 'pointer', flexShrink: 0 }}>
          {playing ? <Square size={9} fill="currentColor" /> : <Play size={9} fill="currentColor" />}
        </button>
      </td>

      {/* Name */}
      <td style={{ padding: '6px 8px', minWidth: 160 }}>
        {editingName ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              ref={nameRef}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') { setDraft(entry.name); setEditingName(false) } }}
              autoFocus
              style={{ flex: 1, fontSize: 11, background: 'var(--bg-surface)', border: '1px solid var(--accent)', borderRadius: 4, color: 'var(--text-primary)', padding: '2px 6px' }}
            />
            <button onClick={saveName} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-light)', padding: 0 }}><Check size={12} /></button>
            <button onClick={() => { setDraft(entry.name); setEditingName(false) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }}><X size={12} /></button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontSize: 11, color: 'var(--text-primary)', flex: 1 }}>{entry.name}</span>
            {isCatalog && <span style={{ fontSize: 8, padding: '1px 4px', borderRadius: 3, background: 'rgba(139,92,246,0.1)', color: 'var(--accent-light)', border: '1px solid rgba(139,92,246,0.2)' }}>100L</span>}
            <button onClick={() => setEditingName(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, opacity: 0.5 }}><Pencil size={10} /></button>
          </div>
        )}
      </td>

      {/* Category */}
      <td style={{ padding: '6px 8px', width: 140 }}>
        {editingCat ? (
          <select
            autoFocus
            defaultValue={entry.category}
            onChange={e => saveCategory(e.target.value as LibraryCategory)}
            onBlur={() => setEditingCat(false)}
            style={{ fontSize: 10, background: 'var(--bg-surface)', border: '1px solid var(--accent)', borderRadius: 4, color: 'var(--text-primary)', padding: '2px 4px' }}
          >
            {LIBRARY_CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
          </select>
        ) : (
          <button onClick={() => setEditingCat(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: colorFor(entry.category), flexShrink: 0, display: 'inline-block' }} />
            <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{CATEGORY_LABELS[entry.category] ?? entry.category}</span>
          </button>
        )}
      </td>

      {/* Folder */}
      <td style={{ padding: '6px 8px', width: 120 }}>
        {editingFolder ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              value={folderDraft}
              onChange={e => setFolderDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveFolder(); if (e.key === 'Escape') { setFolderDraft(entry.folder ?? ''); setEditingFolder(false) } }}
              autoFocus
              placeholder="No folder"
              list="folder-list"
              style={{ flex: 1, fontSize: 10, background: 'var(--bg-surface)', border: '1px solid var(--accent)', borderRadius: 4, color: 'var(--text-primary)', padding: '2px 5px' }}
            />
            <datalist id="folder-list">
              {folders.map(f => <option key={f} value={f} />)}
            </datalist>
            <button onClick={saveFolder} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-light)', padding: 0 }}><Check size={12} /></button>
            <button onClick={() => { setFolderDraft(entry.folder ?? ''); setEditingFolder(false) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }}><X size={12} /></button>
          </div>
        ) : (
          <button onClick={() => setEditingFolder(true)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 3 }}>
            <span style={{ fontSize: 10, color: entry.folder ? 'var(--text-secondary)' : 'var(--text-muted)', fontStyle: entry.folder ? 'normal' : 'italic' }}>
              {entry.folder ?? 'No folder'}
            </span>
          </button>
        )}
      </td>

      {/* Duration */}
      <td style={{ padding: '6px 8px', width: 60 }}>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{entry.duration.toFixed(2)}s</span>
      </td>

      {/* Delete */}
      <td style={{ padding: '6px 8px', width: 36 }}>
        <button onClick={() => onDelete(entry.id)}
          style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 4, padding: '3px 5px', cursor: 'pointer', color: '#ef4444', display: 'flex' }}>
          <Trash2 size={10} />
        </button>
      </td>
    </tr>
  )
}

export default function SoundLibraryPanel() {
  const [entries,    setEntries]    = useState<LibraryEntry[]>([])
  const [uploading,  setUploading]  = useState(false)
  const [filter,     setFilter]     = useState<LibraryCategory | 'all'>('all')
  const [folderFilter, setFolderFilter] = useState<string | 'all'>('all')
  const [search,     setSearch]     = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const all = await libraryGetAll().catch(() => [] as LibraryEntry[])
    setEntries(all.sort((a, b) => b.addedAt.localeCompare(a.addedAt)))
  }, [])

  useEffect(() => { load() }, [load])

  const folders = [...new Set(entries.map(e => e.folder).filter(Boolean) as string[])].sort()

  const visible = entries.filter(e => {
    if (filter !== 'all' && e.category !== filter) return false
    if (folderFilter !== 'all' && e.folder !== folderFilter) return false
    if (search && !e.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  async function handleFiles(files: FileList) {
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        const blob     = new Blob([await file.arrayBuffer()], { type: file.type })
        const duration = await getBlobDuration(blob)
        await libraryAdd({
          id:        crypto.randomUUID(),
          name:      file.name.replace(/\.\w+$/, ''),
          category:  'custom',
          audioBlob: blob,
          duration,
          addedAt:   new Date().toISOString(),
        })
      }
      await load()
    } finally {
      setUploading(false)
    }
  }

  async function deleteEntry(id: string) {
    if (!confirm('Delete this sample?')) return
    await libraryDelete(id)
    await load()
  }

  async function clearAll() {
    if (!confirm('Delete ALL sound library entries? This cannot be undone.')) return
    for (const e of entries) await libraryDelete(e.id)
    await load()
  }

  const selectStyle: React.CSSProperties = {
    fontSize: 11, background: 'var(--bg-card)', border: '1px solid var(--border)',
    borderRadius: 6, color: 'var(--text-secondary)', padding: '4px 8px', cursor: 'pointer',
  }

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 6, background: 'var(--accent)', color: '#fff', border: 'none', cursor: uploading ? 'default' : 'pointer', opacity: uploading ? 0.6 : 1 }}
        >
          <Upload size={13} /> {uploading ? 'Uploading…' : 'Upload samples'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="audio/*,.aif,.aiff"
          multiple
          style={{ display: 'none' }}
          onChange={e => e.target.files?.length && handleFiles(e.target.files)}
        />

        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search…"
          style={{ ...selectStyle, width: 160 }}
        />

        <select value={filter} onChange={e => setFilter(e.target.value as LibraryCategory | 'all')} style={selectStyle}>
          <option value="all">All categories</option>
          {LIBRARY_CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
        </select>

        {folders.length > 0 && (
          <select value={folderFilter} onChange={e => setFolderFilter(e.target.value)} style={selectStyle}>
            <option value="all">All folders</option>
            {folders.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        )}

        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>
          {visible.length} of {entries.length} entries
        </span>

        {entries.length > 0 && (
          <button onClick={clearAll}
            style={{ fontSize: 11, padding: '5px 10px', borderRadius: 6, background: 'rgba(239,68,68,0.08)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.25)', cursor: 'pointer' }}>
            Clear all
          </button>
        )}
      </div>

      {/* Drag-and-drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--accent)' }}
        onDragLeave={e => { e.currentTarget.style.borderColor = 'var(--border)' }}
        onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--border)'; e.dataTransfer.files.length && handleFiles(e.dataTransfer.files) }}
        style={{ border: '2px dashed var(--border)', borderRadius: 8, padding: '14px 18px', marginBottom: 16, textAlign: 'center', fontSize: 11, color: 'var(--text-muted)', transition: 'border-color 0.15s', cursor: 'pointer' }}
        onClick={() => fileRef.current?.click()}
      >
        <FolderPlus size={16} style={{ display: 'inline', marginRight: 6, opacity: 0.5 }} />
        Drop audio files here or click to upload — supports WAV, MP3, AIFF, OGG
      </div>

      {/* Table */}
      {visible.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', padding: '20px 0' }}>
          {entries.length === 0 ? 'No samples yet — upload some above.' : 'No samples match the current filter.'}
        </p>
      ) : (
        <div style={{ borderRadius: 8, border: '1px solid var(--border)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--bg-card)', borderBottom: '1px solid var(--border)' }}>
                {['', 'Name', 'Category', 'Folder', 'Dur', ''].map((h, i) => (
                  <th key={i} style={{ textAlign: 'left', padding: '6px 8px', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((entry, i) => (
                <tr key={entry.id} style={{ background: i % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-surface)' }}>
                  <EntryRow entry={entry} folders={folders} onDelete={deleteEntry} onChanged={load} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
