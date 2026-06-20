'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Play, Square, Upload, RefreshCw, Trash2, Check, ChevronDown, ChevronRight, Star } from 'lucide-react'
import {
  sampleGetAll, sampleGetAllByType, samplePut, sampleSetActive, sampleDelete, sampleClear,
  renderSynthSample, SAMPLE_PACK_TYPES, SAMPLE_TYPE_LABELS,
  type SampleEntry,
} from '@/lib/sample-pack'
import type { BeatType } from '@/lib/beat-analyzer'
import { DEFAULT_NOTES } from '@/lib/beat-analyzer'

const GROUP_LABELS: Record<string, string> = {
  drums: 'Drums', guitar: 'Guitar', piano: 'Piano', synth: 'Synth', other: 'Other',
}

function groupOf(t: BeatType): string {
  if (['kick','snare','hihat','open-hihat','clap','tom','crash','rim'].includes(t)) return 'drums'
  if (t.startsWith('guitar')) return 'guitar'
  if (t.startsWith('piano')) return 'piano'
  if (t.startsWith('synth')) return 'synth'
  return 'other'
}

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

// ── Single variation row ──────────────────────────────────────────────────────

function VariationRow({
  entry, onActivate, onDelete,
}: {
  entry:      SampleEntry
  onActivate: (id: string) => void
  onDelete:   (id: string) => void
}) {
  const [playing, setPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const urlRef   = useRef<string | null>(null)

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

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px',
      borderRadius: 6, background: entry.isActive ? 'rgba(139,92,246,0.08)' : 'var(--bg-surface)',
      border: `1px solid ${entry.isActive ? 'rgba(139,92,246,0.3)' : 'var(--border)'}`,
    }}>
      {/* Active indicator */}
      <button
        onClick={() => onActivate(entry.id)}
        title={entry.isActive ? 'Active (click to deselect)' : 'Set as active'}
        style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: entry.isActive ? 'var(--accent-light)' : 'var(--border)' }}
      >
        <Star size={11} fill={entry.isActive ? 'currentColor' : 'none'} />
      </button>

      {/* Name */}
      <span style={{ flex: 1, fontSize: 10, color: entry.isActive ? 'var(--text-primary)' : 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={entry.name}>
        {entry.name}
      </span>

      {/* Badge */}
      <span style={{ fontSize: 8, padding: '1px 4px', borderRadius: 3, background: entry.isDefault ? 'var(--bg-card)' : 'rgba(139,92,246,0.12)', color: entry.isDefault ? 'var(--text-muted)' : 'var(--accent-light)', border: '1px solid var(--border)', flexShrink: 0 }}>
        {entry.isDefault ? 'synth' : 'custom'}
      </span>

      {/* Play */}
      <button
        onClick={togglePlay}
        style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 2, fontSize: 9, padding: '2px 5px', borderRadius: 4, background: playing ? '#dc2626' : 'var(--bg-card)', border: '1px solid var(--border)', color: playing ? '#fff' : 'var(--text-muted)', cursor: 'pointer' }}
      >
        {playing ? <Square size={7} fill="currentColor" /> : <Play size={7} fill="currentColor" />}
      </button>

      {/* Delete */}
      <button
        onClick={() => onDelete(entry.id)}
        style={{ flexShrink: 0, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 4, padding: '2px 4px', cursor: 'pointer', color: '#ef4444' }}
      >
        <Trash2 size={8} />
      </button>
    </div>
  )
}

// ── Per-type slot ─────────────────────────────────────────────────────────────

function TypeSlot({ type, onChanged }: { type: BeatType; onChanged: () => void }) {
  const [variations,  setVariations]  = useState<SampleEntry[]>([])
  const [expanded,    setExpanded]    = useState(false)
  const [rendering,   setRendering]   = useState(false)
  const [uploading,   setUploading]   = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const all = await sampleGetAllByType(type).catch(() => [])
    setVariations(all)
  }, [type])

  useEffect(() => { load() }, [load])

  const active = variations.find(e => e.isActive) ?? variations[0]

  async function addSynth() {
    setRendering(true)
    try {
      const rootNote = DEFAULT_NOTES[type] ?? 60
      const { blob, rootNote: rn } = await renderSynthSample(type, rootNote)
      const duration = await getBlobDuration(blob)
      const e: SampleEntry = {
        id: crypto.randomUUID(), beatType: type,
        name: `${SAMPLE_TYPE_LABELS[type] ?? type} (synth ${new Date().toLocaleTimeString()})`,
        audioBlob: blob, duration, addedAt: new Date().toISOString(),
        isDefault: true, isActive: true, rootNote: rn,
      }
      await samplePut(e)
      await load()
      onChanged()
      setExpanded(true)
    } finally { setRendering(false) }
  }

  async function handleFile(file: File) {
    setUploading(true)
    try {
      const blob     = new Blob([await file.arrayBuffer()], { type: file.type })
      const duration = await getBlobDuration(blob)
      const e: SampleEntry = {
        id: crypto.randomUUID(), beatType: type,
        name: file.name.replace(/\.\w+$/, ''),
        audioBlob: blob, duration, addedAt: new Date().toISOString(),
        isDefault: false, isActive: true, rootNote: DEFAULT_NOTES[type] ?? 60,
      }
      await samplePut(e)
      await load()
      onChanged()
      setExpanded(true)
    } finally { setUploading(false) }
  }

  async function activate(id: string) {
    await sampleSetActive(id, type)
    await load()
    onChanged()
  }

  async function remove(id: string) {
    await sampleDelete(id)
    await load()
    onChanged()
  }

  return (
    <div style={{ borderRadius: 8, border: `1px solid ${active ? 'var(--border)' : 'rgba(139,92,246,0.12)'}`, background: active ? 'var(--bg-card)' : 'rgba(139,92,246,0.03)', overflow: 'hidden' }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px' }}>
        <button
          onClick={() => setExpanded(v => !v)}
          style={{ background: 'none', border: 'none', cursor: variations.length > 0 ? 'pointer' : 'default', padding: 0, color: 'var(--text-muted)', flexShrink: 0 }}
        >
          {variations.length > 0
            ? (expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />)
            : <div style={{ width: 11 }} />
          }
        </button>

        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', flex: 1 }}>
          {SAMPLE_TYPE_LABELS[type] ?? type}
        </span>

        {variations.length > 0 && (
          <span style={{ fontSize: 9, color: 'var(--text-muted)', padding: '1px 5px', borderRadius: 10, background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
            {variations.length} var{variations.length !== 1 ? 's' : ''}
          </span>
        )}

        <button onClick={addSynth} disabled={rendering}
          title="Add synth variation"
          style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: rendering ? 'default' : 'pointer' }}
        >
          {rendering ? <RefreshCw size={8} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={8} />}
          Synth
        </button>
        <button onClick={() => fileRef.current?.click()} disabled={uploading}
          title="Upload audio file"
          style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: uploading ? 'default' : 'pointer' }}
        >
          <Upload size={8} /> Upload
        </button>
        <input ref={fileRef} type="file" accept="audio/*" style={{ display: 'none' }} onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
      </div>

      {/* Active sample name preview (collapsed) */}
      {!expanded && active && (
        <div style={{ padding: '0 10px 6px 27px', fontSize: 9, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          ★ {active.name}
        </div>
      )}

      {/* Variations list (expanded) */}
      {expanded && variations.length > 0 && (
        <div style={{ padding: '0 8px 8px', display: 'flex', flexDirection: 'column', gap: 4, borderTop: '1px solid var(--border)' }}>
          <p style={{ fontSize: 9, color: 'var(--text-muted)', padding: '5px 0 2px', letterSpacing: '0.05em' }}>VARIATIONS — click ★ to set active</p>
          {variations.map(v => (
            <VariationRow key={v.id} entry={v} onActivate={activate} onDelete={remove} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function SamplePackPanel() {
  const [totalCount, setTotalCount] = useState<number | null>(null)
  const [seeding,    setSeeding]    = useState(false)
  const [seedDone,   setSeedDone]   = useState(false)
  const [refresh,    setRefresh]    = useState(0)

  const recount = useCallback(async () => {
    const all = await sampleGetAll().catch(() => [])
    const activeTypes = new Set(all.filter(e => e.isActive).map(e => e.beatType))
    setTotalCount(activeTypes.size)
  }, [])

  useEffect(() => { recount() }, [recount, refresh])

  async function seedAll() {
    setSeeding(true); setSeedDone(false)
    try {
      for (const type of SAMPLE_PACK_TYPES) {
        const rootNote = DEFAULT_NOTES[type] ?? 60
        const { blob, rootNote: rn } = await renderSynthSample(type, rootNote)
        const duration = await getBlobDuration(blob)
        await samplePut({
          id: crypto.randomUUID(), beatType: type,
          name: `${SAMPLE_TYPE_LABELS[type] ?? type} (synth)`,
          audioBlob: blob, duration, addedAt: new Date().toISOString(),
          isDefault: true, isActive: true, rootNote: rn,
        })
      }
      setRefresh(r => r + 1)
      setSeedDone(true)
      setTimeout(() => setSeedDone(false), 3000)
    } finally { setSeeding(false) }
  }

  async function clearAll() {
    if (!confirm('Remove ALL samples from the pack? This cannot be undone.')) return
    await sampleClear()
    setRefresh(r => r + 1)
    setTotalCount(0)
  }

  const groups = ['drums', 'guitar', 'piano', 'synth', 'other']

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          {totalCount === null ? '…' : `${totalCount}/${SAMPLE_PACK_TYPES.length}`} types active
        </span>
        <button onClick={seedAll} disabled={seeding}
          style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, padding: '5px 12px', borderRadius: 6, background: seeding ? 'var(--bg-card)' : 'var(--accent)', color: seeding ? 'var(--text-muted)' : '#fff', border: 'none', cursor: seeding ? 'default' : 'pointer', fontWeight: 600 }}
        >
          {seeding
            ? <><RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} /> Generating…</>
            : seedDone ? <><Check size={12} /> Done!</> : '⚡ Seed all from synth'}
        </button>
        <button onClick={clearAll}
          style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, background: 'rgba(239,68,68,0.08)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.25)', cursor: 'pointer' }}
        >
          Clear all
        </button>
      </div>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16 }}>
        Each type can hold multiple variations. Click ★ on a variation to make it active. BeatLab uses the active sample, pitch-shifted to match each note.
      </p>

      {/* Grid by group */}
      {groups.map(group => {
        const types = SAMPLE_PACK_TYPES.filter(t => groupOf(t) === group)
        return (
          <div key={group} style={{ marginBottom: 20 }}>
            <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: 8 }}>
              {GROUP_LABELS[group]}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
              {types.map(type => (
                <TypeSlot
                  key={`${type}-${refresh}`}
                  type={type}
                  onChanged={() => setRefresh(r => r + 1)}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
