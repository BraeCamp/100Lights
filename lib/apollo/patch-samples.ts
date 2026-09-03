// Which samples a patch refers to — a pure question about the patch.
//
// ⚠️ Extracted from sample-store.ts because that module is `'use client'`, and
// the server render route needs this to decide whether a patch can be rendered
// without the user's library. Calling it across that boundary fails at RUNTIME,
// not at build: "Attempted to call referencedSampleIds() from the server but
// referencedSampleIds is on the client." Nothing here touches storage, audio or
// the DOM, so nothing here belongs on one side of that line.

import type { ApolloPatch } from './patch'

export function referencedSampleIds(patch: ApolloPatch): string[] {
  const ids = new Set<string>()
  for (const o of patch.oscs) {
    if (o.smp.sampleId) ids.add(o.smp.sampleId)
    if (o.gran.sampleId) ids.add(o.gran.sampleId)
    if (o.spec.sampleId) ids.add(o.spec.sampleId)
    for (const z of o.ms.zones) ids.add(z.sampleId)
  }
  if (patch.noise.sampleId) ids.add(patch.noise.sampleId)
  return [...ids]
}
