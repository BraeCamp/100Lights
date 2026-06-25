'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Play, Square, ChevronRight, ChevronDown, Upload, Trash2, Pencil, Check, X, FolderPlus, SkipBack, SkipForward } from 'lucide-react'
import {
  libraryGetAll, libraryAdd, libraryUpdate, libraryDelete,
  CATEGORY_LABELS, LIBRARY_CATEGORIES,
  type LibraryEntry, type LibraryCategory,
} from '@/lib/sound-library'

// ── Note sorting helpers ──────────────────────────────────────────────────────
const NOTE_PC: Record<string, number> = { C:0,'C#':1,D:2,'D#':3,E:4,F:5,'F#':6,G:7,'G#':8,A:9,'A#':10,B:11 }

function noteToMidi(name: string): number | null {
  const m = name.match(/^([A-G]#?)(-?\d+)$/)
  if (!m) return null
  const pc = NOTE_PC[m[1]]
  return pc !== undefined ? (parseInt(m[2]) + 1) * 12 + pc : null
}

function sortDesc(arr: LibraryEntry[]): LibraryEntry[] {
  const midis = arr.map(e => noteToMidi(e.name))
  if (midis.every(m => m !== null)) {
    return [...arr].sort((a, b) => (noteToMidi(b.name) ?? 0) - (noteToMidi(a.name) ?? 0))
  }
  return [...arr].sort((a, b) => a.name.localeCompare(b.name))
}

// ── Category color dots ───────────────────────────────────────────────────────
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

// ── Entry row ─────────────────────────────────────────────────────────────────
function EntryRow({ entry, folders, isPlaying, hasPrev, hasNext, onPlay, onPrev, onNext, onDelete, onChanged }: {
  entry: LibraryEntry
  folders: string[]
  isPlaying: boolean
  hasPrev: boolean
  hasNext: boolean
  onPlay: () => void
  onPrev: () => void
  onNext: () => void
  onDelete: (id: string) => void
  onChanged: () => void
}) {
  const [editingName,   setEditingName]   = useState(false)
  const [draft,         setDraft]         = useState(entry.name)
  const [editingCat,    setEditingCat]    = useState(false)
  const [editingFolder, setEditingFolder] = useState(false)
  const [folderDraft,   setFolderDraft]   = useState(entry.folder ?? '')

  async function saveName() {
    const t = draft.trim()
    if (t && t !== entry.name) { await libraryUpdate(entry.id, { name: t }); onChanged() }
    else setDraft(entry.name)
    setEditingName(false)
  }
  async function saveCategory(cat: LibraryCategory) {
    await libraryUpdate(entry.id, { category: cat }); setEditingCat(false); onChanged()
  }
  async function saveFolder() {
    const f = folderDraft.trim() || undefined
    await libraryUpdate(entry.id, { folder: f }); setEditingFolder(false); onChanged()
  }

  const isCatalog = entry.id.startsWith('100l_')
  const bg = isPlaying ? 'rgba(61,143,239,0.08)' : 'transparent'

  return (
    <tr style={{ borderBottom: '1px solid var(--border)', background: bg, transition: 'background 0.1s' }}>
      {/* Playback controls */}
      <td style={{ padding: '5px 6px', width: 80, whiteSpace: 'nowrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {isPlaying && (
            <button onClick={onPrev} disabled={!hasPrev} title="Previous"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: 4, background: 'var(--bg-card)', border: '1px solid var(--border)', color: hasPrev ? 'var(--text-primary)' : 'var(--text-muted)', cursor: hasPrev ? 'pointer' : 'not-allowed', opacity: hasPrev ? 1 : 0.35 }}>
              <SkipBack size={9} />
            </button>
          )}
          <button onClick={onPlay} title={isPlaying ? 'Stop' : 'Play'}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: 4, background: isPlaying ? '#dc2626' : 'var(--bg-card)', border: '1px solid var(--border)', color: isPlaying ? '#fff' : 'var(--text-muted)', cursor: 'pointer', flexShrink: 0 }}>
            {isPlaying ? <Square size={9} fill="currentColor" /> : <Play size={9} fill="currentColor" />}
          </button>
          {isPlaying && (
            <button onClick={onNext} disabled={!hasNext} title="Next"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: 4, background: 'var(--bg-card)', border: '1px solid var(--border)', color: hasNext ? 'var(--text-primary)' : 'var(--text-muted)', cursor: hasNext ? 'pointer' : 'not-allowed', opacity: hasNext ? 1 : 0.35 }}>
              <SkipForward size={9} />
            </button>
          )}
        </div>
      </td>

      {/* Name */}
      <td style={{ padding: '5px 8px', minWidth: 140 }}>
        {editingName ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input value={draft} onChange={e => setDraft(e.target.value)} autoFocus
              onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') { setDraft(entry.name); setEditingName(false) } }}
              style={{ flex: 1, fontSize: 11, background: 'var(--bg-surface)', border: '1px solid var(--accent)', borderRadius: 4, color: 'var(--text-primary)', padding: '2px 6px' }} />
            <button onClick={saveName} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-light)', padding: 0 }}><Check size={12} /></button>
            <button onClick={() => { setDraft(entry.name); setEditingName(false) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }}><X size={12} /></button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontSize: 11, color: isPlaying ? 'var(--accent-light)' : 'var(--text-primary)', flex: 1, fontWeight: isPlaying ? 600 : 400 }}>{entry.name}</span>
            {isCatalog && <span style={{ fontSize: 8, padding: '1px 4px', borderRadius: 3, background: 'rgba(139,92,246,0.1)', color: 'var(--accent-light)', border: '1px solid rgba(139,92,246,0.2)', flexShrink: 0 }}>100L</span>}
            <button onClick={() => setEditingName(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, opacity: 0.4 }}><Pencil size={10} /></button>
          </div>
        )}
      </td>

      {/* Category */}
      <td style={{ padding: '5px 8px', width: 130 }}>
        {editingCat ? (
          <select autoFocus defaultValue={entry.category} onBlur={() => setEditingCat(false)}
            onChange={e => saveCategory(e.target.value as LibraryCategory)}
            style={{ fontSize: 10, background: 'var(--bg-surface)', border: '1px solid var(--accent)', borderRadius: 4, color: 'var(--text-primary)', padding: '2px 4px' }}>
            {LIBRARY_CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
          </select>
        ) : (
          <button onClick={() => setEditingCat(true)} style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: colorFor(entry.category), flexShrink: 0, display: 'inline-block' }} />
            <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{CATEGORY_LABELS[entry.category] ?? entry.category}</span>
          </button>
        )}
      </td>

      {/* Folder */}
      <td style={{ padding: '5px 8px', width: 110 }}>
        {editingFolder ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input value={folderDraft} autoFocus placeholder="No folder" list="folder-list-sl"
              onChange={e => setFolderDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveFolder(); if (e.key === 'Escape') { setFolderDraft(entry.folder ?? ''); setEditingFolder(false) } }}
              style={{ flex: 1, fontSize: 10, background: 'var(--bg-surface)', border: '1px solid var(--accent)', borderRadius: 4, color: 'var(--text-primary)', padding: '2px 5px' }} />
            <datalist id="folder-list-sl">{folders.map(f => <option key={f} value={f} />)}</datalist>
            <button onClick={saveFolder} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-light)', padding: 0 }}><Check size={12} /></button>
            <button onClick={() => { setFolderDraft(entry.folder ?? ''); setEditingFolder(false) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }}><X size={12} /></button>
          </div>
        ) : (
          <button onClick={() => setEditingFolder(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            <span style={{ fontSize: 10, color: entry.folder ? 'var(--text-secondary)' : 'var(--text-muted)', fontStyle: entry.folder ? 'normal' : 'italic' }}>
              {entry.folder ?? 'No folder'}
            </span>
          </button>
        )}
      </td>

      {/* Duration */}
      <td style={{ padding: '5px 8px', width: 54 }}>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{entry.duration.toFixed(2)}s</span>
      </td>

      {/* Delete */}
      <td style={{ padding: '5px 8px', width: 34 }}>
        <button onClick={() => onDelete(entry.id)}
          style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 4, padding: '3px 5px', cursor: 'pointer', color: '#ef4444', display: 'flex' }}>
          <Trash2 size={10} />
        </button>
      </td>
    </tr>
  )
}

// ── Folder section ────────────────────────────────────────────────────────────
function FolderSection({ title, entries, depth, isOpen, onToggle, playingId, navContext, onPlay, onDelete, onChanged, folders }: {
  title: string
  entries: LibraryEntry[]
  depth: number
  isOpen: boolean
  onToggle: () => void
  playingId: string | null
  navContext: LibraryEntry[]
  onPlay: (entry: LibraryEntry, context: LibraryEntry[]) => void
  onDelete: (id: string) => void
  onChanged: () => void
  folders: string[]
}) {
  const playingIdx = navContext.findIndex(e => e.id === playingId)
  const bgColor    = depth === 0 ? 'rgba(139,92,246,0.06)' : 'rgba(61,143,239,0.04)'
  const indent     = depth * 16

  return (
    <div>
      <div onClick={onToggle}
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: `6px 10px 6px ${10 + indent}px`, cursor: 'pointer', background: bgColor, borderBottom: '1px solid var(--border)', userSelect: 'none' }}>
        {isOpen ? <ChevronDown size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} /> : <ChevronRight size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />}
        <span style={{ fontSize: 11, fontWeight: 700, color: depth === 0 ? 'rgba(139,92,246,0.9)' : 'var(--text-secondary)', flex: 1 }}>{title}</span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{entries.length}</span>
      </div>
      {isOpen && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {entries.map(entry => {
              const idx     = navContext.findIndex(e => e.id === entry.id)
              const playing = entry.id === playingId
              return (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  folders={folders}
                  isPlaying={playing}
                  hasPrev={playing && idx > 0}
                  hasNext={playing && idx < navContext.length - 1}
                  onPlay={() => onPlay(entry, navContext)}
                  onPrev={() => onPlay(navContext[idx - 1], navContext)}
                  onNext={() => onPlay(navContext[idx + 1], navContext)}
                  onDelete={onDelete}
                  onChanged={onChanged}
                />
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────
export default function SoundLibraryPanel() {
  const [entries,    setEntries]    = useState<LibraryEntry[]>([])
  const [uploading,  setUploading]  = useState(false)
  const [search,     setSearch]     = useState('')
  const [filter,     setFilter]     = useState<LibraryCategory | 'all'>('all')
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set())
  const [playingId,  setPlayingId]  = useState<string | null>(null)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const urlRef   = useRef<string | null>(null)
  const fileRef  = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const all = await libraryGetAll().catch(() => [] as LibraryEntry[])
    setEntries(all)
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => () => { audioRef.current?.pause(); if (urlRef.current) URL.revokeObjectURL(urlRef.current) }, [])

  const folders = useMemo(() => [...new Set(entries.map(e => e.folder).filter(Boolean) as string[])].sort(), [entries])

  // Filter + group
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return entries.filter(e => {
      if (filter !== 'all' && e.category !== filter) return false
      if (q && !e.name.toLowerCase().includes(q) && !(e.folder ?? '').toLowerCase().includes(q)) return false
      return true
    })
  }, [entries, search, filter])

  // Grouped structure: parentFolder → (subFolder → entries[]) | folder → entries[] | unfiled
  const groups = useMemo(() => {
    const byParent = new Map<string, Map<string, LibraryEntry[]>>()
    const byFolder = new Map<string, LibraryEntry[]>()
    const unfiled: LibraryEntry[] = []
    for (const e of filtered) {
      if (e.parentFolder) {
        const sub    = e.folder ?? ''
        const subMap = byParent.get(e.parentFolder) ?? new Map<string, LibraryEntry[]>()
        subMap.set(sub, sortDesc([...(subMap.get(sub) ?? []), e]))
        byParent.set(e.parentFolder, subMap)
      } else if (e.folder) {
        byFolder.set(e.folder, sortDesc([...(byFolder.get(e.folder) ?? []), e]))
      } else {
        unfiled.push(e)
      }
    }
    return { byParent, byFolder, unfiled }
  }, [filtered])

  function toggleGroup(key: string) {
    setOpenGroups(prev => {
      const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s
    })
  }

  function playEntry(entry: LibraryEntry, context: LibraryEntry[]) {
    audioRef.current?.pause()
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    if (playingId === entry.id) { setPlayingId(null); return }
    urlRef.current = URL.createObjectURL(entry.audioBlob)
    const audio = new Audio(urlRef.current)
    audioRef.current = audio
    audio.onended = () => setPlayingId(null)
    audio.play().catch(() => {})
    setPlayingId(entry.id)
    void context  // keep ref for prev/next (context passed to each row)
  }

  async function handleFiles(files: FileList) {
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        const blob     = new Blob([await file.arrayBuffer()], { type: file.type })
        const duration = await getBlobDuration(blob)
        await libraryAdd({ id: crypto.randomUUID(), name: file.name.replace(/\.\w+$/, ''), category: 'custom', audioBlob: blob, duration, addedAt: new Date().toISOString() })
      }
      await load()
    } finally { setUploading(false) }
  }

  async function deleteEntry(id: string) {
    if (!confirm('Delete this sample?')) return
    if (playingId === id) { audioRef.current?.pause(); setPlayingId(null) }
    await libraryDelete(id); await load()
  }

  async function clearAll() {
    if (!confirm('Delete ALL sound library entries? This cannot be undone.')) return
    audioRef.current?.pause(); setPlayingId(null)
    for (const e of entries) await libraryDelete(e.id)
    await load()
  }

  const selectStyle: React.CSSProperties = {
    fontSize: 11, background: 'var(--bg-card)', border: '1px solid var(--border)',
    borderRadius: 6, color: 'var(--text-secondary)', padding: '4px 8px', cursor: 'pointer',
  }

  const totalVisible = filtered.length

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <button onClick={() => fileRef.current?.click()} disabled={uploading}
          style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 6, background: 'var(--accent)', color: '#fff', border: 'none', cursor: uploading ? 'default' : 'pointer', opacity: uploading ? 0.6 : 1 }}>
          <Upload size={13} />{uploading ? 'Uploading…' : 'Upload samples'}
        </button>
        <input ref={fileRef} type="file" accept="audio/*,.aif,.aiff" multiple style={{ display: 'none' }}
          onChange={e => e.target.files?.length && handleFiles(e.target.files)} />

        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" style={{ ...selectStyle, width: 160 }} />

        <select value={filter} onChange={e => setFilter(e.target.value as LibraryCategory | 'all')} style={selectStyle}>
          <option value="all">All categories</option>
          {LIBRARY_CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
        </select>

        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>
          {totalVisible} of {entries.length} entries
        </span>
        {entries.length > 0 && (
          <button onClick={clearAll}
            style={{ fontSize: 11, padding: '5px 10px', borderRadius: 6, background: 'rgba(239,68,68,0.08)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.25)', cursor: 'pointer' }}>
            Clear all
          </button>
        )}
      </div>

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--accent)' }}
        onDragLeave={e => { e.currentTarget.style.borderColor = 'var(--border)' }}
        onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--border)'; e.dataTransfer.files.length && handleFiles(e.dataTransfer.files) }}
        onClick={() => fileRef.current?.click()}
        style={{ border: '2px dashed var(--border)', borderRadius: 8, padding: '14px 18px', marginBottom: 16, textAlign: 'center', fontSize: 11, color: 'var(--text-muted)', transition: 'border-color 0.15s', cursor: 'pointer' }}>
        <FolderPlus size={16} style={{ display: 'inline', marginRight: 6, opacity: 0.5 }} />
        Drop audio files here or click to upload — WAV, MP3, AIFF, OGG
      </div>

      {/* Grouped content */}
      {totalVisible === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', padding: '20px 0' }}>
          {entries.length === 0 ? 'No samples yet — upload some above.' : 'No samples match the current filter.'}
        </p>
      ) : (
        <div style={{ borderRadius: 8, border: '1px solid var(--border)', overflow: 'hidden' }}>

          {/* Parent-grouped (e.g. "100lights Audio") */}
          {[...groups.byParent.entries()].map(([parentName, subFolders]) => {
            const pKey  = `p:${parentName}`
            const pOpen = openGroups.has(pKey)
            const pTotal = [...subFolders.values()].reduce((n, a) => n + a.length, 0)
            return (
              <div key={pKey}>
                <div onClick={() => toggleGroup(pKey)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', cursor: 'pointer', background: 'rgba(139,92,246,0.09)', borderBottom: '1px solid var(--border)', userSelect: 'none' }}>
                  {pOpen ? <ChevronDown size={13} style={{ color: 'rgba(139,92,246,0.7)', flexShrink: 0 }} /> : <ChevronRight size={13} style={{ color: 'rgba(139,92,246,0.7)', flexShrink: 0 }} />}
                  <span style={{ fontSize: 12, fontWeight: 800, color: 'rgba(139,92,246,0.9)', flex: 1 }}>{parentName}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{pTotal} samples</span>
                </div>
                {pOpen && [...subFolders.entries()].map(([subName, subEntries]) => {
                  const sKey = `${pKey}/${subName}`
                  return (
                    <FolderSection
                      key={sKey}
                      title={subName || '(ungrouped)'}
                      entries={subEntries}
                      depth={1}
                      isOpen={openGroups.has(sKey)}
                      onToggle={() => toggleGroup(sKey)}
                      playingId={playingId}
                      navContext={subEntries}
                      onPlay={playEntry}
                      onDelete={deleteEntry}
                      onChanged={load}
                      folders={folders}
                    />
                  )
                })}
              </div>
            )
          })}

          {/* User folders */}
          {[...groups.byFolder.entries()].map(([folderName, folderEntries]) => {
            const fKey = `f:${folderName}`
            return (
              <FolderSection
                key={fKey}
                title={`📁 ${folderName}`}
                entries={folderEntries}
                depth={0}
                isOpen={openGroups.has(fKey)}
                onToggle={() => toggleGroup(fKey)}
                playingId={playingId}
                navContext={folderEntries}
                onPlay={playEntry}
                onDelete={deleteEntry}
                onChanged={load}
                folders={folders}
              />
            )
          })}

          {/* Unfiled */}
          {groups.unfiled.length > 0 && (
            <div>
              <div onClick={() => toggleGroup('unfiled')}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', cursor: 'pointer', background: 'var(--bg-card)', borderBottom: '1px solid var(--border)', userSelect: 'none' }}>
                {openGroups.has('unfiled') ? <ChevronDown size={12} style={{ color: 'var(--text-muted)' }} /> : <ChevronRight size={12} style={{ color: 'var(--text-muted)' }} />}
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', flex: 1 }}>Unfiled</span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{groups.unfiled.length}</span>
              </div>
              {openGroups.has('unfiled') && (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    {groups.unfiled.map(entry => {
                      const playing = entry.id === playingId
                      const idx     = groups.unfiled.findIndex(e => e.id === entry.id)
                      return (
                        <EntryRow
                          key={entry.id}
                          entry={entry}
                          folders={folders}
                          isPlaying={playing}
                          hasPrev={playing && idx > 0}
                          hasNext={playing && idx < groups.unfiled.length - 1}
                          onPlay={() => playEntry(entry, groups.unfiled)}
                          onPrev={() => playEntry(groups.unfiled[idx - 1], groups.unfiled)}
                          onNext={() => playEntry(groups.unfiled[idx + 1], groups.unfiled)}
                          onDelete={deleteEntry}
                          onChanged={load}
                        />
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
