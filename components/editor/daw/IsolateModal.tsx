'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useDaw, makeAudioClip, extractPeaks } from '@/lib/daw-state'
import { isAudioClip } from '@/lib/daw-types'
import { encodeWav } from '@/lib/wav-codec'

const WINDOW_SEC = 1.0   // seconds of audio captured per position

function audioBufferToWavBlob(buf: AudioBuffer): Blob {
  const channels: Float32Array[] = []
  for (let i = 0; i < buf.numberOfChannels; i++) channels.push(buf.getChannelData(i))
  return new Blob([encodeWav(channels, buf.sampleRate)], { type: 'audio/wav' })
}

function drawWaveform(canvas: HTMLCanvasElement, buf: AudioBuffer | null) {
  const ctx = canvas.getContext('2d')!
  const W = canvas.width, H = canvas.height
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = '#0a0a0f'
  ctx.fillRect(0, 0, W, H)
  if (!buf) return
  const data = buf.getChannelData(0)
  const spb = Math.max(1, Math.floor(data.length / W))
  ctx.fillStyle = '#3d8fef'
  for (let x = 0; x < W; x++) {
    let p = 0
    for (let j = 0; j < spb; j++) p = Math.max(p, Math.abs(data[x * spb + j] ?? 0))
    const bh = Math.max(1, p * (H - 4))
    ctx.fillRect(x, (H - bh) / 2, 1, bh)
  }
  // centre line
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'
  ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke()
}

export default function IsolateModal({
  trackId,
  initialBeat,
  onClose,
}: {
  trackId: string
  initialBeat: number
  onClose: () => void
}) {
  const { project, dispatch, engine } = useDaw()
  const [beat,    setBeat]    = useState(initialBeat)
  const [status,  setStatus]  = useState<'loading' | 'ready' | 'error'>('loading')
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const sourceRef  = useRef<AudioBufferSourceNode | null>(null)
  const renderedRef = useRef<AudioBuffer | null>(null)
  const beatRef    = useRef(initialBeat)
  const renderingRef = useRef(false)

  beatRef.current = beat

  const render = useCallback(async (targetBeat: number): Promise<AudioBuffer | null> => {
    if (engine.ctx.state === 'suspended') await engine.ctx.resume()
    const positionSec = engine.beatsToSeconds(targetBeat)
    const windowBeats = engine.secondsToBeats(WINDOW_SEC)
    const audioClips = project.arrangementClips.filter(
      c => isAudioClip(c) && c.trackId === trackId &&
           c.startBeat < targetBeat + windowBeats &&
           c.startBeat + c.durationBeats > targetBeat
    )

    const SR = engine.ctx.sampleRate
    const offCtx = new OfflineAudioContext(2, Math.ceil(WINDOW_SEC * SR), SR)

    let hasAudio = false
    for (const clip of audioClips) {
      if (!isAudioClip(clip) || !clip.audioUrl) continue
      let buf = engine.bufferCache.get(clip.id)
      if (!buf) buf = await engine.loadClipBuffer(clip) ?? undefined
      if (!buf) continue

      const clipStartSec = engine.beatsToSeconds(clip.startBeat)
      const offsetIntoClip = Math.max(0, positionSec - clipStartSec) + clip.trimStart
      const startInWindow = Math.max(0, clipStartSec - positionSec)

      const src = offCtx.createBufferSource()
      src.buffer = buf
      src.connect(offCtx.destination)
      src.start(startInWindow, offsetIntoClip, WINDOW_SEC)
      hasAudio = true
    }

    if (!hasAudio) {
      // Return 1 second of silence
      return offCtx.startRendering()
    }
    return offCtx.startRendering()
  }, [project, trackId, engine])

  const startLoop = useCallback((buf: AudioBuffer) => {
    sourceRef.current?.stop()
    sourceRef.current?.disconnect()
    const src = engine.ctx.createBufferSource()
    src.buffer = buf
    src.loop = true
    src.connect(engine.ctx.destination)
    src.start()
    sourceRef.current = src
    renderedRef.current = buf
    if (canvasRef.current) drawWaveform(canvasRef.current, buf)
  }, [engine])

  const loadAt = useCallback(async (targetBeat: number) => {
    if (renderingRef.current) return
    renderingRef.current = true
    setStatus('loading')
    try {
      const buf = await render(targetBeat)
      if (!buf) { setStatus('error'); return }
      startLoop(buf)
      setStatus('ready')
    } catch {
      setStatus('error')
    } finally {
      renderingRef.current = false
    }
  }, [render, startLoop])

  // Initial load
  useEffect(() => {
    void loadAt(initialBeat)
    return () => {
      try { sourceRef.current?.stop() } catch { /* ok */ }
      sourceRef.current?.disconnect()
    }
  }, []) // intentionally runs once

  // Keyboard scrubbing
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.code !== 'ArrowLeft' && e.code !== 'ArrowRight') return
      e.preventDefault(); e.stopPropagation()
      const step = e.shiftKey ? 1 : e.ctrlKey || e.metaKey ? 4 : 0.125
      const dir = e.code === 'ArrowRight' ? 1 : -1
      const next = Math.max(0, beatRef.current + dir * step)
      setBeat(next)
      void loadAt(next)
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [loadAt])

  function handleSelect() {
    const buf = renderedRef.current
    if (!buf) return
    const peaks = extractPeaks(buf)
    const blob = audioBufferToWavBlob(buf)
    const url = URL.createObjectURL(blob)
    const clip = makeAudioClip(
      trackId,
      `Isolated ${beat.toFixed(2)}b`,
      beat,
      engine.secondsToBeats(WINDOW_SEC),
      { audioUrl: url, waveformPeaks: peaks, bufferDuration: buf.duration },
    )
    dispatch({ type: 'ADD_CLIP', clip })
    try { sourceRef.current?.stop() } catch { /* ok */ }
    sourceRef.current?.disconnect()
    onClose()
  }

  const track = project.tracks.find(t => t.id === trackId)
  const bar = Math.floor(beat / project.timeSignatureNum) + 1
  const bInBar = (beat % project.timeSignatureNum) + 1

  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.75)' }}
      onClick={e => { if (e.target === e.currentTarget) { try { sourceRef.current?.stop() } catch {} onClose() } }}
    >
      <div style={{ background: '#181828', border: '1px solid var(--border)', borderRadius: 10, padding: 20, width: 460, boxShadow: '0 8px 40px rgba(0,0,0,0.7)' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Isolate on Playhead</div>
            {track && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{track.name}</div>}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent)', fontFamily: 'monospace' }}>
              {bar}.{bInBar.toFixed(2).replace('0.', '').padStart(2, '0')}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Bar {bar} · Beat {(beat % project.timeSignatureNum + 1).toFixed(3)}</div>
          </div>
        </div>

        {/* Waveform */}
        <div style={{ position: 'relative', marginBottom: 10 }}>
          <canvas ref={canvasRef} width={420} height={72}
            style={{ width: '100%', height: 72, display: 'block', borderRadius: 6, background: '#0a0a0f' }} />
          {status === 'loading' && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)', borderRadius: 6, fontSize: 11, color: 'var(--text-muted)' }}>
              Rendering…
            </div>
          )}
        </div>

        {/* Scrub hint */}
        <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center', marginBottom: 16 }}>
          ← / → scrub by 1/8 note · Shift+arrow = 1 beat · Ctrl+arrow = 1 bar
        </div>

        {/* Scrub buttons */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 18 }}>
          {[{ label: '◀◀ 1 bar', delta: -4, shift: false }, { label: '◀ 1 beat', delta: -1, shift: false }, { label: '▶ 1 beat', delta: 1, shift: false }, { label: '▶▶ 1 bar', delta: 4, shift: false }].map(({ label, delta }) => (
            <button key={label} onClick={() => { const next = Math.max(0, beat + delta); setBeat(next); void loadAt(next) }}
              style={{ fontSize: 10, padding: '4px 10px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-muted)', cursor: 'pointer' }}>
              {label}
            </button>
          ))}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={() => { try { sourceRef.current?.stop() } catch {} onClose() }}
            style={{ fontSize: 11, padding: '6px 16px', borderRadius: 5, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={handleSelect} disabled={status !== 'ready'}
            style={{ fontSize: 11, padding: '6px 16px', borderRadius: 5, border: 'none', background: status === 'ready' ? 'var(--accent)' : 'var(--border)', color: '#fff', cursor: status === 'ready' ? 'pointer' : 'default', fontWeight: 600 }}>
            Select → Create 1s Clip
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
