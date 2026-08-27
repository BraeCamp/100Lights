'use client'
// Apollo as a DAW track instrument. One worklet engine per (context, track
// destination), fed absolute-time note events — works identically for live
// playback and offline renders (no setTimeout note-offs).
//
// Lifecycle: DawEngine preloads instruments (module + patch + samples) via
// preloadApolloInstrument; playApolloNote schedules events (queued until the
// engine is ready); apolloStopAll on transport stop panics + discards nodes
// (the DAW swaps its per-track input bus on stop, orphaning our connection).

import { ApolloEngine } from '@/lib/apollo/engine-client'
import { restorePatchSamples } from '@/lib/apollo/sample-store'
import type { ApolloPatch } from '@/lib/apollo/patch'

interface SchedEvent { t: number; type: 'noteOn' | 'noteOff' | 'bend'; note?: number; vel?: number; semis?: number; ch?: number }

/** One point of a drawn pitch contour: `semis` away from the note, at time `t`. */
export interface BendPoint { t: number; semis: number }

interface Managed {
  engine: ApolloEngine
  isReady: boolean
  queue: SchedEvent[]
  lastParams: ApolloPatch | null
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
  if (!m) m = create(ctx, dest, patch)
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
  /** A drawn pitch contour, already sampled to absolute context time. Bends the
   *  SOUNDING voice, so one note can travel between pitches without a second
   *  noteOn — see craft.glideLine / clip.pitchGraph. */
  bend?: BendPoint[],
): void {
  const m = ensure(ctx, dest, patch)
  const events: SchedEvent[] = [
    { t: when, type: 'noteOn', note: pitch, vel: Math.max(0.05, velocity / 127) },
    { t: when + Math.max(0.02, duration), type: 'noteOff', note: pitch },
  ]
  if (bend?.length) {
    for (const b of bend) events.push({ t: b.t, type: 'bend', semis: b.semis, ch: 0 })
    // The bend is per-CHANNEL, so it must be put back afterwards or the next
    // note on this track starts transposed — the "MIDI plays a few notes higher"
    // bug, arrived at from a different direction.
    events.push({ t: when + Math.max(0.02, duration) + 0.005, type: 'bend', semis: 0, ch: 0 })
  }
  if (m.isReady) m.engine.scheduleEvents(events)
  else m.queue.push(...events)
}

/** Warm module + patch + samples ahead of playback / offline render. */
export async function preloadApolloInstrument(
  ctx: BaseAudioContext,
  dest: AudioNode | undefined,
  patch: ApolloPatch,
): Promise<void> {
  if (!dest) {
    // no destination yet — at least warm the worklet module for this context
    try { await ctx.audioWorklet.addModule('/apollo/engine.js') } catch { /* warmed elsewhere */ }
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

export function apolloStopAll(ctx: BaseAudioContext): void {
  const set = byCtx.get(ctx)
  if (!set) return
  for (const m of set) {
    try {
      m.engine.clearScheduled()
      m.engine.panic()
      m.engine.node?.disconnect()
    } catch { /* already gone */ }
  }
  set.clear()
  // byDest entries die with their (now unreferenced) dest nodes
}
