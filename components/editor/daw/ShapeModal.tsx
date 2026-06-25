'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useDaw } from '@/lib/daw-state'
import type { ClipEffect } from '@/lib/daw-types'

// Envelope resolution: 30 values per second of source audio
const ENV_SR = 30

// ── Signal processing ─────────────────────────────────────────────────────────

function extractAmplitudeEnvelope(buf: AudioBuffer): number[] {
  const data = buf.getChannelData(0)
  const frameSize = Math.max(1, Math.floor(buf.sampleRate / ENV_SR))
  const result: number[] = []
  for (let i = 0; i < data.length; i += frameSize) {
    let sum = 0; const end = Math.min(i + frameSize, data.length)
    for (let j = i; j < end; j++) sum += data[j] * data[j]
    result.push(Math.sqrt(sum / (end - i)))
  }
  const peak = Math.max(...result, 0.001)
  return result.map(v => v / peak)
}

function extractPitchEnvelope(buf: AudioBuffer): number[] {
  const data    = buf.getChannelData(0)
  const sr      = buf.sampleRate
  const step    = Math.max(1, Math.floor(sr / ENV_SR))
  const acfWin  = 1024  // autocorrelation window
  const minLag  = Math.floor(sr / 2000)  // 2 kHz max
  const maxLag  = Math.floor(sr / 60)    // 60 Hz min
  const semis: number[] = []
  let refHz = 0

  for (let start = 0; start + acfWin < data.length; start += step) {
    // Skip silence
    let rms = 0
    for (let j = start; j < start + acfWin; j++) rms += data[j] * data[j]
    if (Math.sqrt(rms / acfWin) < 0.008) { semis.push(semis[semis.length - 1] ?? 0); continue }

    // Autocorrelation — step inner loop by 2 for speed
    let bestCorr = -Infinity; let bestLag = minLag
    for (let lag = minLag; lag <= maxLag; lag++) {
      let corr = 0
      for (let j = 0; j < acfWin && start + j + lag < data.length; j += 2) {
        corr += data[start + j] * data[start + j + lag]
      }
      if (corr > bestCorr) { bestCorr = corr; bestLag = lag }
    }

    const hz = sr / bestLag
    if (refHz === 0) refHz = hz
    semis.push(12 * Math.log2(hz / refHz))
  }

  // Smooth with 3-frame moving average
  return semis.map((_, i, a) => {
    const sl = a.slice(Math.max(0, i - 2), i + 3)
    return sl.reduce((s, v) => s + v, 0) / sl.length
  })
}

// ── Canvas drawing ────────────────────────────────────────────────────────────

function drawWaveform(canvas: HTMLCanvasElement, buf: AudioBuffer) {
  const ctx = canvas.getContext('2d')!
  const W = canvas.width, H = canvas.height
  ctx.fillStyle = '#0a0a0f'; ctx.fillRect(0, 0, W, H)
  const data = buf.getChannelData(0)
  const step = Math.max(1, Math.floor(data.length / W))
  ctx.fillStyle = '#3d8fef'
  for (let x = 0; x < W; x++) {
    let p = 0
    for (let j = 0; j < step; j++) p = Math.max(p, Math.abs(data[x * step + j] ?? 0))
    const h = Math.max(1, p * H * 0.88)
    ctx.fillRect(x, (H - h) / 2, 1, h)
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke()
}

function drawEnvelope(canvas: HTMLCanvasElement, env: number[], mode: 'volume' | 'pitch') {
  const ctx = canvas.getContext('2d')!
  const W = canvas.width, H = canvas.height
  ctx.fillStyle = '#0a0a0f'; ctx.fillRect(0, 0, W, H)
  if (env.length < 2) return

  if (mode === 'volume') {
    ctx.fillStyle = 'rgba(34,197,94,0.18)'; ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.moveTo(0, H)
    env.forEach((v, i) => { const x = (i / (env.length - 1)) * W; ctx.lineTo(x, H - v * H * 0.88 - 2) })
    ctx.lineTo(W, H); ctx.closePath(); ctx.fill()
    ctx.beginPath()
    env.forEach((v, i) => { const x = (i / (env.length - 1)) * W; const y = H - v * H * 0.88 - 2; i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y) })
    ctx.stroke()
  } else {
    const range = Math.max(Math.abs(Math.min(...env)), Math.abs(Math.max(...env)), 1)
    // Semitone grid
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 0.5
    for (let s = -Math.ceil(range); s <= Math.ceil(range); s++) {
      const y = H / 2 - (s / range) * H * 0.44
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke()
    }
    // Pitch line
    ctx.strokeStyle = '#a855f7'; ctx.lineWidth = 2
    ctx.beginPath()
    env.forEach((v, i) => { const x = (i / (env.length - 1)) * W; const y = H / 2 - (v / range) * H * 0.44; i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y) })
    ctx.stroke()
    // Zero
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4])
    ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke()
    ctx.setLineDash([])
  }
}

// ── Modal component ───────────────────────────────────────────────────────────

export default function ShapeModal({
  effect,
  mode,
  onClose,
}: {
  effect: ClipEffect
  mode: 'volume' | 'pitch'
  onClose: () => void
}) {
  const { dispatch, engine, playing } = useDaw()
  const [buf,      setBuf]      = useState<AudioBuffer | null>(null)
  const [envelope, setEnvelope] = useState<number[] | null>(null)
  const [recording, setRecording] = useState(false)
  const [status,   setStatus]   = useState<'idle' | 'processing' | 'ready' | 'error'>('idle')
  const [level,    setLevel]    = useState(0)
  const waveRef  = useRef<HTMLCanvasElement>(null)
  const envRef   = useRef<HTMLCanvasElement>(null)
  const recRef   = useRef<MediaRecorder | null>(null)
  const rafRef   = useRef(0)

  async function processBuffer(audioBuf: AudioBuffer) {
    setStatus('processing')
    setBuf(audioBuf)
    await new Promise(r => setTimeout(r, 0))  // let React paint "processing…"
    try {
      const env = mode === 'volume' ? extractAmplitudeEnvelope(audioBuf) : extractPitchEnvelope(audioBuf)
      setEnvelope(env)
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }

  useEffect(() => {
    if (waveRef.current && buf)      drawWaveform(waveRef.current, buf)
    if (envRef.current  && envelope) drawEnvelope(envRef.current, envelope, mode)
  }, [buf, envelope, mode])

  async function handleFile(file: File) {
    setStatus('processing')
    try {
      const ab = await file.arrayBuffer()
      const actx = new AudioContext()
      const audioBuf = await actx.decodeAudioData(ab)
      await actx.close()
      await processBuffer(audioBuf)
    } catch { setStatus('error') }
  }

  async function startRec() {
    if (!playing) engine.play()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const actx   = new AudioContext()
      const src    = actx.createMediaStreamSource(stream)
      const analyser = actx.createAnalyser(); analyser.fftSize = 256; src.connect(analyser)
      const data = new Uint8Array(analyser.fftSize)
      const tick = () => {
        analyser.getByteTimeDomainData(data); let rms = 0
        for (const v of data) rms += (v / 128 - 1) ** 2
        setLevel(Math.min(1, Math.sqrt(rms / data.length) * 5))
        rafRef.current = requestAnimationFrame(tick)
      }
      tick()

      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : ''
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : {})
      const chunks: Blob[] = []
      recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }
      recorder.onstop = async () => {
        cancelAnimationFrame(rafRef.current); setLevel(0)
        stream.getTracks().forEach(t => t.stop())
        await actx.close()
        const blob = new Blob(chunks, { type: chunks[0]?.type ?? 'audio/webm' })
        try {
          const ab = await blob.arrayBuffer()
          const actx2 = new AudioContext()
          const audioBuf = await actx2.decodeAudioData(ab)
          await actx2.close()
          await processBuffer(audioBuf)
        } catch { setStatus('error') }
        setRecording(false)
      }
      recorder.start()
      recRef.current = recorder
      setRecording(true)
    } catch { setStatus('error') }
  }

  function stopRec() { recRef.current?.stop(); recRef.current = null }

  useEffect(() => () => { cancelAnimationFrame(rafRef.current); try { recRef.current?.stop() } catch {} }, [])

  function handleApply() {
    if (!envelope) return
    dispatch({ type: 'UPDATE_CLIP_EFFECT', effectId: effect.id, patch: { params: { shapeEnvelope: envelope, shapeSampleRate: ENV_SR } } })
    onClose()
  }

  function handleClear() {
    dispatch({ type: 'UPDATE_CLIP_EFFECT', effectId: effect.id, patch: { params: { shapeEnvelope: undefined, shapeSampleRate: undefined } } })
    onClose()
  }

  const color = mode === 'volume' ? '#22c55e' : '#a855f7'
  const hasExisting = !!(effect.params.shapeEnvelope?.length)

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.75)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: '#181828', border: `1px solid ${color}44`, borderRadius: 10, padding: 20, width: 500, boxShadow: '0 8px 40px rgba(0,0,0,0.7)' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color }}>
              {mode === 'volume' ? 'Shape Volume' : 'Shape Pitch'}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3, maxWidth: 380 }}>
              {mode === 'volume'
                ? 'Upload or record audio — the amplitude envelope of that audio will drive the volume of this effect region.'
                : 'Upload or record pitched audio — the pitch contour will be applied as real-time detune on audio clips passing through this region.'}
            </div>
          </div>
          <button onClick={onClose} style={{ fontSize: 14, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', paddingLeft: 12 }}>✕</button>
        </div>

        {/* Input row */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14 }}>
          <label style={{ padding: '5px 14px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-surface)', fontSize: 11, cursor: 'pointer', color: 'var(--text-primary)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
            📁 Upload
            <input type="file" accept="audio/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) { void handleFile(f) } }} />
          </label>

          {recording
            ? <button onClick={stopRec} style={{ padding: '5px 14px', borderRadius: 5, border: 'none', background: '#ef4444', color: '#fff', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>⏹ Stop</button>
            : <button onClick={() => { void startRec() }} style={{ padding: '5px 14px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 11, cursor: 'pointer', fontWeight: 500 }}>🎙 Record</button>
          }

          {recording && (
            <div style={{ flex: 1, height: 7, background: '#1a1a2e', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${level * 100}%`, background: level > 0.8 ? '#ef4444' : color, borderRadius: 4, transition: 'width 60ms' }} />
            </div>
          )}

          {status === 'processing' && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Processing…</span>}
          {status === 'error'      && <span style={{ fontSize: 10, color: '#ef4444' }}>Could not decode audio</span>}
        </div>

        {/* Visualisations */}
        {buf && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>Source waveform</div>
            <canvas ref={waveRef} width={460} height={44}
              style={{ width: '100%', height: 44, borderRadius: 4, background: '#0a0a0f', display: 'block' }} />
          </div>
        )}

        {envelope ? (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 9, color, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {mode === 'volume' ? 'Volume envelope' : 'Pitch contour (semitones from root)'}
            </div>
            <canvas ref={envRef} width={460} height={80}
              style={{ width: '100%', height: 80, borderRadius: 4, background: '#0a0a0f', display: 'block', marginBottom: 6 }} />
            <div style={{ fontSize: 9, color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between' }}>
              <span>{envelope.length} frames · {(envelope.length / ENV_SR).toFixed(1)}s source</span>
              {mode === 'pitch' && (
                <span>range: {Math.min(...envelope).toFixed(1)} → {Math.max(...envelope).toFixed(1)} semitones</span>
              )}
              {mode === 'volume' && (
                <span>peak: {(Math.max(...envelope) * 100).toFixed(0)}%</span>
              )}
            </div>
          </div>
        ) : status === 'idle' ? (
          <div style={{ height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px dashed var(--border)', borderRadius: 6, marginBottom: 14, fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
            Upload or record audio to define the {mode === 'volume' ? 'volume shape' : 'pitch curve'}
          </div>
        ) : null}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
          {hasExisting && (
            <button onClick={handleClear}
              style={{ fontSize: 11, padding: '5px 14px', borderRadius: 5, border: '1px solid #ef444444', background: 'transparent', color: '#ef4444', cursor: 'pointer', marginRight: 'auto' }}>
              Clear Shape
            </button>
          )}
          <button onClick={onClose}
            style={{ fontSize: 11, padding: '5px 14px', borderRadius: 5, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={handleApply} disabled={!envelope}
            style={{ fontSize: 11, padding: '5px 14px', borderRadius: 5, border: 'none', background: envelope ? color : 'var(--border)', color: '#fff', cursor: envelope ? 'pointer' : 'default', fontWeight: 600 }}>
            Apply Shape
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
