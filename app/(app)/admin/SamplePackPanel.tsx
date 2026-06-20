'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Play, Square, Upload, RefreshCw, Trash2, Check } from 'lucide-react'
import {
  sampleGetAll, samplePut, sampleDelete, sampleClear, renderSynthSample,
  SAMPLE_PACK_TYPES, SAMPLE_TYPE_LABELS,
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

// ── Single type slot ──────────────────────────────────────────────────────────

function SampleSlot({
  type, entry, onUploaded, onDeleted,
}: {
  type: BeatType
  entry: SampleEntry | undefined
  onUploaded: (e: SampleEntry) => void
  onDeleted: (id: string) => void
}) {
  const [playing, setPlaying]     = useState(false)
  const [rendering, setRendering] = useState(false)
  const [uploading, setUploading] = useState(false)
  const audioRef    = useRef<HTMLAudioElement | null>(null)
  const urlRef      = useRef<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function stopAudio() {
    audioRef.current?.pause()
    setPlaying(false)
  }

  function playEntry(blob: Blob) {
    stopAudio()
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    urlRef.current = URL.createObjectURL(blob)
    const audio = audioRef.current ?? new Audio()
    audioRef.current = audio
    audio.src = urlRef.current
    audio.onended = () => setPlaying(false)
    audio.play().catch(() => {})
    setPlaying(true)
  }

  useEffect(() => () => {
    audioRef.current?.pause()
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
  }, [])

  async function seedSynth() {
    setRendering(true)
    try {
      const blob     = await renderSynthSample(type, DEFAULT_NOTES[type] ?? 60)
      const duration = await getBlobDuration(blob)
      const entry: SampleEntry = {
        id: crypto.randomUUID(), beatType: type,
        name: `${SAMPLE_TYPE_LABELS[type] ?? type} (synth)`,
        audioBlob: blob, duration, addedAt: new Date().toISOString(), isDefault: true,
      }
      await samplePut(entry)
      onUploaded(entry)
    } finally {
      setRendering(false)
    }
  }

  async function handleFile(file: File) {
    setUploading(true)
    try {
      const blob     = new Blob([await file.arrayBuffer()], { type: file.type })
      const duration = await getBlobDuration(blob)
      const e: SampleEntry = {
        id: crypto.randomUUID(), beatType: type,
        name: file.name.replace(/\.\w+$/, ''),
        audioBlob: blob, duration, addedAt: new Date().toISOString(), isDefault: false,
      }
      await samplePut(e)
      onUploaded(e)
    } finally {
      setUploading(false)
    }
  }

  const hasEntry = !!entry

  return (
    <div style={{
      borderRadius: 8, border: `1px solid ${hasEntry ? 'var(--border)' : 'rgba(139,92,246,0.15)'}`,
      background: hasEntry ? 'var(--bg-card)' : 'rgba(139,92,246,0.04)',
      padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>
          {SAMPLE_TYPE_LABELS[type] ?? type}
        </span>
        {hasEntry && (
          <span style={{ fontSize: 9, color: entry.isDefault ? 'var(--text-muted)' : 'var(--accent-light)', padding: '1px 5px', borderRadius: 3, background: entry.isDefault ? 'var(--bg-surface)' : 'rgba(139,92,246,0.12)', border: '1px solid var(--border)' }}>
            {entry.isDefault ? 'synth' : 'custom'}
          </span>
        )}
      </div>

      {hasEntry ? (
        <div style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {entry.name}
        </div>
      ) : (
        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>No sample</div>
      )}

      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {hasEntry && (
          <button
            onClick={() => playing ? stopAudio() : playEntry(entry.audioBlob)}
            style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9, padding: '3px 7px', borderRadius: 4, background: playing ? '#dc2626' : 'var(--bg-surface)', border: '1px solid var(--border)', color: playing ? '#fff' : 'var(--text-secondary)', cursor: 'pointer' }}
          >
            {playing ? <Square size={8} fill="currentColor" /> : <Play size={8} fill="currentColor" style={{ marginLeft: 1 }} />}
            {playing ? 'Stop' : 'Play'}
          </button>
        )}
        <button
          onClick={seedSynth}
          disabled={rendering}
          title="Generate from synth"
          style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9, padding: '3px 7px', borderRadius: 4, background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: rendering ? 'default' : 'pointer' }}
        >
          {rendering ? <RefreshCw size={8} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={8} />}
          {hasEntry ? 'Re-synth' : 'Seed'}
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          title="Upload custom sample"
          style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9, padding: '3px 7px', borderRadius: 4, background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: uploading ? 'default' : 'pointer' }}
        >
          <Upload size={8} /> Upload
        </button>
        {hasEntry && (
          <button
            onClick={async () => { await sampleDelete(entry.id); onDeleted(entry.id) }}
            title="Remove sample"
            style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9, padding: '3px 7px', borderRadius: 4, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444', cursor: 'pointer' }}
          >
            <Trash2 size={8} />
          </button>
        )}
        <input ref={fileInputRef} type="file" accept="audio/*" style={{ display: 'none' }} onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
      </div>
    </div>
  )
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

// ── Main panel ────────────────────────────────────────────────────────────────

export default function SamplePackPanel() {
  const [entries, setEntries]   = useState<SampleEntry[] | null>(null)
  const [seeding, setSeeding]   = useState(false)
  const [seedDone, setSeedDone] = useState(false)

  const load = useCallback(async () => {
    const all = await sampleGetAll().catch(() => [])
    setEntries(all)
  }, [])

  useEffect(() => { load() }, [load])

  async function seedAll() {
    setSeeding(true)
    setSeedDone(false)
    try {
      for (const type of SAMPLE_PACK_TYPES) {
        const blob     = await renderSynthSample(type, DEFAULT_NOTES[type] ?? 60)
        const duration = await getBlobDuration(blob)
        await samplePut({
          id: crypto.randomUUID(), beatType: type,
          name: `${SAMPLE_TYPE_LABELS[type] ?? type} (synth)`,
          audioBlob: blob, duration, addedAt: new Date().toISOString(), isDefault: true,
        })
      }
      await load()
      setSeedDone(true)
      setTimeout(() => setSeedDone(false), 3000)
    } finally {
      setSeeding(false)
    }
  }

  async function clearAll() {
    if (!confirm('Remove all samples from the pack? This cannot be undone.')) return
    await sampleClear()
    setEntries([])
  }

  if (entries === null) return <p style={{ fontSize: 13, color: 'var(--text-muted)', padding: '12px 0' }}>Loading…</p>

  const byType = new Map(entries.map(e => [e.beatType, e]))
  const groups = ['drums', 'guitar', 'piano', 'synth', 'other']

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          {entries.length}/{SAMPLE_PACK_TYPES.length} slots filled
        </span>
        <button
          onClick={seedAll}
          disabled={seeding}
          style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, padding: '5px 12px', borderRadius: 6, background: seeding ? 'var(--bg-card)' : 'var(--accent)', color: seeding ? 'var(--text-muted)' : '#fff', border: 'none', cursor: seeding ? 'default' : 'pointer', fontWeight: 600 }}
        >
          {seeding
            ? <><RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} /> Generating…</>
            : seedDone
              ? <><Check size={12} /> Done!</>
              : '⚡ Seed all from synth'}
        </button>
        <button
          onClick={clearAll}
          style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, background: 'rgba(239,68,68,0.08)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.25)', cursor: 'pointer' }}
        >
          Clear all
        </button>
      </div>

      {/* Grid by group */}
      {groups.map(group => {
        const types = SAMPLE_PACK_TYPES.filter(t => groupOf(t) === group)
        return (
          <div key={group} style={{ marginBottom: 20 }}>
            <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: 8 }}>
              {GROUP_LABELS[group]}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
              {types.map(type => (
                <SampleSlot
                  key={type}
                  type={type}
                  entry={byType.get(type)}
                  onUploaded={e => setEntries(prev => {
                    if (!prev) return [e]
                    const without = prev.filter(x => x.beatType !== e.beatType)
                    return [...without, e]
                  })}
                  onDeleted={id => setEntries(prev => prev?.filter(x => x.id !== id) ?? [])}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
