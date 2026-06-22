'use client'

/**
 * WavetableSynthEditor — full UI for the wavetable synthesizer engine.
 * Layout inspired by Ableton's Wavetable plugin.
 *
 * Sections (top → bottom):
 *   Wavetable display canvas  (full width, animated)
 *   Oscillator A | Oscillator B
 *   Filter (controls + frequency-response curve)
 *   Amplitude ADSR | Filter ADSR
 *   LFO
 *   Mini keyboard + Preset selector
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import {
  generateWavetable,
  playWavetableNote,
  WAVETABLE_FRAMES,
  FRAME_SIZE,
  WAVETABLE_PRESETS,
  type WavetablePatch,
} from '@/lib/wavetable-synth'

// ── Props ──────────────────────────────────────────────────────────────────────

interface WavetableSynthEditorProps {
  patch: WavetablePatch
  onPatchChange: (p: WavetablePatch) => void
  onClose: () => void
}

// ── Constants ──────────────────────────────────────────────────────────────────

const MIDI_BASE    = 48      // C3
const KEY_COUNT    = 25      // two octaves + 1
const BLACK_SEMIS  = new Set([1, 3, 6, 8, 10])
const NOTE_NAMES   = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']

type WTType = WavetablePatch['oscAWavetable']
const WT_TYPES: WTType[] = ['analog', 'digital', 'vocal', 'strings', 'brass', 'custom']

// ── Tiny slider component ──────────────────────────────────────────────────────

interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  display?: (v: number) => string
  onChange: (v: number) => void
  vertical?: boolean
}

function Knob({ label, value, min, max, step = 0.001, display, onChange }: SliderProps) {
  const pct = ((value - min) / (max - min)) * 100
  const text = display ? display(value) : value.toFixed(2)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, minWidth: 56 }}>
      <input
        type="range"
        min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{
          writingMode: 'vertical-lr' as const,
          direction: 'rtl' as const,
          appearance: 'slider-vertical' as unknown as undefined,
          WebkitAppearance: 'slider-vertical' as unknown as undefined,
          width: 24, height: 80,
          accentColor: 'var(--accent)',
          cursor: 'pointer',
        } as React.CSSProperties}
        aria-label={label}
      />
      <span style={{ fontSize: 10, color: 'var(--accent)', fontVariantNumeric: 'tabular-nums', minWidth: 36, textAlign: 'center' }}>
        {text}
      </span>
      <span style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.2 }}>{label}</span>
      <div style={{ width: 40, height: 2, borderRadius: 1, background: 'var(--bg-base)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)' }} />
      </div>
    </div>
  )
}

function HSlider({ label, value, min, max, step = 0.001, display, onChange }: SliderProps) {
  const text = display ? display(value) : value.toFixed(2)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <span style={{ fontSize: 11, color: 'var(--text-secondary)', width: 90, flexShrink: 0 }}>{label}</span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ flex: 1, accentColor: 'var(--accent)', cursor: 'pointer' }}
        aria-label={label}
      />
      <span style={{ fontSize: 11, color: 'var(--accent)', fontVariantNumeric: 'tabular-nums', minWidth: 44, textAlign: 'right' }}>
        {text}
      </span>
    </div>
  )
}

// ── ADSR canvas drawing ────────────────────────────────────────────────────────

function drawADSR(
  canvas: HTMLCanvasElement,
  attack: number, decay: number, sustain: number, release: number,
  color: string,
) {
  const ctx  = canvas.getContext('2d')
  if (!ctx) return
  const W = canvas.width, H = canvas.height
  ctx.clearRect(0, 0, W, H)

  // Normalise times into a 0–1 horizontal range
  const total = attack + decay + 0.3 + release  // 0.3 = sustain section
  const ax = (attack / total) * W * 0.85 + W * 0.05
  const dx = ax + (decay / total) * W * 0.85
  const sx = dx + (0.3 / total) * W * 0.85
  const rx = sx + (release / total) * W * 0.85

  const sy = H - sustain * (H - 10) - 4

  ctx.beginPath()
  ctx.moveTo(W * 0.05, H - 4)
  ctx.lineTo(ax, 6)
  ctx.lineTo(dx, sy)
  ctx.lineTo(sx, sy)
  ctx.lineTo(rx, H - 4)
  ctx.strokeStyle = color
  ctx.lineWidth   = 2
  ctx.lineJoin    = 'round'
  ctx.stroke()

  // Filled area
  ctx.lineTo(W * 0.05, H - 4)
  ctx.closePath()
  ctx.fillStyle = color + '22'
  ctx.fill()
}

// ── Filter response canvas ─────────────────────────────────────────────────────

function drawFilterResponse(
  canvas: HTMLCanvasElement,
  type: WavetablePatch['filterType'],
  cutoff: number,
  resonance: number,
) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const W = canvas.width, H = canvas.height
  ctx.clearRect(0, 0, W, H)

  // Grid
  ctx.strokeStyle = 'var(--border)'
  ctx.lineWidth   = 0.5
  for (let i = 1; i < 4; i++) {
    ctx.beginPath(); ctx.moveTo(0, (H / 4) * i); ctx.lineTo(W, (H / 4) * i); ctx.stroke()
  }

  // Frequency axis is log-scaled 20 Hz → 20 kHz
  function freqToX(f: number) {
    return (Math.log10(f / 20) / Math.log10(1000)) * W
  }

  // Simple biquad response approximation
  function response(f: number): number {
    const fc = cutoff, Q = Math.max(0.5, resonance)
    const ratio = f / fc
    switch (type) {
      case 'lowpass': {
        const r2 = ratio * ratio
        const denom = Math.sqrt((1 - r2) ** 2 + (ratio / Q) ** 2)
        return denom < 0.0001 ? 1 : Math.min(1.0 / denom, 6)
      }
      case 'highpass': {
        const r2 = ratio * ratio
        const denom = Math.sqrt((1 - r2) ** 2 + (ratio / Q) ** 2)
        return denom < 0.0001 ? 0 : Math.min(r2 / denom, 6)
      }
      case 'bandpass': {
        const r2 = ratio * ratio
        const denom = Math.sqrt((1 - r2) ** 2 + (ratio / Q) ** 2)
        return denom < 0.0001 ? 0 : Math.min((ratio / Q) / denom, 4)
      }
    }
  }

  ctx.beginPath()
  let first = true
  for (let px = 0; px < W; px++) {
    const f   = 20 * Math.pow(1000, px / W)
    const amp = response(f)
    const y   = H - (Math.min(amp, 4) / 4) * (H - 10) - 4
    if (first) { ctx.moveTo(px, y); first = false } else ctx.lineTo(px, y)
  }
  ctx.strokeStyle = 'var(--accent)'
  ctx.lineWidth   = 2
  ctx.stroke()

  // Cutoff marker
  const cx = freqToX(cutoff)
  ctx.beginPath()
  ctx.moveTo(cx, 0); ctx.lineTo(cx, H)
  ctx.strokeStyle = 'var(--accent)' + '66'
  ctx.lineWidth   = 1
  ctx.setLineDash([3, 3])
  ctx.stroke()
  ctx.setLineDash([])
}

// ── Wavetable canvas ───────────────────────────────────────────────────────────

function drawWavetable(
  canvas: HTMLCanvasElement,
  table: Float32Array,
  frame: number,
) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const W = canvas.width, H = canvas.height
  ctx.clearRect(0, 0, W, H)

  // Ghost frames (neighbours)
  const ghostFrames = [-2, -1, 1, 2]
  for (const df of ghostFrames) {
    const fi = Math.round(frame * (WAVETABLE_FRAMES - 1)) + df
    if (fi < 0 || fi >= WAVETABLE_FRAMES) continue
    const alpha = 1 - Math.abs(df) * 0.35
    const base  = fi * FRAME_SIZE
    // Draw every 8th sample for performance
    ctx.beginPath()
    let first = true
    for (let px = 0; px < W; px++) {
      const sampleIdx = Math.floor((px / W) * (FRAME_SIZE / 4))  // one quarter cycle
      const s = table[base + sampleIdx] ?? 0
      const y = (H / 2) - s * (H / 2 - 6)
      if (first) { ctx.moveTo(px, y); first = false } else ctx.lineTo(px, y)
    }
    ctx.strokeStyle = `rgba(255,255,255,${alpha * 0.12})`
    ctx.lineWidth   = 1
    ctx.stroke()
  }

  // Active frame
  const frameIdx = Math.round(frame * (WAVETABLE_FRAMES - 1))
  const base     = frameIdx * FRAME_SIZE
  ctx.beginPath()
  let first = true
  for (let px = 0; px < W; px++) {
    const si = Math.floor((px / W) * (FRAME_SIZE / 4))
    const s  = table[base + si] ?? 0
    const y  = (H / 2) - s * (H / 2 - 8)
    if (first) { ctx.moveTo(px, y); first = false } else ctx.lineTo(px, y)
  }
  const grad = ctx.createLinearGradient(0, 0, W, 0)
  grad.addColorStop(0,   'var(--accent)')
  grad.addColorStop(0.5, '#a78bfa')
  grad.addColorStop(1,   'var(--accent)')
  ctx.strokeStyle = grad
  ctx.lineWidth   = 2.5
  ctx.stroke()

  // Position indicator
  const posX = frame * W
  ctx.beginPath()
  ctx.moveTo(posX, 0); ctx.lineTo(posX, H)
  ctx.strokeStyle = '#ffffff44'
  ctx.lineWidth   = 1
  ctx.stroke()
}

// ── Mini keyboard ──────────────────────────────────────────────────────────────

interface KeyboardProps {
  onNoteOn:  (midi: number) => void
  onNoteOff: (midi: number) => void
}

function MiniKeyboard({ onNoteOn, onNoteOff }: KeyboardProps) {
  const whites: number[] = []
  for (let i = 0; i < KEY_COUNT; i++) {
    const semi = (MIDI_BASE + i) % 12
    if (!BLACK_SEMIS.has(semi)) whites.push(MIDI_BASE + i)
  }

  const held = useRef(new Set<number>())

  function startNote(midi: number) {
    if (held.current.has(midi)) return
    held.current.add(midi)
    onNoteOn(midi)
  }
  function stopNote(midi: number) {
    if (!held.current.has(midi)) return
    held.current.delete(midi)
    onNoteOff(midi)
  }

  const KEY_W = 22
  const KEY_H = 70
  const BK_W  = 14
  const BK_H  = 42

  return (
    <div style={{ position: 'relative', height: KEY_H + 2, userSelect: 'none', flexShrink: 0 }}>
      {/* White keys */}
      {whites.map((midi, wi) => (
        <div
          key={midi}
          onMouseDown={e => { e.preventDefault(); startNote(midi) }}
          onMouseUp={()   => stopNote(midi)}
          onMouseLeave={() => stopNote(midi)}
          style={{
            position: 'absolute', left: wi * (KEY_W + 1), top: 0,
            width: KEY_W, height: KEY_H,
            background: '#e8e8e8', border: '1px solid #888',
            borderRadius: '0 0 3px 3px',
            cursor: 'pointer', zIndex: 1,
          }}
        />
      ))}
      {/* Black keys */}
      {Array.from({ length: KEY_COUNT }).map((_, i) => {
        const midi = MIDI_BASE + i
        const semi = midi % 12
        if (!BLACK_SEMIS.has(semi)) return null
        // Find position: count whites to the left
        let whitesBefore = 0
        for (let j = 0; j < i; j++) {
          const s2 = (MIDI_BASE + j) % 12
          if (!BLACK_SEMIS.has(s2)) whitesBefore++
        }
        return (
          <div
            key={midi}
            onMouseDown={e => { e.preventDefault(); startNote(midi) }}
            onMouseUp={()   => stopNote(midi)}
            onMouseLeave={() => stopNote(midi)}
            style={{
              position: 'absolute',
              left: whitesBefore * (KEY_W + 1) - BK_W / 2 + KEY_W / 2,
              top: 0,
              width: BK_W, height: BK_H,
              background: '#1a1a1a', border: '1px solid #000',
              borderRadius: '0 0 3px 3px',
              cursor: 'pointer', zIndex: 2,
            }}
          />
        )
      })}
    </div>
  )
}

// ── Section wrapper ────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 8, padding: '10px 14px',
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 10 }}>
        {title}
      </div>
      {children}
    </div>
  )
}

// ── Main editor ────────────────────────────────────────────────────────────────

export default function WavetableSynthEditor({ patch, onPatchChange, onClose }: WavetableSynthEditorProps) {
  // Cache wavetables so we don't regenerate on every render
  const tableA = useMemo(() => generateWavetable(patch.oscAWavetable), [patch.oscAWavetable])
  const tableB = useMemo(() => generateWavetable(patch.oscBWavetable), [patch.oscBWavetable])

  const wtCanvasRef  = useRef<HTMLCanvasElement>(null)
  const fltCanvasRef = useRef<HTMLCanvasElement>(null)
  const ampEnvRef    = useRef<HTMLCanvasElement>(null)
  const fltEnvRef    = useRef<HTMLCanvasElement>(null)

  const audioCtxRef  = useRef<AudioContext | null>(null)
  const activeNotes  = useRef<Map<number, () => void>>(new Map())

  const [preset, setPreset] = useState<string>('')

  function set<K extends keyof WavetablePatch>(key: K, value: WavetablePatch[K]) {
    onPatchChange({ ...patch, [key]: value })
  }

  // Draw wavetable canvas
  useEffect(() => {
    if (!wtCanvasRef.current) return
    drawWavetable(wtCanvasRef.current, tableA, patch.oscAPosition)
  }, [tableA, patch.oscAPosition])

  // Draw filter response
  useEffect(() => {
    if (!fltCanvasRef.current) return
    drawFilterResponse(fltCanvasRef.current, patch.filterType, patch.filterCutoff, patch.filterResonance)
  }, [patch.filterType, patch.filterCutoff, patch.filterResonance])

  // Draw amplitude envelope
  useEffect(() => {
    if (!ampEnvRef.current) return
    drawADSR(ampEnvRef.current, patch.attack, patch.decay, patch.sustain, patch.release, 'var(--accent)')
  }, [patch.attack, patch.decay, patch.sustain, patch.release])

  // Draw filter envelope
  useEffect(() => {
    if (!fltEnvRef.current) return
    drawADSR(fltEnvRef.current, patch.fAttack, patch.fDecay, patch.fSustain, patch.fRelease, '#34d399')
  }, [patch.fAttack, patch.fDecay, patch.fSustain, patch.fRelease])

  function getCtx(): AudioContext {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext()
    }
    if (audioCtxRef.current.state === 'suspended') {
      void audioCtxRef.current.resume()
    }
    return audioCtxRef.current
  }

  const noteOn = useCallback((midi: number) => {
    const ctx  = getCtx()
    const stop = playWavetableNote(ctx, patch, midi, 0.7, ctx.currentTime)
    activeNotes.current.set(midi, stop)
  }, [patch])  // eslint-disable-line react-hooks/exhaustive-deps

  const noteOff = useCallback((midi: number) => {
    const stop = activeNotes.current.get(midi)
    if (stop) { stop(); activeNotes.current.delete(midi) }
  }, [])

  function applyPreset(name: string) {
    const p = WAVETABLE_PRESETS[name]
    if (p) { onPatchChange(p); setPreset(name) }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const S: React.CSSProperties = { color: 'var(--text-secondary)', fontSize: 11 }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 9999,
      }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        width: 960, maxHeight: '96vh', overflowY: 'auto',
        boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
        padding: 16,
        display: 'flex', flexDirection: 'column', gap: 10,
      }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
          <div>
            <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)', letterSpacing: '0.02em' }}>
              WAVETABLE
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 10 }}>Dual-oscillator wavetable synthesizer</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <select
              value={preset}
              onChange={e => applyPreset(e.target.value)}
              style={{
                background: 'var(--bg-card)', color: 'var(--text-primary)',
                border: '1px solid var(--border)', borderRadius: 6,
                padding: '4px 10px', fontSize: 12, cursor: 'pointer',
              }}
            >
              <option value="">— Preset —</option>
              {Object.keys(WAVETABLE_PRESETS).map(k => <option key={k} value={k}>{k}</option>)}
            </select>
            <button
              onClick={onClose}
              style={{
                background: 'none', border: '1px solid var(--border)',
                borderRadius: 6, color: 'var(--text-secondary)',
                padding: '4px 12px', cursor: 'pointer', fontSize: 13,
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Wavetable canvas */}
        <div style={{
          background: 'var(--bg-base)', borderRadius: 8,
          border: '1px solid var(--border)', overflow: 'hidden', position: 'relative',
        }}>
          <canvas ref={wtCanvasRef} width={928} height={130} style={{ display: 'block', width: '100%', height: 130 }} />
          <div style={{ position: 'absolute', top: 8, left: 12, fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.08em' }}>
            WAVETABLE DISPLAY — OSC A · FRAME {Math.round(patch.oscAPosition * (WAVETABLE_FRAMES - 1))}
          </div>
        </div>

        {/* Oscillators */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Section title="Oscillator A">
            <div style={{ marginBottom: 8 }}>
              <span style={S}>Wavetable&nbsp;</span>
              <select
                value={patch.oscAWavetable}
                onChange={e => set('oscAWavetable', e.target.value as WTType)}
                style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 8px', fontSize: 12 }}
              >
                {WT_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'space-around' }}>
              <Knob label="Position" value={patch.oscAPosition} min={0} max={1} onChange={v => set('oscAPosition', v)} display={v => `${Math.round(v * 63)}`} />
              <Knob label="Detune st" value={patch.oscADetune} min={-24} max={24} step={0.1} onChange={v => set('oscADetune', v)} display={v => v.toFixed(1)} />
              <Knob label="Gain" value={patch.oscAGain} min={0} max={1} onChange={v => set('oscAGain', v)} display={v => `${Math.round(v * 100)}%`} />
            </div>
          </Section>

          <Section title="Oscillator B">
            <div style={{ marginBottom: 8 }}>
              <span style={S}>Wavetable&nbsp;</span>
              <select
                value={patch.oscBWavetable}
                onChange={e => set('oscBWavetable', e.target.value as WTType)}
                style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 8px', fontSize: 12 }}
              >
                {WT_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'space-around' }}>
              <Knob label="Position" value={patch.oscBPosition} min={0} max={1} onChange={v => set('oscBPosition', v)} display={v => `${Math.round(v * 63)}`} />
              <Knob label="Detune st" value={patch.oscBDetune} min={-24} max={24} step={0.1} onChange={v => set('oscBDetune', v)} display={v => v.toFixed(1)} />
              <Knob label="Gain" value={patch.oscBGain} min={0} max={1} onChange={v => set('oscBGain', v)} display={v => `${Math.round(v * 100)}%`} />
            </div>
          </Section>
        </div>

        {/* Filter */}
        <Section title="Filter">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <div style={{ marginBottom: 8 }}>
                <span style={S}>Type&nbsp;</span>
                {(['lowpass', 'highpass', 'bandpass'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => set('filterType', t)}
                    style={{
                      marginRight: 6,
                      padding: '3px 10px', fontSize: 11, borderRadius: 4, cursor: 'pointer',
                      background: patch.filterType === t ? 'var(--accent)' : 'var(--bg-base)',
                      color:      patch.filterType === t ? '#fff' : 'var(--text-secondary)',
                      border:     `1px solid ${patch.filterType === t ? 'var(--accent)' : 'var(--border)'}`,
                    }}
                  >
                    {t.replace('pass', '').toUpperCase()}
                  </button>
                ))}
              </div>
              <HSlider label="Cutoff (Hz)"    value={patch.filterCutoff}    min={20}  max={20000} step={1}    onChange={v => set('filterCutoff', v)}    display={v => `${Math.round(v)}`} />
              <HSlider label="Resonance"       value={patch.filterResonance} min={0}   max={30}    step={0.1}  onChange={v => set('filterResonance', v)} display={v => v.toFixed(1)} />
              <HSlider label="Env Amount"      value={patch.filterEnvAmount} min={-1}  max={1}     step={0.01} onChange={v => set('filterEnvAmount', v)} display={v => v.toFixed(2)} />
            </div>
            <div style={{ background: 'var(--bg-base)', borderRadius: 6, overflow: 'hidden' }}>
              <canvas ref={fltCanvasRef} width={400} height={120} style={{ display: 'block', width: '100%', height: 120 }} />
            </div>
          </div>
        </Section>

        {/* Envelopes */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Section title="Amplitude Envelope">
            <div style={{ background: 'var(--bg-base)', borderRadius: 6, marginBottom: 10, overflow: 'hidden' }}>
              <canvas ref={ampEnvRef} width={400} height={80} style={{ display: 'block', width: '100%', height: 80 }} />
            </div>
            <HSlider label="Attack (s)"  value={patch.attack}  min={0.001} max={5}   step={0.001} onChange={v => set('attack', v)}  display={v => v.toFixed(3)} />
            <HSlider label="Decay (s)"   value={patch.decay}   min={0.001} max={5}   step={0.001} onChange={v => set('decay', v)}   display={v => v.toFixed(3)} />
            <HSlider label="Sustain"     value={patch.sustain} min={0}     max={1}   step={0.01}  onChange={v => set('sustain', v)} display={v => `${Math.round(v * 100)}%`} />
            <HSlider label="Release (s)" value={patch.release} min={0.001} max={10}  step={0.001} onChange={v => set('release', v)} display={v => v.toFixed(3)} />
          </Section>

          <Section title="Filter Envelope">
            <div style={{ background: 'var(--bg-base)', borderRadius: 6, marginBottom: 10, overflow: 'hidden' }}>
              <canvas ref={fltEnvRef} width={400} height={80} style={{ display: 'block', width: '100%', height: 80 }} />
            </div>
            <HSlider label="Attack (s)"  value={patch.fAttack}  min={0.001} max={5}  step={0.001} onChange={v => set('fAttack', v)}  display={v => v.toFixed(3)} />
            <HSlider label="Decay (s)"   value={patch.fDecay}   min={0.001} max={5}  step={0.001} onChange={v => set('fDecay', v)}   display={v => v.toFixed(3)} />
            <HSlider label="Sustain"     value={patch.fSustain} min={0}     max={1}  step={0.01}  onChange={v => set('fSustain', v)} display={v => `${Math.round(v * 100)}%`} />
            <HSlider label="Release (s)" value={patch.fRelease} min={0.001} max={10} step={0.001} onChange={v => set('fRelease', v)} display={v => v.toFixed(3)} />
          </Section>
        </div>

        {/* LFO */}
        <Section title="LFO">
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
            <div>
              <span style={S}>Shape&nbsp;</span>
              {(['sine', 'triangle', 'square', 'sawtooth'] as const).map(s => (
                <button key={s} onClick={() => set('lfoShape', s)}
                  style={{
                    marginRight: 5, padding: '3px 9px', fontSize: 11, borderRadius: 4, cursor: 'pointer',
                    background: patch.lfoShape === s ? 'var(--accent)' : 'var(--bg-base)',
                    color:      patch.lfoShape === s ? '#fff' : 'var(--text-secondary)',
                    border:     `1px solid ${patch.lfoShape === s ? 'var(--accent)' : 'var(--border)'}`,
                  }}
                >
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
            <div>
              <span style={S}>Target&nbsp;</span>
              {(['pitch', 'filter', 'wavetable', 'pan'] as const).map(t => (
                <button key={t} onClick={() => set('lfoTarget', t)}
                  style={{
                    marginRight: 5, padding: '3px 9px', fontSize: 11, borderRadius: 4, cursor: 'pointer',
                    background: patch.lfoTarget === t ? '#34d399' : 'var(--bg-base)',
                    color:      patch.lfoTarget === t ? '#000' : 'var(--text-secondary)',
                    border:     `1px solid ${patch.lfoTarget === t ? '#34d399' : 'var(--border)'}`,
                  }}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 14 }}>
              <Knob label="Rate (Hz)" value={patch.lfoRate}  min={0.1}  max={20} step={0.01} onChange={v => set('lfoRate', v)}  display={v => v.toFixed(2)} />
              <Knob label="Depth"     value={patch.lfoDepth} min={0}    max={1}  step={0.01} onChange={v => set('lfoDepth', v)} display={v => `${Math.round(v * 100)}%`} />
            </div>
          </div>
        </Section>

        {/* Master + keyboard */}
        <Section title="Output">
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 14 }}>
              <Knob label="Master" value={patch.masterGain} min={0} max={1} onChange={v => set('masterGain', v)} display={v => `${Math.round(v * 100)}%`} />
              <Knob label="Voices" value={patch.polyphony}  min={1} max={8} step={1} onChange={v => set('polyphony', Math.round(v))} display={v => String(Math.round(v))} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6, letterSpacing: '0.06em' }}>PREVIEW KEYBOARD</div>
              <MiniKeyboard onNoteOn={noteOn} onNoteOff={noteOff} />
            </div>
          </div>
        </Section>

      </div>
    </div>
  )
}
