'use client'

/**
 * VoiceMidi — sing/hum a tune and hear it back as a chosen instrument.
 *
 * Two instrument sound sources:
 *   • SYNTH presets   — pure Web Audio, lib/instrument-synth.ts playMelodicNote
 *                       (category ∈ MELODIC_TYPES).
 *   • SAMPLED presets — the real AI multisample packs (Grand Piano (AI),
 *                       Electric Guitar (AI), …): one baked sample per semitone in
 *                       IndexedDB, seeded on demand by seedAiInstruments(). The
 *                       detected note plays its EXACT baked sample (no pitch-shift).
 *
 * Audio plumbing:
 *   • Mic → pitch:  lib/pitch-detector.ts  LivePitchDetector  (YIN, real-time)
 *   • Instruments:  lib/midi-presets.ts     getPresets / getGroupedPresets
 *   • Samples:      lib/default-samples.ts  seedAiInstruments  +  lib/sound-library
 *   • Metronome:    look-ahead scheduler lifted from components/tools/Metronome
 *                   (click recipe from lib/daw-engine _buildMetronomeBuffers)
 *
 * One shared AudioContext, created/resumed inside a user-gesture handler.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LivePitchDetector, type LivePitchResult, type LiveLevel, type LiveSensitivity, type PitchFrame } from '@/lib/pitch-detector'
import { notesFromBuffer, notesFromBufferAsync, analyzeBuffer, analyzeBufferAsync, buildPitchCurve, alignToGrid, conditionalGridAlign, type BufferAnalysis } from '@/lib/voice-backfill'
import { playMelodicNote, MELODIC_TYPES } from '@/lib/instrument-synth'
import {
  getPresets, getGroupedPresets, midiNoteLabel, clampToPreset,
  type MidiPreset,
} from '@/lib/midi-presets'
import { seedAiInstruments, libraryFulfill } from '@/lib/default-samples'
import { libraryGetAll } from '@/lib/sound-library'
import type { BeatType } from '@/lib/beat-analyzer'

// ── Sampled (AI multisample) instruments ──────────────────────────────────────
// The AI packs baked by seedAiInstruments() (lib/default-samples.ts). Mirrors
// AI_INSTRUMENT_PACKS there — each folder holds one sample per semitone across the
// preset's captured range. Discriminator: a preset is SAMPLED (play its baked
// sample) iff its folder is one of these; anything else is a SYNTH voice
// (playMelodicNote). Every AI preset name also ends in "(AI)".
const AI_SAMPLE_FOLDERS = new Set([
  'Grand Piano (AI) – All Notes',
  'Electric Guitar (AI) – All Notes',
  'Electric Bass (AI) – All Notes',
  'Fretless Bass (AI) – All Notes',
  'Synth Bass (AI) – All Notes',
])
function isSampledPreset(p: MidiPreset): boolean {
  return AI_SAMPLE_FOLDERS.has(p.folder)
}

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
// Persisted "Show detected pitch (debug)" overlay preference.
const DEBUG_KEY = 'voicemidi-debug'
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
async function backfillFromBlob(
  blob: Blob,
  params: Required<LiveSensitivity>,
  onProgress?: (frac: number) => void,
): Promise<BufferAnalysis> {
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
    // Async + downsampled: keeps the UI responsive and drives a real progress %.
    // analyzeBufferAsync returns the notes AND the pitch curves (raw + corrected)
    // so the debug view can overlay what the detector heard against what it wrote.
    return analyzeBufferAsync(mono, audio.sampleRate, {
      gain: params.gain,
      rmsGate: params.rmsGate,
      minDuration: 0.08,
    }, onProgress)
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

  // ── Sampled (AI) instrument loading ──────────────────────────────────────────
  // Seeding bakes every semitone of the AI packs into IndexedDB (a few seconds on
  // first use). We seed on selection to mask that latency behind the picker, and
  // cache decoded AudioBuffers by `folder:midi` so re-plays are instant.
  const [instrLoading, setInstrLoading] = useState(false)   // seeding/decoding a sampled preset
  const [instrMsg, setInstrMsg] = useState<string | null>(null)
  const sampleCache = useRef<Map<string, AudioBuffer | null>>(new Map())
  const seedPromise = useRef<Promise<boolean> | null>(null)

  // ── Backfill (offline accuracy pass) ─────────────────────────────────────────
  // After a take, the RECORDED audio is re-analyzed offline for a cleaner
  // transcription. We keep the live take around so the user can toggle back.
  // Three takes are kept side by side:
  //   liveTake       — the real-time capture
  //   refinedRawTake — offline pitch pass (accurate pitch, un-aligned onsets)
  //   refinedTake    — the offline pass CONFIRMED/CORRECTED to the beat grid (default)
  const [refining, setRefining] = useState(false)
  const [refineProgress, setRefineProgress] = useState(0)
  const [refineMsg, setRefineMsg] = useState<string | null>(null)
  const [liveTake, setLiveTake] = useState<RecNote[] | null>(null)
  const [refinedRawTake, setRefinedRawTake] = useState<RecNote[] | null>(null)
  const [refinedTake, setRefinedTake] = useState<RecNote[] | null>(null)
  const [takeSource, setTakeSource] = useState<TakeSource>('live')

  // ── Debug: "what it heard" pitch-curve overlay ───────────────────────────────
  // The offline analysis (analyzeBufferAsync) also returns the raw + corrected
  // per-frame pitch tracks; we keep them (plus the take's grid anchor) so the debug
  // overlay can draw them on the SAME axes as the note strip. Live-only takes (no
  // recorded audio / refine unsupported) leave these null — the overlay just skips
  // the curves and shows the notes. Purely visual; playback/quantize are untouched.
  const [curve, setCurve] = useState<PitchFrame[] | null>(null)
  const [rawCurve, setRawCurve] = useState<PitchFrame[] | null>(null)
  // Onset-aware evidence for the debug overlay: onset times (note (re)starts), the
  // normalized onset-strength (flux) envelope, and per-frame YIN clarity — all aligned
  // to `curve`'s time base. Null/empty on live-only takes (no offline pass).
  const [onsets, setOnsets] = useState<number[] | null>(null)
  const [flux, setFlux] = useState<number[] | null>(null)
  const [clarity, setClarity] = useState<number[] | null>(null)
  const [takeBpm, setTakeBpm] = useState<number | null>(null)
  const [takePhase, setTakePhase] = useState(0)
  const [showDebug, setShowDebug] = useState(false)

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
  // Whether the metronome was actually running when this take started. Grid
  // alignment is only meaningful when the singer sang to a click — see
  // conditionalGridAlign. (Ref, not state, so the deps-[] stopRecording reads it.)
  const recMetroOnRef = useRef(false)
  const rawEvents = useRef<RecNote[]>([])
  const curEvent = useRef<{ startSec: number; midi: number; velocity: number } | null>(null)
  const liveMidi = useRef<number | null>(null)

  // Live values the mic callback reads without re-subscribing.
  const selRef = useRef<MidiPreset | null>(null)

  // ── Load presets (client-only: getPresets reads localStorage) ────────────────
  // Two kinds are offered: SYNTH voices (category ∈ MELODIC_TYPES, played by
  // playMelodicNote) and the SAMPLED AI packs (played from their baked samples).
  // Electric Guitar (AI) has category 'other' so it'd be dropped by the melodic
  // filter — it's re-added here via isSampledPreset regardless of category.
  useEffect(() => {
    const all = getPresets()
    const synth   = all.filter(p => MELODIC_TYPES.has(p.category as BeatType) && !isSampledPreset(p))
    const sampled = all.filter(isSampledPreset)
    const combined = [...synth, ...sampled]
    setPresets(combined)
    // Default to Piano if present, else the first synth preset (keeps prior behavior).
    const def = synth.find(p => p.builtIn && p.name === 'Piano') ?? combined[0]
    if (def) setSelectedId(def.id)
  }, [])

  // Debug/test hook (same convention as __dawDispatch etc.): lets a headless
  // page exercise the pure offline backfill analysis without a live microphone.
  useEffect(() => {
    const w = window as unknown as {
      __voiceBackfill?: typeof notesFromBuffer
      __voiceBackfillAsync?: typeof notesFromBufferAsync
      __voiceAnalyzeBuffer?: typeof analyzeBuffer
      __voiceAnalyzeBufferAsync?: typeof analyzeBufferAsync
      __voiceBuildPitchCurve?: typeof buildPitchCurve
      __voiceAlignToGrid?: typeof alignToGrid
      __voiceConditionalGridAlign?: typeof conditionalGridAlign
      __VoiceLivePitchDetector?: typeof LivePitchDetector
      __voiceSampleProbe?: (folder: string, midi: number) => Promise<unknown>
    }
    w.__voiceBackfill = notesFromBuffer
    w.__voiceBackfillAsync = notesFromBufferAsync
    w.__voiceAnalyzeBuffer = analyzeBuffer
    w.__voiceAnalyzeBufferAsync = analyzeBufferAsync
    w.__voiceBuildPitchCurve = buildPitchCurve
    w.__voiceAlignToGrid = alignToGrid
    w.__voiceConditionalGridAlign = conditionalGridAlign
    // Expose the live detector class so a headless page can drive a real
    // live+PCM capture (feeding an overridden getUserMedia tone stream) and compare
    // live vs offline-PCM pitch — proving the offline detector matches live quality.
    w.__VoiceLivePitchDetector = LivePitchDetector
    // Headless proof hook: seed the AI packs, resolve+fulfill+decode one baked
    // sample for `folder` at `midi`, and report its peak level. Mirrors the exact
    // resolve path playSampledNotes uses (folder + engine note-name → fulfill → decode).
    w.__voiceSampleProbe = async (folder: string, midi: number) => {
      await seedAiInstruments()
      const noteName = midiNoteLabel(midi)
      const entries = await libraryGetAll()
      const entry = entries.find(e => e.folder === folder && e.name === noteName)
      if (!entry) return { ok: false, reason: 'no entry', folder, noteName }
      const fulfilled = await libraryFulfill(entry.id)
      if (!fulfilled?.audioBlob) return { ok: false, reason: 'no blob', folder, noteName }
      const ac = new AudioContext()
      try {
        const buf = await ac.decodeAudioData(await fulfilled.audioBlob.arrayBuffer())
        let max = 0
        const d = buf.getChannelData(0)
        for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > max) max = a }
        return { ok: true, folder, noteName, length: buf.length, sampleRate: buf.sampleRate, max }
      } finally { void ac.close() }
    }
    return () => {
      delete w.__voiceBackfill; delete w.__voiceBackfillAsync
      delete w.__voiceAnalyzeBuffer; delete w.__voiceAnalyzeBufferAsync
      delete w.__voiceBuildPitchCurve; delete w.__voiceAlignToGrid
      delete w.__voiceConditionalGridAlign; delete w.__VoiceLivePitchDetector
      delete w.__voiceSampleProbe
    }
  }, [])

  // Restore the persisted "Show detected pitch" debug preference (off by default).
  useEffect(() => {
    try { setShowDebug(localStorage.getItem(DEBUG_KEY) === '1') } catch { /* ignore */ }
  }, [])
  const toggleDebug = useCallback(() => {
    setShowDebug(v => {
      const next = !v
      try { localStorage.setItem(DEBUG_KEY, next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }, [])

  const selected = useMemo(() => presets.find(p => p.id === selectedId) ?? null, [presets, selectedId])
  useEffect(() => { selRef.current = selected }, [selected])

  // Synth presets keep their canonical instrument groups; the sampled AI packs get
  // their own distinct "AI Instruments" optgroup at the end.
  const grouped = useMemo(() => {
    const synth   = presets.filter(p => !isSampledPreset(p))
    const sampled = presets.filter(isSampledPreset)
    const groups = getGroupedPresets(synth)
    if (sampled.length) groups.push({ group: 'AI Instruments', presets: sampled })
    return groups
  }, [presets])

  const selectedSampled = selected != null && isSampledPreset(selected)

  // Seed the AI packs once (idempotent — seedAiInstruments no-ops if already
  // baked). Shared promise so concurrent callers (select effect + first Play)
  // await the same seed. Resolves false if seeding is unavailable/failed, so the
  // caller can fall back to a synth voice.
  const ensureSeeded = useCallback((): Promise<boolean> => {
    if (!seedPromise.current) {
      seedPromise.current = (async () => {
        try { await seedAiInstruments(); return true }
        catch { return false }
      })()
    }
    return seedPromise.current
  }, [])

  // Seed on selection so the bake latency hides behind the picker, not the first
  // Play. Guarded/idempotent; switching between AI presets doesn't re-seed.
  useEffect(() => {
    if (!selectedSampled) { setInstrLoading(false); setInstrMsg(null); return }
    let cancelled = false
    setInstrLoading(true)
    setInstrMsg('Loading instrument…')
    void ensureSeeded().then(ok => {
      if (cancelled) return
      setInstrLoading(false)
      setInstrMsg(ok ? null : 'Sampled instrument unavailable — using a synth voice')
    })
    return () => { cancelled = true }
  }, [selectedSampled, selectedId, ensureSeeded])

  // Resolve a preset's baked sample for a note → decoded AudioBuffer. Mirrors the
  // engine's _loadPresetBuffer: match on folder + engine note-name, fulfill, decode.
  // Cached by `folder:clampedMidi`; null (no entry) is cached too so we don't retry.
  const loadSampleBuffer = useCallback(async (c: AudioContext, preset: MidiPreset, midi: number): Promise<AudioBuffer | null> => {
    const clamped = clampToPreset(preset, midi)
    const key = `${preset.folder}:${clamped}`
    const cached = sampleCache.current.get(key)
    if (cached !== undefined) return cached
    let buf: AudioBuffer | null = null
    try {
      const noteName = midiNoteLabel(clamped)   // e.g. "E2" — same NOTE_NAMES/format as daw-engine
      const entries = await libraryGetAll()
      const entry = entries.find(e => e.folder === preset.folder && e.name === noteName)
      if (entry) {
        const fulfilled = await libraryFulfill(entry.id)
        if (fulfilled?.audioBlob) buf = await c.decodeAudioData(await fulfilled.audioBlob.arrayBuffer())
      }
    } catch { buf = null }
    sampleCache.current.set(key, buf)
    return buf
  }, [])

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
      // Open the new note — CAPTURE ONLY. No live audio: singing is silent so the
      // instrument is heard only on explicit Playback of the take. Visual feedback
      // (note readout + level meter) still updates below via setLive.
      const velocity = Math.max(0.3, Math.min(1, 0.45 + r.rms))
      curEvent.current = { startSec: now, midi: r.midi, velocity }
      liveMidi.current = r.midi
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
    // Grid-align the offline take ONLY if a click was actually running (same check
    // captureGridPhase uses). Without it the phase is arbitrary and snapping would
    // displace onsets onto meaningless beat lines.
    recMetroOnRef.current = metroTimer.current !== null
    setRawNotes([])
    setQuantized(false)
    setLive(null)
    setRefineMsg(null)
    setRefinedTake(null)
    setRefinedRawTake(null)
    setLiveTake(null)
    setTakeSource('live')
    // Drop any previous take's pitch curves (a live-only take has none).
    setCurve(null)
    setRawCurve(null)
    setOnsets(null)
    setFlux(null)
    setClarity(null)
    setTakeBpm(null)
    setTakePhase(0)
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
    setRefineProgress(0)
    setRefineMsg(null)
    try {
      // Prefer RAW uncompressed PCM (lossless) so the offline detector analyzes the
      // SAME audio the live detector heard. The old path decoded a lossy Opus blob,
      // which handicapped offline detection below the live quality. Fall back to the
      // blob only when PCM capture is unavailable on this browser.
      let analysis: BufferAnalysis
      const pcm = det.stopAndGetPcm()
      if (pcm && pcm.samples.length > 0) {
        det.stop()   // done with the mic; we already hold the lossless PCM
        // The ScriptProcessor tapped the PRE-gain source (like MediaRecorder), so
        // re-apply the user's sensitivity gain + RMS gate offline — same as the blob path.
        analysis = await analyzeBufferAsync(pcm.samples, pcm.sampleRate, {
          gain: paramsRef.current.gain,
          rmsGate: paramsRef.current.rmsGate,
          minDuration: 0.08,
        }, setRefineProgress)
      } else {
        const blob = await det.stopAndGetAudio()
        if (!blob) {
          // Capture unavailable on this browser — keep the live take, no error.
          setRefineMsg('Live take — refine not supported in this browser')
          return
        }
        analysis = await backfillFromBlob(blob, paramsRef.current, setRefineProgress)
      }
      const refinedRaw = analysis.notes
      // Stash the pitch curves + this take's grid anchor for the debug overlay.
      // (These describe the recorded audio, so they apply to whichever take view is
      // shown — live/refined/raw all come from the same performance.)
      setCurve(analysis.curve)
      setRawCurve(analysis.rawCurve)
      setOnsets(analysis.onsets ?? null)
      setFlux(analysis.flux ?? null)
      setClarity(analysis.clarity ?? null)
      setTakeBpm(recBpmRef.current)
      setTakePhase(recPhaseRef.current)
      if (refinedRaw.length > 0) {
        // Grid-correct the offline onsets ONLY when a click was actually running.
        // Sung to a metronome, the true onsets lie on the grid the singer heard, so
        // alignToGrid confirms/corrects toward it. With NO metronome the phase is
        // arbitrary, so snapping would displace notes onto meaningless beat lines —
        // conditionalGridAlign keeps the real onsets instead. (Manual Quantize still
        // works for deliberate snapping.)
        const { refined, rawRefined, aligned } = conditionalGridAlign(
          refinedRaw,
          recMetroOnRef.current,
          { bpm: recBpmRef.current, phaseSec: recPhaseRef.current, division: divisionRef.current },
        )
        setRefinedRawTake(rawRefined)       // un-aligned view, only when a click was used
        setRefinedTake(refined)             // the default "Refined" take
        setRawNotes(refined)
        setTakeSource('refined')
        setRefineMsg(`Refined — ${refined.length} note${refined.length === 1 ? '' : 's'}${aligned ? ', grid-aligned' : ''}`)
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
  // Pending disconnect timers for per-note gate GainNodes (see play()).
  const playTimers = useRef<number[]>([])
  // A per-session teardown surface so Stop can silence EVERYTHING at once:
  //   • playMasterRef  — the single master GainNode all notes route through, so one
  //                      fast gain-cut kills scheduled synth oscillators (which have
  //                      no stop handle) and any in-flight tails together.
  //   • playSourcesRef — every AudioBufferSourceNode (sampled path) so Stop can .stop() them.
  //   • playGatesRef   — every per-note gate GainNode so Stop can disconnect them now
  //                      instead of waiting on their (cancelled) disconnect timers.
  const playMasterRef  = useRef<GainNode | null>(null)
  const playSourcesRef = useRef<AudioBufferSourceNode[]>([])
  const playGatesRef   = useRef<GainNode[]>([])

  // Begin a play session: a fresh master gain into the destination + empty
  // tracking arrays. Every note connects its gate to this master.
  const startPlaySession = useCallback((c: AudioContext): GainNode => {
    const master = c.createGain()
    master.gain.setValueAtTime(1, c.currentTime)
    master.connect(c.destination)
    playMasterRef.current  = master
    playSourcesRef.current = []
    playGatesRef.current   = []
    playTimers.current     = []
    return master
  }, [])

  const stopPlayback = useCallback(() => {
    // (e) stop the playhead animation.
    if (playRaf.current) { cancelAnimationFrame(playRaf.current); playRaf.current = null }

    const c      = ctxRef.current
    const master = playMasterRef.current
    playMasterRef.current = null

    // (a) fast-fade the master to silence — kills the un-stoppable synth
    // oscillators without a click (they finish rendering into a muted bus).
    if (c && master) {
      const now = c.currentTime
      try {
        master.gain.cancelScheduledValues(now)
        master.gain.setValueAtTime(master.gain.value, now)
        master.gain.linearRampToValueAtTime(0, now + 0.03)   // definitive click-safe cut to EXACTLY 0 (setTargetAtTime only asymptotes)
      } catch { /* param already detached */ }
    }

    // (b) hard-stop every tracked buffer source (sampled path).
    for (const src of playSourcesRef.current) {
      try { src.stop() } catch { /* not started / already stopped */ }
      try { src.disconnect() } catch { /* already torn down */ }
    }
    playSourcesRef.current = []

    // (c) cancel the pending gate-disconnect timers and disconnect the gates now.
    playTimers.current.forEach(id => clearTimeout(id))
    playTimers.current = []
    for (const g of playGatesRef.current) {
      try { g.disconnect() } catch { /* already torn down */ }
    }
    playGatesRef.current = []

    // (d) drop the master after the fade settles (~200ms).
    if (master) {
      window.setTimeout(() => { try { master.disconnect() } catch { /* ok */ } }, 200)
    }

    setPlaying(false)
    setPlayhead(null)
  }, [])

  // Drive the playhead animation for a scheduled take (shared by both paths).
  const runPlayhead = useCallback((c: AudioContext, when0: number, notes: RecNote[]) => {
    const total = Math.max(...notes.map(n => n.startSec + n.durSec)) + 0.4
    setPlaying(true)
    const tick = () => {
      const t = c.currentTime - when0
      if (t >= total) { stopPlayback(); return }
      setPlayhead(Math.max(0, t))
      playRaf.current = requestAnimationFrame(tick)
    }
    playRaf.current = requestAnimationFrame(tick)
  }, [stopPlayback])

  // SYNTH playback (unchanged behavior). Gate each note off at start+dur.
  // playMelodicNote has no note-off, so sustained voices (pad/organ/strings/drone)
  // would otherwise ring their full synth envelope past the note's duration. We
  // route each note through its own GainNode and ramp it to silence at note-off
  // (~35ms release), then disconnect after it settles. Plucky voices already
  // shorter than durSec are unaffected (gain still 1 there).
  const playSynthNotes = useCallback((c: AudioContext, preset: MidiPreset, notes: RecNote[], master: GainNode) => {
    const when0 = c.currentTime + 0.12
    for (const n of notes) {
      const start   = when0 + n.startSec
      const noteOff = start + n.durSec
      const g = c.createGain()
      g.gain.setValueAtTime(1, start)
      g.gain.setValueAtTime(1, noteOff)
      g.gain.setTargetAtTime(0, noteOff, 0.012)   // exponential release, ~35ms to silence
      g.connect(master)                            // → master → destination (Stop cuts here)
      playGatesRef.current.push(g)
      playMelodicNote(c, preset.category as BeatType, clampToPreset(preset, n.midi), start, n.velocity, g)
      const disc = window.setTimeout(
        () => { try { g.disconnect() } catch { /* already torn down */ } },
        Math.max(0, (noteOff + 0.25 - c.currentTime) * 1000),
      )
      playTimers.current.push(disc)
    }
    runPlayhead(c, when0, notes)
  }, [runPlayhead])

  // SAMPLED playback — the AI multisample path. Pre-load every distinct (clamped)
  // pitch BEFORE scheduling so timing is tight, then schedule one
  // AudioBufferSourceNode per note → velocity GainNode → destination, gated OFF at
  // start+dur with the SAME ~35ms release as the synth path. No playbackRate shift:
  // samples are baked per-semitone, so we play the exact note's sample. Out-of-range
  // notes clamp to loNote..hiNote (AI presets are otherwise silent past their span).
  const playSampledNotes = useCallback(async (c: AudioContext, preset: MidiPreset, notes: RecNote[], master: GainNode) => {
    setInstrLoading(true)
    setInstrMsg('Loading instrument…')
    const ok = await ensureSeeded()
    // A Stop during the async seed/load must abort this scheduling pass — the
    // master was already detached by stopPlayback, so bail rather than build on it.
    if (playMasterRef.current !== master) { setInstrLoading(false); return }
    const pitches = [...new Set(notes.map(n => clampToPreset(preset, n.midi)))]
    const bufs = new Map<number, AudioBuffer | null>()
    await Promise.all(pitches.map(async p => { bufs.set(p, await loadSampleBuffer(c, preset, p)) }))
    if (playMasterRef.current !== master) { setInstrLoading(false); return }
    setInstrLoading(false)
    const anyBuf = [...bufs.values()].some(Boolean)
    if (!ok || !anyBuf) {
      // Seeding/fulfill unavailable → fall back to a synth voice so the take still sounds.
      setInstrMsg('Sampled instrument unavailable — using a synth voice')
      playSynthNotes(c, preset, notes, master)
      return
    }
    setInstrMsg(null)
    const when0 = c.currentTime + 0.12
    for (const n of notes) {
      const clamped = clampToPreset(preset, n.midi)
      const buf     = bufs.get(clamped)
      const start   = when0 + n.startSec
      const noteOff = start + n.durSec
      const v = n.velocity
      const g = c.createGain()
      g.gain.setValueAtTime(v, start)
      g.gain.setValueAtTime(v, noteOff)
      g.gain.setTargetAtTime(0, noteOff, 0.012)   // ~35ms release, same gate as the synth path
      g.connect(master)                            // → master → destination (Stop cuts here)
      playGatesRef.current.push(g)
      if (buf) {
        const src = c.createBufferSource()
        src.buffer = buf
        src.connect(g)
        src.start(start)
        src.stop(noteOff + 0.3)                    // let the release tail through, then hard-stop
        src.onended = () => { try { src.disconnect() } catch { /* already torn down */ } }
        playSourcesRef.current.push(src)           // tracked so Stop can .stop() it early
      } else {
        // A pitch that resolved no sample (shouldn't happen post-clamp) → synth voice.
        playMelodicNote(c, preset.category as BeatType, clamped, start, v, g)
      }
      const disc = window.setTimeout(
        () => { try { g.disconnect() } catch { /* already torn down */ } },
        Math.max(0, (noteOff + 0.35 - c.currentTime) * 1000),
      )
      playTimers.current.push(disc)
    }
    runPlayhead(c, when0, notes)
  }, [ensureSeeded, loadSampleBuffer, playSynthNotes, runPlayhead])

  const play = useCallback(() => {
    const preset = selRef.current
    if (!preset || displayNotes.length === 0) return
    // Starting a new take must never overlap/leak a still-playing one.
    stopPlayback()
    const c = ensureCtx()
    void c.resume()
    const master = startPlaySession(c)
    if (isSampledPreset(preset)) void playSampledNotes(c, preset, displayNotes, master)
    else playSynthNotes(c, preset, displayNotes, master)
  }, [displayNotes, ensureCtx, playSampledNotes, playSynthNotes, stopPlayback, startPlaySession])

  // ── Cleanup ──────────────────────────────────────────────────────────────────
  useEffect(() => () => {
    detectorRef.current?.stop()
    testDetectorRef.current?.stop()
    stopMetro()
    if (playRaf.current) cancelAnimationFrame(playRaf.current)
    playTimers.current.forEach(id => clearTimeout(id))
    playSourcesRef.current.forEach(src => { try { src.stop() } catch { /* ok */ } })
    try { playMasterRef.current?.disconnect() } catch { /* ok */ }
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
        {selectedSampled && instrMsg && (
          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '6px 0 0', display: 'flex', alignItems: 'center', gap: 6 }}>
            {instrLoading && (
              <span style={{
                width: 11, height: 11, borderRadius: '50%', flexShrink: 0,
                border: '2px solid var(--border)', borderTopColor: 'var(--accent)',
                animation: 'vm-spin 0.7s linear infinite', display: 'inline-block',
              }} />
            )}
            {instrMsg}
          </p>
        )}
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
            Refining take… {Math.round(refineProgress * 100)}%
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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 8 }}>
            <label
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}
              title="Overlay the raw per-frame pitch the detector heard against the notes it wrote"
            >
              <input
                type="checkbox"
                checked={showDebug}
                onChange={toggleDebug}
                aria-label="Show detected pitch (debug)"
                data-testid="vm-debug-toggle"
                style={{ accentColor: 'var(--accent)', cursor: 'pointer' }}
              />
              Show detected pitch <span style={{ opacity: 0.7 }}>(debug)</span>
            </label>
          </div>

          <NoteStrip
            notes={displayNotes}
            playhead={playhead}
            debug={showDebug && curve && curve.length > 0
              ? { curve, rawCurve: rawCurve ?? [], bpm: takeBpm ?? recBpmRef.current, phaseSec: takePhase, division,
                  onsets: onsets ?? [], flux: flux ?? [], clarity: clarity ?? [] }
              : null}
          />
          {showDebug && !(curve && curve.length > 0) && (
            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '6px 0 0' }}>
              No detected-pitch curve for this take (live-only capture — sing a take with refine to see it).
            </p>
          )}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 14 }}>
            <button
              onClick={playing ? stopPlayback : play}
              disabled={instrLoading && !playing}
              style={{
                padding: '9px 22px', borderRadius: 9, border: 'none', fontSize: 13.5, fontWeight: 700,
                cursor: instrLoading && !playing ? 'default' : 'pointer',
                opacity: instrLoading && !playing ? 0.7 : 1,
                background: playing ? '#dc2626' : 'var(--accent)', color: '#fff',
              }}
            >
              {playing ? '■ Stop' : instrLoading ? '… Loading' : '▶ Play'}
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
                      onClick={() => { stopPlayback(); selectTake(o.src) }}
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

// ── Debug pitch-curve overlay data ────────────────────────────────────────────
// The offline analysis' pitch curves + the take's grid anchor, all on the SAME
// time (seconds) base as the note startSecs, so the overlay shares the note axes.
interface DebugCurves {
  curve:    PitchFrame[]   // corrected (post-refine) — what produced the notes
  rawCurve: PitchFrame[]   // raw (pre-refine) — what the detector actually heard
  bpm:      number
  phaseSec: number
  division: number
  onsets:   number[]       // detected onset times (sec) — where a note (re)starts
  flux:     number[]       // normalized onset-strength per curve frame (0–1)
  clarity:  number[]       // YIN clarity per curve frame (0–1)
}

// Fractional MIDI (with cents) from a frame's exact Hz, so vibrato/glide read as
// wobble/ramps instead of semitone stairs. null when the frame is unvoiced.
const frameMidi = (f: PitchFrame): number | null =>
  f.freq && f.freq > 0 ? 69 + 12 * Math.log2(f.freq / 440) : null

// Split a pitch track into contiguous voiced runs → SVG polyline point strings,
// so unvoiced gaps break the line instead of drawing a spurious connector.
function curveSegments(
  frames: PitchFrame[],
  timeToX: (t: number) => number,
  midiToY: (m: number) => number,
): string[] {
  const segs: string[] = []
  let cur: string[] = []
  const flush = () => { if (cur.length > 1) segs.push(cur.join(' ')); cur = [] }
  for (const f of frames) {
    const m = frameMidi(f)
    if (m === null) { flush(); continue }
    cur.push(`${timeToX(f.time).toFixed(2)},${midiToY(m).toFixed(2)}`)
  }
  flush()
  return segs
}

// ── Mini piano-roll: time on X, pitch on Y (+ optional debug pitch overlay) ────
function NoteStrip({ notes, playhead, debug }: { notes: RecNote[]; playhead: number | null; debug?: DebugCurves | null }) {
  const W = 100, H = 120 // viewBox units; scales to container width
  if (notes.length === 0) return null
  const dbg = debug ?? null

  // Time span: notes, extended to cover the curve tail when debugging.
  let total = 0.001
  for (const n of notes) total = Math.max(total, n.startSec + n.durSec)
  if (dbg) {
    for (const f of dbg.curve)    total = Math.max(total, f.time)
    for (const f of dbg.rawCurve) total = Math.max(total, f.time)
  }

  // Pitch range: notes, extended to cover voiced curve frames (fractional MIDI) so
  // the curve is never clipped and octave excursions in the raw track stay visible.
  let loMidi = Infinity, hiMidi = -Infinity
  for (const n of notes) { if (n.midi < loMidi) loMidi = n.midi; if (n.midi > hiMidi) hiMidi = n.midi }
  if (dbg) {
    for (const f of [...dbg.curve, ...dbg.rawCurve]) {
      const m = frameMidi(f)
      if (m !== null) { if (m < loMidi) loMidi = m; if (m > hiMidi) hiMidi = m }
    }
  }
  const span = Math.max(4, hiMidi - loMidi + 2) // pad a little vertically
  const midiToY = (m: number) => H - ((m - (loMidi - 1)) / span) * H
  const timeToX = (t: number) => (t / total) * W

  // Beat-grid vertical lines at phaseSec + k*step (light) — onset-vs-grid alignment.
  const gridXs: number[] = []
  if (dbg && dbg.bpm > 0 && dbg.division > 0) {
    const step = 60 / dbg.bpm / dbg.division
    if (Number.isFinite(step) && step > 0) {
      const kStart = Math.ceil((0 - dbg.phaseSec) / step)
      const kEnd   = Math.floor((total - dbg.phaseSec) / step)
      for (let k = kStart; k <= kEnd && gridXs.length < 400; k++) gridXs.push(timeToX(dbg.phaseSec + k * step))
    }
  }

  const correctedSegs = dbg ? curveSegments(dbg.curve, timeToX, midiToY) : []
  const rawSegs       = dbg ? curveSegments(dbg.rawCurve, timeToX, midiToY) : []
  const noteOpacity   = dbg ? 0.35 : 0.9      // let the curves read on top in debug
  const voicedRaw     = dbg ? dbg.rawCurve.reduce((a, f) => a + (frameMidi(f) !== null ? 1 : 0), 0) : 0

  // Onset X positions (where the segmenter decided a note (re)starts).
  const onsetXs = dbg ? dbg.onsets.map(timeToX) : []

  const C_RAW = '#60a5fa'        // raw (heard) — blue, dashed, faint
  const C_COR = '#22c55e'        // corrected — green, solid
  const C_GRID = 'var(--border)' // beat grid — subtle
  const C_ONSET = '#f43f5e'      // onset ticks — rose (distinct from grid/playhead/curves)
  const C_FLUX = '#a78bfa'       // flux envelope — violet

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="none"
        data-testid="vm-note-strip"
        style={{ height: 130, background: 'var(--bg-base)', borderRadius: 10, border: '1px solid var(--border)', display: 'block' }}>
        {/* Beat grid (behind everything) */}
        {gridXs.map((x, i) => (
          <line key={`g${i}`} data-testid="vm-grid-line"
            x1={x} y1={0} x2={x} y2={H} stroke={C_GRID} strokeWidth={0.5}
            strokeDasharray="2 2" opacity={0.7} vectorEffect="non-scaling-stroke" />
        ))}
        {/* Notes (semi-transparent under the curves in debug) */}
        {notes.map((n, i) => {
          const x = (n.startSec / total) * W
          const w = Math.max(0.8, (n.durSec / total) * W)
          const y = midiToY(n.midi)
          return <rect key={i} x={x} y={y - 4} width={w} height={7} rx={1.5} fill="var(--accent)" opacity={noteOpacity} />
        })}
        {/* Raw pitch track — what the detector heard (before octave/median fix) */}
        {rawSegs.map((pts, i) => (
          <polyline key={`r${i}`} data-testid="vm-curve-raw"
            points={pts} fill="none" stroke={C_RAW} strokeWidth={1} strokeDasharray="3 2"
            opacity={0.55} vectorEffect="non-scaling-stroke" />
        ))}
        {/* Corrected pitch track — what produced the notes */}
        {correctedSegs.map((pts, i) => (
          <polyline key={`c${i}`} data-testid="vm-curve-corrected"
            points={pts} fill="none" stroke={C_COR} strokeWidth={1.2}
            vectorEffect="non-scaling-stroke" />
        ))}
        {/* Onset ticks — a small top-anchored tick where a note (re)starts. Distinct
            colour so the re-articulation splits (same-pitch re-hits) are visible. */}
        {onsetXs.map((x, i) => (
          <line key={`o${i}`} data-testid="vm-onset-tick"
            x1={x} y1={0} x2={x} y2={H} stroke={C_ONSET} strokeWidth={0.9}
            opacity={0.85} vectorEffect="non-scaling-stroke" />
        ))}
        {playhead !== null && (
          <line
            x1={(playhead / total) * W} y1={0} x2={(playhead / total) * W} y2={H}
            stroke="#f97316" strokeWidth={0.6} vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>

      {/* Secondary evidence lane: the onset-strength (flux) envelope, with each frame's
          opacity faded by its YIN clarity (faint where low-confidence), plus the same
          onset ticks — so the acoustic evidence behind each note (re)start is visible. */}
      {dbg && (
        <svg viewBox="0 0 100 100" width="100%" preserveAspectRatio="none"
          data-testid="vm-flux-lane"
          style={{ height: 34, marginTop: 3, background: 'var(--bg-base)', borderRadius: 8, border: '1px solid var(--border)', display: 'block' }}>
          {(() => {
            const n = Math.min(dbg.curve.length, dbg.flux.length)
            if (n === 0) return null
            const stride = Math.max(1, Math.ceil(n / 320))
            const bars: React.ReactNode[] = []
            const bw = Math.max(0.25, (100 / n) * stride * 0.9)
            for (let i = 0; i < n; i += stride) {
              const h  = Math.max(0, Math.min(1, dbg.flux[i] ?? 0))
              const cl = Math.max(0, Math.min(1, dbg.clarity[i] ?? 0))
              if (h <= 0) continue
              const x = timeToX(dbg.curve[i].time)
              bars.push(
                <rect key={`f${i}`} x={x - bw / 2} y={100 - h * 100} width={bw} height={h * 100}
                  fill={C_FLUX} opacity={0.3 + 0.6 * cl} />,
              )
            }
            return bars
          })()}
          {/* Onset ticks in the lane, aligned with the ticks on the pitch plot above. */}
          {onsetXs.map((x, i) => (
            <line key={`fo${i}`} x1={x} y1={0} x2={x} y2={100} stroke={C_ONSET}
              strokeWidth={0.9} opacity={0.85} vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
      )}

      {/* Legend + take stats (debug only) */}
      {dbg && (
        <div data-testid="vm-debug-legend"
          style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginTop: 8, fontSize: 10.5, color: 'var(--text-muted)' }}>
          <LegendSwatch color={C_COR} label="corrected" />
          <LegendSwatch color={C_RAW} label="raw (heard)" dashed />
          <LegendSwatch color="var(--accent)" label="notes" solidBox />
          <LegendSwatch color={C_ONSET} label="onsets" />
          <LegendSwatch color={C_FLUX} label="flux" solidBox />
          <LegendSwatch color={C_GRID} label="beats" dashed />
          <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>
            {notes.length} note{notes.length === 1 ? '' : 's'} · {total.toFixed(1)}s · {Math.round(dbg.bpm)} BPM · {voicedRaw} voiced · {dbg.onsets.length} onset{dbg.onsets.length === 1 ? '' : 's'}
          </span>
        </div>
      )}
    </div>
  )
}

function LegendSwatch({ color, label, dashed, solidBox }: { color: string; label: string; dashed?: boolean; solidBox?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      {solidBox
        ? <span style={{ width: 12, height: 8, background: color, opacity: 0.5, borderRadius: 1.5, display: 'inline-block' }} />
        : <span style={{ width: 14, height: 0, borderTop: `2px ${dashed ? 'dashed' : 'solid'} ${color}`, display: 'inline-block' }} />}
      {label}
    </span>
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
