'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Plus, Mic, Upload, Play, Square, Trash2, Pencil, Check, X, ChevronDown, ChevronRight } from 'lucide-react'
import {
  libraryGetAll, libraryAdd, libraryUpdate, libraryDelete,
  blobToUrl, getAudioDurationFromBlob,
  CATEGORY_LABELS, LIBRARY_CATEGORIES,
  type LibraryEntry, type LibraryCategory,
} from '@/lib/sound-library'
import { computeHitFeatures } from '@/lib/beat-features'
import type { BeatType } from '@/lib/beat-analyzer'

// ── Category color map (reuses beat-type palette where applicable) ────────────
const CAT_COLORS: Record<string, string> = {
  kick: '#ef4444', snare: '#f97316', hihat: '#eab308', 'open-hihat': '#84cc16',
  clap: '#22c55e', tom: '#14b8a6', crash: '#06b6d4', rim: '#3b82f6',
  'guitar-acoustic': '#8b5cf6', 'guitar-electric': '#a855f7', 'piano-grand': '#ec4899',
  'synth-lead': '#f43f5e', 'synth-bass': '#6366f1', voice: '#0ea5e9', custom: '#94a3b8',
}

function colorFor(cat: string) { return CAT_COLORS[cat] ?? '#94a3b8' }

// ── Mini waveform bars (static, from peak amplitude) ─────────────────────────
function WaveBars({ spectral }: { spectral?: LibraryEntry['spectral'] }) {
  if (!spectral) return <div style={{ width: 32, height: 16, background: 'var(--border)', borderRadius: 2 }} />
  const bars = [spectral.sub, spectral.lowMid, spectral.mid, spectral.hiMid, spectral.hi]
  return (
    <div style={{ display: 'flex', gap: 1, alignItems: 'flex-end', height: 16, width: 32 }}>
      {bars.map((v, i) => (
        <div key={i} style={{ flex: 1, background: 'var(--accent)', borderRadius: 1, height: `${Math.max(10, v * 100)}%`, opacity: 0.6 + v * 0.4 }} />
      ))}
    </div>
  )
}

// ── Single library entry row ──────────────────────────────────────────────────
function EntryRow({
  entry, onDelete, onRename, onCategoryChange,
}: {
  entry: LibraryEntry
  onDelete: (id: string) => void
  onRename: (id: string, name: string) => void
  onCategoryChange: (id: string, cat: LibraryCategory) => void
}) {
  const [editing, setEditing]     = useState(false)
  const [draft, setDraft]         = useState(entry.name)
  const [playing, setPlaying]     = useState(false)
  const audioRef                  = useRef<HTMLAudioElement | null>(null)
  const urlRef                    = useRef<string | null>(null)

  function togglePlay() {
    if (playing) {
      audioRef.current?.pause()
      setPlaying(false)
      return
    }
    if (!urlRef.current) urlRef.current = blobToUrl(entry.audioBlob)
    const audio = audioRef.current ?? new Audio()
    audioRef.current = audio
    audio.src       = urlRef.current
    audio.onended   = () => setPlaying(false)
    audio.play().catch(() => {})
    setPlaying(true)
  }

  useEffect(() => () => {
    audioRef.current?.pause()
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
  }, [])

  function commitRename() {
    if (draft.trim() && draft !== entry.name) onRename(entry.id, draft.trim())
    setEditing(false)
  }

  const color = colorFor(entry.category)

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderLeft: `2px solid ${color}`, margin: '2px 0' }}>
      <button onClick={togglePlay} style={{ width: 20, height: 20, borderRadius: '50%', background: playing ? '#dc2626' : 'var(--bg-card)', border: `1px solid ${color}`, color, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {playing ? <Square size={7} fill="currentColor" /> : <Play size={7} fill="currentColor" style={{ marginLeft: 1 }} />}
      </button>

      <WaveBars spectral={entry.spectral} />

      <div style={{ flex: 1, minWidth: 0 }}>
        {editing ? (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input
              autoFocus value={draft} onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') { setDraft(entry.name); setEditing(false) } }}
              style={{ fontSize: 10, background: 'var(--bg-card)', border: '1px solid var(--accent)', borderRadius: 3, padding: '1px 4px', color: 'var(--text-primary)', width: '100%' }}
            />
            <button onClick={commitRename} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#4ade80', padding: 0 }}><Check size={10} /></button>
            <button onClick={() => { setDraft(entry.name); setEditing(false) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }}><X size={10} /></button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 10, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</span>
            <button onClick={() => setEditing(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, flexShrink: 0, opacity: 0.6 }}><Pencil size={8} /></button>
          </div>
        )}
        <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 1 }}>
          {CATEGORY_LABELS[entry.category]} · {entry.duration.toFixed(1)}s
        </div>
      </div>

      <button onClick={() => onDelete(entry.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, flexShrink: 0, opacity: 0.5 }}>
        <Trash2 size={10} />
      </button>
    </div>
  )
}

// ── Add-sound modal ───────────────────────────────────────────────────────────
function AddSoundModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [mode, setMode]           = useState<'choose' | 'record' | 'upload'>('choose')
  const [recording, setRecording] = useState(false)
  const [category, setCategory]   = useState<LibraryCategory>('custom')
  const [name, setName]           = useState('')
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState('')
  const recorderRef               = useRef<MediaRecorder | null>(null)
  const chunksRef                 = useRef<Blob[]>([])
  const fileInputRef              = useRef<HTMLInputElement>(null)

  async function startRecord() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      chunksRef.current = []
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.start(100)
      recorderRef.current = mr
      setRecording(true)
      setMode('record')
    } catch {
      setError('Microphone access denied')
    }
  }

  async function stopRecord() {
    const mr = recorderRef.current
    if (!mr) return
    setRecording(false)
    const blob = await new Promise<Blob>(resolve => {
      mr.onstop = () => resolve(new Blob(chunksRef.current, { type: 'audio/webm' }))
      mr.stop()
      mr.stream.getTracks().forEach(t => t.stop())
    })
    await saveEntry(blob)
  }

  async function handleFile(file: File) {
    if (!file.type.startsWith('audio/')) { setError('Audio files only'); return }
    await saveEntry(new Blob([await file.arrayBuffer()], { type: file.type }))
  }

  async function saveEntry(blob: Blob) {
    setSaving(true)
    try {
      const duration = await getAudioDurationFromBlob(blob)

      // Compute spectral fingerprint if it's a short clip (≤ 3s)
      let spectral: LibraryEntry['spectral'] | undefined
      if (duration <= 3) {
        const ctx = new AudioContext()
        const ab  = await ctx.decodeAudioData(await blob.arrayBuffer())
        const raw = ab.getChannelData(0)
        const { spectral: s } = computeHitFeatures(raw, 0, ab.sampleRate)
        await ctx.close()
        spectral = s
      }

      const entry: LibraryEntry = {
        id:        crypto.randomUUID(),
        name:      name.trim() || `Sound ${new Date().toLocaleTimeString()}`,
        category,
        audioBlob: blob,
        spectral,
        duration,
        addedAt:   new Date().toISOString(),
      }
      await libraryAdd(entry)
      onAdded()
      onClose()
    } catch {
      setError('Failed to save sound')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, width: 300, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Add to Library</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={14} /></button>
        </div>

        {/* Name */}
        <input
          value={name} onChange={e => setName(e.target.value)}
          placeholder="Sound name (optional)"
          style={{ fontSize: 12, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)' }}
        />

        {/* Category */}
        <select
          value={category}
          onChange={e => setCategory(e.target.value as LibraryCategory)}
          style={{ fontSize: 12, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)' }}
        >
          {LIBRARY_CATEGORIES.map(c => (
            <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
          ))}
        </select>

        {mode === 'choose' && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={startRecord} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 0', borderRadius: 8, background: '#dc2626', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
              <Mic size={13} /> Record
            </button>
            <button onClick={() => fileInputRef.current?.click()} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 0', borderRadius: 8, background: 'var(--bg-card)', color: 'var(--text-secondary)', border: '1px solid var(--border)', cursor: 'pointer', fontSize: 12 }}>
              <Upload size={13} /> Upload
            </button>
          </div>
        )}

        {mode === 'record' && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(220,38,38,0.15)', border: '2px solid rgba(220,38,38,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 10px', animation: recording ? 'pulse 0.8s ease-in-out infinite' : 'none' }}>
              <Mic size={22} color="#dc2626" />
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>{recording ? 'Recording… make your sound' : 'Ready'}</p>
            {recording && (
              <button onClick={stopRecord} disabled={saving} style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '0 auto', padding: '8px 18px', borderRadius: 7, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 12 }}>
                <Square size={10} fill="currentColor" /> Stop & Save
              </button>
            )}
          </div>
        )}

        {error && <p style={{ fontSize: 11, color: '#ef4444', textAlign: 'center' }}>{error}</p>}
        {saving && <p style={{ fontSize: 11, color: 'var(--accent-light)', textAlign: 'center' }}>Analyzing and saving…</p>}

        <input ref={fileInputRef} type="file" accept="audio/*" style={{ display: 'none' }} onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
      </div>
    </div>
  )
}

// ── Main SoundLibrary panel ───────────────────────────────────────────────────
export default function SoundLibrary({ embedded }: { embedded?: boolean }) {
  const [entries, setEntries] = useState<LibraryEntry[]>([])
  const [showAdd, setShowAdd] = useState(false)

  const load = useCallback(async () => {
    const all = await libraryGetAll()
    setEntries(all.sort((a, b) => b.addedAt.localeCompare(a.addedAt)))
  }, [])

  useEffect(() => { load() }, [load])

  async function handleDelete(id: string) {
    await libraryDelete(id)
    setEntries(prev => prev.filter(e => e.id !== id))
  }

  async function handleRename(id: string, name: string) {
    await libraryUpdate(id, { name })
    setEntries(prev => prev.map(e => e.id === id ? { ...e, name } : e))
  }

  async function handleCategoryChange(id: string, cat: LibraryCategory) {
    await libraryUpdate(id, { category: cat })
    setEntries(prev => prev.map(e => e.id === id ? { ...e, category: cat } : e))
  }

  const content = (
    <>
      {/* Add button row */}
      <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{entries.length} sound{entries.length !== 1 ? 's' : ''}</span>
        <button
          onClick={() => setShowAdd(true)}
          title="Record or upload a sound"
          style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9, padding: '2px 7px', borderRadius: 4, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer' }}
        >
          <Plus size={9} /> Add sound
        </button>
      </div>

      {/* Entries */}
      <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
        {entries.length === 0 ? (
          <div style={{ padding: '20px 14px', textAlign: 'center' }}>
            <p style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.7 }}>
              No sounds yet.<br />Record or upload a sample to build your library.
            </p>
          </div>
        ) : (
          entries.map(entry => (
            <EntryRow
              key={entry.id}
              entry={entry}
              onDelete={handleDelete}
              onRename={handleRename}
              onCategoryChange={handleCategoryChange}
            />
          ))
        )}
      </div>

      {showAdd && (
        <AddSoundModal onClose={() => setShowAdd(false)} onAdded={load} />
      )}
    </>
  )

  if (embedded) {
    return <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>{content}</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '8px 12px 6px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Sounds &amp; Samples</span>
      </div>
      {content}
    </div>
  )
}
