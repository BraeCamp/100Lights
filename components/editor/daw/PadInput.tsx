'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useDaw, makeMidiClip } from '@/lib/daw-state'
import { playInstrumentNote } from '@/lib/daw-instruments'
import { libraryGetAll } from '@/lib/sound-library'
import type { LibraryEntry } from '@/lib/sound-library'
import type { MidiClip, MidiNote } from '@/lib/daw-types'
import { isMidiClip } from '@/lib/daw-types'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Pad {
  id: string
  pitch: number
  drumLabel: string
  key: string
  customSoundId?: string
  customSoundName?: string
  samplePitch?: number    // semitone offset (default 0)
  sampleVolume?: number   // gain multiplier 0–2 (default 1)
  sampleSustain?: number  // release fade seconds after key-up (default 0)
  sampleLoop?: boolean    // loop while key held
  sampleReverse?: boolean // play buffer reversed
}

interface ActiveSource {
  src: AudioBufferSourceNode
  gain: GainNode
}

// ── Constants ──────────────────────────────────────────────────────────────────

const DEFAULT_PADS: Pad[] = [
  { id: 'p1', pitch: 36, drumLabel: 'Kick',     key: 'a' },
  { id: 'p2', pitch: 38, drumLabel: 'Snare',    key: 's' },
  { id: 'p3', pitch: 42, drumLabel: 'Hi-Hat',   key: 'd' },
  { id: 'p4', pitch: 46, drumLabel: 'Open Hat', key: 'f' },
  { id: 'p5', pitch: 39, drumLabel: 'Clap',     key: 'z' },
  { id: 'p6', pitch: 51, drumLabel: 'Rim',      key: 'x' },
  { id: 'p7', pitch: 49, drumLabel: 'Crash',    key: 'c' },
  { id: 'p8', pitch: 45, drumLabel: 'Tom',      key: 'v' },
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
  text:   '#e8e8e8',
  muted:  '#7c7c7c',
} as const

// ── Audio helpers ─────────────────────────────────────────────────────────────

function reverseBuffer(ctx: AudioContext, buf: AudioBuffer): AudioBuffer {
  const rev = ctx.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate)
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const src = buf.getChannelData(ch)
    const dst = rev.getChannelData(ch)
    for (let i = 0; i < src.length; i++) dst[i] = src[src.length - 1 - i]
  }
  return rev
}

// ── Slider for popover ────────────────────────────────────────────────────────

function PopSlider({ label, value, min, max, step, format, onChange }: {
  label: string; value: number; min: number; max: number; step: number
  format: (v: number) => string; onChange: (v: number) => void
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
        <span style={{ fontSize: 10, color: C.text, fontFamily: 'monospace' }}>{format(value)}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        onMouseDown={e => e.stopPropagation()}
        onClick={e => e.stopPropagation()}
        style={{ width: '100%', accentColor: C.accent, cursor: 'pointer', display: 'block' }}
      />
    </div>
  )
}

// ── Pad right-click popover ───────────────────────────────────────────────────

function PadPopover({ pad, anchor, onRemap, onAssignSound, onPadChange, onClose }: {
  pad: Pad
  anchor: { x: number; y: number }
  onRemap: () => void
  onAssignSound: (entry: LibraryEntry) => void
  onPadChange: (patch: Partial<Pad>) => void
  onClose: () => void
}) {
  const [entries,     setEntries]     = useState<LibraryEntry[]>([])
  const [loading,     setLoading]     = useState(true)
  const [showLibrary, setShowLibrary] = useState(false)
  const [search,      setSearch]      = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    libraryGetAll().then(e => { setEntries(e); setLoading(false) })
  }, [])

  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [onClose])

  const filtered = entries.filter(e => e.name.toLowerCase().includes(search.toLowerCase()))
  const hasCustom = !!pad.customSoundId
  const left = Math.min(anchor.x, (typeof window !== 'undefined' ? window.innerWidth  : 800) - 270)
  const top  = Math.min(anchor.y, (typeof window !== 'undefined' ? window.innerHeight : 800) - 520)

  const toggleStyle = (on: boolean) => ({
    fontSize: 11, padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontWeight: on ? 700 : 400,
    border: `1px solid ${on ? C.accent : C.border}`,
    background: on ? `${C.accent}22` : 'transparent',
    color: on ? C.accent : C.muted,
  } as const)

  return createPortal(
    <div
      ref={ref}
      onMouseDown={e => e.stopPropagation()}
      style={{
        position: 'fixed', left, top, width: 260, zIndex: 3000,
        background: C.bgCard, border: `1px solid ${C.accent}`,
        borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
        maxHeight: '85vh', overflowY: 'auto',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '8px 10px', background: 'rgba(61,143,239,0.12)', borderBottom: `1px solid ${C.border}` }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: C.text, flex: 1 }}>{pad.drumLabel}</span>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 0 }}>×</button>
      </div>

      {/* Key */}
      <div style={{ padding: '10px 12px', borderBottom: `1px solid ${C.border}` }}>
        <span style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Key</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
          <span style={{
            fontSize: 14, fontWeight: 800, fontFamily: 'monospace', width: 28, height: 28,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: C.bgDark, border: `1px solid ${C.border}`, borderRadius: 4,
            color: pad.key ? C.text : C.muted,
          }}>{pad.key ? pad.key.toUpperCase() : '–'}</span>
          <button onClick={() => { onRemap(); onClose() }} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 4, border: `1px solid ${C.border}`, background: 'transparent', color: C.text, cursor: 'pointer' }}>
            {pad.key ? 'Remap Key' : 'Assign Key'}
          </button>
        </div>
      </div>

      {/* Sound */}
      <div style={{ padding: '10px 12px', borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Sound</span>
          {hasCustom && (
            <button
              onClick={() => onPadChange({ customSoundId: undefined, customSoundName: undefined, samplePitch: 0 })}
              style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, border: `1px solid ${C.border}`, background: 'transparent', color: C.muted, cursor: 'pointer' }}
            >Clear</button>
          )}
        </div>
        <div style={{ fontSize: 11, color: hasCustom ? C.accent : C.muted, marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {hasCustom ? `✓ ${pad.customSoundName ?? 'Custom sound'}` : 'Instrument default'}
        </div>
        <button
          onClick={() => setShowLibrary(v => !v)}
          style={{ width: '100%', fontSize: 11, padding: '5px 0', borderRadius: 4, border: `1px solid ${C.accent}`, background: showLibrary ? `${C.accent}22` : 'transparent', color: C.accent, cursor: 'pointer', fontWeight: 600 }}
        >{showLibrary ? 'Hide Library ▴' : 'Pick from Library ▾'}</button>
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
            ) : filtered.length === 0 ? (
              <div style={{ fontSize: 11, color: C.muted, padding: '8px 4px' }}>
                {entries.length === 0 ? 'No sounds in library — add some via the Sound Library panel' : 'No matches'}
              </div>
            ) : (
              <div style={{ maxHeight: 140, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
                {filtered.map(entry => (
                  <button
                    key={entry.id}
                    onClick={() => { onAssignSound(entry); onClose() }}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left', padding: '5px 6px', borderRadius: 3, border: 'none', background: entry.id === pad.customSoundId ? `${C.accent}22` : 'transparent', color: entry.id === pad.customSoundId ? C.accent : C.text, cursor: 'pointer', fontSize: 11 }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.06)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = entry.id === pad.customSoundId ? `${C.accent}22` : 'transparent' }}
                  >
                    <span style={{ fontSize: 13 }}>🔊</span>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</span>
                    <span style={{ fontSize: 9, color: C.muted, flexShrink: 0 }}>{entry.duration.toFixed(1)}s</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Live performance controls — only visible when a custom sound is assigned */}
      {hasCustom && (
        <div style={{ padding: '10px 12px' }}>
          <span style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 10 }}>Performance</span>

          {/* Pitch */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <span style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Pitch</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <button onClick={() => onPadChange({ samplePitch: Math.max(-24, (pad.samplePitch ?? 0) - 1) })} style={{ width: 18, height: 18, borderRadius: 2, border: `1px solid ${C.border}`, background: 'transparent', color: C.text, cursor: 'pointer', fontSize: 12, lineHeight: 1 }}>−</button>
                <span style={{ fontSize: 10, fontFamily: 'monospace', minWidth: 38, textAlign: 'center', color: (pad.samplePitch ?? 0) !== 0 ? C.accent : C.muted }}>
                  {(pad.samplePitch ?? 0) > 0 ? `+${pad.samplePitch}st` : `${pad.samplePitch ?? 0}st`}
                </span>
                <button onClick={() => onPadChange({ samplePitch: Math.min(24, (pad.samplePitch ?? 0) + 1) })} style={{ width: 18, height: 18, borderRadius: 2, border: `1px solid ${C.border}`, background: 'transparent', color: C.text, cursor: 'pointer', fontSize: 12, lineHeight: 1 }}>+</button>
                {(pad.samplePitch ?? 0) !== 0 && (
                  <button onClick={() => onPadChange({ samplePitch: 0 })} style={{ fontSize: 9, padding: '1px 4px', borderRadius: 2, border: `1px solid ${C.border}`, background: 'transparent', color: C.muted, cursor: 'pointer' }}>0</button>
                )}
              </div>
            </div>
            <input
              type="range" min={-24} max={24} step={1} value={pad.samplePitch ?? 0}
              onChange={e => onPadChange({ samplePitch: parseInt(e.target.value) })}
              onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}
              style={{ width: '100%', accentColor: C.accent, cursor: 'pointer', display: 'block' }}
            />
          </div>

          {/* Volume */}
          <PopSlider
            label="Volume"
            value={pad.sampleVolume ?? 1}
            min={0} max={2} step={0.01}
            format={v => `${Math.round(v * 100)}%`}
            onChange={v => onPadChange({ sampleVolume: v })}
          />

          {/* Sustain */}
          <PopSlider
            label="Sustain"
            value={pad.sampleSustain ?? 0}
            min={0} max={4} step={0.05}
            format={v => v === 0 ? 'Off (chop)' : `${v.toFixed(2)}s release`}
            onChange={v => onPadChange({ sampleSustain: v })}
          />

          {/* Loop + Reverse toggles */}
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <button onClick={() => onPadChange({ sampleLoop: !pad.sampleLoop })} style={toggleStyle(!!pad.sampleLoop)}>
              ↻ Loop
            </button>
            <button onClick={() => onPadChange({ sampleReverse: !pad.sampleReverse })} style={toggleStyle(!!pad.sampleReverse)}>
              ◁ Reverse
            </button>
          </div>
        </div>
      )}
    </div>,
    document.body
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function PadInput({ trackId, onClose }: { trackId: string; onClose: () => void }) {
  const { project, dispatch, engine } = useDaw()

  const [tab,         setTab]         = useState<'pads' | 'keyboard'>('pads')
  const [pads,        setPads]        = useState<Pad[]>(DEFAULT_PADS)
  const [octave,      setOctave]      = useState(4)
  const [pressing,    setPressing]    = useState<Set<number>>(new Set())
  const [remapId,     setRemapId]     = useState<string | null>(null)
  const [active,      setActive]      = useState(false)
  const [contextMenu, setContextMenu] = useState<{ pad: Pad; x: number; y: number } | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [winSize,      setWinSize]     = useState<{ w: number; h: number | null }>({ w: 520, h: null })
  const [pos, setPos] = useState(() => ({
    x: typeof window !== 'undefined' ? Math.max(0, window.innerWidth  / 2 - 260) : 200,
    y: typeof window !== 'undefined' ? Math.max(0, window.innerHeight - 420)      : 200,
  }))

  const containerRef = useRef<HTMLDivElement>(null)
  const noteStarts   = useRef<Map<number, { beat: number; clipId: string }>>(new Map())
  const activeClipId = useRef<string | null>(null)
  const soundBuffers  = useRef<Map<string, AudioBuffer>>(new Map())
  const reversedBufs  = useRef<Map<string, AudioBuffer>>(new Map())
  const activeSources = useRef<Map<number, ActiveSource>>(new Map())
  const dragging      = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)
  const resizing      = useRef<{ dir: string; sx: number; sy: number; ow: number; oh: number } | null>(null)
  // Keep a live ref to pads so the capture handler reads fresh data without being in its dep array
  const padsRef = useRef(pads)
  useEffect(() => { padsRef.current = pads }, [pads])

  const track      = project.tracks.find(t => t.id === trackId)
  const instrument = track?.instrument
  const isDrum     = instrument?.type === 'drum'

  const pianoKeyMap = useMemo(() => buildPianoKeyMap(octave), [octave])
  const padKeyMap   = useMemo(() => {
    const m: Record<string, number> = {}
    for (const p of pads) if (p.key) m[p.key] = p.pitch
    return m
  }, [pads])
  const padKeyMapRef   = useRef(padKeyMap)
  const pianoKeyMapRef = useRef(pianoKeyMap)
  useEffect(() => { padKeyMapRef.current   = padKeyMap   }, [padKeyMap])
  useEffect(() => { pianoKeyMapRef.current = pianoKeyMap }, [pianoKeyMap])

  // ── MIDI clip tracking ────────────────────────────────────────────────────────

  const getOrCreateClip = useCallback((): string => {
    const now = engine.currentBeat
    if (activeClipId.current && project.arrangementClips.some(c => c.id === activeClipId.current)) {
      return activeClipId.current
    }
    const spanning = project.arrangementClips.find(c =>
      isMidiClip(c) && c.trackId === trackId && now >= c.startBeat && now < c.startBeat + c.durationBeats
    )
    if (spanning) { activeClipId.current = spanning.id; return spanning.id }
    const startBeat = Math.floor(now / project.timeSignatureNum) * project.timeSignatureNum
    const clip = makeMidiClip(trackId, 'Beat', startBeat, 8 * project.timeSignatureNum)
    ;(clip as MidiClip).isDrumClip = isDrum
    dispatch({ type: 'ADD_CLIP', clip })
    activeClipId.current = clip.id
    return clip.id
  }, [engine, project, trackId, dispatch, isDrum])

  // ── Audio playback ────────────────────────────────────────────────────────────

  const startNote = useCallback(async (pitch: number) => {
    const pad = padsRef.current.find(p => p.pitch === pitch)

    if (pad?.customSoundId) {
      await engine.ctx.resume()

      let buf = soundBuffers.current.get(pad.customSoundId)
      if (!buf) {
        try {
          const all   = await libraryGetAll()
          const entry = all.find(e => e.id === pad.customSoundId)
          if (entry) {
            const ab = await entry.audioBlob.arrayBuffer()
            buf = await engine.ctx.decodeAudioData(ab)
            soundBuffers.current.set(pad.customSoundId, buf)
          }
        } catch { /* fall through to synthesis */ }
      }

      if (buf) {
        // Stop any existing source for this pitch
        const existing = activeSources.current.get(pitch)
        if (existing) {
          try { existing.src.stop() } catch { /* already stopped */ }
          existing.gain.disconnect()
          activeSources.current.delete(pitch)
        }

        // Build reversed buffer if needed
        let playBuf = buf
        if (pad.sampleReverse) {
          let rev = reversedBufs.current.get(pad.customSoundId)
          if (!rev) {
            rev = reverseBuffer(engine.ctx, buf)
            reversedBufs.current.set(pad.customSoundId, rev)
          }
          playBuf = rev
        }

        const gainNode = engine.ctx.createGain()
        gainNode.gain.value = pad.sampleVolume ?? 1
        gainNode.connect(engine.masterGain)

        const src = engine.ctx.createBufferSource()
        src.buffer = playBuf
        src.playbackRate.value = Math.pow(2, (pad.samplePitch ?? 0) / 12)
        src.loop = !!pad.sampleLoop
        src.connect(gainNode)
        src.start(engine.ctx.currentTime)

        activeSources.current.set(pitch, { src, gain: gainNode })
      }
    } else if (instrument) {
      await engine.ctx.resume()
      playInstrumentNote(engine.ctx, engine.masterGain, instrument, pitch, 100, engine.ctx.currentTime, 0.25)
    }

    setPressing(prev => new Set([...prev, pitch]))
    if (engine.isRecording && engine.isPlaying) {
      const clipId = getOrCreateClip()
      noteStarts.current.set(pitch, { beat: engine.currentBeat, clipId })
    }
  }, [instrument, engine, getOrCreateClip])

  const endNote = useCallback((pitch: number) => {
    // Stop custom sample source
    const active = activeSources.current.get(pitch)
    if (active) {
      const pad     = padsRef.current.find(p => p.pitch === pitch)
      const sustain = pad?.sampleSustain ?? 0
      if (sustain > 0) {
        const now = engine.ctx.currentTime
        active.gain.gain.setValueAtTime(active.gain.gain.value, now)
        active.gain.gain.linearRampToValueAtTime(0, now + sustain)
        active.src.loop = false  // let it play out, don't loop forever during release
        try { active.src.stop(now + sustain + 0.01) } catch { /* already stopped */ }
      } else {
        try { active.src.stop() } catch { /* already stopped */ }
        active.gain.disconnect()
      }
      activeSources.current.delete(pitch)
    }

    setPressing(prev => { const n = new Set(prev); n.delete(pitch); return n })

    const started = noteStarts.current.get(pitch)
    if (!started) return
    noteStarts.current.delete(pitch)
    const clip = project.arrangementClips.find(c => c.id === started.clipId)
    if (clip && isMidiClip(clip)) {
      const note: MidiNote = {
        id: crypto.randomUUID(), pitch,
        startBeat: Math.max(0, started.beat - clip.startBeat),
        durationBeats: Math.max(0.0625, engine.currentBeat - started.beat),
        velocity: 100,
      }
      dispatch({ type: 'ADD_MIDI_NOTE', clipId: clip.id, note })
    }
  }, [project, engine, dispatch])

  // ── Click-outside deactivation ────────────────────────────────────────────────

  useEffect(() => {
    if (!active) return
    function onDocDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setActive(false)
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [active])

  // ── Keyboard — single CAPTURE-phase handler (fixes conflict with bubble handler)
  // Bug: a separate capture swallower calling stopPropagation() prevents the
  // bubble-phase handler on document from ever firing (event never reaches target,
  // so bubble phase never starts). Solution: one capture handler does everything.

  const tabRef    = useRef(tab)
  const remapIdRef = useRef(remapId)
  useEffect(() => { tabRef.current    = tab    }, [tab])
  useEffect(() => { remapIdRef.current = remapId }, [remapId])

  useEffect(() => {
    if (!active) return

    function onCapture(e: KeyboardEvent) {
      // Always block DAW shortcuts while overlay is active
      if (e.key !== 'Escape') e.stopPropagation()

      if (e.type === 'keydown') {
        if (e.repeat) return
        const k = e.key.toLowerCase()

        if (e.key === 'Escape') { setActive(false); return }

        // Remap mode: next key becomes the new shortcut
        if (remapIdRef.current !== null) {
          e.preventDefault()
          const rid = remapIdRef.current
          setPads(prev => prev.map(p => {
            if (p.key === k) return { ...p, key: '' }   // clear old binding on another pad
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
  // Note: tab, padKeyMap, pianoKeyMap, remapId are intentionally read via refs
  // so the listener doesn't need to re-register when they change.

  // ── Header drag ───────────────────────────────────────────────────────────────

  const onHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    if (isFullscreen) return
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

  // ── Edge/corner resize ────────────────────────────────────────────────────────

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

  // ── Context-menu pad change helper ────────────────────────────────────────────

  const onPadChange = useCallback((patch: Partial<Pad>) => {
    if (!contextMenu) return
    const id = contextMenu.pad.id
    // Invalidate cached reversed buffer if sound or reverse toggle changed
    if (patch.customSoundId !== undefined || patch.sampleReverse !== undefined) {
      const padToUpdate = padsRef.current.find(p => p.id === id)
      if (padToUpdate?.customSoundId) reversedBufs.current.delete(padToUpdate.customSoundId)
    }
    setPads(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p))
    setContextMenu(prev => prev ? { ...prev, pad: { ...prev.pad, ...patch } } : null)
  }, [contextMenu])

  const isRecActive = engine.isRecording && engine.isPlaying

  // ── Container style (supports fullscreen + manual resize) ─────────────────────

  const containerStyle: React.CSSProperties = isFullscreen ? {
    position: 'fixed', left: 0, top: 0, width: '100vw', height: '100vh',
    borderRadius: 0,
    background: C.bg,
    border: `1px solid ${C.accent}`,
    boxShadow: 'none',
    zIndex: 2000, userSelect: 'none',
    display: 'flex', flexDirection: 'column',
    transition: 'none',
  } : {
    position: 'fixed', left: pos.x, top: pos.y,
    width: winSize.w,
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
      <div
        ref={containerRef}
        onMouseDown={() => setActive(true)}
        style={containerStyle}
      >
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
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            {isRecActive && <span style={{ fontSize: 10, color: C.red, fontWeight: 800, letterSpacing: '0.05em' }}>● REC</span>}
            {/* Fullscreen toggle */}
            <button
              onClick={e => { e.stopPropagation(); setIsFullscreen(v => !v) }}
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, cursor: 'pointer', fontSize: 11, padding: '2px 6px', borderRadius: 3 }}
            >{isFullscreen ? '⊡' : '⊞'}</button>
            {!isFullscreen && <span style={{ fontSize: 10, color: C.muted }}>drag to move</span>}
            <button onClick={e => { e.stopPropagation(); onClose() }}
              style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '0 2px' }}>×</button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 2, padding: '6px 12px 0', background: C.bgCard, borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          {(['pads', 'keyboard'] as const).map(t => (
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

          {/* Pads tab */}
          {tab === 'pads' && (
            <div style={{ padding: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                {pads.map(pad => {
                  const isAct      = pressing.has(pad.pitch)
                  const isRemapping = remapId === pad.id
                  const hasCustom  = !!pad.customSoundId
                  return (
                    <button
                      key={pad.id}
                      onMouseDown={e => { e.stopPropagation(); if (e.button === 0) startNote(pad.pitch) }}
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
                        border: `1px solid ${isRemapping ? C.accent : isAct ? '#666' : hasCustom ? 'rgba(61,143,239,0.4)' : C.border}`,
                        background: isRemapping ? `${C.accent}30` : isAct ? 'rgba(255,255,255,0.12)' : hasCustom ? 'rgba(61,143,239,0.07)' : C.bgCard,
                        color: isAct ? '#fff' : C.text, cursor: 'pointer',
                        transition: 'background 50ms, border-color 50ms',
                      }}
                    >
                      {hasCustom && !isAct && (
                        <span style={{ position: 'absolute', top: 5, right: 6, width: 6, height: 6, borderRadius: '50%', background: C.accent }} title={pad.customSoundName} />
                      )}
                      {/* Loop indicator */}
                      {pad.sampleLoop && (
                        <span style={{ position: 'absolute', top: 5, left: 6, fontSize: 9, color: C.green }}>↻</span>
                      )}
                      {/* Reverse indicator */}
                      {pad.sampleReverse && (
                        <span style={{ position: 'absolute', top: 5, left: pad.sampleLoop ? 18 : 6, fontSize: 9, color: C.accent }}>◁</span>
                      )}
                      <span style={{ fontSize: 12, fontWeight: 600 }}>
                        {isRemapping ? '…press key' : pad.drumLabel}
                      </span>
                      {hasCustom && !isRemapping && (
                        <span style={{ fontSize: 9, color: C.accent, maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1 }}>
                          {pad.customSoundName}
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
                  <button
                    onClick={() => setPads(prev => prev.slice(0, -1))}
                    style={{ fontSize: 11, padding: '4px 8px', borderRadius: 4, border: `1px solid ${C.border}`, background: 'transparent', color: C.muted, cursor: 'pointer' }}
                  >− Remove Last</button>
                )}
                <span style={{ fontSize: 10, color: '#444', marginLeft: 'auto' }}>Right-click a pad to edit</span>
              </div>
            </div>
          )}

          {/* Keyboard tab */}
          {tab === 'keyboard' && (
            <div style={{ padding: '12px 12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                <button onClick={() => setOctave(o => Math.max(0, o - 1))}
                  style={{ padding: '3px 10px', borderRadius: 4, border: `1px solid ${C.border}`, background: C.bgCard, color: C.text, cursor: 'pointer', fontSize: 13 }}>◀</button>
                <span style={{ fontSize: 12, color: C.muted, minWidth: 60, textAlign: 'center' }}>Oct {octave} (C{octave})</span>
                <button onClick={() => setOctave(o => Math.min(8, o + 1))}
                  style={{ padding: '3px 10px', borderRadius: 4, border: `1px solid ${C.border}`, background: C.bgCard, color: C.text, cursor: 'pointer', fontSize: 13 }}>▶</button>
                <span style={{ fontSize: 10, color: '#444', marginLeft: 8 }}>Z–M = lower oct · Q–U = upper oct</span>
              </div>

              {[octave, octave + 1].map(oct => {
                const base = (oct + 1) * 12
                const WW = 30, WH = 90, BW = 18, BH = 56
                const octW = WW * 7
                return (
                  <div key={oct} style={{ display: 'inline-block', position: 'relative', width: octW, height: WH, marginRight: 2 }}>
                    {WHITE_ST.map((st, i) => {
                      const pitch = base + st
                      const act = pressing.has(pitch)
                      return (
                        <div key={st}
                          onMouseDown={e => { e.stopPropagation(); startNote(pitch) }}
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
                          onMouseDown={e => { e.stopPropagation(); e.preventDefault(); startNote(pitch) }}
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

        </div>{/* end scrollable body */}

        {/* Footer */}
        <div style={{ padding: '6px 12px', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          {active
            ? <span style={{ fontSize: 10, color: C.muted }}>Esc or click outside to release · Arm track + record to capture</span>
            : <span style={{ fontSize: 10, color: '#444' }}>Click overlay to activate keyboard input</span>
          }
          {isRecActive && <span style={{ fontSize: 10, color: C.red, fontWeight: 700, flexShrink: 0, marginLeft: 8 }}>Recording…</span>}
        </div>

        {/* Resize handles — right, bottom, corner */}
        {!isFullscreen && <>
          <div onMouseDown={onResizeDown('e')} style={{ position: 'absolute', right: 0, top: 12, bottom: 12, width: 6, cursor: 'ew-resize' }} />
          <div onMouseDown={onResizeDown('s')} style={{ position: 'absolute', bottom: 0, left: 12, right: 12, height: 6, cursor: 'ns-resize' }} />
          <div onMouseDown={onResizeDown('se')} style={{ position: 'absolute', right: 0, bottom: 0, width: 14, height: 14, cursor: 'nwse-resize' }} />
        </>}
      </div>

      {/* Right-click popover */}
      {contextMenu && (
        <PadPopover
          pad={contextMenu.pad}
          anchor={{ x: contextMenu.x, y: contextMenu.y }}
          onRemap={() => setRemapId(contextMenu.pad.id)}
          onAssignSound={entry => onPadChange({ customSoundId: entry.id, customSoundName: entry.name })}
          onPadChange={onPadChange}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>,
    document.body
  )
}
