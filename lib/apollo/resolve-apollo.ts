// Which tracks are Apollo tracks, and with what patch.
//
// ⚠️ This lived only inside DawEngine, as a private method, and now has a
// second caller: "Save for offline" works from a project LIST, where there is
// no engine — just a saved file. A second copy of this logic would be a quiet
// disaster rather than a duplication problem, because a clip's cache key is a
// hash of its PATCH. Resolve a track even slightly differently here and the
// offline save renders audio under keys that playback will never ask for: the
// save appears to work, costs a full render, and buys nothing.
//
// So the decision lives here once, and the engine calls it too.

import { translateInstrument } from './daw-synth'
import { fatPatch } from './patch-diff'
import type { TrackRenderGroup } from './daw-freeze'
import type { ApolloInstrumentParams, DawProject, DawTrack, MidiClip } from '@/lib/daw-types'

/** The caches DawEngine keeps across calls. Both are keyed on the params
 *  OBJECT, and that identity is load-bearing: _apolloGroups() decides whether
 *  to rebuild by comparing resolved patches with ===, so returning a fresh
 *  object each time would rebuild every group on every scheduler pass. */
export interface ApolloResolveCache {
  fat: WeakMap<object, ApolloInstrumentParams>
  translated: WeakMap<object, ApolloInstrumentParams | null>
}

export const newApolloResolveCache = (): ApolloResolveCache => ({
  fat: new WeakMap(),
  translated: new WeakMap(),
})

/**
 * The Apollo patch this track plays through, or null if it is not an Apollo
 * track at all (a sampler, a drum kit, a plugin, or a synth that has opted out).
 */
export function apolloPatchFor(
  track: DawTrack,
  cache?: ApolloResolveCache,
): ApolloInstrumentParams | null {
  const inst = track.instrument
  if (!inst) return null

  if (inst.type === 'apollo') {
    // Expand HERE, at the point of use. Patches are stored as a diff from Init
    // to keep projects small, and hydrating on the project-load path alone was
    // too fragile: a cloud project loads through ProjectEditor, which never
    // called it, so the engine got a patch with no oscillators — silent, and
    // cheap enough that it did not even feel slow. A complete patch
    // round-trips unchanged.
    const key = inst.params as object
    const hit = cache?.fat.get(key)
    if (hit) return hit
    const fat = fatPatch(inst.params) as unknown as ApolloInstrumentParams
    cache?.fat.set(key, fat)
    return fat
  }

  if (inst.type !== 'poly' && inst.type !== 'wavetable' && inst.type !== 'fm') return null
  // poly translates faithfully (same primitives) → Helios by default.
  // wavetable + fm map approximately (tables / PM-vs-FM) → explicit opt-in.
  if (inst.type === 'poly' ? track.heliosSynth === false : track.heliosSynth !== true) return null

  const key = inst.params as object
  const cached = cache?.translated.get(key)
  if (cached !== undefined) return cached
  const patch = translateInstrument(inst) as ApolloInstrumentParams | null
  cache?.translated.set(key, patch)
  return patch
}

/**
 * The render groups for a saved project — the same shape DawEngine builds from
 * its live state, from a file instead.
 *
 * Clips with no notes are dropped, and so are tracks left with no clips: both
 * would render silence, and a silent render is indistinguishable from a failed
 * one everywhere downstream.
 */
export function apolloGroupsForProject(project: DawProject): TrackRenderGroup[] {
  const clips = (project.arrangementClips ?? []).filter(
    (c): c is MidiClip => (c as MidiClip).kind === 'midi' && ((c as MidiClip).notes?.length ?? 0) > 0,
  )
  return (project.tracks ?? [])
    .map(t => ({ trackId: t.id, patch: apolloPatchFor(t) }))
    .filter((x): x is { trackId: string; patch: ApolloInstrumentParams } => !!x.patch)
    .map(x => ({
      trackId: x.trackId,
      patch: x.patch as unknown as TrackRenderGroup['patch'],
      clips: clips.filter(c => c.trackId === x.trackId),
    }))
    .filter(g => g.clips.length > 0)
}
