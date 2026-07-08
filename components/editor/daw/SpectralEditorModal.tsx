'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { X, Loader2, Play, Square, Undo2, Redo2, ZoomIn, ZoomOut } from 'lucide-react'
import type { AudioClip } from '@/lib/daw-types'
import { useDaw, extractPeaks } from '@/lib/daw-state'
import { SpectralSession, type SpectralInfo, type SpectralLayer } from '@/lib/stft'
import { encodeWav } from '@/lib/wav-codec'

const MAX_SECONDS = 90
const DISPLAY_H = 512   // internal rows of the display canvas
const FMIN = 20         // bottom of the log-frequency axis
const WAND_TOL_DB = 6

function mapYToBin(info: SpectralInfo, log: boolean, y: number): number {
  const frac = 1 - y / DISPLAY_H
  if (!log) return Math.min(info.bins - 1, Math.max(0, Math.floor(frac * info.bins)))
  const fmax = info.sampleRate / 2
  const freq = FMIN * Math.pow(fmax / FMIN, frac)
  const binHz = fmax / (info.bins - 1)
  return Math.min(info.bins - 1, Math.max(0, Math.round(freq / binHz)))
}

function mapBinToY(info: SpectralInfo, log: boolean, b: number): number {
  if (!log) return (1 - b / info.bins) * DISPLAY_H
  const fmax = info.sampleRate / 2
  const binHz = fmax / (info.bins - 1)
  const freq = Math.max(FMIN, b * binHz)
  const frac = Math.log(freq / FMIN) / Math.log(fmax / FMIN)
  return (1 - frac) * DISPLAY_H
}

type Tool = 'select' | 'wand' | 'brush'
type Phase = 'loading' | 'separating' | 'ready' | 'rendering' | 'error'
interface Rect { f0: number; f1: number; b0: number; b1: number }
interface Selection { rect: Rect; selMask: Uint8Array | null; count?: number }

export default function SpectralEditorModal({ clip, onClose }: { clip: AudioClip; onClose: () => void }) {
  const { engine, dispatch } = useDaw()
  const [phase, setPhase] = useState<Phase>('loading')
  const [error, setError] = useState('')
  const [info, setInfo] = useState<SpectralInfo | null>(null)
  const [sel, setSel] = useState<Selection | null>(null)
  const [dragRect, setDragRect] = useState<Rect | null>(null)
  const [playing, setPlaying] = useState(false)
  const [edited, setEdited] = useState(false)
  const [tool, setTool] = useState<Tool>('select')
  const [layer, setLayer] = useState<SpectralLayer>('all')
  const [logScale, setLogScale] = useState(true)
  const [zoom, setZoom] = useState(1)
  const [brushSize, setBrushSize] = useState(8)
  const [brushGain, setBrushGain] = useState(0)        // 0 = erase, 0.251 = -12dB, 0.501 = -6dB
  const [denoiseAmount, setDenoiseAmount] = useState(0.8)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  const sessionRef = useRef<SpectralSession | null>(null)
  const maskRef = useRef<Float32Array | null>(null)
  const undoRef = useRef<Float32Array[]>([])
  const redoRef = useRef<Float32Array[]>([])
  const layersReadyRef = useRef(false)

  const linearRef = useRef<HTMLCanvasElement | null>(null)      // truth: frames × bins
  const selLinearRef = useRef<HTMLCanvasElement | null>(null)   // selection alpha, frames × bins
  const displayRef = useRef<HTMLCanvasElement>(null)
  const selDisplayRef = useRef<HTMLCanvasElement>(null)

  const dragStartRef = useRef<{ f: number; b: number } | null>(null)
  const strokeAppliedRef = useRef<Float32Array | null>(null)
  const strokeActiveRef = useRef(false)
  const dirtyRef = useRef<Rect | null>(null)
  const repaintTimerRef = useRef<number | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const layerRef = useRef(layer)
  const logRef = useRef(logScale)
  const infoRef = useRef(info)
  useEffect(() => { layerRef.current = layer }, [layer])
  useEffect(() => { logRef.current = logScale }, [logScale])
  useEffect(() => { infoRef.current = info }, [info])

  // ── Display redraw (linear canvases → display canvases with axis mapping) ────
  const redrawDisplay = useCallback(() => {
    const inf = infoRef.current
    const lin = linearRef.current, selLin = selLinearRef.current
    const disp = displayRef.current, selDisp = selDisplayRef.current
    if (!inf || !lin || !disp || !selLin || !selDisp) return
    for (const [src, dst] of [[lin, disp], [selLin, selDisp]] as const) {
      const ctx = dst.getContext('2d')!
      ctx.clearRect(0, 0, inf.frames, DISPLAY_H)
      ctx.imageSmoothingEnabled = true
      for (let y = 0; y < DISPLAY_H; y++) {
        const bHi = mapYToBin(inf, logRef.current, y)
        const bLo = mapYToBin(inf, logRef.current, y + 1)
        const srcY = inf.bins - 1 - bHi
        const srcH = Math.max(1, bHi - bLo + 1)
        ctx.drawImage(src, 0, srcY, inf.frames, srcH, 0, y, inf.frames, 1)
      }
    }
  }, [])

  const putPatch = useCallback((img: ImageData, f0: number, b1: number) => {
    const inf = infoRef.current
    const lin = linearRef.current
    if (!inf || !lin) return
    lin.getContext('2d')!.putImageData(img, f0, inf.bins - 1 - b1)
    redrawDisplay()
  }, [redrawDisplay])

  const drawSelectionOverlay = useCallback((s: Selection | null) => {
    const inf = infoRef.current
    const selLin = selLinearRef.current
    if (!inf || !selLin) return
    const ctx = selLin.getContext('2d')!
    ctx.clearRect(0, 0, inf.frames, inf.bins)
    if (s) {
      const { f0, f1, b0, b1 } = s.rect
      if (s.selMask) {
        const w = f1 - f0 + 1, h = b1 - b0 + 1
        const img = ctx.createImageData(w, h)
        for (let f = f0; f <= f1; f++) {
          for (let b = b0; b <= b1; b++) {
            if (!s.selMask[f * inf.bins + b]) continue
            const o = (((b1 - b) * w) + (f - f0)) * 4
            img.data[o] = 255; img.data[o + 1] = 255; img.data[o + 2] = 255; img.data[o + 3] = 78
          }
        }
        ctx.putImageData(img, f0, inf.bins - 1 - b1)
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.3)'
        ctx.fillRect(f0, inf.bins - 1 - b1, f1 - f0 + 1, b1 - b0 + 1)
      }
    }
    redrawDisplay()
  }, [redrawDisplay])


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
      // hidden linear canvases
      const lin = document.createElement('canvas')
      lin.width = inf.frames; lin.height = inf.bins
      lin.getContext('2d')!.putImageData(inf.image, 0, 0)
      linearRef.current = lin
      const selLin = document.createElement('canvas')
      selLin.width = inf.frames; selLin.height = inf.bins
      selLinearRef.current = selLin
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

  useEffect(() => { if (info) redrawDisplay() }, [info, redrawDisplay])
  useEffect(() => { if (info) { redrawDisplay() } }, [logScale]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Undo / redo (mask snapshots; depth scales with clip size) ────────────────
  function maxUndoDepth(): number {
    const bytes = maskRef.current?.byteLength ?? 1
    return Math.min(30, Math.max(4, Math.floor(64_000_000 / bytes)))
  }
  function pushUndo() {
    if (!maskRef.current) return
    undoRef.current.push(maskRef.current.slice())
    if (undoRef.current.length > maxUndoDepth()) undoRef.current.shift()
    redoRef.current = []
    setCanUndo(true); setCanRedo(false)
  }
  const fullRepaint = useCallback(async (layerOverride?: SpectralLayer) => {
    const inf = infoRef.current, session = sessionRef.current, mask = maskRef.current
    if (!inf || !session || !mask) return
    const img = await session.repaint(mask, 0, inf.frames - 1, 0, inf.bins - 1, layerOverride ?? layerRef.current)
    putPatch(img, 0, inf.bins - 1)
  }, [putPatch])
  const undo = useCallback(async () => {
    const prev = undoRef.current.pop()
    if (!prev || !maskRef.current) return
    redoRef.current.push(maskRef.current)
    maskRef.current = prev
    setCanUndo(undoRef.current.length > 0); setCanRedo(true); setEdited(true)
    await fullRepaint()
  }, [fullRepaint])
  const redo = useCallback(async () => {
    const next = redoRef.current.pop()
    if (!next || !maskRef.current) return
    undoRef.current.push(maskRef.current)
    maskRef.current = next
    setCanRedo(redoRef.current.length > 0); setCanUndo(true); setEdited(true)
    await fullRepaint()
  }, [fullRepaint])

  // ── Escape / undo keys (capture: don't let the editor's global undo fire) ────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return }
      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyZ') {
        e.preventDefault(); e.stopPropagation()
        if (e.shiftKey) void redo(); else void undo()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undo, redo])

  // ── Mouse → cell ─────────────────────────────────────────────────────────────
  const toCell = useCallback((e: React.MouseEvent): { f: number; b: number } | null => {
    const inf = infoRef.current
    const cv = displayRef.current
    if (!inf || !cv) return null
    const r = cv.getBoundingClientRect()
    const fx = (e.clientX - r.left) / r.width
    const fy = (e.clientY - r.top) / r.height
    const f = Math.min(inf.frames - 1, Math.max(0, Math.floor(fx * inf.frames)))
    const b = mapYToBin(inf, logRef.current, fy * DISPLAY_H)
    return { f, b }
  }, [])

  // ── Brush ────────────────────────────────────────────────────────────────────
  function stampBrush(cf: number, cb: number) {
    const inf = infoRef.current, mask = maskRef.current, applied = strokeAppliedRef.current
    if (!inf || !mask || !applied) return
    const rF = Math.max(1, brushSize)
    const rB = Math.max(2, Math.round(brushSize * inf.bins / 128))
    const f0 = Math.max(0, cf - rF), f1 = Math.min(inf.frames - 1, cf + rF)
    const b0 = Math.max(0, cb - rB), b1 = Math.min(inf.bins - 1, cb + rB)
    for (let f = f0; f <= f1; f++) {
      for (let b = b0; b <= b1; b++) {
        const df = (f - cf) / rF, db = (b - cb) / rB
        const d2 = df * df + db * db
        if (d2 > 1) continue
        const feather = 1 - d2
        const target = 1 - (1 - brushGain) * feather
        const i = f * inf.bins + b
        if (target < applied[i]) {
          mask[i] *= applied[i] > 1e-6 ? target / applied[i] : 0
          applied[i] = target
        }
      }
    }
    const d = dirtyRef.current
    dirtyRef.current = d
      ? { f0: Math.min(d.f0, f0), f1: Math.max(d.f1, f1), b0: Math.min(d.b0, b0), b1: Math.max(d.b1, b1) }
      : { f0, f1, b0, b1 }
    scheduleBrushRepaint()
  }
  function scheduleBrushRepaint() {
    if (repaintTimerRef.current !== null) return
    repaintTimerRef.current = window.setTimeout(() => { void flushBrushRepaint() }, 90)
  }
  async function flushBrushRepaint() {
    repaintTimerRef.current = null
    const rect = dirtyRef.current
    const session = sessionRef.current, mask = maskRef.current
    if (!rect || !session || !mask) return
    dirtyRef.current = null
    const img = await session.repaint(mask, rect.f0, rect.f1, rect.b0, rect.b1, layerRef.current)
    putPatch(img, rect.f0, rect.b1)
  }

  // ── Mouse handlers ───────────────────────────────────────────────────────────
  function onMouseDown(e: React.MouseEvent) {
    if (phase !== 'ready') return
    const c = toCell(e)
    if (!c) return
    if (tool === 'brush') {
      const inf = infoRef.current!
      pushUndo()
      if (!strokeAppliedRef.current || strokeAppliedRef.current.length !== inf.frames * inf.bins) {
        strokeAppliedRef.current = new Float32Array(inf.frames * inf.bins)
      }
      strokeAppliedRef.current.fill(1)
      strokeActiveRef.current = true
      setEdited(true)
      stampBrush(c.f, c.b)
      return
    }
    if (tool === 'wand') {
      void (async () => {
        const session = sessionRef.current
        const inf = infoRef.current
        if (!session || !inf) return
        if (layer !== 'all') await ensureLayers()
        const res = await session.wand(c.f, c.b, WAND_TOL_DB, layer)
        const s: Selection = { rect: { f0: res.f0, f1: res.f1, b0: res.b0, b1: res.b1 }, selMask: res.selMask, count: res.count }
        setSel(s)
        drawSelectionOverlay(s)
      })()
      return
    }
    // rect select
    dragStartRef.current = c
    setSel(null)
    drawSelectionOverlay(null)
    setDragRect(null)
  }
  function onMouseMove(e: React.MouseEvent) {
    if (tool === 'brush') {
      if (!strokeActiveRef.current) return
      const c = toCell(e)
      if (c) stampBrush(c.f, c.b)
      return
    }
    if (!dragStartRef.current) return
    const c = toCell(e)
    if (!c) return
    const a = dragStartRef.current
    setDragRect({ f0: Math.min(a.f, c.f), f1: Math.max(a.f, c.f), b0: Math.min(a.b, c.b), b1: Math.max(a.b, c.b) })
  }
  function onMouseUp() {
    if (tool === 'brush') {
      strokeActiveRef.current = false
      void flushBrushRepaint()
      return
    }
    if (dragStartRef.current && dragRect) {
      const s: Selection = { rect: dragRect, selMask: null }
      setSel(s)
      drawSelectionOverlay(s)
    }
    dragStartRef.current = null
    setDragRect(null)
  }

  // ── Layers ───────────────────────────────────────────────────────────────────
  async function ensureLayers() {
    if (layersReadyRef.current) return
    setPhase('separating')
    await sessionRef.current!.computeLayers()
    layersReadyRef.current = true
    setPhase('ready')
  }
  async function switchLayer(next: SpectralLayer) {
    if (next === layer) return
    if (next !== 'all') await ensureLayers()
    setLayer(next)  // layerRef syncs via effect; repaint with the explicit value
    await fullRepaint(next)
  }

  // ── Edits ────────────────────────────────────────────────────────────────────
  async function applyToSelection(mode: 'mult' | 'set', value: number) {
    const mask = maskRef.current, session = sessionRef.current
    if (!mask || !session || !sel) return
    if (layer !== 'all') await ensureLayers()
    pushUndo()
    setEdited(true)
    const res = await session.applyEdit(mask, sel.rect, sel.selMask, mode, value, layer, layer)
    maskRef.current = res.mask
    putPatch(res.image, res.f0, res.b1)
  }

  async function handleDenoise() {
    const mask = maskRef.current, session = sessionRef.current, inf = infoRef.current
    if (!mask || !session || !inf || !sel) return
    if (layer !== 'all') await ensureLayers()
    setPhase('rendering')
    try {
      pushUndo()
      setEdited(true)
      // rect selections become a filled cell mask for the profile
      let selMask = sel.selMask
      if (!selMask) {
        selMask = new Uint8Array(inf.frames * inf.bins)
        for (let f = sel.rect.f0; f <= sel.rect.f1; f++)
          for (let b = sel.rect.b0; b <= sel.rect.b1; b++) selMask[f * inf.bins + b] = 1
      }
      const res = await session.denoise(mask, selMask, denoiseAmount, layer, layer)
      maskRef.current = res.mask
      putPatch(res.image, 0, inf.bins - 1)
    } finally {
      setPhase('ready')
    }
  }

  function buildAudioBuffer(channels: Float32Array[]): AudioBuffer {
    const buf = engine.ctx.createBuffer(channels.length, channels[0].length, infoRef.current!.sampleRate)
    channels.forEach((ch, i) => buf.copyToChannel(ch as Float32Array<ArrayBuffer>, i))
    return buf
  }

  async function handlePreview() {
    if (playing) {
      sourceRef.current?.stop()
      setPlaying(false)
      return
    }
    const mask = maskRef.current, session = sessionRef.current, inf = infoRef.current
    if (!mask || !session || !inf) return
    setPhase('rendering')
    try {
      const channels = await session.resynthesize(mask)
      if (engine.ctx.state === 'suspended') await engine.ctx.resume()
      const src = engine.ctx.createBufferSource()
      src.buffer = buildAudioBuffer(channels)
      src.connect(engine.ctx.destination)
      const startSec = sel ? Math.max(0, (sel.rect.f0 * inf.hop) / inf.sampleRate - 0.5) : 0
      src.onended = () => setPlaying(false)
      src.start(0, startSec)
      sourceRef.current = src
      setPlaying(true)
    } finally {
      setPhase('ready')
    }
  }

  async function handleApply() {
    const mask = maskRef.current, session = sessionRef.current, inf = infoRef.current
    if (!mask || !session || !inf) return
    sourceRef.current?.stop()
    setPhase('rendering')
    try {
      const channels = await session.resynthesize(mask)
      const buf = buildAudioBuffer(channels)
      const wav = encodeWav(channels, inf.sampleRate)
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

  // ── UI helpers ───────────────────────────────────────────────────────────────
  const toolBtn: React.CSSProperties = {
    fontSize: 11, fontWeight: 600, padding: '5px 11px', borderRadius: 5, cursor: 'pointer',
    border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-secondary)',
    whiteSpace: 'nowrap',
  }
  const disabledTool: React.CSSProperties = { ...toolBtn, opacity: 0.4, cursor: 'not-allowed' }
  const segActive: React.CSSProperties = { ...toolBtn, background: 'rgba(61,143,239,0.18)', border: '1px solid #3d8fef', color: '#7ab5f7' }
  const hasSel = !!sel && phase === 'ready'
  const nyquist = info ? info.sampleRate / 2 : 24000

  const freqLabels = (logScale
    ? [100, 500, 1000, 5000, 10000, 20000].filter(f => f < nyquist)
    : [0.25, 0.5, 0.75, 1].map(t => t * nyquist))
    .map(f => {
      const bin = info ? Math.round(f / (nyquist / (info.bins - 1))) : 0
      return { f, y: info ? mapBinToY(info, logScale, bin) / DISPLAY_H : 0 }
    })
    .filter(l => l.y > 0.02 && l.y < 0.97)

  const selRectStyle = (r: Rect): React.CSSProperties => {
    const inf = info!
    const top = mapBinToY(inf, logScale, r.b1 + 1) / DISPLAY_H
    const bot = mapBinToY(inf, logScale, r.b0) / DISPLAY_H
    return {
      position: 'absolute', pointerEvents: 'none',
      left: `${(r.f0 / inf.frames) * 100}%`,
      width: `${((r.f1 - r.f0 + 1) / inf.frames) * 100}%`,
      top: `${top * 100}%`,
      height: `${Math.max(0.004, bot - top) * 100}%`,
      border: '1px solid #fff', background: 'rgba(255,255,255,0.1)',
      boxShadow: '0 0 0 1px rgba(0,0,0,0.6)',
    }
  }

  const selInfoText = sel
    ? sel.selMask
      ? `${sel.count?.toLocaleString() ?? '?'} cells selected`
      : `${(((sel.rect.f1 - sel.rect.f0 + 1) * (info?.hop ?? 512)) / (info?.sampleRate ?? 48000)).toFixed(2)}s × ${Math.round((sel.rect.b0 / (info?.bins ?? 1)) * nyquist)}–${Math.round(((sel.rect.b1 + 1) / (info?.bins ?? 1)) * nyquist)} Hz`
    : tool === 'brush' ? 'Paint to attenuate — size and strength on the right'
    : tool === 'wand' ? 'Click a spot to select similar energy around it'
    : 'Drag to select a region of the sound'

  return createPortal(
    <div
      className="electron-nodrag"
      style={{ position: 'fixed', inset: 0, zIndex: 2100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.75)' }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        width: 'min(1200px, calc(100vw - 40px))', background: '#141418', borderRadius: 12,
        border: '1px solid #2a2a30', boxShadow: '0 20px 60px rgba(0,0,0,0.7)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header: title + tools/layers/view */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderBottom: '1px solid #232328', background: '#18181d', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Spectral Editor</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{clip.name}</span>
          <div style={{ width: 1, height: 18, background: '#2a2a30', margin: '0 4px' }} />
          {(['select', 'wand', 'brush'] as const).map(t => (
            <button key={t} style={tool === t ? segActive : toolBtn} onClick={() => setTool(t)}>
              {t === 'select' ? 'Select' : t === 'wand' ? 'Wand' : 'Brush'}
            </button>
          ))}
          {tool === 'brush' && (
            <>
              <input type="range" min={2} max={30} value={brushSize} onChange={e => setBrushSize(parseInt(e.target.value))}
                title={`Brush size: ${brushSize}`} className="cf-slider" style={{ width: 70, accentColor: 'var(--accent)' }} />
              <select value={brushGain} onChange={e => setBrushGain(parseFloat(e.target.value))}
                title="Brush strength"
                style={{ background: '#111', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 10, borderRadius: 4, padding: '3px 4px', cursor: 'pointer' }}>
                <option value={0}>Erase</option>
                <option value={0.251}>−12 dB</option>
                <option value={0.501}>−6 dB</option>
              </select>
            </>
          )}
          <div style={{ width: 1, height: 18, background: '#2a2a30', margin: '0 4px' }} />
          <span style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.06em' }}>LAYER</span>
          {(['all', 'h', 'p'] as const).map(l => (
            <button key={l} style={layer === l ? segActive : toolBtn} onClick={() => void switchLayer(l)}>
              {l === 'all' ? 'All' : l === 'h' ? 'Harmonic' : 'Percussive'}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <button style={toolBtn} onClick={() => setLogScale(s => !s)} title="Toggle frequency axis scale">{logScale ? 'LOG' : 'LIN'}</button>
          <button style={toolBtn} title="Zoom out" onClick={() => setZoom(z => Math.max(1, z / 1.5))}><ZoomOut size={11} /></button>
          <button style={toolBtn} title="Zoom in" onClick={() => setZoom(z => Math.min(8, z * 1.5))}><ZoomIn size={11} /></button>
          {edited && <span style={{ fontSize: 10, color: '#f59e0b', marginLeft: 4 }}>edited</span>}
          <button onClick={onClose} title="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#777', display: 'flex', padding: 2 }}><X size={15} /></button>
        </div>

        {/* Canvas area */}
        <div style={{ position: 'relative', background: '#08060f', overflowX: 'auto', overflowY: 'hidden' }}>
          {phase === 'loading' && (
            <div style={{ height: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 12 }}>
              <Loader2 size={14} className="animate-spin" /> Analyzing audio…
            </div>
          )}
          {phase === 'error' && (
            <div style={{ height: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f87171', fontSize: 12, padding: '0 40px', textAlign: 'center' }}>
              {error}
            </div>
          )}
          {info && phase !== 'loading' && phase !== 'error' && (
            <div style={{ position: 'relative', width: `${zoom * 100}%`, height: 400 }}>
              <canvas
                ref={displayRef}
                width={info.frames}
                height={DISPLAY_H}
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                onMouseUp={onMouseUp}
                onMouseLeave={onMouseUp}
                style={{ display: 'block', width: '100%', height: '100%', cursor: 'crosshair' }}
              />
              <canvas
                ref={selDisplayRef}
                width={info.frames}
                height={DISPLAY_H}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
              />
              {freqLabels.map(l => (
                <span key={l.f} style={{
                  position: 'absolute', left: 6, top: `calc(${l.y * 100}% - 6px)`,
                  fontSize: 9, color: 'rgba(255,255,255,0.55)', pointerEvents: 'none', fontFamily: 'monospace',
                }}>{l.f >= 1000 ? `${(l.f / 1000).toFixed(l.f % 1000 === 0 ? 0 : 1)}k` : Math.round(l.f)}</span>
              ))}
              {dragRect && <div style={selRectStyle(dragRect)} />}
              {(phase === 'rendering' || phase === 'separating') && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: 'rgba(0,0,0,0.45)', color: '#fff', fontSize: 12 }}>
                  <Loader2 size={14} className="animate-spin" /> {phase === 'separating' ? 'Separating layers…' : 'Rendering…'}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Action bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 14px', borderTop: '1px solid #232328', background: '#18181d', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', marginRight: 4 }}>{selInfoText}</span>
          <div style={{ flex: 1 }} />
          <button style={hasSel ? toolBtn : disabledTool} disabled={!hasSel} onClick={() => void applyToSelection('mult', 0.501)}>−6 dB</button>
          <button style={hasSel ? toolBtn : disabledTool} disabled={!hasSel} onClick={() => void applyToSelection('mult', 0.251)}>−12 dB</button>
          <button style={hasSel ? toolBtn : disabledTool} disabled={!hasSel} onClick={() => void applyToSelection('mult', 1.995)}>+6 dB</button>
          <button style={hasSel ? { ...toolBtn, color: '#f87171', border: '1px solid rgba(239,68,68,0.5)' } : disabledTool} disabled={!hasSel} onClick={() => void applyToSelection('mult', 0)}>Erase</button>
          <button
            style={hasSel && layer === 'all' ? toolBtn : disabledTool}
            disabled={!hasSel || layer !== 'all'}
            title={layer !== 'all' ? 'Restore works on the All layer' : 'Reset the selection to unedited'}
            onClick={() => void applyToSelection('set', 1)}
          >Restore</button>
          <div style={{ width: 1, height: 18, background: '#2a2a30', margin: '0 3px' }} />
          <select value={denoiseAmount} onChange={e => setDenoiseAmount(parseFloat(e.target.value))}
            title="Noise reduction amount"
            style={{ background: '#111', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 10, borderRadius: 4, padding: '3px 4px', cursor: 'pointer' }}>
            <option value={0.5}>50%</option>
            <option value={0.8}>80%</option>
            <option value={1}>100%</option>
          </select>
          <button
            style={hasSel ? toolBtn : disabledTool}
            disabled={!hasSel}
            title="Use the selection as a noise profile and subtract it across the whole clip"
            onClick={() => void handleDenoise()}
          >Reduce Noise</button>
          <div style={{ width: 1, height: 18, background: '#2a2a30', margin: '0 3px' }} />
          <button style={canUndo && phase === 'ready' ? toolBtn : disabledTool} disabled={!canUndo || phase !== 'ready'} title="Undo (⌘Z)" onClick={() => void undo()}><Undo2 size={11} /></button>
          <button style={canRedo && phase === 'ready' ? toolBtn : disabledTool} disabled={!canRedo || phase !== 'ready'} title="Redo (⇧⌘Z)" onClick={() => void redo()}><Redo2 size={11} /></button>
          <div style={{ width: 1, height: 18, background: '#2a2a30', margin: '0 3px' }} />
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
