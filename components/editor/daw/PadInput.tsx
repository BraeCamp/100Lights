'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useDaw, makeAudioClip, makeMidiClip } from '@/lib/daw-state'
import { defaultReverb, defaultDelay, defaultFilter, defaultEq3, defaultCompressor, type EffectType } from '@/lib/daw-types'
import { playInstrumentNote } from '@/lib/daw-instruments'
import { libraryGetAll } from '@/lib/sound-library'
import type { LibraryEntry } from '@/lib/sound-library'
import { libraryFulfill } from '@/lib/default-samples'
import dynamic from 'next/dynamic'
import { getPadPresets, savePadPreset, deletePadPreset, type PadPreset } from '@/lib/pad-presets'
import { startWebMidi, onMidiNote, onMidiDevices, webMidiSupported } from '@/lib/web-midi'
import type { MidiClip, MidiNote } from '@/lib/daw-types'
import { isMidiClip } from '@/lib/daw-types'

const PadVoice = dynamic(() => import('./PadVoice'), { ssr: false })

// ── Capture MIDI — rolling note memory (like the JAM buffer, but for notes) ────
// Every note played while the transport runs is remembered here, recording or
// not, so a great unrecorded take can be pulled into a clip after the fact.
const CAPTURE_WINDOW_SEC = 30
interface CapturedNote { pitch: number; velocity: number; startBeat: number; endBeat: number; wallEnd: number }
const _midiCapture: CapturedNote[] = []
function pruneCapture() {
  const cutoff = Date.now() - CAPTURE_WINDOW_SEC * 1000
  while (_midiCapture.length && _midiCapture[0].wallEnd < cutoff) _midiCapture.shift()
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface PadSound {
  id: string
  name: string
  volume?: number   // 0–2, default 1
  pitch?: number    // semitones ±24, default 0 (changes playback speed)
}

interface Pad {
  id: string
  pitch: number
  drumLabel: string
  key: string
  customSounds?: PadSound[]    // all assigned sounds (empty/undefined = instrument default)
  sampleSustain?: number       // release seconds after key-up (default 0)
  sampleLoop?: boolean         // loop while key held
  sampleReverse?: boolean      // play reversed
  sampleVibratoDepth?: number  // 0–1, LFO depth on playbackRate (default 0 = off)
  sampleVibratoRate?: number   // LFO frequency in Hz (default 5)
  sampleTrimStart?: number     // 0–1 fraction of buffer (default 0)
  sampleTrimEnd?: number       // 0–1 fraction of buffer (default 1)
  mode?: 'sample' | 'effect-toggle'
  effectTarget?: { trackId: string; effectId: string }
}

interface ActiveSource {
  src: AudioBufferSourceNode
  gain: GainNode
  lfo?: OscillatorNode
  lfoGain?: GainNode
}

// ── Constants ──────────────────────────────────────────────────────────────────

const DEFAULT_PADS: Pad[] = [
  { id: 'p1', pitch: 36, drumLabel: 'Pad 1', key: 'a' },
  { id: 'p2', pitch: 38, drumLabel: 'Pad 2', key: 's' },
  { id: 'p3', pitch: 42, drumLabel: 'Pad 3', key: 'd' },
  { id: 'p4', pitch: 46, drumLabel: 'Pad 4', key: 'f' },
  { id: 'p5', pitch: 39, drumLabel: 'Pad 5', key: 'z' },
  { id: 'p6', pitch: 51, drumLabel: 'Pad 6', key: 'x' },
  { id: 'p7', pitch: 49, drumLabel: 'Pad 7', key: 'c' },
  { id: 'p8', pitch: 45, drumLabel: 'Pad 8', key: 'v' },
]

function buildPianoKeyMap(baseOctave: number): Record<string, number> {
  const b = (baseOctave + 1) * 12
  return {
    z: b,    s: b+1,  x: b+2,  d: b+3,  c: b+4,
    v: b+5,  g: b+6,  b: b+7,  h: b+8,  n: b+9,
    j: b+10, m: b+11,
    q: b+12, 2: b+13, w: b+14, 3: b+15, e: b+16,
    r: b+17, 5: b+18, t: b+19, 6: b+20, y: b+21,
    7: b+22, u: b+23,
  }
}

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
function pitchToName(p: number) { return `${NOTE_NAMES[p % 12]}${Math.floor(p / 12) - 1}` }

const WHITE_ST  = [0, 2, 4, 5, 7, 9, 11]
const BLACK_KEYS = [
  { st: 1, pos: 0.65 }, { st: 3, pos: 1.65 },
  { st: 6, pos: 3.65 }, { st: 8, pos: 4.65 }, { st: 10, pos: 5.65 },
]

const C = {
  bg:     '#1c1c1c',
  bgCard: '#252525',
  bgDark: '#151515',
  border: '#333333',
  accent: '#3d8fef',
  red:    '#ef4444',
  green:  '#22c55e',
  yellow: '#eab308',
  text:   '#e8e8e8',
  muted:  '#7c7c7c',
} as const

// ── Step Sequencer constants ────────────────────────────────────────────────────

type StepRate = '1/4' | '1/8' | '1/16' | '1/32'
const STEP_RATES: StepRate[]               = ['1/32', '1/16', '1/8', '1/4']
const RATE_BEATS: Record<StepRate, number> = { '1/4': 1, '1/8': 0.5, '1/16': 0.25, '1/32': 0.125 }
const STEP_COUNT = 16

function reverseBuffer(ctx: AudioContext, buf: AudioBuffer): AudioBuffer {
  const rev = ctx.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate)
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const s = buf.getChannelData(c), d = rev.getChannelData(c)
    for (let i = 0; i < s.length; i++) d[i] = s[s.length - 1 - i]
  }
  return rev
}

// ── Slider component ──────────────────────────────────────────────────────────

function PopSlider({ label, value, min, max, step, format, onChange, accent }: {
  label: string; value: number; min: number; max: number; step: number
  format: (v: number) => string; onChange: (v: number) => void; accent?: string
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
        <span style={{ fontSize: 10, color: accent || C.text, fontFamily: 'monospace' }}>{format(value)}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        onMouseDown={e => e.stopPropagation()}
        onClick={e => e.stopPropagation()}
        style={{ width: '100%', accentColor: accent || C.accent, cursor: 'pointer', display: 'block' }}
      />
    </div>
  )
}

// ── Step cell right-click popover ─────────────────────────────────────────────

function StepCellPopover({
  probability, ratchet, onProbChange, onRatchetChange, onClose, x, y,
}: {
  probability: number
  ratchet: 1|2|4
  onProbChange: (v: number) => void
  onRatchetChange: (v: 1|2|4) => void
  onClose: () => void
  x: number
  y: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [onClose])

  const left = Math.min(x, (typeof window !== 'undefined' ? window.innerWidth  : 800) - 190)
  const top  = Math.min(y, (typeof window !== 'undefined' ? window.innerHeight : 800) - 160)

  return createPortal(
    <div
      ref={ref}
      onMouseDown={e => e.stopPropagation()}
      style={{
        position: 'fixed', left, top, width: 180, zIndex: 3100,
        background: C.bgCard, border: `1px solid ${C.border}`,
        borderRadius: 6, boxShadow: '0 6px 24px rgba(0,0,0,0.85)',
        padding: '10px 12px',
      }}
    >
      <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 9 }}>
        Step Properties
      </div>

      {/* Probability */}
      <PopSlider
        label="Probability"
        value={probability}
        min={0} max={100} step={1}
        format={v => `${v}%`}
        onChange={onProbChange}
      />

      {/* Ratchet */}
      <div>
        <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>Ratchet</div>
        <div style={{ display: 'flex', gap: 4 }}>
          {([1, 2, 4] as const).map(r => (
            <button
              key={r}
              onClick={() => onRatchetChange(r)}
              style={{
                flex: 1, padding: '4px 0', borderRadius: 4, cursor: 'pointer', fontSize: 11,
                fontWeight: ratchet === r ? 700 : 400,
                border: `1px solid ${ratchet === r ? C.accent : C.border}`,
                background: ratchet === r ? `${C.accent}22` : 'transparent',
                color: ratchet === r ? C.accent : C.muted,
              }}
            >{r}×</button>
          ))}
        </div>
      </div>
    </div>,
    document.body
  )
}

// ── Waveform crop widget ──────────────────────────────────────────────────────

function PadWaveformCrop({ blob, trimStart, trimEnd, onTrimChange }: {
  blob: Blob
  trimStart: number
  trimEnd: number
  onTrimChange: (start: number, end: number) => void
}) {
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const bufRef     = useRef<AudioBuffer | null>(null)
  const dragging   = useRef<'start' | 'end' | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let closed = false
    const ctx = new AudioContext()
    blob.arrayBuffer()
      .then(ab => ctx.decodeAudioData(ab))
      .then(buf => { if (!closed) { bufRef.current = buf; setReady(true) } })
      .catch(() => {})
      .finally(() => { ctx.close().catch(() => {}) })
    return () => { closed = true }
  }, [blob])

  useEffect(() => {
    const canvas = canvasRef.current
    const buf    = bufRef.current
    if (!canvas || !buf || !ready) return
    const ctx = canvas.getContext('2d')!
    const W = canvas.width, H = canvas.height
    const data = buf.getChannelData(0)
    ctx.clearRect(0, 0, W, H)
    const spb = Math.max(1, Math.floor(data.length / W))
    for (let x = 0; x < W; x++) {
      let peak = 0
      for (let j = 0; j < spb; j++) peak = Math.max(peak, Math.abs(data[x * spb + j] ?? 0))
      const bh = Math.max(1, peak * (H - 4) * 0.9)
      ctx.fillStyle = x >= trimStart * W && x <= trimEnd * W ? '#3d8fef' : 'rgba(61,143,239,0.18)'
      ctx.fillRect(x, (H - bh) / 2, 1, bh)
    }
    ctx.fillStyle = 'rgba(0,0,0,0.48)'
    ctx.fillRect(0, 0, trimStart * W, H)
    ctx.fillRect(trimEnd * W, 0, W - trimEnd * W, H)
    const drawHandle = (x: number) => {
      ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke()
      ctx.fillStyle = '#f59e0b'
      ctx.beginPath(); ctx.moveTo(x - 4, 0); ctx.lineTo(x + 4, 0); ctx.lineTo(x, 8); ctx.closePath(); ctx.fill()
    }
    drawHandle(trimStart * W); drawHandle(trimEnd * W)
  }, [ready, trimStart, trimEnd])

  function ratio(e: React.MouseEvent<HTMLCanvasElement>) {
    const r = canvasRef.current!.getBoundingClientRect()
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
  }

  const dur = bufRef.current?.duration ?? 0

  return (
    <div style={{ marginBottom: 10 }}>
      {!ready ? (
        <div style={{ height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#444', background: '#0a0a0f', borderRadius: 4 }}>Loading…</div>
      ) : (
        <canvas
          ref={canvasRef} width={220} height={44}
          style={{ width: '100%', height: 44, display: 'block', borderRadius: 4, cursor: 'ew-resize', background: '#0a0a0f' }}
          onMouseDown={e => {
            e.stopPropagation()
            const r = ratio(e)
            dragging.current = Math.abs(r - trimStart) < Math.abs(r - trimEnd) ? 'start' : 'end'
          }}
          onMouseMove={e => {
            if (!dragging.current) return
            const r = ratio(e)
            if (dragging.current === 'start') onTrimChange(Math.min(r, trimEnd - 0.02), trimEnd)
            else                              onTrimChange(trimStart, Math.max(r, trimStart + 0.02))
          }}
          onMouseUp={() => { dragging.current = null }}
          onMouseLeave={() => { dragging.current = null }}
        />
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3, fontSize: 9, color: '#555', fontFamily: 'monospace' }}>
        <span>{(trimStart * dur).toFixed(2)}s</span>
        <span style={{ color: '#3d3d3d' }}>drag handles · reset: </span>
        <button onClick={() => onTrimChange(0, 1)} style={{ fontSize: 9, background: 'none', border: 'none', color: '#555', cursor: 'pointer', padding: 0, fontFamily: 'monospace' }}>
          {(trimEnd * dur).toFixed(2)}s ↺
        </button>
      </div>
    </div>
  )
}

// ── Pad right-click popover ───────────────────────────────────────────────────

// ── FX Toggle configuration ───────────────────────────────────────────────────

const FX_TYPES: Array<{ type: EffectType; label: string }> = [
  { type: 'reverb',     label: 'Reverb'     },
  { type: 'delay',      label: 'Delay'      },
  { type: 'filter',     label: 'Filter'     },
  { type: 'eq3',        label: 'EQ'         },
  { type: 'compressor', label: 'Compressor' },
]

function defaultParamsForType(type: EffectType) {
  if (type === 'reverb')     return defaultReverb()
  if (type === 'delay')      return defaultDelay()
  if (type === 'filter')     return defaultFilter()
  if (type === 'eq3')        return defaultEq3()
  if (type === 'compressor') return defaultCompressor()
  return defaultReverb()
}

function FxToggleConfig({ pad, onPadChange }: {
  pad: Pad
  onPadChange: (patch: Partial<Pad>) => void
}) {
  const { project, dispatch, engine } = useDaw()
  const [selTrackId, setSelTrackId] = useState<string>(
    pad.effectTarget?.trackId ?? project.tracks[0]?.id ?? ''
  )
  const [selFxType, setSelFxType] = useState<EffectType>('reverb')

  const C = { accent: '#7c3aed', border: '#333', text: '#ccc', muted: '#555', bgCard: '#0e0e0e' }

  // Current assignment (if any)
  const assignedTrack  = pad.effectTarget ? project.tracks.find(t => t.id === pad.effectTarget!.trackId) : null
  const assignedEffect = assignedTrack?.effects.find(e => e.id === pad.effectTarget?.effectId)

  function assign() {
    if (!selTrackId) return
    const track = project.tracks.find(t => t.id === selTrackId)
    if (!track) return

    // Check if this effect type already exists on the track
    const existing = track.effects.find(e => e.type === selFxType)
    if (existing) {
      onPadChange({ effectTarget: { trackId: selTrackId, effectId: existing.id } })
      return
    }

    // Create a new effect of the chosen type on the track, start enabled=false
    const params = { ...defaultParamsForType(selFxType), enabled: false }
    const effect = { id: crypto.randomUUID(), type: selFxType, params }
    dispatch({ type: 'ADD_EFFECT', trackId: selTrackId, effect })
    // Rebuild the effects chain so the engine knows about it immediately
    engine.ensureTrack(selTrackId, [...track.effects, effect])
    onPadChange({ effectTarget: { trackId: selTrackId, effectId: effect.id } })
  }

  return (
    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {/* Current assignment */}
      {assignedEffect ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', borderRadius: 4, background: '#0e0e0e', border: `1px solid ${C.accent}55` }}>
          <span style={{ flex: 1, fontSize: 10, color: C.accent }}>
            {assignedEffect.type.charAt(0).toUpperCase() + assignedEffect.type.slice(1)} on {assignedTrack?.name}
          </span>
          <button
            onClick={() => onPadChange({ effectTarget: undefined })}
            style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, border: `1px solid ${C.border}`, background: 'transparent', color: C.muted, cursor: 'pointer' }}
          >Clear</button>
        </div>
      ) : (
        <div style={{ fontSize: 10, color: C.muted }}>No effect assigned</div>
      )}

      {/* Track picker */}
      <div>
        <div style={{ fontSize: 9, color: C.muted, marginBottom: 3, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Track</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 80, overflowY: 'auto' }}>
          {project.tracks.map(t => (
            <button
              key={t.id}
              onClick={() => setSelTrackId(t.id)}
              style={{
                textAlign: 'left', fontSize: 10, padding: '3px 7px', borderRadius: 3, cursor: 'pointer',
                border: `1px solid ${selTrackId === t.id ? C.accent : C.border}`,
                background: selTrackId === t.id ? `${C.accent}22` : C.bgCard,
                color: selTrackId === t.id ? '#a78bfa' : C.text,
                borderLeft: `3px solid ${t.color}`,
              }}
            >{t.name}</button>
          ))}
        </div>
      </div>

      {/* Effect type picker */}
      <div>
        <div style={{ fontSize: 9, color: C.muted, marginBottom: 3, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Effect</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {FX_TYPES.map(fx => (
            <button
              key={fx.type}
              onClick={() => setSelFxType(fx.type)}
              style={{
                fontSize: 10, padding: '3px 8px', borderRadius: 3, cursor: 'pointer',
                border: `1px solid ${selFxType === fx.type ? C.accent : C.border}`,
                background: selFxType === fx.type ? `${C.accent}22` : C.bgCard,
                color: selFxType === fx.type ? '#a78bfa' : C.text,
              }}
            >{fx.label}</button>
          ))}
        </div>
      </div>

      {/* Assign button */}
      <button
        onClick={assign}
        disabled={!selTrackId}
        style={{
          padding: '5px 0', borderRadius: 4, border: 'none', cursor: selTrackId ? 'pointer' : 'not-allowed',
          background: selTrackId ? C.accent : '#222', color: '#fff', fontSize: 10, fontWeight: 700,
        }}
      >
        {(() => {
          const track = project.tracks.find(t => t.id === selTrackId)
          const exists = track?.effects.find(e => e.type === selFxType)
          return exists ? `Use Existing ${selFxType}` : `Add ${selFxType} to track`
        })()}
      </button>
    </div>
  )
}

function PadPopover({ pad, anchor, onRemap, onPadChange, onClose }: {
  pad: Pad
  anchor: { x: number; y: number }
  onRemap: () => void
  onPadChange: (patch: Partial<Pad>) => void
  onClose: () => void
}) {
  const { project } = useDaw()
  const [entries,          setEntries]          = useState<LibraryEntry[]>([])
  const [loading,          setLoading]          = useState(true)
  const [showLibrary,      setShowLibrary]      = useState(false)
  const [search,           setSearch]           = useState('')
  const [cropBlob,         setCropBlob]         = useState<Blob | null>(null)
  const [expandedId,       setExpandedId]       = useState<string | null>(null)
  const [openPickerFolders,setOpenPickerFolders] = useState<Set<string>>(new Set())
  const [previewId,        setPreviewId]        = useState<string | null>(null)
  const previewRef = useRef<{ src: AudioBufferSourceNode; ctx: AudioContext } | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const sounds = pad.customSounds ?? []
  const hasCustom = sounds.length > 0

  useEffect(() => {
    libraryGetAll().then(all => {
      setEntries(all)
      setLoading(false)
      const firstId = (pad.customSounds ?? [])[0]?.id
      if (firstId) {
        const entry = all.find(x => x.id === firstId)
        if (entry?.audioBlob) setCropBlob(entry.audioBlob)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Update crop blob when first sound changes
  useEffect(() => {
    const firstId = (pad.customSounds ?? [])[0]?.id
    if (!firstId) { setCropBlob(null); return }
    const entry = entries.find(e => e.id === firstId)
    if (entry?.audioBlob) setCropBlob(entry.audioBlob)
  }, [pad.customSounds, entries])

  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [onClose])

  // Preview playback
  useEffect(() => () => stopPreview(), [])  // eslint-disable-line react-hooks/exhaustive-deps

  function stopPreview() {
    if (previewRef.current) {
      try { previewRef.current.src.stop() } catch { /* */ }
      previewRef.current.ctx.close().catch(() => {})
      previewRef.current = null
    }
    setPreviewId(null)
  }

  async function playPreview(entry: LibraryEntry) {
    stopPreview()
    try {
      const ctx = new AudioContext()
      await ctx.resume()
      let blob = entry.audioBlob
      if (!blob) {
        const fulfilled = await libraryFulfill(entry.id)
        if (!fulfilled?.audioBlob) return
        blob = fulfilled.audioBlob
        setEntries(prev => prev.map(e => e.id === fulfilled.id ? fulfilled : e))
      }
      const ab  = await blob.arrayBuffer()
      const buf = await ctx.decodeAudioData(ab)
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.connect(ctx.destination)
      src.onended = () => setPreviewId(null)
      src.start(0)
      previewRef.current = { src, ctx }
      setPreviewId(entry.id)
    } catch { setPreviewId(null) }
  }

  function togglePickerFolder(key: string) {
    setOpenPickerFolders(prev => {
      const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s
    })
  }

  function addSound(entry: LibraryEntry) {
    const current = pad.customSounds ?? []
    if (current.some(s => s.id === entry.id)) return
    onPadChange({ customSounds: [...current, { id: entry.id, name: entry.name, volume: 1, pitch: 0 }] })
  }

  function removeSound(id: string) {
    onPadChange({ customSounds: (pad.customSounds ?? []).filter(s => s.id !== id) })
    if (expandedId === id) setExpandedId(null)
  }

  function updateSound(id: string, patch: Partial<PadSound>) {
    onPadChange({ customSounds: (pad.customSounds ?? []).map(s => s.id === id ? { ...s, ...patch } : s) })
  }

  const hasSearch = search.trim().length > 0

  // Note-name → MIDI for sort inside picker folders
  const NOTE_PC_PICKER: Record<string, number> = { C:0,'C#':1,D:2,'D#':3,E:4,F:5,'F#':6,G:7,'G#':8,A:9,'A#':10,B:11 }
  function pickerNoteToMidi(name: string): number | null {
    const m = name.match(/^([A-G]#?)(-?\d+)$/)
    if (!m) return null
    const pc = NOTE_PC_PICKER[m[1]]
    return pc !== undefined ? (parseInt(m[2]) + 1) * 12 + pc : null
  }
  function pickerSortByNote(arr: LibraryEntry[]) {
    const midis = arr.map(e => pickerNoteToMidi(e.name))
    return midis.some(m => m === null) ? arr : [...arr].sort((a, b) => (pickerNoteToMidi(a.name) ?? 0) - (pickerNoteToMidi(b.name) ?? 0))
  }

  // Group entries for picker (computed inline since PadPopover is not a stable component)
  const pickerGroups = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filt = q ? entries.filter(e => e.name.toLowerCase().includes(q)) : entries
    const byParent = new Map<string, Map<string, LibraryEntry[]>>()
    const byFolder = new Map<string, LibraryEntry[]>()
    const unfiled: LibraryEntry[] = []
    for (const e of filt) {
      if (e.parentFolder) {
        const sub    = e.folder ?? ''
        const subMap = byParent.get(e.parentFolder) ?? new Map<string, LibraryEntry[]>()
        subMap.set(sub, [...(subMap.get(sub) ?? []), e])
        byParent.set(e.parentFolder, subMap)
      } else if (e.folder) {
        byFolder.set(e.folder, [...(byFolder.get(e.folder) ?? []), e])
      } else {
        unfiled.push(e)
      }
    }
    for (const [, subMap] of byParent) {
      for (const [k, arr] of subMap) subMap.set(k, pickerSortByNote(arr))
    }
    return { byParent, byFolder, unfiled }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, search])

  const totalFiltered = [...pickerGroups.byParent.values()].reduce((n, sm) => n + [...sm.values()].reduce((a, b) => a + b.length, 0), 0)
    + [...pickerGroups.byFolder.values()].reduce((n, a) => n + a.length, 0)
    + pickerGroups.unfiled.length

  function pickerEntry(entry: LibraryEntry) {
    const already = sounds.some(s => s.id === entry.id)
    const isPrev  = previewId === entry.id
    return (
      <div key={entry.id} style={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <button
          onClick={e => { e.stopPropagation(); isPrev ? stopPreview() : playPreview(entry) }}
          title={isPrev ? 'Stop preview' : 'Preview'}
          style={{ background: 'transparent', border: 'none', color: isPrev ? C.yellow : C.muted, cursor: 'pointer', fontSize: 10, padding: '0 4px', flexShrink: 0, lineHeight: 1, width: 20 }}
        >{isPrev ? '■' : '▶'}</button>
        <button
          onClick={() => addSound(entry)}
          disabled={already}
          style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, textAlign: 'left', padding: '4px 4px', border: 'none', background: already ? `${C.accent}22` : 'transparent', color: already ? C.accent : C.text, cursor: already ? 'default' : 'pointer', fontSize: 11, borderRadius: 3 }}
          onMouseEnter={e => { if (!already) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = already ? `${C.accent}22` : 'transparent' }}
        >
          <span style={{ fontSize: 11 }}>{already ? '✓' : '🔊'}</span>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</span>
          <span style={{ fontSize: 9, color: C.muted, flexShrink: 0 }}>{entry.duration.toFixed(1)}s</span>
        </button>
      </div>
    )
  }

  const left = Math.min(anchor.x, (typeof window !== 'undefined' ? window.innerWidth  : 800) - 270)
  const top  = Math.min(anchor.y, (typeof window !== 'undefined' ? window.innerHeight : 800) - 580)

  const toggleStyle = (on: boolean, col = C.accent) => ({
    fontSize: 11, padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontWeight: on ? 700 : 400,
    border: `1px solid ${on ? col : C.border}`,
    background: on ? `${col}22` : 'transparent',
    color: on ? col : C.muted,
  } as const)

  return createPortal(
    <div
      ref={ref}
      data-pad-overlay="true"
      onMouseDown={e => e.stopPropagation()}
      style={{
        position: 'fixed', left, top, width: 260, zIndex: 3000,
        background: C.bgCard, border: `1px solid ${C.accent}`,
        borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
        maxHeight: '90vh', overflowY: 'auto',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '8px 10px', background: 'rgba(61,143,239,0.12)', borderBottom: `1px solid ${C.border}` }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: C.text, flex: 1 }}>{pad.drumLabel}</span>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 0 }}>×</button>
      </div>

      {/* KEY */}
      <div style={{ padding: '10px 12px', borderBottom: `1px solid ${C.border}` }}>
        <span style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Key</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
          <span style={{
            fontSize: 14, fontWeight: 800, fontFamily: 'monospace', width: 28, height: 28,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: C.bgDark, border: `1px solid ${C.border}`, borderRadius: 4,
            color: pad.key ? C.text : C.muted,
          }}>{pad.key ? pad.key.toUpperCase() : '–'}</span>
          <button
            onClick={() => { onRemap(); onClose() }}
            style={{ fontSize: 11, padding: '4px 10px', borderRadius: 4, border: `1px solid ${C.border}`, background: 'transparent', color: C.text, cursor: 'pointer' }}
          >{pad.key ? 'Remap Key' : 'Assign Key'}</button>
        </div>
      </div>

      {/* MODE */}
      <div style={{ padding: '10px 12px', borderBottom: `1px solid ${C.border}` }}>
        <span style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Mode</span>
        <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
          {(['sample', 'effect-toggle'] as const).map(m => (
            <button key={m} onClick={() => onPadChange({ mode: m, effectTarget: m === 'sample' ? undefined : pad.effectTarget })}
              style={{ flex: 1, fontSize: 10, padding: '4px 0', borderRadius: 4, cursor: 'pointer', fontWeight: 600,
                border: `1px solid ${(pad.mode ?? 'sample') === m ? C.accent : C.border}`,
                background: (pad.mode ?? 'sample') === m ? `${C.accent}22` : 'transparent',
                color: (pad.mode ?? 'sample') === m ? C.accent : C.muted }}>
              {m === 'sample' ? 'Sample' : 'FX Toggle'}
            </button>
          ))}
        </div>
        {pad.mode === 'effect-toggle' && (
          <FxToggleConfig pad={pad} onPadChange={onPadChange} />
        )}
      </div>

      {/* SOUNDS */}
      {(pad.mode ?? 'sample') === 'sample' && <div style={{ padding: '10px 12px', borderBottom: hasCustom ? `1px solid ${C.border}` : 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Sounds</span>
          {hasCustom && (
            <button onClick={() => onPadChange({ customSounds: [] })}
              style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, border: `1px solid ${C.border}`, background: 'transparent', color: C.muted, cursor: 'pointer' }}>Clear all</button>
          )}
        </div>

        {/* Sound rows */}
        {sounds.length === 0 && (
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>Instrument default</div>
        )}
        {sounds.map(sound => {
          const isExp = expandedId === sound.id
          const pitchVal = sound.pitch ?? 0
          return (
            <div key={sound.id} style={{ marginBottom: 4, borderRadius: 5, border: `1px solid ${isExp ? C.accent : C.border}`, background: isExp ? 'rgba(61,143,239,0.06)' : 'transparent', overflow: 'hidden' }}>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 7px', cursor: 'pointer' }}
                onClick={() => setExpandedId(isExp ? null : sound.id)}
              >
                <span style={{ fontSize: 12, flexShrink: 0 }}>🔊</span>
                <span style={{ fontSize: 11, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: C.text }}>
                  {(() => { const e = entries.find(x => x.id === sound.id); return e?.folder ? `${e.folder} – ${sound.name}` : sound.name })()}
                </span>
                {pitchVal !== 0 && (
                  <span style={{ fontSize: 9, color: C.accent, fontFamily: 'monospace', flexShrink: 0 }}>
                    {pitchVal > 0 ? `+${pitchVal}st` : `${pitchVal}st`}
                  </span>
                )}
                <span style={{ fontSize: 9, color: C.muted, fontFamily: 'monospace', flexShrink: 0 }}>{Math.round((sound.volume ?? 1) * 100)}%</span>
                <button
                  onClick={e => { e.stopPropagation(); removeSound(sound.id) }}
                  style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '0 2px', flexShrink: 0 }}
                >×</button>
              </div>
              {isExp && (
                <div style={{ padding: '0 10px 8px', borderTop: `1px solid ${C.border}` }}>
                  {/* Pitch per sound */}
                  <div style={{ marginTop: 8, marginBottom: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                      <span style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Pitch</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <button onClick={() => updateSound(sound.id, { pitch: Math.max(-24, pitchVal - 1) })}
                          style={{ width: 18, height: 18, borderRadius: 2, border: `1px solid ${C.border}`, background: 'transparent', color: C.text, cursor: 'pointer', fontSize: 12, lineHeight: 1 }}>−</button>
                        <span style={{ fontSize: 10, fontFamily: 'monospace', minWidth: 38, textAlign: 'center', color: pitchVal !== 0 ? C.accent : C.muted }}>
                          {pitchVal > 0 ? `+${pitchVal}st` : `${pitchVal}st`}
                        </span>
                        <button onClick={() => updateSound(sound.id, { pitch: Math.min(24, pitchVal + 1) })}
                          style={{ width: 18, height: 18, borderRadius: 2, border: `1px solid ${C.border}`, background: 'transparent', color: C.text, cursor: 'pointer', fontSize: 12, lineHeight: 1 }}>+</button>
                        {pitchVal !== 0 && (
                          <button onClick={() => updateSound(sound.id, { pitch: 0 })}
                            style={{ fontSize: 9, padding: '1px 4px', borderRadius: 2, border: `1px solid ${C.border}`, background: 'transparent', color: C.muted, cursor: 'pointer' }}>0</button>
                        )}
                      </div>
                    </div>
                    <input
                      type="range" min={-24} max={24} step={1} value={pitchVal}
                      onChange={e => updateSound(sound.id, { pitch: parseInt(e.target.value) })}
                      onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}
                      style={{ width: '100%', accentColor: C.accent, cursor: 'pointer', display: 'block' }}
                    />
                    <div style={{ fontSize: 9, color: '#444', marginTop: 2 }}>Pitch shifts playback speed</div>
                  </div>
                  {/* Volume per sound */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, alignItems: 'center' }}>
                    <span style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Volume</span>
                    <span style={{ fontSize: 10, color: C.text, fontFamily: 'monospace' }}>{Math.round((sound.volume ?? 1) * 100)}%</span>
                  </div>
                  <input
                    type="range" min={0} max={2} step={0.01} value={sound.volume ?? 1}
                    onChange={e => updateSound(sound.id, { volume: parseFloat(e.target.value) })}
                    onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}
                    style={{ width: '100%', accentColor: C.accent, cursor: 'pointer', display: 'block' }}
                  />
                </div>
              )}
            </div>
          )
        })}

        {/* Library picker */}
        <button
          onClick={() => setShowLibrary(v => !v)}
          style={{ width: '100%', fontSize: 11, padding: '5px 0', marginTop: 4, borderRadius: 4, border: `1px solid ${C.accent}`, background: showLibrary ? `${C.accent}22` : 'transparent', color: C.accent, cursor: 'pointer', fontWeight: 600 }}
        >{showLibrary ? 'Hide Library ▴' : '+ Add Sound from Library ▾'}</button>

        {showLibrary && (
          <div style={{ marginTop: 8 }}>
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search sounds…" autoFocus
              style={{ width: '100%', fontSize: 11, padding: '4px 8px', borderRadius: 4, border: `1px solid ${C.border}`, background: C.bgDark, color: C.text, outline: 'none', boxSizing: 'border-box', marginBottom: 4 }}
              onKeyDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}
            />
            {loading ? (
              <div style={{ fontSize: 11, color: C.muted, padding: '8px 4px' }}>Loading…</div>
            ) : totalFiltered === 0 ? (
              <div style={{ fontSize: 11, color: C.muted, padding: '8px 4px' }}>
                {entries.length === 0 ? 'No sounds in library — import one first' : 'No matches'}
              </div>
            ) : (
              <div style={{ maxHeight: 180, overflowY: 'auto', fontSize: 11 }}>
                {/* Parent-grouped folders (e.g. "100lights Audio") */}
                {[...pickerGroups.byParent.entries()].map(([parentName, subFolders]) => {
                  const pKey = `p:${parentName}`
                  const pOpen = openPickerFolders.has(pKey) || hasSearch
                  const total = [...subFolders.values()].reduce((n, a) => n + a.length, 0)
                  return (
                    <div key={pKey}>
                      <div onClick={() => togglePickerFolder(pKey)} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 6px', cursor: 'pointer', background: 'rgba(61,143,239,0.07)', borderRadius: 3, marginBottom: 1 }}>
                        <span style={{ fontSize: 9, color: 'rgba(61,143,239,0.8)' }}>{pOpen ? '▾' : '▸'}</span>
                        <span style={{ flex: 1, fontSize: 10, fontWeight: 700, color: 'rgba(61,143,239,0.9)' }}>{parentName}</span>
                        <span style={{ fontSize: 9, color: C.muted }}>{total}</span>
                      </div>
                      {pOpen && [...subFolders.entries()].map(([subName, subEntries]) => {
                        const sKey = `${pKey}/${subName}`
                        const sOpen = openPickerFolders.has(sKey) || hasSearch
                        return (
                          <div key={sKey} style={{ paddingLeft: 8, marginBottom: 1 }}>
                            <div onClick={() => togglePickerFolder(sKey)} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 6px', cursor: 'pointer', background: C.bgDark, borderRadius: 2 }}>
                              <span style={{ fontSize: 9, color: C.muted }}>{sOpen ? '▾' : '▸'}</span>
                              <span style={{ flex: 1, fontSize: 10, color: C.text }}>{subName}</span>
                              <span style={{ fontSize: 9, color: C.muted }}>{subEntries.length}</span>
                            </div>
                            {sOpen && subEntries.map(pickerEntry)}
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
                {/* User folders */}
                {[...pickerGroups.byFolder.entries()].map(([folderName, folderEntries]) => {
                  const fKey = `f:${folderName}`
                  const fOpen = openPickerFolders.has(fKey) || hasSearch
                  return (
                    <div key={fKey} style={{ marginBottom: 1 }}>
                      <div onClick={() => togglePickerFolder(fKey)} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 6px', cursor: 'pointer', background: C.bgDark, borderRadius: 2 }}>
                        <span style={{ fontSize: 9, color: C.muted }}>{fOpen ? '▾' : '▸'}</span>
                        <span style={{ flex: 1, fontSize: 10, color: C.text }}>📁 {folderName}</span>
                        <span style={{ fontSize: 9, color: C.muted }}>{folderEntries.length}</span>
                      </div>
                      {fOpen && folderEntries.map(pickerEntry)}
                    </div>
                  )
                })}
                {/* Unfiled */}
                {pickerGroups.unfiled.map(pickerEntry)}
              </div>
            )}
          </div>
        )}
      </div>}

      {/* PERFORMANCE — shown when a custom sound is assigned in sample mode */}
      {(pad.mode ?? 'sample') === 'sample' && hasCustom && (
        <div style={{ padding: '10px 12px' }}>
          <span style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 10 }}>Performance</span>

          {/* Crop / Trim (uses first sound's waveform; trim fractions apply to all) */}
          {cropBlob && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                <span style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Crop</span>
                {((pad.sampleTrimStart ?? 0) > 0 || (pad.sampleTrimEnd ?? 1) < 1) && (
                  <button onClick={() => onPadChange({ sampleTrimStart: 0, sampleTrimEnd: 1 })}
                    style={{ fontSize: 9, padding: '1px 5px', borderRadius: 2, border: `1px solid ${C.border}`, background: 'transparent', color: C.muted, cursor: 'pointer' }}>
                    Reset
                  </button>
                )}
              </div>
              <PadWaveformCrop
                blob={cropBlob}
                trimStart={pad.sampleTrimStart ?? 0}
                trimEnd={pad.sampleTrimEnd ?? 1}
                onTrimChange={(s, e) => onPadChange({ sampleTrimStart: s, sampleTrimEnd: e })}
              />
              {sounds.length > 1 && (
                <div style={{ fontSize: 9, color: '#444', marginTop: 2 }}>Crop applies to all {sounds.length} sounds</div>
              )}
            </div>
          )}

          {/* Sustain */}
          <PopSlider
            label="Sustain"
            value={pad.sampleSustain ?? 0}
            min={0} max={4} step={0.05}
            format={v => v === 0 ? 'Off (chop)' : `${v.toFixed(2)}s`}
            onChange={v => onPadChange({ sampleSustain: v })}
          />

          {/* Vibrato depth */}
          <PopSlider
            label="Vibrato"
            value={pad.sampleVibratoDepth ?? 0}
            min={0} max={1} step={0.01}
            format={v => v === 0 ? 'Off' : `${Math.round(v * 100)}%`}
            onChange={v => onPadChange({ sampleVibratoDepth: v })}
            accent={C.yellow}
          />

          {/* Vibrato rate — only when depth > 0 */}
          {(pad.sampleVibratoDepth ?? 0) > 0 && (
            <PopSlider
              label="Vibrato Rate"
              value={pad.sampleVibratoRate ?? 5}
              min={0.5} max={12} step={0.5}
              format={v => `${v.toFixed(1)} Hz`}
              onChange={v => onPadChange({ sampleVibratoRate: v })}
              accent={C.yellow}
            />
          )}

          {/* Playback toggles */}
          <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
            <button onClick={() => onPadChange({ sampleLoop: !pad.sampleLoop })} style={toggleStyle(!!pad.sampleLoop)}>↻ Loop</button>
            <button onClick={() => onPadChange({ sampleReverse: !pad.sampleReverse })} style={toggleStyle(!!pad.sampleReverse)}>◁ Reverse</button>
          </div>
        </div>
      )}
    </div>,
    document.body
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function PadInput({ trackId, onClose }: { trackId: string; onClose: () => void }) {
  const { project, dispatch, engine, metronome, setMetronome } = useDaw()

  const [tab,          setTab]          = useState<'pads' | 'keyboard' | 'voice'>('pads')
  const [pads,         setPads]         = useState<Pad[]>(DEFAULT_PADS)
  const [octave,       setOctave]       = useState(4)
  const [pressing,     setPressing]     = useState<Set<number>>(new Set())
  const [remapId,        setRemapId]        = useState<string | null>(null)
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null)
  const [labelDraft,     setLabelDraft]     = useState('')
  const [active,         setActive]         = useState(false)
  const [contextMenu,  setContextMenu]  = useState<{ pad: Pad; x: number; y: number } | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [showSaveMenu,  setShowSaveMenu]  = useState(false)
  const [savedPresets,  setSavedPresets]  = useState<PadPreset[]>(() => getPadPresets())
  const [saveName,      setSaveName]      = useState('')
  const [padRecording,  setPadRecording]  = useState(false)
  const [countdown,     setCountdown]     = useState<number | null>(null)
  const countdownIvRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [quantizeEnabled, setQuantizeEnabled] = useState(false)
  const [midiDevices, setMidiDevices] = useState<string[]>([])
  const [captureCount, setCaptureCount] = useState(() => _midiCapture.length)
  const [quantizeGrid,    setQuantizeGrid]    = useState<'1/1'|'1/2'|'1/4'|'1/8'|'1/16'>('1/8')
  const quantizeEnabledRef = useRef(false)
  const quantizeGridRef    = useRef<'1/1'|'1/2'|'1/4'|'1/8'|'1/16'>('1/8')
  const [winSize,      setWinSize]      = useState<{ w: number; h: number | null }>({ w: 520, h: null })
  const [pos, setPos] = useState(() => ({
    x: typeof window !== 'undefined' ? Math.max(0, window.innerWidth  / 2 - 260) : 200,
    y: typeof window !== 'undefined' ? Math.max(0, window.innerHeight - 420)      : 200,
  }))

  // ── Step sequencer state ─────────────────────────────────────────────────────
  const [drumSteps,         setDrumSteps]         = useState<Record<string, boolean[]>>(() => {
    const m: Record<string, boolean[]> = {}
    for (const p of DEFAULT_PADS) m[p.id] = Array.from({ length: STEP_COUNT }, () => false)
    return m
  })
  const [stepProbabilities, setStepProbabilities] = useState<Record<string, Record<number, number>>>({})
  const [stepRatchets,      setStepRatchets]      = useState<Record<string, Record<number, 1|2|4>>>({})
  const [rowRates,          setRowRates]          = useState<Record<string, StepRate>>({})
  const [stepPopover,       setStepPopover]       = useState<{ padId: string; stepIndex: number; x: number; y: number } | null>(null)
  const [, setSeqTick]                            = useState(0)

  const containerRef  = useRef<HTMLDivElement>(null)
  const noteStarts = useRef<Map<number, { beat: number; sounds: PadSound[]; velocity: number }>>(new Map())
  const captureStarts = useRef<Map<number, { beat: number; velocity: number }>>(new Map())
  const padTrackMap   = useRef<Map<number, string>>(new Map())
  const soundBuffers  = useRef<Map<string, AudioBuffer>>(new Map())
  const reversedBufs  = useRef<Map<string, AudioBuffer>>(new Map())
  // pitch is now per-sound via playbackRate — no pre-computation cache needed
  const activeSources = useRef<Map<number, ActiveSource[]>>(new Map())
  const dragging      = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)
  const resizing      = useRef<{ dir: string; sx: number; sy: number; ow: number; oh: number } | null>(null)

  // Step sequencer refs
  const drumStepsRef        = useRef(drumSteps)
  const stepProbsRef        = useRef(stepProbabilities)
  const stepRatchetsRef     = useRef(stepRatchets)
  const rowRatesRef         = useRef(rowRates)
  const seqBeatRef          = useRef(0)
  const seqPrevStep32Ref    = useRef(-1)
  const seqLastStepsRef     = useRef<Record<string, number>>({})

  // Live refs so capture handler always reads fresh values without re-registering
  const entriesRef    = useRef<LibraryEntry[]>([])
  const padsRef       = useRef(pads)
  const tabRef        = useRef(tab)
  const remapIdRef    = useRef(remapId)
  const padKeyMapRef  = useRef<Record<string, number>>({})
  const pianoKeyMapRef = useRef<Record<string, number>>({})
  useEffect(() => () => { if (countdownIvRef.current) clearInterval(countdownIvRef.current) }, [])
  const projectRef = useRef(project)
  useEffect(() => { projectRef.current = project }, [project])
  useEffect(() => { padsRef.current           = pads           }, [pads])
  useEffect(() => { tabRef.current            = tab            }, [tab])
  useEffect(() => { remapIdRef.current        = remapId        }, [remapId])
  useEffect(() => { quantizeEnabledRef.current = quantizeEnabled }, [quantizeEnabled])

  // ── Hardware MIDI (Web MIDI API) — auto-connects every input, hot-plug aware ──
  const startNoteRef = useRef<(pitch: number, velocity?: number) => void>(() => {})
  const endNoteRef   = useRef<(pitch: number) => void>(() => {})
  useEffect(() => {
    if (!webMidiSupported) return
    let unsubNote: (() => void) | undefined
    let unsubDev: (() => void) | undefined
    let cancelled = false
    void startWebMidi().then(ok => {
      if (!ok || cancelled) return
      unsubDev = onMidiDevices(setMidiDevices)
      unsubNote = onMidiNote(e => {
        if (e.type === 'on') startNoteRef.current(e.pitch, e.velocity)
        else endNoteRef.current(e.pitch)
      })
    })
    return () => { cancelled = true; unsubNote?.(); unsubDev?.() }
  }, [])
  useEffect(() => { quantizeGridRef.current    = quantizeGrid    }, [quantizeGrid])

  const track      = project.tracks.find(t => t.id === trackId)
  const instrument = track?.instrument
  const isDrum     = instrument?.type === 'drum'
  const instrumentRef = useRef(instrument)
  useEffect(() => { instrumentRef.current = instrument }, [instrument])

  const pianoKeyMap = useMemo(() => buildPianoKeyMap(octave), [octave])
  const padKeyMap   = useMemo(() => {
    const m: Record<string, number> = {}
    for (const p of pads) if (p.key) m[p.key] = p.pitch
    return m
  }, [pads])
  useEffect(() => { padKeyMapRef.current   = padKeyMap   }, [padKeyMap])
  useEffect(() => { pianoKeyMapRef.current = pianoKeyMap }, [pianoKeyMap])
  useEffect(() => { drumStepsRef.current        = drumSteps         }, [drumSteps])
  useEffect(() => { stepProbsRef.current        = stepProbabilities }, [stepProbabilities])
  useEffect(() => { stepRatchetsRef.current     = stepRatchets      }, [stepRatchets])
  useEffect(() => { rowRatesRef.current         = rowRates          }, [rowRates])

  const saveMenuRef = useRef<HTMLDivElement>(null)
  // Close save menu on outside click
  useEffect(() => {
    if (!showSaveMenu) return
    function onDown(e: MouseEvent) {
      if (saveMenuRef.current && saveMenuRef.current.contains(e.target as Node)) return
      setShowSaveMenu(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [showSaveMenu])

  // Load library entries so endNote can look up blobs for audio clips
  useEffect(() => { libraryGetAll().then(all => { entriesRef.current = all }) }, [])

  // Stop pad recording when transport stops
  useEffect(() => {
    function onTransport(e: Event) {
      const playing = (e as CustomEvent<{ playing: boolean }>).detail.playing
      if (!playing) setPadRecording(false)
    }
    engine.addEventListener('transport', onTransport)
    return () => engine.removeEventListener('transport', onTransport)
  }, [engine])

  // ── Per-pad audio track management ───────────────────────────────────────────

  const getOrCreatePadTrack = useCallback((pitch: number, drumLabel: string): string => {
    const existing = padTrackMap.current.get(pitch)
    if (existing && project.tracks.some(t => t.id === existing)) return existing
    const id = crypto.randomUUID()
    dispatch({ type: 'ADD_TRACK', id, name: drumLabel })
    padTrackMap.current.set(pitch, id)
    return id
  }, [project.tracks, dispatch])

  // ── Drum step fire (sequencer playback, no recording) ────────────────────────

  const fireDrumStep = useCallback((pad: Pad, ratchet: 1|2|4, stepBeats: number) => {
    const sounds = pad.customSounds ?? []

    const playAt = (ctxAt: number) => {
      if (sounds.length > 0) {
        for (const sound of sounds) {
          const rawBuf = soundBuffers.current.get(sound.id)
          if (!rawBuf) continue
          let playBuf = rawBuf
          if (pad.sampleReverse) {
            const rev = reversedBufs.current.get(sound.id)
            if (rev) playBuf = rev
          }
          const gainNode = engine.ctx.createGain()
          gainNode.gain.value = sound.volume ?? 1
          gainNode.connect(engine.masterGain)
          const tStart = (pad.sampleTrimStart ?? 0) * playBuf.duration
          const tDur   = Math.max(0.001, ((pad.sampleTrimEnd ?? 1) - (pad.sampleTrimStart ?? 0)) * playBuf.duration)
          const src    = engine.ctx.createBufferSource()
          src.buffer   = playBuf
          src.playbackRate.value = Math.pow(2, (sound.pitch ?? 0) / 12)
          src.connect(gainNode)
          src.start(ctxAt, tStart, tDur)
          src.onended = () => gainNode.disconnect()
        }
      } else {
        const instr = instrumentRef.current
        if (instr) {
          playInstrumentNote(engine.ctx, engine.masterGain, instr, pad.pitch, 100, ctxAt, 0.25)
        }
      }
    }

    const now = engine.ctx.currentTime
    playAt(now)
    if (ratchet > 1) {
      const stepDurSec = engine.beatsToSeconds(stepBeats)
      for (let r = 1; r < ratchet; r++) {
        playAt(now + (stepDurSec / ratchet) * r)
      }
    }
  }, [engine])

  // ── Audio playback ────────────────────────────────────────────────────────────

  const startNote = useCallback(async (pitch: number, velocity = 100) => {
    const pad    = padsRef.current.find(p => p.pitch === pitch)

    // Effect-toggle mode — press toggles a track effect on/off
    if (pad?.mode === 'effect-toggle' && pad.effectTarget) {
      const { trackId, effectId } = pad.effectTarget
      const track = projectRef.current.tracks.find(t => t.id === trackId)
      const effect = track?.effects.find(e => e.id === effectId)
      if (effect) {
        const newEnabled = !(effect.params as { enabled?: boolean }).enabled
        dispatch({ type: 'UPDATE_EFFECT', trackId, effectId, patch: { params: { ...effect.params, enabled: newEnabled } } })
        engine.getEffectHandle(trackId, effectId)?.setParam('enabled', newEnabled)
      }
      return
    }

    const sounds = pad?.customSounds ?? []

    if (sounds.length > 0) {
      await engine.ctx.resume()

      // Decode any buffers not yet in cache (fetch library once for all missing)
      const missing = sounds.filter(s => !soundBuffers.current.has(s.id))
      if (missing.length > 0) {
        try {
          const all = await libraryGetAll()
          for (const sound of missing) {
            const entry = all.find(e => e.id === sound.id)
            if (entry) {
              let blob = entry.audioBlob
              if (!blob) {
                const fulfilled = await libraryFulfill(entry.id)
                blob = fulfilled?.audioBlob
              }
              if (blob) {
                const ab  = await blob.arrayBuffer()
                const buf = await engine.ctx.decodeAudioData(ab)
                soundBuffers.current.set(sound.id, buf)
              }
            }
          }
        } catch { /* ignore decode errors */ }
      }

      // Stop any existing sources for this pitch
      const existing = activeSources.current.get(pitch) ?? []
      for (const active of existing) {
        try { active.src.stop() } catch { /* */ }
        active.lfo?.stop(); active.lfo?.disconnect()
        active.lfoGain?.disconnect()
        active.gain.disconnect()
      }

      // Start all sounds simultaneously
      const newSources: ActiveSource[] = []

      for (const sound of sounds) {
        let rawBuf = soundBuffers.current.get(sound.id)
        if (!rawBuf) continue

        // Reverse
        let playBuf = rawBuf
        if (pad?.sampleReverse) {
          const rKey = sound.id
          let rev = reversedBufs.current.get(rKey)
          if (!rev) { rev = reverseBuffer(engine.ctx, rawBuf); reversedBufs.current.set(rKey, rev) }
          playBuf = rev
        }

        const gainNode = engine.ctx.createGain()
        gainNode.gain.value = sound.volume ?? 1
        gainNode.connect(engine.masterGain)

        // Trim (crop)
        const tStart = (pad?.sampleTrimStart ?? 0) * playBuf.duration
        const tDur   = Math.max(0.001, ((pad?.sampleTrimEnd ?? 1) - (pad?.sampleTrimStart ?? 0)) * playBuf.duration)

        const src = engine.ctx.createBufferSource()
        src.buffer = playBuf
        // Pitch via playbackRate — changes speed proportionally (classic behavior)
        src.playbackRate.value = Math.pow(2, (sound.pitch ?? 0) / 12)
        src.loop = !!pad?.sampleLoop
        if (pad?.sampleLoop) {
          src.loopStart = tStart
          src.loopEnd   = tStart + tDur
        }
        src.connect(gainNode)

        // Vibrato LFO (global, applied to each sound)
        let lfo: OscillatorNode | undefined
        let lfoGain: GainNode | undefined
        const vDepth = pad?.sampleVibratoDepth ?? 0
        if (vDepth > 0) {
          lfo     = engine.ctx.createOscillator()
          lfoGain = engine.ctx.createGain()
          lfo.frequency.value  = pad?.sampleVibratoRate ?? 5
          lfoGain.gain.value   = vDepth * 0.06
          lfo.connect(lfoGain)
          lfoGain.connect(src.playbackRate)
          lfo.start(engine.ctx.currentTime)
        }

        src.start(engine.ctx.currentTime, tStart, pad?.sampleLoop ? undefined : tDur)
        newSources.push({ src, gain: gainNode, lfo, lfoGain })
      }

      activeSources.current.set(pitch, newSources)

    } else if (instrument) {
      await engine.ctx.resume()
      playInstrumentNote(engine.ctx, engine.masterGain, instrument, pitch, velocity, engine.ctx.currentTime, 0.25)
    }

    setPressing(prev => new Set([...prev, pitch]))

    // Capture MIDI: remember every note while the transport runs
    if (engine.isPlaying) {
      captureStarts.current.set(pitch, { beat: engine.currentBeat, velocity })
    }

    if (padRecording && engine.isPlaying) {
      const pad = padsRef.current.find(p => p.pitch === pitch)
      const QBEATS: Record<string, number> = { '1/1': 4, '1/2': 2, '1/4': 1, '1/8': 0.5, '1/16': 0.25 }
      const rawBeat = engine.currentBeat
      const g = QBEATS[quantizeGridRef.current] ?? 1
      const beat = quantizeEnabledRef.current ? Math.round(rawBeat / g) * g : rawBeat
      noteStarts.current.set(pitch, { beat, sounds: pad?.customSounds ?? [], velocity })
    }
  }, [instrument, engine, padRecording])

  // Find (or create) the MIDI clip on this track that covers `beat`.
  const getOrCreateMidiClip = useCallback((beat: number): MidiClip => {
    const bar = projectRef.current.timeSignatureNum || 4
    const existing = projectRef.current.arrangementClips.find(c =>
      isMidiClip(c) && c.trackId === trackId && c.startBeat <= beat && beat < c.startBeat + c.durationBeats
    ) as MidiClip | undefined
    if (existing) return existing
    const isDrumTrack = projectRef.current.tracks.find(t => t.id === trackId)?.instrument.type === 'drum'
    const start = Math.floor(beat / bar) * bar
    const clip = makeMidiClip(trackId, isDrumTrack ? 'Pad Beat' : 'Pad Take', start, bar, { isDrumClip: isDrumTrack })
    dispatch({ type: 'ADD_CLIP', clip })
    return clip
  }, [trackId, dispatch])

  const endNote = useCallback((pitch: number) => {
    const sources = activeSources.current.get(pitch)
    if (sources?.length) {
      const pad     = padsRef.current.find(p => p.pitch === pitch)
      const sustain = pad?.sampleSustain ?? 0

      for (const active of sources) {
        try { active.lfo?.stop() } catch { /* */ }
        active.lfo?.disconnect()
        active.lfoGain?.disconnect()

        if (sustain > 0) {
          const now = engine.ctx.currentTime
          active.gain.gain.setValueAtTime(active.gain.gain.value, now)
          active.gain.gain.linearRampToValueAtTime(0, now + sustain)
          active.src.loop = false
          try { active.src.stop(now + sustain + 0.01) } catch { /* */ }
        } else {
          try { active.src.stop() } catch { /* */ }
          active.gain.disconnect()
        }
      }
      activeSources.current.delete(pitch)
    }

    setPressing(prev => { const n = new Set(prev); n.delete(pitch); return n })

    // Capture MIDI: close the remembered note
    const cap = captureStarts.current.get(pitch)
    if (cap) {
      captureStarts.current.delete(pitch)
      const endBeat = Math.max(cap.beat + 0.0625, engine.currentBeat)
      _midiCapture.push({ pitch, velocity: cap.velocity, startBeat: cap.beat, endBeat, wallEnd: Date.now() })
      pruneCapture()
      setCaptureCount(_midiCapture.length)
    }

    const started = noteStarts.current.get(pitch)
    if (!started) return
    noteStarts.current.delete(pitch)

    const pad     = padsRef.current.find(p => p.pitch === pitch)
    const sounds  = started.sounds

    // Instrument-backed note (no custom sounds) → record a real MIDI note the
    // piano roll can edit afterwards. Sample pads keep the audio-bounce below.
    if (sounds.length === 0) {
      const target = getOrCreateMidiClip(started.beat)
      const rel = started.beat - target.startBeat
      const durationBeats = Math.max(0.125, engine.currentBeat - started.beat)
      const note: MidiNote = {
        id: crypto.randomUUID(),
        pitch,
        startBeat: rel,
        durationBeats,
        velocity: started.velocity,
      }
      dispatch({ type: 'ADD_MIDI_NOTE', clipId: target.id, note })
      // Grow the clip when the note runs past its end (snap to whole bars)
      const bar = projectRef.current.timeSignatureNum || 4
      const noteEnd = rel + durationBeats
      if (noteEnd > target.durationBeats) {
        dispatch({ type: 'UPDATE_CLIP', clipId: target.id, patch: { durationBeats: Math.ceil(noteEnd / bar) * bar } })
      }
      return
    }

    const padTrackId = getOrCreatePadTrack(pitch, pad?.drumLabel ?? `Pad ${pitch}`)

    for (const sound of sounds) {
      const buf   = soundBuffers.current.get(sound.id)
      const entry = entriesRef.current.find(e => e.id === sound.id)
      if (!entry) continue
      const blob  = entry.audioBlob
      if (!blob && !buf) continue
      const audioUrl = URL.createObjectURL(blob ?? new Blob())
      const pressDuration = engine.currentBeat - started.beat
      const sustainBeats  = engine.secondsToBeats(pad?.sampleSustain ?? 0)
      const durationBeats = Math.max(0.0625, pressDuration + sustainBeats)
      const clip = makeAudioClip(padTrackId, `${pad?.drumLabel ?? 'Pad'} – ${entry.folder ? `${entry.folder} – ${entry.name}` : entry.name}`, started.beat, durationBeats, { audioUrl, bufferDuration: buf?.duration })
      dispatch({ type: 'ADD_CLIP', clip })
    }
  }, [engine, dispatch, getOrCreatePadTrack, getOrCreateMidiClip])

  // Latest handlers for the hardware-MIDI subscription
  useEffect(() => { startNoteRef.current = (p, v) => { void startNote(p, v) } }, [startNote])
  useEffect(() => { endNoteRef.current = endNote }, [endNote])

  // ── Capture MIDI → clip ──────────────────────────────────────────────────────
  function handleCaptureMidi() {
    pruneCapture()
    if (_midiCapture.length === 0) return
    const bar = projectRef.current.timeSignatureNum || 4
    const minStart = Math.min(..._midiCapture.map(n => n.startBeat))
    const maxEnd   = Math.max(..._midiCapture.map(n => n.endBeat))
    const clipStart = Math.floor(minStart / bar) * bar
    const isDrumTrack = projectRef.current.tracks.find(t => t.id === trackId)?.instrument.type === 'drum'
    const clip = makeMidiClip(
      trackId,
      'MIDI Capture',
      clipStart,
      Math.max(bar, Math.ceil((maxEnd - clipStart) / bar) * bar),
      { isDrumClip: isDrumTrack },
    )
    dispatch({ type: 'ADD_CLIP', clip })
    for (const n of _midiCapture) {
      dispatch({ type: 'ADD_MIDI_NOTE', clipId: clip.id, note: {
        id: crypto.randomUUID(),
        pitch: n.pitch,
        startBeat: n.startBeat - clipStart,
        durationBeats: Math.max(0.0625, n.endBeat - n.startBeat),
        velocity: n.velocity,
      }})
    }
    _midiCapture.length = 0
    setCaptureCount(0)
  }

  // ── Step sequencer tick handler ───────────────────────────────────────────────

  useEffect(() => {
    function onTick(e: Event) {
      const beat = (e as CustomEvent<{ beat: number }>).detail.beat
      seqBeatRef.current = beat

      // Trigger re-render only when the fastest step (1/32) changes
      const step32 = engine.isPlaying ? Math.floor(beat / 0.125) % (STEP_COUNT * 2) : -1
      if (step32 !== seqPrevStep32Ref.current) {
        seqPrevStep32Ref.current = step32
        setSeqTick(v => v + 1)
      }

      if (!engine.isPlaying) return

      for (const pad of padsRef.current) {
        const steps = drumStepsRef.current[pad.id]
        if (!steps) continue
        const rate      = rowRatesRef.current[pad.id] ?? '1/16'
        const stepBeats = RATE_BEATS[rate]
        const stepIndex = Math.floor(beat / stepBeats) % STEP_COUNT

        const lastStep = seqLastStepsRef.current[pad.id]
        if (lastStep === stepIndex) continue
        seqLastStepsRef.current[pad.id] = stepIndex

        if (!steps[stepIndex]) continue

        const prob = (stepProbsRef.current[pad.id] ?? {})[stepIndex] ?? 100
        if (prob < 100 && Math.random() * 100 >= prob) continue

        const ratchet = (stepRatchetsRef.current[pad.id] ?? {})[stepIndex] ?? 1
        fireDrumStep(pad, ratchet, stepBeats)
      }
    }

    engine.addEventListener('tick', onTick)
    return () => engine.removeEventListener('tick', onTick)
  }, [engine, fireDrumStep])

  // ── Click-outside deactivation ────────────────────────────────────────────────

  useEffect(() => {
    if (!active) return
    function onDocDown(e: MouseEvent) {
      const t = e.target as Element
      if (containerRef.current?.contains(t)) return
      if (t.closest?.('[data-pad-overlay]')) return
      setActive(false)
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [active])

  // ── Keyboard — single CAPTURE-phase handler ───────────────────────────────────

  useEffect(() => {
    if (!active) return

    function onCapture(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable) return

      if (e.key !== 'Escape') e.stopPropagation()

      if (e.type === 'keydown') {
        if (e.repeat) return
        const k = e.key.toLowerCase()

        if (e.key === 'Escape') { setActive(false); return }

        if (remapIdRef.current !== null) {
          e.preventDefault()
          const rid = remapIdRef.current
          setPads(prev => prev.map(p => {
            if (p.key === k) return { ...p, key: '' }
            if (p.id === rid) return { ...p, key: k }
            return p
          }))
          setRemapId(null)
          return
        }

        const keyMap = tabRef.current === 'pads' ? padKeyMapRef.current : pianoKeyMapRef.current
        const pitch  = keyMap[k] ?? keyMap[e.key]
        if (pitch === undefined) return
        e.preventDefault()
        startNote(pitch)
      }

      if (e.type === 'keyup') {
        const k      = e.key.toLowerCase()
        const keyMap = tabRef.current === 'pads' ? padKeyMapRef.current : pianoKeyMapRef.current
        const pitch  = keyMap[k] ?? keyMap[e.key]
        if (pitch === undefined) return
        endNote(pitch)
      }
    }

    document.addEventListener('keydown', onCapture, true)
    document.addEventListener('keyup',   onCapture, true)
    return () => {
      document.removeEventListener('keydown', onCapture, true)
      document.removeEventListener('keyup',   onCapture, true)
    }
  }, [active, startNote, endNote])

  // ── Header drag ───────────────────────────────────────────────────────────────

  const onHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    if (isFullscreen) return
    setActive(true)
    dragging.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y }
    function mm(ev: MouseEvent) {
      if (!dragging.current) return
      setPos({ x: dragging.current.ox + ev.clientX - dragging.current.sx,
               y: dragging.current.oy + ev.clientY - dragging.current.sy })
    }
    function mu() { dragging.current = null; document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu) }
    document.addEventListener('mousemove', mm)
    document.addEventListener('mouseup', mu)
    e.preventDefault()
  }, [pos, isFullscreen])

  // ── Resize handles ────────────────────────────────────────────────────────────

  const onResizeDown = useCallback((dir: string) => (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    resizing.current = { dir, sx: e.clientX, sy: e.clientY, ow: winSize.w, oh: winSize.h ?? containerRef.current?.offsetHeight ?? 400 }
    function mm(ev: MouseEvent) {
      if (!resizing.current) return
      const { dir: d, sx, sy, ow, oh } = resizing.current
      if (d.includes('e')) setWinSize(prev => ({ ...prev, w: Math.max(380, ow + ev.clientX - sx) }))
      if (d.includes('s')) setWinSize(prev => ({ ...prev, h: Math.max(280, oh + ev.clientY - sy) }))
    }
    function mu() { resizing.current = null; document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu) }
    document.addEventListener('mousemove', mm)
    document.addEventListener('mouseup', mu)
  }, [winSize])

  // ── Context-menu pad change ───────────────────────────────────────────────────

  const onPadChange = useCallback((patch: Partial<Pad>) => {
    if (!contextMenu) return
    const id = contextMenu.pad.id

    // Clear reverse cache if sounds or reverse setting changed
    if (patch.customSounds !== undefined || patch.sampleReverse !== undefined) {
      const p = padsRef.current.find(q => q.id === id)
      for (const s of (p?.customSounds ?? [])) {
        reversedBufs.current.delete(s.id)
      }
    }

    setPads(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p))
    setContextMenu(prev => prev ? { ...prev, pad: { ...prev.pad, ...patch } } : null)
  }, [contextMenu])

  // ── Sequencer helpers ─────────────────────────────────────────────────────────

  function toggleStep(padId: string, idx: number) {
    setDrumSteps(prev => {
      const row  = (prev[padId] ?? Array.from({ length: STEP_COUNT }, () => false)) as boolean[]
      const next = [...row] as boolean[]
      next[idx]  = !next[idx]
      return { ...prev, [padId]: next }
    })
  }

  function setStepProb(padId: string, idx: number, prob: number) {
    setStepProbabilities(prev => ({
      ...prev,
      [padId]: { ...(prev[padId] ?? {}), [idx]: Math.round(prob) },
    }))
  }

  function setStepRatchet(padId: string, idx: number, r: 1|2|4) {
    setStepRatchets(prev => ({
      ...prev,
      [padId]: { ...(prev[padId] ?? {}), [idx]: r },
    }))
  }

  function cycleRate(padId: string) {
    setRowRates(prev => {
      const cur  = prev[padId] ?? '1/16'
      const idx  = STEP_RATES.indexOf(cur)
      const next = STEP_RATES[(idx + 1) % STEP_RATES.length]
      return { ...prev, [padId]: next }
    })
  }

  const isRecActive = engine.isRecording && engine.isPlaying

  const containerStyle: React.CSSProperties = isFullscreen ? {
    position: 'fixed', left: 0, top: 0, width: '100vw', height: '100vh',
    borderRadius: 0, background: C.bg, border: `1px solid ${C.accent}`,
    boxShadow: 'none', zIndex: 2000, userSelect: 'none',
    display: 'flex', flexDirection: 'column',
  } : {
    position: 'fixed', left: pos.x, top: pos.y, width: winSize.w,
    height: winSize.h ?? undefined,
    background: C.bg,
    border: active ? `1px solid ${C.accent}` : `1px solid ${C.border}`,
    borderRadius: 10,
    boxShadow: active ? `0 12px 40px rgba(0,0,0,0.75), 0 0 0 2px rgba(61,143,239,0.35)` : '0 12px 40px rgba(0,0,0,0.75)',
    zIndex: 2000, userSelect: 'none',
    display: 'flex', flexDirection: 'column',
    transition: 'border-color 0.15s, box-shadow 0.15s',
    overflow: 'hidden',
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return createPortal(
    <>
      <div ref={containerRef} className={isFullscreen ? 'electron-nodrag' : undefined} style={containerStyle}>

        {/* Header */}
        <div onMouseDown={onHeaderMouseDown} style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', flexShrink: 0,
          background: active ? 'rgba(61,143,239,0.18)' : C.bgCard,
          borderRadius: isFullscreen ? 0 : '10px 10px 0 0',
          borderBottom: `1px solid ${active ? 'rgba(61,143,239,0.4)' : C.border}`,
          cursor: isFullscreen ? 'default' : 'grab', transition: 'background 0.15s',
        }}>
          <span style={{ fontSize: 13, color: C.text, fontWeight: 700 }}>⌨ Pad Input</span>
          {track && <span style={{ fontSize: 11, color: C.muted, borderLeft: `2px solid ${track.color ?? C.accent}`, paddingLeft: 6 }}>{track.name}</span>}
          {active
            ? <span style={{ fontSize: 10, fontWeight: 800, color: C.accent, background: 'rgba(61,143,239,0.15)', border: `1px solid rgba(61,143,239,0.4)`, borderRadius: 3, padding: '1px 6px', letterSpacing: '0.06em' }}>ACTIVE</span>
            : <span style={{ fontSize: 10, color: C.muted }}>click to activate</span>
          }
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5 }}>
            {/* Quantize */}
            <div style={{ display: 'flex', gap: 2, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
              <button
                onClick={() => setQuantizeEnabled(v => !v)}
                title="Quantize note starts to grid"
                style={{ padding: '2px 7px', borderRadius: 4, fontSize: 9, fontWeight: 800, border: `1px solid ${quantizeEnabled ? '#7c3aed' : C.border}`, background: quantizeEnabled ? 'rgba(124,58,237,0.12)' : 'transparent', color: quantizeEnabled ? '#a78bfa' : C.muted, cursor: 'pointer', letterSpacing: '0.04em' }}>
                Q
              </button>
              {quantizeEnabled && (
                <div style={{ display: 'flex', gap: 2 }}>
                  {(['1/16', '1/8', '1/4', '1/2', '1/1'] as const).map(g => (
                    <button key={g} onClick={() => setQuantizeGrid(g)}
                      style={{ padding: '2px 5px', borderRadius: 3, fontSize: 8, fontWeight: 700, border: `1px solid ${quantizeGrid === g ? '#7c3aed' : '#222'}`, background: quantizeGrid === g ? 'rgba(124,58,237,0.15)' : '#111', color: quantizeGrid === g ? '#a78bfa' : '#555', cursor: 'pointer' }}>
                      {g}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* Record toggle — right-click for countdown */}
            <button
              onClick={e => {
                e.stopPropagation()
                if (padRecording) { engine.stop(); setPadRecording(false) }
                else if (countdown !== null) {
                  if (countdownIvRef.current) clearInterval(countdownIvRef.current)
                  countdownIvRef.current = null
                  setCountdown(null)
                } else {
                  if (!engine.isPlaying) engine.play()
                  setPadRecording(true)
                }
              }}
              onContextMenu={e => {
                e.preventDefault(); e.stopPropagation()
                if (padRecording || countdown !== null) return
                const beatsPerBar = project.timeSignatureNum ?? 4
                const beatMs = 60000 / (project.tempo ?? 120)
                let remaining = beatsPerBar
                setCountdown(remaining)
                if (countdownIvRef.current) clearInterval(countdownIvRef.current)
                countdownIvRef.current = setInterval(() => {
                  remaining--
                  if (remaining <= 0) {
                    clearInterval(countdownIvRef.current!)
                    countdownIvRef.current = null
                    setCountdown(null)
                    if (!engine.isPlaying) engine.play()
                    setPadRecording(true)
                  } else {
                    setCountdown(remaining)
                  }
                }, beatMs)
              }}
              title={padRecording ? 'Stop recording' : countdown !== null ? 'Cancel countdown' : 'Click to record · Right-click for countdown'}
              style={{ display: 'flex', alignItems: 'center', gap: 3, background: padRecording ? 'rgba(239,68,68,0.14)' : countdown !== null ? 'rgba(239,68,68,0.07)' : 'transparent', border: `1px solid ${padRecording || countdown !== null ? C.red : C.border}`, color: padRecording || countdown !== null ? C.red : C.muted, cursor: 'pointer', fontSize: 10, padding: '2px 6px', borderRadius: 3, fontWeight: padRecording || countdown !== null ? 800 : 400, minWidth: 42, justifyContent: 'center' }}>
              {countdown !== null ? (
                <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 11 }}>{countdown}</span>
              ) : (
                <>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'currentColor', display: 'inline-block', flexShrink: 0 }} />
                  {padRecording ? 'STOP' : 'REC'}
                </>
              )}
            </button>
            {/* Capture MIDI — pull the last 30s of played notes into a clip */}
            <button
              onClick={e => { e.stopPropagation(); handleCaptureMidi() }}
              disabled={captureCount === 0}
              title={captureCount > 0
                ? `Capture the last ${captureCount} played note${captureCount === 1 ? '' : 's'} (up to 30s) into a MIDI clip`
                : 'Play some notes while the transport runs, then capture them here'}
              style={{ background: captureCount > 0 ? 'rgba(167,139,250,0.10)' : 'transparent', border: `1px solid ${captureCount > 0 ? 'rgba(167,139,250,0.5)' : C.border}`, color: captureCount > 0 ? '#a78bfa' : C.muted, cursor: captureCount > 0 ? 'pointer' : 'default', fontSize: 9, padding: '2px 6px', borderRadius: 3, fontWeight: 700, opacity: captureCount > 0 ? 1 : 0.55 }}>
              CAPTURE
            </button>
            {/* Hardware MIDI status */}
            {midiDevices.length > 0 && (
              <span
                title={`MIDI input: ${midiDevices.join(', ')}`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 8, color: '#4ade80', maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ade80', flexShrink: 0 }} />
                {midiDevices[0]}{midiDevices.length > 1 ? ` +${midiDevices.length - 1}` : ''}
              </span>
            )}
            {/* BPM */}
            <button
              onClick={e => { e.stopPropagation(); const t = prompt('BPM:', String(project.tempo)); if (t) { const n = parseFloat(t); if (!isNaN(n) && n > 0) dispatch({ type: 'SET_TEMPO', tempo: n }) } }}
              title="BPM — click to edit"
              style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, cursor: 'pointer', fontSize: 10, padding: '2px 6px', borderRadius: 3, fontFamily: 'monospace' }}>
              {project.tempo} BPM
            </button>
            {/* Metronome */}
            <button
              onClick={e => { e.stopPropagation(); const next = !metronome; setMetronome(next); engine.setMetronome(next) }}
              title={metronome ? 'Metronome on' : 'Metronome off'}
              style={{ background: metronome ? `${C.accent}22` : 'transparent', border: `1px solid ${metronome ? C.accent : C.border}`, color: metronome ? C.accent : C.muted, cursor: 'pointer', fontSize: 13, padding: '1px 5px', borderRadius: 3 }}>
              ♩
            </button>
            <button onClick={e => { e.stopPropagation(); setIsFullscreen(v => !v) }}
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, cursor: 'pointer', fontSize: 11, padding: '2px 6px', borderRadius: 3 }}>
              {isFullscreen ? '⊡' : '⊞'}
            </button>
            {!isFullscreen && <span style={{ fontSize: 10, color: C.muted }}>drag to move</span>}
            <button onClick={e => { e.stopPropagation(); onClose() }}
              style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '0 2px' }}>×</button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 2, padding: '6px 12px 0', background: C.bgCard, borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          {(['pads', 'keyboard', 'voice'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '4px 14px', fontSize: 12, borderRadius: '4px 4px 0 0',
              border: `1px solid ${tab === t ? C.border : 'transparent'}`, borderBottom: 'none',
              background: tab === t ? C.bg : 'transparent',
              color: tab === t ? C.text : C.muted, cursor: 'pointer', fontWeight: tab === t ? 600 : 400,
              textTransform: 'capitalize',
            }}>{t}</button>
          ))}
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>

          {tab === 'pads' && (
            <div style={{ padding: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                {pads.map(pad => {
                  const isAct        = pressing.has(pad.pitch)
                  const isRemapping  = remapId === pad.id
                  const hasCustom    = (pad.customSounds?.length ?? 0) > 0
                  const soundCount   = pad.customSounds?.length ?? 0
                  const isFxMode     = pad.mode === 'effect-toggle'
                  const fxTrack      = isFxMode && pad.effectTarget ? project.tracks.find(t => t.id === pad.effectTarget!.trackId) : null
                  const fxEffect     = fxTrack ? fxTrack.effects.find(e => e.id === pad.effectTarget!.effectId) : null
                  const fxEnabled    = !!(fxEffect?.params as { enabled?: boolean } | undefined)?.enabled
                  return (
                    <button
                      key={pad.id}
                      onMouseDown={e => {
                        e.stopPropagation()
                        setActive(true)
                        if (e.button === 0) startNote(pad.pitch)
                      }}
                      onMouseUp={e => { e.stopPropagation(); if (e.button === 0) endNote(pad.pitch) }}
                      onMouseLeave={() => endNote(pad.pitch)}
                      onContextMenu={e => {
                        e.preventDefault(); e.stopPropagation()
                        setContextMenu({ pad, x: e.clientX, y: e.clientY })
                      }}
                      onClick={e => e.stopPropagation()}
                      title="Right-click to edit pad"
                      style={{
                        height: 76, display: 'flex', flexDirection: 'column', alignItems: 'center',
                        justifyContent: 'center', gap: 4, borderRadius: 6, position: 'relative',
                        border: `1px solid ${isRemapping ? C.accent : isAct ? '#666' : isFxMode ? (fxEnabled ? 'rgba(34,197,94,0.5)' : 'rgba(239,68,68,0.3)') : hasCustom ? 'rgba(61,143,239,0.4)' : C.border}`,
                        background: isRemapping ? `${C.accent}30` : isAct ? 'rgba(255,255,255,0.12)' : isFxMode ? (fxEnabled ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.06)') : hasCustom ? 'rgba(61,143,239,0.07)' : C.bgCard,
                        color: isAct ? '#fff' : C.text, cursor: 'pointer',
                        transition: 'background 50ms, border-color 50ms',
                      }}
                    >
                      {isFxMode && <span style={{ position: 'absolute', top: 5, right: 6, fontSize: 9, fontWeight: 800, color: fxEnabled ? C.green : '#ef4444' }}>{fxEnabled ? 'ON' : 'OFF'}</span>}
                      {!isFxMode && hasCustom && !isAct && <span style={{ position: 'absolute', top: 5, right: 6, width: 6, height: 6, borderRadius: '50%', background: C.accent }} />}
                      {!isFxMode && pad.sampleLoop    && <span style={{ position: 'absolute', top: 5, left: 6, fontSize: 9, color: C.green }}>↻</span>}
                      {!isFxMode && pad.sampleReverse && <span style={{ position: 'absolute', top: 5, left: pad.sampleLoop ? 18 : 6, fontSize: 9, color: C.accent }}>◁</span>}
                      {!isFxMode && (pad.sampleVibratoDepth ?? 0) > 0 && <span style={{ position: 'absolute', bottom: 5, right: 6, fontSize: 9, color: C.yellow }}>~</span>}
                      {editingLabelId === pad.id ? (
                        <input
                          autoFocus
                          value={labelDraft}
                          onChange={e => setLabelDraft(e.target.value)}
                          onKeyDown={e => {
                            e.stopPropagation()
                            if (e.key === 'Enter' || e.key === 'Escape') {
                              if (e.key === 'Enter' && labelDraft.trim()) {
                                setPads(prev => prev.map(p => p.id === pad.id ? { ...p, drumLabel: labelDraft.trim() } : p))
                              }
                              setEditingLabelId(null)
                            }
                          }}
                          onBlur={() => {
                            if (labelDraft.trim()) setPads(prev => prev.map(p => p.id === pad.id ? { ...p, drumLabel: labelDraft.trim() } : p))
                            setEditingLabelId(null)
                          }}
                          onClick={e => e.stopPropagation()}
                          onMouseDown={e => e.stopPropagation()}
                          style={{ width: '90%', fontSize: 11, fontWeight: 600, textAlign: 'center', background: 'transparent', border: `1px solid ${C.accent}`, borderRadius: 3, color: C.text, padding: '1px 3px', outline: 'none' }}
                        />
                      ) : (
                        <span
                          style={{ fontSize: 12, fontWeight: 600 }}
                          onDoubleClick={e => { e.stopPropagation(); setLabelDraft(pad.drumLabel); setEditingLabelId(pad.id) }}
                          title="Double-click to rename"
                        >
                          {isRemapping ? '…press key' : pad.drumLabel}
                        </span>
                      )}
                      {isFxMode && fxEffect && !isRemapping && (
                        <span style={{ fontSize: 9, color: '#888', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1 }}>
                          {fxTrack?.name} · {fxEffect.type}
                        </span>
                      )}
                      {!isFxMode && hasCustom && !isRemapping && (
                        <span style={{ fontSize: 9, color: C.accent, maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1 }}>
                          {soundCount === 1 ? pad.customSounds![0].name : `${soundCount} sounds`}
                        </span>
                      )}
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                        background: C.bgDark, border: `1px solid #3a3a3a`,
                        color: pad.key ? '#9c9c9c' : '#444', fontFamily: 'monospace',
                      }}>{pad.key ? pad.key.toUpperCase() : '–'}</span>
                    </button>
                  )
                })}
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
                <button
                  onClick={() => {
                    const lastPitch = pads.length > 0 ? pads[pads.length - 1].pitch + 1 : 60
                    setPads(prev => [...prev, { id: crypto.randomUUID(), pitch: lastPitch, drumLabel: `Pad ${prev.length + 1}`, key: '' }])
                  }}
                  style={{ fontSize: 11, padding: '4px 12px', borderRadius: 4, border: `1px dashed ${C.border}`, background: 'transparent', color: C.muted, cursor: 'pointer' }}
                >+ Add Pad</button>
                {pads.length > 4 && (
                  <button onClick={() => setPads(prev => prev.slice(0, -1))}
                    style={{ fontSize: 11, padding: '4px 8px', borderRadius: 4, border: `1px solid ${C.border}`, background: 'transparent', color: C.muted, cursor: 'pointer' }}>
                    − Remove Last
                  </button>
                )}
                <span style={{ fontSize: 10, color: '#444', marginLeft: 'auto' }}>Right-click a pad to edit</span>
                <div style={{ position: 'relative' }}>
                  <button
                    onClick={() => { setSavedPresets(getPadPresets()); setSaveName(''); setShowSaveMenu(v => !v) }}
                    title="Save / Load pad layout"
                    style={{ background: showSaveMenu ? `${C.accent}22` : 'transparent', border: `1px solid ${showSaveMenu ? C.accent : C.border}`, color: showSaveMenu ? C.accent : C.muted, cursor: 'pointer', fontSize: 10, padding: '3px 10px', borderRadius: 4, fontWeight: 700 }}>
                    Layouts
                  </button>
                  {showSaveMenu && (
                    <div ref={saveMenuRef} style={{
                      position: 'absolute', bottom: 'calc(100% + 4px)', right: 0, width: 200, zIndex: 200,
                      background: '#141414', border: `1px solid ${C.border}`, borderRadius: 6,
                      boxShadow: '0 8px 24px rgba(0,0,0,0.7)', padding: '6px 0',
                    }}>
                      <div style={{ padding: '4px 10px 6px', fontSize: 9, color: '#555', fontWeight: 700, letterSpacing: '0.07em', borderBottom: '1px solid #1e1e1e' }}>PAD LAYOUTS</div>
                      {savedPresets.length === 0 && <div style={{ padding: '6px 10px', fontSize: 10, color: '#444' }}>No saved layouts</div>}
                      {savedPresets.map(p => (
                        <div key={p.id} style={{ display: 'flex', alignItems: 'center' }}>
                          <button onClick={() => { setPads(p.pads as Pad[]); setShowSaveMenu(false) }}
                            style={{ flex: 1, textAlign: 'left', padding: '5px 10px', fontSize: 10, background: 'transparent', border: 'none', color: '#bbb', cursor: 'pointer' }}>
                            {p.name}
                          </button>
                          <button onClick={() => { deletePadPreset(p.id); setSavedPresets(getPadPresets()) }}
                            style={{ padding: '4px 6px', background: 'transparent', border: 'none', color: '#555', cursor: 'pointer', fontSize: 11 }}>✕</button>
                        </div>
                      ))}
                      <div style={{ borderTop: '1px solid #1e1e1e', margin: '4px 0' }} />
                      <div style={{ padding: '4px 10px', display: 'flex', gap: 4 }}>
                        <input placeholder="Layout name" value={saveName} onChange={e => setSaveName(e.target.value)}
                          style={{ flex: 1, background: '#111', border: '1px solid #333', borderRadius: 3, color: '#ccc', fontSize: 10, padding: '3px 5px' }} />
                        <button
                          onClick={() => {
                            const name = saveName.trim() || `Layout ${savedPresets.length + 1}`
                            savePadPreset(name, pads)
                            setSavedPresets(getPadPresets())
                            setSaveName('')
                          }}
                          style={{ padding: '3px 8px', fontSize: 10, background: C.accent, border: 'none', borderRadius: 3, color: '#fff', cursor: 'pointer', fontWeight: 700 }}>
                          Save
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* ── Drum Step Sequencer ─────────────────────────────────────── */}
              <div style={{ marginTop: 12, borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
                <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8, fontWeight: 700 }}>
                  Step Sequencer
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {pads.map(pad => {
                    const rate        = rowRates[pad.id] ?? '1/16'
                    const steps       = drumSteps[pad.id] ?? (Array.from({ length: STEP_COUNT }, () => false) as boolean[])
                    const probs       = stepProbabilities[pad.id] ?? {}
                    const ratchetsRow = stepRatchets[pad.id] ?? {}
                    const rowCurrent  = engine.isPlaying
                      ? Math.floor(seqBeatRef.current / RATE_BEATS[rate]) % STEP_COUNT
                      : -1
                    return (
                      <div key={pad.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {/* Row label + rate badge */}
                        <div style={{ width: 60, flexShrink: 0 }}>
                          <div style={{
                            fontSize: 9, color: C.text, overflow: 'hidden',
                            textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 2,
                          }}>{pad.drumLabel}</div>
                          <button
                            onClick={() => cycleRate(pad.id)}
                            title="Click to cycle step rate"
                            style={{
                              fontSize: 8, padding: '1px 5px', borderRadius: 3, cursor: 'pointer',
                              border: `1px solid ${rate !== '1/16' ? C.accent : C.border}`,
                              background: rate !== '1/16' ? `${C.accent}22` : 'transparent',
                              color: rate !== '1/16' ? C.accent : C.muted,
                              fontFamily: 'monospace', fontWeight: 700,
                            }}
                          >{rate}</button>
                        </div>

                        {/* Step cells */}
                        <div style={{ display: 'flex', flex: 1, gap: 1 }}>
                          {Array.from({ length: STEP_COUNT }, (_, i) => {
                            const isOn    = steps[i] ?? false
                            const prob    = probs[i] ?? 100
                            const ratch   = ratchetsRow[i] ?? 1
                            const isCurr  = rowCurrent === i
                            const beatDiv = i > 0 && i % 4 === 0  // gap before each beat group
                            const alpha   = isOn ? (prob >= 100 ? 1 : Math.max(0.25, prob / 100)) : 1
                            return (
                              <div
                                key={i}
                                title={`Step ${i + 1}${isOn ? ` · ${prob}%` : ''}${ratch > 1 ? ` · ×${ratch}` : ''} — click: toggle · right-click: options`}
                                onClick={() => toggleStep(pad.id, i)}
                                onContextMenu={e => {
                                  e.preventDefault()
                                  setStepPopover({ padId: pad.id, stepIndex: i, x: e.clientX, y: e.clientY })
                                }}
                                style={{
                                  flex: 1,
                                  height: 18,
                                  borderRadius: 2,
                                  cursor: 'pointer',
                                  position: 'relative',
                                  border: `1px solid ${isCurr ? 'rgba(255,255,255,0.55)' : beatDiv ? '#3a3a3a' : C.border}`,
                                  background: isOn
                                    ? `rgba(61,143,239,${alpha * (isCurr ? 1 : 0.82)})`
                                    : isCurr
                                    ? 'rgba(255,255,255,0.07)'
                                    : C.bgCard,
                                  marginLeft: beatDiv ? 3 : 0,
                                  boxSizing: 'border-box' as const,
                                  overflow: 'hidden',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  transition: 'background 40ms',
                                }}
                              >
                                {/* Ratchet tick marks */}
                                {isOn && ratch > 1 && (
                                  <div style={{ display: 'flex', gap: 1, height: '55%', alignItems: 'stretch' }}>
                                    {Array.from({ length: ratch }, (_, ri) => (
                                      <div key={ri} style={{ width: 1, background: 'rgba(255,255,255,0.65)', borderRadius: 1 }} />
                                    ))}
                                  </div>
                                )}
                                {/* Probability label (when < 100 and ratchet=1) */}
                                {isOn && prob < 100 && ratch === 1 && (
                                  <span style={{
                                    position: 'absolute', bottom: 1, right: 1,
                                    fontSize: 6, color: 'rgba(255,255,255,0.75)',
                                    fontFamily: 'monospace', lineHeight: 1,
                                    pointerEvents: 'none',
                                  }}>
                                    {prob}
                                  </span>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {tab === 'keyboard' && (
            <div style={{ padding: '12px 12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                <button onClick={() => setOctave(o => Math.max(0, o - 1))}
                  style={{ padding: '3px 10px', borderRadius: 4, border: `1px solid ${C.border}`, background: C.bgCard, color: C.text, cursor: 'pointer', fontSize: 13 }}>◀</button>
                <span style={{ fontSize: 12, color: C.muted, minWidth: 60, textAlign: 'center' }}>Oct {octave}</span>
                <button onClick={() => setOctave(o => Math.min(8, o + 1))}
                  style={{ padding: '3px 10px', borderRadius: 4, border: `1px solid ${C.border}`, background: C.bgCard, color: C.text, cursor: 'pointer', fontSize: 13 }}>▶</button>
                <span style={{ fontSize: 10, color: '#444', marginLeft: 8 }}>Z–M lower · Q–U upper</span>
              </div>

              {[octave, octave + 1].map(oct => {
                const base = (oct + 1) * 12
                const WW = 30, WH = 90, BW = 18, BH = 56
                return (
                  <div key={oct} style={{ display: 'inline-block', position: 'relative', width: WW * 7, height: WH, marginRight: 2 }}>
                    {WHITE_ST.map((st, i) => {
                      const pitch = base + st
                      const act = pressing.has(pitch)
                      return (
                        <div key={st}
                          onMouseDown={e => {
                            e.stopPropagation()
                            setActive(true)
                            startNote(pitch)
                          }}
                          onMouseUp={e => { e.stopPropagation(); endNote(pitch) }}
                          onMouseLeave={() => endNote(pitch)}
                          style={{ position: 'absolute', left: i * WW, top: 0, width: WW - 1, height: WH, background: act ? C.accent : '#d8d8d8', borderRadius: '0 0 4px 4px', border: '1px solid #555', borderTop: 'none', cursor: 'pointer', boxSizing: 'border-box', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 4 }}>
                          {st === 0 && <span style={{ fontSize: 9, color: '#666', fontWeight: 700 }}>C{oct}</span>}
                        </div>
                      )
                    })}
                    {BLACK_KEYS.map(({ st, pos: bpos }) => {
                      const pitch = base + st
                      const act = pressing.has(pitch)
                      return (
                        <div key={st}
                          onMouseDown={e => {
                            e.stopPropagation(); e.preventDefault()
                            setActive(true)
                            startNote(pitch)
                          }}
                          onMouseUp={e => { e.stopPropagation(); endNote(pitch) }}
                          onMouseLeave={() => endNote(pitch)}
                          style={{ position: 'absolute', left: bpos * WW + (WW - BW) / 2, top: 0, width: BW, height: BH, zIndex: 1, background: act ? C.accent : '#222', borderRadius: '0 0 3px 3px', border: '1px solid #111', borderTop: 'none', cursor: 'pointer', boxSizing: 'border-box' }} />
                      )
                    })}
                  </div>
                )
              })}

              <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {Object.entries(pianoKeyMap).slice(0, 12).map(([k, p]) => (
                  <span key={k} style={{ fontSize: 9, padding: '1px 4px', borderRadius: 2, background: C.bgCard, border: `1px solid ${C.border}`, color: C.muted, fontFamily: 'monospace' }}>
                    {k.toUpperCase()}={pitchToName(p)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {tab === 'voice' && (
            <PadVoice
              quantizeEnabled={quantizeEnabled}
              quantizeGrid={quantizeGrid}
              setQuantizeEnabled={setQuantizeEnabled}
              setQuantizeGrid={setQuantizeGrid}
            />
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '6px 12px', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          {active
            ? <span style={{ fontSize: 10, color: C.muted }}>Esc or click outside to release · Arm track + record to capture</span>
            : <span style={{ fontSize: 10, color: '#444' }}>Click a pad or the header to activate keyboard input</span>
          }
          {isRecActive && <span style={{ fontSize: 10, color: C.red, fontWeight: 700, flexShrink: 0, marginLeft: 8 }}>Recording…</span>}
        </div>

        {/* Resize handles */}
        {!isFullscreen && <>
          <div onMouseDown={onResizeDown('e')}  style={{ position: 'absolute', right: 0, top: 12, bottom: 12, width: 6, cursor: 'ew-resize' }} />
          <div onMouseDown={onResizeDown('s')}  style={{ position: 'absolute', bottom: 0, left: 12, right: 12, height: 6, cursor: 'ns-resize' }} />
          <div onMouseDown={onResizeDown('se')} style={{ position: 'absolute', right: 0, bottom: 0, width: 14, height: 14, cursor: 'nwse-resize' }} />
        </>}
      </div>

      {/* Right-click pad popover */}
      {contextMenu && (
        <PadPopover
          pad={contextMenu.pad}
          anchor={{ x: contextMenu.x, y: contextMenu.y }}
          onRemap={() => {
            setRemapId(contextMenu.pad.id)
            setActive(true)
          }}
          onPadChange={onPadChange}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Step cell right-click popover */}
      {stepPopover && (
        <StepCellPopover
          x={stepPopover.x}
          y={stepPopover.y}
          probability={(stepProbabilities[stepPopover.padId] ?? {})[stepPopover.stepIndex] ?? 100}
          ratchet={(stepRatchets[stepPopover.padId] ?? {})[stepPopover.stepIndex] ?? 1}
          onProbChange={v  => setStepProb(stepPopover.padId, stepPopover.stepIndex, v)}
          onRatchetChange={r => setStepRatchet(stepPopover.padId, stepPopover.stepIndex, r)}
          onClose={() => setStepPopover(null)}
        />
      )}
    </>,
    document.body
  )
}
