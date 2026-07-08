'use client'

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useDaw } from '@/lib/daw-state'
import type { AudioClip } from '@/lib/daw-types'
import Waveform from './Waveform'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
      <span style={{ width: 90, fontSize: 10, color: 'var(--text-muted)', flexShrink: 0, textAlign: 'right' }}>{label}</span>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>{children}</div>
    </div>
  )
}

function Section({ title }: { title: string }) {
  return (
    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.5, color: 'var(--text-muted)', textTransform: 'uppercase', marginTop: 18, marginBottom: 10, paddingBottom: 5, borderBottom: '1px solid var(--border)' }}>
      {title}
    </div>
  )
}

function Slider({ value, min, max, step, onChange }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <input type="range" min={min} max={max} step={step} value={value}
      onChange={e => onChange(parseFloat(e.target.value))}
      className="cf-slider" style={{ flex: 1 }} />
  )
}

function NumDisplay({ value, unit, decimals = 1, sign = false }: { value: number; unit: string; decimals?: number; sign?: boolean }) {
  return (
    <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-primary)', minWidth: 56, textAlign: 'right' }}>
      {sign && value >= 0 ? '+' : ''}{value.toFixed(decimals)} {unit}
    </span>
  )
}

function Toggle({ on, label, onChange }: { on: boolean; label: string; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, color: on ? 'var(--text-primary)' : 'var(--text-muted)' }}
    >
      <div style={{ width: 28, height: 14, borderRadius: 7, background: on ? 'var(--accent)' : 'var(--border)', position: 'relative', transition: 'background 0.15s', flexShrink: 0 }}>
        <div style={{ position: 'absolute', top: 2, left: on ? 16 : 2, width: 10, height: 10, borderRadius: 5, background: '#fff', transition: 'left 0.15s' }} />
      </div>
      <span style={{ fontSize: 10 }}>{label}</span>
    </button>
  )
}

// ── Pitch helpers ─────────────────────────────────────────────────────────────

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

function hzToNoteName(hz: number): string {
  const midi = 69 + 12 * Math.log2(hz / 440)
  const rounded = Math.round(midi)
  const name = NOTE_NAMES[((rounded % 12) + 12) % 12]
  const octave = Math.floor(rounded / 12) - 1
  return `${name}${octave}`
}

function shiftHz(hz: number, semitones: number, cents: number): number {
  return hz * Math.pow(2, (semitones + cents / 100) / 12)
}

// Simple autocorrelation pitch detector — runs synchronously on the raw buffer data.
function detectBufferPitch(buffer: AudioBuffer, trimStartSec: number): number | null {
  const data = buffer.getChannelData(0)
  const sr   = buffer.sampleRate
  const offset = Math.floor(trimStartSec * sr)
  const N = 2048

  // Skip if signal is too quiet
  let rms = 0
  for (let i = 0; i < N; i++) {
    const s = (offset + i < data.length) ? data[offset + i] : 0
    rms += s * s
  }
  if (Math.sqrt(rms / N) < 0.01) return null

  const minLag = Math.floor(sr / 1200)
  const maxLag = Math.min(Math.ceil(sr / 60), N >> 1)
  let bestVal = -Infinity, bestLag = 0

  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0
    for (let i = 0; i < N - lag; i++) {
      const a = (offset + i < data.length) ? data[offset + i] : 0
      const b = (offset + i + lag < data.length) ? data[offset + i + lag] : 0
      sum += a * b
    }
    if (sum > bestVal) { bestVal = sum; bestLag = lag }
  }

  if (bestVal <= 0 || bestLag === 0) return null
  return sr / bestLag
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ClipSettingsModal({ clip, onClose }: { clip: AudioClip; onClose: () => void }) {
  const { dispatch, engine } = useDaw()

  const gainDb = 20 * Math.log10(Math.max(0.001, clip.gain))

  function patch(p: Partial<AudioClip>) {
    dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: p })
  }

  function setGainDb(db: number) {
    patch({ gain: Math.pow(10, db / 20) })
  }

  // Warp speed info
  const nativeSec = clip.bufferDuration
    ? clip.bufferDuration - (clip.trimStart ?? 0) - (clip.trimEnd ?? 0)
    : null
  const clipSec   = engine.beatsToSeconds(clip.durationBeats)
  const speed     = nativeSec != null && clipSec > 0 ? nativeSec / clipSec : 1
  const pitchChangeSt = speed > 0 ? -12 * Math.log2(speed) : 0

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const [detectedPitch, setDetectedPitch] = useState<number | null>(null)

  // Detect pitch once on open from the buffer cache
  useEffect(() => {
    const buf = engine.bufferCache.get(clip.id)
    if (buf) setDetectedPitch(detectBufferPitch(buf, clip.trimStart ?? 0))
  }, [clip.id, clip.trimStart, engine])

  const [nameVal, setNameVal] = useState(clip.name)
  // Sync nameVal when the clip prop changes identity (user switches to different clip)
  const prevClipIdRef = useRef(clip.id)
  if (prevClipIdRef.current !== clip.id) { prevClipIdRef.current = clip.id; setNameVal(clip.name) }

  return createPortal(
    <div
className="electron-nodrag"
style={{ position: 'fixed', inset: 0, zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{ background: '#181828', border: '1px solid var(--border)', borderRadius: 10, padding: '18px 22px', width: 420, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 8px 40px rgba(0,0,0,0.7)' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <input
            value={nameVal}
            onChange={e => setNameVal(e.target.value)}
            onBlur={() => { if (nameVal.trim()) patch({ name: nameVal.trim() }) }}
            onKeyDown={e => { if (e.key === 'Enter') { if (nameVal.trim()) patch({ name: nameVal.trim() }); e.currentTarget.blur() } e.stopPropagation() }}
            style={{ flex: 1, fontSize: 13, fontWeight: 700, background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', color: 'var(--text-primary)', padding: '2px 0', outline: 'none' }}
          />
          <button onClick={onClose} style={{ width: 22, height: 22, borderRadius: 4, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, flexShrink: 0 }}>✕</button>
        </div>

        {/* Waveform preview */}
        {clip.waveformPeaks && clip.waveformPeaks.length > 0 && (
          <div style={{ marginBottom: 6, borderRadius: 5, overflow: 'hidden', background: '#0a0a0f' }}>
            <Waveform peaks={clip.waveformPeaks} color="#3d8fef" width={376} height={48} />
          </div>
        )}

        {/* ── SAMPLE ────────────────────────────── */}
        <Section title="Sample" />

        <Row label="Gain">
          <Slider value={gainDb} min={-24} max={12} step={0.1} onChange={setGainDb} />
          <NumDisplay value={gainDb} unit="dB" sign />
        </Row>

        <Row label="">
          <Toggle on={clip.reverse} label="Reverse" onChange={v => patch({ reverse: v })} />
        </Row>
        <Row label="">
          <Toggle on={clip.boomerang ?? false} label="Boomerang" onChange={v => { engine.clearBoomerangCache(clip.id); patch({ boomerang: v }) }} />
        </Row>

        {/* ── WARP ─────────────────────────────── */}
        <Section title="Warp" />

        <Row label="">
          <Toggle
            on={clip.warpEnabled ?? false}
            label="Enable Warp"
            onChange={v => {
              engine.clearStretchedCache(clip.id)
              patch({ warpEnabled: v })
            }}
          />
        </Row>

        {(clip.warpEnabled) && (
          <>
            <Row label="Mode">
              <div style={{ display: 'flex', gap: 6 }}>
                {(['repitch', 'stretch'] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => {
                      engine.clearStretchedCache(clip.id)
                      patch({ warpMode: m })
                    }}
                    style={{ fontSize: 10, padding: '3px 10px', borderRadius: 4, border: `1px solid ${(clip.warpMode ?? 'repitch') === m ? 'var(--accent)' : 'var(--border)'}`, background: (clip.warpMode ?? 'repitch') === m ? 'var(--accent)' : 'transparent', color: (clip.warpMode ?? 'repitch') === m ? '#fff' : 'var(--text-muted)', cursor: 'pointer' }}
                  >
                    {m === 'repitch' ? 'Re-Pitch' : 'Stretch'}
                  </button>
                ))}
              </div>
            </Row>
            <Row label="">
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                Speed: <span style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>{speed.toFixed(3)}×</span>
                {(clip.warpMode ?? 'repitch') === 'repitch' && (
                  <span style={{ marginLeft: 10 }}>
                    Pitch: <span style={{ color: 'var(--accent)', fontFamily: 'monospace' }}>
                      {pitchChangeSt >= 0 ? '+' : ''}{pitchChangeSt.toFixed(2)} st
                    </span>
                  </span>
                )}
                {(clip.warpMode ?? 'repitch') === 'stretch' && (
                  <span style={{ marginLeft: 10, color: '#888' }}>pitch-corrected</span>
                )}
              </div>
            </Row>
            <div style={{ fontSize: 9, color: '#555', marginLeft: 100, marginBottom: 8, marginTop: -4 }}>
              Resize the clip in the arrangement to change the stretch amount.
              {(clip.warpMode ?? 'repitch') === 'stretch' && ' Stretch uses WSOLA — quality degrades at extreme ratios.'}
            </div>
          </>
        )}

        {/* ── PITCH ────────────────────────────── */}
        <Section title="Pitch" />

        <Row label="Semitones">
          <Slider value={clip.pitchSemitones ?? 0} min={-24} max={24} step={1} onChange={v => { engine.clearPitchCache(clip.id); patch({ pitchSemitones: v }) }} />
          <NumDisplay value={clip.pitchSemitones ?? 0} unit="st" decimals={0} sign />
        </Row>
        <Row label="Fine">
          <Slider value={clip.pitchCents ?? 0} min={-100} max={100} step={1} onChange={v => { engine.clearPitchCache(clip.id); patch({ pitchCents: v }) }} />
          <NumDisplay value={clip.pitchCents ?? 0} unit="¢" decimals={0} sign />
        </Row>
        <Row label="Note">
          {detectedPitch ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                {hzToNoteName(detectedPitch)}
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>→</span>
              <span style={{ fontSize: 13, fontFamily: 'monospace', fontWeight: 700, color: 'var(--accent-light)' }}>
                {hzToNoteName(shiftHz(detectedPitch, clip.pitchSemitones ?? 0, clip.pitchCents ?? 0))}
              </span>
            </div>
          ) : (
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              {(() => {
                const st = (clip.pitchSemitones ?? 0)
                if (st === 0 && (clip.pitchCents ?? 0) === 0) return 'no shift'
                const target = hzToNoteName(shiftHz(440, st, clip.pitchCents ?? 0))
                return `A4 → ${target}`
              })()}
            </span>
          )}
        </Row>

        {/* ── FADE ─────────────────────────────── */}
        <Section title="Fade" />

        <Row label="Fade In">
          <Slider value={clip.fadeIn} min={0} max={4} step={0.01} onChange={v => patch({ fadeIn: v })} />
          <NumDisplay value={clip.fadeIn} unit="b" decimals={2} />
        </Row>
        <Row label="Fade Out">
          <Slider value={clip.fadeOut} min={0} max={4} step={0.01} onChange={v => patch({ fadeOut: v })} />
          <NumDisplay value={clip.fadeOut} unit="b" decimals={2} />
        </Row>

        {/* ── LOOP ─────────────────────────────── */}
        <Section title="Loop" />
        <Row label="">
          <Toggle on={clip.loopEnabled} label="Loop" onChange={v => patch({ loopEnabled: v })} />
        </Row>
        {clip.bufferDuration && (
          <div style={{ fontSize: 9, color: '#555', marginLeft: 100, marginBottom: 4 }}>
            Native length: {(clip.bufferDuration - (clip.trimStart ?? 0) - (clip.trimEnd ?? 0)).toFixed(3)} s
            &nbsp;·&nbsp;{engine.secondsToBeats(clip.bufferDuration - (clip.trimStart ?? 0) - (clip.trimEnd ?? 0)).toFixed(3)} b
          </div>
        )}

        {/* Close */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <button onClick={onClose} style={{ fontSize: 11, padding: '6px 18px', borderRadius: 5, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
