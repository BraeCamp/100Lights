'use client'

// Shared plumbing for the in-article mixing widgets (EQ, compressor, reverb,
// width). Each widget builds its own Web Audio chain and visual; this provides
// the one shared AudioContext, the looping groove source + transport, and the
// small UI atoms so the widgets stay short and consistent.

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Play, Square, RotateCcw } from 'lucide-react'
import { grooveLoop } from '@/lib/article-loop'

export const ACCENT = '#a78bfa'
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

// One context for every mixing widget on the page — created lazily (the widget
// only mounts when scrolled near) and left suspended until the reader hits play.
let _ctx: AudioContext | null = null
export function mixCtx(): AudioContext {
  return (_ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)())
}

/** Loads the groove and loops it into `inputRef` on play. Returns transport state. */
export function useLoopPlayer(inputRef: React.RefObject<AudioNode | null>) {
  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const bufRef = useRef<AudioBuffer | null>(null)
  const srcRef = useRef<AudioBufferSourceNode | null>(null)

  useEffect(() => {
    let cancelled = false
    grooveLoop(mixCtx().sampleRate)
      .then(b => { if (!cancelled) { bufRef.current = b; setReady(true) } })
      .catch(() => { /* leave !ready — button shows unavailable */ })
    return () => { cancelled = true; try { srcRef.current?.stop() } catch { /* stopped */ } }
  }, [])

  const stop = useCallback(() => {
    try { srcRef.current?.stop() } catch { /* already stopped */ }
    srcRef.current = null
    setPlaying(false)
  }, [])

  const play = useCallback(async () => {
    const c = mixCtx()
    try { await c.resume() } catch { /* gesture already resumed */ }
    if (!bufRef.current || !inputRef.current) return
    try { srcRef.current?.stop() } catch { /* none */ }
    const s = c.createBufferSource()
    s.buffer = bufRef.current
    s.loop = true
    s.connect(inputRef.current)
    s.start()
    srcRef.current = s
    setPlaying(true)
  }, [inputRef])

  return { ready, playing, play, stop }
}

export const rangeStyle: React.CSSProperties = { width: '100%', accentColor: ACCENT, cursor: 'pointer', height: 22 }

export function Frame({ children, caption }: { children: React.ReactNode; caption?: string }) {
  return (
    <figure style={{ margin: '24px 0' }}>
      <div style={{ border: `1px solid ${ACCENT}55`, borderRadius: 14, padding: '16px 18px', background: 'rgba(167,139,250,0.05)' }}>
        {children}
      </div>
      {caption && <figcaption style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.6 }}>{caption}</figcaption>}
    </figure>
  )
}

export function Transport({
  ready, playing, onPlay, onStop, onReset, playLabel = 'Play the loop', extra,
}: {
  ready: boolean; playing: boolean; onPlay: () => void; onStop: () => void
  onReset?: () => void; playLabel?: string; extra?: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
      <button
        onClick={() => (playing ? onStop() : onPlay())}
        disabled={!ready}
        style={{
          display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 700,
          padding: '9px 18px', borderRadius: 10, border: 'none',
          cursor: ready ? 'pointer' : 'default', opacity: ready ? 1 : 0.5,
          background: playing ? ACCENT : 'rgba(167,139,250,0.2)', color: playing ? '#fff' : ACCENT,
        }}
      >
        {playing ? <Square size={13} fill="currentColor" /> : <Play size={14} />}
        {playing ? 'Stop' : ready ? playLabel : 'Loading…'}
      </button>
      {extra}
      {onReset && (
        <button
          onClick={onReset}
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 700, padding: '9px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: 'pointer', marginLeft: 'auto' }}
        >
          <RotateCcw size={12} /> Reset
        </button>
      )}
    </div>
  )
}

/** Momentary "hold to bypass" A/B button — the compare the whole idea rests on. */
export function BypassButton({ bypassed, setBypassed, disabled, label = 'Hold: bypass' }: {
  bypassed: boolean; setBypassed: (v: boolean) => void; disabled?: boolean; label?: string
}) {
  return (
    <button
      onPointerDown={() => setBypassed(true)}
      onPointerUp={() => setBypassed(false)}
      onPointerLeave={() => setBypassed(false)}
      onPointerCancel={() => setBypassed(false)}
      disabled={disabled}
      style={{
        fontSize: 12, fontWeight: 700, padding: '9px 14px', borderRadius: 10, cursor: disabled ? 'default' : 'pointer',
        border: `1px solid ${bypassed ? ACCENT : 'var(--border)'}`, userSelect: 'none', touchAction: 'none',
        background: bypassed ? 'rgba(167,139,250,0.22)' : 'var(--bg-card)', color: bypassed ? ACCENT : 'var(--text-secondary)',
        opacity: disabled ? 0.5 : 1,
      }}
    >{label}</button>
  )
}

/** "Open in studio →" — carries the widget's creation onto the real timeline. */
export function StudioButton({ onClick, label = 'Open in studio' }: { onClick: () => void; label?: string }) {
  return (
    <button
      onClick={onClick}
      title="Carry this into the full studio to keep building"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 700,
        padding: '8px 13px', borderRadius: 9, cursor: 'pointer', marginTop: 12,
        border: `1px solid ${ACCENT}66`, background: 'rgba(167,139,250,0.10)', color: ACCENT,
      }}
    >{label} →</button>
  )
}

export function Control({ label, value, children }: { label: React.ReactNode; value: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
        {typeof label === 'string' ? <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>{label}</span> : label}
        <span style={{ fontSize: 11, fontWeight: 700, color: ACCENT, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      </div>
      {children}
    </div>
  )
}
