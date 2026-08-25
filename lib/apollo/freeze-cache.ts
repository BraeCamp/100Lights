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
const timings = { diskMs: 0, renderMs: 0, fromDisk: 0, attempts: 0, batches: 0 }

// Clips that would not render, remembered ACROSS sessions — as STRIKES, not a
// verdict on the first miss.
//
// The original version condemned a clip the first time a session ended without
// it, which was right for the case it was written for: ONE clip of Filament's 23
// never comes back with audio, and chasing it cost 25 seconds on every reload.
//
// But it was reading a non-deterministic failure as a permanent property. A miss
// usually means the offline contexts ran out mid-batch — the same reason
// RENDER_GAP_MS exists — not that the clip is unrenderable. Winter Drift came
// out of one cold load with 10 of its 31 clips condemned FOREVER on that
// browser, none of which have groove or volGraph and all of which render fine
// with room to breathe. Those 10 then play live on every future load, which is
// the lag that never goes away.
//
// So: a miss is a strike. Give up only on a clip that has missed in three
// separate sessions — contention won't reproduce that reliably, a genuinely
// silent clip will. A clip that does render has its record cleared.
const STRIKE_KEY = 'apollo-combine-strikes'
const LEGACY_BAD_KEY = 'apollo-combine-unrenderable'
const STRIKES_TO_GIVE_UP = 3
const MAX_TRACKED = 300

type Strikes = Record<string, number>

function strikes(): Strikes {
  try {
    const s = JSON.parse(localStorage.getItem(STRIKE_KEY) ?? '{}') as Strikes
    return s && typeof s === 'object' ? s : {}
  } catch { return {} }
}

function writeStrikes(s: Strikes): void {
  try {
    const entries = Object.entries(s)
    localStorage.setItem(STRIKE_KEY, JSON.stringify(Object.fromEntries(entries.slice(-MAX_TRACKED))))
    // The old one-strike list is a verdict we no longer trust — drop it so
    // anyone carrying false condemnations gets them back.
    localStorage.removeItem(LEGACY_BAD_KEY)
  } catch { /* private mode */ }
}

function knownBad(): Set<string> {
  const s = strikes()
  return new Set(Object.keys(s).filter(k => (s[k] ?? 0) >= STRIKES_TO_GIVE_UP))
}

function rememberBad(stamps: string[]): void {
  if (!stamps.length) return
  const s = strikes()
  for (const k of stamps) s[k] = (s[k] ?? 0) + 1
  writeStrikes(s)
}

/** It rendered — so it was never the clip's fault. Clear its record. */
function forgiveBad(stamps: string[]): void {
  if (!stamps.length) return
  const s = strikes()
  let changed = false
  for (const k of stamps) if (k in s) { delete s[k]; changed = true }
  if (changed) writeStrikes(s)
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

// Combining competes with the thing it exists to serve.
//
// Measured on Iced while the transport was running: the AUDIO never suffered —
// real time held at 0.999x with no stalls, because playback lives on the audio
// thread — but the interface dropped to 38fps with 723ms frozen frames, because
// cutting and storing renders is main-thread work. That is the "not smooth".
//
// So the heavy whole-project pass waits for the transport to stop. The opening
// batch is NOT deferred: it is small, and it is what makes the start of the song
// play combined rather than live. And the wait has a ceiling — someone who
// starts a long song and listens all the way through should still end up with a
// combined project, so after PLAYING_GRACE_MS the pass goes ahead anyway and
// simply yields as it works.
let playing = false
export function setCombinePaused(v: boolean): void { playing = v }

const PLAYING_GRACE_MS = 30_000
async function waitForQuiet(): Promise<void> {
  const until = Date.now() + PLAYING_GRACE_MS
  while (playing && Date.now() < until) await new Promise(r => setTimeout(r, 500))
}

/** Hand the main thread back between pieces of a long job. scheduler.yield()
 *  resumes at the front of the queue after a frame, so splitting work up doesn't
 *  send it to the back behind everything else. */
type Scheduler = { yield?: () => Promise<void> }
function breathe(): Promise<void> {
  const s = (globalThis as { scheduler?: Scheduler }).scheduler
  if (typeof s?.yield === 'function') return s.yield()
  return new Promise<void>(r => setTimeout(r, 0))
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

/** Store the good renders from one batch; a silent one is not cached, because a
 *  combined buffer REPLACES live playback and an empty one is worse than slow. */
async function keep(rendered: Map<string, AudioBuffer>, batch: { clip: MidiClip; key: string }[]): Promise<void> {
  const landed: string[] = []
  for (const w of batch) {
    if (buffers.has(w.key)) continue
    const buf = rendered.get(w.clip.id)
    if (!buf) continue
    let peak = 0
    const d = buf.getChannelData(0)
    for (let i = 0; i < d.length; i += 256) { const v = Math.abs(d[i]); if (v > peak) peak = v }
    if (peak < 1e-4) continue
    buffers.set(w.key, buf)
    landed.push(w.key)
    // A clip becomes playable the moment it is in `buffers`; persisting it is
    // for the NEXT page load and nobody is waiting on it. saveCombined converts
    // both channels to Int16 synchronously before its first await, so firing
    // twenty-five of them in a tight loop is twenty-five conversions in one
    // task. Yield between clips: the song stays combined just as fast, the
    // interface just gets a turn in between.
    void saveCombined(w.key, buf)
    await breathe()
  }
  forgiveBad(landed)   // it rendered, so any earlier strike was contention
  evictIfNeeded()
}

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
        // Render in BATCHES, earliest first, instead of the whole song before
        // anything is usable. On production the all-at-once pass took 113
        // seconds — nearly two minutes of the song running on the expensive
        // live path. A batch is a few seconds, and playback can use each one the
        // moment it lands, so the opening is playable almost immediately and the
        // rest fills in behind you.
        // ONE small opening batch so playback starts immediately, then ONE
        // whole-project pass. Not ten batches — that strategy was upside down.
        //
        // Measured on Winter Drift (31 clips, 7 tracks, 1:50):
        //   ten batches + a full pass   128s, 21 of 31 landed
        //   a single full pass           17s, 26 of 31 landed
        //
        // Every render builds an offline context that is not reclaimed promptly,
        // so passes DEGRADE as they pile up: timed back to back, the first took
        // 17s and landed 26, the second 14s and landed 13, the third 90s and
        // still 13. Each extra pass was buying less and costing more. Fewer,
        // bigger renders are faster AND more complete — the batching was
        // manufacturing the very exhaustion it was working around.
        const OPENING = 4
        const byTime = [...renderable()].sort((a, b) => a.clip.startBeat - b.clip.startBeat)
        const opening = byTime.slice(0, OPENING)
        if (opening.length) {
          timings.attempts++
          const rendered = await renderApolloProject(groups, bpm, { only: new Set(opening.map(w => w.clip.id)) })
          await keep(rendered, opening)
          timings.batches++
          await gap()
        }
        // The whole project, once. This is the pass that does the real work —
        // and the one that makes the interface stutter if it runs while you are
        // listening, so it waits for the transport (with a ceiling; see above).
        await waitForQuiet()
        if (renderable().length) {
          timings.attempts++
          const rest = renderable()
          const rendered = await renderApolloProject(groups, bpm)
          await keep(rendered, rest)
          timings.batches++
        }
        // And that is where this session stops. There is deliberately NO retry
        // pass: a retry renders into the same exhausted state that caused the
        // miss, and measured, it cost 30s to add almost nothing (a third pass
        // back-to-back took 90s and landed none). What it missed is a strike,
        // not a loss — next session pulls everything already rendered off disk
        // for free and spends its one pass on the remainder, so coverage climbs
        // across loads without any single load grinding for it.
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
export function combineStats(): { ready: number; inFlight: number; queued: number; failed: [string, number][]; lastError: string | null; peaks: number[]; striking: number; givenUp: number; diskMs: number; renderMs: number; fromDisk: number; attempts: number; batches: number } {
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
  const s = strikes()
  const struck = Object.values(s)
  return {
    ready: buffers.size, inFlight: inFlight.size, queued: queue.length,
    failed: [...failures], lastError, peaks,
    // Strikes are the difference between "missed once, will retry" and "given
    // up on" — without them a retry-forever bug and a condemn-forever bug look
    // exactly the same from out here.
    striking: struck.filter(n => n < STRIKES_TO_GIVE_UP).length,
    givenUp: struck.filter(n => n >= STRIKES_TO_GIVE_UP).length,
    ...timings,
  }
}
if (typeof window !== 'undefined') {
  (window as unknown as { __combineStats?: typeof combineStats }).__combineStats = combineStats
}
