// Effect bars — a region on a track's effect lane that carries the sound-
// settings params (`fx`, the "full-on" target) plus one automation `graph`
// (0..1 over the region). Every active param follows the graph together:
// g=0 → neutral/off, g=1 → the dialed-in value. A bar with one active param is
// just a single-effect region. Multiple bars/lanes = multiple graphs.

import type { RollFx, AutoPoint, ClipEffect } from './daw-types'
import { FX_FIELDS, fieldIsSet, type FxField } from './roll-fx'

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

// The params a bar can host: the post-source, graphable sound-settings fields.
// Excludes source-side envelope/pitch (attack, detune, vibrato…) which only
// make sense per synth voice, not on a track's mixed audio.
export const BAR_FIELDS: FxField[] = FX_FIELDS.filter(f => f.chain && f.graph)
export const BAR_CATS_HIDDEN = ['env', 'pitch'] as const   // categories to hide in the bar editor

/** The value an active param takes at graph position g (0=neutral, 1=target).
 *  Interpolated in the field's normalized space so log/bipolar fields sweep
 *  naturally (e.g. a low-pass glides open→target rather than linearly in Hz). */
export function barParamValue(field: FxField, target: number, g: number): number {
  const offNorm = field.toNorm(field.neutral)
  const tgtNorm = field.toNorm(target)
  return field.fromNorm(offNorm + (tgtNorm - offNorm) * clamp01(g))
}

/** The active (non-neutral) bar fields for a target bag. */
export function activeBarFields(fx: RollFx | undefined): FxField[] {
  if (!fx) return []
  return BAR_FIELDS.filter(f => fieldIsSet(f.key, fx[f.key]))
}

function flatGraph(dur: number, v: number): AutoPoint[] {
  const pt = (id: string, t: number): AutoPoint => ({ id, t, v, smooth: false, h1: [0, 0], h2: [0, 0] })
  return [pt('g0', 0), pt('g1', dur)]
}

/** A fresh empty bar — no effects yet; graph flat at full so the moment you dial
 *  an effect in you hear it, then shape it by editing the graph. */
export function makeEffectBar(trackId: string, startBeat: number, row: number, durationBeats = 4): ClipEffect {
  return {
    id: crypto.randomUUID(),
    trackId,
    startBeat: Math.max(0, startBeat),
    durationBeats,
    row,
    fx: {},
    graph: flatGraph(durationBeats, 1),
  }
}

/** Convert a legacy single-effect region into a bar (called on project load). */
export function legacyToBar(e: ClipEffect): ClipEffect {
  if (e.fx) return e
  const p = e.params ?? {}
  const fx: RollFx = {}
  switch (e.type) {
    case 'volume':     if (p.gain != null) fx.gain = p.gain; break
    case 'reverb':     fx.reverbWet = p.reverbWet ?? 0.4; break
    case 'delay':
      fx.delayWet = p.delayWet ?? 0.4
      if (p.delayTime != null) fx.delayTime = p.delayTime
      if (p.feedback != null)  fx.delayFeedback = p.feedback
      break
    case 'filter': {
      const t = p.filterType ?? 'lowpass'
      if (t === 'highpass') fx.highpassHz = p.frequency ?? 500
      else fx.filterHz = p.frequency ?? 2000
      if (p.filterQ != null) fx.filterQ = p.filterQ
      break
    }
    case 'tremolo':    fx.tremoloDepth = p.tremoloDepth ?? 0.5; if (p.tremoloRate != null) fx.tremoloRate = p.tremoloRate; break
    case 'distortion': fx.distortion = p.distortion ?? 0.5; break
    // 'pitch' was source-side — not representable as a track post-FX bar; dropped.
  }
  const graph: AutoPoint[] = e.automation?.points?.length
    ? e.automation.points
    : flatGraph(e.durationBeats, 1)
  return { id: e.id, trackId: e.trackId, startBeat: e.startBeat, durationBeats: e.durationBeats, row: e.row, fx, graph }
}
