'use client'

/**
 * VoiceMidi — sing/hum a tune and hear it back as a chosen instrument.
 *
 * Everything audio here is pure Web Audio (no DAW engine, no IndexedDB):
 *   • Mic → pitch:  lib/pitch-detector.ts  LivePitchDetector  (YIN, real-time)
 *   • Instrument:   lib/instrument-synth.ts playMelodicNote / MELODIC_TYPES
 *   • Instruments:  lib/midi-presets.ts     getPresets / getGroupedPresets
 *   • Metronome:    look-ahead scheduler lifted from components/tools/Metronome
 *                   (click recipe from lib/daw-engine _buildMetronomeBuffers)
 *
 * One shared AudioContext, created/resumed inside a user-gesture handler.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LivePitchDetector, type LivePitchResult, type LiveLevel, type LiveSensitivity } from '@/lib/pitch-detector'
import { notesFromBuffer, alignToGrid } from '@/lib/voice-backfill'
import { playMelodicNote, MELODIC_TYPES } from '@/lib/instrument-synth'
import {
  getPresets, getGroupedPresets, midiNoteLabel, clampToPreset,
  type MidiPreset,
} from '@/lib/midi-presets'
import type { BeatType } from '@/lib/beat-analyzer'

// ── A recorded note ───────────────────────────────────────────────────────────
interface RecNote { startSec: number; midi: number; durSec: number; velocity: number }

// Which version of the take is shown/played.
//   'live'       real-time capture
//   'refined'    offline pitch pass, grid-corrected (the accurate default)
//   'rawRefined' offline pitch pass, un-aligned onsets
type TakeSource = 'live' | 'refined' | 'rawRefined'

const MIN_BPM = 20
const MAX_BPM = 400
const MIN_NOTE_DUR = 0.06           // shorter blips are dropped as detector noise
const LOOKAHEAD_S = 0.15
const TICK_MS = 25
const BEATS_PER_BAR = 4

const clampBpm = (v: number) => Math.max(MIN_BPM, Math.min(MAX_BPM, Math.round(v)))
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

// ── Sensitivity → detector params ─────────────────────────────────────────────
// A single 0→1 "sensitivity" knob maps to more gain + lower gates as it rises,
// so a quiet singer gets boosted and the silence/confidence floors drop.
const SENS_KEY = 'voicemidi-sensitivity'
const DEFAULT_SENS = 0.5
function paramsForSensitivity(s: number): Required<LiveSensitivity> {
  const t = clamp(s, 0, 1)
  return {
    gain:           1     + t * 7,        // 1  → 8
    rmsGate:        0.006 - t * 0.0052,   // 0.006  → 0.0008
    peakGate:       0.016 - t * 0.014,    // 0.016  → 0.002
    confidenceGate: 0.55  - t * 0.23,     // 0.55   → 0.32
  }
}
// The widget's own re-trigger gate tracks the detector's confidence gate (which
// already filtered the frame) with a small margin, so we don't double-filter.
const widgetTrigGate = (confGate: number) => confGate + 0.05

const DIVISIONS: Array<{ n: number; label: string }> = [
  { n: 1, label: '1/4' },
  { n: 2, label: '1/8' },
  { n: 4, label: '1/16' },
]

// ── Quantize helper ───────────────────────────────────────────────────────────
// Snap each note's start (and duration) to the nearest grid step = 60/bpm/division.
// Pure + non-destructive: returns a new array, leaving the raw take untouched so
// quantize can be re-applied at a different division or reset.
export function quantizeNotes(notes: RecNote[], bpm: number, division: number): RecNote[] {
  const step = 60 / bpm / division
  if (!Number.isFinite(step) || step <= 0) return notes
  return notes.map(n => ({
    ...n,
    startSec: Math.round(n.startSec / step) * step,
    durSec: Math.max(step, Math.round(n.durSec / step) * step),
  }))
}

// ── Backfill: decode a recorded blob → refined notes ──────────────────────────
// Browser-only glue (decode + stereo downmix); the actual pitch→note analysis is
// the pure, testable notesFromBuffer() in lib/voice-backfill.ts.
async function backfillFromBlob(blob: Blob, params: Required<LiveSensitivity>): Promise<RecNote[]> {
  const arr = await blob.arrayBuffer()
  const ac = new AudioContext()
  try {
    const audio = await ac.decodeAudioData(arr)
    // Downmix to mono (average channels).
    const ch = audio.numberOfChannels
    let mono: Float32Array
    if (ch === 1) {
      mono = audio.getChannelData(0).slice()
    } else {
      const n = audio.length
      mono = new Float32Array(n)
      for (let c = 0; c < ch; c++) {
        const data = audio.getChannelData(c)
        for (let i = 0; i < n; i++) mono[i] += data[i] / ch
      }
    }
    // Mirror the live signal chain: the MediaRecorder captured the RAW pre-gain
    // mic stream, so re-apply the user's sensitivity gain + RMS gate offline.
    return notesFromBuffer(mono, audio.sampleRate, {
      gain: params.gain,
      rmsGate: params.rmsGate,
      minDuration: 0.08,
    })
  } finally {
    void ac.close()
  }
}

export default function VoiceMidi() {
  const [presets, setPresets] = useState<MidiPreset[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [bpm, setBpm] = useState(100)
  const [metroOn, setMetroOn] = useState(false)
  const [recording, setRecording] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [micError, setMicError] = useState<string | null>(null)
  const [live, setLive] = useState<{ midi: number; name: string; cents: number } | null>(null)
  const [rawNotes, setRawNotes] = useState<RecNote[]>([])
  const [quantized, setQuantized] = useState(false)
  const [division, setDivision] = useState(2)
  const [playhead, setPlayhead] = useState<number | null>(null)

  // ── Backfill (offline accuracy pass) ─────────────────────────────────────────
  // After a take, the RECORDED audio is re-analyzed offline for a cleaner
  // transcription. We keep the live take around so the user can toggle back.
  // Three takes are kept side by side:
  //   liveTake       — the real-time capture
  //   refinedRawTake — offline pitch pass (accurate pitch, un-aligned onsets)
  //   refinedTake    — the offline pass CONFIRMED/CORRECTED to the beat grid (default)
  const [refining, setRefining] = useState(false)
  const [refineMsg, setRefineMsg] = useState<string | null>(null)
  const [liveTake, setLiveTake] = useState<RecNote[] | null>(null)
  const [refinedRawTake, setRefinedRawTake] = useState<RecNote[] | null>(null)
  const [refinedTake, setRefinedTake] = useState<RecNote[] | null>(null)
  const [takeSource, setTakeSource] = useState<TakeSource>('live')

  // ── Test / calibrate ─────────────────────────────────────────────────────────
  const [sensitivity, setSensitivity] = useState(DEFAULT_SENS)
  const [testing, setTesting] = useState(false)
  const [level, setLevel] = useState<LiveLevel | null>(null)
  const [testLive, setTestLive] = useState<LivePitchResult | null>(null)
  const [calibrating, setCalibrating] = useState(false)
  const [calibMsg, setCalibMsg] = useState<string | null>(null)
  const [params, setParams] = useState<Required<LiveSensitivity>>(() => paramsForSensitivity(DEFAULT_SENS))

  // ── Audio plumbing (refs so the rAF/scheduler read live values) ──────────────
  const ctxRef = useRef<AudioContext | null>(null)
  const metroBufs = useRef<{ down: AudioBuffer; up: AudioBuffer } | null>(null)
  const metroTimer = useRef<number | null>(null)
  const metroNext = useRef(0)
  const metroBeat = useRef(0)
  const detectorRef = useRef<LivePitchDetector | null>(null)
  const testDetectorRef = useRef<LivePitchDetector | null>(null)

  // Current effective detector params — mirrored in a ref so the mic/level
  // callbacks read live values without re-subscribing.
  const paramsRef = useRef<Required<LiveSensitivity>>(paramsForSensitivity(DEFAULT_SENS))
  const calibratingRef = useRef(false)
  const calibMaxRef = useRef(0)

  const recStart = useRef(0)
  // Grid anchor captured at record start, so the offline pass can align onsets to
  // the beat grid the singer actually heard.
  const recBpmRef = useRef(bpm)
  const recPhaseRef = useRef(0)
  const rawEvents = useRef<RecNote[]>([])
  const curEvent = useRef<{ startSec: number; midi: number; velocity: number } | null>(null)
  const liveMidi = useRef<number | null>(null)

  // Live values the mic callback reads without re-subscribing.
  const selRef = useRef<MidiPreset | null>(null)

  // ── Load presets (client-only: getPresets reads localStorage) ────────────────
  useEffect(() => {
    const melodic = getPresets().filter(p => MELODIC_TYPES.has(p.category as BeatType))
    setPresets(melodic)
    // Default to Piano if present, else the first melodic preset.
    const def = melodic.find(p => p.builtIn && p.name === 'Piano') ?? melodic[0]
    if (def) setSelectedId(def.id)
  }, [])

  // Debug/test hook (same convention as __dawDispatch etc.): lets a headless
  // page exercise the pure offline backfill analysis without a live microphone.
  useEffect(() => {
    const w = window as unknown as { __voiceBackfill?: typeof notesFromBuffer; __voiceAlignToGrid?: typeof alignToGrid }
    w.__voiceBackfill = notesFromBuffer
    w.__voiceAlignToGrid = alignToGrid
    return () => { delete w.__voiceBackfill; delete w.__voiceAlignToGrid }
  }, [])

  const selected = useMemo(() => presets.find(p => p.id === selectedId) ?? null, [presets, selectedId])
  useEffect(() => { selRef.current = selected }, [selected])

  const grouped = useMemo(() => getGroupedPresets(presets), [presets])

  // The notes shown/played: raw take, optionally quantized to the current grid.
  const displayNotes = useMemo(
    () => (quantized ? quantizeNotes(rawNotes, bpm, division) : rawNotes),
    [rawNotes, quantized, bpm, division],
  )

  // ── Shared AudioContext ──────────────────────────────────────────────────────
  const ensureCtx = useCallback((): AudioContext => {
    if (!ctxRef.current) {
      const c = new AudioContext()
      ctxRef.current = c
      // Metronome click buffers — recipe from lib/daw-engine _buildMetronomeBuffers:
      // 40ms, sin(2π·1800·t)·exp(-t/0.015) downbeat; 900Hz at half gain otherwise.
      const sr = c.sampleRate
      const len = Math.floor(sr * 0.04)
      const build = (freq: number, gain: number) => {
        const b = c.createBuffer(1, len, sr)
        const d = b.getChannelData(0)
        for (let i = 0; i < len; i++) {
          const t = i / sr
          d[i] = Math.sin(2 * Math.PI * freq * t) * Math.exp(-t / 0.015) * gain
        }
        return b
      }
      metroBufs.current = { down: build(1800, 1), up: build(900, 0.5) }
    }
    return ctxRef.current
  }, [])

  // ── Metronome look-ahead scheduler ───────────────────────────────────────────
  const bpmRef = useRef(bpm)
  useEffect(() => { bpmRef.current = bpm }, [bpm])

  // Current quantize division mirrored in a ref so the refine flow (deps []) reads
  // the live value — the grid alignment uses the SAME division as manual quantize.
  const divisionRef = useRef(division)
  useEffect(() => { divisionRef.current = division }, [division])

  const schedule = useCallback(() => {
    const c = ctxRef.current, b = metroBufs.current
    if (!c || !b) return
    while (metroNext.current < c.currentTime + LOOKAHEAD_S) {
      const isDown = metroBeat.current % BEATS_PER_BAR === 0
      const src = c.createBufferSource()
      src.buffer = isDown ? b.down : b.up
      src.connect(c.destination)
      src.start(metroNext.current)
      src.onended = () => src.disconnect()
      metroNext.current += 60 / bpmRef.current
      metroBeat.current++
    }
  }, [])

  const startMetro = useCallback(() => {
    const c = ensureCtx()
    void c.resume()
    metroBeat.current = 0
    metroNext.current = c.currentTime + 0.08
    metroTimer.current = window.setInterval(schedule, TICK_MS)
  }, [ensureCtx, schedule])

  const stopMetro = useCallback(() => {
    if (metroTimer.current) { clearInterval(metroTimer.current); metroTimer.current = null }
  }, [])

  function toggleMetro() {
    if (metroOn) { stopMetro(); setMetroOn(false) }
    else { startMetro(); setMetroOn(true) }
  }

  // Seconds from record-start (`atTime`, an AudioContext time) to the next
  // downbeat the singer will hear — the phase used to anchor the offline grid.
  //
  // The look-ahead scheduler keeps `metroNext` = the AudioContext time of the
  // next beat it will schedule and `metroBeat` = that beat's index (downbeat when
  // index % BEATS_PER_BAR === 0). We walk forward from there to the next downbeat.
  // Because beats are whole multiples of the grid step apart, this phase is exact
  // mod-step regardless of which beat we anchor on.
  //
  // Metronome OFF (no timer running) → phase 0: treat record-start as beat 0.
  // Anything non-finite falls back to 0 so a take is never made worse.
  const captureGridPhase = useCallback((atTime: number): number => {
    if (metroTimer.current === null) return 0            // metronome off
    const secPerBeat = 60 / bpmRef.current
    let t = metroNext.current
    let bi = metroBeat.current
    if (!Number.isFinite(t) || !Number.isFinite(secPerBeat) || secPerBeat <= 0) return 0
    // Advance to the next downbeat (bounded — at most one bar of beats).
    for (let guard = 0; bi % BEATS_PER_BAR !== 0 && guard <= BEATS_PER_BAR; guard++) {
      bi++; t += secPerBeat
    }
    const phase = t - atTime
    return Number.isFinite(phase) && phase >= 0 ? phase : 0
  }, [])

  // ── Mic → real-time instrument + note capture ────────────────────────────────
  const onPitch = useCallback((r: LivePitchResult | null) => {
    const c = ctxRef.current
    const preset = selRef.current
    if (!c || !preset) return
    const now = c.currentTime - recStart.current

    const voiced = r !== null && r.confidence >= widgetTrigGate(paramsRef.current.confidenceGate)
    if (voiced && r.midi !== liveMidi.current) {
      // Close the note that was sounding.
      const cur = curEvent.current
      if (cur) {
        const dur = now - cur.startSec
        if (dur >= MIN_NOTE_DUR) rawEvents.current.push({ ...cur, durSec: dur })
      }
      // Open the new note + play it through the instrument in real time.
      const velocity = Math.max(0.3, Math.min(1, 0.45 + r.rms))
      curEvent.current = { startSec: now, midi: r.midi, velocity }
      liveMidi.current = r.midi
      const note = clampToPreset(preset, r.midi)
      playMelodicNote(c, preset.category as BeatType, note, c.currentTime, velocity)
      setLive({ midi: r.midi, name: r.noteName, cents: r.cents })
    } else if (!voiced && liveMidi.current !== null) {
      // Silence — close the current note.
      const cur = curEvent.current
      if (cur) {
        const dur = now - cur.startSec
        if (dur >= MIN_NOTE_DUR) rawEvents.current.push({ ...cur, durSec: dur })
      }
      curEvent.current = null
      liveMidi.current = null
      setLive(null)
    }
  }, [])

  // ── Sensitivity: load persisted value, and apply to any live detector ────────
  useEffect(() => {
    try {
      const saved = parseFloat(localStorage.getItem(SENS_KEY) ?? '')
      if (Number.isFinite(saved)) {
        const s = clamp(saved, 0, 1)
        const p = paramsForSensitivity(s)
        setSensitivity(s); setParams(p); paramsRef.current = p
      }
    } catch { /* localStorage unavailable */ }
  }, [])

  // Apply a params set to state + ref + any running detector (no mic restart).
  const applyParams = useCallback((p: Required<LiveSensitivity>) => {
    paramsRef.current = p
    setParams(p)
    testDetectorRef.current?.setSensitivity(p)
    detectorRef.current?.setSensitivity(p)
  }, [])

  const onSensitivityChange = useCallback((s: number) => {
    const clamped = clamp(s, 0, 1)
    setSensitivity(clamped)
    setCalibMsg(null)                 // moving the slider supersedes a calibration
    applyParams(paramsForSensitivity(clamped))
    try { localStorage.setItem(SENS_KEY, String(clamped)) } catch { /* ignore */ }
  }, [applyParams])

  // ── Test / calibrate: monitor-only detector (no recording) ───────────────────
  const onTestLevel = useCallback((lvl: LiveLevel) => {
    setLevel(lvl)
    if (calibratingRef.current && lvl.rms > calibMaxRef.current) calibMaxRef.current = lvl.rms
  }, [])
  const onTestPitch = useCallback((r: LivePitchResult | null) => setTestLive(r), [])

  const startTest = useCallback(async () => {
    setMicError(null)
    try {
      const d = new LivePitchDetector()
      testDetectorRef.current = d
      await d.start(onTestPitch, false, undefined, { ...paramsRef.current, onLevel: onTestLevel })
      setTesting(true)
    } catch (e) {
      setMicError(
        e instanceof Error && e.name === 'NotAllowedError'
          ? 'Microphone access was denied. Allow mic access to test your input.'
          : e instanceof Error ? e.message : String(e),
      )
      setTesting(false)
    }
  }, [onTestPitch, onTestLevel])

  const stopTest = useCallback(() => {
    testDetectorRef.current?.stop()
    testDetectorRef.current = null
    calibratingRef.current = false
    setTesting(false); setLevel(null); setTestLive(null); setCalibrating(false)
  }, [])

  function toggleTest() {
    if (testing) stopTest()
    else void startTest()
  }

  // Sample the ambient noise floor for ~1.2s, then set gates just above it.
  const autoCalibrate = useCallback(async () => {
    let started = false
    if (!testDetectorRef.current) { await startTest(); started = true }
    if (!testDetectorRef.current) return          // mic denied / failed
    setCalibMsg('Stay quiet…')
    calibMaxRef.current = 0
    calibratingRef.current = true
    setCalibrating(true)
    await new Promise(r => setTimeout(r, 1200))
    calibratingRef.current = false
    setCalibrating(false)

    const floor = calibMaxRef.current
    const floorDb = Math.round(20 * Math.log10(floor || 1e-8))
    const newRms  = clamp(floor * 2.5, 0.0006, 0.02)
    const newPeak = clamp(floor * 2.5 * 2.2, 0.0015, 0.05)
    // If the room is genuinely quiet, boost gain so a soft voice still registers.
    const gain = floor < 0.0015 ? Math.max(paramsRef.current.gain, 4) : paramsRef.current.gain
    applyParams({ ...paramsRef.current, rmsGate: newRms, peakGate: newPeak, gain })

    if (floor > 0.02) {
      setCalibMsg(`Noisy room (floor ${floorDb} dB) — a headset/closer mic will help.`)
    } else {
      setCalibMsg(`Calibrated — noise floor ${floorDb} dB`)
    }
    if (started) { /* leave test running so the user sees the result */ }
  }, [startTest, applyParams])

  const startRecording = useCallback(async () => {
    setMicError(null)
    // Test mode and record are separate flows — don't run both mics at once.
    if (testDetectorRef.current) stopTest()
    const c = ensureCtx()
    await c.resume()
    rawEvents.current = []
    curEvent.current = null
    liveMidi.current = null
    recStart.current = c.currentTime
    // ── Anchor the grid to this take ──────────────────────────────────────────
    // Freeze the tempo, and capture the beat phase so the offline pass can snap
    // onsets to the grid the singer heard.
    recBpmRef.current = bpmRef.current
    recPhaseRef.current = captureGridPhase(c.currentTime)
    setRawNotes([])
    setQuantized(false)
    setLive(null)
    setRefineMsg(null)
    setRefinedTake(null)
    setRefinedRawTake(null)
    setLiveTake(null)
    setTakeSource('live')
    try {
      const d = new LivePitchDetector()
      detectorRef.current = d
      // captureAudio = true → the raw mic stream is recorded for the offline
      // backfill pass on stop. (The Test-mic monitor detector does NOT capture.)
      await d.start(onPitch, true, undefined, { ...paramsRef.current, onLevel: onTestLevel })
      setRecording(true)
    } catch (e) {
      setMicError(
        e instanceof Error && e.name === 'NotAllowedError'
          ? 'Microphone access was denied. Allow mic access in your browser to sing a tune.'
          : e instanceof Error ? e.message : String(e),
      )
      setRecording(false)
    }
  }, [ensureCtx, onPitch, stopTest, onTestLevel])

  const stopRecording = useCallback(async () => {
    const det = detectorRef.current
    detectorRef.current = null
    setLevel(null)
    setRecording(false)
    // Flush the note still sounding at stop.
    const c = ctxRef.current
    const cur = curEvent.current
    if (c && cur) {
      const dur = (c.currentTime - recStart.current) - cur.startSec
      if (dur >= MIN_NOTE_DUR) rawEvents.current.push({ ...cur, durSec: dur })
    }
    curEvent.current = null
    liveMidi.current = null
    setLive(null)

    // The live take is the immediate base; backfill may replace it below.
    const liveNotes = rawEvents.current.slice()
    setRawNotes(liveNotes)
    setLiveTake(liveNotes)
    setTakeSource('live')

    if (!det) return

    // ── Offline backfill: re-analyze the recorded audio for a cleaner take ──────
    setRefining(true)
    setRefineMsg(null)
    try {
      const blob = await det.stopAndGetAudio()
      if (!blob) {
        // Capture unavailable on this browser — keep the live take, no error.
        setRefineMsg('Live take — refine not supported in this browser')
        return
      }
      const refinedRaw = await backfillFromBlob(blob, paramsRef.current)
      if (refinedRaw.length > 0) {
        // Confirm/correct the offline onsets against the metronome's beat grid —
        // the whole point of backfill: the take was sung to a click at a known
        // BPM, so real-time detection doesn't have to be perfect. Fall back to the
        // un-aligned notes on any grid failure; never throw, never make it worse.
        let gridCorrected = refinedRaw
        try {
          const aligned = alignToGrid(refinedRaw, {
            bpm:      recBpmRef.current,
            phaseSec: recPhaseRef.current,
            division: divisionRef.current,
          })
          if (aligned.length > 0) gridCorrected = aligned
        } catch { /* keep un-aligned refinedRaw */ }

        setRefinedRawTake(refinedRaw)
        setRefinedTake(gridCorrected)
        setRawNotes(gridCorrected)          // grid-corrected is the default "Refined"
        setTakeSource('refined')
        setRefineMsg(`Refined — ${gridCorrected.length} note${gridCorrected.length === 1 ? '' : 's'}, grid-aligned`)
      } else {
        // Backfill found nothing — never make the take worse silently.
        setRefineMsg(
          liveNotes.length > 0
            ? 'Kept live take — refine found no clear notes'
            : 'No pitched notes found',
        )
      }
    } catch {
      setRefineMsg('Kept live take — refine failed')
    } finally {
      setRefining(false)
    }
  }, [])

  function toggleRecord() {
    if (recording) void stopRecording()
    else void startRecording()
  }

  // Switch the displayed/played take between the raw live capture and the
  // refined (backfilled) one. Both drive the note strip, playback, and quantize.
  const selectTake = useCallback((src: TakeSource) => {
    const notes = src === 'refined' ? refinedTake : src === 'rawRefined' ? refinedRawTake : liveTake
    if (!notes) return
    setTakeSource(src)
    setRawNotes(notes)
  }, [refinedTake, refinedRawTake, liveTake])

  // ── Playback of the captured take ────────────────────────────────────────────
  const playRaf = useRef<number | null>(null)
  const stopPlayback = useCallback(() => {
    if (playRaf.current) { cancelAnimationFrame(playRaf.current); playRaf.current = null }
    setPlaying(false)
    setPlayhead(null)
  }, [])

  const play = useCallback(() => {
    const preset = selRef.current
    if (!preset || displayNotes.length === 0) return
    const c = ensureCtx()
    void c.resume()
    const when0 = c.currentTime + 0.12
    for (const n of displayNotes) {
      playMelodicNote(c, preset.category as BeatType, clampToPreset(preset, n.midi), when0 + n.startSec, n.velocity)
    }
    const total = Math.max(...displayNotes.map(n => n.startSec + n.durSec)) + 0.4
    setPlaying(true)
    const tick = () => {
      const t = c.currentTime - when0
      if (t >= total) { stopPlayback(); return }
      setPlayhead(Math.max(0, t))
      playRaf.current = requestAnimationFrame(tick)
    }
    playRaf.current = requestAnimationFrame(tick)
  }, [displayNotes, ensureCtx, stopPlayback])

  // ── Cleanup ──────────────────────────────────────────────────────────────────
  useEffect(() => () => {
    detectorRef.current?.stop()
    testDetectorRef.current?.stop()
    stopMetro()
    if (playRaf.current) cancelAnimationFrame(playRaf.current)
    void ctxRef.current?.close()
  }, [stopMetro])

  const hasTake = rawNotes.length > 0

  return (
    <div style={card}>
      <style>{'@keyframes vm-spin{to{transform:rotate(360deg)}}'}</style>
      {/* Instrument picker */}
      <Row label="Instrument">
        <select
          value={selectedId}
          onChange={e => setSelectedId(e.target.value)}
          style={select}
          aria-label="Instrument"
        >
          {grouped.map(g => (
            <optgroup key={g.group} label={g.group}>
              {g.presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </optgroup>
          ))}
        </select>
      </Row>

      {/* BPM + metronome */}
      <Row label="Tempo">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <BpmField value={bpm} onCommit={setBpm} />
          <span style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.08em' }}>BPM</span>
          <button
            onClick={toggleMetro}
            style={{
              padding: '7px 14px', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
              border: `1px solid ${metroOn ? 'var(--accent)' : 'var(--border)'}`,
              background: metroOn ? 'rgba(124,58,237,0.15)' : 'transparent',
              color: metroOn ? 'var(--accent-light)' : 'var(--text-secondary)',
            }}
          >
            {metroOn ? '● Metronome on' : 'Metronome'}
          </button>
        </div>
      </Row>

      {/* Test / Calibrate */}
      <div style={{ borderTop: '1px solid var(--border)', marginTop: 6, paddingTop: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button
            onClick={toggleTest}
            style={{
              padding: '7px 14px', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
              border: `1px solid ${testing ? 'var(--accent)' : 'var(--border)'}`,
              background: testing ? 'rgba(124,58,237,0.15)' : 'transparent',
              color: testing ? 'var(--accent-light)' : 'var(--text-secondary)',
            }}
          >
            {testing ? '● Testing mic' : 'Test mic'}
          </button>
          <button
            onClick={() => void autoCalibrate()}
            disabled={calibrating}
            style={{
              padding: '7px 14px', borderRadius: 8, fontSize: 12.5, fontWeight: 700,
              cursor: calibrating ? 'default' : 'pointer',
              border: '1px solid var(--border)', background: 'transparent',
              color: 'var(--text-secondary)', opacity: calibrating ? 0.6 : 1,
            }}
            title="Measure your room's noise floor, then set the mic threshold just above it"
          >
            {calibrating ? 'Listening…' : 'Auto-calibrate'}
          </button>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>
            Not recorded — just checking your mic
          </span>
        </div>

        {/* Live input-level meter */}
        {(testing || recording) && (() => {
          const db = level?.db ?? -160
          const rms = level?.rms ?? 0
          const pct = clamp((db + 60) / 60 * 100, 0, 100)   // −60..0 dB → 0..100%
          const hearing = rms >= params.rmsGate
          return (
            <div style={{ marginTop: 12 }}>
              <div style={{ height: 12, borderRadius: 6, background: 'var(--bg-base)', border: '1px solid var(--border)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%', width: `${pct}%`,
                  background: hearing ? '#22c55e' : 'var(--text-muted)',
                  opacity: hearing ? 1 : 0.5,
                  transition: 'width 0.06s linear, background 0.15s',
                }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                <span style={{ fontSize: 10.5, color: hearing ? '#22c55e' : 'var(--text-muted)', fontWeight: 600 }}>
                  {hearing ? 'Hearing you' : 'Too quiet — not registering'}
                </span>
                <span style={{ fontSize: 10.5, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                  {level ? `${Math.round(db)} dB` : '—'}
                </span>
              </div>
              {/* Live note readout (test mode) */}
              {testing && (
                <div style={{ minHeight: 22, marginTop: 6, textAlign: 'center' }}>
                  {testLive ? (
                    <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                      {testLive.noteName}
                      <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-muted)', marginLeft: 6 }}>
                        {testLive.cents === 0 ? '0¢' : testLive.cents > 0 ? `+${testLive.cents}¢` : `${testLive.cents}¢`}
                        {`  ·  ${Math.round(testLive.confidence * 100)}% conf`}
                      </span>
                    </span>
                  ) : (
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Sing or hum to check pitch tracking…</span>
                  )}
                </div>
              )}
            </div>
          )
        })()}

        {calibMsg && <p style={{ fontSize: 11.5, color: 'var(--text-secondary)', margin: '8px 0 0' }}>{calibMsg}</p>}

        {/* Sensitivity slider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
          <span style={{ width: 84, flexShrink: 0, fontSize: 10.5, color: 'var(--text-muted)', letterSpacing: '0.07em', textTransform: 'uppercase' }}>Sensitivity</span>
          <input
            type="range" min={0} max={1} step={0.01}
            value={sensitivity}
            onChange={e => onSensitivityChange(parseFloat(e.target.value))}
            aria-label="Mic sensitivity"
            style={{ flex: 1, accentColor: 'var(--accent)', cursor: 'pointer' }}
          />
          <span style={{ width: 34, textAlign: 'right', fontSize: 10.5, color: 'var(--text-muted)' }}>
            {sensitivity < 0.34 ? 'Low' : sensitivity > 0.66 ? 'High' : 'Med'}
          </span>
        </div>
        <p style={{ fontSize: 10.5, color: 'var(--text-muted)', margin: '4px 0 0' }}>
          Higher = boosts a quiet voice and lowers the threshold to register softer notes.
        </p>
      </div>

      {/* Record / Sing */}
      <div style={{ textAlign: 'center', margin: '22px 0 14px' }}>
        <button
          onClick={toggleRecord}
          style={{
            padding: '15px 40px', borderRadius: 14, border: 'none', fontSize: 17, fontWeight: 800, cursor: 'pointer',
            background: recording ? '#dc2626' : 'var(--accent)', color: '#fff',
            boxShadow: recording ? '0 0 0 4px rgba(220,38,38,0.2)' : '0 4px 20px rgba(124,58,237,0.35)',
          }}
        >
          {recording ? '■ Stop' : '● Sing a tune'}
        </button>
        <div style={{ minHeight: 30, marginTop: 12 }}>
          {recording && (
            live
              ? <span style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                  {live.name}
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-muted)', marginLeft: 8 }}>
                    {live.cents === 0 ? '0¢' : live.cents > 0 ? `+${live.cents}¢` : `${live.cents}¢`}
                  </span>
                </span>
              : <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Listening… sing or hum a melody</span>
          )}
        </div>
        {micError && <p style={{ fontSize: 12, color: '#ef4444', margin: '4px 0 0' }}>{micError}</p>}
        {!recording && refining && (
          <p style={{ fontSize: 12, color: 'var(--accent-light)', margin: '6px 0 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <span style={{
              width: 12, height: 12, borderRadius: '50%', flexShrink: 0,
              border: '2px solid var(--border)', borderTopColor: 'var(--accent)',
              animation: 'vm-spin 0.7s linear infinite', display: 'inline-block',
            }} />
            Refining take…
          </p>
        )}
        {!recording && !refining && refineMsg && (
          <p style={{ fontSize: 11.5, color: 'var(--text-secondary)', margin: '6px 0 0' }}>{refineMsg}</p>
        )}
        {!recording && (
          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 0' }}>
            Nothing is uploaded — pitch detection runs entirely in your browser.
          </p>
        )}
      </div>

      {/* Note strip + take controls */}
      {hasTake && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          <NoteStrip notes={displayNotes} playhead={playhead} />

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 14 }}>
            <button
              onClick={playing ? stopPlayback : play}
              style={{
                padding: '9px 22px', borderRadius: 9, border: 'none', fontSize: 13.5, fontWeight: 700, cursor: 'pointer',
                background: playing ? '#dc2626' : 'var(--accent)', color: '#fff',
              }}
            >
              {playing ? '■ Stop' : '▶ Play'}
            </button>

            {/* Take toggle — Live / Refined (grid-corrected) / Raw refined.
                Only shows the versions that actually exist for this take. */}
            {(() => {
              const all: Array<{ src: TakeSource; label: string; title: string; notes: RecNote[] | null }> = [
                { src: 'live',       label: 'Live',    title: 'Raw real-time take',                                  notes: liveTake },
                { src: 'refined',    label: 'Refined', title: 'Offline pitch pass, corrected to the beat grid (most accurate)', notes: refinedTake },
                { src: 'rawRefined', label: 'Raw',     title: 'Offline pitch pass, onsets NOT snapped to the grid',  notes: refinedRawTake },
              ]
              const opts = all.filter(o => o.notes && o.notes.length > 0)
              if (opts.length < 2) return null
              return (
                <div style={{ display: 'flex', gap: 4, alignItems: 'center', padding: 3, borderRadius: 9, border: '1px solid var(--border)' }}>
                  {opts.map(o => (
                    <button
                      key={o.src}
                      onClick={() => selectTake(o.src)}
                      style={{
                        padding: '6px 10px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: 'none',
                        background: takeSource === o.src ? 'var(--accent)' : 'transparent',
                        color: takeSource === o.src ? '#fff' : 'var(--text-muted)',
                      }}
                      title={o.title}
                    >{o.label}</button>
                  ))}
                </div>
              )
            })()}

            {/* Quantize */}
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', padding: 3, borderRadius: 9, border: '1px solid var(--border)' }}>
              {DIVISIONS.map(d => (
                <button
                  key={d.n}
                  onClick={() => { setDivision(d.n); setQuantized(true) }}
                  style={{
                    minWidth: 40, padding: '6px 8px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                    border: 'none',
                    background: quantized && division === d.n ? 'var(--accent)' : 'transparent',
                    color: quantized && division === d.n ? '#fff' : 'var(--text-muted)',
                  }}
                  title={`Quantize to ${d.label} notes`}
                >{d.label}</button>
              ))}
            </div>
            <button
              onClick={() => setQuantized(q => !q)}
              disabled={!quantized && division === 0}
              style={{
                padding: '8px 14px', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                border: `1px solid ${quantized ? 'var(--accent)' : 'var(--border)'}`,
                background: quantized ? 'rgba(124,58,237,0.15)' : 'transparent',
                color: quantized ? 'var(--accent-light)' : 'var(--text-secondary)',
              }}
              title="Toggle grid snapping on/off (your raw take is kept)"
            >
              {quantized ? 'Quantized' : 'Quantize'}
            </button>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>
              {displayNotes.length} note{displayNotes.length === 1 ? '' : 's'}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Mini piano-roll: time on X, pitch on Y ────────────────────────────────────
function NoteStrip({ notes, playhead }: { notes: RecNote[]; playhead: number | null }) {
  const W = 100, H = 120 // viewBox units; scales to container width
  if (notes.length === 0) return null
  const total = Math.max(...notes.map(n => n.startSec + n.durSec), 0.001)
  const loMidi = Math.min(...notes.map(n => n.midi))
  const hiMidi = Math.max(...notes.map(n => n.midi))
  const span = Math.max(4, hiMidi - loMidi + 2) // pad a little vertically
  const midiToY = (m: number) => H - ((m - (loMidi - 1)) / span) * H

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="none"
      style={{ height: 130, background: 'var(--bg-base)', borderRadius: 10, border: '1px solid var(--border)', display: 'block' }}>
      {notes.map((n, i) => {
        const x = (n.startSec / total) * W
        const w = Math.max(0.8, (n.durSec / total) * W)
        const y = midiToY(n.midi)
        return <rect key={i} x={x} y={y - 4} width={w} height={7} rx={1.5} fill="var(--accent)" opacity={0.9} />
      })}
      {playhead !== null && (
        <line
          x1={(playhead / total) * W} y1={0} x2={(playhead / total) * W} y2={H}
          stroke="#f97316" strokeWidth={0.6}
        />
      )}
    </svg>
  )
}

// ── Clean numeric BPM field (pattern from Transport.tsx BpmField) ─────────────
function BpmField({ value, onCommit }: { value: number; onCommit: (bpm: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  function commit() {
    if (draft !== null) {
      const n = parseFloat(draft)
      if (Number.isFinite(n)) onCommit(clampBpm(n))
    }
    setDraft(null)
  }
  return (
    <input
      type="text"
      inputMode="numeric"
      value={draft ?? String(value)}
      aria-label="Tempo in BPM"
      onChange={e => setDraft(e.target.value)}
      onFocus={e => { setDraft(String(value)); e.currentTarget.select() }}
      onBlur={commit}
      onKeyDown={e => {
        e.stopPropagation()
        if (e.key === 'Enter') e.currentTarget.blur()
        else if (e.key === 'Escape') { setDraft(null); e.currentTarget.blur() }
      }}
      style={{
        width: 62, fontSize: 18, fontWeight: 700, textAlign: 'center', padding: '6px 4px',
        background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 8,
        color: 'var(--text-primary)', outline: 'none', fontVariantNumeric: 'tabular-nums',
      }}
    />
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
      <div style={{ width: 84, flexShrink: 0, fontSize: 10.5, color: 'var(--text-muted)', letterSpacing: '0.07em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  )
}

const card: React.CSSProperties = {
  border: '1px solid var(--border)', borderRadius: 18, padding: '22px 22px',
  background: 'var(--bg-card)', maxWidth: 520, margin: '0 auto',
}
const select: React.CSSProperties = {
  width: '100%', padding: '9px 10px', borderRadius: 8, fontSize: 13.5,
  background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-primary)', outline: 'none',
}
