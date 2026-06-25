'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { LivePitchDetector, LivePitchResult, detectBufferPitch } from '../../../lib/pitch-detector'
import { useDaw, makeMidiClip, makeAudioClip } from '../../../lib/daw-state'
import { isMidiClip } from '../../../lib/daw-types'
import { encodeWav } from '../../../lib/wav-codec'
import { libraryGetAll } from '../../../lib/sound-library'
import type { MidiNote } from '../../../lib/daw-types'
import type { LibraryEntry } from '../../../lib/sound-library'

// ── Constants ─────────────────────────────────────────────────────────────────
const MIN_NOTE_MS    = 200
const SILENCE_GAP_MS = 80
const PITCH_CHANGE_ST = 0.6

const NOTE_PC_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
function midiNoteName(midi: number) { return NOTE_PC_NAMES[midi % 12] + (Math.floor(midi / 12) - 1) }

const NOTE_PC: Record<string, number> = { C:0,'C#':1,D:2,'D#':3,E:4,F:5,'F#':6,G:7,'G#':8,A:9,'A#':10,B:11 }
function parseSampleRoot(name: string): number {
  const m = name.match(/^([A-G]#?)(-?\d+)$/)
  if (!m) return 60  // default C4
  const pc = NOTE_PC[m[1]]
  return pc !== undefined ? (parseInt(m[2]) + 1) * 12 + pc : 60
}

// ── Mini arc geometry ─────────────────────────────────────────────────────────
const ACX = 70, ACY = 70, AR = 55, ASWEEP = 68

function aRad(d: number) { return d * Math.PI / 180 }
function aPt(deg: number, r: number): [number, number] {
  return [ACX + r * Math.cos(aRad(deg)), ACY + r * Math.sin(aRad(deg))]
}
function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const [x1, y1] = [cx + r * Math.cos(aRad(startDeg)), cy + r * Math.sin(aRad(startDeg))]
  const [x2, y2] = [cx + r * Math.cos(aRad(endDeg)),   cy + r * Math.sin(aRad(endDeg))]
  const large = Math.abs(endDeg - startDeg) > 180 ? 1 : 0
  return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`
}
function centsDeg(cents: number) { return 270 + Math.max(-50, Math.min(50, cents)) * ASWEEP / 50 }
function tunerColor(cents: number, conf: number) {
  if (conf < 0.55) return '#555'
  const a = Math.abs(cents)
  return a <= 5 ? '#22c55e' : a <= 18 ? '#eab308' : '#ef4444'
}
const TICK_CENTS = [-50, -25, 0, 25, 50]

// ── Piano roll canvas ─────────────────────────────────────────────────────────
const WINDOW_BEATS = 8
const PITCHES      = 28
const PITCH_H      = 6
const KEY_W        = 26

interface TranscribedNote { id: string; midi: number; startBeat: number; durationBeats: number }
interface HeldNote        { midi: number; startBeat: number; startTime: number }

function isBlackKey(midi: number) { return [1,3,6,8,10].includes(midi % 12) }

function drawRoll(
  canvas: HTMLCanvasElement,
  transcribed: TranscribedNote[],
  held: HeldNote | null,
  loMidi: number,
  currentBeat: number,
  recStartBeat: number,
  isRecording: boolean,
) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const W = canvas.width
  const H = canvas.height
  const ROLL_W = W - KEY_W
  const elapsed = isRecording ? currentBeat - recStartBeat : 0
  const viewLo  = Math.max(0, elapsed - WINDOW_BEATS * 0.8)

  ctx.clearRect(0, 0, W, H)

  for (let i = 0; i < PITCHES; i++) {
    const midi = loMidi + i
    const y    = H - (i + 1) * PITCH_H
    ctx.fillStyle = isBlackKey(midi) ? '#141414' : '#1c1c1c'
    ctx.fillRect(KEY_W, y, ROLL_W, PITCH_H)
    if (midi % 12 === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.06)'
      ctx.fillRect(KEY_W, y, ROLL_W, 1)
    }
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.04)'
  ctx.lineWidth   = 1
  for (let b = Math.ceil(viewLo); b <= viewLo + WINDOW_BEATS + 1; b++) {
    const x = KEY_W + (b - viewLo) / WINDOW_BEATS * ROLL_W
    if (x < KEY_W || x > W) continue
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke()
  }

  for (let i = 0; i < PITCHES; i++) {
    const midi = loMidi + i
    const y    = H - (i + 1) * PITCH_H
    ctx.fillStyle = isBlackKey(midi) ? '#111' : '#2a2a2a'
    ctx.fillRect(0, y + 0.5, KEY_W - 1, PITCH_H - 1)
    const nm = NOTE_PC_NAMES[midi % 12]
    if (nm === 'C') {
      ctx.fillStyle = '#666'
      ctx.font = `${Math.min(6, PITCH_H - 1)}px monospace`
      ctx.fillText(`C${Math.floor(midi / 12) - 1}`, 2, y + PITCH_H - 1)
    }
  }

  for (const note of transcribed) {
    const x = KEY_W + (note.startBeat - viewLo) / WINDOW_BEATS * ROLL_W
    const w = note.durationBeats / WINDOW_BEATS * ROLL_W
    if (x + w < KEY_W || x > W) continue
    const row = note.midi - loMidi
    if (row < 0 || row >= PITCHES) continue
    const y = H - (row + 1) * PITCH_H
    ctx.fillStyle = '#3d8fef'
    ctx.fillRect(Math.max(KEY_W, x), y + 1, Math.max(2, w - 1), PITCH_H - 2)
    ctx.fillStyle = 'rgba(100,180,255,0.4)'
    ctx.fillRect(Math.max(KEY_W, x), y + 1, 2, PITCH_H - 2)
  }

  if (held && isRecording) {
    const noteAbsStart = held.startBeat
    const x = KEY_W + (noteAbsStart - viewLo) / WINDOW_BEATS * ROLL_W
    const w = Math.max(2, (elapsed - noteAbsStart) / WINDOW_BEATS * ROLL_W)
    const row = held.midi - loMidi
    if (row >= 0 && row < PITCHES && x < W) {
      const y = H - (row + 1) * PITCH_H
      ctx.fillStyle = 'rgba(61,143,239,0.4)'
      ctx.fillRect(Math.max(KEY_W, x), y + 1, w, PITCH_H - 2)
    }
  }

  if (isRecording) {
    const nowX = KEY_W + Math.min(elapsed, WINDOW_BEATS * 0.8) / WINDOW_BEATS * ROLL_W
    ctx.fillStyle = 'rgba(239,68,68,0.85)'
    ctx.fillRect(nowX - 1, 0, 2, H)
  }
}

// ── Audio rendering helpers ───────────────────────────────────────────────────

async function renderPitchedBuffer(
  blob: Blob,
  semitones: number,
  durationSec: number,
): Promise<AudioBuffer> {
  const rate  = Math.pow(2, semitones / 12)
  const arrBuf = await blob.arrayBuffer()
  // Decode in a temporary context
  const tmp = new AudioContext()
  const input = await tmp.decodeAudioData(arrBuf.slice(0))
  await tmp.close()

  const SR     = 44100
  const outDur = Math.min(durationSec + 0.15, input.duration / rate, 10)
  const ctx    = new OfflineAudioContext(input.numberOfChannels, Math.ceil(outDur * SR), SR)
  const src    = ctx.createBufferSource()
  src.buffer         = input
  src.playbackRate.value = rate
  src.connect(ctx.destination)
  src.start(0)
  return ctx.startRendering()
}

function bufferToWavBlob(buf: AudioBuffer): Blob {
  const channels = Array.from({ length: buf.numberOfChannels }, (_, ch) => buf.getChannelData(ch))
  return new Blob([encodeWav(channels, buf.sampleRate)], { type: 'audio/wav' })
}

// Run YIN on the rendered buffer (middle 20% to avoid attack transient)
function checkPitch(buf: AudioBuffer, targetMidi: number): { ok: boolean; detected: number | null } {
  const data   = buf.getChannelData(0)
  const offset = Math.floor(data.length * 0.2)
  const r      = detectBufferPitch(data, buf.sampleRate, offset)
  if (!r) return { ok: true, detected: null }   // can't detect = pass through
  const ok = Math.abs(r.midi - targetMidi) <= 2  // ±2 semitones tolerance
  return { ok, detected: r.midi }
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function PadVoice() {
  const { project, dispatch, engine, selectedClipId, setSelectedClipId, selectedTrackId, playing } = useDaw()

  const [result,         setResult]         = useState<LivePitchResult | null>(null)
  const [isRecording,    setIsRecording]    = useState(false)
  const [micError,       setMicError]       = useState<string | null>(null)
  const [transcribed,    setTranscribed]    = useState<TranscribedNote[]>([])
  const [held,           setHeld]           = useState<HeldNote | null>(null)
  const [loMidi,         setLoMidi]         = useState(48)

  // Sample mode
  const [sampleEntries,    setSampleEntries]    = useState<LibraryEntry[]>([])
  const [selectedSample,   setSelectedSample]   = useState<LibraryEntry | null>(null)
  const [showSamplePicker, setShowSamplePicker] = useState(false)
  const [sampleSearch,     setSampleSearch]     = useState('')
  const [renderStatus,     setRenderStatus]     = useState<string | null>(null)

  const detectorRef      = useRef<LivePitchDetector | null>(null)
  const phaseRef         = useRef<'listening' | 'holding'>('listening')
  const heldRef          = useRef<HeldNote | null>(null)
  const silenceRef       = useRef<number | null>(null)
  const transcribedRef   = useRef<TranscribedNote[]>([])
  const recStartRef      = useRef(0)
  const clipIdRef        = useRef<string | null>(null)
  const trackIdRef       = useRef<string | null>(null)
  const selectedSampleRef = useRef<LibraryEntry | null>(null)
  const canvasRef        = useRef<HTMLCanvasElement>(null)

  useEffect(() => { clipIdRef.current = selectedClipId },     [selectedClipId])
  useEffect(() => { trackIdRef.current = selectedTrackId },   [selectedTrackId])
  useEffect(() => { transcribedRef.current = transcribed },   [transcribed])
  useEffect(() => { selectedSampleRef.current = selectedSample }, [selectedSample])

  useEffect(() => { libraryGetAll().then(setSampleEntries).catch(() => {}) }, [])

  useEffect(() => {
    if (!result) return
    const mid = Math.round(result.midi)
    if (mid < loMidi + 4 || mid >= loMidi + PITCHES - 4) {
      setLoMidi(Math.max(0, Math.min(127 - PITCHES, mid - Math.floor(PITCHES / 2))))
    }
  }, [result, loMidi])

  useEffect(() => {
    let raf: number
    function tick() {
      if (canvasRef.current) {
        drawRoll(canvasRef.current, transcribedRef.current, heldRef.current, loMidi, engine.currentBeat, recStartRef.current, isRecording)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [engine, isRecording, loMidi])

  // ── Commit note ─────────────────────────────────────────────────────────────
  const commitNote = useCallback(async (midi: number, startBeat: number, durationBeats: number) => {
    const sample  = selectedSampleRef.current
    const trackId = trackIdRef.current

    if (sample && trackId) {
      // ── Audio-clip path ──
      const rootMidi   = parseSampleRoot(sample.name)
      const semitones  = midi - rootMidi
      const tempo      = engine.tempo ?? 120
      const durationSec = Math.max(0.1, (durationBeats / tempo) * 60)

      setRenderStatus(`Rendering ${midiNoteName(midi)}…`)
      try {
        const pitched = await renderPitchedBuffer(sample.audioBlob, semitones, durationSec)

        // Verify pitch
        const check = checkPitch(pitched, midi)
        if (!check.ok) {
          setRenderStatus(`Pitch mismatch on ${midiNoteName(midi)} (detected ${check.detected !== null ? midiNoteName(check.detected) : '?'}) — skipped`)
          setTimeout(() => setRenderStatus(null), 3000)
          return
        }

        const wavBlob = bufferToWavBlob(pitched)
        const audioUrl = URL.createObjectURL(wavBlob)
        const absStart = recStartRef.current + startBeat
        const actualDur = Math.max(0.125, pitched.duration / tempo * 60)

        const clip = makeAudioClip(trackId, `${sample.name} → ${midiNoteName(midi)}`, absStart, actualDur * tempo / 60, { audioUrl })
        dispatch({ type: 'ADD_CLIP', clip })
        setTranscribed(prev => [...prev, { id: clip.id, midi, startBeat, durationBeats: clip.durationBeats }])
        setRenderStatus(null)
      } catch (e) {
        setRenderStatus(`Error rendering ${midiNoteName(midi)}`)
        setTimeout(() => setRenderStatus(null), 3000)
      }
    } else {
      // ── MIDI path ──
      const clipId = clipIdRef.current
      if (!clipId) return
      const clip = project.arrangementClips.find(c => c.id === clipId)
      if (!clip || !isMidiClip(clip)) return

      const note: MidiNote = {
        id:            crypto.randomUUID(),
        pitch:         midi,
        startBeat:     Math.max(0, startBeat),
        durationBeats: Math.max(0.125, durationBeats),
        velocity:      100,
      }
      dispatch({ type: 'ADD_MIDI_NOTE', clipId, note })
      setTranscribed(prev => [...prev, { id: note.id, midi, startBeat: note.startBeat, durationBeats: note.durationBeats }])
    }
  }, [dispatch, engine, project.arrangementClips])

  // ── Pitch frame processing ───────────────────────────────────────────────────
  const processFrame = useCallback((r: LivePitchResult | null) => {
    const now     = Date.now()
    const elapsed = engine.currentBeat - recStartRef.current

    if (r && r.confidence >= 0.72) {
      silenceRef.current = null
      const midi = Math.round(r.midi)

      if (phaseRef.current === 'listening') {
        const h: HeldNote = { midi, startBeat: elapsed, startTime: now }
        phaseRef.current  = 'holding'
        heldRef.current   = h
        setHeld(h)
      } else if (phaseRef.current === 'holding' && heldRef.current) {
        if (Math.abs(midi - heldRef.current.midi) >= PITCH_CHANGE_ST) {
          const prev = heldRef.current
          if (now - prev.startTime >= MIN_NOTE_MS) {
            void commitNote(prev.midi, prev.startBeat, Math.max(0.125, elapsed - prev.startBeat))
          }
          const h: HeldNote = { midi, startBeat: elapsed, startTime: now }
          heldRef.current  = h
          setHeld(h)
        }
      }
    } else {
      if (phaseRef.current === 'holding' && heldRef.current) {
        if (silenceRef.current === null) {
          silenceRef.current = now
        } else if (now - silenceRef.current > SILENCE_GAP_MS) {
          const prev = heldRef.current
          if (now - prev.startTime >= MIN_NOTE_MS) {
            void commitNote(prev.midi, prev.startBeat, Math.max(0.125, elapsed - prev.startBeat))
          }
          heldRef.current    = null
          phaseRef.current   = 'listening'
          silenceRef.current = null
          setHeld(null)
        }
      }
    }
  }, [engine, commitNote])

  // ── Start / Stop ─────────────────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    const sample  = selectedSampleRef.current
    const trackId = trackIdRef.current

    if (sample) {
      // Sample mode — only need a track
      if (!trackId) {
        setMicError('Select a track in the arrangement first.')
        return
      }
    } else {
      // MIDI mode — need a MIDI clip
      const clipId = clipIdRef.current
      const existingClip = clipId ? project.arrangementClips.find(c => c.id === clipId) : null
      if (!existingClip || !isMidiClip(existingClip)) {
        if (!trackId) {
          setMicError('Select a track or MIDI clip first.')
          return
        }
        const newClip = makeMidiClip(trackId, 'Voice', engine.currentBeat, 32)
        dispatch({ type: 'ADD_CLIP', clip: newClip })
        setSelectedClipId(newClip.id)
        clipIdRef.current = newClip.id
      }
    }

    if (!playing) engine.play()

    setMicError(null)
    phaseRef.current    = 'listening'
    heldRef.current     = null
    silenceRef.current  = null
    recStartRef.current = engine.currentBeat
    setTranscribed([])
    setHeld(null)

    const d = new LivePitchDetector()
    detectorRef.current = d
    try {
      await d.start(r => { setResult(r); processFrame(r) })
      setIsRecording(true)
    } catch (e) {
      setMicError(e instanceof Error ? e.message : 'Microphone access denied')
      detectorRef.current = null
    }
  }, [engine, playing, project.arrangementClips, dispatch, setSelectedClipId, processFrame])

  const stopRecording = useCallback(() => {
    if (phaseRef.current === 'holding' && heldRef.current) {
      const prev    = heldRef.current
      const elapsed = engine.currentBeat - recStartRef.current
      if (Date.now() - prev.startTime >= MIN_NOTE_MS) {
        void commitNote(prev.midi, prev.startBeat, Math.max(0.125, elapsed - prev.startBeat))
      }
    }
    detectorRef.current?.stop()
    detectorRef.current = null
    phaseRef.current    = 'listening'
    heldRef.current     = null
    setHeld(null)
    setIsRecording(false)
    setResult(null)
  }, [engine, commitNote])

  useEffect(() => () => { detectorRef.current?.stop() }, [])

  // ── Derived display ──────────────────────────────────────────────────────────
  const conf      = result?.confidence ?? 0
  const cents     = result?.cents ?? 0
  const noteName  = result?.noteName ?? '—'
  const hz        = result?.hz ?? 0
  const color     = tunerColor(cents, conf)
  const needleDeg = centsDeg(conf < 0.4 ? 0 : cents)
  const [nx, ny]  = aPt(needleDeg, AR - 8)
  const inTune    = conf >= 0.75 && Math.abs(cents) <= 8
  const hasTarget = !!(selectedTrackId || selectedClipId)

  const filteredSamples = sampleEntries.filter(e =>
    !sampleSearch || e.name.toLowerCase().includes(sampleSearch.toLowerCase()) || (e.folder ?? '').toLowerCase().includes(sampleSearch.toLowerCase())
  )

  const arcStart = 270 - ASWEEP
  const arcEnd   = 270 + ASWEEP
  const hiEnd    = needleDeg

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0e0e0e', overflowY: 'auto', position: 'relative' }}>

      {/* ── Sample picker strip ── */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid #1e1e1e', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 10, color: '#555', flexShrink: 0 }}>Sample:</span>
        <button
          onClick={() => setShowSamplePicker(v => !v)}
          style={{
            flex: 1, textAlign: 'left', fontSize: 11, padding: '4px 8px', borderRadius: 4,
            background: selectedSample ? 'rgba(61,143,239,0.08)' : '#1a1a1a',
            border: `1px solid ${selectedSample ? 'rgba(61,143,239,0.3)' : '#2a2a2a'}`,
            color: selectedSample ? '#3d8fef' : '#555', cursor: 'pointer',
          }}>
          {selectedSample ? `${selectedSample.name}${selectedSample.folder ? ` · ${selectedSample.folder}` : ''}` : 'None — writes MIDI notes'}
          <span style={{ float: 'right', opacity: 0.5 }}>▾</span>
        </button>
        {selectedSample && (
          <button onClick={() => setSelectedSample(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#555', fontSize: 14, padding: '0 2px' }}>×</button>
        )}
      </div>

      {/* ── Sample picker dropdown ── */}
      {showSamplePicker && (
        <div style={{
          position: 'absolute', top: 42, left: 12, right: 12, zIndex: 50,
          background: '#141414', border: '1px solid #2a2a2a', borderRadius: 6,
          boxShadow: '0 8px 24px rgba(0,0,0,0.6)', overflow: 'hidden',
        }}>
          <div style={{ padding: '6px 8px', borderBottom: '1px solid #1e1e1e' }}>
            <input
              autoFocus
              value={sampleSearch}
              onChange={e => setSampleSearch(e.target.value)}
              placeholder="Search samples…"
              style={{ width: '100%', fontSize: 11, background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 4, color: '#ccc', padding: '4px 8px', boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
            {filteredSamples.length === 0 && (
              <div style={{ padding: '12px 10px', fontSize: 11, color: '#444', textAlign: 'center' }}>No samples found</div>
            )}
            {filteredSamples.map(e => (
              <button key={e.id} onClick={() => { setSelectedSample(e); setShowSamplePicker(false); setSampleSearch('') }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '5px 10px',
                  background: selectedSample?.id === e.id ? 'rgba(61,143,239,0.1)' : 'transparent',
                  border: 'none', cursor: 'pointer', borderBottom: '1px solid #1a1a1a',
                }}>
                <span style={{ fontSize: 11, color: selectedSample?.id === e.id ? '#3d8fef' : '#ccc' }}>{e.name}</span>
                {e.folder && <span style={{ fontSize: 9, color: '#444', marginLeft: 6 }}>{e.folder}</span>}
              </button>
            ))}
          </div>
          <div style={{ padding: '5px 8px', borderTop: '1px solid #1e1e1e', display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={() => setShowSamplePicker(false)} style={{ fontSize: 10, color: '#555', background: 'none', border: 'none', cursor: 'pointer' }}>Close</button>
          </div>
        </div>
      )}

      {/* ── Tuner arc + piano roll ── */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #222', flexShrink: 0 }}>
        <div style={{ width: 140, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '10px 4px 6px', borderRight: '1px solid #1e1e1e' }}>
          <svg width={140} height={90} style={{ overflow: 'visible' }}>
            <path d={arcPath(ACX, ACY, AR, arcStart, arcEnd)} fill="none" stroke="#252525" strokeWidth={8} strokeLinecap="round" />
            {conf >= 0.4 && (
              <path d={arcPath(ACX, ACY, AR, 270, hiEnd)} fill="none" stroke={color} strokeWidth={8} strokeLinecap="round" opacity={0.6} />
            )}
            {TICK_CENTS.map(c => {
              const d  = centsDeg(c)
              const [ix, iy] = aPt(d, AR + 6)
              const [ox, oy] = aPt(d, AR + 12)
              return <line key={c} x1={ix} y1={iy} x2={ox} y2={oy} stroke={c === 0 ? '#555' : '#333'} strokeWidth={c === 0 ? 2 : 1} strokeLinecap="round" />
            })}
            <line x1={ACX} y1={ACY} x2={nx} y2={ny} stroke={color} strokeWidth={2} strokeLinecap="round"
              style={{ transition: conf < 0.4 ? 'none' : 'x2 0.06s linear, y2 0.06s linear' }} />
            <circle cx={ACX} cy={ACY} r={4} fill={color} />
          </svg>
          <div style={{ textAlign: 'center', marginTop: -2 }}>
            <div style={{ fontSize: 20, fontWeight: 800, color, fontFamily: 'monospace', lineHeight: 1 }}>
              {conf >= 0.45 ? noteName : '—'}
            </div>
            {conf >= 0.45 && (
              <div style={{ fontSize: 9, color: '#555', marginTop: 2 }}>
                {cents > 0 ? '+' : ''}{cents.toFixed(0)}¢ · {hz.toFixed(0)}Hz
              </div>
            )}
            {inTune && isRecording && (
              <div style={{ fontSize: 8, color: '#22c55e', fontWeight: 700, letterSpacing: '0.08em', marginTop: 2 }}>IN TUNE</div>
            )}
          </div>
        </div>

        <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
          <canvas
            ref={canvasRef}
            width={320}
            height={PITCHES * PITCH_H}
            style={{ width: '100%', height: PITCHES * PITCH_H, display: 'block', imageRendering: 'pixelated' }}
          />
          {!isRecording && transcribed.length === 0 && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#333', pointerEvents: 'none', textAlign: 'center', padding: '0 12px' }}>
              {selectedSample ? `Will pitch "${selectedSample.name}" to each note` : 'Select a track, then press Record Voice'}
            </div>
          )}
        </div>
      </div>

      {/* ── Controls ── */}
      <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        {!isRecording ? (
          <button onClick={startRecording} disabled={!hasTarget}
            title={hasTarget ? 'Start voice transcription' : 'Select a track first'}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '7px 16px',
              borderRadius: 6, border: 'none', cursor: hasTarget ? 'pointer' : 'not-allowed',
              background: hasTarget ? '#ef4444' : '#2a1a1a', color: hasTarget ? '#fff' : '#555',
              fontSize: 12, fontWeight: 700, flexShrink: 0,
            }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} />
            Record Voice
          </button>
        ) : (
          <button onClick={stopRecording}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '7px 16px',
              borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700,
              background: '#1a1a1a', color: '#ef4444', outline: '1px solid #ef4444', border: 'none', flexShrink: 0,
            }}>
            <span style={{ width: 10, height: 10, background: '#ef4444', display: 'inline-block' }} />
            Stop
          </button>
        )}

        {isRecording && (
          <span style={{ fontSize: 10, color: '#ef4444', fontWeight: 700, letterSpacing: '0.06em' }}>● RECORDING</span>
        )}

        {renderStatus && (
          <span style={{ fontSize: 10, color: '#eab308' }}>{renderStatus}</span>
        )}

        <div style={{ marginLeft: 'auto', fontSize: 10, color: '#444', textAlign: 'right' }}>
          {transcribed.length > 0 && `${transcribed.length} note${transcribed.length !== 1 ? 's' : ''}`}
        </div>
      </div>

      {/* ── Errors ── */}
      {micError && (
        <div style={{ margin: '0 14px 10px', padding: '6px 10px', borderRadius: 5, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', fontSize: 11, color: '#ef4444' }}>
          {micError}
        </div>
      )}

      {!hasTarget && !isRecording && (
        <div style={{ margin: '0 14px 10px', padding: '6px 10px', borderRadius: 5, background: 'rgba(61,143,239,0.06)', border: '1px solid rgba(61,143,239,0.2)', fontSize: 11, color: '#3d8fef' }}>
          {selectedSample
            ? 'Select a track — audio clips will be placed on it as you sing.'
            : 'Select a track — a MIDI clip will be created automatically when you start.'}
        </div>
      )}

      <div style={{ padding: '0 14px 14px', fontSize: 10, color: '#333', lineHeight: 1.6 }}>
        {selectedSample
          ? `Singing pitches the sample "${selectedSample.name}" to match. YIN verifies each note before placing the clip.`
          : 'Sing or hum into your mic. Notes are detected and written to the selected MIDI clip.'}
      </div>
    </div>
  )
}
