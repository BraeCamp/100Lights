'use client'

/**
 * FMSynthEditor — full UI for the 4-operator FM synthesizer engine.
 * Layout inspired by the Yamaha DX7.
 *
 * Sections:
 *   Algorithm selector (visual routing diagram)
 *   4 Operator panels (stacked)
 *   Preset selector + master controls
 *   Mini keyboard
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'

import {
  playFMNote,
  FM_ALGORITHMS,
  FM_PRESETS,
  type FMPatch,
  type FMOperator,
  type FMAlgorithm,
} from '@/lib/fm-synth'

// ── Props ──────────────────────────────────────────────────────────────────────

interface FMSynthEditorProps {
  patch: FMPatch
  onPatchChange: (p: FMPatch) => void
  onClose: () => void
}

// ── Constants ──────────────────────────────────────────────────────────────────

const MIDI_BASE   = 48
const KEY_COUNT   = 25
const BLACK_SEMIS = new Set([1, 3, 6, 8, 10])

const OP_COLORS = ['#f59e0b', '#3b82f6', '#10b981', '#ec4899']

// ── Algorithm diagram canvas ───────────────────────────────────────────────────

const OP_POS: Array<{ x: number; y: number }> = [
  { x: 60,  y: 30  },  // Op 1
  { x: 180, y: 30  },  // Op 2
  { x: 60,  y: 120 },  // Op 3
  { x: 180, y: 120 },  // Op 4
]
const BOX_W = 50, BOX_H = 36

function drawAlgorithm(canvas: HTMLCanvasElement, algorithm: FMAlgorithm) {
  const ctx2d = canvas.getContext('2d')
  if (!ctx2d) return
  const algo = FM_ALGORITHMS[algorithm]
  ctx2d.clearRect(0, 0, canvas.width, canvas.height)

  const W = canvas.width

  // Arrow helper — receives ctx2d explicitly so TypeScript narrowing is preserved
  function arrow(c: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string) {
    c.beginPath()
    c.moveTo(x1, y1); c.lineTo(x2, y2)
    c.strokeStyle = color; c.lineWidth = 1.5
    c.stroke()
    const angle = Math.atan2(y2 - y1, x2 - x1)
    const len   = 7
    c.beginPath()
    c.moveTo(x2, y2)
    c.lineTo(x2 - len * Math.cos(angle - 0.4), y2 - len * Math.sin(angle - 0.4))
    c.lineTo(x2 - len * Math.cos(angle + 0.4), y2 - len * Math.sin(angle + 0.4))
    c.closePath()
    c.fillStyle = color; c.fill()
  }

  // Draw modulator arrows
  for (const { from, to } of algo.modulators) {
    const f = OP_POS[from], t = OP_POS[to]
    const fromX = f.x + BOX_W / 2, fromY = f.y + BOX_H
    const toX   = t.x + BOX_W / 2, toY   = t.y
    if (to === from) {
      ctx2d.beginPath()
      ctx2d.arc(f.x + BOX_W + 10, f.y + BOX_H / 2, 12, -Math.PI * 0.8, Math.PI * 0.8)
      ctx2d.strokeStyle = '#f59e0b88'; ctx2d.lineWidth = 1.5; ctx2d.stroke()
    } else {
      arrow(ctx2d, fromX, fromY, toX, toY, '#ffffff44')
    }
  }

  // Draw carrier outputs
  for (const ci of algo.carriers) {
    const p = OP_POS[ci]
    const cx = p.x + BOX_W / 2
    arrow(ctx2d, cx, p.y + BOX_H, cx, p.y + BOX_H + 28, '#34d399')
    ctx2d.fillStyle = '#34d399'
    ctx2d.font = '10px sans-serif'
    ctx2d.textAlign = 'center'
    ctx2d.fillText('OUT', cx, p.y + BOX_H + 42)
  }

  // Draw operator boxes
  for (let i = 0; i < 4; i++) {
    const p         = OP_POS[i]
    const isCarrier = algo.carriers.includes(i)
    const color     = OP_COLORS[i]

    ctx2d.fillStyle   = isCarrier ? color + '33' : '#1e1e2e'
    ctx2d.strokeStyle = color
    ctx2d.lineWidth   = 1.5
    ctx2d.beginPath()
    ctx2d.roundRect(p.x, p.y, BOX_W, BOX_H, 4)
    ctx2d.fill(); ctx2d.stroke()

    ctx2d.fillStyle     = color
    ctx2d.font          = 'bold 12px sans-serif'
    ctx2d.textAlign     = 'center'
    ctx2d.textBaseline  = 'middle'
    ctx2d.fillText(`OP ${i + 1}`, p.x + BOX_W / 2, p.y + BOX_H / 2)
  }

  ctx2d.fillStyle    = '#ffffff66'
  ctx2d.font         = '10px sans-serif'
  ctx2d.textAlign    = 'left'
  ctx2d.textBaseline = 'alphabetic'
  ctx2d.fillText(`Algo ${algorithm}: ${FM_ALGORITHMS[algorithm].name}`, W - 180, canvas.height - 8)
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
    held.current.add(midi); onNoteOn(midi)
  }
  function stopNote(midi: number) {
    if (!held.current.has(midi)) return
    held.current.delete(midi); onNoteOff(midi)
  }
  const KW = 22, KH = 70, BW = 14, BH = 42
  return (
    <div style={{ position: 'relative', height: KH + 2, userSelect: 'none', flexShrink: 0 }}>
      {whites.map((midi, wi) => (
        <div key={midi}
          onMouseDown={e => { e.preventDefault(); startNote(midi) }}
          onMouseUp={() => stopNote(midi)}
          onMouseLeave={() => stopNote(midi)}
          style={{ position: 'absolute', left: wi * (KW + 1), top: 0, width: KW, height: KH, background: '#e8e8e8', border: '1px solid #888', borderRadius: '0 0 3px 3px', cursor: 'pointer', zIndex: 1 }}
        />
      ))}
      {Array.from({ length: KEY_COUNT }).map((_, i) => {
        const midi = MIDI_BASE + i
        const semi = midi % 12
        if (!BLACK_SEMIS.has(semi)) return null
        let wb = 0
        for (let j = 0; j < i; j++) { if (!BLACK_SEMIS.has((MIDI_BASE + j) % 12)) wb++ }
        return (
          <div key={midi}
            onMouseDown={e => { e.preventDefault(); startNote(midi) }}
            onMouseUp={() => stopNote(midi)}
            onMouseLeave={() => stopNote(midi)}
            style={{ position: 'absolute', left: wb * (KW + 1) - BW / 2 + KW / 2, top: 0, width: BW, height: BH, background: '#1a1a1a', border: '1px solid #000', borderRadius: '0 0 3px 3px', cursor: 'pointer', zIndex: 2 }}
          />
        )
      })}
    </div>
  )
}

// ── ADSR canvas ────────────────────────────────────────────────────────────────

function drawADSR(canvas: HTMLCanvasElement, a: number, d: number, s: number, r: number, color: string) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const W = canvas.width, H = canvas.height
  ctx.clearRect(0, 0, W, H)
  const total = a + d + 0.25 + r
  const ax = (a / total) * W * 0.82 + W * 0.06
  const dx = ax + (d / total) * W * 0.82
  const sx = dx + (0.25 / total) * W * 0.82
  const rx = sx + (r / total) * W * 0.82
  const sy = H - s * (H - 8) - 4
  ctx.beginPath()
  ctx.moveTo(W * 0.06, H - 4)
  ctx.lineTo(ax, 6); ctx.lineTo(dx, sy); ctx.lineTo(sx, sy); ctx.lineTo(rx, H - 4)
  ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.stroke()
  ctx.lineTo(W * 0.06, H - 4); ctx.closePath()
  ctx.fillStyle = color + '28'; ctx.fill()
}

// ── Operator panel ─────────────────────────────────────────────────────────────

interface OperatorPanelProps {
  index:       number
  op:          FMOperator
  isCarrier:   boolean
  onChange:    (op: FMOperator) => void
}

function OperatorPanel({ index, op, isCarrier, onChange }: OperatorPanelProps) {
  const color   = OP_COLORS[index]
  const envRef  = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!envRef.current) return
    drawADSR(envRef.current, op.attack, op.decay, op.sustain, op.release, color)
  }, [op.attack, op.decay, op.sustain, op.release, color])

  function set<K extends keyof FMOperator>(k: K, v: FMOperator[K]) {
    onChange({ ...op, [k]: v })
  }

  const S: React.CSSProperties = { color: 'var(--text-secondary)', fontSize: 10 }
  const rangeStyle: React.CSSProperties = { accentColor: color, cursor: 'pointer', flex: 1 }

  function Row({ label, value, min, max, step = 0.001, disp, onCh }: {
    label: string; value: number; min: number; max: number; step?: number;
    disp?: (v: number) => string; onCh: (v: number) => void
  }) {
    const text = disp ? disp(value) : value.toFixed(2)
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={{ ...S, width: 64, flexShrink: 0 }}>{label}</span>
        <input type="range" min={min} max={max} step={step} value={value}
          onChange={e => onCh(Number(e.target.value))}
          style={rangeStyle}
          aria-label={label}
        />
        <span style={{ fontSize: 10, color, fontVariantNumeric: 'tabular-nums', minWidth: 40, textAlign: 'right' }}>{text}</span>
      </div>
    )
  }

  return (
    <div style={{
      border: `1px solid ${color}44`,
      borderRadius: 8,
      padding: '10px 14px',
      background: `${color}08`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 6,
          background: isCarrier ? color + '33' : 'transparent',
          border: `2px solid ${color}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 700, fontSize: 13, color,
        }}>
          {index + 1}
        </div>
        <div>
          <span style={{ fontSize: 11, fontWeight: 600, color, letterSpacing: '0.06em' }}>
            OPERATOR {index + 1}
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 8 }}>
            {isCarrier ? 'CARRIER' : 'MODULATOR'}
          </span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Left column: frequency + level */}
        <div>
          <Row label="Ratio" value={op.ratio} min={0.25} max={16} step={0.25}
            disp={v => v.toFixed(2)} onCh={v => set('ratio', v)} />
          <Row label="Level" value={op.level} min={0} max={1} step={0.01}
            disp={v => `${Math.round(v * 100)}%`} onCh={v => set('level', v)} />
          <Row label="Detune¢" value={op.detune} min={-100} max={100} step={1}
            disp={v => `${Math.round(v)}`} onCh={v => set('detune', v)} />
          {index === 0 && (
            <Row label="Feedback" value={op.feedback} min={0} max={1} step={0.01}
              disp={v => `${Math.round(v * 100)}%`} onCh={v => set('feedback', v)} />
          )}
        </div>
        {/* Right column: ADSR */}
        <div>
          <canvas ref={envRef} width={240} height={50}
            style={{ display: 'block', width: '100%', height: 50, borderRadius: 4, background: 'var(--bg-base)', marginBottom: 6 }} />
          <Row label="Attack"  value={op.attack}  min={0} max={5} step={0.001}
            disp={v => `${v.toFixed(3)}s`} onCh={v => set('attack', v)} />
          <Row label="Decay"   value={op.decay}   min={0} max={5} step={0.001}
            disp={v => `${v.toFixed(3)}s`} onCh={v => set('decay', v)} />
          <Row label="Sustain" value={op.sustain} min={0} max={1} step={0.01}
            disp={v => `${Math.round(v * 100)}%`} onCh={v => set('sustain', v)} />
          <Row label="Release" value={op.release} min={0} max={5} step={0.001}
            disp={v => `${v.toFixed(3)}s`} onCh={v => set('release', v)} />
        </div>
      </div>
    </div>
  )
}

// ── Main editor ────────────────────────────────────────────────────────────────

export default function FMSynthEditor({ patch, onPatchChange, onClose }: FMSynthEditorProps) {
  const algoCanvasRef = useRef<HTMLCanvasElement>(null)
  const audioCtxRef   = useRef<AudioContext | null>(null)
  const activeNotes   = useRef<Map<number, () => void>>(new Map())
  const [preset, setPreset] = useState<string>('')

  useEffect(() => {
    if (!algoCanvasRef.current) return
    drawAlgorithm(algoCanvasRef.current, patch.algorithm)
  }, [patch.algorithm])

  function set<K extends keyof FMPatch>(key: K, value: FMPatch[K]) {
    onPatchChange({ ...patch, [key]: value })
  }

  function setOp(index: number, op: FMOperator) {
    const ops = [...patch.operators] as FMPatch['operators']
    ops[index] = op
    onPatchChange({ ...patch, operators: ops })
  }

  function cycleAlgorithm() {
    const next = ((patch.algorithm % 8) + 1) as FMAlgorithm
    set('algorithm', next)
  }

  function getCtx(): AudioContext {
    if (!audioCtxRef.current) audioCtxRef.current = new AudioContext()
    if (audioCtxRef.current.state === 'suspended') void audioCtxRef.current.resume()
    return audioCtxRef.current
  }

  const noteOn = useCallback((midi: number) => {
    const ctx  = getCtx()
    const stop = playFMNote(ctx, patch, midi, 0.7, ctx.currentTime)
    activeNotes.current.set(midi, stop)
  }, [patch])  // eslint-disable-line react-hooks/exhaustive-deps

  const noteOff = useCallback((midi: number) => {
    const stop = activeNotes.current.get(midi)
    if (stop) { stop(); activeNotes.current.delete(midi) }
  }, [])

  function applyPreset(name: string) {
    const p = FM_PRESETS[name]
    if (p) { onPatchChange(p); setPreset(name) }
  }

  const algo = FM_ALGORITHMS[patch.algorithm]

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
        display: 'flex', flexDirection: 'column', gap: 12,
      }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)', letterSpacing: '0.02em' }}>
              FM SYNTHESIZER
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 10 }}>4-operator FM — DX7 inspired</span>
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
              {Object.keys(FM_PRESETS).map(k => <option key={k} value={k}>{k}</option>)}
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

        {/* Algorithm selector */}
        <div style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 8, padding: '10px 14px',
          display: 'flex', alignItems: 'flex-start', gap: 24,
        }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
              Algorithm
            </div>
            {/* Number buttons */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
              {([1, 2, 3, 4, 5, 6, 7, 8] as FMAlgorithm[]).map(n => (
                <button
                  key={n}
                  onClick={() => set('algorithm', n)}
                  style={{
                    width: 34, height: 34, borderRadius: 6, cursor: 'pointer',
                    fontWeight: 700, fontSize: 13,
                    background: patch.algorithm === n ? 'var(--accent)' : 'var(--bg-base)',
                    color:      patch.algorithm === n ? '#fff' : 'var(--text-secondary)',
                    border:     `1px solid ${patch.algorithm === n ? 'var(--accent)' : 'var(--border)'}`,
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
            <button
              onClick={cycleAlgorithm}
              style={{
                padding: '5px 16px', fontSize: 11, borderRadius: 6, cursor: 'pointer',
                background: 'var(--bg-base)', color: 'var(--text-secondary)',
                border: '1px solid var(--border)',
              }}
            >
              Next Algorithm →
            </button>
          </div>

          {/* Routing diagram */}
          <div style={{ background: 'var(--bg-base)', borderRadius: 8, flex: 1, overflow: 'hidden', position: 'relative' }}>
            <canvas
              ref={algoCanvasRef}
              width={600} height={200}
              style={{ display: 'block', width: '100%', height: 200 }}
            />
            {/* Carrier legend */}
            <div style={{ position: 'absolute', top: 8, right: 12, fontSize: 10, color: 'var(--text-muted)' }}>
              Carriers: {algo.carriers.map(c => `Op ${c + 1}`).join(', ')}
            </div>
          </div>

          {/* Master controls */}
          <div style={{ minWidth: 120 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 10 }}>
              Master
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                Gain
                <input type="range" min={0} max={1} step={0.01} value={patch.masterGain}
                  onChange={e => set('masterGain', Number(e.target.value))}
                  style={{ display: 'block', width: '100%', accentColor: 'var(--accent)', marginTop: 4 }}
                  aria-label="Master gain"
                />
                <span style={{ fontSize: 10, color: 'var(--accent)' }}>{Math.round(patch.masterGain * 100)}%</span>
              </label>
              <label style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                Pitch EG
                <input type="range" min={0} max={5} step={0.01} value={patch.pitchEgRate}
                  onChange={e => set('pitchEgRate', Number(e.target.value))}
                  style={{ display: 'block', width: '100%', accentColor: 'var(--accent)', marginTop: 4 }}
                  aria-label="Pitch EG rate"
                />
                <span style={{ fontSize: 10, color: 'var(--accent)' }}>{patch.pitchEgRate.toFixed(2)}</span>
              </label>
            </div>
          </div>
        </div>

        {/* Operator panels */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {patch.operators.map((op, i) => (
            <OperatorPanel
              key={i}
              index={i}
              op={op}
              isCarrier={algo.carriers.includes(i)}
              onChange={newOp => setOp(i, newOp)}
            />
          ))}
        </div>

        {/* Keyboard */}
        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 8, padding: '10px 14px',
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
            Preview Keyboard
          </div>
          <MiniKeyboard onNoteOn={noteOn} onNoteOff={noteOff} />
        </div>

      </div>
    </div>
  )
}
