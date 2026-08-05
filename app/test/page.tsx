'use client'

import { useEffect, useRef, useState } from 'react'
import type { IconType } from 'react-icons'
import { LuPlay, LuPause, LuSquare, LuCircle, LuRepeat, LuRewind, LuGauge, LuFilter, LuSlidersHorizontal, LuAudioWaveform, LuDices, LuShare2 } from 'react-icons/lu'
import { FiPlay, FiPause, FiSquare, FiCircle, FiRepeat, FiRewind, FiActivity, FiFilter, FiSliders, FiShuffle, FiShare2 } from 'react-icons/fi'
import { PiPlay, PiPause, PiStop, PiRecord, PiRepeat, PiRewind, PiMetronome, PiGauge, PiFunnel, PiSlidersHorizontal, PiWaveform, PiDiceFive, PiShareNetwork } from 'react-icons/pi'
import { TbPlayerPlay, TbPlayerPause, TbPlayerStop, TbPlayerRecord, TbRepeat, TbPlayerTrackPrev, TbMetronome, TbGauge, TbFilter, TbAdjustmentsHorizontal, TbWaveSine, TbDice5, TbShare } from 'react-icons/tb'

// ── /test — private sound-settings prototype sandbox ─────────────────────────
// Phase 1 of the sound-settings rebuild: HEAR the difference between dry and
// wet, and feel a live wetness control. Self-contained Web Audio (a plucked
// synth riff → effect) so we can iterate on the wet/dry idea before it touches
// the real editor. Gated by an admin code (server-checked, TEST_ACCESS_CODE).

export default function TestPage() {
  const [unlocked, setUnlocked] = useState(false)
  const [code, setCode] = useState('')
  const [err, setErr] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (sessionStorage.getItem('test_ok') === '1') setUnlocked(true) }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setErr(false)
    try {
      const r = await fetch('/api/test-access', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })
      if (r.ok) { sessionStorage.setItem('test_ok', '1'); setUnlocked(true) }
      else setErr(true)
    } catch { setErr(true) }
    setBusy(false)
  }

  if (!unlocked) {
    return (
      <div style={{ display: 'flex', minHeight: '100dvh', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <form onSubmit={submit} style={{ width: 300, display: 'grid', gap: 12, padding: 24, borderRadius: 14, background: 'var(--bg-surface, #14141c)', border: '1px solid var(--border, #2a2a3a)' }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>Sound Lab</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted, #8b88a8)' }}>Enter the admin code to continue.</div>
          <input
            value={code} onChange={e => setCode(e.target.value)} type="password" autoFocus placeholder="Access code"
            style={{ padding: '9px 11px', borderRadius: 8, border: `1px solid ${err ? '#ef4444' : 'var(--border, #2a2a3a)'}`, background: 'var(--bg-base, #0a0a0f)', color: 'inherit', fontSize: 13, outline: 'none' }}
          />
          {err && <div style={{ fontSize: 11.5, color: '#ef4444' }}>Incorrect code.</div>}
          <button type="submit" disabled={busy || !code} style={{ padding: '9px 0', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'var(--accent, #a78bfa)', color: 'var(--accent-contrast, #0a0812)', fontWeight: 700, fontSize: 13, opacity: busy ? 0.6 : 1 }}>
            {busy ? 'Checking…' : 'Enter'}
          </button>
        </form>
      </div>
    )
  }

  return <Sandbox />
}

// ── Scrollable multi-section sandbox ─────────────────────────────────────────
// Each experiment gets its own section; the sticky nav jumps between them.
function Sandbox() {
  return (
    <div>
      <nav style={{ position: 'sticky', top: 0, zIndex: 10, display: 'flex', gap: 8, padding: '10px 16px', background: 'rgba(10,10,15,0.85)', backdropFilter: 'blur(8px)', borderBottom: '1px solid var(--border, #2a2a3a)' }}>
        <strong style={{ fontSize: 13, marginRight: 8 }}>Sound Lab</strong>
        <a href="#sound" style={navLink}>Wet / Dry</a>
        <a href="#symbols" style={navLink}>Symbols</a>
      </nav>
      <section id="sound" style={{ scrollMarginTop: 56 }}><SoundLab /></section>
      <section id="symbols" style={{ scrollMarginTop: 56 }}><SymbolPacks /></section>
    </div>
  )
}
const navLink: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: 'var(--accent-light, #c4b5fd)', textDecoration: 'none', padding: '4px 8px', borderRadius: 6, background: 'var(--bg-card, #1a1a24)' }

// ── Wet/dry sound lab ────────────────────────────────────────────────────────

type FxType = 'reverb' | 'delay' | 'lowpass' | 'distortion'
const FX: { id: FxType; name: string; kind: 'parallel' | 'insert'; blurb: string }[] = [
  { id: 'reverb',     name: 'Reverb',     kind: 'parallel', blurb: 'A copy is sent to a decaying space, mixed back — classic send/wet.' },
  { id: 'delay',      name: 'Delay',      kind: 'parallel', blurb: 'A copy echoes back on a timer, mixed with the dry — classic send/wet.' },
  { id: 'lowpass',    name: 'Low-pass',   kind: 'insert',   blurb: 'An insert: 100% wet removes highs. Wetness blends filtered vs original.' },
  { id: 'distortion', name: 'Distortion', kind: 'insert',   blurb: 'An insert: 100% wet is fully crushed. Wetness blends dirty vs clean.' },
]

function SoundLab() {
  const [playing, setPlaying] = useState(false)
  const [fx, setFx] = useState<FxType>('reverb')
  const [wet, setWet] = useState(0.4)
  const [mode, setMode] = useState<'mix' | 'dry' | 'solo'>('mix')

  const ctxRef = useRef<AudioContext | null>(null)
  const dryRef = useRef<GainNode | null>(null)
  const wetRef = useRef<GainNode | null>(null)
  const fxInRef = useRef<GainNode | null>(null)
  const fxNodesRef = useRef<AudioNode[]>([])
  const stopSrcRef = useRef<(() => void) | null>(null)

  // Build the persistent graph:  source → dry → out ; source → fxIn → [fx] → wet → out
  function ensureGraph() {
    if (ctxRef.current) return ctxRef.current
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new AC()
    const master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination)
    const dry = ctx.createGain(); dry.connect(master)
    const wetG = ctx.createGain(); wetG.connect(master)
    const fxIn = ctx.createGain(); fxIn.connect(dry) // dry tap is pre-effect (a copy)
    ctxRef.current = ctx; dryRef.current = dry; wetRef.current = wetG; fxInRef.current = fxIn
    buildFx(ctx, fx)
    applyGains()
    return ctx
  }

  // (Re)build the effect chain between fxIn and the wet gain.
  function buildFx(ctx: AudioContext, type: FxType) {
    for (const n of fxNodesRef.current) { try { n.disconnect() } catch { /* ok */ } }
    fxNodesRef.current = []
    const fxIn = fxInRef.current!, wetG = wetRef.current!
    if (type === 'reverb') {
      const conv = ctx.createConvolver(); conv.buffer = impulse(ctx, 2.4, 2.5)
      fxIn.connect(conv); conv.connect(wetG); fxNodesRef.current = [conv]
    } else if (type === 'delay') {
      const d = ctx.createDelay(1); d.delayTime.value = 0.28
      const fb = ctx.createGain(); fb.gain.value = 0.42
      fxIn.connect(d); d.connect(fb); fb.connect(d); d.connect(wetG); fxNodesRef.current = [d, fb]
    } else if (type === 'lowpass') {
      const bq = ctx.createBiquadFilter(); bq.type = 'lowpass'; bq.frequency.value = 420; bq.Q.value = 6
      fxIn.connect(bq); bq.connect(wetG); fxNodesRef.current = [bq]
    } else {
      const ws = ctx.createWaveShaper(); ws.curve = distortionCurve(420) as unknown as Float32Array<ArrayBuffer>; ws.oversample = '4x'
      const trim = ctx.createGain(); trim.gain.value = 0.5
      fxIn.connect(ws); ws.connect(trim); trim.connect(wetG); fxNodesRef.current = [ws, trim]
    }
  }

  // Dry/wet levels from the current mode + wetness.
  function applyGains() {
    const dry = dryRef.current, wetG = wetRef.current
    if (!dry || !wetG) return
    const t = ctxRef.current!.currentTime
    const [d, w] = mode === 'dry' ? [1, 0] : mode === 'solo' ? [0, 1] : [1 - wet, wet]
    dry.gain.setTargetAtTime(d, t, 0.01)
    wetG.gain.setTargetAtTime(w, t, 0.01)
  }

  useEffect(() => { if (ctxRef.current) applyGains() }, [wet, mode]) // eslint-disable-line
  useEffect(() => { if (ctxRef.current) { buildFx(ctxRef.current, fx); applyGains() } }, [fx]) // eslint-disable-line
  useEffect(() => () => { stopSrcRef.current?.(); ctxRef.current?.close?.().catch(() => {}) }, [])

  function toggle() {
    const ctx = ensureGraph()
    ctx.resume?.()
    if (playing) { stopSrcRef.current?.(); stopSrcRef.current = null; setPlaying(false) }
    else { stopSrcRef.current = runRiff(ctx, fxInRef.current!); setPlaying(true) }
  }

  const chosen = FX.find(f => f.id === fx)!

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '40px 20px 80px' }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--accent, #a78bfa)' }}>Sound Lab · Phase 1</div>
      <h1 style={{ fontSize: 24, fontWeight: 800, margin: '6px 0 4px' }}>Hear wet vs dry</h1>
      <p style={{ fontSize: 13, color: 'var(--text-muted, #a3a2b5)', lineHeight: 1.5, margin: '0 0 24px' }}>
        Play the loop, then flip <b>A/B</b> to hear it with the effect (wet) vs without (dry), or <b>Solo wet</b> to hear only what the effect adds. Drag <b>Wetness</b> to blend.
      </p>

      <button onClick={toggle} style={{ ...pill, background: playing ? 'var(--accent, #a78bfa)' : 'var(--bg-card, #1a1a24)', color: playing ? 'var(--accent-contrast, #0a0812)' : 'inherit', width: 120, fontSize: 14, fontWeight: 700 }}>
        {playing ? '■ Stop' : '▶ Play'}
      </button>

      <div style={{ display: 'grid', gap: 8, margin: '24px 0 8px' }}>
        <label style={lbl}>Effect</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {FX.map(f => (
            <button key={f.id} onClick={() => setFx(f.id)} style={{ ...pill, flex: '1 1 auto', background: fx === f.id ? 'var(--accent-subtle, rgba(167,139,250,0.16))' : 'var(--bg-card, #1a1a24)', border: `1px solid ${fx === f.id ? 'var(--accent, #a78bfa)' : 'var(--border, #2a2a3a)'}`, color: fx === f.id ? 'var(--accent-light, #c4b5fd)' : 'var(--text-secondary, #b5b3c6)' }}>
              {f.name}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-muted, #8b88a8)' }}>
          <b style={{ color: chosen.kind === 'insert' ? '#f59e0b' : '#34d399' }}>{chosen.kind === 'insert' ? 'INSERT' : 'PARALLEL / SEND'}</b> — {chosen.blurb}
        </div>
      </div>

      <div style={{ display: 'grid', gap: 10, margin: '20px 0', padding: 16, borderRadius: 12, background: 'var(--bg-surface, #14141c)', border: '1px solid var(--border, #2a2a3a)' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setMode(m => (m === 'dry' ? 'mix' : 'dry'))} style={{ ...pill, flex: 1, background: mode === 'dry' ? '#334155' : 'var(--bg-card, #1a1a24)', color: mode === 'dry' ? '#fff' : 'inherit' }}>
            {mode === 'dry' ? 'A · DRY (effect off)' : 'A/B · flip to dry'}
          </button>
          <button onClick={() => setMode(m => (m === 'solo' ? 'mix' : 'solo'))} style={{ ...pill, flex: 1, background: mode === 'solo' ? 'var(--accent, #a78bfa)' : 'var(--bg-card, #1a1a24)', color: mode === 'solo' ? 'var(--accent-contrast, #0a0812)' : 'inherit' }}>
            {mode === 'solo' ? 'SOLO WET (on)' : 'Solo wet'}
          </button>
        </div>
        <label style={{ ...lbl, opacity: mode === 'mix' ? 1 : 0.4 }}>Wetness — {Math.round(wet * 100)}%</label>
        <input type="range" min={0} max={1} step={0.01} value={wet} disabled={mode !== 'mix'}
          onChange={e => setWet(Number(e.target.value))}
          style={{ width: '100%', accentColor: 'var(--accent, #a78bfa)', opacity: mode === 'mix' ? 1 : 0.4 }} />
      </div>

      <p style={{ fontSize: 11.5, color: 'var(--text-muted, #8b88a8)', lineHeight: 1.6 }}>
        Note how <b>parallel</b> effects (reverb/delay) sound like an added layer over the dry signal, while <b>insert</b> effects (low-pass/distortion) transform the signal itself — the difference between a send and an insert, and the reason wetness means slightly different things for each. This is the sandbox for the sound-settings rebuild.
      </p>
    </div>
  )
}

// ── Symbol packs previewer ───────────────────────────────────────────────────
type SymRow = { label: string; note?: boolean; icons: (IconType | null)[] }
const SYM_PACKS = ['Lucide', 'Feather', 'Phosphor', 'Tabler']
const SYM_ROWS: SymRow[] = [
  { label: 'Play',         icons: [LuPlay, FiPlay, PiPlay, TbPlayerPlay] },
  { label: 'Pause',        icons: [LuPause, FiPause, PiPause, TbPlayerPause] },
  { label: 'Stop',         icons: [LuSquare, FiSquare, PiStop, TbPlayerStop] },
  { label: 'Record',       icons: [LuCircle, FiCircle, PiRecord, TbPlayerRecord] },
  { label: 'Loop',         icons: [LuRepeat, FiRepeat, PiRepeat, TbRepeat] },
  { label: 'Rewind',       icons: [LuRewind, FiRewind, PiRewind, TbPlayerTrackPrev] },
  { label: 'Metronome',    note: true, icons: [null, null, PiMetronome, TbMetronome] },
  { label: 'Tuner (gauge)', note: true, icons: [LuGauge, FiActivity, PiGauge, TbGauge] },
  { label: 'Filter',       icons: [LuFilter, FiFilter, PiFunnel, TbFilter] },
  { label: 'FX / sliders', icons: [LuSlidersHorizontal, FiSliders, PiSlidersHorizontal, TbAdjustmentsHorizontal] },
  { label: 'EQ / wave',    icons: [LuAudioWaveform, FiActivity, PiWaveform, TbWaveSine] },
  { label: 'Randomize',    icons: [LuDices, FiShuffle, PiDiceFive, TbDice5] },
  { label: 'Share',        icons: [LuShare2, FiShare2, PiShareNetwork, TbShare] },
]

function SymbolPacks() {
  const [size, setSize] = useState(24)
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 20px 100px' }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--accent, #a78bfa)' }}>Sound Lab · Symbols</div>
      <h1 style={{ fontSize: 24, fontWeight: 800, margin: '6px 0 4px' }}>2D monochrome icon packs</h1>
      <p style={{ fontSize: 13, color: 'var(--text-muted, #a3a2b5)', lineHeight: 1.5, margin: '0 0 16px' }}>
        The editor&apos;s symbols across four flat/monochrome packs (Lucide is what we use today). Tell me which pack reads best. Note the two <b style={{ color: '#f59e0b' }}>highlighted</b> rows: Phosphor and Tabler have a real, distinct <b>metronome</b> and a separate <b>gauge/needle</b> for the tuner — which fixes those two looking alike.
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
        <span style={lbl}>Size</span>
        <input type="range" min={16} max={40} value={size} onChange={e => setSize(Number(e.target.value))} style={{ accentColor: 'var(--accent, #a78bfa)' }} />
        <span style={{ fontSize: 11, color: 'var(--text-muted, #8b88a8)' }}>{size}px</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 460 }}>
          <thead>
            <tr>
              <th style={{ ...symTh, textAlign: 'left' }}>Concept</th>
              {SYM_PACKS.map(p => <th key={p} style={symTh}>{p}</th>)}
            </tr>
          </thead>
          <tbody>
            {SYM_ROWS.map(row => (
              <tr key={row.label} style={{ background: row.note ? 'rgba(245,158,11,0.09)' : undefined }}>
                <td style={{ ...symTd, textAlign: 'left', fontWeight: 600 }}>{row.label}</td>
                {row.icons.map((Icon, i) => (
                  <td key={i} style={symTd}>{Icon ? <Icon size={size} /> : <span style={{ color: 'var(--text-muted, #8b88a8)', opacity: 0.4 }}>—</span>}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
const symTh: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: 'var(--text-muted, #8b88a8)', padding: '8px 6px', textAlign: 'center', borderBottom: '1px solid var(--border, #2a2a3a)' }
const symTd: React.CSSProperties = { padding: '12px 6px', textAlign: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)', color: 'var(--text-primary, #f1f0ff)' }

const pill: React.CSSProperties = { padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border, #2a2a3a)', cursor: 'pointer', fontSize: 12.5, fontWeight: 600 }
const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted, #8b88a8)' }

// ── Audio helpers ────────────────────────────────────────────────────────────

// A repeating plucked riff (sawtooth + fast decay) — transients so reverb tails
// and echoes are audible, sustained enough to hear filtering/distortion.
function runRiff(ctx: AudioContext, dest: AudioNode): () => void {
  const notes = [220, 261.63, 329.63, 261.63, 246.94, 329.63, 392, 293.66]
  let next = ctx.currentTime + 0.15
  let i = 0
  const step = 0.34
  const timer = setInterval(() => {
    while (next < ctx.currentTime + 0.4) {
      pluck(ctx, dest, notes[i % notes.length], next)
      if (i % 2 === 0) pluck(ctx, dest, notes[i % notes.length] / 2, next) // a little bass
      next += step; i++
    }
  }, 60)
  return () => clearInterval(timer)
}

function pluck(ctx: AudioContext, dest: AudioNode, freq: number, t: number) {
  const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = freq
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(0.28, t + 0.006)
  g.gain.exponentialRampToValueAtTime(0.0008, t + 0.32)
  osc.connect(g); g.connect(dest)
  osc.start(t); osc.stop(t + 0.36)
  osc.onended = () => { try { osc.disconnect(); g.disconnect() } catch { /* ok */ } }
}

function impulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const rate = ctx.sampleRate, len = Math.floor(rate * seconds)
  const buf = ctx.createBuffer(2, len, rate)
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay)
  }
  return buf
}

function distortionCurve(amount: number): Float32Array {
  const n = 44100, curve = new Float32Array(n), k = amount
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1
    curve[i] = ((3 + k) * x * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(x))
  }
  return curve
}
