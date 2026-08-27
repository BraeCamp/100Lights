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
import { keepForNextTime, setCombineWriter, setStorageTransportPlaying, storagePolicy } from '@/lib/apollo/storage-policy'

// The policy module does the deciding; the store does the writing. Wiring them
// here keeps storage-policy free of any dependency on IndexedDB, which is what
// lets it be reasoned about (and tested) without a browser.
setCombineWriter(saveCombined)

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
function deviceCeiling(): number {
  if (typeof navigator === 'undefined') return 48_000 * 600
  const nav = navigator as Navigator & { deviceMemory?: number }
  const gb = nav.deviceMemory ?? (/Android|iPhone|iPad|iPod/i.test(nav.userAgent) ? 2 : 8)
  // Stereo float at 48k is ~384KB per second, so 600s is ~230MB. Roughly 1.5% of
  // RAM at each tier, which a tab can hold without being reloaded under it.
  const seconds = gb <= 2 ? 60 : gb <= 4 ? 120 : gb <= 8 ? 300 : gb <= 16 ? 1200 : 2400
  return 48_000 * seconds
}
const DEVICE_CEILING = deviceCeiling()

// ── How long a window will take, and how fast this machine is ───────────────
//
// Sizing a window by CLIP COUNT assumes every clip costs the same, and clips do
// not: measured across Undertow's tracks, four clips of hats render in 1.9s and
// four clips of pad take 19.4s. Same count, ten times the work — which is Brae's
// "dense moments lag the playhead", exactly.
//
// What does predict it is VOICE-SECONDS: for each note, how many voices the
// patch spends on it times how long it is held. Correlation against measured
// render time across eight tracks:
//
//   note count      0.375     (i.e. almost nothing)
//   note-seconds    0.956
//   voice-seconds   0.972
//
// And it is computable from the project — the patch is right there, so the cost
// of a window is knowable before rendering it.
//
// The machine's speed is LEARNED rather than benchmarked. A separate background
// speed test would measure something other than this workload, cost CPU exactly
// when we are trying not to spend it, and be stale by the time it mattered. We
// already do the precise work we want to predict, several times a song, so every
// render is a free calibration sample — and one that tracks thermal throttling
// and other tabs as they happen. hardwareConcurrency is used only as the guess
// for the very first window, before there is anything to learn from.
// Voice-seconds alone is NOT enough, and getting that wrong froze a frame for
// 14.7 seconds. A synth with nothing sounding still runs its FX every block, so
// a window of cheap clips spread across the song costs real time while scoring
// as almost free — Rim has 29 voice-seconds and took 5,283ms. The span has to be
// in the estimate. Fitting ms against (voiceSeconds + K x spanSeconds) over the
// eight measured tracks:
//
//   K=0   (voice-seconds only)   error 118%
//   K=3                          error  53%
//   K=7                          error  44%
//
// So one span-second costs about what seven voice-seconds do, and the two
// together predict well enough to size a window by.
const SPAN_WEIGHT = 7
let msPerUnit = 0
let renderSamples = 0

function initialMsPerUnit(): number {
  if (typeof navigator === 'undefined') return 5
  const cores = navigator.hardwareConcurrency ?? 4
  // ~3.4 ms/unit measured on this desktop; scale by cores and stay pessimistic,
  // because guessing FAST is what makes a window overshoot its deadline.
  return Math.max(2, Math.min(40, 3.4 * (8 / Math.max(1, cores)) * 1.8))
}

/** Fold one finished render into the running estimate. */
function learnRenderCost(units: number, ms: number): void {
  if (units <= 0 || ms <= 0) return
  const observed = ms / units
  // Exponential moving average, quick to adapt at first and steadier later.
  const weight = renderSamples < 3 ? 0.6 : 0.25
  msPerUnit = msPerUnit
    ? msPerUnit * (1 - weight) + observed * weight
    : observed
  renderSamples++
}

/** Voices this patch spends per note — unison per enabled oscillator. */
function voiceCost(patch: ApolloPatch | undefined): number {
  const p = patch as unknown as {
    oscs?: { enabled?: boolean; unison?: number }[]
    sub?: { enabled?: boolean }
    noise?: { enabled?: boolean }
  } | undefined
  let n = 0
  for (const o of p?.oscs ?? []) if (o.enabled) n += Math.max(1, o.unison ?? 1)
  if (p?.sub?.enabled) n += 1
  if (p?.noise?.enabled) n += 1
  return Math.max(1, n)
}

/** How much synthesis this clip represents, in voice-seconds. */
function clipVoiceSeconds(clip: MidiClip, patch: ApolloPatch, spb: number): number {
  const per = voiceCost(patch)
  let held = 0
  for (const n of clip.notes) held += n.durationBeats * spb
  return per * held
}

/**
 * How long a window may take to render.
 *
 * While the transport runs this is the thing that decides whether the renderer
 * stays ahead of the listener: a window that takes longer than the music it
 * covers loses ground. Kept well under that so there is margin on a busy
 * machine. With nobody listening there is no deadline, only responsiveness.
 */
function renderTimeBudgetMs(): number {
  // Three paces, not two.
  //
  // Playing: stay ahead of the playhead — that is a deadline, and the window has
  // to be big enough to make progress against it.
  //
  // Idle but the user is TOUCHING something: the smallest windows we do. They
  // are dragging a clip or turning a knob and every millisecond of main thread
  // we take is felt directly. Rendering ahead is worth nothing if it makes the
  // thing they are doing right now feel bad.
  //
  // Idle and untouched: work properly. This is the case that used to be missing
  // — combining began the moment a project loaded and went at full tilt whether
  // or not anyone was interacting, which is lag before you have even pressed
  // play.
  if (transportPlaying) return 1500
  return userIsBusy() ? 400 : 5000
}

/** Has the user touched anything very recently? */
const BUSY_WINDOW_MS = 1800
let lastInputAt = 0
export function noteUserInput(): void { lastInputAt = Date.now() }
function userIsBusy(): boolean { return Date.now() - lastInputAt < BUSY_WINDOW_MS }

if (typeof window !== 'undefined') {
  // Passive listeners on the capture phase: this only ever reads a clock, and
  // must never be the reason an interaction feels slow.
  for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel'] as const) {
    window.addEventListener(ev, noteUserInput, { capture: true, passive: true })
  }
}

/**
 * How heavy is this project — and should it just be baked?
 *
 * "How big" has an exact answer here, and it is not clip count or file size: it
 * is the same cost model the windows use. Total voice-seconds plus the span the
 * FX run over, priced at what this machine has been observed to manage. That
 * gives a number in SECONDS — roughly how long it takes to render the whole song
 * — which is the only figure that actually predicts whether combining can keep
 * up or whether the listener spends the first minute on the live synth path.
 *
 * Returns the estimate and a recommendation. Anything a machine can render in a
 * few seconds needs no ceremony; a project that takes a minute is one where the
 * live path is going to be felt, and freezing is what a real DAW would do.
 */
export function projectRenderEstimate(bpm: number, groups: TrackRenderGroup[]): {
  seconds: number
  clips: number
  shouldFreeze: boolean
} {
  const spb = 60 / bpm
  let voiceSec = 0, clips = 0
  let first = Infinity, last = -Infinity
  for (const g of groups) {
    for (const c of g.clips) {
      if (!c.notes.length) continue
      clips++
      voiceSec += clipVoiceSeconds(c, g.patch, spb)
      first = Math.min(first, c.startBeat)
      last = Math.max(last, c.startBeat + c.durationBeats)
    }
  }
  if (!clips) return { seconds: 0, clips: 0, shouldFreeze: false }
  const span = Math.max(0, (last - first) * spb)
  const rate = msPerUnit || initialMsPerUnit()
  const seconds = ((voiceSec + SPAN_WEIGHT * span) * rate) / 1000
  // Where to draw the line was a guess at 25s, and the guess was wrong in the
  // most specific way possible: Undertow — the song Brae reported as slow, the
  // one this whole thread of work exists because of — prices at 22.8s on this
  // machine and so did not qualify. A threshold that excludes the motivating
  // example is not a threshold, it is a coincidence.
  //
  // 15s is the line now. Rendering the song takes that long BEFORE the listener
  // hears the end of it, so anything above it means a stretch of the song plays
  // on the live synth path, which is the stuttering. Below it, combining catches
  // up while nobody is listening for it. The figure is in seconds-on-THIS-machine
  // — msPerUnit is calibrated from real renders here — so a slower laptop crosses
  // the line on smaller songs, which is the correct behaviour rather than a
  // fixed clip count pretending every machine is the same.
  return { seconds, clips, shouldFreeze: seconds > 15 }
}

/**
 * How much a SINGLE render pass may allocate.
 *
 * Separate from the cache ceiling above, and from the time budget: the cache is
 * what we HOLD, this is the transient spike while rendering, and it is the spike
 * that kills a phone. iOS reclaims a tab well below the numbers a laptop shrugs
 * at, and it does it by reloading the page — which is what "the page keeps
 * reloading after a few seconds of the song" was.
 */
export function renderBudgetBytes(): number {
  if (typeof navigator === 'undefined') return 64 * 1024 * 1024
  const nav = navigator as Navigator & { deviceMemory?: number }
  const mobile = /Android|iPhone|iPad|iPod/i.test(nav.userAgent)
  const gb = nav.deviceMemory ?? (mobile ? 2 : 8)
  // 12MB is roughly one track of a 30-second window — small enough that a phone
  // never sees a spike it cannot absorb, and combining still finishes, just in
  // more passes. More passes is a fine trade for the tab staying alive.
  if (mobile || gb <= 2) return 12 * 1024 * 1024
  if (gb <= 4) return 24 * 1024 * 1024
  if (gb <= 8) return 48 * 1024 * 1024
  return 96 * 1024 * 1024
}

/** How much rendered audio the CURRENT project actually needs, once known. */
let projectFrames = 0
/** The live budget: enough for this project, never more than the device allows. */
let MAX_FRAMES = DEVICE_CEILING

/**
 * Size the cache to the song.
 *
 * A fixed budget is the wrong shape for this. Iced is 2:09 but SEVEN tracks, so
 * its combined audio is about 684 seconds — a seven-track song needs seven times
 * its own length. Against the old flat 600s ceiling that meant the cache filled
 * and evicted five clips of a song that had rendered perfectly, and because
 * eviction took the OLDEST first, the five it threw away were the opening of the
 * song: the part you hear on every single play. They then played live forever
 * and reported themselves as "would not render", which is not what happened.
 *
 * So ask for what the project needs and take it if the device can carry it.
 * Nothing changes on a small device except that it still keeps what it can.
 */
function setProjectNeed(frames: number): void {
  projectFrames = frames
  // A little headroom so re-rendering one clip can't immediately evict another.
  MAX_FRAMES = Math.min(DEVICE_CEILING, Math.max(48_000 * 60, Math.ceil(frames * 1.1)))
}

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

/**
 * The most recent render for this CLIP, even if the sound has since changed.
 *
 * Brae: "we still have the option of loading procedurally… it should save the
 * baked audio so that it can play again from that spot without a problem…
 * can we add audio on top as things are added, and apply inverse audio to
 * remove things?"
 *
 * Adding and subtracting renders is the right instinct and does not survive
 * contact with this signal path. Summing a new note into an existing buffer only
 * reproduces the real thing if everything downstream of the sum is LINEAR — and
 * Apollo's is not. The ladder filter saturates through tanh, the drive stage is
 * a waveshaper, and the FX chain compresses. Add a voice and the nonlinear
 * stages see a different signal, so the correct output is not the old output
 * plus the new note in isolation. Subtracting to remove a note is the same
 * problem and worse: it would leave the residue of everything the nonlinearity
 * did differently, which is audible as a ghost of the note you deleted.
 *
 * But the PROBLEM behind the idea is real, and this fixes it. Changing a sound
 * changes the stamp of every clip on that track at once, and each of those clips
 * then had no cached audio — so they fell back to live synthesis, which is the
 * expensive path, which is the stutter. Meanwhile a perfectly good render of
 * that clip was still sitting in the cache under its old key.
 *
 * So: on a miss, hand back the previous render for the same clip. You hear the
 * old sound on the far side of the song for a few seconds while the new one is
 * built, instead of hearing the studio struggle. The clips near the playhead are
 * re-rendered first, so the one you are actually listening to updates almost at
 * once — the stale audio only ever covers the parts you have not reached yet.
 */
export function combinedStale(clipId: string): AudioBuffer | null {
  // Keys are `${clipId}|${hash}`, and Map keeps insertion order, so the LAST
  // match is the most recently rendered version of this clip.
  let found: AudioBuffer | null = null
  for (const [key, buf] of buffers) {
    if (key.startsWith(clipId + '|')) found = buf
  }
  return found
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

// Where the listener is. Rendering follows this rather than the song's start.
//
// This replaces a "wait until the transport stops" rule. That rule existed
// because combining while playing dropped the interface to 38fps with 723ms
// frozen frames — but the real problem there was rendering the WHOLE project in
// one uninterruptible pass, not rendering during playback as such. A window is
// small, and the work is yielded through, so it can run while you listen. Which
// it must: rendering ahead of the playhead is the entire point.
let playheadBeat = 0
let lastLookaheadAsk = 0

export function setPlayhead(beat: number): void {
  if (!Number.isFinite(beat)) return
  playheadBeat = beat
  // Deliberately does NOT ask for a render any more. It used to, to keep a
  // lookahead window topped up during playback — but nothing renders during
  // playback now, so waking the baker here would only put the freeze back.
  // The playhead still matters: byUrgency() sorts by distance from it, so
  // baking on pause starts with whatever you are about to hear.
}

/**
 * Whether anyone is listening right now. This does NOT stop the work — the
 * whole point is to render while you play — it decides how hard to push.
 *
 * The gap between windows was one number, and it was doing two jobs: letting
 * offline contexts be reclaimed, and leaving the interface room to draw.
 * Shortening it from 1500ms to 350ms took Iced's cold combine from 39.7s to
 * 31.5s and took the worst frame during playback from 81ms to 488ms. Those are
 * different situations and they want different answers: when nobody is
 * listening, go fast; when someone is, stay out of the way. Total time barely
 * matters any more, because the first sound arrives in half a second either way.
 */
let transportPlaying = false
export function setTransportPlaying(v: boolean): void {
  const was = transportPlaying
  transportPlaying = v
  // Stopping is the cue to write down everything rendered while playing.
  setStorageTransportPlaying(v)
  // And to start baking again. The loop parks itself on play and has no other
  // way back, so without this the cache would only ever be filled by whatever
  // happened to be running when play was pressed — the song would stay live
  // forever and never get cheaper on the second pass.
  if (was && !v && lastGroups && pendingWhilePlaying) {
    pendingWhilePlaying = false
    requestCombine(lastBpm, lastGroups)
  }
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
// Rest in PROPORTION to the work just done, not a flat amount.
//
// A flat 1500ms was right when windows were a fixed four clips. Now that they
// are sized by predicted cost they are often one clip, and a fixed gap starts to
// dominate: twenty-five small windows spent 37 of 45 seconds simply waiting, and
// the renderer fell behind a playhead it had previously stayed ahead of. A short
// render has not built up much of a debt to the interface, so it should not pay
// a long one back.
const gap = (lastRenderMs = 0) => {
  const ms = transportPlaying
    ? Math.min(1500, Math.max(180, lastRenderMs * 0.6))
    // Rest LONGER while the user is interacting than while they are not: the
    // point of rendering ahead is that it is invisible, and it stops being
    // invisible the moment it competes with a drag.
    : userIsBusy()
      ? Math.min(2000, Math.max(400, lastRenderMs * 1.5))
      : Math.min(350, Math.max(80, lastRenderMs * 0.25))
  return new Promise<void>(r => setTimeout(r, ms))
}


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
    // for the NEXT page load and nobody is waiting on it. So the write is handed
    // to the storage policy, which holds it until the transport is stopped and
    // then writes in bursts sized to how fast this machine actually writes.
    //
    // That ordering is the point: saveCombined converts both channels to Int16
    // synchronously before its first await, so a burst of them during playback
    // is heard. The same burst while paused costs nothing. And on a device with
    // no usable storage the policy drops it, rather than failing once per clip
    // after doing the conversion work each time.
    void keepForNextTime(w.key, buf)
    await breathe()
  }
  forgiveBad(landed)   // it rendered, so any earlier strike was contention
  evictIfNeeded()
}

// ── Telling the user something is happening ─────────────────────────────────
//
// There was no indication at all. A heavy song opens, the studio spends a minute
// synthesising it, and the only evidence is that playback sounds thin for a
// while and the machine is busy — which reads as the app being slow rather than
// as the app doing work with an end in sight. Brae asked where the progress bar
// was; there wasn't one, anywhere.
export interface CombineProgress {
  /** Clips whose audio is ready. */
  done: number
  /** Clips this song wants. */
  total: number
  /** Is a render running right now? */
  active: boolean
  /** 'head' = racing to first sound; 'fill' = filling the rest in behind you. */
  phase: 'head' | 'fill' | 'idle' | 'paused'
}

let progress: CombineProgress = { done: 0, total: 0, active: false, phase: 'idle' }
const progressListeners = new Set<(p: CombineProgress) => void>()

export function combineProgress(): CombineProgress { return progress }

/** Subscribe to loading progress. Returns an unsubscribe. */
export function onCombineProgress(fn: (p: CombineProgress) => void): () => void {
  progressListeners.add(fn)
  fn(progress)
  return () => { progressListeners.delete(fn) }
}

function setProgress(next: Partial<CombineProgress>): void {
  progress = { ...progress, ...next }
  for (const l of progressListeners) l(progress)
}

// The most recent request, so advancing the playhead can ask for the next
// window without the caller having to hand the groups over again.
let lastGroups: TrackRenderGroup[] | null = null
let lastBpm = 120
/** Someone asked for a render while the transport was running. Served on pause. */
let pendingWhilePlaying = false

export function requestCombine(bpm: number, groups: TrackRenderGroup[]): void {
  if (!groups.length) return
  lastGroups = groups
  lastBpm = bpm
  // ── Playing means playing ──────────────────────────────────────────────
  //
  // Park before doing ANY work, not once the render loop is reached. The
  // engine asks for a combine on every clip that is not yet baked, so during
  // playback this is called constantly — and everything above the render loop
  // (stamping every clip, sizing the cache, a disk lookup per missing clip)
  // would run every time for a job that is only going to stop anyway. Parking
  // late turned that into a busy loop and made the stalls worse, not better:
  // measured 179ms worst frame against 133ms before the change.
  //
  // So remember that someone asked, and serve it on pause.
  if (transportPlaying) { pendingWhilePlaying = true; return }

  const wanted = groups.flatMap(g => g.clips
    .filter(c => c.notes.length > 0)
    .map(c => ({ clip: c, patch: g.patch, key: combinedStamp(c, g.patch, bpm) })))
  // Size the cache to this song before rendering into it, or it evicts the
  // opening of the song to make room for the end of it.
  const spb = 60 / bpm
  setProjectNeed(wanted.reduce((n, w) => n + Math.ceil(w.clip.durationBeats * spb * 48_000), 0))
  const missing = () => wanted.filter(w => !buffers.has(w.key))
  setProgress({ done: wanted.length - missing().length, total: wanted.length, phase: 'idle', active: false })
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
        // Skip the disk entirely where there is none. Asking for thirty-nine
        // clips that cannot exist is thirty-nine round trips to a database that
        // will answer "no" — pure latency in front of the first sound, on
        // exactly the devices that can least afford it.
        const policy = await storagePolicy()
        if (policy.mode !== 'none') {
          for (const w of missing()) {
            const stored = await loadCombined(w.key, alloc())
            if (stored) { buffers.set(w.key, stored); fromDisk++ }
          }
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

        // ── Render in a WINDOW that follows the playhead ────────────────────
        //
        // The old shape was "one opening batch, then the whole project". That
        // renders the end of a song before anyone has heard the middle, and it
        // means the first thing you do after pressing play is a minute of work
        // for audio that is two minutes away.
        //
        // Instead: always render what is about to be HEARD. Clips are ordered by
        // how soon the playhead reaches them, nearest first, and taken a window
        // at a time. At load the playhead is at 0, so this naturally renders the
        // opening first — the old opening batch falls out of the ordering rather
        // than being a special case. Press play and the window moves with you;
        // seek somewhere else and the next window re-sorts around where you
        // landed, because the ordering is recomputed every pass.
        //
        // Whether this can outrun playback is the whole question, and it can:
        // Undertow renders ~16 clip-seconds per second of wall time, while
        // playing one second of an 8-track song consumes 8. Two times headroom,
        // so the buffer grows while you listen. If a heavy patch or a slow
        // machine ever drops that below 1x you simply hear the live synth for a
        // moment, which is exactly what happens today — the failure mode is the
        // current behaviour, not a broken one.
        //
        // Small windows only became viable once renders stopped coming back
        // silent. Batching was abandoned before because ten small passes landed
        // 21 of 31 clips against 26 for one big pass; that was the message-port
        // race, and with the ping/ready handshake a small render is now as
        // reliable as a large one.
        // A window is sized by the MEMORY it implies, not by a clip count.
        //
        // Counting clips was wrong and it cost Brae a working phone: renderMany
        // ToBuffer allocates one buffer of (tracks x 2 channels x span), and a
        // window is chosen in urgency order, so four clips that happen to sit
        // far apart span the song between them. Measured on Undertow, four clips
        // meant a 70 MB allocation, and a badly shaped window reached 119 MB.
        // Desktop shrugs; iOS kills the tab, which is exactly the "page keeps
        // reloading after a few seconds" report.
        //
        // So: take clips in urgency order and stop before the implied buffer
        // crosses a device-sized budget. Always take at least one, or a song
        // whose single clip exceeds the budget would never render at all.
        const budgetBytes = renderBudgetBytes()
        const spb2 = 60 / bpm

        /** What renderManyToBuffer will allocate for this set of clips. */
        const impliedBytes = (set: { clip: MidiClip }[]): number => {
          if (!set.length) return 0
          const first = Math.min(...set.map(w => w.clip.startBeat))
          const last = Math.max(...set.map(w => w.clip.startBeat + w.clip.durationBeats))
          const tracks = new Set(set.map(w => groups.find(g => g.clips.some(c => c.id === w.clip.id))?.trackId)).size || 1
          return tracks * 2 * ((last - first) * spb2 + 2) * 48_000 * 4
        }

        /** The span a set of clips forces the renderer to cover, in seconds. */
        const spanSeconds = (set: { clip: MidiClip }[]): number => {
          if (!set.length) return 0
          const first = Math.min(...set.map(w => w.clip.startBeat))
          const last = Math.max(...set.map(w => w.clip.startBeat + w.clip.durationBeats))
          return (last - first) * spb2 + 2
        }

        /** Predicted render time: the synthesis plus the span it runs FX over. */
        const estimateMs = (set: { clip: MidiClip }[], voiceSec: number): number =>
          (voiceSec + SPAN_WEIGHT * spanSeconds(set)) * msPerUnit

        /** Clips ordered by how soon the playhead reaches them. */
        const byUrgency = () => {
          const head = playheadBeat
          return [...renderable()].sort((a, b) => {
            // Anything the playhead has already passed goes last: it is only
            // wanted if the user scrolls back, and by then it can be fetched.
            const da = a.clip.startBeat + a.clip.durationBeats < head ? Infinity : Math.abs(a.clip.startBeat - head)
            const db = b.clip.startBeat + b.clip.durationBeats < head ? Infinity : Math.abs(b.clip.startBeat - head)
            if (da !== db) return da - db
            return a.clip.startBeat - b.clip.startBeat
          })
        }

        if (!msPerUnit) msPerUnit = initialMsPerUnit()

        // ── Head start first, then fill ─────────────────────────────────────
        //
        // Two phases, because the first few seconds and the rest of the song are
        // different problems:
        //
        //   HEAD START — the smallest useful window, right where the playhead
        //   is. The only thing that matters is time-to-first-sound; nobody cares
        //   that bar 40 is not ready when they have not heard bar 1.
        //
        //   FILL — everything else, in AS FEW PASSES as memory allows.
        //
        // The fill phase is deliberately the opposite of the head start, and it
        // is the fix for "it's just slow". This loop used to run the whole song
        // in head-start-sized windows: at most four clips, time-budgeted, over
        // and over. That is the exact pattern this file already had a
        // measurement against, a few lines below —
        //
        //     ten batches + a full pass   128s, 21 of 31 landed
        //     a single full pass           17s, 26 of 31 landed
        //
        // — and the same thing measured again on freezing this week: four clips
        // per render took 66s where one clip per render took 123s. Every render
        // builds an offline context that is not reclaimed promptly, so each pass
        // costs more than the last. Many small passes do not merely fail to
        // help, they roughly double the work. The comment survived; the code had
        // drifted back into the shape the comment warns about.
        //
        // So: small while it matters, then big. And bigger still when the
        // transport is stopped, because then there is no deadline to miss — that
        // is Brae's "load the full thing in the background when it's paused".
        // ── While playing, DO NOT RENDER ───────────────────────────────────
        //
        // This started as "render the whole song", then became "render 14
        // seconds ahead of the playhead". Brae, on the second one: "it says
        // (loading ahead of playhead) but it loads far ahead instead of just
        // right in front of it. Can we change the loading type to the one that
        // plays real time when the user hits play?" — and before that, three
        // times, some version of the same request.
        //
        // He is right, and a smaller window was never going to be the answer.
        // Chrome runs an OfflineAudioContext carrying JS worklets ON THE MAIN
        // THREAD, so every render is a main-thread block — and the note
        // scheduler runs there too. Rendering while playing therefore competes
        // with the very thing it is trying to serve: the studio goes quiet
        // because nothing is left to schedule the notes. Fourteen seconds of
        // lookahead is just a shorter freeze than the whole song.
        //
        // Apollo already has a real-time path — its DSP is an AudioWorklet on
        // the audio thread, which is what real-time synthesis IS. Pressing play
        // now uses it: whatever is already baked plays from the cache, and
        // everything else is synthesised live. Baking resumes on pause, which
        // is when there is nothing to interrupt, and is what makes the second
        // pass over a section instant.
        const stopWhilePlaying = () => transportPlaying
        let headStartDone = false
        while (renderable().length) {
          // Someone pressed play. Stop, and let the audio thread have the
          // machine — a render in flight cannot be cancelled, but no new one
          // starts. setTransportPlaying(false) wakes this again on pause.
          if (stopWhilePlaying()) {
            // Play was pressed while this job was running. Stop, and make sure
            // pausing picks the work back up — the entry guard above never saw
            // this request, so without this the remaining clips would never be
            // baked and every pass over them would stay live.
            pendingWhilePlaying = true
            setProgress({ ...progress, active: false, phase: 'paused' })
            break
          }
          const queue2 = byUrgency()
          if (!queue2.length) break
          const window: typeof queue2 = []
          let windowVoiceSec = 0
          const phase: 'head' | 'fill' = headStartDone ? 'fill' : 'head'
          // A deadline only exists while the transport is running. Stopped, the
          // only limit is memory, so the fill goes as wide as the device allows.
          // ALWAYS bounded, and bounded tightly.
          //
          // This previously used renderTimeBudgetMs() x 3 while playing and
          // Infinity while paused, on the theory that fewer, bigger passes are
          // faster. Two measurements killed that theory:
          //
          //   Total time barely moved. 4-clip windows: 39.4s in 12 passes.
          //   Unbounded windows: 38.5s in 8. Within noise.
          //
          //   And a render BLOCKS THE MAIN THREAD for its entire duration —
          //   Chrome runs an OfflineAudioContext carrying JS worklets there. So
          //   an unbounded window is an unbounded freeze. Playing Hallway Light
          //   from a cold cache, the playhead jumped from beat 4.8 to 25.5
          //   between two samples one second apart: audio carried on from the
          //   audio thread while the interface was gone for thirteen seconds.
          //   That is Brae's "super slow, and the bar appears and disappears".
          //
          // So the window is sized to stay under a human's patience rather than
          // to minimise passes. Costing nothing in total time, it is the whole
          // difference between a studio that works while it loads and one that
          // locks up.
          // Measured. Tightening these does NOT keep shrinking the stall, because a
          // window always takes at least one clip and a single clip's render is
          // atomic — the budget only decides whether a SECOND one joins it. At
          // 500ms idle the worst stall measured 1820ms (three over a second),
          // worse than at 900ms, because more passes means more chances to meet
          // an expensive clip alone plus per-pass overhead. 900/450/250 is the
          // measured floor for this shape of work; going below it trades total
          // time for nothing.
          const timeBudget = userIsBusy() ? 250 : 900
          const maxClips = phase === 'head' ? 2 : 8
          for (const w of queue2) {
            const vs = clipVoiceSeconds(w.clip, w.patch, spb2)
            // TWO independent limits, because they guard different failures.
            // Bytes is memory: exceed it and a phone reloads the tab. Time is
            // the deadline: exceed it and the render falls behind the playhead,
            // which is what made dense passages lag. A window has to satisfy
            // both, and neither one implies the other — a long quiet clip is
            // big and cheap, a short dense chord is small and expensive.
            if (window.length) {
              if (impliedBytes([...window, w]) > budgetBytes) break
              if (estimateMs([...window, w], windowVoiceSec + vs) > timeBudget) break
            }
            window.push(w)
            windowVoiceSec += vs
            if (window.length >= maxClips) break
          }
          headStartDone = true
          setProgress({
            done: wanted.length - missing().length, total: wanted.length,
            active: true, phase,
          })
          if (!window.length) break
          timings.attempts++
          const before = buffers.size
          const tWin = Date.now()
          const rendered = await renderApolloProject(groups, bpm, {
            only: new Set(window.map(w => w.clip.id)),
          })
          // Every render is a calibration sample. This is why there is no
          // separate speed test: the work we want to predict is the work we just
          // did, so measuring it is both free and exactly on-target — and it
          // keeps tracking the machine as it throttles or gets busy.
          learnRenderCost(windowVoiceSec + SPAN_WEIGHT * spanSeconds(window), Date.now() - tWin)
          await keep(rendered, window)
          timings.batches++
          // A window that lands nothing would loop forever on the same clips.
          if (buffers.size === before) { rememberBad(window.map(w => w.key)); break }
          await gap(Date.now() - tWin)
        }
        // (The measurements that shaped the two-phase loop above are recorded
        // there, at the point where the window is sized. They used to live down
        // here, describing a strategy the code no longer followed — which is how
        // the loop drifted back into many-small-passes without anyone noticing
        // it contradicted its own evidence.)
        timings.renderMs = Date.now() - tRender
        setProgress({ done: wanted.length - missing().length, total: wanted.length, active: false, phase: 'idle' })
        const stubborn = renderable().map(w => w.key)
        rememberBad(stubborn)     // do not chase these again next time
        // Say which it was. "Would not render" was reported for clips that had
        // rendered perfectly and were then evicted, and that wrong label cost
        // real time chasing a rendering bug that did not exist.
        const left = missing().length
        const atCeiling = MAX_FRAMES >= DEVICE_CEILING && projectFrames > DEVICE_CEILING
        lastError = !left ? null
          : atCeiling
            ? `${left} of ${wanted.length} clips play live (song needs ${(projectFrames / 48_000) | 0}s of cache, device allows ${(DEVICE_CEILING / 48_000) | 0}s)`
            : `${left} of ${wanted.length} clips play live (would not render)`
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
export function combineStats(): { ready: number; inFlight: number; queued: number; failed: [string, number][]; lastError: string | null; peaks: number[]; striking: number; givenUp: number; msPerUnit: number; renderSamples: number; frames: number; maxFrames: number; diskMs: number; renderMs: number; fromDisk: number; attempts: number; batches: number } {
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
    // What the cost model currently believes about this machine.
    msPerUnit: +msPerUnit.toFixed(2),
    renderSamples,
    givenUp: struck.filter(n => n >= STRIKES_TO_GIVE_UP).length,
    // Held vs allowed. A clip that rendered fine and was then evicted is
    // indistinguishable from one that never rendered, from the outside — both
    // just play live — so make the budget visible.
    frames: [...buffers.values()].reduce((n, b) => n + b.length, 0),
    maxFrames: MAX_FRAMES,
    ...timings,
  }
}
if (typeof window !== 'undefined') {
  (window as unknown as { __combineStats?: typeof combineStats }).__combineStats = combineStats
}
