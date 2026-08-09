/**
 * voice-corrections — a tiny client-only IndexedDB store for VoiceMidi
 * human-in-the-loop CORRECTIONS (the training/tuning substrate).
 *
 * Each record is one "take" the user manually fixed: the tracker's DETECTED notes,
 * the user's CORRECTED notes (ground truth), the acoustic EVIDENCE (the per-frame
 * signals the debug graph shows), the take AUDIO (downsampled 16 kHz mono Int16,
 * base64 — compact but re-analyzable), and the detector SETTINGS in force. Together
 * these are enough to (a) re-run detection on the audio with different params and
 * compare to `corrected`, and (b) see systematic error types from the diffs.
 *
 * Pure client-side: no server, no login. Every export is SSR-guarded so the module
 * is safe to import into a server-rendered component (the functions no-op without
 * IndexedDB / window).
 *
 * DB `voicemidi-corrections`, one object store `corrections` keyed by `id`.
 */

import { resampleMono } from '@/lib/voice-backfill'

// App version stamped into each record (mirrors package.json "version").
export const CORRECTIONS_APP_VERSION = '0.5.0'
// Target rate for the archived audio — well above the vocal range, ~160 KB / 5 s.
export const CORRECTION_AUDIO_RATE = 16000

const DB_NAME = 'voicemidi-corrections'
const DB_VERSION = 1
const STORE = 'corrections'

// ── Record schema ──────────────────────────────────────────────────────────────
export interface CorrectionNote {
  startSec:  number
  midi:      number
  durSec:    number
  velocity:  number
}

/** Compact, human-scannable summary of detected → corrected. Counts only. */
export interface CorrectionDiff {
  pitchChanged:  number   // matched note whose pitch the user changed
  added:         number   // note the user added (detector missed / merged)
  removed:       number   // detected note the user deleted (spurious)
  timingChanged: number   // matched note whose start/duration the user moved
}

/** The per-frame acoustic evidence — the same signals the debug graph draws, all on
 *  the curve's time base (seconds from take start). This is what a model/tuner learns
 *  the observation from. Every per-frame array is length-consistent with `time`. */
export interface CorrectionEvidence {
  time:       number[]           // frame time (s)
  midi:       (number | null)[]  // fractional MIDI (with cents) per frame, null = unvoiced
  clarity:    number[]           // YIN clarity/confidence 0–1
  flux:       number[]           // onset-strength (spectral flux) 0–1
  energy:     number[]           // volume/RMS envelope 0–1
  pitchDelta: number[]           // |Δsemitone| rate 0–1
  onsets:     number[]           // detected onset times (s)
}

/** The take audio, downsampled + quantized so ground-truth is preserved but compact. */
export interface CorrectionAudio {
  sampleRate:  number   // actual rate after downsample (≤ CORRECTION_AUDIO_RATE)
  samples:     number   // sample count
  durSec:      number   // convenience: samples / sampleRate
  encoding:    'int16'  // PCM quantization
  pcmBase64:   string   // base64 of the little-endian Int16 PCM
}

export interface CorrectionSettings {
  sensitivity:    number
  tracker:        'hmm' | 'onset'
  key:            string | null   // reserved (VoiceMidi has no key picker yet)
  scale:          string | null   // reserved
  bpm:            number
  division:       number
  timingOffsetMs: number
  gridAligned:    boolean
  instrument?:    string | null   // selected preset ("<name> [<id>]") — rendering context
}

export interface CorrectionRecord {
  id:         string
  ts:         number
  appVersion: string
  edited:     boolean            // false when corrected == detected (a confirmation)
  detected:   CorrectionNote[]
  corrected:  CorrectionNote[]
  diff:       CorrectionDiff
  evidence:   CorrectionEvidence
  audio:      CorrectionAudio
  settings:   CorrectionSettings
}

// ── Diff (detected → corrected) ──────────────────────────────────────────────────
// Greedy nearest-start matching: each corrected note claims its closest unused
// detected note within a tolerance. Matched → pitch or timing change; unmatched
// corrected → added; leftover detected → removed. Deterministic + pure.
const START_TOL = 0.14     // s — a note counts as "the same note" within this
const START_MOVE = 0.03    // s — start moved beyond this ⇒ timingChanged
const DUR_MOVE = 0.05      // s — duration moved beyond this ⇒ timingChanged

export function diffNotes(detected: CorrectionNote[], corrected: CorrectionNote[]): CorrectionDiff {
  const used = new Set<number>()
  let pitchChanged = 0, added = 0, timingChanged = 0
  for (const c of corrected) {
    let best = -1, bestD = Infinity
    for (let i = 0; i < detected.length; i++) {
      if (used.has(i)) continue
      const d = Math.abs(detected[i].startSec - c.startSec)
      if (d < bestD) { bestD = d; best = i }
    }
    if (best >= 0 && bestD <= START_TOL) {
      used.add(best)
      const d = detected[best]
      if (d.midi !== c.midi) pitchChanged++
      else if (Math.abs(d.startSec - c.startSec) > START_MOVE || Math.abs(d.durSec - c.durSec) > DUR_MOVE) timingChanged++
    } else {
      added++
    }
  }
  return { pitchChanged, added, removed: detected.length - used.size, timingChanged }
}

/** A short human sentence for a single diff, e.g. "2 pitch fixes, 1 added, 1 removed". */
export function describeDiff(d: CorrectionDiff): string {
  const parts: string[] = []
  if (d.pitchChanged)  parts.push(`${d.pitchChanged} pitch fix${d.pitchChanged === 1 ? '' : 'es'}`)
  if (d.timingChanged) parts.push(`${d.timingChanged} timing fix${d.timingChanged === 1 ? '' : 'es'}`)
  if (d.added)         parts.push(`${d.added} added`)
  if (d.removed)       parts.push(`${d.removed} removed`)
  return parts.length ? parts.join(', ') : 'no changes (confirmed)'
}

// ── Systematic-error rollup (Part 3 nice-to-have) ────────────────────────────────
export interface CorrectionsSummary {
  count:           number
  octaveErrors:    number   // pitch fixes that were ~±12 semitones (octave slips)
  otherPitchFixes: number   // non-octave pitch fixes
  added:           number   // notes the detector missed / merged (user split-in)
  removed:         number   // spurious notes the detector invented
  timingFixes:     number
}

// Recompute a richer rollup from the stored detected/corrected pairs (so we can
// separate octave slips from other pitch fixes without bloating the per-record diff).
export function summarizeCorrections(records: CorrectionRecord[]): CorrectionsSummary {
  const s: CorrectionsSummary = { count: records.length, octaveErrors: 0, otherPitchFixes: 0, added: 0, removed: 0, timingFixes: 0 }
  for (const r of records) {
    const used = new Set<number>()
    for (const c of r.corrected) {
      let best = -1, bestD = Infinity
      for (let i = 0; i < r.detected.length; i++) {
        if (used.has(i)) continue
        const d = Math.abs(r.detected[i].startSec - c.startSec)
        if (d < bestD) { bestD = d; best = i }
      }
      if (best >= 0 && bestD <= START_TOL) {
        used.add(best)
        const d = r.detected[best]
        if (d.midi !== c.midi) {
          const delta = Math.abs(d.midi - c.midi)
          if (delta % 12 === 0) s.octaveErrors++
          else s.otherPitchFixes++
        } else if (Math.abs(d.startSec - c.startSec) > START_MOVE || Math.abs(d.durSec - c.durSec) > DUR_MOVE) {
          s.timingFixes++
        }
      } else {
        s.added++
      }
    }
    s.removed += r.detected.length - used.size
  }
  return s
}

// ── Audio (Float32 mono → 16 kHz Int16 base64) ───────────────────────────────────
function bytesToBase64(bytes: Uint8Array): string {
  if (typeof btoa === 'undefined') return ''
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)))
  }
  return btoa(bin)
}

/** Downsample mono Float32 PCM to ≤16 kHz, quantize to Int16, base64-encode. */
export function encodeCorrectionAudio(samples: Float32Array, sampleRate: number): CorrectionAudio {
  const { buf, rate } = resampleMono(samples, sampleRate, CORRECTION_AUDIO_RATE)
  const int16 = new Int16Array(buf.length)
  for (let i = 0; i < buf.length; i++) {
    const s = Math.max(-1, Math.min(1, buf[i]))
    int16[i] = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767)
  }
  const bytes = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength)
  return {
    sampleRate: rate,
    samples:    buf.length,
    durSec:     rate > 0 ? buf.length / rate : 0,
    encoding:   'int16',
    pcmBase64:  bytesToBase64(bytes),
  }
}

/** Decode a CorrectionAudio back to Float32 [-1,1] mono PCM (for re-analysis/verify). */
export function decodeCorrectionAudio(audio: CorrectionAudio): Float32Array {
  if (typeof atob === 'undefined' || !audio.pcmBase64) return new Float32Array(0)
  const bin = atob(audio.pcmBase64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  // Copy into an aligned buffer before viewing as Int16 (byte offset may be odd otherwise).
  const aligned = new Uint8Array(bytes.length - (bytes.length % 2))
  aligned.set(bytes.subarray(0, aligned.length))
  const int16 = new Int16Array(aligned.buffer, 0, aligned.length / 2)
  const out = new Float32Array(int16.length)
  for (let i = 0; i < int16.length; i++) out[i] = int16[i] / 32768
  return out
}

// ── IndexedDB plumbing (SSR-guarded) ─────────────────────────────────────────────
function hasIDB(): boolean {
  return typeof indexedDB !== 'undefined'
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('ts', 'ts', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const req = fn(t.objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

// ── Public API ───────────────────────────────────────────────────────────────────
export async function saveCorrection(record: CorrectionRecord): Promise<void> {
  if (!hasIDB()) return
  const db = await openDB()
  await tx(db, 'readwrite', s => s.put(record))
}

export async function listCorrections(): Promise<CorrectionRecord[]> {
  if (!hasIDB()) return []
  const db = await openDB()
  const all = await tx<CorrectionRecord[]>(db, 'readonly', s => s.getAll())
  return (all ?? []).sort((a, b) => a.ts - b.ts)
}

export async function countCorrections(): Promise<number> {
  if (!hasIDB()) return 0
  const db = await openDB()
  return tx<number>(db, 'readonly', s => s.count())
}

export async function clearCorrections(): Promise<void> {
  if (!hasIDB()) return
  const db = await openDB()
  await tx(db, 'readwrite', s => s.clear())
}

/** Serialize every stored correction into a downloadable JSON Blob (the dataset that
 *  leaves the browser for offline learning/tuning). */
export async function exportCorrections(): Promise<Blob> {
  const corrections = await listCorrections()
  const payload = {
    dataset:     'voicemidi-corrections',
    version:     1,
    appVersion:  CORRECTIONS_APP_VERSION,
    exportedAt:  Date.now(),
    count:       corrections.length,
    summary:     summarizeCorrections(corrections),
    corrections,
  }
  return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
}
