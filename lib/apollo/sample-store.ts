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

// ── One fetch, one decode, shared by every engine ───────────────────────────
//
// Beacon builds an ApolloEngine PER TRACK (daw-instrument.ts), and each one had
// its own private `samples` Map with no way to know another had already done
// the work. So a six-track song where four tracks use the same sampled piano
// fetched and decoded that piano four times.
//
// That is small for a one-shot sample and enormous for a multisample: a
// referenced instrument is one id PER ZONE, so a 40-zone violin on three tracks
// is 120 fetch-and-decodes. Done SERIALLY, as this was, each one paying an
// IndexedDB read plus — the first time — a network round trip for the catalog
// audio, then a decode, then two Float32Array copies.
//
// This is the load nobody could see: it happens before a single note can be
// scheduled, it is not a render so nothing in the loader counts it, and it
// scales with how many sampled instruments a song uses rather than with
// anything the progress bar knows about. The symptom is a song that "only plays
// one instrument while it loads the others".
//
// So the decode is now global and deduplicated by id, and in flight only once
// even when several engines ask at the same moment. Engines still keep their
// own copy of the audio (the worklet needs its own buffer either way), but the
// fetching and decoding — all of the cost — happens once.
type Decoded =
  | { kind: 'sample'; name: string; buffer: AudioBuffer }
  | { kind: 'spectral'; analysis: SpectralAnalysis }

const decodedCache = new Map<string, Decoded | null>()
const decodingNow = new Map<string, Promise<Decoded | null>>()

/** What the sample path has cost, so it stops being invisible in a report. */
// `calls` and `notReady` separate the three ways this can do nothing, which
// otherwise look identical from outside: never called at all, called before the
// engine was up (so the patch's samples are silently never loaded), or called
// with nothing left to fetch. Chasing that distinction by reasoning cost real
// time; it is one counter each.
const sampleStats = {
  calls: 0, notReady: 0, referenced: 0,
  asked: 0, decoded: 0, reused: 0, missing: 0, ms: 0, worstMs: 0, worstId: '',
}
export function sampleLoadStats(): typeof sampleStats & { cached: number } {
  return { ...sampleStats, cached: decodedCache.size }
}

async function decodeOnce(id: string): Promise<Decoded | null> {
  if (decodedCache.has(id)) { sampleStats.reused++; return decodedCache.get(id) ?? null }
  const running = decodingNow.get(id)
  if (running) { sampleStats.reused++; return running }

  const p = (async (): Promise<Decoded | null> => {
    const t0 = Date.now()
    try {
      const entry = await libraryFulfill(id)
      if (!entry?.audioBlob) { sampleStats.missing++; return null }
      const out: Decoded = entry.tags?.includes('apollo-image-spectral')
        ? { kind: 'spectral', analysis: await decodeSpectralBlob(entry.audioBlob) }
        : { kind: 'sample', name: sampleDisplayName(entry), buffer: await blobToAudioBuffer(entry.audioBlob) }
      sampleStats.decoded++
      return out
    } catch {
      // Missing or undecodable — leave silent, the UI shows the id.
      sampleStats.missing++
      return null
    } finally {
      const ms = Date.now() - t0
      sampleStats.ms += ms
      if (ms > sampleStats.worstMs) { sampleStats.worstMs = ms; sampleStats.worstId = id }
      decodingNow.delete(id)
    }
  })()

  decodingNow.set(id, p)
  const got = await p
  decodedCache.set(id, got)
  return got
}

/** Load every sample the patch references that the engine doesn't have yet.
 *  Returns the ids that were restored (empty = nothing to do).
 *
 *  In PARALLEL, bounded. These are independent and their cost is mostly
 *  latency — an IndexedDB read and, on first use, a fetch — so serialising them
 *  turned a 40-zone instrument into 40 consecutive round trips before the track
 *  could make a sound. The width is small deliberately: the point is to overlap
 *  the waiting, not to start forty decodes at once on a phone. */
export async function restorePatchSamples(
  patch: ApolloPatch,
  engine: ApolloEngine,
  // ── Why "ready" is optional ────────────────────────────────────────────────
  //
  // A LIVE engine must be up before its samples are sent, because loadSample
  // posts them into the worklet and there is no worklet until init() runs.
  //
  // An OFFLINE render engine is the opposite case. daw-freeze builds a
  // throwaway `new ApolloEngine()` and hands it straight to renderManyToBuffer,
  // which creates its own OfflineAudioContext internally — so the engine is
  // never init()ed and `ready` is never true. It reads `this.samples` when it
  // builds each node, and nothing had ever put anything there: every render of
  // a sampled instrument came back silent, and a silent render is discarded as
  // a failure, so those clips never baked and played live forever.
  //
  // loadSample populates the map first and posts second, and post() is a no-op
  // without a node, so filling an un-inited engine is safe and is exactly what
  // the render path needs.
  { requireReady = true }: { requireReady?: boolean } = {},
): Promise<string[]> {
  sampleStats.calls++
  if (requireReady && !engine.ready) { sampleStats.notReady++; return [] }
  const referenced = referencedSampleIds(patch)
  sampleStats.referenced += referenced.length
  const ids = referenced.filter(id => !engine.samples.has(id) && !engine.getSpectral(id))
  if (!ids.length) return []
  sampleStats.asked += ids.length

  const restored: string[] = []
  const WIDTH = 6
  let next = 0
  await Promise.all(Array.from({ length: Math.min(WIDTH, ids.length) }, async () => {
    for (;;) {
      const id = ids[next++]
      if (!id) return
      const got = await decodeOnce(id)
      if (!got) continue
      try {
        if (got.kind === 'spectral') engine.loadSpectralData(id, got.analysis)
        else engine.loadSample(id, got.name, got.buffer)
        restored.push(id)
      } catch { /* engine went away mid-load */ }
    }
  }))
  return restored
}

/** Display name for a library sample loaded into Apollo. Instrument folders
 *  store one entry per pitch named like "C4"/"F#3" — useless as a patch/sample
 *  label when the MIDI keyboard already supplies the pitch. Prefer the folder
 *  (the instrument's name) whenever the entry name is just a note. */
const NOTE_NAME_RE = /^[A-G](#|b)?-?\d+(\s*\(\d+\))?$/i
export function sampleDisplayName(entry: { name: string; folder?: string | null }): string {
  if (entry.folder && NOTE_NAME_RE.test(entry.name.trim())) return entry.folder
  return entry.name
}

// ── Library round-trip (the studio's sound-designer loop) ────────────────────
// "Open in Apollo" hands a library sound's id over via /apollo?librarySample=…;
// Apollo remembers it as the session's SOURCE so a bounce can replace the
// original in place (new take stays available via the normal bounce).

let sourceSample: { id: string; name: string } | null = null
export function setApolloSourceSample(id: string, name: string): void { sourceSample = { id, name } }
export function getApolloSourceSample(): { id: string; name: string } | null { return sourceSample }

// ── Beacon → Apollo sample selection ────────────────────────────────────────
// Picking a sound in Beacon's Sound Library should drop it into Apollo's sample
// slot exactly as if it had been chosen in the picker — the standalone app has
// done this since /apollo?librarySample=… existed, but the card hosted inside
// Beacon deliberately ignores deep links, so selecting a sound there did
// nothing at all.
//
// This lives here rather than in a Beacon module because the dependency only
// runs one way: Beacon may import lib/apollo, never the reverse. Beacon
// publishes the selection, the Apollo card subscribes.

export interface ApolloSampleSelection { id: string; name: string }
type SelectionListener = (sel: ApolloSampleSelection) => void

/** The armed selection, plus whether an Apollo has already taken it. */
let selection: (ApolloSampleSelection & { consumed: boolean }) | null = null
const selectionListeners = new Set<SelectionListener>()

/** Beacon: the user picked this library sound; hand it to any open Apollo. */
export function selectApolloSample(id: string, name: string): void {
  selection = { id, name, consumed: false }
  for (const fn of selectionListeners) {
    try { fn(selection) } catch { /* one bad listener must not block the rest */ }
  }
}

/** Apollo: run `fn` whenever Beacon publishes a new selection. Returns an
 *  unsubscribe. Only selections made AFTER subscribing fire — opening Apollo
 *  should not retroactively replace the patch you were already working on. */
export function onApolloSampleSelect(fn: SelectionListener): () => void {
  selectionListeners.add(fn)
  return () => { selectionListeners.delete(fn) }
}

/** The most recent selection, for UI that wants to show what is armed. */
export function getApolloSampleSelection(): ApolloSampleSelection | null {
  return selection ? { id: selection.id, name: selection.name } : null
}

/**
 * The sound Apollo should open on, if any.
 *
 * Brae: "It should start on sample and load the sample that is selected."
 * Taken literally, which is the right way to take it — while a sound is
 * selected in the Sound Library, every rack that opens shows it.
 *
 * Two earlier rules were both cleverer than this and both wrong:
 *
 *   "only onto an untouched patch", judged by the patch's NAME. Opening the
 *   rack for an Apollo track seeds it from a blank initPatch() (name 'Init',
 *   allowed), while a rack opened with a seed carries the track's name
 *   (refused). Same feature, opposite behaviour depending on which button you
 *   pressed — and every test happened to press the lucky one.
 *
 *   "apply it once, then spend it". Safer-sounding, and it would have produced
 *   exactly the symptom being complained about: pick a sound, open Apollo once,
 *   and from then on opening Apollo never shows your sound again.
 *
 * The only protection kept is the one that cannot misfire: if osc 1 already
 * holds this sound, there is nothing to do.
 */
export function armedApolloSample(): ApolloSampleSelection | null {
  return selection ? { id: selection.id, name: selection.name } : null
}

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

// Test seam: arm a selection without going through the Sound Library UI.
//
// The bridge's whole subtlety is ORDERING — pick a sound in Beacon, THEN open
// Apollo — and that order is unreachable from a test that can only drive a
// mounted Apollo. This lives at module scope rather than in a component so it
// survives Apollo unmounting, which is precisely the window under test.
// Same guard as the DAW hooks: dev, or an explicit opt-in for a prod bundle.
if (typeof window !== 'undefined'
  && (process.env.NODE_ENV === 'development' || process.env.NEXT_PUBLIC_DAW_HOOKS === '1')) {
  ;(window as unknown as Record<string, unknown>).__apolloArmSample =
    (id: string, name: string) => selectApolloSample(id, name)
}

// UNGATED, like __dawDiagnose, and for the same reason: this is the number that
// explains a slow load, and it is worthless if it only exists on machines that
// are already known to be fine. It reads a counter and allocates nothing.
if (typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__sampleStats = sampleLoadStats
}
