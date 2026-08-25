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

/**
 * How much a SINGLE render pass may allocate.
 *
 * Separate from the cache ceiling above, and it has to be: the cache is what we
 * hold, this is the transient spike while rendering, and it is the spike that
 * kills a phone. iOS reclaims a tab well below the numbers a laptop shrugs at,
 * and it does it by reloading the page — which is what "the page keeps
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
export function setPlayhead(beat: number): void {
  if (Number.isFinite(beat)) playheadBeat = beat
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
export function setTransportPlaying(v: boolean): void { transportPlaying = v }

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
const RENDER_GAP_IDLE_MS = 350     // nobody listening — get it done
const RENDER_GAP_PLAYING_MS = 1500 // someone listening — leave room to draw
const gap = () => new Promise<void>(r =>
  setTimeout(r, transportPlaying ? RENDER_GAP_PLAYING_MS : RENDER_GAP_IDLE_MS))


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
  // Size the cache to this song before rendering into it, or it evicts the
  // opening of the song to make room for the end of it.
  const spb = 60 / bpm
  setProjectNeed(wanted.reduce((n, w) => n + Math.ceil(w.clip.durationBeats * spb * 48_000), 0))
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

        while (renderable().length) {
          const queue2 = byUrgency()
          const window: typeof queue2 = []
          for (const w of queue2) {
            if (window.length && impliedBytes([...window, w]) > budgetBytes) break
            window.push(w)
            // Even inside budget, keep windows small enough to stay responsive.
            if (window.length >= 4) break
          }
          if (!window.length) break
          timings.attempts++
          const before = buffers.size
          const rendered = await renderApolloProject(groups, bpm, {
            only: new Set(window.map(w => w.clip.id)),
          })
          await keep(rendered, window)
          timings.batches++
          // A window that lands nothing would loop forever on the same clips.
          if (buffers.size === before) { rememberBad(window.map(w => w.key)); break }
          await gap()
        }
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
        timings.renderMs = Date.now() - tRender
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
export function combineStats(): { ready: number; inFlight: number; queued: number; failed: [string, number][]; lastError: string | null; peaks: number[]; striking: number; givenUp: number; frames: number; maxFrames: number; diskMs: number; renderMs: number; fromDisk: number; attempts: number; batches: number } {
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
