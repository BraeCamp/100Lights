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
import { notesFromBuffer, notesFromBufferAsync, analyzeBuffer, analyzeBufferAsync, analyzeBands, buildPitchCurve, alignToGrid, conditionalGridAlign, type BufferAnalysis, type BandsAnalysis } from '@/lib/voice-backfill'
import { playMelodicNote, MELODIC_TYPES } from '@/lib/instrument-synth'
import { snapToScale, ROOT_NOTES, SCALE_LABELS, type ScaleType } from '@/lib/scale-constants'
import {
  getPresets, getGroupedPresets, midiNoteLabel, clampToPreset,
  type MidiPreset,
} from '@/lib/midi-presets'
import { seedAiInstruments, libraryFulfill } from '@/lib/default-samples'
import { libraryGetAll } from '@/lib/sound-library'
import type { BeatType } from '@/lib/beat-analyzer'
import {
  saveCorrection, listCorrections, countCorrections, exportCorrections, clearCorrections,
  diffNotes, describeDiff, summarizeCorrections, encodeCorrectionAudio,
  CORRECTIONS_APP_VERSION,
  type CorrectionRecord, type CorrectionEvidence, type CorrectionsSummary,
} from '@/lib/voice-corrections'

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
export interface RecNote { startSec: number; midi: number; durSec: number; velocity: number }

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
// Persisted note-editor grid-snap preference (default ON = current behavior). When
// OFF, manual horizontal edits (note start / add placement) are free/continuous;
// pitch always stays semitone-quantized. Does NOT affect the Quantize button.
const EDITOR_SNAP_KEY = 'voicemidi-editor-snap'
// Persisted note-segmenter choice for the offline refine pass. Default matches the code
// default in lib/voice-backfill (DEFAULT_SEGMENTER = 'hmm', the A/B winner).
const SEGMENTER_KEY = 'voicemidi-segmenter'
type Segmenter = 'onset' | 'hmm'
const DEFAULT_SEGMENTER: Segmenter = 'hmm'
// Persisted "Use EQ band for detection" preference. Default 'full' (existing full-signal
// pitch); 'eq' swaps the pitch source to the dominant frequency band (see analyzeBands).
const PITCH_SOURCE_KEY = 'voicemidi-pitch-source'
type PitchSource = 'full' | 'eq'
const DEFAULT_PITCH_SOURCE: PitchSource = 'full'
// ── Latency compensation ──────────────────────────────────────────────────────
// The click is HEARD `outputLatency` after it's scheduled, and the mic delivers the
// voice `inputLatency` after it happened, so sung onsets lag the scheduled clicks by
// ~the round-trip. We shift the beat grid forward by that amount so a note whose
// acoustic onset matched a heard beat snaps to that beat's line. outputLatency comes
// from the AudioContext; inputLatency has no reliable API, so we seed a few-ms default
// and expose a user "Timing offset (ms)" dial (persisted) as the final device-specific
// correction — the control value IS the total compensation, pre-filled with the auto
// estimate below.
const TIMING_OFFSET_KEY = 'voicemidi-timing-offset'
const INPUT_LATENCY_DEFAULT_MS = 3
const TIMING_OFFSET_MIN = -100
const TIMING_OFFSET_MAX = 100
// Auto estimate (ms) that seeds the Timing-offset control's default: output latency of
// the click context + a small input-latency default.
function autoLatencyMs(c: AudioContext | null): number {
  const out = c ? (c.outputLatency || c.baseLatency || 0) : 0
  return Math.round((out + INPUT_LATENCY_DEFAULT_MS / 1000) * 1000)
}
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
// Sensitivity-scaled minimum note duration for the OFFLINE pass: higher sensitivity keeps
// shorter notes. 0 → 0.075s … 0.5 → 0.06s … 1 → 0.045s. So a ~90–110ms real note clears the
// floor with margin, and turning sensitivity up rescues borderline-short notes end-to-end.
const minDurForSensitivity = (s: number) => clamp(0.075 - 0.03 * clamp(s, 0, 1), 0.045, 0.075)

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

// ── Scale-snap helper (autotune, for notes) ───────────────────────────────────
// Pull each detected note's pitch onto the nearest note of a chosen key + scale — the discrete-note
// analog of the Autotune app (which pitch-shifts audio to snapToScale targets). Pure + non-destructive.
// `maxShift` is the discrete stand-in for autotune's continuous strength: only corrections within N
// semitones are applied, so a deliberate blue/passing note isn't yanked onto a scale degree.
// scale === 'chromatic' is a no-op (correction off).
export function snapNotesToScale(notes: RecNote[], key: number, scale: ScaleType, maxShift = 2): RecNote[] {
  if (scale === 'chromatic') return notes
  const root = ROOT_NOTES[(((key % 12) + 12) % 12)]
  return notes.map(n => {
    const snapped = snapToScale(Math.round(n.midi), root, scale)
    return Math.abs(snapped - n.midi) > maxShift ? n : { ...n, midi: snapped }
  })
}

// Representative pitch of a band's per-frame track = the median MIDI over its voiced frames
// (robust to the odd octave-flicker frame). Null when the band never locked a pitch.
function bandDisplayMidi(track: { midi: number | null }[]): number | null {
  const vals = track.map(p => p.midi).filter((m): m is number => m !== null).sort((a, b) => a - b)
  return vals.length ? vals[Math.floor(vals.length / 2)] : null
}

// ── Backfill: decode a recorded blob → mono PCM ───────────────────────────────
// Browser-only glue (decode + stereo downmix). The actual pitch→note analysis is
// the pure, testable analyzeBufferAsync() in lib/voice-backfill.ts, run by the caller
// so the SAME mono buffer can be re-analyzed with a different segmenter (A/B toggle).
async function decodeBlobToMono(blob: Blob): Promise<{ samples: Float32Array; sampleRate: number }> {
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
    return { samples: mono, sampleRate: audio.sampleRate }
  } finally {
    void ac.close()
  }
}

// `onNotes` (optional) lets a host app — e.g. the Firefly sketchpad at /firefly — read
// the final melody OUT of this flow without forking the tuned capture/edit/playback UI. Fired
// with the current display notes + tempo whenever they change. The standalone /voicemidi
// page passes nothing, so its behavior is unchanged.
export default function VoiceMidi({ onNotes, restore }: {
  onNotes?: (notes: RecNote[], bpm: number) => void
  restore?: { notes: RecNote[]; bpm: number; nonce: number }
} = {}) {
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
  // Autotune-for-notes: snap detected pitches to a key + scale. 'chromatic' scale = off (default).
  const [pitchKey, setPitchKey] = useState(0)                       // 0..11 → C..B
  const [pitchScale, setPitchScale] = useState<ScaleType>('chromatic')
  // Manual-editing grid snap (default ON). Only gates horizontal drag/add snapping in
  // the note strip; pitch stays semitone-quantized and the Quantize button is separate.
  const [editorSnap, setEditorSnap] = useState(true)
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
  // Refs mirror the un-aligned offline notes + the shown take, so the Timing-offset dial
  // can re-align the LAST take instantly (no pitch re-analysis) from the deps-[] handler.
  const refinedRawTakeRef = useRef<RecNote[] | null>(null)
  const takeSourceRef = useRef<TakeSource>('live')

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
  // Volume (RMS) + pitch-change envelopes and the recovery-pass note starts — the extra
  // decision signals the debug overlay draws as stacked lanes / distinct markers.
  const [volume, setVolume] = useState<number[] | null>(null)
  const [pitchDelta, setPitchDelta] = useState<number[] | null>(null)
  const [recovered, setRecovered] = useState<number[] | null>(null)
  const [takeBpm, setTakeBpm] = useState<number | null>(null)
  const [takePhase, setTakePhase] = useState(0)
  const [showDebug, setShowDebug] = useState(false)

  // ── Note segmenter (A/B: HMM vs onset) ───────────────────────────────────────
  // Which offline note segmenter the refine pass uses. Persisted; default = the code
  // default 'hmm'. A ref mirrors it so the record→refine flow (deps []) reads the live
  // value, and lastAudioRef stashes the last take's mono PCM so flipping the toggle can
  // re-analyze the SAME performance under the other segmenter (live A/B with the overlay).
  const [segmenter, setSegmenter] = useState<Segmenter>(DEFAULT_SEGMENTER)
  const segmenterRef = useRef<Segmenter>(DEFAULT_SEGMENTER)
  const lastAudioRef = useRef<{ samples: Float32Array; sampleRate: number } | null>(null)
  // Memoized offline analyses for the CURRENT take, keyed by the inputs that change the result
  // (segmenter × pitch-source × sensitivity × grid). Flipping Tracker or "Use EQ band" and then
  // flipping back is then instant — the take is analyzed once per combination and the rendered
  // data is kept until a NEW take is recorded or the take is cleared/deleted (never re-refined
  // on a toggle round-trip). Cleared in stopRecording (new audio) and the Clear handler.
  const analysisCacheRef = useRef<Map<string, BufferAnalysis>>(new Map())

  // ── EQ pitch source (Detect EQ / dominant-band pitch) ────────────────────────
  // 'full' (default) = full-signal YIN; 'eq' = swap the pitch to the dominant frequency band
  // (analyzeBands). Persisted; a ref mirrors it so the record→refine / toggle flows read live.
  // lastBandsAnalysis holds the last "Detect EQ" reading so the panel can show why a band won.
  const [pitchSource, setPitchSource] = useState<PitchSource>(DEFAULT_PITCH_SOURCE)
  const pitchSourceRef = useRef<PitchSource>(DEFAULT_PITCH_SOURCE)
  const [bandsAnalysis, setBandsAnalysis] = useState<BandsAnalysis | null>(null)
  const [detectingEq, setDetectingEq] = useState(false)

  // ── Timing offset (latency-compensation dial) ────────────────────────────────
  // The total grid-shift compensation in ms (output + input latency, device-tunable).
  // Seeded with the auto estimate once a context exists; persisted; only relevant when
  // the metronome was used. A ref mirrors it so the deps-[] align/re-run flows read live.
  const [timingOffsetMs, setTimingOffsetMs] = useState(0)
  const timingOffsetRef = useRef(0)
  const timingUserSetRef = useRef(false)   // true once persisted/user-moved — stops the auto default from overwriting
  const autoAppliedRef = useRef(false)      // ensures the auto default is applied at most once
  // Whether the LAST take was recorded with the metronome running — gates the control's
  // visibility together with metroOn (state, so the UI re-renders).
  const [takeUsedMetro, setTakeUsedMetro] = useState(false)

  // ── Manual correction + learning capture ─────────────────────────────────────
  // The tracker's ORIGINAL notes for this take (the training baseline). Set whenever a
  // take is (re)generated or a take-source is picked; the user's manual edits to
  // rawNotes become the CORRECTED (ground-truth) set diffed against this.
  const [detected, setDetected] = useState<RecNote[]>([])
  const [edited, setEdited] = useState(false)          // true once the user hand-edits
  const [selNote, setSelNote] = useState<number | null>(null)   // selected note index (edit)
  const [takeGridAligned, setTakeGridAligned] = useState(false) // last refine grid-aligned?
  const [savedCount, setSavedCount] = useState(0)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [saveSummary, setSaveSummary] = useState<CorrectionsSummary | null>(null)
  const [savingCorr, setSavingCorr] = useState(false)
  const [sendingAdmin, setSendingAdmin] = useState(false)     // POST to /api/voice-corrections in flight
  const [sendMsg, setSendMsg] = useState<string | null>(null)

  // ── Test / calibrate ─────────────────────────────────────────────────────────
  const [sensitivity, setSensitivity] = useState(DEFAULT_SENS)
  // Mirror in a ref so the record→refine / segmenter-toggle flows (deps []) thread the LIVE
  // sensitivity into the offline pass (recall gates + HMM keepBias scale off it).
  const sensitivityRef = useRef(DEFAULT_SENS)
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
  // performance.now() companion of recStart, so the offline PCM's wall-clock zero
  // (stopAndGetPcm().startPerf) can be reference-aligned to the metronome grid — the
  // two live in DIFFERENT AudioContext clocks, and performance.now() is their bridge.
  const recStartPerfRef = useRef(0)
  // Grid anchor captured at record start, so the offline pass can align onsets to
  // the beat grid the singer actually heard.
  const recBpmRef = useRef(bpm)
  // recPhaseRawRef = seconds from record-start to the next heard downbeat (metro-clock).
  // recPhaseRef    = that phase RE-REFERENCED to the PCM acoustic zero at stop (minus the
  //                  capture-startup delay Δ). Latency compensation + the user Timing
  //                  offset are layered on at ALIGN time (applyAnalysis), not baked here,
  //                  so nudging the offset re-aligns the last take without a re-record.
  const recPhaseRawRef = useRef(0)
  const recPhaseRef = useRef(0)
  // Whether the metronome was actually running when this take started. Grid
  // alignment is only meaningful when the singer sang to a click — see
  // conditionalGridAlign. (Ref, not state, so the deps-[] stopRecording reads it.)
  const recMetroOnRef = useRef(false)
  const rawEvents = useRef<RecNote[]>([])
  const curEvent = useRef<{ startSec: number; midi: number; velocity: number } | null>(null)
  const liveMidi = useRef<number | null>(null)

  // ── Live recording visualization (scrolling pitch + beat grid) ────────────────
  // onPitch pushes each detector frame {absolute-ctx-time, fractional MIDI incl. cents |
  // null when unvoiced} into pitchTrailRef; the RAF canvas loop (effect below, keyed on
  // recording) reads + prunes it, scrolls it right→left with a playhead at the right edge,
  // auto-centers Y on the recent sung pitch, and — when the metronome is ON — overlays beat
  // grid lines from the SAME metronome clock (metroNext/metroBeat/bpm, AudioContext time), so
  // the singer watches their pitch land on the beat. vizStatsRef mirrors draw stats for the
  // headless verify hook (proves the canvas draws + that beat lines appear with the metro on).
  const pitchTrailRef = useRef<Array<{ t: number; midi: number | null }>>([])
  const vizCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const vizRaf = useRef<number | null>(null)
  const vizYCenterRef = useRef<number | null>(null)   // smoothed Y-center (semitones) to steady the auto-range
  const vizStatsRef = useRef({ active: false, frames: 0, trailPoints: 0, gridLines: 0, metroOn: false, width: 0, height: 0 })

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
      __voiceAnalyzeBands?: typeof analyzeBands
      __voiceBuildPitchCurve?: typeof buildPitchCurve
      __voiceAlignToGrid?: typeof alignToGrid
      __voiceConditionalGridAlign?: typeof conditionalGridAlign
      __VoiceLivePitchDetector?: typeof LivePitchDetector
      __voiceSampleProbe?: (folder: string, midi: number) => Promise<unknown>
      __voiceGetSegmenter?: () => Segmenter
      __voiceGetTimingOffsetMs?: () => number
      __voiceGetVizState?: () => typeof vizStatsRef.current
    }
    // Report the live-recording viz draw stats so a headless page can confirm the canvas is
    // drawing (frames advancing, trail points) and that beat lines appear with the metro on.
    w.__voiceGetVizState = () => ({ ...vizStatsRef.current })
    // Report the current in-app segmenter choice so a headless page can confirm the
    // toggle's persisted default and that flipping it takes effect.
    w.__voiceGetSegmenter = () => segmenterRef.current
    // Report the live Timing-offset (ms) so a headless page can confirm the persisted
    // default / auto estimate and that changing it takes effect.
    w.__voiceGetTimingOffsetMs = () => timingOffsetRef.current
    w.__voiceBackfill = notesFromBuffer
    w.__voiceBackfillAsync = notesFromBufferAsync
    w.__voiceAnalyzeBuffer = analyzeBuffer
    w.__voiceAnalyzeBufferAsync = analyzeBufferAsync
    // Multi-band "Detect EQ" analysis — split into bands, score by perceptual loudness ×
    // clarity, pick the dominant band. Lets a headless page assert 4 bands + a winner.
    w.__voiceAnalyzeBands = analyzeBands
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
      delete w.__voiceAnalyzeBands
      delete w.__voiceBuildPitchCurve; delete w.__voiceAlignToGrid
      delete w.__voiceConditionalGridAlign; delete w.__VoiceLivePitchDetector
      delete w.__voiceSampleProbe; delete w.__voiceGetSegmenter
      delete w.__voiceGetTimingOffsetMs; delete w.__voiceGetVizState
    }
  }, [])

  // Restore the persisted "Show detected pitch" debug preference (off by default).
  useEffect(() => {
    try { setShowDebug(localStorage.getItem(DEBUG_KEY) === '1') } catch { /* ignore */ }
  }, [])

  // Restore the persisted editor grid-snap preference (ON by default — only an
  // explicit '0' turns it off, so first-run keeps the current snapping behavior).
  useEffect(() => {
    try { setEditorSnap(localStorage.getItem(EDITOR_SNAP_KEY) !== '0') } catch { /* ignore */ }
  }, [])

  // Restore the persisted note-segmenter choice (default = the code default 'hmm').
  useEffect(() => {
    try {
      const s = localStorage.getItem(SEGMENTER_KEY)
      if (s === 'onset' || s === 'hmm') { setSegmenter(s); segmenterRef.current = s }
    } catch { /* ignore */ }
  }, [])

  // Restore the persisted EQ pitch-source choice (default = 'full', full-signal detection).
  useEffect(() => {
    try {
      const s = localStorage.getItem(PITCH_SOURCE_KEY)
      if (s === 'full' || s === 'eq') { setPitchSource(s); pitchSourceRef.current = s }
    } catch { /* ignore */ }
  }, [])

  // Restore the persisted Timing offset. If none is saved, the auto estimate is applied
  // once a context exists (see ensureCtx); a saved value marks the dial user-set so the
  // auto default never clobbers it.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(TIMING_OFFSET_KEY)
      if (raw !== null) {
        const v = parseFloat(raw)
        if (Number.isFinite(v)) {
          const c = clamp(Math.round(v), TIMING_OFFSET_MIN, TIMING_OFFSET_MAX)
          setTimingOffsetMs(c); timingOffsetRef.current = c
          timingUserSetRef.current = true; autoAppliedRef.current = true
        }
      }
    } catch { /* ignore */ }
  }, [])
  const toggleEditorSnap = useCallback(() => {
    setEditorSnap(v => {
      const next = !v
      try { localStorage.setItem(EDITOR_SNAP_KEY, next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
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
  useEffect(() => { refinedRawTakeRef.current = refinedRawTake }, [refinedRawTake])
  useEffect(() => { takeSourceRef.current = takeSource }, [takeSource])

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

  // The notes shown/played: raw take → optional scale-snap (autotune for notes) → optional grid quantize.
  const displayNotes = useMemo(() => {
    let ns = pitchScale === 'chromatic' ? rawNotes : snapNotesToScale(rawNotes, pitchKey, pitchScale)
    if (quantized) ns = quantizeNotes(ns, bpm, division)
    return ns
  }, [rawNotes, quantized, bpm, division, pitchKey, pitchScale])

  // Surface the final notes to an embedding host (Firefly). No-op on the standalone page.
  useEffect(() => { onNotes?.(displayNotes, bpm) }, [displayNotes, bpm, onNotes])

  // Restore a saved take (Firefly "open sketch"): set it as the current refined take + tempo.
  const restoreNonce = restore?.nonce
  useEffect(() => {
    if (!restore) return
    const ns = restore.notes ?? []
    setBpm(restore.bpm)
    setRawNotes(ns)
    setRefinedTake(ns.length ? ns : null)
    setRefinedRawTake(ns.length ? ns : null)
    setDetected(ns)
    setLiveTake(ns.length ? ns : null)
    setTakeSource(ns.length ? 'refined' : 'live')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoreNonce])

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
    // Seed the Timing-offset dial with the auto latency estimate the first time a real
    // context (with outputLatency) exists — but only if the user hasn't set it and nothing
    // was persisted, so an explicit choice is never overwritten.
    if (!timingUserSetRef.current && !autoAppliedRef.current) {
      autoAppliedRef.current = true
      const est = clamp(autoLatencyMs(ctxRef.current), TIMING_OFFSET_MIN, TIMING_OFFSET_MAX)
      timingOffsetRef.current = est
      setTimingOffsetMs(est)
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

  // ── Live recording viz: RAF canvas loop (scrolling pitch + beat grid) ─────────
  // Runs ONLY while recording; re-created when the metronome toggles (so beat lines
  // appear/disappear live). Cancels its RAF on teardown. Draws in CSS-pixel space (DPR-scaled
  // backing store) at ~60fps: background, beat/plain time grid, the fading pitch trail, and a
  // bright dot + playhead at the right edge.
  useEffect(() => {
    if (!recording) return
    const canvas = vizCanvasRef.current
    if (!canvas) return
    const DPR = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1)
    const WINDOW_SEC = 4                     // visible time span (past … now at the right edge)
    // Theme-consistent colours pulled from the app's CSS custom properties (canvas can't use
    // var() directly). Custom props inherit onto the canvas, so getComputedStyle reads them.
    const cs = getComputedStyle(canvas)
    const cvar = (name: string, fallback: string) => (cs.getPropertyValue(name).trim() || fallback)
    const COL_BG     = cvar('--bg-base', '#0e0e14')
    const COL_ACCENT = cvar('--accent', '#7c3aed')
    const COL_TRAIL  = '#a78bfa'
    const COL_DOT    = '#e9d5ff'
    let frameCount = vizStatsRef.current.frames

    const draw = () => {
      const c = ctxRef.current
      const g = canvas.getContext('2d')
      if (!g || !c) { vizRaf.current = requestAnimationFrame(draw); return }
      const cssW = canvas.clientWidth || 480
      const cssH = canvas.clientHeight || 150
      const pxW = Math.max(1, Math.round(cssW * DPR)), pxH = Math.max(1, Math.round(cssH * DPR))
      if (canvas.width !== pxW || canvas.height !== pxH) { canvas.width = pxW; canvas.height = pxH }
      g.setTransform(DPR, 0, 0, DPR, 0, 0)

      const nowT = c.currentTime
      const t0   = nowT - WINDOW_SEC
      const timeToX = (t: number) => cssW - ((nowT - t) / WINDOW_SEC) * cssW

      // Background.
      g.clearRect(0, 0, cssW, cssH)
      g.fillStyle = COL_BG
      g.fillRect(0, 0, cssW, cssH)

      // Prune trail to a little past the window; gather the recent voiced pitches for auto-range.
      const trail = pitchTrailRef.current
      while (trail.length > 2 && trail[0].t < t0 - 0.5) trail.shift()
      let lo = Infinity, hi = -Infinity
      for (const p of trail) {
        if (p.midi === null || p.t < t0) continue
        if (p.midi < lo) lo = p.midi
        if (p.midi > hi) hi = p.midi
      }
      // Auto-center Y on the recent sung pitch with a few semitones of headroom; smoothed so
      // the range doesn't jitter frame-to-frame.
      const MIN_SPAN = 7                     // semitones visible (a few of headroom either side)
      let center: number
      if (lo <= hi) center = (lo + hi) / 2
      else center = vizYCenterRef.current ?? 64   // no voiced pitch yet → hold last / middle C-ish
      vizYCenterRef.current = vizYCenterRef.current === null ? center : vizYCenterRef.current + (center - vizYCenterRef.current) * 0.08
      const yc = vizYCenterRef.current
      const span = Math.max(MIN_SPAN, (lo <= hi ? hi - lo : 0) + 4)
      const pad = 10
      const midiToY = (m: number) => (cssH - pad) - ((m - (yc - span / 2)) / span) * (cssH - 2 * pad)

      // ── Grid ──────────────────────────────────────────────────────────────────
      let gridLines = 0
      const secPerBeat = 60 / bpmRef.current
      if (metroOn && Number.isFinite(secPerBeat) && secPerBeat > 0 && Number.isFinite(metroNext.current)) {
        // The AudioContext time of beat index 0 (stable across the take at constant BPM).
        const beat0 = metroNext.current - metroBeat.current * secPerBeat
        const six   = secPerBeat / 4                 // sixteenth-note step
        const nStart = Math.ceil((t0 - beat0) / six)
        const nEnd   = Math.floor((nowT - beat0) / six)
        for (let n = nStart; n <= nEnd && gridLines < 512; n++) {
          const t = beat0 + n * six
          const x = timeToX(t)
          const isBeat     = n % 4 === 0
          const isDownbeat = isBeat && ((n / 4) % BEATS_PER_BAR === 0)
          const isEighth   = n % 2 === 0 && !isBeat
          // strong on the beat (brightest on the downbeat), medium on eighths, faint on sixteenths.
          const alpha = isDownbeat ? 0.55 : isBeat ? 0.38 : isEighth ? 0.20 : 0.10
          const wdt   = isBeat ? 1.4 : isEighth ? 1 : 0.75
          g.strokeStyle = `rgba(148,163,184,${alpha})`
          g.lineWidth = wdt
          g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, cssH); g.stroke()
          gridLines++
        }
        // Pulse/highlight the CURRENT beat: a fading accent band that's freshest right at the beat.
        const curBeatIdx  = Math.floor((nowT - beat0) / secPerBeat)
        const curBeatTime = beat0 + curBeatIdx * secPerBeat
        const phaseInBeat = (nowT - curBeatTime) / secPerBeat     // 0 at the beat → 1 just before the next
        const pulse = Math.max(0, 1 - phaseInBeat)
        const bx = timeToX(curBeatTime)
        g.strokeStyle = COL_ACCENT
        g.globalAlpha = 0.25 + 0.6 * pulse
        g.lineWidth = 2.5
        g.beginPath(); g.moveTo(bx + 0.5, 0); g.lineTo(bx + 0.5, cssH); g.stroke()
        g.globalAlpha = 1
      } else {
        // Metronome OFF → a plain, evenly-spaced time grid (no beat semantics).
        const STEP = 0.5
        const nStart = Math.ceil(t0 / STEP)
        const nEnd   = Math.floor(nowT / STEP)
        g.strokeStyle = 'rgba(148,163,184,0.14)'
        g.lineWidth = 0.75
        for (let n = nStart; n <= nEnd; n++) {
          const x = timeToX(n * STEP)
          g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, cssH); g.stroke()
          gridLines++
        }
      }

      // ── Pitch trail (fading; broken across unvoiced gaps) + head dot ──────────
      let trailPoints = 0
      let prev: { t: number; midi: number } | null = null
      let lastVoiced: { t: number; midi: number } | null = null
      g.lineWidth = 2
      g.lineJoin = 'round'
      g.lineCap = 'round'
      for (const p of trail) {
        if (p.t < t0) { prev = null; continue }
        if (p.midi === null) { prev = null; continue }
        const x = timeToX(p.t), y = midiToY(p.midi)
        if (prev) {
          const age = (nowT - p.t) / WINDOW_SEC              // 0 (now) → 1 (window edge)
          g.strokeStyle = COL_TRAIL
          g.globalAlpha = Math.max(0.1, 1 - age * 0.85)      // older = fainter
          g.beginPath(); g.moveTo(timeToX(prev.t), midiToY(prev.midi)); g.lineTo(x, y); g.stroke()
        }
        prev = { t: p.t, midi: p.midi }
        lastVoiced = prev
        trailPoints++
      }
      g.globalAlpha = 1
      // Bright head dot at the most-recent voiced pitch.
      if (lastVoiced) {
        const x = timeToX(lastVoiced.t), y = midiToY(lastVoiced.midi)
        g.fillStyle = COL_DOT
        g.beginPath(); g.arc(x, y, 4.5, 0, Math.PI * 2); g.fill()
        g.fillStyle = COL_ACCENT
        g.beginPath(); g.arc(x, y, 2.2, 0, Math.PI * 2); g.fill()
      }
      // Playhead at the right edge (now).
      g.strokeStyle = 'rgba(249,115,22,0.7)'
      g.lineWidth = 1
      g.beginPath(); g.moveTo(cssW - 0.5, 0); g.lineTo(cssW - 0.5, cssH); g.stroke()

      vizStatsRef.current = { active: true, frames: ++frameCount, trailPoints, gridLines, metroOn, width: cssW, height: cssH }
      vizRaf.current = requestAnimationFrame(draw)
    }

    vizStatsRef.current.active = true
    vizRaf.current = requestAnimationFrame(draw)
    return () => {
      if (vizRaf.current) { cancelAnimationFrame(vizRaf.current); vizRaf.current = null }
      vizStatsRef.current.active = false
    }
  }, [recording, metroOn])

  // ── Mic → real-time instrument + note capture ────────────────────────────────
  const onPitch = useCallback((r: LivePitchResult | null) => {
    const c = ctxRef.current
    const preset = selRef.current
    if (!c || !preset) return
    const now = c.currentTime - recStart.current

    const voiced = r !== null && r.confidence >= widgetTrigGate(paramsRef.current.confidenceGate)
    // Feed the live scrolling viz on EVERY frame (not just note changes): absolute ctx time +
    // fractional MIDI (with cents), or null so unvoiced gaps break the trail.
    pitchTrailRef.current.push({ t: c.currentTime, midi: voiced && r ? r.midi + r.cents / 100 : null })
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
        setSensitivity(s); sensitivityRef.current = s; setParams(p); paramsRef.current = p
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
    sensitivityRef.current = clamped
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
    pitchTrailRef.current = []
    vizYCenterRef.current = null
    recStart.current = c.currentTime
    recStartPerfRef.current = (typeof performance !== 'undefined' ? performance.now() : Date.now())
    // ── Anchor the grid to this take ──────────────────────────────────────────
    // Freeze the tempo, and capture the beat phase so the offline pass can snap
    // onsets to the grid the singer heard. The raw (metro-clock) phase is finalized
    // in stopRecording, where it's re-referenced to the PCM acoustic zero.
    recBpmRef.current = bpmRef.current
    recPhaseRawRef.current = captureGridPhase(c.currentTime)
    recPhaseRef.current = recPhaseRawRef.current   // provisional until PCM-referenced at stop
    // Grid-align the offline take ONLY if a click was actually running (same check
    // captureGridPhase uses). Without it the phase is arbitrary and snapping would
    // displace onsets onto meaningless beat lines.
    recMetroOnRef.current = metroTimer.current !== null
    setTakeUsedMetro(recMetroOnRef.current)
    analysisCacheRef.current.clear()   // starting a new take discards the old take's cached analyses
    setRawNotes([])
    setQuantized(false)
    setLive(null)
    setDetected([])
    setEdited(false)
    setSelNote(null)
    setSaveMsg(null)
    setTakeGridAligned(false)
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
    setVolume(null)
    setPitchDelta(null)
    setRecovered(null)
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

  // ── Beat-informed detection grid ─────────────────────────────────────────────
  // The beatGrid PRIOR fed to the offline analysis — ONLY when the take was recorded to a
  // click (recMetroOn), so rubato takes are never forced to a grid. Uses the same take BPM +
  // PCM-referenced phase + Timing-offset the grid alignment uses, but at the 16th subdivision
  // (the detection grid) regardless of the coarser user Quantize division. Returns undefined
  // when the metronome was off / tempo is unusable → the analysis runs grid-free (unchanged).
  const beatGridForTake = useCallback((): { bpm: number; phaseSec: number; subdiv: number } | undefined => {
    if (!recMetroOnRef.current) return undefined
    const bpm = recBpmRef.current
    if (!(bpm > 0)) return undefined
    const phaseSec = recPhaseRef.current + timingOffsetRef.current / 1000
    return { bpm, phaseSec, subdiv: 4 }
  }, [])

  // Apply an offline analysis to the UI: stash the debug curves + grid anchor, then
  // grid-conditional-align the notes and set the take views. Shared by the initial refine
  // (stopRecording) and the segmenter-toggle re-analyze, so both render identically.
  const applyAnalysis = useCallback((analysis: BufferAnalysis, liveLen: number) => {
    setCurve(analysis.curve)
    setRawCurve(analysis.rawCurve)
    setOnsets(analysis.onsets ?? null)
    setFlux(analysis.flux ?? null)
    setClarity(analysis.clarity ?? null)
    setVolume(analysis.rms ?? null)
    setPitchDelta(analysis.pitchDelta ?? null)
    setRecovered(analysis.recovered ?? null)
    setTakeBpm(recBpmRef.current)
    // Compensated grid phase = PCM-referenced beat phase + latency/user Timing offset.
    // Layered on HERE (not baked at record) so the Timing dial re-aligns without a re-record.
    const phaseSec = recPhaseRef.current + timingOffsetRef.current / 1000
    setTakePhase(phaseSec)
    const refinedRaw = analysis.notes
    const tag = segmenterRef.current === 'hmm' ? 'HMM' : 'Onset'
    if (refinedRaw.length > 0) {
      const { refined, rawRefined, aligned } = conditionalGridAlign(
        refinedRaw,
        recMetroOnRef.current,
        { bpm: recBpmRef.current, phaseSec, division: divisionRef.current },
      )
      setRefinedRawTake(rawRefined)
      setRefinedTake(refined)
      setRawNotes(refined)
      setTakeSource('refined')
      // The refined transcription is the detected baseline for a correction.
      setDetected(refined)
      setEdited(false)
      setSelNote(null)
      setSaveMsg(null)
      setTakeGridAligned(aligned)
      setRefineMsg(`Refined · ${tag} — ${refined.length} note${refined.length === 1 ? '' : 's'}${aligned ? ', grid-aligned' : ''}`)
    } else {
      setRefinedRawTake(null)
      setRefinedTake(null)
      setRefineMsg(liveLen > 0 ? `Kept live take — ${tag} refine found no clear notes` : 'No pitched notes found')
    }
  }, [])

  // A cache key over the inputs that change the offline analysis (segmenter × pitch-source ×
  // sensitivity × gain/gate × grid prior). Grid DIVISION and the Timing-offset dial are applied
  // LATER in applyAnalysis (conditionalGridAlign), so they're deliberately NOT part of the key.
  const analysisKey = useCallback((seg: Segmenter, src: PitchSource): string => {
    const pr = paramsRef.current
    const g = beatGridForTake()
    return [seg, src, sensitivityRef.current, pr.gain, pr.rmsGate,
      g ? `${g.bpm.toFixed(2)}:${g.phaseSec.toFixed(4)}:${g.subdiv}` : 'nogrid'].join('|')
  }, [beatGridForTake])

  // Re-run the offline refine on the LAST take's stashed audio with the current segmenter +
  // pitch source, so flipping Tracker (HMM/onset) or "Use EQ band" compares them on the same
  // real performance. Served from the per-take cache when this exact combination was already
  // computed — flipping back is then INSTANT and never re-refines. Misses compute (with the
  // progress bar) and are stored until the take is replaced or cleared.
  const rerunSegmenter = useCallback(async () => {
    const audio = lastAudioRef.current
    if (!audio) return
    const key = analysisKey(segmenterRef.current, pitchSourceRef.current)
    const cached = analysisCacheRef.current.get(key)
    if (cached) { applyAnalysis(cached, liveTake?.length ?? 0); return }
    setRefining(true)
    setRefineProgress(0)
    setRefineMsg(null)
    try {
      const analysis = await analyzeBufferAsync(audio.samples, audio.sampleRate, {
        gain: paramsRef.current.gain,
        rmsGate: paramsRef.current.rmsGate,
        minDuration: minDurForSensitivity(sensitivityRef.current),
        sensitivity: sensitivityRef.current,
        segmenter: segmenterRef.current,
        pitchSource: pitchSourceRef.current,
        beatGrid: beatGridForTake(),
      }, setRefineProgress)
      analysisCacheRef.current.set(key, analysis)
      applyAnalysis(analysis, liveTake?.length ?? 0)
    } catch {
      setRefineMsg('Re-analyze failed')
    } finally {
      setRefining(false)
    }
  }, [applyAnalysis, liveTake, beatGridForTake, analysisKey])

  // Tracker toggle: persist the choice + mirror to the ref; re-analyze the last take on the
  // spot when its audio is available and we're not mid-record.
  const onSegmenterChange = useCallback((seg: Segmenter) => {
    setSegmenter(seg)
    segmenterRef.current = seg
    try { localStorage.setItem(SEGMENTER_KEY, seg) } catch { /* ignore */ }
    if (lastAudioRef.current && !recording && !refining) void rerunSegmenter()
  }, [recording, refining, rerunSegmenter])

  // "Use EQ band for detection" toggle: persist + mirror the ref, then re-run the refine on the
  // last take with the new pitch source (full-signal vs dominant band) — the same re-run the
  // Tracker toggle uses, so full-signal and EQ-band detection can be A/B'd on the same take.
  const onPitchSourceChange = useCallback((src: PitchSource) => {
    setPitchSource(src)
    pitchSourceRef.current = src
    try { localStorage.setItem(PITCH_SOURCE_KEY, src) } catch { /* ignore */ }
    if (lastAudioRef.current && !recording && !refining) void rerunSegmenter()
  }, [recording, refining, rerunSegmenter])

  // "Detect EQ": run the multi-band analysis on the last take's stashed audio and stash the
  // reading so the panel shows each band's perceptual loudness / clarity / pitch + the winner.
  const runDetectEq = useCallback(async () => {
    const audio = lastAudioRef.current
    if (!audio || detectingEq) return
    setDetectingEq(true)
    try {
      // Yield once so the button's disabled/pending state paints before the (sync) analysis.
      await new Promise<void>(r => setTimeout(r, 0))
      const bands = analyzeBands(audio.samples, audio.sampleRate, {
        gain: paramsRef.current.gain,
        rmsGate: paramsRef.current.rmsGate,
        sensitivity: sensitivityRef.current,
      })
      setBandsAnalysis(bands)
    } catch {
      setBandsAnalysis(null)
    } finally {
      setDetectingEq(false)
    }
  }, [detectingEq])

  // Re-align the LAST take's offline notes to the grid at the CURRENT compensated phase —
  // cheap (no pitch re-analysis), so the Timing-offset slider updates live while dragging.
  // Only meaningful when the take was recorded to a click (un-aligned offline notes exist).
  const realignLastTake = useCallback(() => {
    const raw = refinedRawTakeRef.current
    if (!raw || raw.length === 0 || !recMetroOnRef.current) return
    const phaseSec = recPhaseRef.current + timingOffsetRef.current / 1000
    const { refined } = conditionalGridAlign(
      raw, true, { bpm: recBpmRef.current, phaseSec, division: divisionRef.current },
    )
    setTakePhase(phaseSec)
    setRefinedTake(refined)
    // Reflect the re-alignment in the shown notes only when the Refined take is selected.
    if (takeSourceRef.current === 'refined') setRawNotes(refined)
  }, [])

  // Timing-offset dial: persist + mirror, then re-align the last take on the spot.
  const onTimingOffsetChange = useCallback((ms: number) => {
    const v = clamp(Math.round(ms), TIMING_OFFSET_MIN, TIMING_OFFSET_MAX)
    setTimingOffsetMs(v)
    timingOffsetRef.current = v
    timingUserSetRef.current = true
    autoAppliedRef.current = true
    try { localStorage.setItem(TIMING_OFFSET_KEY, String(v)) } catch { /* ignore */ }
    if (!recording && !refining) realignLastTake()
  }, [recording, refining, realignLastTake])

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
    // Fresh take → the live notes are the detected baseline; drop any prior edit state.
    setDetected(liveNotes)
    setEdited(false)
    setSelNote(null)
    setSaveMsg(null)
    setTakeGridAligned(false)
    setBandsAnalysis(null)   // stale — belongs to the previous take

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
      // Obtain the mono PCM to analyze: prefer lossless PCM, else decode the blob. We stash
      // it (lastAudioRef) so the Tracker toggle can re-analyze the SAME audio under the other
      // segmenter. The offline segmenter is chosen by segmenterRef (the in-app Tracker toggle).
      let src: { samples: Float32Array; sampleRate: number } | null = null
      const pcm = det.stopAndGetPcm()
      if (pcm && pcm.samples.length > 0) {
        det.stop()   // done with the mic; we already hold the lossless PCM
        // ── Reference-align the grid to the PCM acoustic zero ──────────────────
        // The metronome grid phase was captured in the metronome context, anchored to
        // record-start. The offline note times are relative to PCM sample 0, which the
        // capture context delivers Δ seconds later (mic/context startup). The heard beats
        // therefore sit Δ EARLIER in the PCM timeline, so subtract Δ. Bridge the two
        // AudioContext clocks via their performance.now() companions.
        if (typeof pcm.startPerf === 'number' && pcm.startPerf > 0 && recStartPerfRef.current > 0) {
          const delta = Math.max(0, (pcm.startPerf - recStartPerfRef.current) / 1000)
          recPhaseRef.current = recPhaseRawRef.current - delta
        }
        src = { samples: pcm.samples, sampleRate: pcm.sampleRate }
      } else {
        const blob = await det.stopAndGetAudio()
        if (!blob) {
          // Capture unavailable on this browser — keep the live take, no error.
          setRefineMsg('Live take — refine not supported in this browser')
          return
        }
        src = await decodeBlobToMono(blob)
      }
      lastAudioRef.current = src
      analysisCacheRef.current.clear()   // new take → drop the previous take's cached analyses
      // The ScriptProcessor / MediaRecorder tapped the PRE-gain source, so re-apply the
      // user's sensitivity gain + RMS gate offline. analyzeBufferAsync returns the notes AND
      // the pitch curves (raw + corrected) + onset/flux/clarity for the debug overlay.
      const analysis = await analyzeBufferAsync(src.samples, src.sampleRate, {
        gain: paramsRef.current.gain,
        rmsGate: paramsRef.current.rmsGate,
        minDuration: minDurForSensitivity(sensitivityRef.current),
        sensitivity: sensitivityRef.current,
        segmenter: segmenterRef.current,
        pitchSource: pitchSourceRef.current,
        beatGrid: beatGridForTake(),
      }, setRefineProgress)
      analysisCacheRef.current.set(analysisKey(segmenterRef.current, pitchSourceRef.current), analysis)
      // Grid-conditional align + set the take views + debug curves (shared with the toggle).
      applyAnalysis(analysis, liveNotes.length)
    } catch {
      setRefineMsg('Kept live take — refine failed')
    } finally {
      setRefining(false)
    }
  }, [applyAnalysis, beatGridForTake, analysisKey])

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
    // Switching take baselines the detected set to that take; edits start fresh.
    setDetected(notes)
    setEdited(false)
    setSelNote(null)
    setSaveMsg(null)
  }, [refinedTake, refinedRawTake, liveTake])

  // ── Manual edit + correction capture ─────────────────────────────────────────
  // A single write path for every hand-edit (drag/add/delete, or the headless hook):
  // the edited set becomes the CORRECTED notes, drives playback/export, and turns off
  // quantize (so what you see is exactly what you edited). Marks the take edited.
  const applyEdit = useCallback((next: RecNote[]) => {
    setRawNotes(next)
    setQuantized(false)
    setEdited(true)
    setSaveMsg(null)
  }, [])

  // Discard manual edits — restore the tracker's detected notes for this take.
  const resetToDetected = useCallback(() => {
    setRawNotes(detected)
    setQuantized(false)
    setEdited(false)
    setSelNote(null)
    setSaveMsg(null)
  }, [detected])

  // Delete the selected note.
  const deleteSelected = useCallback(() => {
    setSelNote(i => {
      if (i === null) return null
      setRawNotes(prev => { const n = prev.slice(); n.splice(i, 1); return n })
      setQuantized(false); setEdited(true); setSaveMsg(null)
      return null
    })
  }, [])

  // Build the per-frame acoustic evidence from the stored analysis curves — every
  // per-frame array is forced to `curve`'s length so the dataset is length-consistent.
  const buildEvidence = useCallback((): CorrectionEvidence => {
    const c = curve ?? []
    return {
      time:       c.map(f => f.time),
      midi:       c.map(f => frameMidi(f)),
      clarity:    c.map((_, i) => clarity?.[i]    ?? 0),
      flux:       c.map((_, i) => flux?.[i]       ?? 0),
      energy:     c.map((_, i) => volume?.[i]     ?? 0),
      pitchDelta: c.map((_, i) => pitchDelta?.[i] ?? 0),
      onsets:     onsets ?? [],
    }
  }, [curve, clarity, flux, volume, pitchDelta, onsets])

  // Build the current take into a CorrectionRecord (detected baseline + corrected
  // ground truth + evidence + 16 kHz audio + settings). Shared by the local Save
  // and the "Send to admin" paths. Includes the selected instrument in `settings`
  // so rendering feedback has context. Returns null when there's nothing to save.
  const buildCorrectionRecord = useCallback((): CorrectionRecord | null => {
    if (displayNotes.length === 0 && detected.length === 0) return null
    const toNote = (n: RecNote) => ({ startSec: n.startSec, midi: n.midi, durSec: n.durSec, velocity: n.velocity })
    const corrected = displayNotes.map(toNote)
    const det = detected.map(toNote)
    const diff = diffNotes(det, corrected)
    const audioSrc = lastAudioRef.current
    const audio = audioSrc
      ? encodeCorrectionAudio(audioSrc.samples, audioSrc.sampleRate)
      : { sampleRate: 0, samples: 0, durSec: 0, encoding: 'int16' as const, pcmBase64: '' }
    const sel = selRef.current
    return {
      id: `corr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ts: Date.now(),
      appVersion: CORRECTIONS_APP_VERSION,
      edited,
      detected: det,
      corrected,
      diff,
      evidence: buildEvidence(),
      audio,
      settings: {
        sensitivity, tracker: segmenter,
        key: pitchScale === 'chromatic' ? null : ROOT_NOTES[(((pitchKey % 12) + 12) % 12)],
        scale: pitchScale === 'chromatic' ? null : pitchScale,
        bpm, division, timingOffsetMs, gridAligned: takeGridAligned,
        instrument: sel ? `${sel.name} [${sel.id}]` : null,
      },
    }
  }, [displayNotes, detected, edited, buildEvidence, sensitivity, segmenter, bpm, division, timingOffsetMs, takeGridAligned, pitchKey, pitchScale])

  // Save the current take locally (IndexedDB) as a correction/training example.
  const doSaveCorrection = useCallback(async (): Promise<CorrectionRecord | null> => {
    const record = buildCorrectionRecord()
    if (!record) return null
    setSavingCorr(true)
    try {
      await saveCorrection(record)
      const all = await listCorrections()
      setSavedCount(all.length)
      setSaveSummary(summarizeCorrections(all))
      setSaveMsg(`Saved — ${describeDiff(record.diff)}`)
      return record
    } catch {
      setSaveMsg('Save failed')
      return null
    } finally {
      setSavingCorr(false)
    }
  }, [buildCorrectionRecord])

  // Send the current take to the admin store (public /api/voice-corrections), where
  // the owner comments on it and the AI reads the comments + data. Independent of
  // the local Save — this take doesn't need to be saved locally first.
  const doSendToAdmin = useCallback(async () => {
    const record = buildCorrectionRecord()
    if (!record) return
    setSendingAdmin(true); setSendMsg(null)
    try {
      const r = await fetch('/api/voice-corrections', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(record),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      setSendMsg('Sent to admin ✓')
    } catch (e) {
      setSendMsg(e instanceof Error ? `Send failed — ${e.message}` : 'Send failed')
    } finally {
      setSendingAdmin(false)
    }
  }, [buildCorrectionRecord])

  // Export the whole dataset as a downloaded JSON file.
  const doExportCorrections = useCallback(async () => {
    const blob = await exportCorrections()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `voicemidi-corrections-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }, [])

  // Clear the whole dataset (confirmed).
  const doClearCorrections = useCallback(async () => {
    if (typeof window !== 'undefined' && !window.confirm('Delete all saved corrections? This cannot be undone.')) return
    await clearCorrections()
    setSavedCount(0)
    setSaveSummary(null)
    setSaveMsg(null)
  }, [])

  // Load the saved-count + systematic summary once on mount.
  useEffect(() => {
    void listCorrections().then(all => { setSavedCount(all.length); setSaveSummary(summarizeCorrections(all)) }).catch(() => {})
  }, [])

  // ── Headless verify hook: window.__voiceCorrections (save/list/export/clear) ───
  // Also exposes edit helpers so a headless page can drive the full loop without the
  // pointer handlers. Reads latest state via a ref updated each render.
  const corrApiRef = useRef<{
    save: () => Promise<CorrectionRecord | null>
    applyEdit: (n: RecNote[]) => void
    getNotes: () => RecNote[]
    getDetected: () => RecNote[]
  }>({ save: async () => null, applyEdit: () => {}, getNotes: () => [], getDetected: () => [] })
  useEffect(() => {
    corrApiRef.current = {
      save: doSaveCorrection,
      applyEdit,
      getNotes: () => displayNotes,
      getDetected: () => detected,
    }
  })
  useEffect(() => {
    const w = window as unknown as { __voiceCorrections?: Record<string, unknown> }
    w.__voiceCorrections = {
      save:   () => corrApiRef.current.save(),
      list:   () => listCorrections(),
      count:  () => countCorrections(),
      export: () => exportCorrections(),
      clear:  () => clearCorrections(),
      // Edit helpers (drive the same write path as the pointer handlers).
      applyEdit:   (n: RecNote[]) => corrApiRef.current.applyEdit(n),
      getNotes:    () => corrApiRef.current.getNotes(),
      getDetected: () => corrApiRef.current.getDetected(),
    }
    return () => { delete w.__voiceCorrections }
  }, [])

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
    if (vizRaf.current) cancelAnimationFrame(vizRaf.current)
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
          data-tour="instrument"
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

        {/* Timing offset — latency-compensation dial. Only relevant once a click is/was
            used: shifts the beat grid so sung notes land on the beats they were heard on.
            Persisted; re-aligns the last take live as it's nudged. */}
        {(metroOn || takeUsedMetro) && (
          <div style={{ marginTop: 12 }} data-testid="vm-timing-offset-control">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 84, flexShrink: 0, fontSize: 10.5, color: 'var(--text-muted)', letterSpacing: '0.07em', textTransform: 'uppercase' }}>
                Timing offset
              </span>
              <input
                type="range"
                min={TIMING_OFFSET_MIN} max={TIMING_OFFSET_MAX} step={1}
                value={timingOffsetMs}
                onChange={e => onTimingOffsetChange(parseFloat(e.target.value))}
                aria-label="Timing offset in milliseconds"
                data-testid="vm-timing-offset-slider"
                style={{ flex: 1, accentColor: 'var(--accent)', cursor: 'pointer' }}
              />
              <input
                type="number"
                min={TIMING_OFFSET_MIN} max={TIMING_OFFSET_MAX} step={1}
                value={timingOffsetMs}
                onChange={e => onTimingOffsetChange(parseFloat(e.target.value))}
                aria-label="Timing offset in milliseconds (number)"
                data-testid="vm-timing-offset-number"
                style={{
                  width: 56, fontSize: 13, fontWeight: 700, textAlign: 'center', padding: '5px 4px',
                  background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 8,
                  color: 'var(--text-primary)', outline: 'none', fontVariantNumeric: 'tabular-nums',
                }}
              />
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>ms</span>
            </div>
            <p style={{ fontSize: 10.5, color: 'var(--text-muted)', margin: '4px 0 0' }}>
              Nudge if your sung notes land just off the click — accounts for your device&apos;s audio latency.
            </p>
          </div>
        )}
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
          data-testid="vm-record"
          data-tour="record"
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
        {/* Live scrolling pitch + beat-grid viz (recording only). Watch your pitch land on the
            beat lines when the metronome is on. RAF-driven; torn down on stop. */}
        {recording && (
          <div style={{ marginTop: 10 }} data-testid="vm-live-viz-wrap">
            <canvas
              ref={vizCanvasRef}
              data-testid="vm-live-viz"
              aria-label="Live pitch and beat visualization"
              style={{ width: '100%', height: 150, display: 'block', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-base)' }}
            />
            <p style={{ fontSize: 10.5, color: 'var(--text-muted)', margin: '5px 0 0' }}>
              {metroOn ? 'Sing so your pitch lands on the beat lines.' : 'Your pitch, scrolling in time — turn on the metronome to see the beat grid.'}
            </p>
          </div>
        )}
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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
            {/* Tracker (note segmenter) A/B toggle — re-runs the refine on the last take. */}
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)' }}
              title="Note segmenter used by the offline refine. HMM = note-level Viterbi tracker (default, best on vibrato/noisy pitch); Onset = onset-aware segmenter. Flipping re-analyzes the last take."
            >
              <span style={{ letterSpacing: '0.06em', textTransform: 'uppercase' }}>Tracker</span>
              <div style={{ display: 'flex', gap: 3, padding: 2, borderRadius: 7, border: '1px solid var(--border)' }}>
                {(['hmm', 'onset'] as Segmenter[]).map(s => (
                  <button
                    key={s}
                    onClick={() => onSegmenterChange(s)}
                    disabled={refining}
                    data-testid={`vm-tracker-${s}`}
                    aria-pressed={segmenter === s}
                    style={{
                      padding: '4px 9px', borderRadius: 5, fontSize: 11, fontWeight: 700,
                      cursor: refining ? 'default' : 'pointer', border: 'none',
                      background: segmenter === s ? 'var(--accent)' : 'transparent',
                      color: segmenter === s ? '#fff' : 'var(--text-muted)',
                    }}
                  >{s === 'hmm' ? 'HMM' : 'Onset'}</button>
                ))}
              </div>
            </div>
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

          {/* ── Detect EQ: multi-band pitch source ──────────────────────────────────
              A "Detect EQ" button runs analyzeBands on the last take and shows each band's
              perceptual-loudness bar / clarity / detected pitch with the WINNER highlighted;
              the toggle re-runs the refine with the dominant band as the pitch source. */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
            <button
              onClick={() => void runDetectEq()}
              disabled={detectingEq || refining || !lastAudioRef.current}
              data-testid="vm-detect-eq"
              title="Split the take into frequency bands and show which band's pitch is most trustworthy (loudness × clarity). Isolating the fundamental's band de-confuses octave errors."
              style={{
                padding: '5px 11px', borderRadius: 7, fontSize: 11.5, fontWeight: 700,
                border: '1px solid var(--border)',
                background: 'var(--bg-elevated, transparent)', color: 'var(--text-secondary)',
                cursor: (detectingEq || refining || !lastAudioRef.current) ? 'default' : 'pointer',
                opacity: (refining || !lastAudioRef.current) ? 0.5 : 1,
              }}
            >{detectingEq ? 'Detecting EQ…' : 'Detect EQ'}</button>
            <label
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)', cursor: refining ? 'default' : 'pointer', userSelect: 'none' }}
              title="Detect pitch from the dominant frequency band (loudness × clarity) instead of the full signal. Isolating the fundamental's band fixes octave errors from harmonics + breath noise. Re-analyzes the last take."
            >
              <input
                type="checkbox"
                checked={pitchSource === 'eq'}
                onChange={e => onPitchSourceChange(e.target.checked ? 'eq' : 'full')}
                disabled={refining}
                aria-label="Use EQ band for detection"
                data-testid="vm-pitch-source-eq"
                style={{ accentColor: 'var(--accent)', cursor: refining ? 'default' : 'pointer' }}
              />
              Use EQ band for detection
            </label>
          </div>

          {bandsAnalysis && (
            <div
              data-testid="vm-eq-panel"
              style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', marginBottom: 10, background: 'var(--bg-base)' }}
            >
              <div style={{ fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>
                Detect EQ — dominant band = perceptual loudness × clarity
              </div>
              {(() => {
                const maxLoud = Math.max(1e-9, ...bandsAnalysis.bands.map(b => b.perceptualLoudness))
                return bandsAnalysis.bands.map(b => {
                  const won  = b.name === bandsAnalysis.winner
                  const midi = bandDisplayMidi(b.pitchTrack)
                  return (
                    <div
                      key={b.name}
                      data-testid={`vm-eq-band-${b.name}`}
                      data-eq-winner={won ? '1' : '0'}
                      style={{
                        display: 'grid', gridTemplateColumns: '92px 1fr 62px 58px', alignItems: 'center', gap: 8,
                        padding: '4px 6px', borderRadius: 6, marginBottom: 3,
                        background: won ? 'rgba(124,58,237,0.16)' : 'transparent',
                        border: won ? '1px solid var(--accent)' : '1px solid transparent',
                      }}
                    >
                      <span style={{ fontSize: 11, fontWeight: won ? 700 : 500, color: won ? 'var(--accent-light)' : 'var(--text-secondary)' }}>
                        {b.name}
                        <span style={{ fontSize: 9, color: 'var(--text-muted)', marginLeft: 4 }}>{b.loFreq}–{b.hiFreq}Hz</span>
                        {won && <span style={{ fontSize: 9, marginLeft: 4 }}>◄ won</span>}
                      </span>
                      {/* Perceptual loudness bar (A-weighted band RMS, relative to the loudest band). */}
                      <span style={{ position: 'relative', height: 10, borderRadius: 5, background: 'var(--bg-elevated, rgba(127,127,127,0.15))', overflow: 'hidden' }}>
                        <span style={{
                          position: 'absolute', left: 0, top: 0, bottom: 0,
                          width: `${Math.round((b.perceptualLoudness / maxLoud) * 100)}%`,
                          background: won ? 'var(--accent)' : 'var(--text-muted)', borderRadius: 5,
                        }} />
                      </span>
                      <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }} title="Mean YIN clarity in this band">
                        clr {b.meanClarity.toFixed(2)}
                      </span>
                      <span style={{ fontSize: 10.5, color: 'var(--text-secondary)', textAlign: 'right' }} title="Median detected pitch in this band">
                        {midi !== null ? midiNoteLabel(midi) : '—'}
                      </span>
                    </div>
                  )
                })
              })()}
              <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '6px 0 0' }}>
                {pitchSource === 'eq'
                  ? 'Detection is using the dominant band above.'
                  : 'Turn on “Use EQ band for detection” to transcribe from the winning band.'}
              </p>
            </div>
          )}

          <NoteStrip
            notes={displayNotes}
            playhead={playhead}
            editable
            selected={selNote}
            onSelect={setSelNote}
            onNotesChange={applyEdit}
            onDeleteSelected={deleteSelected}
            snapBpm={bpm}
            snapDivision={division}
            snapEnabled={editorSnap}
            debug={showDebug && curve && curve.length > 0
              ? { curve, rawCurve: rawCurve ?? [], bpm: takeBpm ?? recBpmRef.current, phaseSec: takePhase, division,
                  onsets: onsets ?? [], flux: flux ?? [], clarity: clarity ?? [],
                  volume: volume ?? [], pitchDelta: pitchDelta ?? [], recovered: recovered ?? [] }
              : null}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '6px 0 0' }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Drag a note to fix pitch/timing · double-click empty space to add · Delete removes the selected note.
            </span>
            {edited && (
              <span data-testid="vm-edited-badge" style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--accent-light)', background: 'rgba(124,58,237,0.15)', border: '1px solid var(--accent)', borderRadius: 6, padding: '2px 7px' }}>
                edited
              </span>
            )}
            <label
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}
              title="Snap manual edits to the grid step. Off = drag/place notes freely (continuous timing); pitch still snaps to semitones."
            >
              <input
                type="checkbox"
                checked={editorSnap}
                onChange={toggleEditorSnap}
                aria-label="Snap manual edits to grid"
                data-testid="vm-editor-snap"
                style={{ accentColor: 'var(--accent)', cursor: 'pointer' }}
              />
              Snap
            </label>
            {selNote !== null && (
              <button
                onClick={deleteSelected}
                data-testid="vm-delete-note"
                style={{ fontSize: 11, fontWeight: 700, color: '#ef4444', background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 9px', cursor: 'pointer' }}
                title="Delete the selected note"
              >✕ Delete note</button>
            )}
            {edited && (
              <button
                onClick={resetToDetected}
                data-testid="vm-reset-detected"
                style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 9px', cursor: 'pointer' }}
                title="Discard your edits and restore the detected notes"
              >↺ Reset to detected</button>
            )}
          </div>
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

            {/* Pitch correction — snap detected notes to a key + scale (autotune, for notes) */}
            <div
              style={{ display: 'flex', gap: 4, alignItems: 'center', padding: 3, borderRadius: 9, border: '1px solid var(--border)' }}
              title="Snap detected notes to a musical key + scale — like autotune, for the notes. Your raw take is kept."
            >
              <select
                value={pitchKey}
                onChange={e => setPitchKey(Number(e.target.value))}
                disabled={pitchScale === 'chromatic'}
                aria-label="Key"
                style={{
                  padding: '6px 6px', borderRadius: 6, fontSize: 12, fontWeight: 700,
                  cursor: pitchScale === 'chromatic' ? 'default' : 'pointer', border: 'none', background: 'transparent',
                  color: 'var(--text-secondary)', opacity: pitchScale === 'chromatic' ? 0.45 : 1,
                }}
              >
                {ROOT_NOTES.map((r, i) => <option key={r} value={i}>{r}</option>)}
              </select>
              <select
                value={pitchScale}
                onChange={e => setPitchScale(e.target.value as ScaleType)}
                aria-label="Scale"
                title="Scale to snap detected notes into"
                style={{
                  padding: '6px 8px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: 'none',
                  background: pitchScale !== 'chromatic' ? 'var(--accent)' : 'transparent',
                  color: pitchScale !== 'chromatic' ? '#fff' : 'var(--text-muted)',
                }}
              >
                <option value="chromatic">Pitch: Off</option>
                {(Object.keys(SCALE_LABELS) as ScaleType[]).filter(s => s !== 'chromatic').map(s => (
                  <option key={s} value={s}>{SCALE_LABELS[s]}</option>
                ))}
              </select>
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>
              {displayNotes.length} note{displayNotes.length === 1 ? '' : 's'}
            </span>
          </div>

          {/* ── Correction / learning capture ──────────────────────────────────────
              Save this fixed take as a training example (detected + corrected + evidence
              + 16 kHz audio + settings), then export the dataset for offline tuning. */}
          <div style={{ borderTop: '1px solid var(--border)', marginTop: 16, paddingTop: 14 }} data-testid="vm-corrections-panel">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <button
                onClick={() => void doSaveCorrection()}
                disabled={savingCorr || !hasTake}
                data-testid="vm-save-correction"
                style={{
                  padding: '8px 16px', borderRadius: 8, fontSize: 12.5, fontWeight: 700,
                  cursor: savingCorr || !hasTake ? 'default' : 'pointer', opacity: savingCorr || !hasTake ? 0.6 : 1,
                  border: 'none', background: 'var(--accent)', color: '#fff',
                }}
                title="Save your fix as a training example the detector can be tuned/trained against"
              >
                {savingCorr ? 'Saving…' : edited ? '✔ Save correction' : '✔ Save (confirm detection)'}
              </button>
              <button
                onClick={() => void doExportCorrections()}
                disabled={savedCount === 0}
                data-testid="vm-export-corrections"
                style={{
                  padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                  cursor: savedCount === 0 ? 'default' : 'pointer', opacity: savedCount === 0 ? 0.5 : 1,
                  border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)',
                }}
                title="Download every saved correction as a JSON dataset"
              >⭳ Export</button>
              <button
                onClick={() => void doClearCorrections()}
                disabled={savedCount === 0}
                data-testid="vm-clear-corrections"
                style={{
                  padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                  cursor: savedCount === 0 ? 'default' : 'pointer', opacity: savedCount === 0 ? 0.5 : 1,
                  border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)',
                }}
                title="Delete every saved correction"
              >Clear</button>
              <button
                onClick={() => void doSendToAdmin()}
                disabled={sendingAdmin || !hasTake}
                data-testid="vm-send-admin"
                style={{
                  padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                  cursor: sendingAdmin || !hasTake ? 'default' : 'pointer', opacity: sendingAdmin || !hasTake ? 0.5 : 1,
                  border: '1px solid var(--accent)', background: 'transparent', color: 'var(--accent-light)',
                }}
                title="Send this correction to the admin so it can be reviewed and the detector tuned"
              >{sendingAdmin ? 'Sending…' : '➦ Send to admin'}</button>
              <span data-testid="vm-corrections-count" style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>
                {savedCount} correction{savedCount === 1 ? '' : 's'} saved
              </span>
            </div>
            {saveMsg && (
              <p data-testid="vm-save-msg" style={{ fontSize: 11.5, color: 'var(--accent-light)', margin: '8px 0 0' }}>{saveMsg}</p>
            )}
            {sendMsg && (
              <p data-testid="vm-send-msg" style={{ fontSize: 11.5, color: sendMsg.includes('✓') ? '#34d399' : '#f59e0b', margin: '6px 0 0' }}>{sendMsg}</p>
            )}
            {saveSummary && saveSummary.count > 0 && (
              (() => {
                const s = saveSummary
                const bits: string[] = []
                if (s.octaveErrors)    bits.push(`${s.octaveErrors} octave error${s.octaveErrors === 1 ? '' : 's'}`)
                if (s.otherPitchFixes) bits.push(`${s.otherPitchFixes} other pitch fix${s.otherPitchFixes === 1 ? '' : 'es'}`)
                if (s.added)           bits.push(`${s.added} missed (added)`)
                if (s.removed)         bits.push(`${s.removed} spurious (removed)`)
                if (s.timingFixes)     bits.push(`${s.timingFixes} timing fix${s.timingFixes === 1 ? '' : 'es'}`)
                return (
                  <p data-testid="vm-corrections-summary" style={{ fontSize: 10.5, color: 'var(--text-muted)', margin: '5px 0 0' }}>
                    Across {s.count} correction{s.count === 1 ? '' : 's'}: {bits.length ? bits.join(' · ') : 'no systematic errors yet'}
                  </p>
                )
              })()
            )}
            <p style={{ fontSize: 10.5, color: 'var(--text-muted)', margin: '6px 0 0' }}>
              Saved locally in your browser (nothing uploaded). Export produces a JSON dataset for offline tuning.
            </p>
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
  volume:   number[]       // normalized RMS/volume envelope per curve frame (0–1)
  pitchDelta: number[]     // normalized pitch-change rate per curve frame (0–1)
  recovered: number[]      // start times (sec) of recovery-pass notes — marked distinctly
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
// Editable when `onNotesChange` is supplied: click to select, drag the body to move
// pitch+start, drag an end to resize, double-click empty space to add, Delete to remove.
function NoteStrip({
  notes, playhead, debug,
  editable, selected, onSelect, onNotesChange, onDeleteSelected, snapBpm, snapDivision, snapEnabled,
}: {
  notes: RecNote[]
  playhead: number | null
  debug?: DebugCurves | null
  editable?: boolean
  selected?: number | null
  onSelect?: (i: number | null) => void
  onNotesChange?: (notes: RecNote[]) => void
  onDeleteSelected?: () => void
  snapBpm?: number
  snapDivision?: number
  snapEnabled?: boolean
}) {
  const W = 100, H = 120 // viewBox units; scales to container width
  const svgRef = useRef<SVGSVGElement>(null)
  // Live geometry mirror so the window-level drag handlers read the latest transforms.
  const geomRef = useRef({ total: 1, loMidi: 0, span: 4, W, H })
  // Active drag: which note, which handle, and the note's pre-drag geometry.
  const dragRef = useRef<{ i: number; mode: 'move' | 'left' | 'right'; note: RecNote; startX: number; startY: number } | null>(null)
  if (notes.length === 0) return null
  const dbg = debug ?? null
  const canEdit = !!editable && !!onNotesChange

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

  // Keep the geometry mirror fresh for the window-level drag handlers below.
  geomRef.current = { total, loMidi, span, W, H }

  // ── Editing: screen → viewBox → (time, pitch) inversions + hit-test ───────────
  const gStep = (snapBpm && snapDivision) ? 60 / snapBpm / snapDivision : 0
  // Snap horizontal timing to the grid step only when enabled (default ON). When off,
  // starts/durations are continuous (still clamped ≥ 0). Pitch snapping is separate
  // (always semitone — see Math.round(yToMidi(...)) in the drag/add handlers).
  const snapOn = snapEnabled !== false && gStep > 0
  const snapT = (t: number) => (snapOn ? Math.round(t / gStep) * gStep : Math.max(0, t))
  const clientToVB = (clientX: number, clientY: number) => {
    const g = geomRef.current
    const r = svgRef.current?.getBoundingClientRect()
    if (!r || r.width === 0 || r.height === 0) return { x: 0, y: 0 }
    return { x: ((clientX - r.left) / r.width) * g.W, y: ((clientY - r.top) / r.height) * g.H }
  }
  const xToTime = (x: number) => (x / geomRef.current.W) * geomRef.current.total
  const yToMidi = (y: number) => {
    const g = geomRef.current
    return (g.loMidi - 1) + ((g.H - y) / g.H) * g.span
  }
  // Which note is under a viewBox point (topmost wins), and −1 for empty space.
  const hitTest = (vx: number, vy: number): number => {
    for (let i = notes.length - 1; i >= 0; i--) {
      const n = notes[i]
      const x = timeToX(n.startSec)
      const w = Math.max(0.8, (n.durSec / total) * W)
      const y = midiToY(n.midi)
      if (vx >= x - 0.6 && vx <= x + w + 0.6 && vy >= y - 6 && vy <= y + 6) return i
    }
    return -1
  }

  const onDrag = (e: PointerEvent) => {
    const d = dragRef.current
    if (!d || !onNotesChange) return
    const vb = clientToVB(e.clientX, e.clientY)
    const dt = xToTime(vb.x) - xToTime(d.startX)
    let next: RecNote
    if (d.mode === 'move') {
      const newMidi = Math.round(yToMidi(vb.y))
      const newStart = Math.max(0, snapT(d.note.startSec + dt))
      next = { ...d.note, startSec: newStart, midi: clamp(newMidi, 0, 127) }
    } else if (d.mode === 'right') {
      const minDur = gStep > 0 ? gStep : MIN_NOTE_DUR
      const newDur = Math.max(minDur, snapT(d.note.durSec + dt) || minDur)
      next = { ...d.note, durSec: newDur }
    } else {
      const end = d.note.startSec + d.note.durSec
      const minDur = gStep > 0 ? gStep : MIN_NOTE_DUR
      const newStart = clamp(snapT(d.note.startSec + dt), 0, end - minDur)
      next = { ...d.note, startSec: newStart, durSec: end - newStart }
    }
    const prev = notes[d.i]
    if (prev && prev.startSec === next.startSec && prev.durSec === next.durSec && prev.midi === next.midi) return
    const arr = notes.slice()
    arr[d.i] = next
    onNotesChange(arr)
  }
  const endDrag = () => {
    dragRef.current = null
    window.removeEventListener('pointermove', onDrag)
    window.removeEventListener('pointerup', endDrag)
  }
  const onPointerDown = (e: React.PointerEvent) => {
    if (!canEdit) return
    const vb = clientToVB(e.clientX, e.clientY)
    const i = hitTest(vb.x, vb.y)
    if (i < 0) { onSelect?.(null); return }
    onSelect?.(i)
    const n = notes[i]
    const x = timeToX(n.startSec)
    const w = Math.max(0.8, (n.durSec / total) * W)
    const endZone = Math.min(2, Math.max(0.8, w * 0.3))
    const mode: 'move' | 'left' | 'right' =
      vb.x <= x + endZone ? 'left' : vb.x >= x + w - endZone ? 'right' : 'move'
    dragRef.current = { i, mode, note: { ...n }, startX: vb.x, startY: vb.y }
    window.addEventListener('pointermove', onDrag)
    window.addEventListener('pointerup', endDrag)
  }
  const onDoubleClick = (e: React.MouseEvent) => {
    if (!canEdit) return
    const vb = clientToVB(e.clientX, e.clientY)
    if (hitTest(vb.x, vb.y) >= 0) return   // double-click on a note is not "add"
    const midi = clamp(Math.round(yToMidi(vb.y)), 0, 127)
    const startSec = Math.max(0, snapT(xToTime(vb.x)))
    const durSec = gStep > 0 ? Math.max(gStep, gStep * 2) : 0.25
    const arr = notes.slice()
    arr.push({ startSec, midi, durSec, velocity: 0.8 })
    onNotesChange?.(arr)
    onSelect?.(arr.length - 1)
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!canEdit) return
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected != null) {
      e.preventDefault()
      onDeleteSelected?.()
    }
  }

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
  // Recovery-pass note starts (voiced regions the tracker had dropped) — marked distinctly.
  const recoveredXs = dbg ? dbg.recovered.map(timeToX) : []
  // Contiguous VOICED spans (post-refine curve has a pitch) → faint shaded bands, so "why was
  // this kept/dropped" (voiced vs silence) is visible under every lane.
  const voicedSpans: Array<{ x0: number; x1: number }> = []
  if (dbg) {
    let runStart: number | null = null
    for (let i = 0; i < dbg.curve.length; i++) {
      const on = frameMidi(dbg.curve[i]) !== null
      if (on && runStart === null) runStart = dbg.curve[i].time
      else if (!on && runStart !== null) { voicedSpans.push({ x0: timeToX(runStart), x1: timeToX(dbg.curve[i].time) }); runStart = null }
    }
    if (runStart !== null) voicedSpans.push({ x0: timeToX(runStart), x1: timeToX(total) })
  }

  const C_RAW = '#60a5fa'        // raw (heard) — blue, dashed, faint
  const C_COR = '#22c55e'        // corrected — green, solid
  const C_GRID = 'var(--border)' // beat grid — subtle
  const C_ONSET = '#f43f5e'      // onset ticks — rose (distinct from grid/playhead/curves)
  const C_FLUX = '#a78bfa'       // flux envelope — violet
  const C_VOL = '#38bdf8'        // volume / RMS — sky
  const C_CLAR = '#f59e0b'       // clarity / confidence — amber
  const C_PITCHD = '#ec4899'     // pitch-change rate — pink
  const C_RECOV = '#14b8a6'      // recovered notes — teal
  const C_VOICED = '#22c55e'     // voiced shading — faint green band

  return (
    <div>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="none"
        data-testid="vm-note-strip"
        tabIndex={canEdit ? 0 : undefined}
        onPointerDown={canEdit ? onPointerDown : undefined}
        onDoubleClick={canEdit ? onDoubleClick : undefined}
        onKeyDown={canEdit ? onKeyDown : undefined}
        style={{ height: 130, background: 'var(--bg-base)', borderRadius: 10, border: '1px solid var(--border)', display: 'block', outline: 'none', cursor: canEdit ? 'crosshair' : 'default', touchAction: canEdit ? 'none' : undefined }}>
        {/* Transparent capture layer so empty-area clicks/double-clicks reach the svg
            handler even where no element is painted (edit hit-testing is coordinate-based). */}
        <rect x={0} y={0} width={W} height={H} fill="transparent" pointerEvents={canEdit ? 'all' : 'none'} />
        {/* Voiced shading (behind everything): faint green bands where the curve is voiced,
            so silence vs voiced is visible at a glance. */}
        {voicedSpans.map((s, i) => (
          <rect key={`v${i}`} data-testid="vm-voiced-band"
            x={s.x0} y={0} width={Math.max(0.2, s.x1 - s.x0)} height={H}
            fill={C_VOICED} opacity={0.06} pointerEvents="none" />
        ))}
        {/* Beat grid (behind everything) */}
        {gridXs.map((x, i) => (
          <line key={`g${i}`} data-testid="vm-grid-line"
            x1={x} y1={0} x2={x} y2={H} stroke={C_GRID} strokeWidth={0.5}
            strokeDasharray="2 2" opacity={0.7} vectorEffect="non-scaling-stroke" pointerEvents="none" />
        ))}
        {/* Notes (semi-transparent under the curves in debug). When editing, the selected
            note is highlighted with a brighter fill + outline. */}
        {notes.map((n, i) => {
          const x = (n.startSec / total) * W
          const w = Math.max(0.8, (n.durSec / total) * W)
          const y = midiToY(n.midi)
          const isSel = canEdit && selected === i
          return (
            <rect key={i} data-testid="vm-note-rect"
              x={x} y={y - 4} width={w} height={7} rx={1.5}
              fill={isSel ? '#f59e0b' : 'var(--accent)'}
              opacity={isSel ? 1 : noteOpacity}
              stroke={isSel ? '#fff' : undefined} strokeWidth={isSel ? 0.5 : undefined}
              vectorEffect={isSel ? 'non-scaling-stroke' : undefined}
              pointerEvents="none" />
          )
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
        {/* Recovered-note markers — a teal triangle at the top where the recovery pass
            re-added a note the tracker had dropped, so recovered notes are distinguishable. */}
        {recoveredXs.map((x, i) => (
          <polygon key={`rc${i}`} data-testid="vm-recovered-mark"
            points={`${x - 1.1},0 ${x + 1.1},0 ${x},2.6`} fill={C_RECOV} opacity={0.95} />
        ))}
        {playhead !== null && (
          <line
            x1={(playhead / total) * W} y1={0} x2={(playhead / total) * W} y2={H}
            stroke="#f97316" strokeWidth={0.6} vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>

      {/* ── Stacked evidence lanes (small multiples) — every OTHER signal the note decision
          uses, on the SAME time-X axis as the pitch plot above: volume/RMS, clarity, the
          onset-strength (flux) with onset ticks, and pitch-change rate. Faint voiced shading
          + onset ticks carry through so a dropped/kept note can be read against the signals. */}
      {dbg && (
        <div style={{ marginTop: 3, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <EvidenceLane label="Volume"  color={C_VOL}    values={dbg.volume}     times={dbg.curve} timeToX={timeToX} voicedSpans={voicedSpans} testid="vm-volume-lane" />
          <EvidenceLane label="Clarity" color={C_CLAR}   values={dbg.clarity}    times={dbg.curve} timeToX={timeToX} voicedSpans={voicedSpans} testid="vm-clarity-lane" />
          <EvidenceLane label="Flux"    color={C_FLUX}   values={dbg.flux}       times={dbg.curve} timeToX={timeToX} voicedSpans={voicedSpans} testid="vm-flux-lane"
            fade={dbg.clarity} onsetXs={onsetXs} onsetColor={C_ONSET} bars />
          <EvidenceLane label="Pitch Δ" color={C_PITCHD} values={dbg.pitchDelta} times={dbg.curve} timeToX={timeToX} voicedSpans={voicedSpans} testid="vm-pitchdelta-lane" onsetXs={onsetXs} onsetColor={C_ONSET} />
        </div>
      )}

      {/* Legend + take stats (debug only) */}
      {dbg && (
        <div data-testid="vm-debug-legend"
          style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginTop: 8, fontSize: 10.5, color: 'var(--text-muted)' }}>
          <LegendSwatch color={C_COR} label="corrected" />
          <LegendSwatch color={C_RAW} label="raw (heard)" dashed />
          <LegendSwatch color="var(--accent)" label="notes" solidBox />
          <LegendSwatch color={C_ONSET} label="onsets" />
          <LegendSwatch color={C_VOL} label="volume" solidBox />
          <LegendSwatch color={C_CLAR} label="clarity" solidBox />
          <LegendSwatch color={C_FLUX} label="flux" solidBox />
          <LegendSwatch color={C_PITCHD} label="pitch Δ" solidBox />
          <LegendSwatch color={C_RECOV} label="recovered" solidBox />
          <LegendSwatch color={C_GRID} label="beats" dashed />
          <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>
            {notes.length} note{notes.length === 1 ? '' : 's'} · {total.toFixed(1)}s · {Math.round(dbg.bpm)} BPM · {voicedRaw} voiced · {dbg.onsets.length} onset{dbg.onsets.length === 1 ? '' : 's'}{dbg.recovered.length ? ` · ${dbg.recovered.length} recovered` : ''}
          </span>
        </div>
      )}
    </div>
  )
}

// ── One thin labeled evidence lane ─────────────────────────────────────────────
// Draws a 0–1 signal (per curve frame) as a filled area — or clarity-faded bars — over the
// SAME time-X axis as the pitch plot, with faint voiced shading, an optional onset-tick
// overlay, a baseline gridline, and a corner label. Small-multiples building block.
function EvidenceLane({
  label, color, values, times, timeToX, voicedSpans, testid,
  onsetXs, onsetColor, fade, bars,
}: {
  label:       string
  color:       string
  values:      number[]
  times:       PitchFrame[]
  timeToX:     (t: number) => number
  voicedSpans: Array<{ x0: number; x1: number }>
  testid:      string
  onsetXs?:    number[]
  onsetColor?: string
  fade?:       number[]     // per-frame 0–1 opacity multiplier (clarity) — bars mode only
  bars?:       boolean      // draw discrete bars (flux) instead of a filled area
}) {
  const LH = 100
  const n = Math.min(values.length, times.length)
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
  const stride = Math.max(1, Math.ceil(Math.max(1, n) / 320))
  const bw = Math.max(0.25, (100 / Math.max(1, n)) * stride * 0.9)

  const barNodes: React.ReactNode[] = []
  let areaPts = ''
  if (bars) {
    for (let i = 0; i < n; i += stride) {
      const h = clamp01(values[i] ?? 0)
      if (h <= 0) continue
      const op = fade ? 0.25 + 0.65 * clamp01(fade[i] ?? 1) : 0.85
      const x = timeToX(times[i].time)
      barNodes.push(<rect key={`b${i}`} x={x - bw / 2} y={LH - h * LH} width={bw} height={h * LH} fill={color} opacity={op} />)
    }
  } else {
    const pts: string[] = []
    for (let i = 0; i < n; i += stride) {
      pts.push(`${timeToX(times[i].time).toFixed(2)},${(LH - clamp01(values[i] ?? 0) * LH).toFixed(2)}`)
    }
    if (pts.length > 0) areaPts = `${timeToX(times[0].time).toFixed(2)},${LH} ${pts.join(' ')} ${timeToX(times[Math.min(n - 1, times.length - 1)].time).toFixed(2)},${LH}`
  }

  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox="0 0 100 100" width="100%" preserveAspectRatio="none" data-testid={testid}
        style={{ height: 30, background: 'var(--bg-base)', borderRadius: 8, border: '1px solid var(--border)', display: 'block' }}>
        {/* faint voiced shading */}
        {voicedSpans.map((s, i) => (
          <rect key={`vs${i}`} x={s.x0} y={0} width={Math.max(0.2, s.x1 - s.x0)} height={100} fill="#22c55e" opacity={0.05} />
        ))}
        {/* faint mid gridline for reading amplitude */}
        <line x1={0} y1={50} x2={100} y2={50} stroke="var(--border)" strokeWidth={0.4} strokeDasharray="2 3" opacity={0.5} vectorEffect="non-scaling-stroke" />
        {bars
          ? barNodes
          : areaPts && <polygon points={areaPts} fill={color} opacity={0.22} stroke={color} strokeWidth={0.8} vectorEffect="non-scaling-stroke" />}
        {onsetXs?.map((x, i) => (
          <line key={`ol${i}`} x1={x} y1={0} x2={x} y2={100} stroke={onsetColor ?? '#f43f5e'} strokeWidth={0.9} opacity={0.8} vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <span style={{ position: 'absolute', top: 2, left: 5, fontSize: 8.5, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--text-muted)', pointerEvents: 'none', textTransform: 'uppercase', opacity: 0.85 }}>{label}</span>
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
