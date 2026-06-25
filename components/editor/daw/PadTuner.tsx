'use client'
/**
 * PadTuner — real-time mic → MIDI note capture.
 * Separated: delete this file + the LivePitchDetector section in lib/pitch-detector.ts
 * to remove the feature entirely.
 */
import { useState, useEffect, useRef } from 'react'
import { LivePitchDetector, LivePitchResult } from '../../../lib/pitch-detector'
import { useDaw } from '../../../lib/daw-state'
import { libraryGetAll, LibraryEntry } from '../../../lib/sound-library'
import { isMidiClip, MidiNote } from '../../../lib/daw-types'

const C = {
  bg:     'var(--bg-surface)',
  border: 'var(--border)',
  text:   'var(--text)',
  muted:  'var(--text-muted)',
  accent: '#3d8fef',
  red:    '#ef4444',
  green:  '#22c55e',
  yellow: '#eab308',
}

// Arc geometry — all in SVG user units
const CX = 150, CY = 162, R = 130, SWEEP = 70  // ±70° around 12 o'clock

function toRad(deg: number) { return deg * Math.PI / 180 }
function arcPt(angleDeg: number, r: number): [number, number] {
  return [CX + r * Math.cos(toRad(angleDeg)), CY + r * Math.sin(toRad(angleDeg))]
}
function centsDeg(cents: number) { return 270 + Math.max(-50, Math.min(50, cents)) * SWEEP / 50 }

function tunerColor(cents: number) {
  const a = Math.abs(cents)
  if (a <= 5)  return C.green
  if (a <= 20) return C.yellow
  return C.red
}

const PRESET_FOLDERS = [
  { label: 'Piano',   folder: 'Piano – All Notes' },
  { label: 'E.Piano', folder: 'Elec. Piano – All Notes' },
  { label: 'Rhodes',  folder: 'Rhodes – All Notes' },
  { label: 'Synth',   folder: 'Synth Lead – All Notes' },
  { label: 'Bass',    folder: 'Bass – All Notes' },
]

const NOTE_DUR_LABELS: Record<number, string> = { 0.25: '1/16', 0.5: '1/8', 1: '♩', 2: '𝅗𝅥' }

export default function PadTuner() {
  const { project, dispatch, engine, selectedClipId } = useDaw()

  const [result,       setResult]       = useState<LivePitchResult | null>(null)
  const [listening,    setListening]    = useState(false)
  const [micError,     setMicError]     = useState<string | null>(null)
  const [isPlaying,    setIsPlaying]    = useState(false)
  const [captured,     setCaptured]     = useState(false)
  const [capError,     setCapError]     = useState<string | null>(null)
  const [noteDur,      setNoteDur]      = useState(1)
  const [preset,       setPreset]       = useState('Piano – All Notes')
  const [entries,      setEntries]      = useState<LibraryEntry[]>([])

  const detectorRef = useRef<LivePitchDetector | null>(null)
  const playRef     = useRef<{ src: AudioBufferSourceNode; ctx: AudioContext } | null>(null)
  const latestResult = useRef<LivePitchResult | null>(null)
  latestResult.current = result

  useEffect(() => { libraryGetAll().then(setEntries).catch(() => {}) }, [])
  useEffect(() => () => { detectorRef.current?.stop(); killPlayback() }, [])

  async function startMic() {
    setMicError(null)
    try {
      const d = new LivePitchDetector()
      detectorRef.current = d
      await d.start(r => setResult(r))
      setListening(true)
    } catch (e) {
      setMicError(e instanceof Error ? e.message : 'Microphone access denied')
    }
  }

  function stopMic() {
    detectorRef.current?.stop(); detectorRef.current = null
    setListening(false); setResult(null)
  }

  function killPlayback() {
    if (playRef.current) {
      try { playRef.current.src.stop() } catch { /* */ }
      playRef.current.ctx.close().catch(() => {})
      playRef.current = null
    }
    setIsPlaying(false)
  }

  async function playNote() {
    const r = latestResult.current
    if (!r) return
    killPlayback()
    const entry = entries.find(e => e.name === r.noteName && e.folder === preset)
              ?? entries.find(e => e.name === r.noteName)
    if (!entry) return
    try {
      const ctx = new AudioContext(); await ctx.resume()
      const buf = await ctx.decodeAudioData(await entry.audioBlob.arrayBuffer())
      const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination)
      src.onended = () => setIsPlaying(false)
      src.start(0); playRef.current = { src, ctx }; setIsPlaying(true)
    } catch { setIsPlaying(false) }
  }

  function captureNote() {
    const r = latestResult.current
    if (!r) return
    if (!selectedClipId) { setCapError('Select a MIDI clip in the timeline first'); return }
    const clip = project.arrangementClips.find(c => c.id === selectedClipId)
    if (!clip || !isMidiClip(clip)) { setCapError('Selected clip is not a MIDI clip'); return }
    const note: MidiNote = {
      id: crypto.randomUUID(),
      pitch: r.midi,
      startBeat: Math.max(0, engine.currentBeat - clip.startBeat),
      durationBeats: noteDur,
      velocity: 100,
    }
    dispatch({ type: 'ADD_MIDI_NOTE', clipId: clip.id, note })
    setCapError(null); setCaptured(true); setTimeout(() => setCaptured(false), 900)
  }

  // SVG values
  const col       = result ? tunerColor(result.cents) : '#555'
  const ndlDeg    = result ? centsDeg(result.cents) : 270
  const [nx, ny]  = arcPt(ndlDeg, 115)
  const [lx, ly]  = arcPt(200, R)
  const [rx, ry]  = arcPt(340, R)
  const locked    = result && result.confidence >= 0.7 && Math.abs(result.cents) <= 10
  const hasSample = !!result && entries.some(e => e.name === result.noteName)

  // Progress arc (center 270° → needle angle)
  function progressArc(): string | null {
    if (!result || Math.abs(result.cents) < 1) return null
    const c     = result.cents
    const sDeg  = c >= 0 ? 270 : centsDeg(c)
    const eDeg  = c >= 0 ? centsDeg(c) : 270
    const [sx, sy] = arcPt(sDeg, R)
    const [ex, ey] = arcPt(eDeg, R)
    const large = (eDeg - sDeg > 180) ? 1 : 0
    return `M ${sx.toFixed(1)} ${sy.toFixed(1)} A ${R} ${R} 0 ${large} 1 ${ex.toFixed(1)} ${ey.toFixed(1)}`
  }

  return (
    <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>

      {/* ── Tuner arc ── */}
      <svg viewBox="0 0 300 175" width="100%" style={{ maxWidth: 280, userSelect: 'none' }}>
        {/* Track */}
        <path
          d={`M ${lx.toFixed(1)} ${ly.toFixed(1)} A ${R} ${R} 0 0 1 ${rx.toFixed(1)} ${ry.toFixed(1)}`}
          fill="none" stroke="#2a2a2a" strokeWidth="14" strokeLinecap="round"
        />
        {/* Progress highlight */}
        {progressArc() && (
          <path d={progressArc()!} fill="none" stroke={col} strokeWidth="14" strokeLinecap="round" opacity={0.65}
            style={{ transition: 'stroke 0.08s' }} />
        )}
        {/* Tick marks */}
        {[-50, -25, 0, 25, 50].map(c => {
          const a  = toRad(centsDeg(c))
          const r1 = c === 0 ? R - 16 : R - 9
          const r2 = c === 0 ? R + 16 : R + 9
          return (
            <line key={c}
              x1={CX + r1 * Math.cos(a)} y1={CY + r1 * Math.sin(a)}
              x2={CX + r2 * Math.cos(a)} y2={CY + r2 * Math.sin(a)}
              stroke={c === 0 ? '#555' : '#3a3a3a'} strokeWidth={c === 0 ? 2 : 1.5}
            />
          )
        })}
        {/* ±50 labels */}
        {[-50, 50].map(c => {
          const a = toRad(centsDeg(c))
          const d = R - 28
          return (
            <text key={c} x={CX + d * Math.cos(a)} y={CY + d * Math.sin(a)}
              textAnchor="middle" dominantBaseline="central" fontSize="9" fill="#444">
              {c > 0 ? '+50' : '−50'}
            </text>
          )
        })}
        {/* Needle */}
        <line x1={CX} y1={CY} x2={nx.toFixed(1)} y2={ny.toFixed(1)}
          stroke={col} strokeWidth={2.5} strokeLinecap="round"
          style={{ transition: 'x2 0.07s ease-out, y2 0.07s ease-out, stroke 0.1s' }} />
        <circle cx={CX} cy={CY} r={6} fill={col} style={{ transition: 'fill 0.1s' }} />

        {/* Note name */}
        <text x={CX} y={CY - 62} textAnchor="middle" fontSize="46" fontWeight="800"
          fill={locked ? col : result ? C.text : '#3a3a3a'} style={{ transition: 'fill 0.12s' }}>
          {result ? result.noteName.replace(/(-?\d+)$/, '') : '—'}
        </text>
        <text x={CX + 26} y={CY - 76} textAnchor="start" fontSize="16" fontWeight="400"
          fill={locked ? col : result ? C.muted : '#3a3a3a'}>
          {result?.noteName.match(/(-?\d+)$/)?.[1] ?? ''}
        </text>

        {/* Cents readout */}
        <text x={CX} y={CY - 25} textAnchor="middle" fontSize="14"
          fill={result ? col : '#3a3a3a'} style={{ transition: 'fill 0.1s' }}>
          {result ? (result.cents === 0 ? '0¢' : result.cents > 0 ? `+${result.cents}¢` : `${result.cents}¢`) : ''}
        </text>

        {/* Locked indicator */}
        {locked && (
          <text x={CX} y={CY + 22} textAnchor="middle" fontSize="11" fontWeight="700" fill={C.green}>
            ● IN TUNE
          </text>
        )}
      </svg>

      {/* ── Mic button ── */}
      {micError && <div style={{ fontSize: 11, color: C.red }}>{micError}</div>}
      <button onClick={listening ? stopMic : startMic} style={{
        padding: '6px 20px', fontSize: 12, borderRadius: 6, cursor: 'pointer', fontWeight: 600,
        border: `1px solid ${listening ? C.red : C.accent}`,
        background: listening ? `${C.red}22` : `${C.accent}22`,
        color: listening ? C.red : C.accent,
      }}>{listening ? '⏹ Stop mic' : '🎤 Start mic'}</button>

      {/* ── Controls (shown while mic is on) ── */}
      {listening && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 8, width: '100%' }}>

          {/* Instrument preset row */}
          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', justifyContent: 'center' }}>
            {PRESET_FOLDERS.map(p => (
              <button key={p.folder} onClick={() => setPreset(p.folder)} style={{
                fontSize: 10, padding: '3px 8px', borderRadius: 4, cursor: 'pointer',
                border: `1px solid ${preset === p.folder ? C.accent : C.border}`,
                background: preset === p.folder ? `${C.accent}22` : 'transparent',
                color: preset === p.folder ? C.accent : C.muted,
              }}>{p.label}</button>
            ))}
          </div>

          {/* Play / Capture row */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={isPlaying ? killPlayback : playNote}
              disabled={!result || !hasSample}
              style={{
                flex: 1, padding: '7px 0', fontSize: 12, borderRadius: 5, fontWeight: 600, cursor: result && hasSample ? 'pointer' : 'not-allowed',
                border: `1px solid ${C.accent}`, background: isPlaying ? `${C.accent}44` : `${C.accent}22`,
                color: C.accent, opacity: result && hasSample ? 1 : 0.35,
              }}>{isPlaying ? '⏹ Stop' : `▶ Play${result ? ` ${result.noteName}` : ''}`}</button>

            <button onClick={captureNote} disabled={!result} style={{
              flex: 1, padding: '7px 0', fontSize: 12, borderRadius: 5, fontWeight: 600, cursor: result ? 'pointer' : 'not-allowed',
              border: `1px solid ${captured ? C.green : C.border}`,
              background: captured ? `${C.green}22` : 'transparent',
              color: captured ? C.green : C.text, opacity: result ? 1 : 0.35,
            }}>{captured ? '✓ Added' : '⊕ Capture'}</button>
          </div>

          {/* Note duration row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 10, color: C.muted, marginRight: 2 }}>Length:</span>
            {[0.25, 0.5, 1, 2].map(d => (
              <button key={d} onClick={() => setNoteDur(d)} style={{
                fontSize: 11, padding: '2px 10px', borderRadius: 3, cursor: 'pointer',
                border: `1px solid ${noteDur === d ? C.accent : C.border}`,
                background: noteDur === d ? `${C.accent}22` : 'transparent',
                color: noteDur === d ? C.accent : C.muted,
              }}>{NOTE_DUR_LABELS[d]}</button>
            ))}
          </div>

          {/* Status messages */}
          {capError && <div style={{ fontSize: 11, color: C.red }}>{capError}</div>}
          {!result && <div style={{ fontSize: 11, color: C.muted, textAlign: 'center' }}>Sing a note…</div>}
          {result && !hasSample && (
            <div style={{ fontSize: 11, color: C.muted }}>
              No "{result.noteName}" sample in {preset.split('–')[0].trim()} — import keyboard notes first
            </div>
          )}
        </div>
      )}
    </div>
  )
}
