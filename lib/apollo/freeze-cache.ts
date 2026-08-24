'use client'
// Automatic combining: an Apollo clip plays as ONE rendered buffer instead of a
// synth voice per note.
//
// Every Apollo track is a full synth in a worklet, and voice cost multiplies
// with unison and with how many notes are held at once — a seven-track piece is
// seven synths in parallel and the audio thread simply cannot carry it, so the
// project opens and you hear nothing. Nobody should have to know that, or press
// a button about it: the combine happens on its own, in the background, and
// playback quietly uses the result.
//
// The split that matters (Brae's, and it is the right one): the COMBINED sound
// is what plays, and the uncombined material — the individual notes, the patch,
// the synth itself — is loaded separately, because it cannot be built in real
// time. Nothing in here ever runs on the audio path. Renders happen off an idle
// callback, one at a time, and until one is ready the clip just plays live as
// it always did.
//
// The MIDI clip stays the source of truth throughout. This is a cache, not an
// edit: the piano roll still holds notes, the track still holds its patch, and
// changing either produces a new stamp, which misses, which re-renders.

import type { MidiClip } from '@/lib/daw-types'
import type { ApolloPatch } from '@/lib/apollo/patch'
import { renderApolloProject, freezeStamp, type TrackRenderGroup } from '@/lib/apollo/daw-freeze'
import { loadCombined, saveCombined } from '@/lib/apollo/combine-store'

// AudioBuffers are not tied to the context that allocated them, so one
// throwaway context is enough to rebuild what was stored.
let allocCtx: OfflineAudioContext | null = null
const alloc = () => (allocCtx ??= new OfflineAudioContext(2, 1, 48000))

/** Rendered audio, keyed by everything that decides how it sounds. */
const buffers = new Map<string, AudioBuffer>()
const inFlight = new Set<string>()
/** Stamps that failed twice are left alone — a clip that will not render should
 *  fall back to live playback forever rather than retry on every tick. */
const failures = new Map<string, number>()
/** Why the most recent combine failed — a swallowed error is indistinguishable
 *  from "not ready yet", since both fall back to live playback. */
let lastError: string | null = null
const timings = { diskMs: 0, renderMs: 0, fromDisk: 0, attempts: 0 }

// Clips that would not render, remembered ACROSS sessions.
//
// One clip of Filament's 23 never comes back with audio. Without this, every
// page load pulled the other 22 off disk in 290ms and then spent 25 SECONDS
// re-rendering the whole project chasing that one — which is the entire cost of
// a reload. It plays live perfectly well; stop grinding for it.
const BAD_KEY = 'apollo-combine-unrenderable'
function knownBad(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(BAD_KEY) ?? '[]') as string[]) } catch { return new Set() }
}
function rememberBad(stamps: string[]): void {
  if (!stamps.length) return
  try {
    const all = knownBad()
    for (const s of stamps) all.add(s)
    // Keep it bounded; these are only an optimisation.
    localStorage.setItem(BAD_KEY, JSON.stringify([...all].slice(-200)))
  } catch { /* private mode */ }
}

type Job = { stamp: string; run: () => Promise<void> }
const queue: Job[] = []
let draining = false

/** How much rendered audio to keep.
 *
 *  The cache has to hold a WHOLE song, not a few clips of one: Filament is 23
 *  clips of about 21s each, and a 180s cap meant buffers were evicted as fast as
 *  they were made — including ones about to be played.
 *
 *  But this is stereo float at 48k, so 600s is ~230MB, and a phone will simply
 *  reload the tab rather than hand that over. Scale it to the device: a small
 *  budget still helps (the clips near the playhead stay combined) and never
 *  costs the page. */
function maxFrames(): number {
  if (typeof navigator === 'undefined') return 48_000 * 600
  const nav = navigator as Navigator & { deviceMemory?: number }
  const gb = nav.deviceMemory ?? (/Android|iPhone|iPad|iPod/i.test(nav.userAgent) ? 2 : 8)
  const seconds = gb <= 2 ? 60 : gb <= 4 ? 120 : gb <= 8 ? 300 : 600
  return 48_000 * seconds
}
const MAX_FRAMES = maxFrames()

export function combinedStamp(clip: MidiClip, patch: ApolloPatch, bpm: number): string {
  // The clip id is in the key so two clips that happen to hold identical notes
  // still get their own entry — they can sit at different points in the song and
  // carry different clip effects.
  return `${clip.id}|${freezeStamp(clip.notes, patch, bpm)}`
}

/** The finished render for this exact clip+patch+tempo, if there is one. */
export function combined(stamp: string): AudioBuffer | null {
  const b = buffers.get(stamp)
  if (!b) return null
  // Touch it: Map preserves insertion order, so re-inserting marks this as the
  // most recently used and eviction takes the genuinely cold buffers instead of
  // whatever the playhead is about to reach.
  buffers.delete(stamp); buffers.set(stamp, b)
  return b
}

/** True while anything is still being combined — useful for a UI hint. */
export function combining(): boolean { return inFlight.size > 0 || queue.length > 0 }

function evictIfNeeded(): void {
  let frames = 0
  for (const b of buffers.values()) frames += b.length
  while (frames > MAX_FRAMES && buffers.size > 1) {
    const oldest = buffers.keys().next().value as string
    frames -= buffers.get(oldest)?.length ?? 0
    buffers.delete(oldest)
  }
}

function idle(): Promise<void> {
  return new Promise(resolve => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(() => resolve(), { timeout: 500 })
    else setTimeout(resolve, 40)
  })
}

/** Each render builds an OfflineAudioContext and registers the worklet module in
 *  it. Back-to-back, the first succeeds and later ones come back silent, which
 *  is resource exhaustion rather than anything about the patches — the contexts
 *  are finished but not yet reclaimed. Leave a gap between them. */
const RENDER_GAP_MS = 1500
const gap = () => new Promise<void>(r => setTimeout(r, RENDER_GAP_MS))

async function drain(): Promise<void> {
  if (draining) return
  draining = true
  try {
    while (queue.length) {
      const job = queue.shift()!
      await idle()          // never compete with playback for the main thread
      await job.run()
      await gap()           // let the offline context be reclaimed before the next
    }
  } finally { draining = false }
}

/**
 * Ask for this clip to be combined. Cheap and idempotent — safe to call from
 * the scheduler on every pass; it returns immediately unless there is new work.
 */
export function requestCombine(bpm: number, groups: TrackRenderGroup[]): void {
  if (!groups.length) return
  const wanted = groups.flatMap(g => g.clips
    .filter(c => c.notes.length > 0)
    .map(c => ({ clip: c, patch: g.patch, key: combinedStamp(c, g.patch, bpm) })))
  const missing = () => wanted.filter(w => !buffers.has(w.key))
  if (!missing().length) return

  const jobKey = 'project-combine'
  if (inFlight.has(jobKey)) return
  inFlight.add(jobKey)
  queue.push({
    stamp: jobKey,
    run: async () => {
      try {
        // Renders of Apollo instruments are NOT deterministic: the same project
        // rendered three times gave peaks of 0.202, 0 and 0.0657, with no error
        // anywhere. One pass typically lands 22 of 23 clips. So run it again for
        // whatever is still missing and keep the good ones — the union across a
        // few attempts covers everything, and a clip that never renders simply
        // keeps playing live.
        // Anything rendered in a PREVIOUS session comes off disk instead of
        // being re-rendered. This is the difference between a reload costing a
        // minute of synthesis and costing nothing: the work is deterministic
        // over data that has not changed.
        const tDisk = Date.now()
        let fromDisk = 0
        for (const w of missing()) {
          const stored = await loadCombined(w.key, alloc())
          if (stored) { buffers.set(w.key, stored); fromDisk++ }
        }
        timings.diskMs = Date.now() - tDisk
        timings.fromDisk = fromDisk
        timings.renderMs = 0
        timings.attempts = 0

        // Anything already known not to render is left to play live rather than
        // re-attempted on every page load.
        const bad = knownBad()
        const renderable = () => missing().filter(w => !bad.has(w.key))
        const tRender = Date.now()
        for (let attempt = 0; attempt < 4 && renderable().length; attempt++) {
          timings.attempts++
          const before = renderable().length
          const rendered = await renderApolloProject(groups, bpm)
          for (const w of wanted) {
            if (buffers.has(w.key)) continue
            const buf = rendered.get(w.clip.id)
            if (!buf) continue
            // Never cache a silent render: a combined buffer REPLACES live
            // playback, so an empty one turns a clip that merely strained the
            // CPU into one that makes no sound at all.
            let peak = 0
            const d = buf.getChannelData(0)
            for (let i = 0; i < d.length; i += 256) { const v = Math.abs(d[i]); if (v > peak) peak = v }
            if (peak < 1e-4) continue
            buffers.set(w.key, buf)
            void saveCombined(w.key, buf)   // keep it for the next page load
          }
          evictIfNeeded()
          // Stop when a pass stops helping. The first pass usually lands nearly
          // everything; grinding out the last stubborn clip cost ~45s of extra
          // rendering at load for one clip that plays live perfectly well.
          if (renderable().length >= before) break
        }
        timings.renderMs = Date.now() - tRender
        const stubborn = renderable().map(w => w.key)
        rememberBad(stubborn)     // do not chase these again next time
        const left = missing().length
        lastError = left ? `${left} of ${wanted.length} clips play live (would not render)` : null
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e)
      } finally {
        inFlight.delete(jobKey)
      }
    },
  })
  void drain()
}

/** Drop everything (project close / user reset). */
export function clearCombined(): void {
  buffers.clear(); inFlight.clear(); failures.clear(); queue.length = 0
}

/** What the cache is doing. A combine that quietly fails looks exactly like one
 *  that has not happened yet — both play live — so make the difference visible. */
export function combineStats(): { ready: number; inFlight: number; queued: number; failed: [string, number][]; lastError: string | null; peaks: number[]; diskMs: number; renderMs: number; fromDisk: number; attempts: number } {
  // Peak of each cached render: a buffer that exists but is silent looks
  // identical to a working one from the outside, and silently-empty renders are
  // exactly the failure mode this cache can hide.
  const peaks: number[] = []
  for (const b of buffers.values()) {
    let p = 0
    const d = b.getChannelData(0)
    for (let i = 0; i < d.length; i += 512) p = Math.max(p, Math.abs(d[i]))
    peaks.push(+p.toFixed(4))
  }
  return { ready: buffers.size, inFlight: inFlight.size, queued: queue.length, failed: [...failures], lastError, peaks, ...timings }
}
if (typeof window !== 'undefined') {
  (window as unknown as { __combineStats?: typeof combineStats }).__combineStats = combineStats
}
