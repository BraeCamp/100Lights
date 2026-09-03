// Which samples a patch can actually play.
//
// Its own file, and free of imports, for two reasons. It is pure, so it can be
// tested without a browser or an audio context. And engine-client.ts imports
// ApolloPatch as a value, which means the test loader cannot strip its types —
// a helper worth testing should not be trapped behind that.
//
// Why it exists: every offline render used to copy EVERY sample loaded in the
// engine into EVERY worklet node, and each copy is the whole audio buffer. The
// cost scaled with the user's LIBRARY rather than with the song being loaded —
// invisible when a patch meant one drum hit, and ruinous once multisampled
// instruments arrived, because a single piano is 42 buffers and a two-clip
// render copied all of them twice.
//
// Getting this wrong in the other direction is worse than slow: miss a sample a
// patch DOES use and the render comes back silent, which the cache reads as a
// failed clip and retries. So this errs toward naming everything reachable.

/** The shape this needs — deliberately loose, because it reads saved projects. */
export interface SampleReferencingPatch {
  oscs?: ({
    smp?: { sampleId?: string | null } | null
    gran?: { sampleId?: string | null } | null
    spec?: { sampleId?: string | null } | null
    ms?: { zones?: ({ sampleId?: string | null } | null)[] | null } | null
  } | null)[] | null
  noise?: { sampleId?: string | null } | null
}

/**
 * Every sample id the patch can reach.
 *
 * An oscillator can name one through its sampler, granular or spectral engine,
 * and a multisample names one PER ZONE — missing a zone leaves a hole in the
 * keyboard rather than raising anything. The noise source has one too.
 */
export function samplesUsedBy(patch: SampleReferencingPatch | null | undefined): Set<string> {
  const ids = new Set<string>()
  if (!patch) return ids
  const add = (v?: string | null) => { if (v) ids.add(v) }
  for (const o of patch.oscs ?? []) {
    if (!o) continue
    add(o.smp?.sampleId)
    add(o.gran?.sampleId)
    add(o.spec?.sampleId)
    for (const z of o.ms?.zones ?? []) add(z?.sampleId)
  }
  add(patch.noise?.sampleId)
  return ids
}
