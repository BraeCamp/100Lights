'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { X, Loader2, Play, Square } from 'lucide-react'
import type { AudioClip } from '@/lib/daw-types'
import { useDaw, extractPeaks } from '@/lib/daw-state'
import { SpectralSession, type SpectralInfo } from '@/lib/stft'
import { encodeWav } from '@/lib/wav-codec'

const MAX_SECONDS = 90

interface Sel { f0: number; f1: number; b0: number; b1: number }

export default function SpectralEditorModal({ clip, onClose }: { clip: AudioClip; onClose: () => void }) {
  const { engine, dispatch } = useDaw()
  const [phase, setPhase] = useState<'loading' | 'ready' | 'rendering' | 'error'>('loading')
  const [error, setError] = useState('')
  const [info, setInfo] = useState<SpectralInfo | null>(null)
  const [sel, setSel] = useState<Sel | null>(null)
  const [playing, setPlaying] = useState(false)
  const [edited, setEdited] = useState(false)

  const sessionRef = useRef<SpectralSession | null>(null)
  const maskRef = useRef<Float32Array | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ f: number; b: number } | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Analyze on open ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    const session = new SpectralSession()
    sessionRef.current = session
    ;(async () => {
      const buf = engine.bufferCache.get(clip.id) ?? await engine.loadClipBuffer(clip)
      if (!buf) throw new Error('Could not load clip audio')
      if (buf.duration > MAX_SECONDS) throw new Error(`Clip is ${Math.round(buf.duration)}s — spectral editing currently supports up to ${MAX_SECONDS}s`)
      const inf = await session.analyze(buf)
      if (cancelled) return
      maskRef.current = new Float32Array(inf.frames * inf.bins).fill(1)
      setInfo(inf)
      setPhase('ready')
    })().catch(err => {
      if (cancelled) return
      setError(err instanceof Error ? err.message : 'Analysis failed')
      setPhase('error')
    })
    return () => {
      cancelled = true
      sourceRef.current?.stop()
      session.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip.id])

  // Draw the full spectrogram once analyzed
  useEffect(() => {
    if (!info || !canvasRef.current) return
    const ctx = canvasRef.current.getContext('2d')
    if (ctx) ctx.putImageData(info.image, 0, 0)
  }, [info])

  // ── Selection ────────────────────────────────────────────────────────────────
  const toCell = useCallback((e: React.MouseEvent): { f: number; b: number } | null => {
    if (!info || !canvasRef.current) return null
    const r = canvasRef.current.getBoundingClientRect()
    const fx = (e.clientX - r.left) / r.width
    const fy = (e.clientY - r.top) / r.height
    const f = Math.min(info.frames - 1, Math.max(0, Math.floor(fx * info.frames)))
    const b = Math.min(info.bins - 1, Math.max(0, Math.floor((1 - fy) * info.bins)))
    return { f, b }
  }, [info])

  function onMouseDown(e: React.MouseEvent) {
    const c = toCell(e)
    if (!c) return
    dragRef.current = c
    setSel(null)
  }
  function onMouseMove(e: React.MouseEvent) {
    if (!dragRef.current) return
    const c = toCell(e)
    if (!c) return
    const a = dragRef.current
    setSel({ f0: Math.min(a.f, c.f), f1: Math.max(a.f, c.f), b0: Math.min(a.b, c.b), b1: Math.max(a.b, c.b) })
  }
  function onMouseUp() { dragRef.current = null }

  // ── Editing ──────────────────────────────────────────────────────────────────
  async function applyToSelection(mode: 'mult' | 'set', value: number) {
    const mask = maskRef.current
    const session = sessionRef.current
    if (!mask || !session || !info || !sel) return
    for (let f = sel.f0; f <= sel.f1; f++) {
      for (let b = sel.b0; b <= sel.b1; b++) {
        const i = f * info.bins + b
        mask[i] = mode === 'set' ? value : Math.min(8, mask[i] * value)
      }
    }
    setEdited(true)
    const img = await session.repaint(mask, sel.f0, sel.f1, sel.b0, sel.b1)
    const ctx = canvasRef.current?.getContext('2d')
    ctx?.putImageData(img, sel.f0, info.bins - 1 - sel.b1)
  }

  function buildAudioBuffer(channels: Float32Array[]): AudioBuffer {
    const buf = engine.ctx.createBuffer(channels.length, channels[0].length, info!.sampleRate)
    channels.forEach((ch, i) => buf.copyToChannel(ch as Float32Array<ArrayBuffer>, i))
    return buf
  }

  // ── Preview ──────────────────────────────────────────────────────────────────
  async function handlePreview() {
    if (playing) {
      sourceRef.current?.stop()
      setPlaying(false)
      return
    }
    const mask = maskRef.current
    const session = sessionRef.current
    if (!mask || !session || !info) return
    setPhase('rendering')
    try {
      const channels = await session.resynthesize(mask)
      if (engine.ctx.state === 'suspended') await engine.ctx.resume()
      const src = engine.ctx.createBufferSource()
      src.buffer = buildAudioBuffer(channels)
      src.connect(engine.ctx.destination)
      const startSec = sel ? Math.max(0, (sel.f0 * info.hop) / info.sampleRate - 0.5) : 0
      src.onended = () => setPlaying(false)
      src.start(0, startSec)
      sourceRef.current = src
      setPlaying(true)
    } finally {
      setPhase('ready')
    }
  }

  // ── Apply ────────────────────────────────────────────────────────────────────
  async function handleApply() {
    const mask = maskRef.current
    const session = sessionRef.current
    if (!mask || !session || !info) return
    sourceRef.current?.stop()
    setPhase('rendering')
    try {
      const channels = await session.resynthesize(mask)
      const buf = buildAudioBuffer(channels)
      const wav = encodeWav(channels, info.sampleRate)
      const audioUrl = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }))
      const peaks = extractPeaks(buf, 200)
      dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { audioUrl, waveformPeaks: peaks, bufferDuration: undefined } })
      engine.bufferCache.set(clip.id, buf)
      engine.clearBoomerangCache(clip.id)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Render failed')
      setPhase('error')
    }
  }

  const toolBtn: React.CSSProperties = {
    fontSize: 11, fontWeight: 600, padding: '5px 12px', borderRadius: 5, cursor: 'pointer',
    border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-secondary)',
    whiteSpace: 'nowrap',
  }
  const disabledTool: React.CSSProperties = { ...toolBtn, opacity: 0.4, cursor: 'not-allowed' }
  const hasSel = !!sel && phase === 'ready'
  const kHz = info ? info.sampleRate / 2000 : 24

  return createPortal(
    <div
      className="electron-nodrag"
      style={{ position: 'fixed', inset: 0, zIndex: 2100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.75)' }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        width: 'min(1100px, calc(100vw - 48px))', background: '#141418', borderRadius: 12,
        border: '1px solid #2a2a30', boxShadow: '0 20px 60px rgba(0,0,0,0.7)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid #232328', background: '#18181d' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Spectral Editor</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{clip.name}</span>
          <div style={{ flex: 1 }} />
          {edited && <span style={{ fontSize: 10, color: '#f59e0b' }}>edited</span>}
          <button onClick={onClose} title="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#777', display: 'flex', padding: 2 }}><X size={15} /></button>
        </div>

        {/* Canvas area */}
        <div ref={wrapRef} style={{ position: 'relative', background: '#08060f', minHeight: 300 }}>
          {phase === 'loading' && (
            <div style={{ height: 380, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 12 }}>
              <Loader2 size={14} className="animate-spin" /> Analyzing audio…
            </div>
          )}
          {phase === 'error' && (
            <div style={{ height: 380, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f87171', fontSize: 12, padding: '0 40px', textAlign: 'center' }}>
              {error}
            </div>
          )}
          {info && phase !== 'loading' && phase !== 'error' && (
            <>
              <canvas
                ref={canvasRef}
                width={info.frames}
                height={info.bins}
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                onMouseUp={onMouseUp}
                onMouseLeave={onMouseUp}
                style={{ display: 'block', width: '100%', height: 420, cursor: 'crosshair' }}
              />
              {/* Frequency axis labels */}
              {[0, 0.25, 0.5, 0.75, 1].map(t => (
                <span key={t} style={{
                  position: 'absolute', left: 6, top: `calc(${(1 - t) * 100}% - ${t === 1 ? 0 : t === 0 ? 14 : 7}px)`,
                  fontSize: 9, color: 'rgba(255,255,255,0.5)', pointerEvents: 'none', fontFamily: 'monospace',
                }}>{(kHz * t).toFixed(t === 0 ? 0 : 1)}k</span>
              ))}
              {/* Selection rectangle */}
              {sel && (
                <div style={{
                  position: 'absolute', pointerEvents: 'none',
                  left: `${(sel.f0 / info.frames) * 100}%`,
                  width: `${((sel.f1 - sel.f0 + 1) / info.frames) * 100}%`,
                  top: `${(1 - (sel.b1 + 1) / info.bins) * 100}%`,
                  height: `${((sel.b1 - sel.b0 + 1) / info.bins) * 100}%`,
                  border: '1px solid #fff', background: 'rgba(255,255,255,0.12)',
                  boxShadow: '0 0 0 1px rgba(0,0,0,0.6)',
                }} />
              )}
              {phase === 'rendering' && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: 'rgba(0,0,0,0.45)', color: '#fff', fontSize: 12 }}>
                  <Loader2 size={14} className="animate-spin" /> Rendering…
                </div>
              )}
            </>
          )}
        </div>

        {/* Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 14px', borderTop: '1px solid #232328', background: '#18181d', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', marginRight: 4 }}>
            {sel
              ? `${(((sel.f1 - sel.f0 + 1) * (info?.hop ?? 512)) / (info?.sampleRate ?? 48000)).toFixed(2)}s × ${Math.round((sel.b0 / (info?.bins ?? 1)) * kHz * 1000)}–${Math.round(((sel.b1 + 1) / (info?.bins ?? 1)) * kHz * 1000)} Hz`
              : 'Drag on the spectrogram to select a region'}
          </span>
          <div style={{ flex: 1 }} />
          <button style={hasSel ? toolBtn : disabledTool} disabled={!hasSel} onClick={() => void applyToSelection('mult', 0.501)}>−6 dB</button>
          <button style={hasSel ? toolBtn : disabledTool} disabled={!hasSel} onClick={() => void applyToSelection('mult', 0.251)}>−12 dB</button>
          <button style={hasSel ? toolBtn : disabledTool} disabled={!hasSel} onClick={() => void applyToSelection('mult', 1.995)}>+6 dB</button>
          <button style={hasSel ? { ...toolBtn, color: '#f87171', border: '1px solid rgba(239,68,68,0.5)' } : disabledTool} disabled={!hasSel} onClick={() => void applyToSelection('set', 0)}>Erase</button>
          <button style={hasSel ? toolBtn : disabledTool} disabled={!hasSel} onClick={() => void applyToSelection('set', 1)}>Restore</button>
          <div style={{ width: 1, height: 18, background: '#2a2a30', margin: '0 4px' }} />
          <button style={phase === 'ready' ? toolBtn : disabledTool} disabled={phase !== 'ready'} onClick={() => void handlePreview()}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              {playing ? <Square size={10} /> : <Play size={10} />}
              {playing ? 'Stop' : 'Preview'}
            </span>
          </button>
          <button
            style={edited && phase === 'ready'
              ? { ...toolBtn, border: '1px solid #3d8fef', background: 'rgba(61,143,239,0.18)', color: '#7ab5f7' }
              : disabledTool}
            disabled={!edited || phase !== 'ready'}
            onClick={() => void handleApply()}
          >Apply to Clip</button>
        </div>
      </div>
    </div>,
    document.body
  )
}
