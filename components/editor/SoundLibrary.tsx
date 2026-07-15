'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Library, Wand2, Mic, Upload, Play, Square, Trash2, Pencil, Check, X, RotateCcw, FolderPlus, ChevronRight, ChevronDown, Folder, FolderOpen, SlidersHorizontal, Globe2 } from 'lucide-react'
import {
  libraryGetAll, libraryAdd, libraryUpdate, libraryDelete,
  initLibrary,
  getAudioDurationFromBlob,
  CATEGORY_LABELS, LIBRARY_CATEGORIES, CATEGORY_GROUPS,
  TYPE_TAGS, CHARACTER_TAGS, CATEGORY_TO_TYPE_TAG, CATEGORY_CHAR_TAGS,
  type LibraryEntry, type LibraryCategory,
} from '@/lib/sound-library'
import { useUser } from '@clerk/nextjs'

let _recipeCtx: AudioContext | null = null
import { seedDefaultSamples } from '@/lib/default-samples'
import { getAllChordRecipes } from '@/lib/practice-recipes'
import { playMelodicNote } from '@/lib/instrument-synth'
import { libraryFulfill } from '@/lib/default-samples'
import { SynthDesigner, LibrarySourcePicker, requestCreateRecipe, RECIPES_CHANGED_EVENT } from './SoundCreate'
import { computeHitFeatures } from '@/lib/beat-features'
import { encodeWav, decodeAiff } from '@/lib/wav-codec'

// ── Category color map ────────────────────────────────────────────────────────
const CAT_COLORS: Record<string, string> = {
  // Drums
  kick: '#ef4444', snare: '#f97316', hihat: '#eab308', 'open-hihat': '#84cc16',
  clap: '#22c55e', tom: '#14b8a6', crash: '#06b6d4', rim: '#3b82f6',
  // Guitar / Piano
  'guitar-acoustic': '#8b5cf6', 'guitar-electric': '#a855f7', 'guitar-nylon': '#9333ea',
  'piano-grand': '#ec4899', 'piano-electric': '#db2777', 'piano-rhodes': '#be185d',
  // Synth
  'synth-lead': '#f43f5e', 'synth-pad': '#e879f9', 'synth-bass': '#6366f1',
  'synth-arp': '#38bdf8', 'synth-strings': '#a78bfa', 'synth-organ': '#fb923c', 'synth-choir': '#c084fc',
  // Darkwave
  'synth-dark': '#7c3aed', 'synth-drone': '#4c1d95', 'synth-pluck': '#5b21b6',
  // Strings
  violin: '#d97706', viola: '#b45309',
  // Other
  voice: '#0ea5e9', other: '#64748b', custom: '#94a3b8',
}
function colorFor(cat: string) { return CAT_COLORS[cat] ?? '#94a3b8' }

// ── Entry row ─────────────────────────────────────────────────────────────────
function EntryRow({
  entry, folders, onDelete, onRename, onCategoryChange, onFolderChange, onFulfilled, onPick,
}: {
  entry: LibraryEntry
  folders: string[]
  onDelete: (id: string) => void
  onRename: (id: string, name: string) => void
  onCategoryChange: (id: string, cat: LibraryCategory) => void
  onFolderChange: (id: string, folder: string | undefined) => void
  onFulfilled?: (e: LibraryEntry) => void
  onPick?: (e: LibraryEntry) => void
}) {
  const [editing, setEditing]         = useState(false)
  const [draft, setDraft]             = useState(entry.name)
  const [playing, setPlaying]         = useState(false)
  const [folderOpen, setFolderOpen]   = useState(false)
  const [fulfilling, setFulfilling]   = useState(false)
  const folderRef = useRef<HTMLDivElement>(null)

  // Waveform / scrub refs
  const waveRef      = useRef<HTMLCanvasElement | null>(null)
  const pcmRef       = useRef<Float32Array | null>(null)
  const ctxRef       = useRef<AudioContext | null>(null)
  const srcRef       = useRef<AudioBufferSourceNode | null>(null)
  const bufRef       = useRef<AudioBuffer | null>(null)
  const playheadRef  = useRef<number>(0)
  const rafRef       = useRef<number>(0)
  const startWhenRef = useRef<number>(0)
  const offsetRef    = useRef<number>(0)
  const draggingRef  = useRef<boolean>(false)

  async function ensurePcm() {
    if (pcmRef.current) return
    let blob = entry.audioBlob
    if (!blob) {
      if (!entry.renderSpec && !entry.communityRef) return
      setFulfilling(true)
      try {
        const fulfilled = await libraryFulfill(entry.id)
        if (!fulfilled?.audioBlob) return
        blob = fulfilled.audioBlob
        onFulfilled?.(fulfilled)
      } finally {
        setFulfilling(false)
      }
    }
    const ab  = await blob.arrayBuffer()
    const ctx = new AudioContext()
    const buf = await ctx.decodeAudioData(ab)
    bufRef.current = buf
    pcmRef.current = buf.getChannelData(0)
    ctxRef.current = ctx
    drawWave()
  }

  function drawWave(playFrac?: number) {
    const canvas = waveRef.current
    const pcm    = pcmRef.current
    if (!canvas || !pcm) return
    const ctx = canvas.getContext('2d')!
    const W = canvas.width, H = canvas.height
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = 'rgba(99,102,241,0.55)'
    const step = Math.max(1, Math.floor(pcm.length / W))
    for (let x = 0; x < W; x++) {
      let max = 0
      for (let i = 0; i < step; i++) { const v = Math.abs(pcm[x * step + i] ?? 0); if (v > max) max = v }
      const h = Math.max(1, Math.round(max * H * 0.9))
      ctx.fillRect(x, (H - h) / 2, 1, h)
    }
    if (playFrac != null && playFrac > 0) {
      ctx.fillStyle = 'rgba(250,204,21,0.9)'
      ctx.fillRect(Math.round(playFrac * W), 0, 1, H)
    }
  }

  function startPlayheadAnim() {
    cancelAnimationFrame(rafRef.current)
    function tick() {
      const ctx = ctxRef.current
      if (!ctx || !bufRef.current) return
      const elapsed = ctx.currentTime - startWhenRef.current
      const frac = Math.min(1, (offsetRef.current + elapsed) / bufRef.current.duration)
      playheadRef.current = frac
      drawWave(frac)
      if (frac < 1) rafRef.current = requestAnimationFrame(tick)
      else { drawWave(0); setPlaying(false) }
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  function playFrom(offsetSec: number) {
    const ctx = ctxRef.current
    const buf = bufRef.current
    if (!ctx || !buf) return
    try { srcRef.current?.stop() } catch { /* ok */ }
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(ctx.destination)
    src.onended = () => { setPlaying(false); cancelAnimationFrame(rafRef.current); drawWave(0) }
    const clampedOffset = Math.max(0, Math.min(buf.duration - 0.01, offsetSec))
    offsetRef.current    = clampedOffset
    startWhenRef.current = ctx.currentTime
    src.start(0, clampedOffset)
    srcRef.current = src
    setPlaying(true)
    startPlayheadAnim()
  }

  function togglePlay() {
    if (playing) {
      try { srcRef.current?.stop() } catch { /* ok */ }
      cancelAnimationFrame(rafRef.current)
      setPlaying(false)
      drawWave(0)
      return
    }
    ensurePcm().then(() => playFrom(0))
  }

  function onCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    ensurePcm().then(() => {
      const rect = e.currentTarget.getBoundingClientRect()
      const frac = (e.clientX - rect.left) / rect.width
      playFrom((bufRef.current?.duration ?? 0) * frac)
    })
  }

  function onCanvasMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    draggingRef.current = true
    const rect = e.currentTarget.getBoundingClientRect()
    const frac = (e.clientX - rect.left) / rect.width
    ensurePcm().then(() => drawWave(frac))
  }

  // Cleanup on unmount
  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current)
    try { srcRef.current?.stop() } catch { /* ok */ }
    ctxRef.current?.close().catch(() => {})
  }, [])

  // Decode and draw waveform once blob is available
  useEffect(() => {
    if (entry.audioBlob) void ensurePcm()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.audioBlob])

  // Drag scrubbing via window listeners
  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!draggingRef.current || !waveRef.current) return
      const rect = waveRef.current.getBoundingClientRect()
      const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      drawWave(frac)
    }
    function onUp(e: MouseEvent) {
      if (!draggingRef.current) return
      draggingRef.current = false
      if (!waveRef.current) return
      const rect = waveRef.current.getBoundingClientRect()
      const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      ensurePcm().then(() => playFrom((bufRef.current?.duration ?? 0) * frac))
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // entry.audioBlob is stable

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
      {/* Name */}
      <div style={{ minWidth: 0, maxWidth: 100, flexShrink: 0 }}>
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
            <span style={{ fontSize: 10, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={entry.authorName ? `Shared by ${entry.authorName}` : undefined}>
              {entry.name}
              {entry.authorName && <span style={{ color: '#34d399', fontSize: 8.5, marginLeft: 4 }}>by {entry.authorName.split(' ')[0]}</span>}
            </span>
            <button onClick={() => setEditing(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, flexShrink: 0, opacity: 0.6 }}><Pencil size={8} /></button>
          </div>
        )}
      </div>

      {/* Waveform canvas — fills remaining space, click to seek, drag to scrub */}
      {!entry.audioBlob ? (
        <div style={{ flex: 1, minWidth: 60, height: 28, borderRadius: 4, background: 'rgba(0,0,0,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 9, color: '#444' }}>{fulfilling ? 'Rendering…' : '↓ click ▶ to render'}</span>
        </div>
      ) : (
        <canvas
          ref={waveRef}
          width={280}
          height={56}
          style={{ flex: 1, minWidth: 60, height: 28, cursor: 'crosshair', borderRadius: 4, background: 'rgba(0,0,0,0.2)' }}
          onClick={onCanvasClick}
          onMouseDown={onCanvasMouseDown}
        />
      )}

      {/* Duration */}
      <span style={{ fontSize: 9, color: 'var(--text-muted)', flexShrink: 0 }}>
        {entry.duration.toFixed(1)}s
      </span>

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

      {/* Play / stop button */}
      <button onClick={togglePlay} style={{ width: 20, height: 20, borderRadius: '50%', background: playing ? '#dc2626' : 'var(--bg-card)', border: `1px solid ${color}`, color, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {playing ? <Square size={7} fill="currentColor" /> : <Play size={7} fill="currentColor" style={{ marginLeft: 1 }} />}
      </button>

      {onPick && (
        <button onClick={() => onPick(entry)}
          style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 3, border: '1px solid var(--accent)', background: 'rgba(61,143,239,0.12)', color: 'var(--accent)', cursor: 'pointer', flexShrink: 0 }}>
          Use
        </button>
      )}
      {!onPick && !entry.id.startsWith('seed:') && !entry.id.startsWith('community:') && (
        <button
          onClick={async e => {
            e.stopPropagation()
            const btn = e.currentTarget
            const desc = window.prompt(`Share "${entry.name}" to the Community?\n\nOptional description:`)
            if (desc === null) return
            btn.disabled = true
            try {
              const { shareSample } = await import('@/lib/community')
              await shareSample(entry, desc)
              window.alert('Shared! Find it at /community — every share gets a public link.')
            } catch (err) {
              window.alert(err instanceof Error ? err.message : 'Share failed')
            } finally { btn.disabled = false }
          }}
          title="Share to Community"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, flexShrink: 0, opacity: 0.5 }}
        >
          <Globe2 size={10} />
        </button>
      )}
      {!onPick && (
        <button onClick={() => onDelete(entry.id)} title="Delete" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, flexShrink: 0, opacity: 0.5 }}>
          <Trash2 size={10} />
        </button>
      )}
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
  onFolderDragStart, isDraggingThis, reorderIndicator,
}: {
  name: string; count: number; collapsed: boolean
  onToggle: () => void
  onRename: (newName: string) => void
  onDelete: () => void
  isDragOver: boolean
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent) => void
  onFolderDragStart: () => void
  isDraggingThis: boolean
  reorderIndicator: 'before' | 'after' | null
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(name)

  function commit() {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== name) onRename(trimmed)
    setEditing(false)
  }

  return (
    <div style={{ position: 'relative' }}>
      {/* Reorder drop indicator line */}
      {reorderIndicator === 'before' && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'var(--accent)', zIndex: 10, borderRadius: 1 }} />
      )}
      <div
        draggable
        onDragStart={e => {
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('application/x-library-folder-name', name)
          const ghost = document.createElement('div')
          ghost.textContent = `📁 ${name}`
          ghost.style.cssText = `position:fixed;top:-999px;left:-999px;background:#1e1e2e;color:#a78bfa;border:1px solid #7c3aed;border-radius:6px;padding:4px 10px;font-size:11px;font-weight:600;pointer-events:none`
          document.body.appendChild(ghost)
          e.dataTransfer.setDragImage(ghost, 0, 0)
          setTimeout(() => document.body.removeChild(ghost), 0)
          onFolderDragStart()
        }}
        onDragEnd={() => onFolderDragStart()}  // clears dragging state in parent via same callback (parent uses dragend listener)
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        style={{
          display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px',
          borderTop: '1px solid var(--border)', borderBottom: collapsed ? '1px solid var(--border)' : 'none',
          background: isDragOver ? 'rgba(139,92,246,0.1)' : 'var(--bg-surface)',
          transition: 'background 0.1s, opacity 0.1s', cursor: 'grab',
          borderLeft: `2px solid ${isDragOver ? '#7c3aed' : 'rgba(139,92,246,0.3)'}`,
          opacity: isDraggingThis ? 0.4 : 1,
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
      {reorderIndicator === 'after' && (
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, background: 'var(--accent)', zIndex: 10, borderRadius: 1 }} />
      )}
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
  speed = 1,
): AudioBuffer {
  const startSamp = Math.floor(trimStart * src.length)
  const endSamp   = Math.floor(trimEnd   * src.length)
  const len       = Math.max(1, endSamp - startSamp)
  // tape-style speed: resample by linear interpolation (pitch follows speed)
  const outLen    = Math.max(1, Math.round(len / speed))

  const out = new AudioBuffer({ numberOfChannels: src.numberOfChannels, length: outLen, sampleRate: src.sampleRate })

  for (let ch = 0; ch < src.numberOfChannels; ch++) {
    const src_ = src.getChannelData(ch)
    const dst  = out.getChannelData(ch)
    for (let i = 0; i < outLen; i++) {
      const pos = startSamp + i * speed
      const i0 = Math.floor(pos), frac = pos - i0
      const a = src_[i0] ?? 0, b = src_[i0 + 1] ?? a
      dst[i] = (a + (b - a) * frac) * gain
    }
    const fi = Math.floor(fadeInFrac * outLen)
    for (let i = 0; i < fi; i++) dst[i] *= i / fi
    const fo = Math.floor(fadeOutFrac * outLen)
    for (let i = 0; i < fo; i++) dst[outLen - 1 - i] *= i / fo
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
  type Mode = 'choose' | 'record' | 'edit' | 'synth' | 'library'
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
  const [speed,     setSpeed]     = useState(1)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef   = useRef<Blob[]>([])
  const previewRef  = useRef<{ src: AudioBufferSourceNode; ctx: AudioContext } | null>(null)
  const [previewing, setPreviewing] = useState(false)

  const trimmedDur = srcBuf ? ((trimEnd - trimStart) * srcBuf.duration / speed).toFixed(2) : '0.00'

  async function startRecord() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      chunksRef.current = []
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : ''
      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
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
        enterEdit(buf)
      } catch { setError('Could not decode AIFF file') }
      return
    }
    if (!file.type.startsWith('audio/') && ext !== 'wav' && ext !== 'mp3' && ext !== 'ogg' && ext !== 'flac' && ext !== 'm4a') {
      setError('Audio files only'); return
    }
    loadBlob(new Blob([await file.arrayBuffer()], { type: file.type || 'audio/mpeg' }))
  }

  function enterEdit(buf: AudioBuffer, suggestedName?: string) {
    setSrcBuf(buf)
    setTrimStart(0); setTrimEnd(1)
    setGain(1); setFadeIn(0); setFadeOut(0); setReversed(false); setSpeed(1)
    if (suggestedName) setName(suggestedName)
    setMode('edit')
  }

  async function loadBlob(blob: Blob) {
    try {
      const ctx = new AudioContext()
      const buf = await ctx.decodeAudioData(await blob.arrayBuffer())
      ctx.close()
      enterEdit(buf)
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
    const edited = applyEdits(srcBuf, trimStart, trimEnd, gain, fadeIn, fadeOut, reversed, speed)
    const ctx = new AudioContext()
    const src = ctx.createBufferSource()
    src.buffer = edited
    src.connect(ctx.destination)
    src.onended = () => { previewRef.current = null; setPreviewing(false) }
    src.start()
    previewRef.current = { src, ctx }
    setPreviewing(true)
  }

  useEffect(() => () => {
    stopPreview()
    const mr = recorderRef.current
    if (mr) { try { mr.stop(); mr.stream.getTracks().forEach(t => t.stop()) } catch { /* ok */ } }
  }, []) // eslint-disable-line

  async function save() {
    if (!srcBuf) return
    stopPreview()
    setSaving(true)
    try {
      const edited = applyEdits(srcBuf, trimStart, trimEnd, gain, fadeIn, fadeOut, reversed, speed)
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
    <div
className="electron-nodrag"
style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 22, width: 'min(480px,94vw)', display: 'flex', flexDirection: 'column', gap: 14, maxHeight: '90vh', overflowY: 'auto' }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Add to Library</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={15} /></button>
        </div>

        {mode === 'choose' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <button onClick={startRecord} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '16px 0', borderRadius: 10, background: 'rgba(220,38,38,0.12)', color: '#f87171', border: '1px solid rgba(220,38,38,0.3)', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                <Mic size={22} />
                Record
              </button>
              <button onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'audio/*'; inp.onchange = () => inp.files?.[0] && loadFile(inp.files[0]); inp.click() }}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '16px 0', borderRadius: 10, background: 'var(--bg-card)', color: 'var(--text-secondary)', border: '1px solid var(--border)', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                <Upload size={22} />
                Import
              </button>
              <button onClick={() => setMode('synth')} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '16px 0', borderRadius: 10, background: 'rgba(139,92,246,0.12)', color: 'var(--accent-light)', border: '1px solid rgba(139,92,246,0.3)', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                <Wand2 size={22} />
                Synthesize
              </button>
              <button onClick={() => setMode('library')} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '16px 0', borderRadius: 10, background: 'rgba(52,211,153,0.1)', color: '#34d399', border: '1px solid rgba(52,211,153,0.3)', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                <Library size={22} />
                From a sample
              </button>
            </div>
            <p style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center', margin: 0 }}>
              Synthesize builds a sound from scratch · From a sample starts with anything already in your library
            </p>
            {error && <p style={{ fontSize: 11, color: '#ef4444', textAlign: 'center' }}>{error}</p>}
          </>
        )}

        {mode === 'synth' && (
          <>
            <SynthDesigner onUse={(buf, suggested) => enterEdit(buf, suggested)} />
            <button onClick={() => setMode('choose')} style={{ alignSelf: 'flex-start', padding: '6px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11 }}>
              ← Back
            </button>
          </>
        )}

        {mode === 'library' && (
          <>
            <LibrarySourcePicker
              onPick={(buf, entry) => enterEdit(buf, `${entry.name} 2`)}
              onError={setError}
            />
            {error && <p style={{ fontSize: 11, color: '#ef4444', textAlign: 'center' }}>{error}</p>}
            <button onClick={() => { setError(''); setMode('choose') }} style={{ alignSelf: 'flex-start', padding: '6px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11 }}>
              ← Back
            </button>
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
              {row('Speed', (
                <div style={{ display: 'flex', flex: 1, alignItems: 'center', gap: 8 }}>
                  <input type="range" min={0.25} max={4} step={0.05} value={speed}
                    onChange={e => setSpeed(Number(e.target.value))}
                    style={{ flex: 1, accentColor: 'var(--accent)' }} />
                  <span style={{ fontSize: 10, color: 'var(--text-secondary)', minWidth: 36, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{speed.toFixed(2)}×</span>
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
              {CATEGORY_GROUPS.map(g => (
                <optgroup key={g.label} label={g.label}>
                  {g.categories.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
                </optgroup>
              ))}
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

// ── Tag helpers ───────────────────────────────────────────────────────────────

function getTypeTag(entry: LibraryEntry): string {
  // Explicit type tags in the tags array take priority over category inference
  const tagsSet = new Set(entry.tags ?? [])
  for (const t of TYPE_TAGS) {
    if (tagsSet.has(t)) return t
  }
  return CATEGORY_TO_TYPE_TAG[entry.category] ?? 'Other'
}

function getCharTags(entry: LibraryEntry): string[] {
  const catTags = CATEGORY_CHAR_TAGS[entry.category] ?? []
  const entryTags = (entry.tags ?? []).filter(t => CHARACTER_TAGS.includes(t as typeof CHARACTER_TAGS[number]))
  return [...new Set([...catTags, ...entryTags])]
}

// ── Main SoundLibrary panel ───────────────────────────────────────────────────
const FOLDERS_KEY = 'sound-library-folders'

export default function SoundLibrary({ embedded, onPick }: { embedded?: boolean; onPick?: (entry: LibraryEntry) => void }) {
  const { user, isLoaded } = useUser()

  useEffect(() => {
    // Seed only once identity is settled — seeding before Clerk resolves
    // raced the per-user db/guard namespace and duplicated the built-in
    // library on every page load.
    if (!isLoaded) return
    initLibrary(user?.id ?? null)
    seedDefaultSamples().catch(() => {})
  }, [isLoaded, user?.id])

  const [libTab,           setLibTab]           = useState<'samples' | 'recipes'>('samples')
  const [recipesVersion,   setRecipesVersion]   = useState(0)
  useEffect(() => {
    const bump = () => setRecipesVersion(v => v + 1)
    window.addEventListener(RECIPES_CHANGED_EVENT, bump)
    return () => window.removeEventListener(RECIPES_CHANGED_EVENT, bump)
  }, [])
  const [auditioningRecipe, setAuditioningRecipe] = useState<string | null>(null)
  const recipeStopRef = useRef<() => void>(() => {})
  useEffect(() => () => { recipeStopRef.current() }, [])

  function auditionRecipe(recipeId: string) {
    if (auditioningRecipe === recipeId) { recipeStopRef.current(); return }
    recipeStopRef.current()
    const recipe = getAllChordRecipes().find(r => r.id === recipeId)
    if (!recipe) return
    const spec = recipe.build()
    if (spec.isDrumClip) return
    _recipeCtx ??= new AudioContext()
    const ctx = _recipeCtx
    if (ctx.state === 'suspended') void ctx.resume()
    const g = ctx.createGain()
    g.gain.value = 0.7  // headroom — stacked chord voices can sum past full scale
    g.connect(ctx.destination)
    const spb = 60 / 100  // audition at 100 bpm, whatever the project tempo
    const t0 = ctx.currentTime + 0.05
    let end = 0
    for (const n of spec.notes) {
      playMelodicNote(ctx, 'piano-grand', n.pitch, t0 + n.startBeat * spb, (n.velocity ?? 100) / 127, g)
      end = Math.max(end, (n.startBeat + n.durationBeats) * spb)
    }
    const timer = window.setTimeout(() => recipeStopRef.current(), (end + 1.2) * 1000)
    recipeStopRef.current = () => {
      clearTimeout(timer)
      g.gain.setTargetAtTime(0, ctx.currentTime, 0.04)
      setTimeout(() => g.disconnect(), 300)
      setAuditioningRecipe(null)
      recipeStopRef.current = () => {}
    }
    setAuditioningRecipe(recipeId)
  }
  const [entries,          setEntries]          = useState<LibraryEntry[]>([])
  const [folders,          setFolders]          = useState<string[]>([])
  const [openFolders,      setOpenFolders]      = useState<Set<string>>(new Set())
  const [downloading,      setDownloading]      = useState<Set<string>>(new Set())
  const [dragOverFolder,   setDragOverFolder]   = useState<string | null>(null)
  const [draggingFolder,   setDraggingFolder]   = useState<string | null>(null)
  const [folderDropTarget, setFolderDropTarget] = useState<string | null>(null)
  const [dragOverUnfiled,  setDragOverUnfiled]  = useState(false)
  const [anyEntryDragging, setAnyEntryDragging] = useState(false)
  const [showAdd,          setShowAdd]          = useState(false)
  const [searchQuery,      setSearchQuery]      = useState('')
  const [activeTypeTag,    setActiveTypeTag]    = useState<string | null>(null)
  const [activeCharTags,   setActiveCharTags]   = useState<Set<string>>(new Set())
  const [showFilters,      setShowFilters]      = useState(false)
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

  useEffect(() => { load() }, [load, user?.id])

  // Track whether any library entry is currently being dragged (to show unfiled drop zone)
  useEffect(() => {
    function onStart(e: DragEvent) {
      if (e.dataTransfer?.types.includes('application/x-library-entry-id')) setAnyEntryDragging(true)
    }
    function onEnd() {
      setAnyEntryDragging(false)
      setDragOverUnfiled(false)
      setDraggingFolder(null)
      setFolderDropTarget(null)
      setDragOverFolder(null)
    }
    document.addEventListener('dragstart', onStart)
    document.addEventListener('dragend',   onEnd)
    return () => {
      document.removeEventListener('dragstart', onStart)
      document.removeEventListener('dragend',   onEnd)
    }
  }, [])

  // Focus new-folder input when it appears
  useEffect(() => {
    if (addingFolder) setTimeout(() => newFolderRef.current?.focus(), 30)
  }, [addingFolder])


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
    setOpenFolders(prev => { const s = new Set(prev); s.add(name); return s })
  }

  async function renameFolder(oldName: string, newName: string) {
    if (!newName || newName === oldName || folders.includes(newName)) return
    saveFolders(folders.map(f => f === oldName ? newName : f))
    await Promise.all(entries.filter(e => e.folder === oldName).map(e => handleFolderChange(e.id, newName)))
  }

  async function deleteFolder(name: string) {
    saveFolders(folders.filter(f => f !== name))
    await Promise.all(entries.filter(e => e.folder === name).map(e => handleFolderChange(e.id, undefined)))
  }

  function toggleFolderCollapse(name: string) {
    setOpenFolders(prev => {
      const s = new Set(prev)
      s.has(name) ? s.delete(name) : s.add(name)
      return s
    })
  }

  // ── Drag-and-drop: entries into folders, folders to reorder ─────────────────

  function onFolderDragOver(e: React.DragEvent, folderName: string) {
    const isEntry  = e.dataTransfer.types.includes('application/x-library-entry-id')
    const isFolder = e.dataTransfer.types.includes('application/x-library-folder-name')
    if (!isEntry && !isFolder) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (isEntry) {
      setDragOverFolder(folderName)
      setFolderDropTarget(null)
    } else {
      setFolderDropTarget(folderName)
      setDragOverFolder(null)
    }
  }

  function onFolderDrop(e: React.DragEvent, folderName: string) {
    const entryId      = e.dataTransfer.getData('application/x-library-entry-id')
    const draggedFolder = e.dataTransfer.getData('application/x-library-folder-name')
    setDragOverFolder(null)
    setFolderDropTarget(null)
    if (entryId) {
      e.preventDefault()
      handleFolderChange(entryId, folderName)
    } else if (draggedFolder && draggedFolder !== folderName) {
      e.preventDefault()
      // Reorder: move draggedFolder to the position before folderName
      const next = folders.filter(f => f !== draggedFolder)
      const idx  = next.indexOf(folderName)
      next.splice(idx, 0, draggedFolder)
      saveFolders(next)
      setDraggingFolder(null)
    }
  }

  // Unfiled drop zone — drops an entry out of any folder
  function onUnfiledDragOver(e: React.DragEvent) {
    if (!e.dataTransfer.types.includes('application/x-library-entry-id')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverUnfiled(true)
  }

  function onUnfiledDrop(e: React.DragEvent) {
    const id = e.dataTransfer.getData('application/x-library-entry-id')
    setDragOverUnfiled(false)
    if (!id) return
    e.preventDefault()
    handleFolderChange(id, undefined)
  }

  // Drop at the very end of the folder list (reorder folder to last position)
  function onFolderListEndDragOver(e: React.DragEvent) {
    if (!e.dataTransfer.types.includes('application/x-library-folder-name')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setFolderDropTarget('__end__')
  }

  function onFolderListEndDrop(e: React.DragEvent) {
    const draggedFolder = e.dataTransfer.getData('application/x-library-folder-name')
    setFolderDropTarget(null)
    if (!draggedFolder) return
    e.preventDefault()
    saveFolders([...folders.filter(f => f !== draggedFolder), draggedFolder])
    setDraggingFolder(null)
  }

  // ── Note-name sort helper (C2, C#2 … B5) ─────────────────────────────────────
  const NOTE_PC_MAP: Record<string, number> = { C:0,'C#':1,D:2,'D#':3,E:4,F:5,'F#':6,G:7,'G#':8,A:9,'A#':10,B:11 }
  function noteNameMidi(name: string): number | null {
    const m = name.match(/^([A-G]#?)(-?\d+)$/)
    if (!m) return null
    const pc = NOTE_PC_MAP[m[1]]
    return pc !== undefined ? (parseInt(m[2]) + 1) * 12 + pc : null
  }
  function sortByNoteName(arr: LibraryEntry[]): LibraryEntry[] {
    if (!arr.length) return arr
    const midis = arr.map(e => noteNameMidi(e.name))
    if (midis.some(m => m === null)) return arr
    return [...arr].sort((a, b) => (noteNameMidi(a.name) ?? 0) - (noteNameMidi(b.name) ?? 0))
  }

  // Derived: which type tags actually have entries
  const availableTypeTags = useMemo(() => {
    const present = new Set(entries.map(getTypeTag))
    return TYPE_TAGS.filter(t => present.has(t))
  }, [entries])

  // Derived: which character tags actually have entries
  const availableCharTags = useMemo(() => {
    const present = new Set(entries.flatMap(getCharTags))
    return CHARACTER_TAGS.filter(t => present.has(t))
  }, [entries])

  // Group entries (filtered by search query + tag filters)
  const { byFolder, unfiled, byParent } = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const filtered = entries.filter(en => {
      if (q && !en.name.toLowerCase().includes(q)) return false
      if (activeTypeTag && getTypeTag(en) !== activeTypeTag) return false
      if (activeCharTags.size > 0) {
        const eTags = getCharTags(en)
        if (!eTags.some(t => activeCharTags.has(t))) return false
      }
      return true
    })
    // byParent: parentFolder → (subFolder → entries[])
    const byParent = new Map<string, Map<string, LibraryEntry[]>>()
    const byFolder = new Map<string, LibraryEntry[]>()
    const unfiled: LibraryEntry[] = []
    for (const e of filtered) {
      if (e.parentFolder) {
        const subMap = byParent.get(e.parentFolder) ?? new Map<string, LibraryEntry[]>()
        const sub    = e.folder ?? ''
        subMap.set(sub, sortByNoteName([...(subMap.get(sub) ?? []), e]))
        byParent.set(e.parentFolder, subMap)
      } else if (e.folder && folders.includes(e.folder)) {
        byFolder.set(e.folder, [...(byFolder.get(e.folder) ?? []), e])
      } else {
        unfiled.push(e)
      }
    }
    return { byFolder, unfiled, byParent }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, folders, searchQuery, activeTypeTag, activeCharTags])

  // While a search or tag filter is active, collapsed folders would hide
  // every match — so filtering forces all groups open.
  const filtering = searchQuery.trim().length > 0 || activeTypeTag !== null || activeCharTags.size > 0

  const renderParentGroup = (parentName: string, subFolders: Map<string, LibraryEntry[]>) => {
    const parentKey = `parent:${parentName}`
    const parentCollapsed = !filtering && !openFolders.has(parentKey)
    const totalCount = [...subFolders.values()].reduce((n, arr) => n + arr.length, 0)
    return (
      <div key={parentName} style={{ borderBottom: '1px solid var(--border)' }}>
        {/* Parent header */}
        <div
          onClick={() => toggleFolderCollapse(parentKey)}
          style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px',
            background: 'rgba(61,143,239,0.06)', cursor: 'pointer',
            borderLeft: '2px solid rgba(61,143,239,0.5)',
          }}
        >
          {parentCollapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
          <FolderOpen size={10} style={{ color: 'rgba(61,143,239,0.7)', flexShrink: 0 }} />
          <span style={{ flex: 1, fontSize: 10, fontWeight: 700, color: 'rgba(61,143,239,0.9)', letterSpacing: '0.04em' }}>{parentName}</span>
          <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{totalCount}</span>
        </div>

        {/* Sub-folders */}
        {!parentCollapsed && [...subFolders.entries()].map(([subName, subEntries]) => {
          const subKey = `${parentKey}/${subName}`
          const subCollapsed = !filtering && !openFolders.has(subKey)
          return (
            <div key={subName} style={{ paddingLeft: 10 }}>
              <div
                onClick={() => toggleFolderCollapse(subKey)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px',
                  borderTop: '1px solid var(--border)', cursor: 'pointer',
                  background: 'var(--bg-surface)',
                  borderLeft: '2px solid rgba(139,92,246,0.3)',
                }}
              >
                {subCollapsed ? <ChevronRight size={9} /> : <ChevronDown size={9} />}
                <Folder size={9} style={{ color: 'rgba(167,139,250,0.6)', flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 9, fontWeight: 600, color: 'var(--text-secondary)', letterSpacing: '0.03em' }}>{subName}</span>
                <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{subEntries.length}</span>
              </div>
              {!subCollapsed && subEntries.map(entryRow)}
            </div>
          )
        })}
      </div>
    )
  }

  const entryRow = (entry: LibraryEntry) => (
    <EntryRow
      key={entry.id}
      entry={entry}
      folders={folders}
      onDelete={handleDelete}
      onRename={handleRename}
      onCategoryChange={handleCategoryChange}
      onFolderChange={handleFolderChange}
      onFulfilled={fulfilled => setEntries(prev => prev.map(e => e.id === fulfilled.id ? fulfilled : e))}
      onPick={onPick}
    />
  )

  const recipeCard = (r: ReturnType<typeof getAllChordRecipes>[number]) => (
        <div
          key={r.id}
          draggable
          onDragStart={e => {
            e.dataTransfer.setData('application/x-recipe-id', r.id)
            e.dataTransfer.effectAllowed = 'copy'
          }}
          title={r.tagline}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 10px', borderRadius: 7, cursor: 'grab',
            background: 'var(--bg-card)', border: '1px solid var(--border)',
          }}
        >
          <button
            onClick={e => { e.stopPropagation(); auditionRecipe(r.id) }}
            onMouseDown={e => e.stopPropagation()}
            draggable={false}
            title={auditioningRecipe === r.id ? 'Stop' : 'Listen (piano preview)'}
            aria-label={auditioningRecipe === r.id ? 'Stop recipe preview' : 'Play recipe preview'}
            style={{
              width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: 'none', cursor: 'pointer',
              background: auditioningRecipe === r.id ? 'var(--accent)' : 'rgba(167,139,250,0.16)',
              color: auditioningRecipe === r.id ? '#fff' : '#a78bfa',
            }}
          >
            {auditioningRecipe === r.id ? <Square size={9} fill="currentColor" /> : <Play size={10} style={{ marginLeft: 1 }} />}
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)' }}>♪ {r.title}</div>
            <div style={{ fontSize: 9.5, color: 'var(--text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.tagline}</div>
          </div>
        </div>
  )

  // Recipe ids encode their source: `user-` = written here in the piano roll,
  // `community-` = imported; everything else ships with the app. Shown as
  // separate sections so the source is always clear. recipesVersion re-reads
  // the list after a save-from-roll.
  void recipesVersion
  const allRecipes = getAllChordRecipes()
  const userRecipes = allRecipes.filter(r => r.id.startsWith('user-'))
  const builtinRecipes = allRecipes.filter(r => !r.id.startsWith('community-') && !r.id.startsWith('user-'))
  const communityRecipes = allRecipes.filter(r => r.id.startsWith('community-'))
  const recipeSectionHeader = (label: string, color: string) => (
    <div style={{ padding: '4px 2px 0', fontSize: 8.5, fontWeight: 800, letterSpacing: '0.1em', color, textTransform: 'uppercase' }}>
      {label}
    </div>
  )
  const recipesBody = (
    <div style={{ flex: 1, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '2px 2px 4px', lineHeight: 1.5 }}>
        Chord progressions — drag one onto a track. Notes and sound are editable in the piano roll; dragging the clip edge stretches the progression to fit.
      </p>
      <button
        onClick={requestCreateRecipe}
        title="Write your own recipe in the piano roll"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          padding: '8px 0', borderRadius: 7, cursor: 'pointer', fontSize: 11, fontWeight: 700,
          border: '1px dashed rgba(139,92,246,0.5)', background: 'rgba(139,92,246,0.08)', color: 'var(--accent-light)',
        }}
      >
        + Create a recipe
      </button>
      {userRecipes.length > 0 && (
        <>
          {recipeSectionHeader('Your Recipes', '#a78bfa')}
          {userRecipes.map(recipeCard)}
        </>
      )}
      {communityRecipes.length > 0 && (
        <>
          {recipeSectionHeader('From the Community', '#34d399')}
          {communityRecipes.map(recipeCard)}
        </>
      )}
      {(communityRecipes.length > 0 || userRecipes.length > 0) && recipeSectionHeader('100Lights Recipes', 'var(--text-muted)')}
      {builtinRecipes.map(recipeCard)}
    </div>
  )

  const content = (
    <>
      {/* Samples | Recipes tabs (hidden in pickers — onPick contexts expect audio samples) */}
      {!onPick && (
        <div style={{ display: 'flex', gap: 2, padding: '6px 10px 0', flexShrink: 0, borderBottom: '1px solid var(--border)' }}>
          {(['samples', 'recipes'] as const).map(t => (
            <button key={t} onClick={() => setLibTab(t)} style={{
              fontSize: 10, fontWeight: 600, padding: '4px 12px', borderRadius: '5px 5px 0 0', cursor: 'pointer',
              background: libTab === t ? 'var(--bg-card)' : 'transparent',
              borderTop: libTab === t ? '1px solid var(--border)' : '1px solid transparent',
              borderLeft: libTab === t ? '1px solid var(--border)' : '1px solid transparent',
              borderRight: libTab === t ? '1px solid var(--border)' : '1px solid transparent',
              borderBottom: 'none',
              color: libTab === t ? 'var(--text-primary)' : 'var(--text-muted)', textTransform: 'capitalize',
            }}>{t}</button>
          ))}
          <a
            href={libTab === 'recipes' ? '/community?kind=recipe' : '/community?kind=sample'}
            target="_blank" rel="noreferrer"
            title="Browse what other producers have shared"
            style={{ marginLeft: 'auto', alignSelf: 'center', fontSize: 9.5, fontWeight: 600, color: 'var(--text-muted)', textDecoration: 'none', padding: '4px 2px' }}
          >
            {libTab === 'recipes' ? 'Find recipes ↗' : 'Find sounds ↗'}
          </a>
        </div>
      )}
      {!onPick && libTab === 'recipes' ? recipesBody : (<>
      {/* Header toolbar */}
      <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <span style={{ fontSize: 9, color: 'var(--text-muted)', flex: 1 }}>{entries.length} item{entries.length !== 1 ? 's' : ''}</span>
        {onPick && (
          <a href="/community?kind=sample" target="_blank" rel="noreferrer" title="Browse what other producers have shared"
            style={{ fontSize: 9.5, fontWeight: 600, color: 'var(--text-muted)', textDecoration: 'none' }}>
            Find sounds ↗
          </a>
        )}
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

      {/* Search + filter toggle */}
      {(() => {
        const filtersActive = activeTypeTag !== null || activeCharTags.size > 0
        return (
          <div style={{ padding: '4px 8px', borderBottom: `1px solid var(--border)`, flexShrink: 0, display: 'flex', gap: 5, alignItems: 'center' }}>
            <input
              type="search"
              placeholder="Search library…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{ flex: 1, fontSize: 10, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, padding: '3px 7px', color: 'var(--text-primary)', outline: 'none', minWidth: 0 }}
            />
            <button
              onClick={() => setShowFilters(v => !v)}
              title="Filters"
              style={{
                flexShrink: 0, display: 'flex', alignItems: 'center', gap: 3,
                fontSize: 9, padding: '3px 7px', borderRadius: 4, cursor: 'pointer',
                border: `1px solid ${showFilters || filtersActive ? 'var(--accent)' : 'var(--border)'}`,
                background: showFilters ? `var(--accent)` : filtersActive ? 'rgba(99,102,241,0.15)' : 'var(--bg-card)',
                color: showFilters ? '#fff' : filtersActive ? 'var(--accent)' : 'var(--text-muted)',
                position: 'relative',
              }}
            >
              <SlidersHorizontal size={10} />
              {filtersActive && !showFilters && (
                <span style={{ position: 'absolute', top: 2, right: 2, width: 4, height: 4, borderRadius: '50%', background: 'var(--accent)' }} />
              )}
            </button>
          </div>
        )
      })()}

      {/* ── Filter chips (collapsed until toggled) ─────────────────────────── */}
      {showFilters && availableTypeTags.length > 0 && (
        <div style={{ padding: '5px 8px 4px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          {/* Type row */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 4 }}>
            {availableTypeTags.map(tag => {
              const active = activeTypeTag === tag
              return (
                <button
                  key={tag}
                  onClick={() => setActiveTypeTag(active ? null : tag)}
                  style={{
                    fontSize: 9, padding: '2px 7px', borderRadius: 10,
                    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                    background: active ? 'var(--accent)' : 'var(--bg-card)',
                    color: active ? '#fff' : 'var(--text-muted)',
                    cursor: 'pointer', fontWeight: active ? 700 : 400,
                    transition: 'all 0.1s',
                  }}
                >{tag}</button>
              )
            })}
          </div>
          {/* Character row */}
          {availableCharTags.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, paddingBottom: 2 }}>
              {availableCharTags.map(tag => {
                const active = activeCharTags.has(tag)
                return (
                  <button
                    key={tag}
                    onClick={() => setActiveCharTags(prev => {
                      const next = new Set(prev)
                      active ? next.delete(tag) : next.add(tag)
                      return next
                    })}
                    style={{
                      fontSize: 9, padding: '2px 7px', borderRadius: 10,
                      border: `1px solid ${active ? 'rgba(167,139,250,0.7)' : 'var(--border)'}`,
                      background: active ? 'rgba(139,92,246,0.2)' : 'var(--bg-card)',
                      color: active ? '#a78bfa' : 'var(--text-muted)',
                      cursor: 'pointer', fontWeight: active ? 700 : 400,
                      transition: 'all 0.1s',
                    }}
                  >{tag}</button>
                )
              })}
            </div>
          )}
        </div>
      )}

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


      {/* Entry list */}
      <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
        {entries.length === 0 ? (
          <div style={{ padding: '20px 14px', textAlign: 'center' }}>
            <p style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.7 }}>
              No items yet.<br />Record or import a sample to build your library,<br />
              or <a href="/community?kind=sample" target="_blank" rel="noreferrer" style={{ color: 'var(--accent-light, #a78bfa)' }}>browse Community sounds ↗</a>
            </p>
          </div>
        ) : (
          <>
            {/* Sections: community links first, then the built-in 100Lights
                catalog, then the user's own folders — so it's always clear
                what came from where. */}
            {byParent.has('Community') && (
              <div style={{ padding: '7px 10px 3px', fontSize: 8.5, fontWeight: 800, letterSpacing: '0.1em', color: '#34d399', textTransform: 'uppercase' }}>
                From the Community
              </div>
            )}
            {[...byParent.entries()].filter(([n]) => n === 'Community').map(([parentName, subFolders]) => renderParentGroup(parentName, subFolders))}
            {[...byParent.keys()].some(n => n !== 'Community') && (
              <div style={{ padding: '7px 10px 3px', fontSize: 8.5, fontWeight: 800, letterSpacing: '0.1em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                100Lights Sounds
              </div>
            )}
            {[...byParent.entries()].filter(([n]) => n !== 'Community').map(([parentName, subFolders]) => renderParentGroup(parentName, subFolders))}
            {(byFolder.size > 0 || unfiled.length > 0) && (
              <div style={{ padding: '7px 10px 3px', fontSize: 8.5, fontWeight: 800, letterSpacing: '0.1em', color: '#a78bfa', textTransform: 'uppercase' }}>
                Your Sounds
              </div>
            )}
            {/* User folder sections */}
            {folders.map((folder, idx) => {
              const folderEntries = byFolder.get(folder) ?? []
              const collapsed     = !filtering && !openFolders.has(folder)
              const reorderBefore = folderDropTarget === folder && draggingFolder !== folder
              // show 'after' indicator on the last folder when drop target is '__end__'
              const reorderAfter  = folderDropTarget === '__end__' && idx === folders.length - 1
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
                    onDragLeave={() => { setDragOverFolder(null); setFolderDropTarget(null) }}
                    onDrop={e => onFolderDrop(e, folder)}
                    onFolderDragStart={() => setDraggingFolder(folder)}
                    isDraggingThis={draggingFolder === folder}
                    reorderIndicator={reorderBefore ? 'before' : reorderAfter ? 'after' : null}
                  />
                  {!collapsed && folderEntries.map(entryRow)}
                </div>
              )
            })}

            {/* End-of-list folder drop zone (drag folder to last position) */}
            {folders.length > 0 && (
              <div
                onDragOver={onFolderListEndDragOver}
                onDragLeave={() => setFolderDropTarget(null)}
                onDrop={onFolderListEndDrop}
                style={{ height: 8, borderTop: folderDropTarget === '__end__' ? '2px solid var(--accent)' : '1px solid transparent', transition: 'border-color 0.1s' }}
              />
            )}

            {/* Unfiled entries — always a drop zone when any entry is dragging */}
            {(unfiled.length > 0 || (anyEntryDragging && (folders.length > 0 || byParent.size > 0))) && (
              <>
                {(folders.length > 0 || byParent.size > 0) && (
                  <div
                    onDragOver={onUnfiledDragOver}
                    onDragLeave={() => setDragOverUnfiled(false)}
                    onDrop={onUnfiledDrop}
                    style={{
                      padding: '5px 10px', fontSize: 9, letterSpacing: '0.06em',
                      borderTop: '1px solid var(--border)',
                      borderLeft: `2px solid ${dragOverUnfiled ? 'rgba(139,92,246,0.7)' : 'transparent'}`,
                      background: dragOverUnfiled ? 'rgba(139,92,246,0.08)' : 'transparent',
                      color: dragOverUnfiled ? '#a78bfa' : 'var(--text-muted)',
                      transition: 'all 0.1s',
                    }}
                  >
                    UNFILED{dragOverUnfiled ? ' — drop here to remove from folder' : ''}
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
        Drag sounds → folder to move · drag to UNFILED to remove · drag folder header to reorder
      </div>

      {showAdd && <AddToLibraryModal onClose={() => setShowAdd(false)} onAdded={load} />}
      </>)}
    </>
  )

  if (embedded) return <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>{content}</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '8px 12px 6px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Library</span>
      </div>
      {content}
    </div>
  )
}
