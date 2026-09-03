'use client'
// Apollo as a DAW track instrument. One worklet engine per (context, track
// destination), fed absolute-time note events — works identically for live
// playback and offline renders (no setTimeout note-offs).
//
// Lifecycle: DawEngine preloads instruments (module + patch + samples) via
// preloadApolloInstrument; playApolloNote schedules events (queued until the
// engine is ready); apolloStopAll on transport stop panics + discards nodes
// (the DAW swaps its per-track input bus on stop, orphaning our connection).

import { ENGINE_VERSION } from '@/lib/apollo/engine-version'
import { ApolloEngine } from '@/lib/apollo/engine-client'
import { restorePatchSamples } from '@/lib/apollo/sample-store'
import type { ApolloPatch } from '@/lib/apollo/patch'

interface SchedEvent { t: number; type: 'noteOn' | 'noteOff'; note: number; vel?: number }

interface Managed {
  engine: ApolloEngine
  isReady: boolean
  queue: SchedEvent[]
  lastParams: ApolloPatch | null
  /**
   * This engine has been released and must not be handed out again.
   *
   * ⚠️ THE REASON A SECOND PLAY WAS SILENT. byDest is keyed by the destination
   * node, and the DAW used to swap that node on every stop — which quietly did
   * this job, because a released engine's entry became unreachable along with
   * the bus it was keyed by. Once the bus stopped being swapped (so engines
   * could be REUSED across a loop wraparound) the entry survived the release,
   * and ensure() went on returning it. Its node is null by then, so every note
   * scheduled onto it was posted into nothing: no error, no warning, silence.
   */
  released?: boolean
}

const byDest = new WeakMap<AudioNode, Managed>()
const byCtx = new WeakMap<BaseAudioContext, Set<Managed>>()
const ctxTempo = new WeakMap<BaseAudioContext, number>()

/** DawEngine reports the project tempo so synced LFOs/delays/env-sync follow it. */
export function setApolloCtxTempo(ctx: BaseAudioContext, bpm: number): void {
  ctxTempo.set(ctx, bpm)
  const set = byCtx.get(ctx)
  if (set) for (const m of set) { if (m.isReady) m.engine.setTransport({ bpm }) }
}

function create(ctx: BaseAudioContext, dest: AudioNode, patch: ApolloPatch): Managed {
  const engine = new ApolloEngine()
  const m: Managed = { engine, isReady: false, queue: [], lastParams: null }
  byDest.set(dest, m)
  let set = byCtx.get(ctx)
  if (!set) { set = new Set(); byCtx.set(ctx, set) }
  set.add(m)
  void engine.init({ ctx, destination: dest })
    .then(async () => {
      engine.sendPatch(patch)
      const bpm = ctxTempo.get(ctx)
      if (bpm) engine.setTransport({ bpm })
      m.lastParams = patch
      await restorePatchSamples(patch, engine)
      m.isReady = true
      if (m.queue.length) {
        engine.scheduleEvents(m.queue)
        m.queue = []
      }
    })
    .catch(() => { /* engine unavailable — notes drop silently */ })
  return m
}

function ensure(ctx: BaseAudioContext, dest: AudioNode, patch: ApolloPatch): Managed {
  let m = byDest.get(dest)
  // ⚠️ A released OR CRASHED engine is not a usable one.
  //
  // Crashed matters as much as released and was missing entirely: a processor
  // that throws keeps its entry here, so every note afterwards was scheduled
  // onto something rendering silence, and it never recovered until the page was
  // reloaded. The transport's bus swap used to hide this by orphaning the entry
  // on every stop; that swap is gone (it forced a rebuild per loop wraparound),
  // so recovery has to be deliberate.
  if (!m || m.released || m.engine.crashed) {
    if (m?.engine.crashed) {
      // Let the corpse go, or it renders zeros on the audio thread for ever.
      try { m.engine.release() } catch { /* already gone */ }
      m.released = true
    }
    m = create(ctx, dest, patch)
  }
  else if (m.isReady && m.lastParams !== patch) {
    // instrument edited (SET_INSTRUMENT replaces the params object)
    m.engine.sendPatch(patch)
    m.lastParams = patch
    void restorePatchSamples(patch, m.engine)
  }
  return m
}

/** Schedule one note (on + off) at absolute context time. */
export function playApolloNote(
  ctx: BaseAudioContext,
  dest: AudioNode,
  patch: ApolloPatch,
  pitch: number,
  velocity: number, // 0..127
  when: number,
  duration: number,
  /**
   * A filter for THIS note, applied inside the engine's own voice.
   *
   * ⚠️ The alternative was wiring a filter in front of the destination, and the
   * destination is what an engine is keyed by — so a per-note filter meant a
   * per-note engine, and one Apollo track grew to 68 live polysynths in 40
   * seconds of playing. Helios has a filter per voice already; this is the DAW
   * asking for it rather than building its own around the output.
   */
  noteFilter?: { cut?: number; res?: number },
): void {
  const m = ensure(ctx, dest, patch)
  const events: SchedEvent[] = [
    { t: when, type: 'noteOn', note: pitch, vel: Math.max(0.05, velocity / 127),
      ...(noteFilter ? { nf: noteFilter } : {}) },
    { t: when + Math.max(0.02, duration), type: 'noteOff', note: pitch },
  ]
  if (m.isReady) m.engine.scheduleEvents(events)
  else m.queue.push(...events)
}

/**
 * Wait until every Apollo instrument in this context has RECEIVED what was
 * posted to it — call between scheduling and startRendering().
 *
 * ⚠️ preloadApolloInstrument makes the engine ready BEFORE the scheduler runs;
 * this covers the gap AFTER it. The offline scheduler posts all its note events
 * in one synchronous pass and the render begins immediately, so events still in
 * flight are never played and the bounce comes back missing notes, with no
 * error. Measured at about one render in eight on a four-note chord: the render
 * that failed had only its first note in it.
 *
 * Engines that never came up are skipped rather than waited on — their notes
 * were already lost at preload, which warns separately.
 */
export async function apolloDrain(ctx: BaseAudioContext): Promise<void> {
  const set = byCtx.get(ctx)
  if (!set) return
  await Promise.all([...set].filter(m => m.isReady).map(m => m.engine.flush()))
}

/**
 * Wait until every engine in this context that is still coming up has come
 * up — call between scheduling and draining.
 *
 * ⚠️ THE SCHEDULER ITSELF CREATES ENGINES. preloadApolloInstrument warms one
 * per TRACK destination, but a clip with FX Motion (or any effect bar under
 * its notes) plays into a chain of its own, and an engine is keyed by its
 * destination — so the offline scheduling pass calls ensure() on a node nobody
 * preloaded, a fresh engine starts its async init, and the clip's notes go to
 * its queue. apolloDrain() flushes only READY engines, so that queue was never
 * delivered before startRendering(): every clip with FX Motion on an Apollo or
 * translated-poly track rendered as silence, with no error. (Live playback
 * hides it: the queue flushes when the engine comes up, a beat or so late.)
 */
export async function apolloAwaitReady(ctx: BaseAudioContext, timeoutMs = 8000): Promise<void> {
  const set = byCtx.get(ctx)
  if (!set) return
  const start = Date.now()
  const pending = () => [...set].filter(m => !m.released && !m.engine.crashed && !m.isReady)
  while (pending().length && Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, 25))
  }
  const left = pending().length
  if (left) console.warn(`[apollo] ${left} engine(s) created by the scheduler were not ready after ${timeoutMs}ms — their notes will be missing from this render`)
}

/**
 * How many Apollo engines are alive in this context.
 *
 * ⚠️ The number that separates "the song is heavy" from "we are building a
 * synth per clip". It cannot be read any other way from outside: an
 * AudioWorkletProcessor does not live in the JS heap, so a memory profiler
 * shows nothing however many of them are running.
 */
export function apolloEngineCount(ctx: BaseAudioContext): { live: number; ready: number } {
  const set = byCtx.get(ctx)
  if (!set) return { live: 0, ready: 0 }
  let live = 0, ready = 0
  for (const m of set) { if (!m.released) { live++; if (m.isReady) ready++ } }
  return { live, ready }
}

/** Warm module + patch + samples ahead of playback / offline render. */
export async function preloadApolloInstrument(
  ctx: BaseAudioContext,
  dest: AudioNode | undefined,
  patch: ApolloPatch,
): Promise<void> {
  if (!dest) {
    // no destination yet — at least warm the worklet module for this context
    // ⚠️ THE VERSION, or this serves a STALE ENGINE — and it is the path the DAW
    // takes. The service worker treats /apollo/engine.js as an ordinary asset
    // and answers it stale-while-revalidate: the cached copy is handed over
    // immediately and a fresh one is fetched for NEXT time. Unversioned, that
    // means the worklet running in Beacon is always the previous deploy's.
    //
    // Worse, whichever URL registers the processor FIRST wins for the whole
    // context — a later addModule of the other URL throws "already registered"
    // and is swallowed. So this one call, on a path that only runs when a track
    // has no destination yet, could pin every engine in the session to old code
    // while engine-client.ts was correctly asking for the new one.
    //
    // With the version in the query string every release is a distinct cache
    // key, so stale-while-revalidate can only ever serve the right build.
    try { await ctx.audioWorklet.addModule('/apollo/engine.js?v=' + ENGINE_VERSION) } catch { /* warmed elsewhere */ }
    return
  }
  const m = ensure(ctx, dest, patch)
  // wait until fully ready (samples included) so offline renders are complete
  const start = Date.now()
  while (!m.isReady && Date.now() - start < 8000) {
    await new Promise(r => setTimeout(r, 25))
  }
  if (!m.isReady) {
    // Giving up here is not harmless: the notes for this track were queued
    // against an engine that never came up, so they are dropped and the track is
    // simply ABSENT from the render — with no error anywhere. That is how a
    // bounce loses a whole part and still reports success.
    console.warn(`[apollo] instrument "${patch.name || 'patch'}" was not ready after 8s — ` +
      'its notes will be missing from this render')
  }
}

/** Transport stop: silence + drop every managed node for this context.
 *  (The DAW swaps per-track input buses on stop; nodes are recreated on the
 *  next play against the fresh bus.) */
/** Set a macro (0-7) on the Apollo engine bound to a track destination —
 * powers Beacon's macro automation lanes. No-op until the engine exists. */
export function setApolloTrackMacro(dest: AudioNode | undefined, index: number, value: number): void {
  if (!dest) return
  const m = byDest.get(dest)
  if (m?.isReady) m.engine.setMacro(index, value)
}

/** Set ANY Apollo parameter by patch path on the engine bound to a track
 *  destination — the playback half of Apollo motion recording. Paths are the
 *  same ones the Apollo UI sends (e.g. 'f1.cutoff', 'fx.<id>.mix'). */
export function setApolloTrackParam(dest: AudioNode | undefined, path: string, value: number): void {
  if (!dest) return
  const m = byDest.get(dest)
  if (m?.isReady) m.engine.setParam(path, value)
}

/**
 * @param release Destroy the engines as well as silencing them.
 *
 * ⚠️ THE TWO CASES ARE NOT THE SAME, and treating them alike is what made
 * playback expensive. A loop wraparound and a seek happen constantly — several
 * times a minute around a short loop — and they only need the engines QUIET.
 * An actual stop is the moment to give the CPU back.
 *
 * Releasing on every wraparound meant rebuilding every engine on the way round:
 * constructing an AudioWorkletNode, re-sending the patch, re-transferring its
 * samples, all on the main thread, at the exact moment the transport wants to
 * schedule the next pass. Measured on a seven-track song: 301 engines built
 * over 30 seconds of looping, against 2 once the two cases were told apart.
 */
export function apolloStopAll(ctx: BaseAudioContext, release = false): void {
  const set = byCtx.get(ctx)
  if (!set) return
  for (const m of set) {
    try {
      m.engine.clearScheduled()
      m.engine.panic()
      // ⚠️ SILENCED, NOT DESTROYED.
      //
      // Brae: "it still slows and stops playing audio after a few seconds,
      // usually only playing one chord or half of a chord before the audio cuts
      // out... probably by taking some things out that cause the stalling."
      //
      // panic() and clearScheduled() already make an engine silent — that is
      // what stopping needs. Releasing it as well meant the next play had to
      // BUILD every engine again: constructing an AudioWorkletNode, sending the
      // patch, and re-transferring its samples, all on the main thread, at
      // exactly the moment the transport wants to schedule the first notes.
      // A chord's worth of notes gets out while that is happening, and then
      // nothing does — which is the report, precisely.
      //
      // Keeping them costs an idle processor per track. A silent Helios voice
      // loop is close to free; rebuilding one is not.
      //
      // (An engine still ends properly when it should: release() on dispose,
      // and an offline render's engines die with its context, which is a
      // WeakMap key here.)
      //
      // The transport rebuilds these on the next play — including on every pass
      // around a LOOP, via _killAllSources — so a stop that only disconnects
      // leaves a fully live engine behind each time. And they were never
      // collected: wireResumeWatchdog() had added a closure over the engine to
      // `document` and to the shared AudioContext and never removed it, so
      // every engine ever built stayed reachable, with its worklet processor
      // still running on the audio thread.
      //
      // Measured before this change, 7-track song, a few minutes of ordinary
      // play/stop and looping: 544 worklets built, 544 still reachable after a
      // forced GC. The JS heap was flat throughout, because an
      // AudioWorkletProcessor does not live in it — which is why this looked
      // like "it just gets slower" with nothing to point at.
      if (release) {
        m.engine.release()
        // Both, and both matter: isReady is what playApolloNote checks before
        // scheduling, released is what ensure() checks before handing it back.
        m.isReady = false
        m.released = true
      }
    } catch { /* already gone */ }
  }
  // ⚠️ Kept unless they were actually destroyed. Clearing the set while the
  // engines still exist is how they get lost track of; keeping it while they
  // are gone would hand out dead ones. byDest keeps a live engine findable by
  // its destination, so the next play reuses it instead of building another.
  if (release) set.clear()
}
