'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useDaw, makeAudioClip, extractPeaks } from '@/lib/daw-state'
import { isAudioClip } from '@/lib/daw-types'
import { encodeWav } from '@/lib/wav-codec'

const MIN_WIN_BEATS = 1 / 128
const MAX_WIN_BEATS = 8

function audioBufferToWavBlob(buf: AudioBuffer): Blob {
  const channels: Float32Array[] = []
  for (let i = 0; i < buf.numberOfChannels; i++) channels.push(buf.getChannelData(i))
  return new Blob([encodeWav(channels, buf.sampleRate)], { type: 'audio/wav' })
}

function boomerangBuffer(buf: AudioBuffer): AudioBuffer {
  const len = buf.length
  const out = new AudioBuffer({ length: len * 2, sampleRate: buf.sampleRate, numberOfChannels: buf.numberOfChannels })
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const src = buf.getChannelData(c)
    const dst = out.getChannelData(c)
    for (let i = 0; i < len; i++) dst[i] = src[i]
    for (let i = 0; i < len; i++) dst[len + i] = src[len - 1 - i]
  }
  return out
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
  const [beat,        setBeat]        = useState(initialBeat)
  const [windowBeats, setWindowBeats] = useState(1 / 16)
  const [boomerang,   setBoomerang]   = useState(false)
  const [status,      setStatus]      = useState<'loading' | 'ready' | 'error'>('loading')
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const sourceRef    = useRef<AudioBufferSourceNode | null>(null)
  const fadeRef      = useRef<GainNode | null>(null)
  const renderedRef  = useRef<AudioBuffer | null>(null)
  const beatRef      = useRef(initialBeat)
  const winBeatsRef  = useRef(1 / 16)
  const boomerangRef = useRef(false)
  const renderingRef = useRef(false)

  beatRef.current     = beat
  winBeatsRef.current = windowBeats
  boomerangRef.current = boomerang

  // Log-scale slider helpers
  function sliderToBeats(t: number): number {
    return MIN_WIN_BEATS * Math.pow(MAX_WIN_BEATS / MIN_WIN_BEATS, t)
  }
  function beatsToSlider(b: number): number {
    return Math.log(b / MIN_WIN_BEATS) / Math.log(MAX_WIN_BEATS / MIN_WIN_BEATS)
  }

  const render = useCallback(async (targetBeat: number, winB?: number): Promise<AudioBuffer | null> => {
    const wb = winB ?? winBeatsRef.current
    if (engine.ctx.state === 'suspended') await engine.ctx.resume()
    const positionSec = engine.beatsToSeconds(targetBeat)
    const windowSec   = engine.beatsToSeconds(wb)
    const audioClips = project.arrangementClips.filter(
      c => isAudioClip(c) && c.trackId === trackId &&
           c.startBeat < targetBeat + wb &&
           c.startBeat + c.durationBeats > targetBeat
    )

    const SR = engine.ctx.sampleRate
    const offCtx = new OfflineAudioContext(2, Math.max(1, Math.ceil(windowSec * SR)), SR)

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
      src.start(startInWindow, offsetIntoClip, windowSec)
      hasAudio = true
    }

    if (!hasAudio) {
      // Return 1 second of silence
      return offCtx.startRendering()
    }
    return offCtx.startRendering()
  }, [project, trackId, engine])

  const startLoop = useCallback((buf: AudioBuffer) => {
    try { sourceRef.current?.stop() } catch { /* ok */ }
    sourceRef.current?.disconnect()
    fadeRef.current?.disconnect()
    const playBuf = boomerangRef.current ? boomerangBuffer(buf) : buf
    const src  = engine.ctx.createBufferSource()
    src.buffer = playBuf
    src.loop   = true
    const fade = engine.ctx.createGain()
    fadeRef.current = fade
    const now  = engine.ctx.currentTime
    fade.gain.setValueAtTime(0, now)
    fade.gain.linearRampToValueAtTime(1, now + 0.005)
    src.connect(fade)
    fade.connect(engine.ctx.destination)
    src.start()
    sourceRef.current = src
    renderedRef.current = buf
    if (canvasRef.current) drawWaveform(canvasRef.current, buf)
  }, [engine])

  const loadAt = useCallback(async (targetBeat: number, winB?: number) => {
    if (renderingRef.current) return
    renderingRef.current = true
    setStatus('loading')
    // Stop immediately so stale audio doesn't play if render fails
    try { sourceRef.current?.stop() } catch { /* ok */ }
    try {
      const buf = await render(targetBeat, winB)
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
      fadeRef.current?.disconnect()
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
    const rawBuf = renderedRef.current
    if (!rawBuf) return
    const buf    = boomerang ? boomerangBuffer(rawBuf) : rawBuf
    const peaks  = extractPeaks(buf)
    const blob   = audioBufferToWavBlob(buf)
    const url    = URL.createObjectURL(blob)
    const clip   = makeAudioClip(
      trackId,
      `Isolated ${beat.toFixed(2)}b${boomerang ? ' ↔' : ''}`,
      beat,
      boomerang ? windowBeats * 2 : windowBeats,
      { audioUrl: url, waveformPeaks: peaks, bufferDuration: buf.duration, loopEnabled: true, fadeIn: engine.secondsToBeats(0.004) },
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
      onClick={e => { if (e.target === e.currentTarget) { try { sourceRef.current?.stop() } catch {} fadeRef.current?.disconnect(); onClose() } }}
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

        {/* Window size */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Window size</span>
            <span style={{ fontSize: 10, color: 'var(--text-primary)', fontFamily: 'monospace' }}>
              {windowBeats < 0.1 ? windowBeats.toFixed(4) : windowBeats.toFixed(3)} b
              &nbsp;·&nbsp;{(engine.beatsToSeconds(windowBeats) * 1000).toFixed(1)} ms
            </span>
          </div>
          <input
            type="range" min={0} max={1} step={0.0001}
            value={beatsToSlider(windowBeats)}
            onChange={e => {
              const wb = sliderToBeats(parseFloat(e.target.value))
              setWindowBeats(wb)
              winBeatsRef.current = wb
              void loadAt(beatRef.current, wb)
            }}
            className="cf-slider"
            style={{ width: '100%' }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
            <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>1/128 b</span>
            <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>8 b</span>
          </div>
        </div>

        {/* Boomerang toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <button
            onClick={() => {
              const next = !boomerang
              setBoomerang(next)
              boomerangRef.current = next
              if (renderedRef.current) startLoop(renderedRef.current)
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, color: boomerang ? 'var(--text-primary)' : 'var(--text-muted)' }}
          >
            <div style={{ width: 28, height: 14, borderRadius: 7, background: boomerang ? 'var(--accent)' : 'var(--border)', position: 'relative', transition: 'background 0.15s', flexShrink: 0 }}>
              <div style={{ position: 'absolute', top: 2, left: boomerang ? 16 : 2, width: 10, height: 10, borderRadius: 5, background: '#fff', transition: 'left 0.15s' }} />
            </div>
            <span style={{ fontSize: 10 }}>Boomerang (↔ ping-pong loop)</span>
          </button>
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
          <button onClick={() => { try { sourceRef.current?.stop() } catch {} fadeRef.current?.disconnect(); onClose() }}
            style={{ fontSize: 11, padding: '6px 16px', borderRadius: 5, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={handleSelect} disabled={status !== 'ready'}
            style={{ fontSize: 11, padding: '6px 16px', borderRadius: 5, border: 'none', background: status === 'ready' ? 'var(--accent)' : 'var(--border)', color: '#fff', cursor: status === 'ready' ? 'pointer' : 'default', fontWeight: 600 }}>
            Select → Place Clip ({windowBeats < 0.1 ? windowBeats.toFixed(4) : windowBeats.toFixed(3)} b)
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
