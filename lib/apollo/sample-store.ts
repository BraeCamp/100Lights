'use client'
// Apollo sample persistence: user-loaded samples (and image-derived spectra)
// are written into the 100Lights Sound Library (IndexedDB + account sync), and
// re-fulfilled into the engine when a patch that references them loads. This
// is what makes patches survive reloads and follow the account.

import { initLibrary, libraryAdd, libraryGetById, LibraryEntry } from '@/lib/sound-library'
import { libraryFulfill } from '@/lib/default-samples'
import { audioBufferToWav, blobToAudioBuffer } from '@/lib/wav-encoder'
import type { ApolloPatch } from '@/lib/apollo/patch'
import type { ApolloEngine } from '@/lib/apollo/engine-client'
import type { SpectralAnalysis } from '@/lib/apollo/spectral'

export function initApolloLibrary(userId: string | null): void {
  initLibrary(userId)
}

/** Persist a user-loaded sample so patches referencing it survive reloads. */
export async function persistApolloSample(id: string, name: string, buffer: AudioBuffer): Promise<void> {
  try {
    if (await libraryGetById(id)) return
    const entry: LibraryEntry = {
      id,
      name: name || 'Apollo sample',
      category: 'custom',
      audioBlob: audioBufferToWav(buffer),
      duration: buffer.duration,
      addedAt: new Date().toISOString(),
      folder: 'Apollo',
      tags: ['apollo-sample'],
    }
    await libraryAdd(entry)
  } catch { /* persistence is best-effort; the in-memory session still works */ }
}

// Image-derived spectra have no audio; serialize the analysis itself.
// Layout: [frames, bins, hop, sr] as Float64 header, then mags Float32.
export async function persistApolloSpectral(id: string, name: string, an: SpectralAnalysis): Promise<void> {
  try {
    if (await libraryGetById(id)) return
    // copy into fresh ArrayBuffers so TS accepts them as BlobParts
    const bytes = new Uint8Array(32 + an.mags.byteLength)
    new Float64Array(bytes.buffer, 0, 4).set([an.frames, an.bins, an.hop, an.sr])
    bytes.set(new Uint8Array(an.mags.buffer, an.mags.byteOffset, an.mags.byteLength), 32)
    const blob = new Blob([bytes.buffer], { type: 'application/octet-stream' })
    await libraryAdd({
      id,
      name: name || 'Apollo image spectrum',
      category: 'custom',
      audioBlob: blob,
      duration: 0,
      addedAt: new Date().toISOString(),
      folder: 'Apollo',
      tags: ['apollo-image-spectral'],
    })
  } catch { /* best-effort */ }
}

async function decodeSpectralBlob(blob: Blob): Promise<SpectralAnalysis> {
  const buf = await blob.arrayBuffer()
  const header = new Float64Array(buf, 0, 4)
  const frames = header[0], bins = header[1], hop = header[2], sr = header[3]
  const mags = new Float32Array(buf, 32, frames * bins)
  return {
    frames, bins, hop, sr,
    mags: new Float32Array(mags),
    phases: new Float32Array(frames * bins),
    onsets: (() => { const o = new Uint8Array(frames); o[0] = 1; return o })(),
  }
}

function referencedSampleIds(patch: ApolloPatch): string[] {
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

/** Load every sample the patch references that the engine doesn't have yet.
 *  Returns the ids that were restored (empty = nothing to do). */
export async function restorePatchSamples(patch: ApolloPatch, engine: ApolloEngine): Promise<string[]> {
  if (!engine.ready) return []
  const restored: string[] = []
  for (const id of referencedSampleIds(patch)) {
    if (engine.samples.has(id) || engine.getSpectral(id)) continue
    try {
      const entry = await libraryFulfill(id)
      if (!entry?.audioBlob) continue
      if (entry.tags?.includes('apollo-image-spectral')) {
        const an = await decodeSpectralBlob(entry.audioBlob)
        engine.loadSpectralData(id, an)
      } else {
        const buf = await blobToAudioBuffer(entry.audioBlob)
        engine.loadSample(id, entry.name, buf)
      }
      restored.push(id)
    } catch { /* missing or undecodable — leave silent, UI shows the id */ }
  }
  return restored
}

// ── Library round-trip (the studio's sound-designer loop) ────────────────────
// "Open in Apollo" hands a library sound's id over via /apollo?librarySample=…;
// Apollo remembers it as the session's SOURCE so a bounce can replace the
// original in place (new take stays available via the normal bounce).

let sourceSample: { id: string; name: string } | null = null
export function setApolloSourceSample(id: string, name: string): void { sourceSample = { id, name } }
export function getApolloSourceSample(): { id: string; name: string } | null { return sourceSample }

/** Overwrite an existing library entry's audio in place (keeps its identity —
 *  name/folder/tags — so every project referencing it hears the new take). */
export async function overwriteLibrarySample(id: string, buffer: AudioBuffer): Promise<boolean> {
  const existing = await libraryGetById(id)
  if (!existing) return false
  await libraryAdd({
    ...existing,
    audioBlob: audioBufferToWav(buffer),
    duration: buffer.duration,
    addedAt: new Date().toISOString(),
  })
  return true
}

/** Save a bounced render into the library so it's usable anywhere in 100Lights. */
export async function saveBounceToLibrary(name: string, buffer: AudioBuffer): Promise<string> {
  const id = 'apollo_bounce_' + Date.now().toString(36)
  await libraryAdd({
    id,
    name,
    category: 'custom',
    audioBlob: audioBufferToWav(buffer),
    duration: buffer.duration,
    addedAt: new Date().toISOString(),
    folder: 'Apollo Bounces',
    tags: ['apollo-bounce'],
  })
  return id
}
