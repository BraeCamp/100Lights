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
import { RENDER_SAMPLE_RATE } from '@/lib/render-rate'
import { layersFor, patchForLayer, layerLabel } from './render-layers'
import type { ApolloPatch } from '@/lib/apollo/patch'
import { renderApolloProject, freezeStamp, type TrackRenderGroup } from '@/lib/apollo/daw-freeze'
import { loadCombined, saveCombined, clearStoredCombines, pruneCombined } from '@/lib/apollo/combine-store'
import { keepForNextTime, setCombineWriter, setStorageTransportPlaying, storagePolicy } from '@/lib/apollo/storage-policy'

// The policy module does the deciding; the store does the writing. Wiring them
// here keeps storage-policy free of any dependency on IndexedDB, which is what
// lets it be reasoned about (and tested) without a browser.
setCombineWriter(saveCombined)

// AudioBuffers are not tied to the context that allocated them, so one
// throwaway context is enough to rebuild what was stored.
let allocCtx: OfflineAudioContext | null = null
const alloc = () => (allocCtx ??= new OfflineAudioContext(2, 1, RENDER_SAMPLE_RATE))

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

// ── Why, where and when it broke ────────────────────────────────────────────
//
// Brae: "a mechanism to tell when anything breaks ... This should also give us
// more information on why, where, and when it has been breaking."
//
// Every diagnosis in this file so far has been reconstructed after the fact
// from a count that stopped moving, which is how a session goes into debugging
// the wrong thing. The loader now says what it is doing as it does it, and the
// last 200 events ride along in the diagnose report — so a capture from a
// stuck song carries its own history instead of one final number.
//
// Deliberately a ring buffer and deliberately small: this runs during playback,
// and an unbounded log on the audio path would become the next performance bug.
export type LoadEventKind =
  | 'job-start' | 'job-end' | 'layer-start' | 'layer-done'
  | 'window' | 'silent' | 'window-error' | 'layer-error' | 'job-error'
  | 'retry' | 'stall' | 'reset' | 'paused' | 'resumed' | 'gave-up'
  | 'server-on' | 'server-off'
  // ⚠️ Deliberately not in FAILURE_KINDS. The server declining a part — because
  // it needs samples that live only on this machine — is a normal answer, and
  // the clip plays live. Filing it as a failure is what made "gave up trying"
  // read like a broken loader instead of a missing feature.
  | 'server-refused'
  // Housekeeping, not trouble: what the once-a-session sweep threw away. Worth
  // a line because an unbounded cache is invisible until it is enormous, and
  // this one grew unbounded for its whole life without anyone seeing it.
  | 'pruned'

export interface LoadEvent {
  t: number             // ms since the page loaded — comparable with everything else
  kind: LoadEventKind
  layer?: string
  /** Clips finished / clips wanted, at the moment this happened. */
  done?: number
  total?: number
  ms?: number
  detail?: string
}

const LOG_MAX = 200
const eventLog: LoadEvent[] = []

const FAILURE_KINDS = new Set<LoadEventKind>(
  ['silent', 'window-error', 'layer-error', 'job-error', 'stall', 'reset', 'gave-up'])

function logEvent(kind: LoadEventKind, e: Omit<LoadEvent, 't' | 'kind'> = {}): void {
  // Mirror the bad ones into the journal so they outlive this module's ring and
  // land in the file. Only failures — the window-by-window timings are useful
  // live and would drown the log.
  if (FAILURE_KINDS.has(kind)) {
    void import('@/lib/diag-journal').then(m => m.diag('render', `loader ${kind}`, {
      layer: e.layer, detail: e.detail, done: e.done, total: e.total, ms: e.ms,
    })).catch(() => {})
  }
  eventLog.push({ t: Math.round(typeof performance !== 'undefined' ? performance.now() : Date.now()), kind, ...e })
  if (eventLog.length > LOG_MAX) eventLog.splice(0, eventLog.length - LOG_MAX)
  // Surface it the moment it happens, rather than waiting for someone to ask
  // for a diagnose report after the fact.
  if (FAILURE_KINDS.has(kind)) setProgress({ trouble: shortTrouble(kind, e.detail) })
  // A clean finish clears the warning, so a recovered stall stops nagging.
  else if (kind === 'job-end' && e.detail === 'complete') setProgress({ trouble: undefined })
}

/** The one-line version a loading bar has room for. */
function shortTrouble(kind: LoadEventKind, detail?: string): string {
  const what = kind === 'silent' ? 'a render came back silent'
    : kind === 'window-error' ? 'a render failed'
      : kind === 'layer-error' ? 'a layer failed'
        : kind === 'job-error' ? 'loading errored'
          : kind === 'stall' ? 'loading stalled, retrying'
            : kind === 'reset' ? 'loading was restarted'
              : 'gave up retrying'
  return detail ? `${what} (${detail.slice(0, 60)})` : what
}

/** The recent history of the loader, newest last. */
export function loadLog(): LoadEvent[] { return eventLog.slice() }

/** A one-line summary of what has gone wrong, for a report or a toast. */
export function loadTrouble(): string {
  const bad = eventLog.filter(e =>
    e.kind === 'silent' || e.kind === 'window-error' || e.kind === 'layer-error'
    || e.kind === 'job-error' || e.kind === 'stall' || e.kind === 'gave-up')
  if (!bad.length) return 'no failures recorded'
  const counts: Record<string, number> = {}
  for (const e of bad) counts[e.kind] = (counts[e.kind] ?? 0) + 1
  const last = bad[bad.length - 1]
  return `${Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(', ')} — last: ${last.kind}${last.layer ? ` in ${last.layer}` : ''}${last.detail ? ` (${last.detail})` : ''} at ${(last.t / 1000).toFixed(1)}s`
}

// ── Nothing is remembered as unrenderable ───────────────────────────────────
//
// There used to be a ledger here: clips that failed to render, counted as
// strikes in localStorage, given up on permanently at three. It is gone, and
// this note is what stands in its place because the reasoning matters.
//
// It could not tell the two cases apart. The render loop did not only exit when
// the song was finished — it broke when PLAY was pressed, and it broke when no
// window fit the budget, and on either of those every clip it had not reached
// was still "renderable" and so got struck. Press play while a song is baking,
// which is what everybody does, and clips that had never been attempted were
// condemned. Three sessions of that and they were condemned forever, on that
// browser: a progress bar stuck at 2 of 23, six clips reported as given up, and
// four tracks of live Apollo for the rest of the session.
//
// The premise underneath it was that a clip which will not render is a clip you
// cannot hear, so chasing it was expensive and giving up was a saving. That
// premise is false — see the bench at "The loader" below — so the saving buys
// nothing and the cost is real. A clip that will not render now simply plays
// live, and is asked again next time.
//
// The keys are removed on load so anyone carrying old condemnations gets those
// clips back on their next visit.
const LEGACY_STRIKE_KEYS = [
  'apollo-combine-strikes-v2', 'apollo-combine-strikes', 'apollo-combine-unrenderable',
]
// Guarded on `window`, not on `localStorage`. Node exposes a localStorage
// global that warns and throws unless the process was started with
// --localstorage-file, so testing for it directly puts a warning in every
// static-generation worker for a browser-only cleanup.
if (typeof window !== 'undefined') {
  try { for (const k of LEGACY_STRIKE_KEYS) localStorage.removeItem(k) } catch { /* private mode */ }
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
 * Has the user touched anything very recently?
 *
 * While this is true the loader is deliberately slow: windows shrink to a 250ms
 * budget and it rests 400–2000ms between passes, so baking never competes with
 * a drag. That is right for a drag and badly wrong for the case it used to
 * catch — `pointermove` was in this list, so simply MOVING THE MOUSE marked the
 * user busy, and the window is 1800ms. Someone watching the progress bar, whose
 * pointer drifts at all, held the loader in its slowest mode for the whole load.
 *
 * Measured on a 21-clip, 6-track song from a cold cache:
 *
 *     pointer still     25.7s, 19 passes
 *     pointer moving    55.8s, 21 passes
 *
 * The loader was 2.2x slower for the person actually looking at it, which is
 * every person who has ever complained that it is slow.
 *
 * So movement only counts while the pointer is DOWN — that is what a drag is.
 * Hovering, or a hand resting on a trackpad, no longer throttles anything.
 */
const BUSY_WINDOW_MS = 1800
let lastInputAt = 0
let pointerDown = false
export function noteUserInput(): void { lastInputAt = Date.now() }
function userIsBusy(): boolean { return pointerDown || Date.now() - lastInputAt < BUSY_WINDOW_MS }

if (typeof window !== 'undefined') {
  // Passive listeners on the capture phase: this only ever reads a clock, and
  // must never be the reason an interaction feels slow.
  for (const ev of ['pointerdown', 'keydown', 'wheel'] as const) {
    window.addEventListener(ev, noteUserInput, { capture: true, passive: true })
  }
  window.addEventListener('pointerdown', () => { pointerDown = true }, { capture: true, passive: true })
  for (const ev of ['pointerup', 'pointercancel'] as const) {
    window.addEventListener(ev, () => { pointerDown = false; noteUserInput() }, { capture: true, passive: true })
  }
  // Movement is only evidence of work in progress while a button is held.
  window.addEventListener('pointermove', () => { if (pointerDown) noteUserInput() }, { capture: true, passive: true })
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

// ── Real time by default ────────────────────────────────────────────────────
//
// Brae: "prerendering seems to be increasing the work needed. Let's switch to
// real time and continuous on the computer instead of cached."
//
// ⚠️ Prerendering is OFF. Every clip in the project used to be rendered through
// an OfflineAudioContext on load, before a note had been played — measured at
// 25.7s for a 21-clip, 6-track song (scripts/check-load-speed.mjs), with the
// main thread blocked in chunks throughout.
//
// That work only ever bought CHEAPER PLAYBACK, and it was buying something the
// app already had. Apollo is an AudioWorklet: live playback runs on the audio
// thread and costs the main thread nothing. The bake is the opposite — it runs
// on the main thread and is what makes the studio lock up. So the loading bar
// was spending real, visible time up front to avoid a cost that mostly was not
// there, on every open, for parts of the song the listener might never reach.
//
// No DAW does this. Ableton opens a set and plays it; instruments are computed
// live, audio streams from disk, and Freeze is a per-track command you invoke
// when a track is genuinely too expensive. That is the model here now: play
// live, and freeze when asked.
//
// The cache itself is kept in full — it is correct, it is well tested, and it
// is exactly what an explicit freeze and the offline/weak-device path want. It
// is simply no longer something that happens to you on open.
//
// ── BACK ON, 2026-09-02, because both reasons above have been answered ──────
//
// ⚠️ "Live playback costs the main thread nothing" WAS TRUE AND WAS NOT THE
// POINT. The main thread was never the constraint — the AUDIO thread is, and it
// is one thread that must finish every 128-sample block before its deadline.
// Measured, offline, best of three: one Apollo track playing chords costs 0.12
// of real time, four cost 0.37, eight cost 0.72. On a machine that is busy the
// same test measured 2.3 to 4.6. There is no headroom, which is why the same
// song plays in Safari and stops after one chord in Brave, and why days of
// leak, cache and churn fixes changed nothing: they reduced how much work there
// is, and the problem is how little time there is to do it in.
//
// ⚠️ AND THE 25.7 SECONDS OF BLOCKED MAIN THREAD IS GONE. That was the real
// objection, and it was correct: the bake ran through an OfflineAudioContext on
// the main thread. It now runs in a worker — 0.117x real time with an 11ms
// worst main-thread gap, against roughly eleven thousand inline. The thing that
// made prerendering unbearable is no longer how it works.
//
// Ableton is still the model: it does not bake a set on open. Nor does this —
// requestCombine is asked for by the SCHEDULER, for clips near the playhead, so
// the work follows the listener instead of preceding them.
let prerender = true

/** Turn the automatic bake off (a machine where the worker is unavailable, or a
 *  session where live synthesis is genuinely preferable). On is the default: see
 *  the measurement above for why. */
export function setPrerender(on: boolean): void { prerender = on }
export function prerenderOn(): boolean { return prerender }

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

/**
 * Forget lower rungs of the ladder once a better one has landed.
 *
 * Each fidelity layer caches under its own stamp, so without this a four-rung
 * song holds four renders of every clip — four times the memory, and
 * evictIfNeeded starts throwing away the beginning of the song to make room for
 * worse copies of it. `keep` is the set of keys for the rung that just
 * finished; anything else for those same clips is now superseded.
 */
function dropSupersededLayers(keep: string[]): void {
  const keepSet = new Set(keep)
  const clipIds = new Set(keep.map(k => k.slice(0, k.indexOf('|'))))
  for (const key of [...buffers.keys()]) {
    if (keepSet.has(key)) continue
    const clipId = key.slice(0, key.indexOf('|'))
    if (clipIds.has(clipId)) buffers.delete(key)
  }
}

/**
 * Where each cached render sits in the song, so eviction can be about MUSIC.
 *
 * Filled as wants are computed; a key whose clip is unknown simply has no
 * opinion and is evicted on insertion order, as before.
 */
const keyBeat = new Map<string, number>()

/**
 * Throw away what the listener is FURTHEST from, not what arrived first.
 *
 * ⚠️ This used to take `buffers.keys().next()` — Map insertion order. A song is
 * rendered from the beginning, so the first thing inserted is the OPENING, and
 * the opening is the one part of a song you hear on every single play. On any
 * device where the budget genuinely bites, the cache was systematically
 * discarding the most-heard music in the project and keeping the least-heard.
 *
 * Growing the budget to fit the project (setProjectNeed) hid this on roomy
 * machines and did nothing for small ones, which is exactly where it hurts:
 * a 2 GB phone gets a 60-second ceiling, and a seven-track song wants seven
 * times its own length of cache. There, eviction is not an edge case, it is
 * the normal state, and the order it happens in is the whole experience.
 *
 * The module already renders nearest-the-playhead first. Evicting
 * furthest-from-the-playhead is the same idea pointed the other way.
 */
function evictIfNeeded(): void {
  let frames = 0
  for (const b of buffers.values()) frames += b.length
  if (frames <= MAX_FRAMES) return

  // Sorted once per eviction rather than per removal: this runs after a render,
  // not in the audio path, and a scan per dropped clip would be quadratic on
  // precisely the small devices this exists to protect.
  const order = [...buffers.keys()].sort((a, b) => {
    const da = keyBeat.has(a) ? Math.abs(keyBeat.get(a)! - playheadBeat) : Infinity
    const db = keyBeat.has(b) ? Math.abs(keyBeat.get(b)! - playheadBeat) : Infinity
    return db - da                    // furthest away first
  })
  for (const key of order) {
    if (frames <= MAX_FRAMES || buffers.size <= 1) break
    frames -= buffers.get(key)?.length ?? 0
    buffers.delete(key)
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

export function setPlayhead(beat: number): void {
  if (!Number.isFinite(beat)) return
  playheadBeat = beat
  // Deliberately does not ask for a render here, even though baking now runs
  // during playback again. It does not need to: the scheduler already asks for
  // a combine whenever it meets a clip that is not baked, which is exactly when
  // there is something to do and no more often. Waking the baker on every
  // playhead tick as well would only add asks that the in-flight guard drops.
  //
  // The playhead matters for ORDER: byUrgency() sorts by distance from it, so
  // each layer that gets baked is the one you are about to hear.
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

/**
 * What the loader is, in one string, reported by combineStats().
 *
 * Minifiers strip comments and mangle identifiers, so neither can tell you
 * whether a deploy really carries a change — a marker has to be a string
 * LITERAL to survive. Chunk filenames are no help either: Vercel builds
 * remotely, so its content hashes differ from a local build of the same source.
 * This also lands in the diagnose report, so a capture from a user says which
 * loader produced it instead of leaving that to be guessed.
 */
export const LOADER_MODE = 'live-first-1'

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
    // ⚠️ 'resumed' was in the event type from the beginning and NOTHING ever
    // logged it. So the log recorded that playing stopped the work and never
    // that it started again — half of the story, and the half that makes the
    // other half measurable.
    //
    // Brae: "Keep the information of when the user hits play while it's loading
    // and when loading resumes. This way we can see how playing can get in the
    // way of loading." The gap between the `paused` above it and this line IS
    // the cost of listening while it loads.
    logEvent('resumed', {
      detail: pausedAt ? `after ${((Date.now() - pausedAt) / 1000).toFixed(1)}s of playback` : 'baking again',
    })
    pausedAt = 0
    requestCombine(lastBpm, lastGroups)
  }
}

// ── Server loading ──────────────────────────────────────────────────────────
//
// Brae: "let's have the AI detect when the computer is having trouble rendering
// the song quickly using error handling. When we detect that audio cuts or the
// loading has lots of errors, we can switch it to server loading."
//
// Two halves, and only one of them is a judgement call.
//
// The DETECTOR is the easy half and it is honest, because the loader has been
// writing down exactly the right things all along: renders that threw, renders
// that came back silent, clips set aside after a second failure, stalls, and
// clips given up on entirely. A machine that cannot keep up produces those; a
// machine that can does not. No guessing at CPU speed, no benchmark — the work
// itself is the measurement.
//
// The SWITCH is the half that has to be honest about what exists. Rendering on
// a server needs a machine that can run Apollo's engine, and that is real work
// with real infrastructure behind it. What exists today is storage: a render
// that has ALREADY been made can be served. So server loading asks for renders
// by content hash and uses what comes back; when nothing has been rendered for
// a song it says so plainly rather than pretending to be doing something.

let serverLoading = false
let serverFetchRunning = false
export function isServerLoading(): boolean { return serverLoading }

/**
 * Turn server loading on or off.
 *
 * Turning it ON parks local baking: the point is to stop this machine doing the
 * work, so continuing to bake in the background would be exactly the cost the
 * user was trying to escape.
 */
export function setServerLoading(on: boolean, why = 'chosen'): void {
  if (serverLoading === on) return
  serverLoading = on
  logEvent(on ? 'server-on' : 'server-off', { detail: why })
  // ⚠️ BOTH directions have to ask again. Turning it ON only parked the local
  // bake and then waited for something to call requestCombine — which nothing
  // does until the transport next asks for a clip, so the server was never
  // actually contacted and the switch looked like it did nothing.
  if (lastGroups) requestCombine(lastBpm, lastGroups)
}

/**
 * Is this machine struggling badly enough to be worth offering a way out?
 *
 * Deliberately a high bar. Offering to change how somebody's studio works is
 * an interruption, and one bad render is not a struggling computer — the loader
 * already retries, rests and recovers from those on its own. What it cannot
 * recover from is a pattern: several failures, or clips it has given up on, or
 * a job that has stopped making progress.
 */
export function loadIsStruggling(): { struggling: boolean; why: string } {
  const log = eventLog
  const recent = log.slice(-40)
  const errors = recent.filter(e => e.kind === 'window-error' || e.kind === 'layer-error' || e.kind === 'job-error').length
  const silent = recent.filter(e => e.kind === 'silent').length
  const stalls = recent.filter(e => e.kind === 'stall' || e.kind === 'reset').length
  // ⚠️ Read from the LOG, not from combineStats().givenUp — that counter is
  // structurally zero now ("nothing is condemned across sessions any more") and
  // a detector keyed on it would never fire.
  const given = recent.filter(e => e.kind === 'gave-up').length
  if (given > 0) return { struggling: true, why: `${given} part${given === 1 ? '' : 's'} could not be rendered on this machine` }
  if (stalls >= 2) return { struggling: true, why: 'loading has stalled more than once' }
  if (errors >= 3) return { struggling: true, why: `${errors} render failures` }
  if (silent >= 3) return { struggling: true, why: `${silent} renders came back silent` }
  return { struggling: false, why: '' }
}

/** When the bake last parked for playback, so 'resumed' can say how long. */
let pausedAt = 0

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
    // A clip holds ONE render, never two.
    //
    // Layers cache each rung under its own stamp, so without this a clip keeps
    // its dry copy alongside its filtered one, and a song sized for one render
    // per clip goes over budget the moment the second rung starts. Eviction
    // then takes the OLDEST buffers — the opening of the song, the part someone
    // is most likely to be listening to — and those clips drop back to the live
    // synth. Measured before this line existed: `ready` fell by 3 mid-load on a
    // 42-clip song.
    //
    // Dropping here rather than at the end of a rung also matters: a
    // whole-rung sweep would keep only the CURRENT rung's keys, and a clip that
    // failed to render in this rung would lose the only audio it had.
    dropSupersededLayers([w.key])
    landed.push(w.key)
    lastProgressAt = Date.now()      // the watchdog's only definition of alive
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
  /**
   * Which pass of the fidelity ladder is being built — "Adding filters (2 of 4)".
   *
   * The song is rendered dry first and the effects are layered over it, so
   * "17 of 23 clips" was answering a question nobody asked: every clip is
   * already audible, what is arriving is the SOUND. Brae: "We would need to
   * change the loading bar to Layers instead of track items."
   */
  layer?: string
  layerIndex?: number
  layerCount?: number
  /**
   * Set as soon as anything goes wrong, and shown in the loading bar.
   *
   * Brae: "a mechanism to tell when anything breaks". Everything this file has
   * ever got wrong looked, from the outside, exactly like slow — a count that
   * moved and then did not. A failure that the interface never mentions is one
   * the user reports as "it's just slow", weeks later, without the detail that
   * would have found it in a minute.
   */
  trouble?: string
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

/**
 * The fraction the bar is showing, held so it cannot fall.
 *
 * ⚠️ Brae: "When I played in the middle of loading, then I stopped playing the
 * loading bar had jumped back significantly."
 *
 * Two causes, and the guard covers both. Pressing play PARKS the bake, and
 * resuming restarts the current fidelity layer, so its own count begins again
 * near zero. And the layer-level updates reported `done/total` for the LAYER
 * while the job-level ones reported it for the whole JOB — two different
 * denominators feeding one bar, so it lurched even without a park.
 *
 * The denominator is now always the job (below). This is the belt as well as
 * the braces: a progress bar that goes backwards tells the user the work is
 * being lost, which is not what is happening and is the most alarming possible
 * way to say "still going".
 */
let progressFloor = 0

function setProgress(next: Partial<CombineProgress>): void {
  const merged = { ...progress, ...next }
  const total = merged.total || 0
  if (total > 0) {
    const frac = merged.done / total
    // A new job (or a finished one) resets the floor; otherwise hold the line.
    if (merged.phase === 'idle' || frac < progressFloor - 0.5) progressFloor = frac
    else if (frac < progressFloor) merged.done = Math.round(progressFloor * total)
    else progressFloor = frac
  }
  progress = merged
  for (const l of progressListeners) l(progress)
}

// The most recent request, so advancing the playhead can ask for the next
// window without the caller having to hand the groups over again.
let lastGroups: TrackRenderGroup[] | null = null
let lastBpm = 120
/** Someone asked for a render while the transport was running. Served on pause. */
let pendingWhilePlaying = false

/**
 * Book a follow-up for work a job left unfinished.
 *
 * Cleared whenever a job completes the song, so a run of bad luck early on does
 * not eat the budget for a later, legitimate retry.
 */
let retryAttempt = 0
let retryTimer: ReturnType<typeof setTimeout> | null = null
const RETRY_DELAYS_MS = [2000, 4000, 8000, 16000, 32000, 60000]

// ── When nothing is happening and something should be ───────────────────────
//
// Brae: "Can we set fallbacks so that it doesn't stop loading all of a sudden?
// Perhaps modular loading with a reset on break".
//
// The retry ladder covers a job that ENDED early. It cannot help a job that is
// still nominally alive — one awaiting a render that will never return, or a
// drain loop that lost its queue — because from the outside those look exactly
// like slow progress. So a watchdog watches the only thing that matters: has
// any clip landed lately.
//
// Two levels, because they are different faults. If nothing is running, the ask
// was simply dropped and re-asking is free. If something IS running and has
// produced nothing for a long time, that job is wedged; the in-flight flag is
// cleared so a fresh one can start. The wedged render cannot be cancelled — it
// finishes into a cache that no longer expects it, which is harmless — but the
// song stops being held hostage by it.
let lastProgressAt = Date.now()
let watchdog: ReturnType<typeof setInterval> | null = null
const STALL_MS = 25_000
const WEDGED_MS = 75_000

function startWatchdog(): void {
  if (watchdog || typeof setInterval !== 'function') return
  watchdog = setInterval(() => {
    const owed = lastGroups ? true : false
    if (!owed) return
    const quiet = Date.now() - lastProgressAt
    if (quiet < STALL_MS) return
    // Nothing outstanding? Then quiet is just "finished", not "stuck".
    if (!inFlight.size && !queue.length) {
      const stillMissing = lastWantedMissing()
      if (stillMissing <= 0) return
      logEvent('stall', { detail: `${stillMissing} clip(s) owed, nothing running for ${(quiet / 1000) | 0}s` })
      lastProgressAt = Date.now()
      if (lastGroups) requestCombine(lastBpm, lastGroups)
      return
    }
    if (quiet > WEDGED_MS) {
      logEvent('reset', { detail: `a job produced nothing for ${(quiet / 1000) | 0}s — starting a fresh one` })
      inFlight.clear()
      queue.length = 0
      draining = false
      lastProgressAt = Date.now()
      if (lastGroups) requestCombine(lastBpm, lastGroups)
    }
  }, 5000)
}

/** How many clips the last request still owes, for the watchdog. */
function lastWantedMissing(): number {
  if (!lastGroups) return 0
  let owed = 0
  for (const g of lastGroups) {
    for (const c of g.clips) {
      if (!c.notes.length) continue
      if (!buffers.has(combinedStamp(c, g.patch, lastBpm))) owed++
    }
  }
  return owed
}

function scheduleRetry(): void {
  if (retryTimer) return
  const delay = RETRY_DELAYS_MS[retryAttempt]
  if (delay == null) { logEvent('gave-up', { detail: `${RETRY_DELAYS_MS.length} retries exhausted` }); return }
  retryAttempt++
  logEvent('retry', { detail: `attempt ${retryAttempt} in ${delay / 1000}s` })
  retryTimer = setTimeout(() => {
    retryTimer = null
    if (lastGroups) requestCombine(lastBpm, lastGroups)
  }, delay)
}

/** A new project, or a reset, deserves a full set of attempts again. */
export function resetCombineRetries(): void {
  retryAttempt = 0
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
}

// ═══════════════════════════════════════════════════════════════════════════
//  The loader
// ═══════════════════════════════════════════════════════════════════════════
//
// Brae: "Can we start over with how this loads and create the loading system
// from scratch?"
//
// Yes — because one measurement overturned the premise the old one was built
// on, and almost everything in it existed to prop that premise up.
//
// The old loader treated baking as a PREREQUISITE for hearing a song. Beacon
// only warmed a live Apollo engine for the first two Apollo tracks, so a clip
// on the third track that had not been rendered yet was a clip you could not
// hear at all. Everything followed from that: baking during playback (which
// runs on the MAIN thread, and starved the note scheduler down to 0.35 of real
// time), a ledger of clips to permanently give up on, a retry ladder, a
// watchdog — machinery for making a mandatory step survive its own cost.
//
// scripts/bench-idle-engines.mjs asked what a live Apollo engine actually
// costs, with heavy presets (every oscillator, unison 4, filter, reverb + delay
// + EQ) and the CPU throttled to a third of this machine:
//
//     live Apollo tracks, nothing baked, 6s each
//      engines  audio clock  fps   verdict
//            1       1.000    60  fine
//            2       1.000    60  fine
//            4       0.999    60  fine
//            6       0.999    60  fine
//            8       1.000    60  fine
//
// Eight heavy tracks play live with no headroom problem whatsoever. Freezing is
// not how a song becomes audible; it is an optimisation that makes an
// already-audible song cheaper. Three rules follow, and this section is short
// because they are the entire design:
//
//   1. PLAYING ALWAYS WINS. No render is started while the transport runs, and
//      a render loop that finds the transport running parks. An optimisation
//      does not get to degrade the thing it optimises.
//
//   2. NOTHING IS EVER CONDEMNED. A clip that will not render plays live, and
//      is asked again from scratch next pass. The cross-session strike ledger
//      is gone: it could not tell a clip that had failed from a clip that had
//      never been attempted, and the loop abandoned clips it had never reached
//      every time play was pressed. That is Brae's song stuck at 2 of 23 with
//      six clips "given up".
//
//   3. A WINDOW IS THE UNIT OF FAILURE. One bad render loses one window, says
//      so in the log, and the loop carries on down the song.

interface Want { clip: MidiClip; patch: ApolloPatch; key: string }

/** The clips these groups want baked, each with the stamp it will cache under. */
function wantsOf(groups: TrackRenderGroup[], bpm: number): Want[] {
  const wants = groups.flatMap(g => g.clips
    .filter(c => c.notes.length > 0)
    .map(c => ({ clip: c, patch: g.patch, key: combinedStamp(c, g.patch, bpm) })))
  // So eviction knows which music is near the listener. Cheap to keep, and it
  // is the only place clip positions and cache keys are both in hand.
  for (const w of wants) keyBeat.set(w.key, w.clip.startBeat)
  return wants
}

/**
 * Clips set aside by the job now running. Transient by construction: it lives
 * in a module variable rather than localStorage, so the next job starts with a
 * clean slate and every clip gets asked again. Reported by combineStats() so a
 * capture can distinguish "still working" from "playing these live for now".
 */
let asideNow = 0

/**
 * Anything rendered in a previous session comes off disk instead of being
 * re-rendered — the difference between a reload costing a minute of synthesis
 * and costing nothing.
 *
 * In PARALLEL, because these are independent reads whose cost is latency, not
 * work: serially, twenty-one clips measured 1.6–2.8s of waiting in front of the
 * first sound. And skipped entirely where there is no storage, because asking
 * for thirty-nine clips that cannot exist is thirty-nine round trips to a
 * database that will answer "no".
 */
async function loadFromDisk(wants: Want[]): Promise<number> {
  const policy = await storagePolicy()
  if (policy.mode === 'none') return 0
  const pending = wants.filter(w => !buffers.has(w.key))
  if (!pending.length) return 0
  const WIDTH = 6
  let next = 0
  let got = 0
  await Promise.all(Array.from({ length: Math.min(WIDTH, pending.length) }, async () => {
    for (;;) {
      const w = pending[next++]
      if (!w) return
      try {
        const stored = await loadCombined(w.key, alloc())
        if (stored) { buffers.set(w.key, stored); got++; lastProgressAt = Date.now() }
      } catch { /* a clip that will not load simply renders instead */ }
    }
  }))
  void sweepOnce(pending, policy.quotaBytes)
  return got
}

/**
 * Throw away renders no project has wanted for a fortnight. Once per session.
 *
 * ⚠️ pruneCombined was written with this docstring — "so an edited project does
 * not grow forever" — AND NEVER CALLED FROM ANYWHERE. Nothing has ever deleted
 * a stamp. Every edit mints a new one and a combined render is 16-bit stereo
 * PCM, roughly 11 MB a minute of audio, so a project worked on for a week
 * leaves behind every intermediate version it ever had. That growth is the
 * reason loading got slower with each reload rather than merely being slow.
 *
 * AFTER loadFromDisk, never before: the reads have already taken what this
 * session wants, so a slow sweep cannot delay the first sound.
 *
 * Age AND absence, both — which is pruneCombined's own rule and worth keeping.
 * Deleting everything outside the current edit would make every undo, and every
 * reopening of yesterday's version, a full re-render.
 */
let swept = false
async function sweepOnce(wants: Want[], quotaBytes: number | null): Promise<void> {
  if (swept) return
  swept = true
  try {
    // ⚠️ Sized off the DEVICE, not off a number somebody liked. A quarter of the
    // origin's quota leaves room for the sound library, the projects and the
    // snapshots, all of which share it — and on a machine with almost nothing
    // free that quarter is correspondingly small, which is the right answer
    // rather than a policy that only works on a roomy laptop.
    const budget = quotaBytes != null ? quotaBytes * 0.25 : Infinity
    const dropped = await pruneCombined(new Set(wants.map(w => w.key)), undefined, budget)
    if (dropped) logEvent('pruned', { detail: `dropped ${dropped} stored render${dropped === 1 ? '' : 's'}` })
  } catch { /* best effort: a cache that will not prune must still play */ }
}

/**
 * Bake one rung of the fidelity ladder, in windows that follow the playhead.
 *
 * Clips are taken nearest-the-playhead first, so at load this renders the
 * opening of the song and after a seek it re-sorts around wherever you landed.
 * A window is sized by two independent limits, because they guard different
 * failures: BYTES, because renderManyToBuffer allocates one buffer spanning the
 * whole window and a badly shaped one reached 119 MB — desktop shrugs, iOS
 * kills the tab; and TIME, because a render blocks the main thread for its
 * entire duration and an unbounded window is an unbounded freeze.
 *
 * Returns false if it parked for playback rather than finishing the rung.
 */
async function bakeLayer(
  layerGroups: TrackRenderGroup[],
  bpm: number,
  label: string,
  layerIndex: number,
  layerCount: number,
  aside: Set<string>,
  silentOnce: Set<string>,
  /** The WHOLE job's counts. The bar is one bar, so it needs one denominator —
   *  reporting a layer's own progress into it is what made it lurch between
   *  layers even when nothing had gone wrong. */
  job?: () => { done: number; total: number },
): Promise<boolean> {
  const wants = wantsOf(layerGroups, bpm)
  logEvent('layer-start', { layer: label, total: wants.length })

  const spb = 60 / bpm
  const budgetBytes = renderBudgetBytes()
  if (!msPerUnit) msPerUnit = initialMsPerUnit()

  const missing = (): Want[] => wants.filter(w => !buffers.has(w.key))
  const renderable = (): Want[] => missing().filter(w => !aside.has(w.key))
  const doneCount = (): number => wants.length - missing().length

  /** The span a set of clips forces the renderer to cover, in seconds. */
  const spanSeconds = (set: Want[]): number => {
    if (!set.length) return 0
    const first = Math.min(...set.map(w => w.clip.startBeat))
    const last = Math.max(...set.map(w => w.clip.startBeat + w.clip.durationBeats))
    return (last - first) * spb + 2
  }
  /** What renderManyToBuffer will allocate for this set of clips. */
  const impliedBytes = (set: Want[]): number => {
    if (!set.length) return 0
    const tracks = new Set(set.map(w =>
      layerGroups.find(g => g.clips.some(c => c.id === w.clip.id))?.trackId)).size || 1
    return tracks * 2 * spanSeconds(set) * 48_000 * 4
  }
  /** Predicted render time: the synthesis plus the span it runs FX over. */
  const estimateMs = (set: Want[], voiceSec: number): number =>
    (voiceSec + SPAN_WEIGHT * spanSeconds(set)) * msPerUnit

  /** Clips ordered by how soon the playhead reaches them. */
  const byUrgency = (): Want[] => {
    const head = playheadBeat
    return [...renderable()].sort((a, b) => {
      // Anything the playhead has already passed goes last: it is only wanted
      // if the user scrolls back, and by then it can be fetched.
      const da = a.clip.startBeat + a.clip.durationBeats < head ? Infinity : Math.abs(a.clip.startBeat - head)
      const db = b.clip.startBeat + b.clip.durationBeats < head ? Infinity : Math.abs(b.clip.startBeat - head)
      if (da !== db) return da - db
      return a.clip.startBeat - b.clip.startBeat
    })
  }

  // The first window is small and the rest are wide. Time-to-first-sound is all
  // that matters at the start — nobody cares that bar 40 is missing when they
  // have not heard bar 1 — and after that, fewer bigger passes win, because
  // every render builds an offline context that is not reclaimed promptly and
  // so each pass costs more than the last.
  let headStartDone = false

  while (renderable().length) {
    // Rule 0: the user asked for this work to happen somewhere else.
    if (serverLoading) {
      setProgress({ ...progress, active: false, phase: 'paused' })
      logEvent('paused', { layer: label, detail: 'server loading is on — this machine is not rendering' })
      return false
    }
    // Rule 1, checked every pass: play may have been pressed while the last
    // render was running.
    if (transportPlaying) {
      setProgress({ ...progress, active: false, phase: 'paused' })
      pausedAt = Date.now()
      logEvent('paused', { layer: label, detail: 'playing live — baking resumes on pause' })
      return false
    }

    const order = byUrgency()
    if (!order.length) break

    const phase: 'head' | 'fill' = headStartDone ? 'fill' : 'head'
    // Measured floor for this shape of work. Tightening it further does not
    // keep shrinking the stall, because a window always takes at least one clip
    // and a single clip's render is atomic — the budget only decides whether a
    // SECOND one joins it. Rest longer while the user is dragging something:
    // the point of rendering ahead is that it stays invisible.
    const timeBudget = userIsBusy() ? 250 : 900
    const maxClips = phase === 'head' ? 2 : 8

    const window: Want[] = []
    let voiceSec = 0
    for (const w of order) {
      const vs = clipVoiceSeconds(w.clip, w.patch, spb)
      if (window.length) {
        if (impliedBytes([...window, w]) > budgetBytes) break
        if (estimateMs([...window, w], voiceSec + vs) > timeBudget) break
      }
      window.push(w)
      voiceSec += vs
      if (window.length >= maxClips) break
    }
    headStartDone = true
    if (!window.length) break

    const jp = job ? job() : { done: doneCount(), total: wants.length }
    setProgress({
      done: jp.done, total: jp.total, active: true, phase,
      layer: label, layerIndex, layerCount,
    })

    timings.attempts++
    const t0 = Date.now()
    let rendered: Map<string, AudioBuffer>
    try {
      rendered = await renderApolloProject(layerGroups, bpm, {
        only: new Set(window.map(w => w.clip.id)),
      })
    } catch (err) {
      // Rule 3. The whole job used to sit inside a single try, so one bad clip
      // ended every remaining layer with no retry booked and no record of it.
      const why = err instanceof Error ? err.message : String(err)
      logEvent('window-error', {
        layer: label, ms: Date.now() - t0, done: doneCount(), total: wants.length,
        detail: `${window.length} clip(s): ${why.slice(0, 120)}`,
      })
      for (const w of window) if (!aside.has(w.key)) { aside.add(w.key); asideNow++ }
      lastError = why
      await gap(Date.now() - t0)
      continue
    }

    const ms = Date.now() - t0
    logEvent('window', {
      layer: label, ms, done: doneCount(), total: wants.length,
      detail: `${window.length} clip(s)`,
    })
    // Every render is a calibration sample, which is why there is no separate
    // speed test: the work we want to predict is the work we just did.
    learnRenderCost(voiceSec + SPAN_WEIGHT * spanSeconds(window), ms)
    await keep(rendered, window)
    timings.batches++

    // A window that lands nothing must not stop the job. A silent render is
    // usually not the clip's fault — back-to-back offline contexts come back
    // silent because the finished ones have not been reclaimed yet — so rest
    // properly and try the same clips once more. Only a second silence sets
    // them aside, and only for this pass.
    if (!window.some(w => buffers.has(w.key))) {
      const keys = window.map(w => w.key)
      const secondTime = keys.every(k => silentOnce.has(k))
      logEvent('silent', {
        layer: label, ms, done: doneCount(), total: wants.length,
        detail: secondTime
          ? `${keys.length} clip(s), silent twice — playing live for this pass`
          : `${keys.length} clip(s), resting and retrying`,
      })
      for (const k of keys) silentOnce.add(k)
      if (secondTime) for (const k of keys) if (!aside.has(k)) { aside.add(k); asideNow++ }
      await new Promise(r => setTimeout(r, Math.max(1200, ms)))
      continue
    }

    await gap(ms)
  }

  logEvent('layer-done', { layer: label, done: doneCount(), total: wants.length })
  return true
}

/** One job: read what is already on disk, then climb the fidelity ladder. */
async function bake(bpm: number, groups: TrackRenderGroup[], wanted: Want[], jobKey: string): Promise<void> {
  const missing = (): Want[] => wanted.filter(w => !buffers.has(w.key))
  let owed = wanted.length
  let parked = false
  logEvent('job-start', { total: wanted.length, done: wanted.length - missing().length })

  try {
    const tDisk = Date.now()
    timings.fromDisk = await loadFromDisk(wanted)
    timings.diskMs = Date.now() - tDisk
    timings.renderMs = 0
    timings.attempts = 0

    // Rule 2: both of these are per-JOB, and neither is persisted.
    const aside = new Set<string>()
    const silentOnce = new Set<string>()
    asideNow = 0

    const tRender = Date.now()
    // The fidelity ladder: render the WHOLE song dry, then again at its real
    // sound. Each rung caches under its own stamp, and combinedStale() hands
    // playback the most recently written render of a clip — which is by
    // construction the best rung so far, so this needs no new playback path.
    const layers = layersFor(groups.map(g => g.patch))
    for (let li = 0; li < layers.length; li++) {
      const layer = layers[li]
      const layerGroups = layer.full
        ? groups
        : groups.map(g => ({ ...g, patch: patchForLayer(g.patch, layer) }))
      // ⚠️ A THROW IN ONE RUNG USED TO KILL THE LADDER. It propagated to the
      // job's catch, was filed as 'job-error', and every later rung — the ones
      // that sound BETTER — was skipped. 'layer-error' was declared in
      // LoadEventKind, given display text, counted by loadIsStruggling and
      // mirrored into the journal, for a state nothing could ever reach.
      //
      // A rung failing is not the job failing. The dry rung and the full rung
      // fail for different reasons, and the retry, stall and gave-up machinery
      // already bounds what this can cost.
      let finished = false
      try {
        finished = await bakeLayer(
          layerGroups, bpm, layerLabel(layers, li), li, layers.length, aside, silentOnce,
          () => ({ done: wanted.length - missing().length, total: wanted.length }),
        )
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e)
        logEvent('layer-error', { layer: layerLabel(layers, li), detail: lastError.slice(0, 160) })
        continue
      }
      if (!finished) { parked = true; break }
    }
    timings.renderMs = Date.now() - tRender

    owed = missing().length
    setProgress({
      done: wanted.length - owed, total: wanted.length,
      active: false, phase: parked ? 'paused' : 'idle',
    })

    // Say WHICH it was. "Would not render" was once reported for clips that had
    // rendered perfectly and were then evicted, and that wrong label cost real
    // time chasing a rendering bug that did not exist.
    //
    // A PARKED job is not a failed one, and must not be reported as one. It
    // stopped because someone pressed play, with every clip it had not reached
    // still perfectly renderable — it will finish them on the pause. Reporting
    // "25 of 25 clips play live" there is the same mistake in a new place, and
    // it is exactly the kind of wrong label that sends someone hunting a
    // rendering bug that does not exist.
    const atCeiling = MAX_FRAMES >= DEVICE_CEILING && projectFrames > DEVICE_CEILING
    lastError = !owed || parked ? null
      : atCeiling
        ? `${owed} of ${wanted.length} clips play live (song needs ${(projectFrames / 48_000) | 0}s of cache, device allows ${(DEVICE_CEILING / 48_000) | 0}s)`
        : `${owed} of ${wanted.length} clips play live`
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e)
    logEvent('job-error', { detail: lastError.slice(0, 160) })
  } finally {
    inFlight.delete(jobKey)
    if (parked || transportPlaying) { parked = true; pendingWhilePlaying = true }
    logEvent('job-end', {
      done: wanted.length - owed, total: wanted.length,
      detail: parked ? 'waiting for the pause' : owed === 0 ? 'complete' : `${owed} still owed`,
    })
    // A job books its own follow-up when it ends with work still owed, because
    // nothing else will: the only other things that ever ask again are the
    // scheduler hitting a miss during playback, and pausing. Load a song, never
    // press play, and without this the bar simply stops.
    if (owed === 0) retryAttempt = 0
    else if (!parked) scheduleRetry()
  }
}

/**
 * Ask for this project to be baked. Cheap and idempotent — the scheduler calls
 * it on every pass for every clip that is not yet cached, dozens of times a
 * second, so it returns immediately unless there is new work to start.
 */
/**
 * Ask the server for renders instead of making them here.
 *
 * ⚠️ This serves what has ALREADY been rendered. A clip's stamp is a content
 * hash of its notes, its patch and the tempo, which is identical for every
 * user — so a song rendered once can be served to everyone who opens it, and
 * that sharing is the actual prize rather than the CPU offload.
 *
 * Nothing renders on demand yet: a 404 means nobody has made this part, and
 * the honest thing is to say so and let the song play live, which it does
 * perfectly well. Pretending to load would be worse than the wait.
 */
async function fetchServerRenders(
  wanted: Want[],
  bpm: number,
  onProgress?: (done: number) => void,
): Promise<number> {
  let got = 0
  let made = 0
  const refused = new Map<string, number>()

  // Rendering a clip on the server costs a second or two, so asking for them
  // one at a time turns a 23-clip song into a minute of waiting. Small batches:
  // enough to hide the latency, not so many that one song monopolises the
  // renderer.
  const BATCH = 4
  const queue = wanted.filter(w => !buffers.has(w.key))

  for (let i = 0; i < queue.length; i += BATCH) {
    if (!serverLoading) break        // switched off mid-run
    await Promise.all(queue.slice(i, i + BATCH).map(async w => {
      if (buffers.has(w.key) || !serverLoading) return
      try {
        // Already rendered by somebody, somewhere: the whole point.
        const res = await fetch(`/api/render-clip?stamp=${encodeURIComponent(w.key)}`)
        if (res.ok) {
          const buf = await audioFromBytes(await res.arrayBuffer())
          if (buf) { buffers.set(w.key, buf); got++; onProgress?.(got) }
          return
        }
        if (res.status !== 404) {
          logEvent('window-error', { detail: `server render ${res.status}` })
          return
        }
        // ⚠️ This is the part that used to be missing, and the whole reason
        // server loading "gave up trying": a 404 was the end of the road,
        // because nothing anywhere ever MADE a render. Now a miss is a request.
        const body = await res.json().catch(() => null) as { renderer?: boolean } | null
        if (!body?.renderer) { bump(refused, 'no-renderer'); return }

        const made_ = await fetch('/api/render-clip', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ key: w.key, clipId: w.clip.id, notes: w.clip.notes, patch: w.patch, bpm }),
        })
        if (!made_.ok) { logEvent('window-error', { detail: `server render ${made_.status}` }); return }

        // A refusal comes back as JSON and a render as audio. Both are 200:
        // being told "not this one, and here is why" is a normal answer, not a
        // failure, and the clip simply plays live.
        if ((made_.headers.get('content-type') ?? '').includes('json')) {
          const why = await made_.json().catch(() => null) as { reason?: string } | null
          bump(refused, why?.reason ?? 'refused')
          return
        }
        const buf = await audioFromBytes(await made_.arrayBuffer())
        if (buf) { buffers.set(w.key, buf); got++; made++; onProgress?.(got) }
      } catch (err) {
        logEvent('window-error', { detail: `server render: ${String(err).slice(0, 90)}` })
      }
    }))
  }

  if (made) logEvent('layer-done', { detail: `the server rendered ${made} part${made === 1 ? '' : 's'}` })
  if (refused.size) {
    // ⚠️ Not 'gave-up'. Giving up is what this did when there was no renderer,
    // and it belongs to the honest-failure kinds that colour the log red and
    // count against the load in the admin report. A part the server declines —
    // because it needs samples only this machine has, say — is a part that
    // plays live, which is the normal, working state of the studio.
    logEvent('server-refused', {
      detail: [...refused].map(([why, n]) => `${n} ${SERVER_REFUSALS[why] ?? why}`).join(', '),
    })
  }
  return got
}

function bump(m: Map<string, number>, k: string): void { m.set(k, (m.get(k) ?? 0) + 1) }

/**
 * Save this project's audio for offline use — the manual, deliberate one.
 *
 * Brae: "We still want server rendering to work so that users can save their
 * projects from the cloud for offline use... But it will be manual."
 *
 * ⚠️ This is the ONLY thing that should ever reach for the server now. It is
 * not a loading strategy and it is not a fallback for a slow machine: playback
 * is real time and stays that way. This is a person deciding, once, that they
 * want this song on this device with no network — the aeroplane case.
 *
 * What it does: asks the server for every clip (rendering the ones nobody has
 * rendered yet), then writes them into local storage so the next open finds
 * them already there. Nothing here touches the transport, so it is safe to run
 * while the song plays — the renders arrive in the cache and are used the next
 * time each clip comes round.
 */
export async function saveForOffline(
  bpm: number,
  groups: TrackRenderGroup[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ saved: number; total: number; alreadyHad: number }> {
  const wanted = wantsOf(groups, bpm)
  if (!wanted.length) return { saved: 0, total: 0, alreadyHad: 0 }

  // Anything already on this device is already offline — no point paying for it
  // twice, and on a second run this makes the whole thing a no-op.
  const alreadyHad = await loadFromDisk(wanted)
  const missing = wanted.filter(w => !buffers.has(w.key))
  onProgress?.(alreadyHad, wanted.length)

  // fetchServerRenders reads `serverLoading` as its own kill switch, so it has
  // to be on for the length of this — but only for the length of this, and it
  // goes back however it was found rather than however it "should" be.
  const was = serverLoading
  serverLoading = true
  let got = 0
  try {
    got = await fetchServerRenders(missing, bpm, done => onProgress?.(alreadyHad + done, wanted.length))
  } finally {
    serverLoading = was
  }

  // Landing in `buffers` makes a clip playable NOW; writing it down is what
  // makes it playable next week on a plane.
  let saved = 0
  for (const w of wanted) {
    const buf = buffers.get(w.key)
    if (!buf) continue
    try { await keepForNextTime(w.key, buf); saved++ } catch { /* no storage — it still plays live */ }
  }
  logEvent('layer-done', {
    detail: `saved ${saved} of ${wanted.length} parts for offline use`,
  })
  return { saved, total: wanted.length, alreadyHad: alreadyHad + got - got }
}

/** Why the server would not render a part, in words rather than codes. */
const SERVER_REFUSALS: Record<string, string> = {
  'needs-samples': 'use sounds from your library, so they stay on this machine',
  'too-big': 'are too long to render on the server',
  'stamp-mismatch': 'did not match their fingerprint',
  'render-failed': 'the server could not render',
  'silent': 'came back silent from the server',
  'empty': 'have no notes',
  'no-renderer': 'have not been rendered and the server cannot make them',
}

/** Decode bytes from the server into a buffer this cache can hold. */
async function audioFromBytes(bytes: ArrayBuffer): Promise<AudioBuffer | null> {
  try { return await alloc().decodeAudioData(bytes) } catch { return null }
}

export function requestCombine(bpm: number, groups: TrackRenderGroup[]): void {
  if (!groups.length) return
  lastGroups = groups
  lastBpm = bpm

  // ⚠️ BEFORE the in-flight and playing guards, both of which return early.
  // Asking the server is not the same work as baking here: a local job that is
  // already running will park itself on its next pass (Rule 0), and waiting for
  // it to finish first would mean the switch did nothing until the bake it was
  // meant to stop had completed.
  if (serverLoading) {
    if (!serverFetchRunning) {
      serverFetchRunning = true
      const wantedNow = wantsOf(groups, bpm)
      setProgress({ done: 0, total: wantedNow.length, active: true, phase: 'head', layer: 'Loading from the server' })
      // Server rendering takes real seconds now that it actually renders, so the
      // bar has to move while it does — a frozen bar is how this looked when it
      // was doing nothing at all.
      void fetchServerRenders(wantedNow, bpm, done =>
        setProgress({ done, total: wantedNow.length, active: true, phase: 'head', layer: 'Loading from the server' }),
      ).then(got => {
        serverFetchRunning = false
        setProgress({ done: got, total: wantedNow.length, active: false, phase: 'idle', layer: undefined })
      })
    }
    return
  }

  const jobKey = 'project-combine'
  if (inFlight.has(jobKey)) return

  // Rule 1, at the door. During playback this is the path taken on every
  // scheduler pass, and all it does is write down that there is work waiting.
  // Refusing to START is stronger than parking mid-job: it means play can never
  // be pressed into a render that has already begun.
  if (transportPlaying) {
    pendingWhilePlaying = true
    if (progress.active) setProgress({ ...progress, active: false, phase: 'paused' })
    return
  }

  const wanted = wantsOf(groups, bpm)

  // Size the cache to this song before rendering into it, or it evicts the
  // opening of the song to make room for the end of it.
  const spb = 60 / bpm
  setProjectNeed(wanted.reduce((n, w) => n + Math.ceil(w.clip.durationBeats * spb * 48_000), 0))
  const done = wanted.filter(w => buffers.has(w.key)).length
  setProgress({ done, total: wanted.length, phase: 'idle', active: false })
  if (done === wanted.length) { retryAttempt = 0; return }

  inFlight.add(jobKey)
  startWatchdog()
  queue.push({ stamp: jobKey, run: () => bake(bpm, groups, wanted, jobKey) })
  void drain()
}

/** Drop everything (project close / user reset). */
export function clearCombined(): void {
  buffers.clear(); keyBeat.clear(); inFlight.clear(); failures.clear(); queue.length = 0
  resetCombineRetries()
}

/** Memory AND disk. Clearing only memory left the next request pulling every
 *  clip straight back off the disk, which looks cold from in here and is not. */
export async function clearCombinedEverywhere(): Promise<void> {
  clearCombined()
  await clearStoredCombines()
}

/** What the cache is doing. A combine that quietly fails looks exactly like one
 *  that has not happened yet — both play live — so make the difference visible. */
export function combineStats(): { ready: number; inFlight: number; queued: number; failed: [string, number][]; lastError: string | null; peaks: number[]; setAside: number; striking: number; givenUp: number; msPerUnit: number; renderSamples: number; frames: number; maxFrames: number; diskMs: number; renderMs: number; fromDisk: number; attempts: number; batches: number; loader: string; playingBake: string; progress: CombineProgress; log: LoadEvent[]; trouble: string } {
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
  return {
    // What the loader has been doing, and what has gone wrong — the answer to
    // "why, where and when".
    // The last 40 only. The ring holds 200 for a live look, but a diagnose
    // report gets pasted into a message, and 200 lines of window timings would
    // bury the one line that matters.
    log: loadLog().slice(-40),
    trouble: loadTrouble(),
    // The progress object the loading bar renders from. Exposed because a bar
    // that never appears and a bar that appears empty look identical from the
    // outside, and only one of them is a UI bug.
    progress: { ...progress },
    // Which loader this capture came from, and what it is doing right now.
    loader: LOADER_MODE,
    // Baking never runs during playback: playing is served by the live engine.
    playingBake: 'paused-only',
    ready: buffers.size, inFlight: inFlight.size, queued: queue.length,
    failed: [...failures], lastError, peaks,
    // Clips this pass is playing live rather than baking. Transient: the next
    // job asks for all of them again. Kept distinct from `failed` because a
    // clip set aside for contention is not a clip that is broken.
    setAside: asideNow,
    // Nothing is condemned across sessions any more, so these are structurally
    // zero. Kept so an old capture and a new one can still be read side by side.
    striking: 0,
    // What the cost model currently believes about this machine.
    msPerUnit: +msPerUnit.toFixed(2),
    renderSamples,
    givenUp: 0,
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
  // Drop every cached render, so the next play is a COLD one.
  //
  // Brae, on testing this: "make sure to clear the cache before each test or it
  // might skew the results." He is right — a warm cache turns any measurement
  // of the first play into a measurement of the cache. Clearing site data would
  // do it too, but that signs you out and throws away your projects; this
  // clears only the thing under test. Safe to ship: it costs a re-render, never
  // any of your work.
  ;(window as unknown as { __clearCombined?: typeof clearCombinedEverywhere }).__clearCombined = clearCombinedEverywhere
}
