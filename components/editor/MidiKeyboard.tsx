'use client'
import { useEffect, useRef, useState, useMemo } from 'react'
import { playMelodicNote } from '@/lib/instrument-synth'
import type { BeatType } from '@/lib/beat-analyzer'

// ── Piano layout ──────────────────────────────────────────────────────────────
const MIDI_MIN = 21  // A0
const MIDI_MAX = 108 // C8
const BLACK_SET = new Set([1, 3, 6, 8, 10])  // semitones (from C) that are black

function isBlack(midi: number) { return BLACK_SET.has(((midi % 12) + 12) % 12) }

const WHITE_MIDIS: number[] = []
const WHITE_INDEX: Record<number, number> = {}
const BLACK_X_FACTOR: Record<number, number> = {}  // whites-before × wkw = center x

;(() => {
  let wCount = 0
  for (let m = MIDI_MIN; m <= MIDI_MAX; m++) {
    if (isBlack(m)) {
      BLACK_X_FACTOR[m] = wCount  // wCount whites came before this black → center at wCount*wkw
    } else {
      WHITE_INDEX[m] = WHITE_MIDIS.length
      WHITE_MIDIS.push(m)
      wCount++
    }
  }
})()
const TOTAL_WHITES = WHITE_MIDIS.length  // 52

// ── Scales ────────────────────────────────────────────────────────────────────
const SCALES: Record<string, { name: string; intervals: number[] }> = {
  none:       { name: 'None',             intervals: [] },
  major:      { name: 'Major',            intervals: [0,2,4,5,7,9,11] },
  minor:      { name: 'Natural Minor',    intervals: [0,2,3,5,7,8,10] },
  harmminor:  { name: 'Harmonic Minor',   intervals: [0,2,3,5,7,8,11] },
  dorian:     { name: 'Dorian',           intervals: [0,2,3,5,7,9,10] },
  phrygian:   { name: 'Phrygian',         intervals: [0,1,3,5,7,8,10] },
  lydian:     { name: 'Lydian',           intervals: [0,2,4,6,7,9,11] },
  mixolydian: { name: 'Mixolydian',       intervals: [0,2,4,5,7,9,10] },
  locrian:    { name: 'Locrian',          intervals: [0,1,3,5,6,8,10] },
  pentatonic: { name: 'Maj Pentatonic',   intervals: [0,2,4,7,9] },
  minpenta:   { name: 'Min Pentatonic',   intervals: [0,3,5,7,10] },
  blues:      { name: 'Blues',            intervals: [0,3,5,6,7,10] },
  chromatic:  { name: 'Chromatic',        intervals: [0,1,2,3,4,5,6,7,8,9,10,11] },
}

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']

// ── Chord detection ───────────────────────────────────────────────────────────
const CHORD_PATTERNS: Array<{ intervals: number[]; suffix: string }> = [
  { intervals: [0,4,7],       suffix: '' },
  { intervals: [0,3,7],       suffix: 'm' },
  { intervals: [0,3,6],       suffix: 'dim' },
  { intervals: [0,4,8],       suffix: 'aug' },
  { intervals: [0,2,7],       suffix: 'sus2' },
  { intervals: [0,5,7],       suffix: 'sus4' },
  { intervals: [0,4,7,11],    suffix: 'maj7' },
  { intervals: [0,4,7,10],    suffix: '7' },
  { intervals: [0,3,7,10],    suffix: 'm7' },
  { intervals: [0,3,6,10],    suffix: 'm7b5' },
  { intervals: [0,3,6,9],     suffix: 'dim7' },
  { intervals: [0,4,7,9],     suffix: '6' },
  { intervals: [0,3,7,9],     suffix: 'm6' },
  { intervals: [0,4,7,11,14], suffix: 'maj9' },
  { intervals: [0,4,7,10,14], suffix: '9' },
  { intervals: [0,3,7,10,14], suffix: 'm9' },
]

function detectChord(midis: number[]): string {
  if (midis.length < 2) return ''
  const pcs = [...new Set(midis.map(m => ((m % 12) + 12) % 12))].sort((a, b) => a - b)
  if (pcs.length < 2) return ''
  for (let rot = 0; rot < pcs.length; rot++) {
    const root = pcs[rot]
    const intervals = pcs.map(pc => ((pc - root) + 12) % 12).sort((a, b) => a - b)
    for (const p of CHORD_PATTERNS) {
      if (p.intervals.length === intervals.length && p.intervals.every((v, i) => v === intervals[i]))
        return NOTE_NAMES[root] + p.suffix
    }
  }
  return ''
}

// ── Computer keyboard → semitone from C ───────────────────────────────────────
// Layout: A W S E D F T G Y H U J  (matches piano note order C C# D D# E F F# G G# A A# B)
//         K O L                    (next octave C C# D)
const KB_TO_SEMI: Record<string, number> = {
  a:0, w:1, s:2, e:3, d:4, f:5, t:6, g:7, y:8, h:9, u:10, j:11,
  k:12, o:13, l:14,
}

// ── Instruments ───────────────────────────────────────────────────────────────
const INSTRUMENTS: Array<{ type: BeatType; label: string }> = [
  { type: 'piano-grand',    label: 'Grand Piano' },
  { type: 'piano-electric', label: 'E. Piano' },
  { type: 'piano-rhodes',   label: 'Rhodes' },
  { type: 'synth-lead',     label: 'Synth Lead' },
  { type: 'synth-pad',      label: 'Synth Pad' },
  { type: 'synth-bass',     label: 'Synth Bass' },
  { type: 'synth-arp',      label: 'Synth Arp' },
  { type: 'guitar-acoustic',label: 'Acoustic Gtr' },
  { type: 'guitar-electric',label: 'Electric Gtr' },
  { type: 'guitar-nylon',   label: 'Nylon Gtr' },
]

// ── Props ─────────────────────────────────────────────────────────────────────
interface MidiKeyboardProps {
  open: boolean
  onClose: () => void
  onNoteOn?: (midi: number, velocity: number) => void
  onNoteOff?: (midi: number) => void
  bpm?: number
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function MidiKeyboard({ open, onClose, onNoteOn, onNoteOff, bpm = 120 }: MidiKeyboardProps) {
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const audioCtx   = useRef<AudioContext | null>(null)

  // Note state — refs for event handlers, state for re-render/canvas
  const activeRef    = useRef<Set<number>>(new Set())
  const sustainedRef = useRef<Set<number>>(new Set())
  const sustainHeld  = useRef(false)
  const [renderTick, setRenderTick] = useState(0)  // increment to trigger canvas redraw
  const [chord, setChord] = useState('')

  // Settings (state for UI, refs for handlers)
  const [instrument, setInstrument] = useState<BeatType>('piano-grand')
  const instrRef    = useRef<BeatType>('piano-grand')
  const [octave, setOctave]   = useState(4)
  const octaveRef   = useRef(4)
  const [volume, setVolume]   = useState(0.85)
  const volRef      = useRef(0.85)
  const [sustain, setSustain] = useState(false)

  // Scale
  const [scaleRoot, setScaleRoot] = useState(0)
  const [scaleKey,  setScaleKey]  = useState('none')

  // Arpeggiator
  const [arpOn,   setArpOn]   = useState(false)
  const [arpMode, setArpMode] = useState<'up'|'down'|'updown'|'random'>('up')
  const [arpRate, setArpRate] = useState<'1/4'|'1/8'|'1/16'|'1/32'>('1/8')
  const arpOnRef    = useRef(false)
  const arpModeRef  = useRef<'up'|'down'|'updown'|'random'>('up')
  const arpRateRef  = useRef<'1/4'|'1/8'|'1/16'|'1/32'>('1/8')
  const arpHeld     = useRef<number[]>([])
  const arpIdxRef   = useRef(0)
  const arpDirRef   = useRef(1)
  const arpTimer    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bpmRef      = useRef(120)

  // Touch & mouse
  const touchMap    = useRef<Map<number, number>>(new Map())  // touchId → midi
  const mouseDown   = useRef(false)
  const lastMouse   = useRef<number | null>(null)

  // Shortcuts overlay
  const [showHelp, setShowHelp] = useState(false)

  // Sync refs
  useEffect(() => { instrRef.current  = instrument }, [instrument])
  useEffect(() => { octaveRef.current = octave     }, [octave])
  useEffect(() => { volRef.current    = volume     }, [volume])
  useEffect(() => { arpOnRef.current  = arpOn      }, [arpOn])
  useEffect(() => { arpModeRef.current = arpMode   }, [arpMode])
  useEffect(() => { arpRateRef.current = arpRate   }, [arpRate])
  useEffect(() => { bpmRef.current    = bpm        }, [bpm])

  // ── Audio ─────────────────────────────────────────────────────────────────
  function getCtx(): AudioContext {
    if (!audioCtx.current || audioCtx.current.state === 'closed') {
      audioCtx.current = new AudioContext()
    }
    if (audioCtx.current.state === 'suspended') audioCtx.current.resume()
    return audioCtx.current
  }

  function triggerNote(midi: number, vel01: number) {
    const ctx = getCtx()
    playMelodicNote(ctx, instrRef.current, midi, ctx.currentTime, vel01 * volRef.current)
  }

  function noteOn(midi: number, velocity: number) {
    if (midi < MIDI_MIN || midi > MIDI_MAX) return
    if (activeRef.current.has(midi)) return
    activeRef.current.add(midi)
    sustainedRef.current.delete(midi)
    triggerNote(midi, velocity / 127)
    onNoteOn?.(midi, velocity)
    setChord(detectChord([...activeRef.current]))
    setRenderTick(t => t + 1)
  }

  function noteOff(midi: number) {
    if (!activeRef.current.has(midi)) return
    activeRef.current.delete(midi)
    if (sustainHeld.current) {
      sustainedRef.current.add(midi)
    }
    onNoteOff?.(midi)
    setChord(detectChord([...activeRef.current]))
    setRenderTick(t => t + 1)
  }

  function releaseSustain() {
    sustainedRef.current.forEach(m => onNoteOff?.(m))
    sustainedRef.current.clear()
    setRenderTick(t => t + 1)
  }

  function allOff() {
    activeRef.current.forEach(m => onNoteOff?.(m))
    sustainedRef.current.forEach(m => onNoteOff?.(m))
    activeRef.current.clear()
    sustainedRef.current.clear()
    setChord('')
    setRenderTick(t => t + 1)
  }

  // ── Arpeggiator ───────────────────────────────────────────────────────────
  function arpMs() {
    const beatMs = 60000 / bpmRef.current
    return beatMs * ({ '1/4': 1, '1/8': 0.5, '1/16': 0.25, '1/32': 0.125 }[arpRateRef.current] ?? 0.5)
  }

  function arpTick() {
    const held = arpHeld.current
    if (held.length === 0) return
    const sorted = [...held].sort((a, b) => a - b)
    const notes  = arpModeRef.current === 'down' ? [...sorted].reverse() : sorted

    let midi: number
    if (arpModeRef.current === 'random') {
      midi = notes[Math.floor(Math.random() * notes.length)]
    } else {
      let idx = arpIdxRef.current
      if (idx >= notes.length) idx = 0
      midi = notes[idx]

      if (arpModeRef.current === 'updown') {
        arpIdxRef.current += arpDirRef.current
        if (arpIdxRef.current >= notes.length || arpIdxRef.current < 0) {
          arpDirRef.current *= -1
          arpIdxRef.current = Math.max(0, Math.min(notes.length - 1, arpIdxRef.current + arpDirRef.current))
        }
      } else {
        arpIdxRef.current = (idx + 1) % notes.length
      }
    }

    triggerNote(midi, 0.9)
    arpTimer.current = setTimeout(arpTick, arpMs())
  }

  function startArp() {
    if (arpTimer.current) clearTimeout(arpTimer.current)
    arpIdxRef.current = 0
    arpTimer.current = setTimeout(arpTick, arpMs())
  }
  function stopArp() {
    if (arpTimer.current) { clearTimeout(arpTimer.current); arpTimer.current = null }
  }

  // ── Hit detection ─────────────────────────────────────────────────────────
  function getMidi(cx: number, cy: number): number | null {
    const canvas = canvasRef.current
    if (!canvas) return null
    const W = canvas.offsetWidth, H = canvas.offsetHeight
    const wkw = W / TOTAL_WHITES
    const bkw = wkw * 0.60
    const bkh = H * 0.62

    if (cy < bkh) {
      for (let midi = MIDI_MIN; midi <= MIDI_MAX; midi++) {
        if (!isBlack(midi)) continue
        const bx = BLACK_X_FACTOR[midi] * wkw - bkw / 2
        if (cx >= bx && cx < bx + bkw) return midi
      }
    }
    const wi = Math.floor(cx / wkw)
    return wi >= 0 && wi < WHITE_MIDIS.length ? WHITE_MIDIS[wi] : null
  }

  function velFromY(cy: number): number {
    const H = canvasRef.current?.offsetHeight ?? 120
    return Math.round(30 + (cy / H) * 97)
  }

  function canvasXY(e: React.MouseEvent) {
    const r = canvasRef.current!.getBoundingClientRect()
    return { cx: e.clientX - r.left, cy: e.clientY - r.top }
  }
  function touchXY(t: React.Touch) {
    const r = canvasRef.current!.getBoundingClientRect()
    return { cx: t.clientX - r.left, cy: t.clientY - r.top }
  }

  // ── Mouse ─────────────────────────────────────────────────────────────────
  function onMouseDown(e: React.MouseEvent) {
    e.preventDefault()
    mouseDown.current = true
    const { cx, cy } = canvasXY(e)
    const midi = getMidi(cx, cy)
    if (midi == null) return
    lastMouse.current = midi
    if (arpOnRef.current) { if (!arpHeld.current.includes(midi)) { arpHeld.current.push(midi); if (arpHeld.current.length === 1) startArp() } }
    else noteOn(midi, velFromY(cy))
  }

  function onMouseMove(e: React.MouseEvent) {
    if (!mouseDown.current) return
    const { cx, cy } = canvasXY(e)
    const midi = getMidi(cx, cy)
    if (midi == null || midi === lastMouse.current) return
    if (!arpOnRef.current) {
      if (lastMouse.current != null) noteOff(lastMouse.current)
      noteOn(midi, velFromY(cy))
    }
    lastMouse.current = midi
  }

  function onMouseUp() {
    mouseDown.current = false
    if (!arpOnRef.current && lastMouse.current != null) noteOff(lastMouse.current)
    lastMouse.current = null
  }

  function onMouseLeave() {
    if (!mouseDown.current) return
    mouseDown.current = false
    if (!arpOnRef.current && lastMouse.current != null) noteOff(lastMouse.current)
    lastMouse.current = null
  }

  // ── Touch ─────────────────────────────────────────────────────────────────
  function onTouchStart(e: React.TouchEvent) {
    e.preventDefault()
    for (const t of Array.from(e.changedTouches)) {
      const { cx, cy } = touchXY(t)
      const midi = getMidi(cx, cy)
      if (midi == null) continue
      touchMap.current.set(t.identifier, midi)
      if (arpOnRef.current) { if (!arpHeld.current.includes(midi)) { arpHeld.current.push(midi); if (arpHeld.current.length === 1) startArp() } }
      else noteOn(midi, velFromY(cy))
    }
  }

  function onTouchMove(e: React.TouchEvent) {
    e.preventDefault()
    for (const t of Array.from(e.changedTouches)) {
      const { cx, cy } = touchXY(t)
      const midi = getMidi(cx, cy)
      const prev = touchMap.current.get(t.identifier)
      if (midi == null || midi === prev) continue
      touchMap.current.set(t.identifier, midi)
      if (!arpOnRef.current) {
        if (prev != null) noteOff(prev)
        noteOn(midi, velFromY(cy))
      }
    }
  }

  function onTouchEnd(e: React.TouchEvent) {
    e.preventDefault()
    for (const t of Array.from(e.changedTouches)) {
      const midi = touchMap.current.get(t.identifier)
      touchMap.current.delete(t.identifier)
      if (midi == null) continue
      if (arpOnRef.current) { arpHeld.current = arpHeld.current.filter(m => m !== midi); if (arpHeld.current.length === 0) stopArp() }
      else noteOff(midi)
    }
  }

  // ── Computer keyboard ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) { allOff(); stopArp(); return }
    const down = new Set<string>()

    function kd(e: KeyboardEvent) {
      const tgt = e.target as HTMLElement
      if (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT') return
      if (e.repeat) return
      const k = e.key.toLowerCase()

      if (k === 'z') { setOctave(o => { const n = Math.max(0, o - 1); octaveRef.current = n; return n }); return }
      if (k === 'x') { setOctave(o => { const n = Math.min(8, o + 1); octaveRef.current = n; return n }); return }
      if (k === ' ') {
        e.preventDefault()
        sustainHeld.current = true; setSustain(true)
        return
      }
      if (!(k in KB_TO_SEMI) || down.has(k)) return
      e.preventDefault()
      down.add(k)
      const midi = (octaveRef.current + 1) * 12 + KB_TO_SEMI[k]
      if (midi < MIDI_MIN || midi > MIDI_MAX) return
      if (arpOnRef.current) { if (!arpHeld.current.includes(midi)) { arpHeld.current.push(midi); if (arpHeld.current.length === 1) startArp() } }
      else noteOn(midi, 90)
    }

    function ku(e: KeyboardEvent) {
      const tgt = e.target as HTMLElement
      if (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT') return
      const k = e.key.toLowerCase()
      if (k === ' ') {
        e.preventDefault()
        sustainHeld.current = false; setSustain(false); releaseSustain()
        return
      }
      if (!(k in KB_TO_SEMI)) return
      e.preventDefault()
      down.delete(k)
      const midi = (octaveRef.current + 1) * 12 + KB_TO_SEMI[k]
      if (arpOnRef.current) { arpHeld.current = arpHeld.current.filter(m => m !== midi); if (arpHeld.current.length === 0) stopArp() }
      else noteOff(midi)
    }

    window.addEventListener('keydown', kd)
    window.addEventListener('keyup',   ku)
    return () => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); allOff(); stopArp() }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Canvas draw ───────────────────────────────────────────────────────────
  const scaleSet = useMemo(() => {
    const sc = SCALES[scaleKey]
    if (!sc || sc.intervals.length === 0) return null
    return new Set(sc.intervals.map(i => (scaleRoot + i + 12) % 12))
  }, [scaleRoot, scaleKey])

  // Store latest draw params in ref so ResizeObserver can call it
  const drawRef = useRef<() => void>(() => {})

  useEffect(() => {
    drawRef.current = () => {
      const canvas = canvasRef.current
      if (!canvas) return
      const g = canvas.getContext('2d')
      if (!g) return
      const dpr = window.devicePixelRatio || 1
      const W   = canvas.offsetWidth
      const H   = canvas.offsetHeight
      canvas.width  = W * dpr
      canvas.height = H * dpr
      g.scale(dpr, dpr)

      const wkw = W / TOTAL_WHITES
      const bkw = wkw * 0.60
      const wkh = H
      const bkh = H * 0.62

      const allActive   = new Set([...activeRef.current, ...sustainedRef.current])
      const kbOctaveC   = (octaveRef.current + 1) * 12  // MIDI of C in current keyboard octave

      g.fillStyle = '#080808'
      g.fillRect(0, 0, W, H)

      // White keys
      for (let i = 0; i < WHITE_MIDIS.length; i++) {
        const midi = WHITE_MIDIS[i]
        const x    = i * wkw
        const pc   = midi % 12
        const isActive   = allActive.has(midi)
        const isSustained = sustainedRef.current.has(midi) && !activeRef.current.has(midi)
        const inScale    = scaleSet ? scaleSet.has(pc) : true
        const isRoot     = scaleSet && pc === scaleRoot % 12
        const isKbOct    = midi === kbOctaveC  // C of current keyboard octave

        // Body
        if (isActive) {
          g.fillStyle = '#8b5cf6'
        } else if (isSustained) {
          g.fillStyle = '#5b21b6'
        } else if (isRoot && scaleSet) {
          g.fillStyle = '#1e1040'
        } else if (scaleSet && !inScale) {
          g.fillStyle = '#141414'
        } else {
          g.fillStyle = '#e8e8e8'
        }
        g.fillRect(x + 1, 0, wkw - 2, wkh - 1)

        // Bottom rounded feel
        if (!isActive && !isSustained) {
          g.fillStyle = scaleSet && !inScale ? '#0d0d0d' : '#c8c8c8'
          g.fillRect(x + 1, wkh - 5, wkw - 2, 4)
        }

        // Scale dot (bottom area)
        if (scaleSet && inScale && !isActive && !isSustained) {
          g.fillStyle = isRoot ? 'rgba(167,139,250,1)' : 'rgba(167,139,250,0.45)'
          g.beginPath()
          g.arc(x + wkw / 2, wkh - 12, isRoot ? 4 : 2.5, 0, Math.PI * 2)
          g.fill()
        }

        // Keyboard octave marker (small triangle at top of C key)
        if (isKbOct && !isActive) {
          g.fillStyle = 'rgba(251,191,36,0.7)'
          g.beginPath()
          const cx = x + wkw / 2
          g.moveTo(cx, 3); g.lineTo(cx - 4, 10); g.lineTo(cx + 4, 10)
          g.fill()
        }

        // Note label — always C notes, active notes
        if (pc === 0 || isActive) {
          const oct  = Math.floor(midi / 12) - 1
          const txt  = pc === 0 ? `C${oct}` : NOTE_NAMES[pc]
          const fs   = Math.max(7, Math.min(11, wkw * 0.38))
          g.font      = `${fs}px system-ui, sans-serif`
          g.textAlign = 'center'
          g.fillStyle = isActive ? '#fff' : pc === 0 ? (scaleSet && !inScale ? '#444' : '#888') : '#aaa'
          g.fillText(txt, x + wkw / 2, wkh - (isActive ? 22 : 20))
        }

        // Border
        g.strokeStyle = isActive ? 'rgba(139,92,246,0.5)' : 'rgba(0,0,0,0.35)'
        g.lineWidth = 0.5
        g.strokeRect(x + 0.5, 0.5, wkw - 1, wkh - 1)
      }

      // Black keys (drawn on top)
      for (let midi = MIDI_MIN; midi <= MIDI_MAX; midi++) {
        if (!isBlack(midi)) continue
        const pc       = midi % 12
        const factor   = BLACK_X_FACTOR[midi]
        const bx       = factor * wkw - bkw / 2
        const isActive   = allActive.has(midi)
        const isSustained = sustainedRef.current.has(midi) && !activeRef.current.has(midi)
        const inScale  = scaleSet ? scaleSet.has(pc) : true
        const isRoot   = scaleSet && pc === scaleRoot % 12

        // Body gradient-ish via two rects
        if (isActive) {
          g.fillStyle = '#7c3aed'
        } else if (isSustained) {
          g.fillStyle = '#4c1d95'
        } else if (isRoot && scaleSet) {
          g.fillStyle = '#2e1065'
        } else if (scaleSet && !inScale) {
          g.fillStyle = '#0f0f0f'
        } else {
          g.fillStyle = '#1c1c1c'
        }
        g.fillRect(bx, 0, bkw, bkh)

        // Highlight sheen at top
        if (!isActive && !isSustained) {
          g.fillStyle = scaleSet && !inScale ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.07)'
          g.fillRect(bx + 1, 0, bkw - 2, 7)
        }

        // Bottom rounded feel
        g.fillStyle = isActive ? '#6d28d9' : '#111'
        g.fillRect(bx, bkh - 5, bkw, 5)

        // Scale dot
        if (scaleSet && inScale && !isActive && !isSustained) {
          g.fillStyle = isRoot ? 'rgba(167,139,250,1)' : 'rgba(167,139,250,0.55)'
          g.beginPath()
          g.arc(bx + bkw / 2, bkh - 9, isRoot ? 3 : 2, 0, Math.PI * 2)
          g.fill()
        }
      }
    }
  })

  // Draw on note/scale changes
  useEffect(() => { drawRef.current() }, [renderTick, scaleSet, scaleRoot, octave])

  // Draw + resize observer
  useEffect(() => {
    if (!open) return
    const canvas = canvasRef.current
    if (!canvas) return
    drawRef.current()
    const ro = new ResizeObserver(() => drawRef.current())
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [open])

  // Cleanup on unmount
  useEffect(() => () => {
    stopArp()
    try { audioCtx.current?.close() } catch {}
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 600,
        display: 'flex', flexDirection: 'column',
        height: 220, userSelect: 'none',
        background: 'linear-gradient(180deg, #111 0%, #0a0a0a 100%)',
        borderTop: '1px solid rgba(139,92,246,0.25)',
        boxShadow: '0 -8px 32px rgba(0,0,0,0.6)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {/* ── Controls ── */}
      <div style={{
        height: 48, display: 'flex', alignItems: 'center', gap: 8,
        padding: '0 10px', borderBottom: '1px solid rgba(255,255,255,0.06)',
        flexShrink: 0, overflowX: 'auto', overflowY: 'hidden',
      }}>
        {/* Instrument */}
        <select value={instrument} onChange={e => setInstrument(e.target.value as BeatType)} style={sel}>
          {INSTRUMENTS.map(i => <option key={i.type} value={i.type}>{i.label}</option>)}
        </select>

        <Div />

        {/* Octave */}
        <span style={lbl}>OCT</span>
        <button onClick={() => setOctave(o => { const n = Math.max(0, o-1); octaveRef.current = n; return n })} style={iconB}>−</button>
        <span style={{ color: '#a78bfa', fontWeight: 700, fontSize: 13, minWidth: 14, textAlign: 'center' }}>{octave}</span>
        <button onClick={() => setOctave(o => { const n = Math.min(8, o+1); octaveRef.current = n; return n })} style={iconB}>+</button>

        <Div />

        {/* Sustain */}
        <button
          onClick={() => {
            const n = !sustain
            setSustain(n); sustainHeld.current = n
            if (!n) releaseSustain()
          }}
          style={{ ...pill, background: sustain ? 'rgba(167,139,250,0.2)' : 'rgba(255,255,255,0.06)', border: `1px solid ${sustain ? 'rgba(167,139,250,0.5)' : 'rgba(255,255,255,0.1)'}`, color: sustain ? '#a78bfa' : '#666' }}
        >SUS</button>

        <Div />

        {/* Scale */}
        <span style={lbl}>KEY</span>
        <select value={scaleRoot} onChange={e => setScaleRoot(+e.target.value)} style={sel}>
          {NOTE_NAMES.map((n, i) => <option key={i} value={i}>{n}</option>)}
        </select>
        <select value={scaleKey} onChange={e => setScaleKey(e.target.value)} style={sel}>
          {Object.entries(SCALES).map(([k, s]) => <option key={k} value={k}>{s.name}</option>)}
        </select>

        <Div />

        {/* Arp */}
        <button
          onClick={() => { const n = !arpOn; setArpOn(n); arpOnRef.current = n; if (!n) stopArp() }}
          style={{ ...pill, background: arpOn ? 'rgba(251,191,36,0.15)' : 'rgba(255,255,255,0.06)', border: `1px solid ${arpOn ? 'rgba(251,191,36,0.4)' : 'rgba(255,255,255,0.1)'}`, color: arpOn ? '#fbbf24' : '#666' }}
        >ARP</button>
        {arpOn && <>
          <select value={arpMode} onChange={e => { const v = e.target.value as typeof arpMode; setArpMode(v); arpModeRef.current = v }} style={sel}>
            <option value="up">Up</option>
            <option value="down">Down</option>
            <option value="updown">Up-Down</option>
            <option value="random">Random</option>
          </select>
          <select value={arpRate} onChange={e => { const v = e.target.value as typeof arpRate; setArpRate(v); arpRateRef.current = v }} style={sel}>
            <option value="1/4">1/4</option>
            <option value="1/8">1/8</option>
            <option value="1/16">1/16</option>
            <option value="1/32">1/32</option>
          </select>
        </>}

        <Div />

        {/* Volume */}
        <span style={lbl}>VOL</span>
        <input type="range" min={0} max={1} step={0.01} value={volume}
          onChange={e => { const v = +e.target.value; setVolume(v); volRef.current = v }}
          style={{ width: 72, accentColor: '#a78bfa', cursor: 'pointer' }}
        />

        {/* Chord */}
        {chord && (
          <>
            <Div />
            <span style={{ color: '#86efac', fontWeight: 700, fontSize: 14, minWidth: 64, letterSpacing: '0.02em' }}>{chord}</span>
          </>
        )}

        <div style={{ flex: 1 }} />

        {/* Help */}
        <button onClick={() => setShowHelp(s => !s)} title="Keyboard shortcuts" style={{ ...pill, background: showHelp ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#888', fontSize: 13 }}>⌨</button>

        {/* Close */}
        <button onClick={() => { allOff(); onClose() }} style={{ ...pill, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#888' }}>✕</button>
      </div>

      {/* ── Keyboard canvas ── */}
      <canvas
        ref={canvasRef}
        style={{ flex: 1, width: '100%', display: 'block', cursor: 'pointer', touchAction: 'none' }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onContextMenu={e => e.preventDefault()}
      />

      {/* ── Shortcuts overlay ── */}
      {showHelp && (
        <div style={{
          position: 'absolute', bottom: 'calc(100% + 8px)', right: 10,
          background: '#1a1a2e', border: '1px solid rgba(139,92,246,0.35)',
          borderRadius: 10, padding: '14px 18px', fontSize: 11, color: '#bbb',
          lineHeight: 2, zIndex: 10, minWidth: 340,
          boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
        }}>
          <div style={{ fontWeight: 700, color: '#a78bfa', marginBottom: 8, fontSize: 12 }}>Keyboard Shortcuts</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 12px' }}>
            <K>A W S E D F T G Y H U J</K><span>Piano keys: C C# D D# E F F# G G# A A# B</span>
            <K>K O L</K><span>Next octave: C C# D</span>
            <K>Z</K><span>Octave down</span>
            <K>X</K><span>Octave up</span>
            <K>Space</K><span>Hold for sustain pedal</span>
          </div>
          <div style={{ marginTop: 10, color: '#666', fontSize: 10 }}>Click near bottom of key = higher velocity · Drag across keys = glissando</div>
        </div>
      )}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function Div() {
  return <div style={{ width: 1, height: 22, background: 'rgba(255,255,255,0.07)', flexShrink: 0 }} />
}
function K({ children }: { children: React.ReactNode }) {
  return <span style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 4, padding: '2px 6px', fontFamily: 'monospace', color: '#a78bfa', fontSize: 10 }}>{children}</span>
}

const sel: React.CSSProperties = {
  background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)',
  color: '#ccc', borderRadius: 5, padding: '3px 6px', fontSize: 11, cursor: 'pointer', outline: 'none',
}
const lbl: React.CSSProperties = {
  fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: '#555', flexShrink: 0,
}
const pill: React.CSSProperties = {
  padding: '3px 10px', borderRadius: 5, fontSize: 10, fontWeight: 700,
  letterSpacing: '0.06em', cursor: 'pointer', outline: 'none', flexShrink: 0,
}
const iconB: React.CSSProperties = {
  width: 20, height: 20, borderRadius: 4, background: 'rgba(255,255,255,0.08)',
  border: '1px solid rgba(255,255,255,0.12)', color: '#aaa', cursor: 'pointer',
  fontSize: 14, lineHeight: '18px', textAlign: 'center', outline: 'none', padding: 0,
}
