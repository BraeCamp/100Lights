'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { LivePitchDetector, LivePitchResult } from '../../../lib/pitch-detector'
import { useDaw, makeMidiClip } from '../../../lib/daw-state'
import { isMidiClip } from '../../../lib/daw-types'
import type { MidiNote } from '../../../lib/daw-types'

// ── Constants ─────────────────────────────────────────────────────────────────
const MIN_NOTE_MS    = 200   // minimum held duration before a note is committed
const SILENCE_GAP_MS = 80    // silence grace period before triggering note-off
const PITCH_CHANGE_ST = 0.6  // semitones diff that counts as a new note

const NOTE_PC_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
function midiNoteName(midi: number) { return NOTE_PC_NAMES[midi % 12] + (Math.floor(midi / 12) - 1) }

// ── Mini arc geometry (compact, ~140px wide) ──────────────────────────────────
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

// ── Piano roll canvas renderer ────────────────────────────────────────────────
const WINDOW_BEATS = 8    // beats visible
const PITCHES      = 28   // pitch rows
const PITCH_H      = 6    // px per pitch row
const KEY_W        = 26   // keyboard strip width

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

  // ── Background rows ──
  for (let i = 0; i < PITCHES; i++) {
    const midi = loMidi + i
    const y    = H - (i + 1) * PITCH_H
    ctx.fillStyle = isBlackKey(midi) ? '#141414' : '#1c1c1c'
    ctx.fillRect(KEY_W, y, ROLL_W, PITCH_H)
    if (midi % 12 === 0) {  // C marker line
      ctx.fillStyle = 'rgba(255,255,255,0.06)'
      ctx.fillRect(KEY_W, y, ROLL_W, 1)
    }
  }

  // ── Beat grid lines ──
  ctx.strokeStyle = 'rgba(255,255,255,0.04)'
  ctx.lineWidth   = 1
  const firstBeat = Math.ceil(viewLo)
  for (let b = firstBeat; b <= viewLo + WINDOW_BEATS + 1; b++) {
    const x = KEY_W + (b - viewLo) / WINDOW_BEATS * ROLL_W
    if (x < KEY_W || x > W) continue
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke()
  }

  // ── Piano key strip ──
  for (let i = 0; i < PITCHES; i++) {
    const midi = loMidi + i
    const y    = H - (i + 1) * PITCH_H
    ctx.fillStyle = isBlackKey(midi) ? '#111' : '#2a2a2a'
    ctx.fillRect(0, y + 0.5, KEY_W - 1, PITCH_H - 1)
    if (midi % 12 === 0 || (!isBlackKey(midi) && PITCH_H >= 7)) {
      const nm = NOTE_PC_NAMES[midi % 12]
      if (nm === 'C' || (!isBlackKey(midi) && PITCH_H >= 8)) {
        ctx.fillStyle = isBlackKey(midi) ? '#666' : '#888'
        ctx.font      = `${Math.min(6, PITCH_H - 1)}px monospace`
        ctx.fillText(nm === 'C' ? `C${Math.floor(midi / 12) - 1}` : nm, 2, y + PITCH_H - 1)
      }
    }
  }

  // ── Committed notes ──
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

  // ── Held (ghost) note ──
  if (held && isRecording) {
    const hElapsed = elapsed - (held.startBeat - (recStartBeat))
    // held.startBeat is relative to recStartBeat, so note's absolute start is recStartBeat + held.startBeat
    const noteAbsStart = held.startBeat   // it IS relative: committed as currentBeat-recStartBeat at note-start
    const x = KEY_W + (noteAbsStart - viewLo) / WINDOW_BEATS * ROLL_W
    const w = Math.max(2, (elapsed - noteAbsStart) / WINDOW_BEATS * ROLL_W)
    const row = held.midi - loMidi
    if (row >= 0 && row < PITCHES && x < W) {
      const y = H - (row + 1) * PITCH_H
      ctx.fillStyle = 'rgba(61,143,239,0.4)'
      ctx.fillRect(Math.max(KEY_W, x), y + 1, w, PITCH_H - 2)
    }
  }

  // ── "Now" line ──
  if (isRecording) {
    const nowX = KEY_W + Math.min(elapsed, WINDOW_BEATS * 0.8) / WINDOW_BEATS * ROLL_W
    ctx.fillStyle = 'rgba(239,68,68,0.85)'
    ctx.fillRect(nowX - 1, 0, 2, H)
  }
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function PadVoice() {
  const { project, dispatch, engine, selectedClipId, setSelectedClipId, selectedTrackId, playing } = useDaw()

  const [result,       setResult]       = useState<LivePitchResult | null>(null)
  const [isRecording,  setIsRecording]  = useState(false)
  const [micError,     setMicError]     = useState<string | null>(null)
  const [transcribed,  setTranscribed]  = useState<TranscribedNote[]>([])
  const [held,         setHeld]         = useState<HeldNote | null>(null)
  const [loMidi,       setLoMidi]       = useState(48)   // C3

  const detectorRef    = useRef<LivePitchDetector | null>(null)
  const phaseRef       = useRef<'listening' | 'holding'>('listening')
  const heldRef        = useRef<HeldNote | null>(null)
  const silenceRef     = useRef<number | null>(null)
  const transcribedRef = useRef<TranscribedNote[]>([])
  const recStartRef    = useRef(0)
  const clipIdRef      = useRef<string | null>(null)
  const canvasRef      = useRef<HTMLCanvasElement>(null)
  const rafRef         = useRef<number | null>(null)

  // Keep refs in sync
  useEffect(() => { clipIdRef.current = selectedClipId }, [selectedClipId])
  useEffect(() => { transcribedRef.current = transcribed }, [transcribed])

  // Auto-center pitch range on detected midi
  useEffect(() => {
    if (!result) return
    const mid = Math.round(result.midi)
    if (mid < loMidi + 4 || mid >= loMidi + PITCHES - 4) {
      setLoMidi(Math.max(0, Math.min(127 - PITCHES, mid - Math.floor(PITCHES / 2))))
    }
  }, [result, loMidi])

  // RAF piano roll draw loop
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let raf: number
    function tick() {
      if (canvasRef.current) {
        const loM = loMidi  // capture current value
        drawRoll(canvasRef.current, transcribedRef.current, heldRef.current, loM, engine.currentBeat, recStartRef.current, isRecording)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [engine, isRecording, loMidi])

  // Commit a note to the MIDI clip
  const commitNote = useCallback((midi: number, startBeat: number, durationBeats: number) => {
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
    const tn: TranscribedNote = { id: note.id, midi, startBeat: note.startBeat, durationBeats: note.durationBeats }
    setTranscribed(prev => [...prev, tn])
  }, [dispatch, project.arrangementClips])

  // Process each pitch frame
  const processFrame = useCallback((r: LivePitchResult | null) => {
    const now     = Date.now()
    const curBeat = engine.currentBeat
    const elapsed = curBeat - recStartRef.current  // beats elapsed since recording started

    if (r && r.confidence >= 0.72) {
      silenceRef.current = null
      const midi = Math.round(r.midi)

      if (phaseRef.current === 'listening') {
        // New note start
        const h: HeldNote = { midi, startBeat: elapsed, startTime: now }
        phaseRef.current  = 'holding'
        heldRef.current   = h
        setHeld(h)
      } else if (phaseRef.current === 'holding' && heldRef.current) {
        const semitonesDiff = Math.abs(midi - heldRef.current.midi)
        if (semitonesDiff >= PITCH_CHANGE_ST) {
          // New note — commit old if long enough
          const prev = heldRef.current
          if (now - prev.startTime >= MIN_NOTE_MS) {
            const dur = Math.max(0.125, elapsed - prev.startBeat)
            commitNote(prev.midi, prev.startBeat, dur)
          }
          const h: HeldNote = { midi, startBeat: elapsed, startTime: now }
          heldRef.current  = h
          setHeld(h)
        }
        // else: same note, continue holding
      }
    } else {
      // Silence
      if (phaseRef.current === 'holding' && heldRef.current) {
        if (silenceRef.current === null) {
          silenceRef.current = now
        } else if (now - silenceRef.current > SILENCE_GAP_MS) {
          const prev = heldRef.current
          if (now - prev.startTime >= MIN_NOTE_MS) {
            const dur = Math.max(0.125, elapsed - prev.startBeat)
            commitNote(prev.midi, prev.startBeat, dur)
          }
          heldRef.current   = null
          phaseRef.current  = 'listening'
          setHeld(null)
          silenceRef.current = null
        }
      }
    }
  }, [engine, commitNote])

  // Start/stop voice recording
  const startRecording = useCallback(async () => {
    // Resolve or create a MIDI clip to record into
    let clipId = clipIdRef.current
    const existingClip = clipId ? project.arrangementClips.find(c => c.id === clipId) : null

    if (!existingClip || !isMidiClip(existingClip)) {
      // Need a track to create a clip on
      const trackId = selectedTrackId
      if (!trackId) {
        setMicError('Select a track or MIDI clip in the arrangement first.')
        return
      }
      const newClip = makeMidiClip(trackId, 'Voice', engine.currentBeat, 32)
      dispatch({ type: 'ADD_CLIP', clip: newClip })
      setSelectedClipId(newClip.id)
      clipIdRef.current = newClip.id
      clipId = newClip.id
    }

    // Start playback if not already playing
    if (!playing) engine.play()

    setMicError(null)
    phaseRef.current   = 'listening'
    heldRef.current    = null
    silenceRef.current = null
    recStartRef.current = engine.currentBeat
    setTranscribed([])
    setHeld(null)

    const d = new LivePitchDetector()
    detectorRef.current = d
    try {
      await d.start(r => {
        setResult(r)
        processFrame(r)
      })
      setIsRecording(true)
    } catch (e) {
      setMicError(e instanceof Error ? e.message : 'Microphone access denied')
      detectorRef.current = null
    }
  }, [engine, project.arrangementClips, processFrame])

  const stopRecording = useCallback(() => {
    // Commit any in-progress note
    if (phaseRef.current === 'holding' && heldRef.current) {
      const prev    = heldRef.current
      const elapsed = engine.currentBeat - recStartRef.current
      const dur     = Math.max(0.125, elapsed - prev.startBeat)
      if (Date.now() - prev.startTime >= MIN_NOTE_MS) commitNote(prev.midi, prev.startBeat, dur)
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

  // ── Derived display values ─────────────────────────────────────────────────
  const conf     = result?.confidence ?? 0
  const cents    = result?.cents ?? 0
  const noteName = result?.noteName ?? '—'
  const hz       = result?.hz ?? 0
  const color    = tunerColor(cents, conf)
  const needleDeg = centsDeg(conf < 0.4 ? 0 : cents)
  const [nx, ny]  = aPt(needleDeg, AR - 8)
  const inTune    = conf >= 0.75 && Math.abs(cents) <= 8
  const hasTarget = !!selectedTrackId || (!!selectedClipId && (() => {
    const clip = project.arrangementClips.find(c => c.id === selectedClipId)
    return !!(clip && isMidiClip(clip))
  })())

  // Arc paths
  const arcStart = 270 - ASWEEP
  const arcEnd   = 270 + ASWEEP
  const hiStart  = 270
  const hiEnd    = needleDeg

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0e0e0e', overflowY: 'auto' }}>

      {/* ── Top section: tuner arc + piano roll side by side ── */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #222', flexShrink: 0 }}>

        {/* Mini tuner arc */}
        <div style={{ width: 140, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '10px 4px 6px', borderRight: '1px solid #1e1e1e' }}>
          <svg width={140} height={90} style={{ overflow: 'visible' }}>
            {/* Track */}
            <path d={arcPath(ACX, ACY, AR, arcStart, arcEnd)} fill="none" stroke="#252525" strokeWidth={8} strokeLinecap="round" />
            {/* Highlight from center to needle */}
            {conf >= 0.4 && (
              <path d={arcPath(ACX, ACY, AR, hiStart, hiEnd)} fill="none" stroke={color} strokeWidth={8} strokeLinecap="round" opacity={0.6} />
            )}
            {/* Tick marks */}
            {TICK_CENTS.map(c => {
              const d  = centsDeg(c)
              const [ix, iy] = aPt(d, AR + 6)
              const [ox, oy] = aPt(d, AR + 12)
              return <line key={c} x1={ix} y1={iy} x2={ox} y2={oy} stroke={c === 0 ? '#555' : '#333'} strokeWidth={c === 0 ? 2 : 1} strokeLinecap="round" />
            })}
            {/* Needle */}
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

        {/* Live piano roll */}
        <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
          <canvas
            ref={canvasRef}
            width={320}
            height={PITCHES * PITCH_H}
            style={{ width: '100%', height: PITCHES * PITCH_H, display: 'block', imageRendering: 'pixelated' }}
          />
          {!isRecording && transcribed.length === 0 && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, color: '#333', pointerEvents: 'none', textAlign: 'center',
            }}>
              Select a MIDI clip, then press Record
            </div>
          )}
        </div>
      </div>

      {/* ── Controls ── */}
      <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        {!isRecording ? (
          <button
            onClick={startRecording}
            disabled={!hasTarget}
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
          <button
            onClick={stopRecording}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '7px 16px',
              borderRadius: 6, border: 'none', cursor: 'pointer',
              background: '#1a1a1a', color: '#ef4444', fontSize: 12, fontWeight: 700,
              outline: '1px solid #ef4444', flexShrink: 0,
            }}>
            <span style={{ width: 10, height: 10, background: '#ef4444', display: 'inline-block' }} />
            Stop
          </button>
        )}

        {isRecording && (
          <span style={{ fontSize: 10, color: '#ef4444', fontWeight: 700, letterSpacing: '0.06em', animation: 'pulse 1s infinite' }}>
            ● RECORDING
          </span>
        )}

        <div style={{ marginLeft: 'auto', fontSize: 10, color: '#444', textAlign: 'right' }}>
          {transcribed.length > 0 && `${transcribed.length} note${transcribed.length !== 1 ? 's' : ''} captured`}
        </div>
      </div>

      {/* ── Error / status ── */}
      {micError && (
        <div style={{ margin: '0 14px 10px', padding: '6px 10px', borderRadius: 5, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', fontSize: 11, color: '#ef4444' }}>
          {micError}
        </div>
      )}

      {!hasTarget && !isRecording && (
        <div style={{ margin: '0 14px 10px', padding: '6px 10px', borderRadius: 5, background: 'rgba(61,143,239,0.06)', border: '1px solid rgba(61,143,239,0.2)', fontSize: 11, color: '#3d8fef' }}>
          Click a track in the arrangement — a new MIDI clip will be created automatically when you start recording.
        </div>
      )}

      {/* ── How it works blurb ── */}
      <div style={{ padding: '0 14px 14px', fontSize: 10, color: '#333', lineHeight: 1.6 }}>
        Sing or hum into your mic. Notes are detected in real time and written to the selected MIDI clip.
        Hold each note for at least 200ms. Change pitch to move to the next note.
      </div>
    </div>
  )
}
