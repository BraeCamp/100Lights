// Rendering a song in layers of FIDELITY, not of coverage.
//
// Brae: "loads the song without any filters or changes then loads filters over
// the song one or a few at a time."
//
// The loader used to bake clips at full quality, one clip at a time. That means
// the parts of the song you have not reached yet are simply not there — and on
// a slow machine, most of the song is "not there" for a long time. Rendering
// the WHOLE song dry first inverts that: everything is audible almost
// immediately, and the effects arrive afterwards, over the top.
//
// It pays for itself because effects are most of the cost. Measured on a
// 4-track, 16-clip song: 5.3s dry against 7.7s with one filter and four FX,
// and 1.67 against 3.05 ms per unit of audio — so a dry pass lands the whole
// song for a bit over half the price. freeze-cache.ts saw the same thing from
// the other end: "the Rim track has notes sounding for 7% of its clips and
// still took 5,283ms of a 33s render — almost all of it reverb ticking over
// behind silence."
//
// The trade is real and worth stating: total work goes UP, because the dry pass
// is extra. Time to hearing the whole song roughly halves; time to final
// quality roughly doubles. That is the trade Brae asked for — "so that it at
// least plays something if the loading is too slow".
//
// Nothing here mutates the patch it is given: a layer is a COPY with parts
// switched off, because the original is the project's own data and the final
// layer has to be the real thing, unchanged.

import type { ApolloPatch } from './patch'

/** One rung of the ladder. `id` is stable and appears in the progress bar. */
export interface RenderLayer {
  id: 'dry' | 'filters' | 'effects' | 'sends'
  /** What the loading bar says while this layer is being built. */
  label: string
  /** The last rung is the project's real sound, and must be byte-for-byte it. */
  full: boolean
}

const LADDER: RenderLayer[] = [
  { id: 'dry', label: 'The song, no effects', full: false },
  { id: 'filters', label: 'Adding filters', full: false },
  { id: 'effects', label: 'Adding effects', full: false },
  { id: 'sends', label: 'Adding sends', full: true },
]

const hasFx = (p: ApolloPatch): boolean => (p.fxMain?.length ?? 0) > 0
const hasSends = (p: ApolloPatch): boolean =>
  (p.fxBus1?.length ?? 0) > 0 || (p.fxBus2?.length ?? 0) > 0
const hasFilters = (p: ApolloPatch): boolean => (p.filters ?? []).some(f => f?.enabled)

/**
 * The rungs worth climbing for these patches.
 *
 * A layer only earns its place if it CHANGES something: a song with no effects
 * anywhere gets one layer, and rendering it twice to arrive at the same audio
 * would be pure waste. The last rung is always the full patch, so a song whose
 * every layer is skipped still renders exactly once, at full quality — the
 * behaviour before any of this existed.
 */
export function layersFor(patches: ApolloPatch[], opts: { detailed?: boolean } = {}): RenderLayer[] {
  const anyFilters = patches.some(hasFilters)
  const anyFx = patches.some(hasFx)
  const anySends = patches.some(hasSends)

  // Nothing to strip: one pass, the real patch.
  if (!anyFilters && !anyFx && !anySends) return [{ ...LADDER[3], label: 'Loading the song' }]

  // ── Two rungs, not four ───────────────────────────────────────────────────
  //
  // Brae: "Does it have loading redundancies? That would be a problem that we
  // need to fix." It did, and this was the biggest one — mine.
  //
  // Every rung re-renders the WHOLE song. Four rungs is four times the render
  // work for the same final audio, and on a machine a third the speed of the
  // one this was designed on, that is the difference between a song that loads
  // and a song that never finishes. The intermediate rungs were also the least
  // valuable: "with filters but no effects" is not a state anyone asked to
  // hear. What was asked for is hearing the song at all, immediately, and then
  // hearing it properly.
  //
  // So: dry, then the real patch. Half the work of the four-rung ladder, and it
  // keeps the whole point of it. `detailed` restores the full climb for anyone
  // who wants to watch the effects arrive one at a time.
  const finalRung: RenderLayer = anySends
    ? LADDER[3]
    : { ...LADDER[3], id: 'sends', label: 'Adding the effects', full: true }

  // ── One pass, not two ─────────────────────────────────────────────────────
  //
  // Brae: "let's see about changing the loading type so that when loading it
  // doesn't do filter and no effect audio separately. Let's put them back
  // together now that we've corrected some stuff."
  //
  // The dry rung existed to get SOMETHING audible quickly, and its cost was
  // never only the extra render — it was that the something was audibly wrong.
  // The song arrives without its filters or effects, plays like that for a
  // while, and then changes underneath you. That is indistinguishable from the
  // bugs we have just spent a long time fixing, and it trains you to distrust
  // what you are hearing.
  //
  // It is also unnecessary. Combining is an OPTIMISATION: an uncombined song
  // plays live, correctly and with every effect, from the first press of play.
  // The dry rung was never the difference between hearing the song and not —
  // only between hearing a wrong version sooner and the right version later.
  //
  // So the default is a single full-fidelity pass. Half the render work of the
  // two-rung version, and nothing is ever heard in a state the song is not in.
  // `detailed` still restores the whole climb for watching the effects arrive.
  // Named for what it is now: one pass that renders the song as it actually
  // sounds. "Adding the effects" described a rung that arrived AFTER a dry one
  // and would read as a stage in a sequence that no longer exists.
  if (!opts.detailed) return [{ ...finalRung, label: 'Loading the song' }]

  const out: RenderLayer[] = [LADDER[0]]
  if (anyFilters) out.push(LADDER[1])
  if (anyFx) out.push(LADDER[2])
  out.push(finalRung)
  return out.filter((l, i, a) => i === 0 || l.id !== a[i - 1].id)
}

/**
 * The patch as it should sound AT this layer.
 *
 * Returned by reference when nothing is removed, so the final layer renders the
 * caller's own object — the audio at the top of the ladder must be identical to
 * the audio with no ladder at all, and copying invites a subtle difference.
 */
export function patchForLayer(patch: ApolloPatch, layer: RenderLayer): ApolloPatch {
  if (layer.full) return patch

  const p: ApolloPatch = { ...patch }
  // Filters are switched off rather than removed: the array's shape is part of
  // the patch (routing indexes into it) and a shorter one would mean something
  // different.
  if (layer.id === 'dry') {
    p.filters = (patch.filters ?? []).map(f => ({ ...f, enabled: false })) as ApolloPatch['filters']
  }
  // Effects come off for every layer below 'effects'.
  if (layer.id === 'dry' || layer.id === 'filters') {
    p.fxMain = []
  }
  // Sends are the last thing added, so everything below the top loses them.
  p.fxBus1 = []
  p.fxBus2 = []
  return p
}

/** "Adding filters (2 of 4)" — what the loading bar actually shows. */
export function layerLabel(layers: RenderLayer[], index: number): string {
  const l = layers[index]
  if (!l) return 'Loading the song'
  return layers.length > 1 ? `${l.label} (${index + 1} of ${layers.length})` : l.label
}
