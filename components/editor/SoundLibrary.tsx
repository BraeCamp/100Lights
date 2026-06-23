'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Mic, Upload, Play, Square, Trash2, Pencil, Check, X, RotateCcw, FolderPlus, ChevronRight, ChevronDown, Folder, FolderOpen } from 'lucide-react'
import {
  libraryGetAll, libraryAdd, libraryUpdate, libraryDelete,
  blobToUrl, getAudioDurationFromBlob,
  CATEGORY_LABELS, LIBRARY_CATEGORIES,
  type LibraryEntry, type LibraryCategory,
} from '@/lib/sound-library'
import { computeHitFeatures } from '@/lib/beat-features'
import { encodeWav, decodeAiff } from '@/lib/wav-codec'
import { SAMPLE_CATALOG, catalogEntryId } from '@/lib/sample-catalog'
import { synthCatalogSample } from '@/lib/drum-synth'

// ── Category color map ────────────────────────────────────────────────────────
const CAT_COLORS: Record<string, string> = {
  kick: '#ef4444', snare: '#f97316', hihat: '#eab308', 'open-hihat': '#84cc16',
  clap: '#22c55e', tom: '#14b8a6', crash: '#06b6d4', rim: '#3b82f6',
  'guitar-acoustic': '#8b5cf6', 'guitar-electric': '#a855f7', 'piano-grand': '#ec4899',
  'synth-lead': '#f43f5e', 'synth-bass': '#6366f1', voice: '#0ea5e9', custom: '#94a3b8',
}
function colorFor(cat: string) { return CAT_COLORS[cat] ?? '#94a3b8' }

// ── Mini waveform bars (static) ───────────────────────────────────────────────
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

// ── Entry row ─────────────────────────────────────────────────────────────────
function EntryRow({
  entry, folders, onDelete, onRename, onCategoryChange, onFolderChange,
}: {
  entry: LibraryEntry
  folders: string[]
  onDelete: (id: string) => void
  onRename: (id: string, name: string) => void
  onCategoryChange: (id: string, cat: LibraryCategory) => void
  onFolderChange: (id: string, folder: string | undefined) => void
}) {
  const [editing, setEditing]         = useState(false)
  const [draft, setDraft]             = useState(entry.name)
  const [playing, setPlaying]         = useState(false)
  const [folderOpen, setFolderOpen]   = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const urlRef   = useRef<string | null>(null)
  const folderRef = useRef<HTMLDivElement>(null)

  function togglePlay() {
    if (playing) { audioRef.current?.pause(); setPlaying(false); return }
    if (!urlRef.current) urlRef.current = blobToUrl(entry.audioBlob)
    const audio = audioRef.current ?? new Audio()
    audioRef.current = audio
    audio.src     = urlRef.current
    audio.onended = () => setPlaying(false)
    audio.play().catch(() => {})
    setPlaying(true)
  }

  useEffect(() => () => {
    audioRef.current?.pause()
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
  }, [])

  // Close folder picker when clicking outside
  useEffect(() => {
    if (!folderOpen) return
    function onClickOutside(e: MouseEvent) {
      if (folderRef.current && !folderRef.current.contains(e.target as Node)) setFolderOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [folderOpen])

  function commitRename() {
    if (draft.trim() && draft !== entry.name) onRename(entry.id, draft.trim())
    setEditing(false)
  }

  const color = colorFor(entry.category)

  return (
    <div
      draggable
      onDragStart={e => {
        e.dataTransfer.effectAllowed = 'copy'
        e.dataTransfer.setData('application/x-library-entry-id', entry.id)
        e.dataTransfer.setData('text/plain', entry.name)
        // Ghost image: a small chip
        const ghost = document.createElement('div')
        ghost.textContent = `♪ ${entry.name}`
        ghost.style.cssText = `position:fixed;top:-999px;left:-999px;background:#1e1e2e;color:#a78bfa;border:1px solid #7c3aed;border-radius:6px;padding:4px 10px;font-size:11px;font-weight:600;pointer-events:none`
        document.body.appendChild(ghost)
        e.dataTransfer.setDragImage(ghost, 0, 0)
        setTimeout(() => document.body.removeChild(ghost), 0)
      }}
      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderLeft: `2px solid ${color}`, margin: '2px 0', cursor: 'grab', userSelect: 'none' }}
    >
      <button onClick={togglePlay} style={{ width: 20, height: 20, borderRadius: '50%', background: playing ? '#dc2626' : 'var(--bg-card)', border: `1px solid ${color}`, color, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {playing ? <Square size={7} fill="currentColor" /> : <Play size={7} fill="currentColor" style={{ marginLeft: 1 }} />}
      </button>
      <WaveBars spectral={entry.spectral} />
      <div style={{ flex: 1, minWidth: 0 }}>
        {editing ? (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input autoFocus value={draft} onChange={e => setDraft(e.target.value)}
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

      {/* Folder picker */}
      <div ref={folderRef} style={{ position: 'relative', flexShrink: 0 }}>
        <button
          onClick={() => setFolderOpen(v => !v)}
          title={entry.folder ? `Folder: ${entry.folder}` : 'Move to folder'}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: entry.folder ? 'rgba(167,139,250,0.8)' : 'var(--text-muted)', padding: 0, opacity: entry.folder ? 1 : 0.45, display: 'flex' }}
        >
          <Folder size={10} />
        </button>
        {folderOpen && (
          <div style={{
            position: 'absolute', right: 0, top: '100%', marginTop: 4, zIndex: 50,
            background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 7,
            padding: '4px 0', minWidth: 130, boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          }}>
            <button
              onClick={() => { onFolderChange(entry.id, undefined); setFolderOpen(false) }}
              style={{ ...folderOptStyle, color: !entry.folder ? '#a78bfa' : 'var(--text-secondary)', fontWeight: !entry.folder ? 700 : 400 }}
            >
              No folder
            </button>
            {folders.map(f => (
              <button
                key={f}
                onClick={() => { onFolderChange(entry.id, f); setFolderOpen(false) }}
                style={{ ...folderOptStyle, color: entry.folder === f ? '#a78bfa' : 'var(--text-secondary)', fontWeight: entry.folder === f ? 700 : 400 }}
              >
                {f}
              </button>
            ))}
            {folders.length === 0 && (
              <div style={{ fontSize: 9, color: 'var(--text-muted)', padding: '4px 10px' }}>No folders yet</div>
            )}
          </div>
        )}
      </div>

      <button onClick={() => onDelete(entry.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, flexShrink: 0, opacity: 0.5 }}>
        <Trash2 size={10} />
      </button>
    </div>
  )
}

const folderOptStyle: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left',
  padding: '5px 10px', fontSize: 10, background: 'none', border: 'none', cursor: 'pointer',
}

// ── Folder header ─────────────────────────────────────────────────────────────
function FolderHeader({
  name, count, collapsed, onToggle, onRename, onDelete,
  isDragOver, onDragOver, onDragLeave, onDrop,
}: {
  name: string; count: number; collapsed: boolean
  onToggle: () => void
  onRename: (newName: string) => void
  onDelete: () => void
  isDragOver: boolean
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(name)

  function commit() {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== name) onRename(trimmed)
    setEditing(false)
  }

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{
        display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px',
        borderTop: '1px solid var(--border)', borderBottom: collapsed ? '1px solid var(--border)' : 'none',
        background: isDragOver ? 'rgba(139,92,246,0.1)' : 'var(--bg-surface)',
        transition: 'background 0.1s', cursor: 'pointer',
        borderLeft: `2px solid ${isDragOver ? '#7c3aed' : 'rgba(139,92,246,0.3)'}`,
      }}
    >
      <button onClick={onToggle} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, display: 'flex', alignItems: 'center' }}>
        {collapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
      </button>
      {collapsed ? <Folder size={10} style={{ color: 'rgba(167,139,250,0.7)', flexShrink: 0 }} /> : <FolderOpen size={10} style={{ color: 'rgba(167,139,250,0.7)', flexShrink: 0 }} />}
      {editing ? (
        <input
          autoFocus value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(name); setEditing(false) } }}
          onBlur={commit}
          style={{ flex: 1, fontSize: 10, background: 'var(--bg-card)', border: '1px solid var(--accent)', borderRadius: 3, padding: '1px 4px', color: 'var(--text-primary)' }}
          onClick={e => e.stopPropagation()}
        />
      ) : (
        <span
          onClick={onToggle}
          style={{ flex: 1, fontSize: 10, fontWeight: 600, color: 'var(--text-secondary)', letterSpacing: '0.03em' }}
        >
          {name}
        </span>
      )}
      <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{count}</span>
      <button onClick={e => { e.stopPropagation(); setEditing(true); setDraft(name) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, opacity: 0.6 }}>
        <Pencil size={8} />
      </button>
      <button onClick={e => { e.stopPropagation(); onDelete() }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, opacity: 0.6 }}>
        <X size={9} />
      </button>
    </div>
  )
}

// ── Waveform canvas with drag-to-trim handles ─────────────────────────────────
function WaveformTrimmer({
  buf, trimStart, trimEnd, onTrimChange,
}: {
  buf: AudioBuffer
  trimStart: number  // 0..1
  trimEnd: number    // 0..1
  onTrimChange: (start: number, end: number) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const draggingRef = useRef<'start' | 'end' | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const W = canvas.width, H = canvas.height
    const data = buf.getChannelData(0)

    ctx.clearRect(0, 0, W, H)

    const bars = W
    const spb  = Math.max(1, Math.floor(data.length / bars))
    for (let i = 0; i < bars; i++) {
      let peak = 0
      for (let j = 0; j < spb; j++) peak = Math.max(peak, Math.abs(data[i * spb + j] ?? 0))
      const bh = Math.max(1, peak * (H - 4) * 0.9)
      const x  = i
      const inTrim = x >= trimStart * W && x <= trimEnd * W
      ctx.fillStyle = inTrim ? '#8b5cf6' : 'rgba(139,92,246,0.25)'
      ctx.fillRect(x, (H - bh) / 2, 1, bh)
    }

    ctx.fillStyle = 'rgba(0,0,0,0.45)'
    ctx.fillRect(0, 0, trimStart * W, H)
    ctx.fillRect(trimEnd * W, 0, W - trimEnd * W, H)

    const drawHandle = (x: number) => {
      ctx.strokeStyle = '#f59e0b'
      ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke()
      ctx.fillStyle = '#f59e0b'
      ctx.beginPath(); ctx.moveTo(x - 5, 0); ctx.lineTo(x + 5, 0); ctx.lineTo(x, 8); ctx.closePath(); ctx.fill()
    }
    drawHandle(trimStart * W)
    drawHandle(trimEnd * W)
  }, [buf, trimStart, trimEnd])

  function posToRatio(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect()
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  }

  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    const r = posToRatio(e)
    draggingRef.current = Math.abs(r - trimStart) < Math.abs(r - trimEnd) ? 'start' : 'end'
  }

  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!draggingRef.current) return
    const r = posToRatio(e)
    if (draggingRef.current === 'start') {
      onTrimChange(Math.min(r, trimEnd - 0.02), trimEnd)
    } else {
      onTrimChange(trimStart, Math.max(r, trimStart + 0.02))
    }
  }

  function onMouseUp() { draggingRef.current = null }

  return (
    <canvas
      ref={canvasRef}
      width={480}
      height={64}
      style={{ width: '100%', height: 64, display: 'block', borderRadius: 6, cursor: 'ew-resize', background: '#0d0d10' }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    />
  )
}

// ── Apply edits to an AudioBuffer, return a new AudioBuffer ──────────────────
function applyEdits(
  src: AudioBuffer,
  trimStart: number,
  trimEnd: number,
  gain: number,
  fadeInFrac: number,
  fadeOutFrac: number,
  reversed: boolean,
): AudioBuffer {
  const startSamp = Math.floor(trimStart * src.length)
  const endSamp   = Math.floor(trimEnd   * src.length)
  const len       = Math.max(1, endSamp - startSamp)

  const out = new AudioBuffer({ numberOfChannels: src.numberOfChannels, length: len, sampleRate: src.sampleRate })

  for (let ch = 0; ch < src.numberOfChannels; ch++) {
    const src_ = src.getChannelData(ch)
    const dst  = out.getChannelData(ch)
    for (let i = 0; i < len; i++) dst[i] = (src_[startSamp + i] ?? 0) * gain
    const fi = Math.floor(fadeInFrac * len)
    for (let i = 0; i < fi; i++) dst[i] *= i / fi
    const fo = Math.floor(fadeOutFrac * len)
    for (let i = 0; i < fo; i++) dst[len - 1 - i] *= i / fo
    if (reversed) dst.reverse()
  }
  return out
}

// ── Add-to-Library modal ──────────────────────────────────────────────────────
export function AddToLibraryModal({
  onClose, onAdded, initialBuffer,
}: {
  onClose:       () => void
  onAdded:       () => void
  initialBuffer?: AudioBuffer
}) {
  type Mode = 'choose' | 'record' | 'edit'
  const [mode, setMode]       = useState<Mode>(initialBuffer ? 'edit' : 'choose')
  const [recording, setRec]   = useState(false)
  const [srcBuf, setSrcBuf]   = useState<AudioBuffer | null>(initialBuffer ?? null)
  const [name, setName]       = useState('')
  const [category, setCat]    = useState<LibraryCategory>('custom')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')

  const [trimStart, setTrimStart] = useState(0)
  const [trimEnd,   setTrimEnd]   = useState(1)
  const [gain,      setGain]      = useState(1)
  const [fadeIn,    setFadeIn]    = useState(0)
  const [fadeOut,   setFadeOut]   = useState(0)
  const [reversed,  setReversed]  = useState(false)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef   = useRef<Blob[]>([])
  const previewRef  = useRef<{ src: AudioBufferSourceNode; ctx: AudioContext } | null>(null)
  const [previewing, setPreviewing] = useState(false)

  const trimmedDur = srcBuf ? ((trimEnd - trimStart) * srcBuf.duration).toFixed(2) : '0.00'

  async function startRecord() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      chunksRef.current = []
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.start(100)
      recorderRef.current = mr
      setRec(true)
      setMode('record')
    } catch { setError('Microphone access denied') }
  }

  async function stopRecord() {
    const mr = recorderRef.current
    if (!mr) return
    setRec(false)
    const blob = await new Promise<Blob>(resolve => {
      mr.onstop = () => resolve(new Blob(chunksRef.current, { type: 'audio/webm' }))
      mr.stop()
      mr.stream.getTracks().forEach(t => t.stop())
    })
    loadBlob(blob)
  }

  async function loadFile(file: File) {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    if (ext === 'aif' || ext === 'aiff') {
      try {
        const { channels, sampleRate } = decodeAiff(await file.arrayBuffer())
        const ctx = new AudioContext()
        const buf = ctx.createBuffer(channels.length, channels[0].length, sampleRate)
        for (let ch = 0; ch < channels.length; ch++) buf.getChannelData(ch).set(channels[ch])
        ctx.close()
        setSrcBuf(buf)
        setTrimStart(0); setTrimEnd(1)
        setGain(1); setFadeIn(0); setFadeOut(0); setReversed(false)
        setMode('edit')
      } catch { setError('Could not decode AIFF file') }
      return
    }
    if (!file.type.startsWith('audio/') && ext !== 'wav' && ext !== 'mp3' && ext !== 'ogg' && ext !== 'flac' && ext !== 'm4a') {
      setError('Audio files only'); return
    }
    loadBlob(new Blob([await file.arrayBuffer()], { type: file.type || 'audio/mpeg' }))
  }

  async function loadBlob(blob: Blob) {
    try {
      const ctx = new AudioContext()
      const buf = await ctx.decodeAudioData(await blob.arrayBuffer())
      ctx.close()
      setSrcBuf(buf)
      setTrimStart(0); setTrimEnd(1)
      setGain(1); setFadeIn(0); setFadeOut(0); setReversed(false)
      setMode('edit')
    } catch { setError('Could not decode audio') }
  }

  function stopPreview() {
    if (previewRef.current) {
      try { previewRef.current.src.stop() } catch { /* ok */ }
      previewRef.current.ctx.close()
      previewRef.current = null
    }
    setPreviewing(false)
  }

  async function togglePreview() {
    if (previewing) { stopPreview(); return }
    if (!srcBuf) return
    const edited = applyEdits(srcBuf, trimStart, trimEnd, gain, fadeIn, fadeOut, reversed)
    const ctx = new AudioContext()
    const src = ctx.createBufferSource()
    src.buffer = edited
    src.connect(ctx.destination)
    src.onended = () => { previewRef.current = null; setPreviewing(false) }
    src.start()
    previewRef.current = { src, ctx }
    setPreviewing(true)
  }

  useEffect(() => () => stopPreview(), [])

  async function save() {
    if (!srcBuf) return
    stopPreview()
    setSaving(true)
    try {
      const edited = applyEdits(srcBuf, trimStart, trimEnd, gain, fadeIn, fadeOut, reversed)
      const channels = Array.from({ length: edited.numberOfChannels }, (_, ch) => edited.getChannelData(ch))
      const wavBuf   = encodeWav(channels, edited.sampleRate)
      const blob     = new Blob([wavBuf], { type: 'audio/wav' })
      const duration = edited.duration

      let spectral: LibraryEntry['spectral'] | undefined
      if (duration <= 3) {
        const raw = edited.getChannelData(0)
        const { spectral: s } = computeHitFeatures(raw, 0, edited.sampleRate)
        spectral = s
      }

      await libraryAdd({
        id:        crypto.randomUUID(),
        name:      name.trim() || `Sound ${new Date().toLocaleTimeString()}`,
        category,
        audioBlob: blob,
        spectral,
        duration,
        addedAt:   new Date().toISOString(),
      })
      onAdded()
      onClose()
    } catch { setError('Failed to save sound') }
    finally { setSaving(false) }
  }

  const row = (label: string, children: React.ReactNode) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 10, color: 'var(--text-muted)', width: 56, flexShrink: 0 }}>{label}</span>
      {children}
    </div>
  )

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 22, width: 'min(480px,94vw)', display: 'flex', flexDirection: 'column', gap: 14, maxHeight: '90vh', overflowY: 'auto' }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Add to Library</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={15} /></button>
        </div>

        {mode === 'choose' && (
          <>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={startRecord} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '16px 0', borderRadius: 10, background: 'rgba(220,38,38,0.12)', color: '#f87171', border: '1px solid rgba(220,38,38,0.3)', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                <Mic size={22} />
                Record
              </button>
              <button onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'audio/*'; inp.onchange = () => inp.files?.[0] && loadFile(inp.files[0]); inp.click() }}
                style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '16px 0', borderRadius: 10, background: 'var(--bg-card)', color: 'var(--text-secondary)', border: '1px solid var(--border)', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                <Upload size={22} />
                Import
              </button>
            </div>
            {error && <p style={{ fontSize: 11, color: '#ef4444', textAlign: 'center' }}>{error}</p>}
          </>
        )}

        {mode === 'record' && (
          <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(220,38,38,0.15)', border: '2px solid rgba(220,38,38,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Mic size={26} color="#dc2626" />
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>{recording ? 'Recording…' : 'Ready'}</p>
            {recording && (
              <button onClick={stopRecord} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 20px', borderRadius: 8, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 12 }}>
                <Square size={10} fill="currentColor" /> Stop & Edit
              </button>
            )}
            {error && <p style={{ fontSize: 11, color: '#ef4444' }}>{error}</p>}
          </div>
        )}

        {mode === 'edit' && srcBuf && (
          <>
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 5 }}>
                Drag yellow handles to trim · {trimmedDur}s selected
              </div>
              <WaveformTrimmer
                buf={srcBuf}
                trimStart={trimStart}
                trimEnd={trimEnd}
                onTrimChange={(s, e) => { setTrimStart(s); setTrimEnd(e) }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' }}>
              {row('Gain', (
                <div style={{ display: 'flex', flex: 1, alignItems: 'center', gap: 8 }}>
                  <input type="range" min={0.1} max={3} step={0.05} value={gain}
                    onChange={e => setGain(Number(e.target.value))}
                    style={{ flex: 1, accentColor: 'var(--accent)' }} />
                  <span style={{ fontSize: 10, color: 'var(--text-secondary)', minWidth: 36, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{Math.round(gain * 100)}%</span>
                </div>
              ))}
              {row('Fade in', (
                <div style={{ display: 'flex', flex: 1, alignItems: 'center', gap: 8 }}>
                  <input type="range" min={0} max={0.5} step={0.01} value={fadeIn}
                    onChange={e => setFadeIn(Number(e.target.value))}
                    style={{ flex: 1, accentColor: 'var(--accent)' }} />
                  <span style={{ fontSize: 10, color: 'var(--text-secondary)', minWidth: 36, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{Math.round(fadeIn * 100)}%</span>
                </div>
              ))}
              {row('Fade out', (
                <div style={{ display: 'flex', flex: 1, alignItems: 'center', gap: 8 }}>
                  <input type="range" min={0} max={0.5} step={0.01} value={fadeOut}
                    onChange={e => setFadeOut(Number(e.target.value))}
                    style={{ flex: 1, accentColor: 'var(--accent)' }} />
                  <span style={{ fontSize: 10, color: 'var(--text-secondary)', minWidth: 36, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{Math.round(fadeOut * 100)}%</span>
                </div>
              ))}
              {row('', (
                <button onClick={() => setReversed(v => !v)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 6, border: `1px solid ${reversed ? 'rgba(139,92,246,0.5)' : 'var(--border)'}`, background: reversed ? 'rgba(139,92,246,0.15)' : 'var(--bg-card)', color: reversed ? 'var(--accent-light)' : 'var(--text-secondary)', cursor: 'pointer', fontSize: 11 }}>
                  <RotateCcw size={10} /> {reversed ? 'Reversed' : 'Reverse'}
                </button>
              ))}
            </div>

            <input value={name} onChange={e => setName(e.target.value)}
              placeholder="Sound name (optional)"
              style={{ fontSize: 12, padding: '7px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)' }}
            />
            <select value={category} onChange={e => setCat(e.target.value as LibraryCategory)}
              style={{ fontSize: 12, padding: '7px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)' }}>
              {LIBRARY_CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
            </select>

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={togglePreview} style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 8, border: `1px solid ${previewing ? 'rgba(139,92,246,0.5)' : 'var(--border)'}`, background: previewing ? 'rgba(139,92,246,0.12)' : 'var(--bg-card)', color: previewing ? 'var(--accent-light)' : 'var(--text-secondary)', cursor: 'pointer', fontSize: 12 }}>
                {previewing ? <><Square size={10} fill="currentColor" /> Stop</> : <><Play size={10} fill="currentColor" style={{ marginLeft: 1 }} /> Preview</>}
              </button>
              <button onClick={() => { setMode('choose'); setSrcBuf(null) }} style={{ flex: '0 0 auto', padding: '9px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12 }}>
                ← Back
              </button>
              <button onClick={save} disabled={saving} style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: 'none', background: saving ? 'rgba(139,92,246,0.3)' : 'var(--accent)', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                {saving ? 'Saving…' : 'Save to Library'}
              </button>
            </div>
            {error && <p style={{ fontSize: 11, color: '#ef4444', textAlign: 'center' }}>{error}</p>}
          </>
        )}
      </div>
    </div>
  )
}

// ── Main SoundLibrary panel ───────────────────────────────────────────────────
const FOLDERS_KEY = 'sound-library-folders'

export default function SoundLibrary({ embedded }: { embedded?: boolean }) {
  const [entries,          setEntries]          = useState<LibraryEntry[]>([])
  const [folders,          setFolders]          = useState<string[]>([])
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set())
  const [catalogCollapsed, setCatalogCollapsed] = useState(false)
  const [downloading,      setDownloading]      = useState<Set<string>>(new Set())
  const [catalogPreviewing, setCatalogPreviewing] = useState<string | null>(null)
  const catalogAudioRef = useRef<HTMLAudioElement | null>(null)
  const [dragOverFolder,   setDragOverFolder]   = useState<string | null>(null)
  const [showAdd,          setShowAdd]          = useState(false)
  const [addingFolder,     setAddingFolder]     = useState(false)
  const [newFolderDraft,   setNewFolderDraft]   = useState('')
  const newFolderRef = useRef<HTMLInputElement>(null)

  // Persist folders in localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(FOLDERS_KEY)
      if (saved) setFolders(JSON.parse(saved))
    } catch {}
  }, [])

  const saveFolders = useCallback((next: string[]) => {
    setFolders(next)
    try { localStorage.setItem(FOLDERS_KEY, JSON.stringify(next)) } catch {}
  }, [])

  const load = useCallback(async () => {
    const all = await libraryGetAll()
    setEntries(all.sort((a, b) => b.addedAt.localeCompare(a.addedAt)))
  }, [])

  // Seed all 18 catalog samples into IndexedDB using synthesis (no external files needed)
  useEffect(() => {
    async function seed() {
      const existing = await libraryGetAll()
      const existingIds = new Set(existing.map(e => e.id))
      const SR = 44100
      let added = 0
      for (const sample of SAMPLE_CATALOG) {
        const id = catalogEntryId(sample.id)
        if (existingIds.has(id)) continue
        const pcm = synthCatalogSample(sample.id, SR)
        const wav = encodeWav([pcm], SR)
        await libraryAdd({
          id,
          name:      sample.name,
          category:  sample.category as LibraryCategory,
          audioBlob: new Blob([wav], { type: 'audio/wav' }),
          duration:  pcm.length / SR,
          addedAt:   new Date().toISOString(),
          folder:    '100Lights',
        })
        added++
      }
      if (added > 0) await load()
    }
    seed().catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { load() }, [load])

  // Focus new-folder input when it appears
  useEffect(() => {
    if (addingFolder) setTimeout(() => newFolderRef.current?.focus(), 30)
  }, [addingFolder])

  // IDs of already-downloaded catalog samples
  const downloadedCatalogIds = useMemo(
    () => new Set(entries.map(e => e.id).filter(id => id.startsWith('100l_'))),
    [entries],
  )

  async function downloadSample(sampleId: string, url: string, name: string, category: LibraryCategory, _duration: number) {
    if (downloading.has(sampleId)) return
    setDownloading(prev => new Set(prev).add(sampleId))
    try {
      let blob: Blob
      try {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        blob = new Blob([await res.arrayBuffer()], { type: 'audio/wav' })
      } catch {
        // Fall back to synthesis when the static file doesn't exist yet
        const SR = 44100
        const pcm = synthCatalogSample(sampleId, SR)
        blob = new Blob([encodeWav([pcm], SR)], { type: 'audio/wav' })
      }
      await libraryAdd({
        id:        catalogEntryId(sampleId),
        name,
        category,
        audioBlob: blob,
        duration:  (await blob.arrayBuffer()).byteLength / (44100 * 2 * 2),
        addedAt:   new Date().toISOString(),
        folder:    '100Lights',
      })
      await load()
    } catch {
      // ignore
    } finally {
      setDownloading(prev => { const n = new Set(prev); n.delete(sampleId); return n })
    }
  }

  function previewCatalogSample(sampleId: string, url: string) {
    if (catalogPreviewing === sampleId) {
      catalogAudioRef.current?.pause()
      catalogAudioRef.current = null
      setCatalogPreviewing(null)
      return
    }
    catalogAudioRef.current?.pause()
    const audio = new Audio(url)
    audio.onended = () => setCatalogPreviewing(null)
    audio.play().catch(() => setCatalogPreviewing(null))
    catalogAudioRef.current = audio
    setCatalogPreviewing(sampleId)
  }

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

  async function handleFolderChange(id: string, folder: string | undefined) {
    await libraryUpdate(id, { folder })
    setEntries(prev => prev.map(e => e.id === id ? { ...e, folder } : e))
  }

  function createFolder() {
    const name = newFolderDraft.trim()
    if (!name || folders.includes(name)) { setAddingFolder(false); setNewFolderDraft(''); return }
    saveFolders([...folders, name])
    setAddingFolder(false)
    setNewFolderDraft('')
    setCollapsedFolders(prev => { const s = new Set(prev); s.delete(name); return s })
  }

  function renameFolder(oldName: string, newName: string) {
    if (!newName || newName === oldName || folders.includes(newName)) return
    saveFolders(folders.map(f => f === oldName ? newName : f))
    // Update entries that were in the old folder
    entries.filter(e => e.folder === oldName).forEach(e => handleFolderChange(e.id, newName))
  }

  function deleteFolder(name: string) {
    saveFolders(folders.filter(f => f !== name))
    // Remove folder from entries (move to root)
    entries.filter(e => e.folder === name).forEach(e => handleFolderChange(e.id, undefined))
  }

  function toggleFolderCollapse(name: string) {
    setCollapsedFolders(prev => {
      const s = new Set(prev)
      s.has(name) ? s.delete(name) : s.add(name)
      return s
    })
  }

  // Handle drag-and-drop of entries onto folder headers
  function onFolderDragOver(e: React.DragEvent, folderName: string) {
    if (!e.dataTransfer.types.includes('application/x-library-entry-id')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverFolder(folderName)
  }

  function onFolderDrop(e: React.DragEvent, folderName: string) {
    const id = e.dataTransfer.getData('application/x-library-entry-id')
    setDragOverFolder(null)
    if (!id) return
    e.preventDefault()
    handleFolderChange(id, folderName)
  }

  // Group entries
  const { byFolder, unfiled } = useMemo(() => {
    const map = new Map<string, LibraryEntry[]>()
    const unfiled: LibraryEntry[] = []
    for (const e of entries) {
      if (e.folder && folders.includes(e.folder)) {
        const arr = map.get(e.folder) ?? []
        arr.push(e)
        map.set(e.folder, arr)
      } else {
        unfiled.push(e)
      }
    }
    return { byFolder: map, unfiled }
  }, [entries, folders])

  const entryRow = (entry: LibraryEntry) => (
    <EntryRow
      key={entry.id}
      entry={entry}
      folders={folders}
      onDelete={handleDelete}
      onRename={handleRename}
      onCategoryChange={handleCategoryChange}
      onFolderChange={handleFolderChange}
    />
  )

  const content = (
    <>
      {/* Header toolbar */}
      <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <span style={{ fontSize: 9, color: 'var(--text-muted)', flex: 1 }}>{entries.length} sound{entries.length !== 1 ? 's' : ''}</span>
        <button
          onClick={() => setAddingFolder(true)}
          title="New folder"
          style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9, padding: '3px 7px', borderRadius: 4, background: 'var(--bg-card)', color: 'var(--text-muted)', border: '1px solid var(--border)', cursor: 'pointer' }}
        >
          <FolderPlus size={10} />
        </button>
        <button onClick={() => setShowAdd(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9, padding: '3px 8px', borderRadius: 4, background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
          + Add
        </button>
      </div>

      {/* New folder input */}
      {addingFolder && (
        <div style={{ display: 'flex', gap: 5, padding: '5px 10px', background: 'var(--bg-card)', borderBottom: '1px solid var(--border)' }}>
          <input
            ref={newFolderRef}
            value={newFolderDraft}
            onChange={e => setNewFolderDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') createFolder(); if (e.key === 'Escape') { setAddingFolder(false); setNewFolderDraft('') } }}
            placeholder="Folder name…"
            style={{ flex: 1, fontSize: 10, background: 'var(--bg-surface)', border: '1px solid var(--accent)', borderRadius: 4, padding: '3px 6px', color: 'var(--text-primary)' }}
          />
          <button onClick={createFolder} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Create</button>
          <button onClick={() => { setAddingFolder(false); setNewFolderDraft('') }} style={{ fontSize: 10, padding: '3px 6px', borderRadius: 4, background: 'none', color: 'var(--text-muted)', border: '1px solid var(--border)', cursor: 'pointer' }}>✕</button>
        </div>
      )}

      {/* ── 100Lights built-in catalog ── */}
      <div style={{ borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        {/* Catalog folder header */}
        <button
          onClick={() => setCatalogCollapsed(v => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 5, width: '100%', padding: '5px 10px', background: 'rgba(139,92,246,0.06)', border: 'none', cursor: 'pointer', textAlign: 'left', borderBottom: catalogCollapsed ? 'none' : '1px solid rgba(139,92,246,0.15)' }}
        >
          {catalogCollapsed ? <ChevronRight size={10} style={{ color: 'rgba(167,139,250,0.7)', flexShrink: 0 }} /> : <ChevronDown size={10} style={{ color: 'rgba(167,139,250,0.7)', flexShrink: 0 }} />}
          <FolderOpen size={10} style={{ color: 'rgba(167,139,250,0.8)', flexShrink: 0 }} />
          <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(167,139,250,0.9)', letterSpacing: '0.03em', flex: 1 }}>100Lights</span>
          <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{SAMPLE_CATALOG.length} samples</span>
        </button>

        {!catalogCollapsed && (
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            {SAMPLE_CATALOG.map(sample => {
              const isDownloaded = downloadedCatalogIds.has(catalogEntryId(sample.id))
              const isPreviewing = catalogPreviewing === sample.id
              const isDownloading = downloading.has(sample.id)
              const entryId = catalogEntryId(sample.id)
              return (
                <div
                  key={sample.id}
                  draggable={isDownloaded}
                  onDragStart={isDownloaded ? e => {
                    e.dataTransfer.effectAllowed = 'copy'
                    e.dataTransfer.setData('application/x-library-entry-id', entryId)
                    e.dataTransfer.setData('text/plain', sample.name)
                    const ghost = document.createElement('div')
                    ghost.textContent = `♪ ${sample.name}`
                    ghost.style.cssText = `position:fixed;top:-999px;left:-999px;background:#1e1e2e;color:#a78bfa;border:1px solid #7c3aed;border-radius:6px;padding:4px 10px;font-size:11px;font-weight:600;pointer-events:none`
                    document.body.appendChild(ghost)
                    e.dataTransfer.setDragImage(ghost, 0, 0)
                    setTimeout(() => document.body.removeChild(ghost), 0)
                  } : undefined}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderBottom: '1px solid rgba(255,255,255,0.03)', cursor: isDownloaded ? 'grab' : 'default' }}
                >
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: CAT_COLORS[sample.category] ?? '#94a3b8', flexShrink: 0, display: 'inline-block' }} />
                  <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sample.name}</span>
                  <span style={{ fontSize: 9, color: 'var(--text-muted)', flexShrink: 0 }}>{sample.duration.toFixed(1)}s</span>
                  <button
                    onClick={() => previewCatalogSample(sample.id, sample.url)}
                    title={isPreviewing ? 'Stop preview' : 'Preview'}
                    style={{ background: isPreviewing ? 'rgba(139,92,246,0.2)' : 'none', border: `1px solid ${isPreviewing ? 'rgba(139,92,246,0.4)' : 'var(--border)'}`, cursor: 'pointer', color: isPreviewing ? 'rgba(167,139,250,1)' : 'var(--text-muted)', padding: '2px 6px', borderRadius: 4, fontSize: 9, flexShrink: 0 }}
                  >
                    {isPreviewing ? '■' : '▶'}
                  </button>
                  {isDownloaded ? (
                    <span title="Downloaded — drag to timeline" style={{ fontSize: 9, color: 'rgba(134,239,172,0.8)', flexShrink: 0 }}>✓</span>
                  ) : (
                    <button
                      onClick={() => downloadSample(sample.id, sample.url, sample.name, sample.category, sample.duration)}
                      disabled={isDownloading}
                      title="Download to your library so you can drag it to the timeline"
                      style={{ background: 'none', border: '1px solid rgba(139,92,246,0.3)', cursor: isDownloading ? 'default' : 'pointer', color: 'rgba(167,139,250,0.8)', padding: '2px 6px', borderRadius: 4, fontSize: 9, flexShrink: 0 }}
                    >
                      {isDownloading ? '…' : '↓'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Entry list */}
      <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
        {entries.length === 0 ? (
          <div style={{ padding: '20px 14px', textAlign: 'center' }}>
            <p style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.7 }}>
              No sounds yet.<br />Record or import a sample to build your library.
            </p>
          </div>
        ) : (
          <>
            {/* Folder sections */}
            {folders.map(folder => {
              const folderEntries = byFolder.get(folder) ?? []
              const collapsed = collapsedFolders.has(folder)
              return (
                <div key={folder}>
                  <FolderHeader
                    name={folder}
                    count={folderEntries.length}
                    collapsed={collapsed}
                    onToggle={() => toggleFolderCollapse(folder)}
                    onRename={newName => renameFolder(folder, newName)}
                    onDelete={() => deleteFolder(folder)}
                    isDragOver={dragOverFolder === folder}
                    onDragOver={e => onFolderDragOver(e, folder)}
                    onDragLeave={() => setDragOverFolder(null)}
                    onDrop={e => onFolderDrop(e, folder)}
                  />
                  {!collapsed && folderEntries.map(entryRow)}
                </div>
              )
            })}

            {/* Unfiled entries */}
            {unfiled.length > 0 && (
              <>
                {folders.length > 0 && (
                  <div style={{ padding: '4px 10px', fontSize: 9, color: 'var(--text-muted)', borderTop: '1px solid var(--border)', letterSpacing: '0.06em' }}>
                    UNFILED
                  </div>
                )}
                {unfiled.map(entryRow)}
              </>
            )}
          </>
        )}
      </div>

      {/* Drag hint */}
      <div style={{ padding: '4px 10px', fontSize: 8, color: 'var(--text-muted)', borderTop: '1px solid var(--border)', letterSpacing: '0.04em', flexShrink: 0 }}>
        Drag sounds to tracks · drag to folder header to move
      </div>

      {showAdd && <AddToLibraryModal onClose={() => setShowAdd(false)} onAdded={load} />}
    </>
  )

  if (embedded) return <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>{content}</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '8px 12px 6px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Sounds &amp; Samples</span>
      </div>
      {content}
    </div>
  )
}
