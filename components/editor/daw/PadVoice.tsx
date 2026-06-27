'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'
import { LivePitchDetector, LivePitchResult, detectPitchCurveAsync } from '../../../lib/pitch-detector'
import { useDaw, makeMidiClip, makeAudioClip } from '../../../lib/daw-state'
import { isMidiClip } from '../../../lib/daw-types'
import { encodeWav } from '../../../lib/wav-codec'
import { libraryGetAll } from '../../../lib/sound-library'
import { libraryFulfill } from '../../../lib/default-samples'
import { getPresets, clampToPreset, presetDisplayName } from '../../../lib/midi-presets'
import { captureAudioInput } from '../../../lib/audio-capture'
import type { AudioInputSource } from '../../../lib/audio-capture'
import type { MidiNote } from '../../../lib/daw-types'
import type { LibraryEntry } from '../../../lib/sound-library'
import type { MidiPreset } from '../../../lib/midi-presets'

// ── Constants ─────────────────────────────────────────────────────────────────
const MIN_NOTE_MS    = 100
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
interface HeldNote        { midi: number; startBeat: number; startTime: number; midiSamples: number[] }

function medianOf(arr: number[]): number {
  const s = arr.slice().sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

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

// ── Sample row (reusable inside picker) ──────────────────────────────────────
function SampleRow({
  entry, selected, onSelect, onFulfilled,
}: {
  entry: LibraryEntry
  selected: boolean
  onSelect: (fulfilled: LibraryEntry) => void
  onFulfilled: (fulfilled: LibraryEntry) => void
}) {
  const [loading, setLoading] = useState(false)
  const [playing, setPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  async function getBlob(): Promise<LibraryEntry | null> {
    if (entry.audioBlob) return entry
    setLoading(true)
    try {
      const fulfilled = await libraryFulfill(entry.id)
      if (fulfilled) onFulfilled(fulfilled)
      return fulfilled
    } finally {
      setLoading(false)
    }
  }

  async function handlePlay(e: React.MouseEvent) {
    e.stopPropagation()
    if (playing) {
      audioRef.current?.pause()
      if (audioRef.current) audioRef.current.src = ''
      audioRef.current = null
      setPlaying(false)
      return
    }
    const e2 = await getBlob()
    if (!e2?.audioBlob) return
    const url = URL.createObjectURL(e2.audioBlob)
    const el = new Audio(url)
    audioRef.current = el
    el.onended = () => { setPlaying(false); URL.revokeObjectURL(url) }
    el.play().then(() => setPlaying(true)).catch(() => { setPlaying(false); URL.revokeObjectURL(url) })
  }

  async function handleSelect() {
    const e2 = entry.audioBlob ? entry : await getBlob()
    if (e2) onSelect(e2)
  }

  const isStub = !entry.audioBlob

  return (
    <div style={{
      display: 'flex', alignItems: 'center',
      background: selected ? 'rgba(61,143,239,0.12)' : 'transparent',
      borderBottom: '1px solid #141414',
    }}>
      <button onClick={handleSelect} style={{
        flex: 1, textAlign: 'left', padding: '4px 14px',
        background: 'transparent', border: 'none', cursor: 'pointer',
      }}>
        <span style={{ fontSize: 11, color: selected ? '#3d8fef' : isStub ? '#666' : '#bbb' }}>
          {entry.name}
        </span>
        {isStub && !loading && <span style={{ fontSize: 9, color: '#444', marginLeft: 5 }}>↓</span>}
        {loading && <span style={{ fontSize: 9, color: '#555', marginLeft: 5 }}>…</span>}
      </button>
      <button onClick={handlePlay} style={{
        background: 'none', border: 'none', cursor: 'pointer',
        color: playing ? '#3d8fef' : '#444', padding: '4px 10px 4px 4px',
        fontSize: 13, lineHeight: 1, flexShrink: 0,
      }}>
        {playing ? '■' : '▶'}
      </button>
    </div>
  )
}

// ── Audio rendering helpers ───────────────────────────────────────────────────

async function renderPitchedBuffer(blob: Blob, semitones: number): Promise<AudioBuffer> {
  const rate   = Math.pow(2, semitones / 12)
  const arrBuf = await blob.arrayBuffer()
  const tmp    = new AudioContext()
  const input  = await tmp.decodeAudioData(arrBuf.slice(0))
  await tmp.close()

  const SR     = 44100
  const outDur = Math.min(input.duration / rate, 10)
  const ctx    = new OfflineAudioContext(input.numberOfChannels, Math.ceil(outDur * SR), SR)
  const src    = ctx.createBufferSource()
  src.buffer             = input
  src.playbackRate.value = rate
  src.connect(ctx.destination)
  src.start(0)
  return ctx.startRendering()
}

function bufferToWavBlob(buf: AudioBuffer): Blob {
  const channels = Array.from({ length: buf.numberOfChannels }, (_, ch) => buf.getChannelData(ch))
  return new Blob([encodeWav(channels, buf.sampleRate)], { type: 'audio/wav' })
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

  // Preset mode
  const [presets,         setPresets]         = useState<MidiPreset[]>([])
  const [selectedPreset,  setSelectedPreset]  = useState<MidiPreset | null>(null)
  const [showPresetPicker, setShowPresetPicker] = useState(false)

  // Sample mode (single sample + pitch-shift fallback)
  const [sampleEntries,    setSampleEntries]    = useState<LibraryEntry[]>([])
  const [selectedSample,   setSelectedSample]   = useState<LibraryEntry | null>(null)
  const [showSamplePicker,  setShowSamplePicker]  = useState(false)
  const [sampleSearch,      setSampleSearch]      = useState('')
  const [openPickerFolders, setOpenPickerFolders] = useState<Set<string>>(new Set())
  const [renderStatus,      setRenderStatus]      = useState<string | null>(null)

  function togglePickerFolder(key: string) {
    setOpenPickerFolders(prev => {
      const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s
    })
  }

  // Push-to-record mode
  const [pushToRecord,    setPushToRecord]    = useState(false)
  const [ptrHolding,      setPtrHolding]      = useState(false)

  const detectorRef        = useRef<LivePitchDetector | null>(null)
  const previewDetectorRef = useRef<LivePitchDetector | null>(null)
  const phaseRef           = useRef<'listening' | 'holding'>('listening')
  const heldRef            = useRef<HeldNote | null>(null)
  const silenceRef         = useRef<number | null>(null)
  const transcribedRef     = useRef<TranscribedNote[]>([])
  const recStartRef        = useRef(0)
  const clipIdRef          = useRef<string | null>(null)
  const trackIdRef         = useRef<string | null>(null)
  const selectedSampleRef  = useRef<LibraryEntry | null>(null)
  const selectedPresetRef  = useRef<MidiPreset | null>(null)
  const sampleEntriesRef   = useRef<LibraryEntry[]>([])
  const processFrameRef    = useRef<(r: LivePitchResult | null) => void>(() => {})
  const lastResultRef      = useRef<{ r: LivePitchResult; ts: number } | null>(null)
  // Controls the confidence threshold in processFrame: 0.72 normal, 0.45 high sensitivity
  const sensitivityRef     = useRef(0.72)
  const canvasRef          = useRef<HTMLCanvasElement>(null)

  useEffect(() => { clipIdRef.current = selectedClipId },       [selectedClipId])
  useEffect(() => { trackIdRef.current = selectedTrackId },     [selectedTrackId])
  useEffect(() => { transcribedRef.current = transcribed },     [transcribed])
  useEffect(() => { selectedSampleRef.current = selectedSample }, [selectedSample])
  useEffect(() => { selectedPresetRef.current = selectedPreset }, [selectedPreset])

  useEffect(() => {
    setPresets(getPresets())
    libraryGetAll().then(entries => {
      setSampleEntries(entries)
      sampleEntriesRef.current = entries
    }).catch(() => {})
  }, [])

  const handleFulfilled = useCallback((fulfilled: LibraryEntry) => {
    setSampleEntries(prev => prev.map(e => e.id === fulfilled.id ? fulfilled : e))
    setSelectedSample(prev => prev?.id === fulfilled.id ? fulfilled : prev)
  }, [])

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
  // NOTE: intentionally has no project.arrangementClips dep — that stale closure
  // caused every note after the first to be silently dropped (the detector callback
  // captured processFrame once; the old processFrame had the old commitNote which
  // looked up the clip in a stale snapshot and found nothing after the first ADD_MIDI_NOTE
  // caused a re-render). Using only stable refs / dispatch fixes this.
  const commitNote = useCallback(async (midi: number, startBeat: number, durationBeats: number) => {
    const preset  = selectedPresetRef.current
    const sample  = selectedSampleRef.current
    const trackId = trackIdRef.current

    if (preset && trackId) {
      // ── Preset path: look up the exact note from the preset's folder ──────
      const noteName   = midiNoteName(clampToPreset(preset, midi))
      const allEntries = sampleEntriesRef.current
      let entry = allEntries.find(e => e.folder === preset.folder && e.name === noteName)

      setRenderStatus(`Rendering ${noteName}…`)
      try {
        if (!entry) {
          // Refresh from IndexedDB in case entries weren't loaded yet
          const fresh = await libraryGetAll()
          sampleEntriesRef.current = fresh
          setSampleEntries(fresh)
          entry = fresh.find(e => e.folder === preset.folder && e.name === noteName)
        }
        if (!entry) {
          console.warn('[PadVoice] no entry for', preset.folder, noteName, 'db size:', sampleEntriesRef.current.length)
          setRenderStatus(`No sample for ${noteName} in "${preset.name}"`)
          setTimeout(() => setRenderStatus(null), 2500)
          return
        }
        let blob = entry.audioBlob
        if (!blob) {
          const fulfilled = await libraryFulfill(entry.id)
          if (!fulfilled?.audioBlob) {
            console.warn('[PadVoice] libraryFulfill returned null for', entry.id, entry.name)
            setRenderStatus(`Could not load ${noteName}`)
            setTimeout(() => setRenderStatus(null), 2500)
            return
          }
          blob = fulfilled.audioBlob
          sampleEntriesRef.current = sampleEntriesRef.current.map(e => e.id === fulfilled.id ? fulfilled : e)
        }
        const audioUrl     = URL.createObjectURL(blob)
        const absStart     = recStartRef.current + startBeat
        const noteDurBeats = Math.max(0.125, durationBeats)
        const clip         = makeAudioClip(trackId, `${preset.name} ${noteName}`, absStart, noteDurBeats, { audioUrl })
        dispatch({ type: 'ADD_CLIP', clip })
        setTranscribed(prev => [...prev, { id: clip.id, midi, startBeat, durationBeats: noteDurBeats }])
        setRenderStatus(null)
      } catch {
        setRenderStatus(`Error placing ${noteName}`)
        setTimeout(() => setRenderStatus(null), 3000)
      }

    } else if (sample && trackId) {
      // ── Single-sample + pitch-shift path ────────────────────────────────
      const rootMidi  = parseSampleRoot(sample.name)
      const semitones = midi - rootMidi

      setRenderStatus(`Rendering ${midiNoteName(midi)}…`)
      try {
        let sampleBlob = sample.audioBlob
        if (!sampleBlob) {
          const fulfilled = await libraryFulfill(sample.id)
          if (!fulfilled?.audioBlob) {
            setRenderStatus(`Sample not loaded — skipping ${midiNoteName(midi)}`)
            setTimeout(() => setRenderStatus(null), 2500)
            return
          }
          sampleBlob = fulfilled.audioBlob
          setSelectedSample(fulfilled)
        }
        const pitched      = await renderPitchedBuffer(sampleBlob, semitones)
        const wavBlob      = bufferToWavBlob(pitched)
        const audioUrl     = URL.createObjectURL(wavBlob)
        const absStart     = recStartRef.current + startBeat
        const noteDurBeats = Math.max(0.125, durationBeats)
        const clip         = makeAudioClip(trackId, `${sample.name} → ${midiNoteName(midi)}`, absStart, noteDurBeats, { audioUrl })
        dispatch({ type: 'ADD_CLIP', clip })
        setTranscribed(prev => [...prev, { id: clip.id, midi, startBeat, durationBeats: noteDurBeats }])
        setRenderStatus(null)
      } catch {
        setRenderStatus(`Error rendering ${midiNoteName(midi)}`)
        setTimeout(() => setRenderStatus(null), 3000)
      }
    } else {
      // ── MIDI path ──
      const clipId = clipIdRef.current
      if (!clipId) return
      const safeDur = Math.max(0.125, durationBeats)
      const safeBeat = Math.max(0, startBeat)
      const note: MidiNote = {
        id:            crypto.randomUUID(),
        pitch:         midi,
        startBeat:     safeBeat,
        durationBeats: safeDur,
        velocity:      100,
        presetId:      selectedPresetRef.current?.id,
      }
      dispatch({ type: 'ADD_MIDI_NOTE', clipId, note })
      // Grow the MIDI clip container to fit the new note
      dispatch({ type: 'UPDATE_CLIP', clipId, patch: { durationBeats: safeBeat + safeDur + 1 } })
      setTranscribed(prev => [...prev, { id: note.id, midi, startBeat: safeBeat, durationBeats: safeDur }])
    }
  }, [dispatch, engine])  // stable — no project dep

  // ── Pitch frame processing ───────────────────────────────────────────────────
  // Always call via processFrameRef so the detector callback (captured once at
  // recording start) always calls the latest version — avoids stale closures.
  const processFrame = useCallback((r: LivePitchResult | null) => {
    const now     = Date.now()
    const elapsed = engine.currentBeat - recStartRef.current

    if (r && r.confidence >= sensitivityRef.current) {
      silenceRef.current = null
      const midi = Math.round(r.midi)

      if (phaseRef.current === 'listening') {
        const h: HeldNote = { midi, startBeat: elapsed, startTime: now, midiSamples: [midi] }
        phaseRef.current  = 'holding'
        heldRef.current   = h
        setHeld(h)
      } else if (phaseRef.current === 'holding' && heldRef.current) {
        // Compare against median of accumulated samples so single-frame noise
        // doesn't prematurely split a note or skew the committed pitch.
        const refMidi = medianOf(heldRef.current.midiSamples)
        if (Math.abs(midi - refMidi) >= PITCH_CHANGE_ST) {
          const prev = heldRef.current
          if (now - prev.startTime >= MIN_NOTE_MS) {
            void commitNote(refMidi, prev.startBeat, Math.max(0.125, elapsed - prev.startBeat))
          }
          const h: HeldNote = { midi, startBeat: elapsed, startTime: now, midiSamples: [midi] }
          heldRef.current  = h
          setHeld(h)
        } else {
          heldRef.current.midiSamples.push(midi)
        }
      }
    } else {
      if (phaseRef.current === 'holding' && heldRef.current) {
        if (silenceRef.current === null) {
          silenceRef.current = now
        } else if (now - silenceRef.current > SILENCE_GAP_MS) {
          const prev = heldRef.current
          if (now - prev.startTime >= MIN_NOTE_MS) {
            void commitNote(medianOf(prev.midiSamples), prev.startBeat, Math.max(0.125, elapsed - prev.startBeat))
          }
          heldRef.current    = null
          phaseRef.current   = 'listening'
          silenceRef.current = null
          setHeld(null)
        }
      }
    }
  }, [engine, commitNote])

  // Keep ref in sync so the captured detector callback always calls the latest version
  useEffect(() => { processFrameRef.current = processFrame }, [processFrame])

  // ── Start / Stop ─────────────────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    // Stop the listening preview so we don't have two detectors briefly overlapping
    previewDetectorRef.current?.stop()
    previewDetectorRef.current = null

    const preset  = selectedPresetRef.current
    const sample  = selectedSampleRef.current
    const trackId = trackIdRef.current

    if (preset || sample) {
      // Audio-clip mode — only need a track
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
        const newClip = makeMidiClip(trackId, 'Voice', engine.currentBeat, 1)
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
      // If the selected track has an input source configured, use it; otherwise default to mic
      const trackInputSrc = project.tracks.find(t => t.id === trackId)?.inputSource as AudioInputSource | undefined
      let stream: MediaStream | undefined
      if (trackInputSrc) {
        stream = await captureAudioInput(trackInputSrc)
      }
      await d.start(r => { lastResultRef.current = r ? { r, ts: Date.now() } : null; setResult(r); processFrameRef.current(r) }, true, stream)
      setIsRecording(true)
      // Immediately seed from the last preview pitch so the note appears on screen right away
      const last = lastResultRef.current
      if (last && Date.now() - last.ts < 500 && last.r.confidence >= sensitivityRef.current) {
        processFrameRef.current(last.r)
      }
    } catch (e) {
      setMicError(e instanceof Error ? e.message : 'Microphone access denied')
      detectorRef.current = null
    }
  }, [engine, playing, project.arrangementClips, project.tracks, dispatch, setSelectedClipId])

  const stopRecording = useCallback(async () => {
    // Flush any currently-held note
    if (phaseRef.current === 'holding' && heldRef.current) {
      const prev    = heldRef.current
      const elapsed = engine.currentBeat - recStartRef.current
      if (Date.now() - prev.startTime >= MIN_NOTE_MS) {
        await commitNote(medianOf(prev.midiSamples), prev.startBeat, Math.max(0.125, elapsed - prev.startBeat))
      }
    }

    const det         = detectorRef.current
    const recStart    = recStartRef.current
    const isSampleMode = !!selectedSampleRef.current
    detectorRef.current = null
    phaseRef.current    = 'listening'
    heldRef.current     = null
    setHeld(null)
    setIsRecording(false)
    setResult(null)

    if (!det) return
    const blob = await det.stopAndGetAudio()

    // Post-processing (sample mode only): re-analyze each committed note's audio segment
    // against the actual recording to correct any live-detection pitch errors before they
    // reach the placed clip. This ensures the sample is pitched to the exact detected note.
    if (blob && isSampleMode) {
      try {
        setRenderStatus('Verifying pitch…')
        const ab       = await blob.arrayBuffer()
        const tempCtx  = new AudioContext()
        const audioBuf = await tempCtx.decodeAudioData(ab).finally(() => tempCtx.close())
        const curve    = await detectPitchCurveAsync(audioBuf, 2048, 256)
        const tempo    = engine.tempo ?? project.tempo ?? 120
        const sample   = selectedSampleRef.current
        if (sample?.audioBlob) {
          const rootMidi = parseSampleRoot(sample.name)
          for (const note of transcribedRef.current) {
            const noteStartSec = note.startBeat * 60 / tempo
            const noteEndSec   = noteStartSec + Math.max(0.1, note.durationBeats * 60 / tempo)
            // Collect voiced frames in this note's time range
            const frames = curve.filter(f =>
              f.time >= noteStartSec && f.time <= noteEndSec && f.freq !== null && f.amplitude > 0.05
            )
            if (frames.length < 3) continue
            const meanHz = frames.reduce((s, f) => s + f.freq!, 0) / frames.length
            const measuredMidi    = 12 * Math.log2(meanHz / 440) + 69
            const correctedShift  = measuredMidi - rootMidi
            const committedShift  = note.midi - rootMidi
            // Only re-render if the measured pitch meaningfully differs from what was committed
            if (Math.abs(correctedShift - committedShift) > 0.35) {
              const pitched  = await renderPitchedBuffer(sample.audioBlob, correctedShift)
              const wavBlob  = bufferToWavBlob(pitched)
              const audioUrl = URL.createObjectURL(wavBlob)
              dispatch({ type: 'UPDATE_CLIP', clipId: note.id, patch: { audioUrl } })
            }
          }
        }
      } catch { /* non-fatal */ }
      finally { setRenderStatus(null) }
    }
  }, [engine, commitNote, project.tempo])

  useEffect(() => () => { detectorRef.current?.stop(); previewDetectorRef.current?.stop() }, [])

  // Run a preview (listening) detector whenever NOT actively recording so the tuner is live
  // and the first frame can be seeded immediately when recording starts
  useEffect(() => {
    if (isRecording) { previewDetectorRef.current?.stop(); previewDetectorRef.current = null; return }
    let cancelled = false
    const d = new LivePitchDetector()
    previewDetectorRef.current = d
    const trackInputSrc = project.tracks.find(t => t.id === trackIdRef.current)?.inputSource as AudioInputSource | undefined
    captureAudioInput(trackInputSrc ?? 'mic')
      .then(stream => {
        if (!cancelled) d.start(r => {
          lastResultRef.current = r ? { r, ts: Date.now() } : null
          setResult(r)
        }, false, stream)
      })
      .catch(() => {})
    return () => { cancelled = true; d.stop(); if (previewDetectorRef.current === d) previewDetectorRef.current = null }
  }, [isRecording, project.tracks])

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

  // ── Grouped + sorted picker data ────────────────────────────────────────────
  const pickerGroups = useMemo(() => {
    const q = sampleSearch.trim().toLowerCase()
    const filtered = sampleEntries.filter(e =>
      !q ||
      e.name.toLowerCase().includes(q) ||
      (e.folder ?? '').toLowerCase().includes(q) ||
      (e.parentFolder ?? '').toLowerCase().includes(q)
    )

    // Sort within a group: note names descending, non-note names alphabetically
    function sortDescNote(arr: LibraryEntry[]): LibraryEntry[] {
      const withMidi = arr.map(e => ({ e, m: parseSampleRoot(e.name) }))
      // Only apply note sort if name actually parses (regex test)
      const isNote = (name: string) => /^[A-G]#?-?\d+$/.test(name)
      if (arr.every(e => isNote(e.name))) {
        return withMidi.sort((a, b) => b.m - a.m).map(x => x.e)
      }
      return [...arr].sort((a, b) => a.name.localeCompare(b.name))
    }

    // parentFolder → folder → entries[]
    const byParent = new Map<string, Map<string, LibraryEntry[]>>()
    const byFolder = new Map<string, LibraryEntry[]>()
    const unfiled:  LibraryEntry[] = []

    for (const e of filtered) {
      if (e.parentFolder) {
        const sub = e.folder ?? '(ungrouped)'
        const m   = byParent.get(e.parentFolder) ?? new Map<string, LibraryEntry[]>()
        m.set(sub, [...(m.get(sub) ?? []), e])
        byParent.set(e.parentFolder, m)
      } else if (e.folder) {
        byFolder.set(e.folder, [...(byFolder.get(e.folder) ?? []), e])
      } else {
        unfiled.push(e)
      }
    }

    // Sort each leaf array
    byParent.forEach(subMap => subMap.forEach((arr, k) => subMap.set(k, sortDescNote(arr))))
    byFolder.forEach((arr, k) => byFolder.set(k, sortDescNote(arr)))

    return { byParent, byFolder, unfiled: sortDescNote(unfiled), total: filtered.length }
  }, [sampleEntries, sampleSearch])

  const arcStart = 270 - ASWEEP
  const arcEnd   = 270 + ASWEEP
  const hiEnd    = needleDeg

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0e0e0e', overflowY: 'auto', position: 'relative' }}>

      {/* ── Preset picker strip ── */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid #1e1e1e', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 10, color: '#555', flexShrink: 0 }}>Preset:</span>
        <button
          onClick={() => { setShowPresetPicker(v => !v); setShowSamplePicker(false) }}
          style={{
            flex: 1, textAlign: 'left', fontSize: 11, padding: '4px 8px', borderRadius: 4,
            background: selectedPreset ? 'rgba(61,143,239,0.08)' : '#1a1a1a',
            border: `1px solid ${selectedPreset ? 'rgba(61,143,239,0.3)' : '#2a2a2a'}`,
            color: selectedPreset ? '#3d8fef' : '#555', cursor: 'pointer',
          }}>
          {selectedPreset ? presetDisplayName(selectedPreset) : 'None'}
          <span style={{ float: 'right', opacity: 0.5 }}>▾</span>
        </button>
        {selectedPreset && (
          <button onClick={() => setSelectedPreset(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#555', fontSize: 14, padding: '0 2px' }}>×</button>
        )}
      </div>

      {/* ── Preset picker dropdown ── */}
      {showPresetPicker && (
        <div style={{
          position: 'absolute', top: 42, left: 12, right: 12, zIndex: 51,
          background: '#141414', border: '1px solid #2a2a2a', borderRadius: 6,
          boxShadow: '0 8px 24px rgba(0,0,0,0.6)', overflow: 'hidden',
        }}>
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {presets.map(p => (
              <button key={p.id}
                onClick={() => { setSelectedPreset(p); setSelectedSample(null); setShowPresetPicker(false) }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '6px 12px',
                  background: selectedPreset?.id === p.id ? 'rgba(61,143,239,0.10)' : 'transparent',
                  borderBottom: '1px solid #1a1a1a', border: 'none', cursor: 'pointer',
                }}>
                <span style={{ fontSize: 11, color: selectedPreset?.id === p.id ? '#3d8fef' : '#bbb', fontWeight: 600 }}>{p.name}</span>
                <span style={{ fontSize: 10, color: '#555', marginLeft: 8 }}>{`${NOTE_PC_NAMES[p.loNote % 12]}${Math.floor(p.loNote / 12) - 1}→${NOTE_PC_NAMES[p.hiNote % 12]}${Math.floor(p.hiNote / 12) - 1}`}</span>
              </button>
            ))}
          </div>
          <div style={{ padding: '5px 8px', borderTop: '1px solid #1e1e1e', display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={() => setShowPresetPicker(false)} style={{ fontSize: 10, color: '#555', background: 'none', border: 'none', cursor: 'pointer' }}>Close</button>
          </div>
        </div>
      )}

      {/* ── Sample picker strip (single sample + pitch-shift, fallback mode) ── */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid #1e1e1e', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 10, color: '#555', flexShrink: 0 }}>Sample:</span>
        <button
          onClick={() => { setShowSamplePicker(v => !v); setShowPresetPicker(false) }}
          style={{
            flex: 1, textAlign: 'left', fontSize: 11, padding: '4px 8px', borderRadius: 4,
            background: selectedSample && !selectedPreset ? 'rgba(61,143,239,0.08)' : '#1a1a1a',
            border: `1px solid ${selectedSample && !selectedPreset ? 'rgba(61,143,239,0.3)' : '#2a2a2a'}`,
            color: selectedSample && !selectedPreset ? '#3d8fef' : '#555', cursor: 'pointer',
            opacity: selectedPreset ? 0.4 : 1,
          }}>
          {selectedSample ? `${selectedSample.name}${selectedSample.folder ? ` · ${selectedSample.folder}` : ''}` : selectedPreset ? 'Overridden by preset' : 'None — writes MIDI notes'}
          <span style={{ float: 'right', opacity: 0.5 }}>▾</span>
        </button>
        {selectedSample && !selectedPreset && (
          <button onClick={() => setSelectedSample(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#555', fontSize: 14, padding: '0 2px' }}>×</button>
        )}
      </div>

      {/* ── Sample picker dropdown ── */}
      {showSamplePicker && !selectedPreset && (
        <div style={{
          position: 'absolute', top: 84, left: 12, right: 12, zIndex: 50,
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
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            {pickerGroups.total === 0 && (
              <div style={{ padding: '12px 10px', fontSize: 11, color: '#444', textAlign: 'center' }}>No samples found</div>
            )}

            {/* parentFolder → sub-folders → entries */}
            {[...pickerGroups.byParent.entries()].map(([parent, subMap]) => {
              const parentOpen = openPickerFolders.has(parent) || !!sampleSearch.trim()
              return (
                <div key={parent}>
                  <button onClick={() => togglePickerFolder(parent)} style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%', padding: '5px 10px 4px', fontSize: 9, fontWeight: 700, color: 'rgba(139,92,246,0.7)', letterSpacing: '0.06em', background: 'rgba(139,92,246,0.06)', borderBottom: '1px solid #1a1a1a', textTransform: 'uppercase', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                    {parentOpen ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
                    {parent}
                    <span style={{ marginLeft: 'auto', fontWeight: 400, opacity: 0.5, textTransform: 'none', letterSpacing: 0 }}>{[...subMap.values()].reduce((s, a) => s + a.length, 0)}</span>
                  </button>
                  {parentOpen && [...subMap.entries()].map(([sub, entries]) => {
                    const subKey = `${parent}/${sub}`
                    const subOpen = openPickerFolders.has(subKey) || !!sampleSearch.trim()
                    return (
                      <div key={sub}>
                        <button onClick={() => togglePickerFolder(subKey)} style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%', padding: '3px 14px 3px 20px', fontSize: 9, color: '#666', background: '#111', borderBottom: '1px solid #1a1a1a', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                          {subOpen ? <ChevronDown size={8} /> : <ChevronRight size={8} />}
                          {sub}
                          <span style={{ marginLeft: 'auto', opacity: 0.4 }}>{entries.length}</span>
                        </button>
                        {subOpen && entries.map(e => <SampleRow key={e.id} entry={e} selected={selectedSample?.id === e.id} onFulfilled={handleFulfilled} onSelect={f => { setSelectedSample(f); setShowSamplePicker(false); setSampleSearch('') }} />)}
                      </div>
                    )
                  })}
                </div>
              )
            })}

            {/* user folders */}
            {[...pickerGroups.byFolder.entries()].map(([folder, entries]) => {
              const isOpen = openPickerFolders.has(folder) || !!sampleSearch.trim()
              return (
                <div key={folder}>
                  <button onClick={() => togglePickerFolder(folder)} style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%', padding: '5px 10px 4px', fontSize: 9, fontWeight: 700, color: '#666', letterSpacing: '0.05em', background: '#111', borderBottom: '1px solid #1a1a1a', border: 'none', cursor: 'pointer', textAlign: 'left', textTransform: 'uppercase' }}>
                    {isOpen ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
                    {folder}
                    <span style={{ marginLeft: 'auto', fontWeight: 400, opacity: 0.4, textTransform: 'none', letterSpacing: 0 }}>{entries.length}</span>
                  </button>
                  {isOpen && entries.map(e => <SampleRow key={e.id} entry={e} selected={selectedSample?.id === e.id} onFulfilled={handleFulfilled} onSelect={f => { setSelectedSample(f); setShowSamplePicker(false); setSampleSearch('') }} />)}
                </div>
              )
            })}

            {/* unfiled */}
            {pickerGroups.unfiled.length > 0 && (
              <div>
                {(pickerGroups.byParent.size > 0 || pickerGroups.byFolder.size > 0) && (
                  <div style={{ padding: '3px 10px 2px', fontSize: 9, color: '#444', background: '#111', borderBottom: '1px solid #1a1a1a' }}>Unfiled</div>
                )}
                {pickerGroups.unfiled.map(e => <SampleRow key={e.id} entry={e} selected={selectedSample?.id === e.id} onFulfilled={handleFulfilled} onSelect={f => { setSelectedSample(f); setShowSamplePicker(false); setSampleSearch('') }} />)}
              </div>
            )}
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
            {conf >= 0.4 && Math.abs(hiEnd - 270) > 0.5 && (
              <path
                d={hiEnd >= 270
                  ? arcPath(ACX, ACY, AR, 270, hiEnd)
                  : arcPath(ACX, ACY, AR, hiEnd, 270)}
                fill="none" stroke={color} strokeWidth={8} strokeLinecap="round" opacity={0.6} />
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
      <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        {!pushToRecord ? (
          /* Normal record button */
          !isRecording ? (
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
          )
        ) : (
          /* Push-to-record hold button */
          <button
            disabled={!hasTarget}
            onPointerDown={e => {
              e.currentTarget.setPointerCapture(e.pointerId)
              sensitivityRef.current = 0.45
              setPtrHolding(true)
              void startRecording()
            }}
            onPointerUp={async () => {
              sensitivityRef.current = 0.72
              setPtrHolding(false)
              await stopRecording()
              engine.stop()
            }}
            onPointerLeave={async () => {
              if (!ptrHolding) return
              sensitivityRef.current = 0.72
              setPtrHolding(false)
              await stopRecording()
              engine.stop()
            }}
            title={hasTarget ? 'Hold to record — release to pause' : 'Select a track first'}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '7px 16px',
              borderRadius: 6, border: 'none', cursor: hasTarget ? 'pointer' : 'not-allowed',
              background: ptrHolding ? '#7f1d1d' : hasTarget ? '#991b1b' : '#2a1a1a',
              color: ptrHolding ? '#fca5a5' : hasTarget ? '#fecaca' : '#555',
              fontSize: 12, fontWeight: 700, flexShrink: 0,
              outline: ptrHolding ? '2px solid #ef4444' : 'none',
              userSelect: 'none', touchAction: 'none',
            }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} />
            {ptrHolding ? 'Recording…' : 'Hold to Record'}
          </button>
        )}

        {/* Push-to-record toggle */}
        <button
          onClick={() => {
            if (isRecording) void stopRecording()
            setPushToRecord(v => !v)
            setPtrHolding(false)
          }}
          title={pushToRecord ? 'Disable push-to-record' : 'Enable push-to-record — hold the button to record with high sensitivity'}
          style={{
            padding: '5px 8px', borderRadius: 5, fontSize: 10, fontWeight: 700,
            border: `1px solid ${pushToRecord ? '#ef4444' : '#2a2a2a'}`,
            background: pushToRecord ? 'rgba(239,68,68,0.10)' : 'transparent',
            color: pushToRecord ? '#ef4444' : '#444',
            cursor: 'pointer', flexShrink: 0, letterSpacing: '0.04em',
          }}>
          PTR
        </button>

        {isRecording && !ptrHolding && (
          <span style={{ fontSize: 10, color: '#ef4444', fontWeight: 700, letterSpacing: '0.06em' }}>● REC</span>
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
