'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Mic, Upload, Play, Square, Trash2, Pencil, Check, X, RotateCcw } from 'lucide-react'
import {
  libraryGetAll, libraryAdd, libraryUpdate, libraryDelete,
  blobToUrl, getAudioDurationFromBlob,
  CATEGORY_LABELS, LIBRARY_CATEGORIES,
  type LibraryEntry, type LibraryCategory,
} from '@/lib/sound-library'
import { computeHitFeatures } from '@/lib/beat-features'
import { encodeWav, decodeAiff } from '@/lib/wav-codec'

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
  entry, onDelete, onRename, onCategoryChange,
}: {
  entry: LibraryEntry
  onDelete: (id: string) => void
  onRename: (id: string, name: string) => void
  onCategoryChange: (id: string, cat: LibraryCategory) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(entry.name)
  const [playing, setPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const urlRef   = useRef<string | null>(null)

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
      <button onClick={() => onDelete(entry.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, flexShrink: 0, opacity: 0.5 }}>
        <Trash2 size={10} />
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

    // Waveform bars
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

    // Dimmed overlay outside trim
    ctx.fillStyle = 'rgba(0,0,0,0.45)'
    ctx.fillRect(0, 0, trimStart * W, H)
    ctx.fillRect(trimEnd * W, 0, W - trimEnd * W, H)

    // Trim handle lines
    const drawHandle = (x: number) => {
      ctx.strokeStyle = '#f59e0b'
      ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke()
      // Triangle grip
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
    const distToStart = Math.abs(r - trimStart)
    const distToEnd   = Math.abs(r - trimEnd)
    draggingRef.current = distToStart < distToEnd ? 'start' : 'end'
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
    // Copy trimmed region
    for (let i = 0; i < len; i++) dst[i] = (src_[startSamp + i] ?? 0) * gain
    // Fade in
    const fi = Math.floor(fadeInFrac * len)
    for (let i = 0; i < fi; i++) dst[i] *= i / fi
    // Fade out
    const fo = Math.floor(fadeOutFrac * len)
    for (let i = 0; i < fo; i++) dst[len - 1 - i] *= i / fo
    // Reverse
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
  initialBuffer?: AudioBuffer   // pre-load with an existing clip
}) {
  type Mode = 'choose' | 'record' | 'edit'
  const [mode, setMode]       = useState<Mode>(initialBuffer ? 'edit' : 'choose')
  const [recording, setRec]   = useState(false)
  const [srcBuf, setSrcBuf]   = useState<AudioBuffer | null>(initialBuffer ?? null)
  const [name, setName]       = useState('')
  const [category, setCat]    = useState<LibraryCategory>('custom')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')

  // Editor state
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

  // Derive trimmed duration string for display
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
    // Chrome doesn't support AIFF via decodeAudioData — use the custom decoder
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
      // Encode to WAV
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

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Add to Library</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={15} /></button>
        </div>

        {/* ── Choose ── */}
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

        {/* ── Record ── */}
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

        {/* ── Sound editor ── */}
        {mode === 'edit' && srcBuf && (
          <>
            {/* Waveform trimmer */}
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

            {/* Controls */}
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

            {/* Metadata */}
            <input value={name} onChange={e => setName(e.target.value)}
              placeholder="Sound name (optional)"
              style={{ fontSize: 12, padding: '7px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)' }}
            />
            <select value={category} onChange={e => setCat(e.target.value as LibraryCategory)}
              style={{ fontSize: 12, padding: '7px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)' }}>
              {LIBRARY_CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
            </select>

            {/* Action row */}
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
      <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{entries.length} sound{entries.length !== 1 ? 's' : ''}</span>
        <button onClick={() => setShowAdd(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9, padding: '3px 8px', borderRadius: 4, background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
          + Add to Library
        </button>
      </div>

      <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
        {entries.length === 0 ? (
          <div style={{ padding: '20px 14px', textAlign: 'center' }}>
            <p style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.7 }}>
              No sounds yet.<br />Record or import a sample to build your library.
            </p>
          </div>
        ) : entries.map(entry => (
          <EntryRow key={entry.id} entry={entry} onDelete={handleDelete} onRename={handleRename} onCategoryChange={handleCategoryChange} />
        ))}
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
