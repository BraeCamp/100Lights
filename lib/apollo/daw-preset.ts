// A Beacon sampled preset, opened as an Apollo instrument.
//
// Most Beacon tracks do not play a synth — they play a PRESET: a sound-library
// folder of per-note samples (Piano, Rhodes, Violin…), chosen per clip via
// clip.presetId and resolved a note at a time. translateInstrument has no
// answer for those, so opening one in Apollo produced a silent placeholder:
// you could see the synth but it had nothing to voice, and none of Apollo's
// filters, envelopes, mod matrix or FX could touch the sound.
//
// This maps the preset's samples onto Apollo's multisample oscillator, one zone
// per sampled note, so the preset becomes a real Apollo instrument that its
// whole signal path applies to.
//
// Zone sampleIds are the LIBRARY entry ids, which is what makes this survive a
// reload for free: restorePatchSamples already fulfils samples by library id,
// so nothing has to be copied or persisted a second time.

import { noteNameToMidi } from '@/lib/scale-constants'
import { libraryGetAll } from '@/lib/sound-library'
import { libraryFulfill } from '@/lib/default-samples'
import type { ApolloEngine } from '@/lib/apollo/engine-client'
import type { ApolloPatch, MultisampleZone } from '@/lib/apollo/patch'

/** "F#3" -> 54. Re-exported from the canonical pitch module so sample naming
 *  here can never drift from the naming everything else uses. */
export const pitchFromNoteName = noteNameToMidi

export interface PresetImportResult {
  patch: ApolloPatch
  name: string
  zones: number
  /** Sampled notes found but not decodable — reported rather than dropped. */
  skipped: number
}

/**
 * Load a preset folder's samples into `engine` and map them onto oscillator
 * `oscIndex` as a multisample.
 *
 * Key ranges are split at the midpoints between neighbouring sampled notes, so
 * every pitch in between plays the nearest real sample transposed — the same
 * choice the engine's own nearest-entry fallback makes, expressed as zones.
 */
export async function presetToApolloPatch(
  patch: ApolloPatch,
  preset: { name: string; folder: string; loNote?: number; hiNote?: number },
  engine: ApolloEngine,
  opts: { oscIndex?: number; maxZones?: number; pitches?: number[]; spacingSemis?: number } = {},
): Promise<PresetImportResult> {
  const i = opts.oscIndex ?? 0
  const cap = opts.maxZones ?? 64

  const entries = await libraryGetAll()
  const inFolder = entries.filter(e => e.folder === preset.folder || e.parentFolder === preset.folder)

  // Pitch per sample: the note name is authoritative, renderSpec is the
  // fallback for entries that were seeded rather than named.
  const pitched = inFolder
    .map(e => ({ e, pitch: pitchFromNoteName(e.name) ?? (e as { renderSpec?: { midiNote?: number } }).renderSpec?.midiNote ?? null }))
    .filter((x): x is { e: typeof inFolder[0]; pitch: number } => x.pitch != null)
    .sort((a, b) => a.pitch - b.pitch)

  // Every zone is a decode and a transfer to the worklet, and a full sampled
  // instrument can hold one per semitone — 37 of them took 6.6 seconds to open.
  //
  // When the caller knows which pitches the music actually uses, keep only the
  // samples needed to cover that range (plus one either side, so bends and
  // edits nearby still land on a real sample). Everything outside still plays:
  // the outermost zones are stretched to 0 and 127 below, so a stray note is
  // transposed from the nearest loaded sample rather than falling silent.
  let candidates = pitched
  if (opts.pitches?.length) {
    const lo = Math.min(...opts.pitches)
    const hi = Math.max(...opts.pitches)
    const inRange = pitched.filter(x => x.pitch >= lo && x.pitch <= hi)
    const below = pitched.filter(x => x.pitch < lo).slice(-1)
    const above = pitched.filter(x => x.pitch > hi).slice(0, 1)
    const near = [...below, ...inRange, ...above]
    if (near.length) candidates = near
  }

  // Keep a SMALL set and let Apollo retune between them.
  //
  // A preset folder holds one entry per semitone, because seeding explodes a
  // soundfont that way: notes the soundfont has natively keep their mp3, and
  // every other note is a pre-rendered resampled copy of its neighbour. Loading
  // all of them decodes dozens of samples, most of which are already
  // resamplings — and Apollo may then resample AGAIN when a played note does
  // not sit exactly on a zone's root. Taking one sample every few semitones and
  // letting the zone keytracking cover the gaps removes that second layer and
  // most of the decoding.
  //
  // The spacing is what bounds the quality cost: at 3 semitones nothing is ever
  // retuned by more than 1.5, which is well inside transparent for pitched
  // material — and it is the same interval the source soundfonts are sampled at.
  const spacing = Math.max(1, Math.round(opts.spacingSemis ?? 3))
  const spaced: typeof candidates = []
  for (const c of candidates) {
    const last = spaced[spaced.length - 1]
    if (!last || c.pitch - last.pitch >= spacing) spaced.push(c)
  }
  // Always keep the top of the range: without it the highest notes would be
  // stretched up from whatever the last kept sample happened to be.
  const top = candidates[candidates.length - 1]
  if (top && spaced[spaced.length - 1] !== top) spaced.push(top)

  // Still too many? Thin evenly rather than truncating the top.
  const chosen = spaced.length > cap
    ? spaced.filter((_, n) => n % Math.ceil(spaced.length / cap) === 0)
    : spaced

  // Fetch and decode every sample AT ONCE. These were awaited one at a time,
  // which turned an instrument into as many serial round-trips as it had notes.
  const loaded = await Promise.all(chosen.map(async ({ e, pitch }) => {
    try {
      if (engine.samples.has(e.id)) return { e, pitch, ok: true }
      const full = await libraryFulfill(e.id)
      if (!full?.audioBlob) return { e, pitch, ok: false }
      const buf = await blobToBuffer(full.audioBlob, engine)
      if (!buf) return { e, pitch, ok: false }
      engine.loadSample(e.id, e.name, buf)
      return { e, pitch, ok: true }
    } catch { return { e, pitch, ok: false } }
  }))

  const usable = loaded.filter(x => x.ok)
  const skipped = loaded.length - usable.length
  const zones: MultisampleZone[] = usable.map(({ e, pitch }, n) => {
    const prev = usable[n - 1]?.pitch
    const next = usable[n + 1]?.pitch
    return {
      sampleId: e.id,
      loKey: prev == null ? (preset.loNote ?? 0) : Math.floor((prev + pitch) / 2) + 1,
      hiKey: next == null ? (preset.hiNote ?? 127) : Math.floor((pitch + next) / 2),
      loVel: 0, hiVel: 127,
      rootKey: pitch, tune: 0, gain: 0,
      loopMode: 'off' as const, loopStart: 0, loopEnd: 1,
    }
  })
  if (!zones.length) throw new Error(`No playable samples found in "${preset.folder}"`)

  // The outermost zones cover everything past the sampled range, so a note
  // above or below the instrument still sounds instead of falling silent.
  zones[0].loKey = 0
  zones[zones.length - 1].hiKey = 127

  const next: ApolloPatch = JSON.parse(JSON.stringify(patch))
  const osc = next.oscs[i]
  if (osc) {
    osc.enabled = true
    osc.engine = 'multisample'
    osc.level = osc.level > 0 ? osc.level : 0.8
    osc.ms.zones = zones
    osc.ms.name = preset.name
  }
  // A patch built as an FX-only shell has no amp envelope worth the name, so
  // the samples would load and then play silently.
  const amp = next.envs?.[0]
  if (amp && amp.attack === 0 && amp.decay === 0 && amp.sustain === 0 && amp.release === 0) {
    amp.attack = 0.003; amp.decay = 0.2; amp.sustain = 1; amp.release = 0.3
  }
  return { patch: next, name: preset.name, zones: zones.length, skipped }
}

async function blobToBuffer(blob: Blob, engine: ApolloEngine): Promise<AudioBuffer | null> {
  const ctx = engine.ctx
  if (!ctx) return null
  try { return await ctx.decodeAudioData(await blob.arrayBuffer()) } catch { return null }
}
