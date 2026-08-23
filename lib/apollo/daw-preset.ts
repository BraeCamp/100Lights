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

import { libraryGetAll } from '@/lib/sound-library'
import { libraryFulfill } from '@/lib/default-samples'
import type { ApolloEngine } from '@/lib/apollo/engine-client'
import type { ApolloPatch, MultisampleZone } from '@/lib/apollo/patch'

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** "F#3" → 54. The inverse of the engine's own naming, so the two agree about
 *  which sample is which note. Returns null for anything not a note name. */
export function pitchFromNoteName(name: string): number | null {
  const m = /^([A-G]#?)(-?\d+)$/.exec(name.trim())
  if (!m) return null
  const i = NOTE_NAMES.indexOf(m[1].toUpperCase())
  if (i < 0) return null
  return i + (Number(m[2]) + 1) * 12
}

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
  opts: { oscIndex?: number; maxZones?: number } = {},
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

  // A big instrument can hold a sample per semitone; every zone is a decode and
  // a transfer to the worklet, so thin evenly rather than truncating the top.
  const chosen = pitched.length > cap
    ? pitched.filter((_, n) => n % Math.ceil(pitched.length / cap) === 0)
    : pitched

  const zones: MultisampleZone[] = []
  let skipped = 0
  for (let n = 0; n < chosen.length; n++) {
    const { e, pitch } = chosen[n]
    try {
      if (!engine.samples.has(e.id)) {
        const full = await libraryFulfill(e.id)
        if (!full?.audioBlob) { skipped++; continue }
        const buf = await blobToBuffer(full.audioBlob, engine)
        if (!buf) { skipped++; continue }
        engine.loadSample(e.id, e.name, buf)
      }
      const prev = chosen[n - 1]?.pitch
      const next = chosen[n + 1]?.pitch
      zones.push({
        sampleId: e.id,
        loKey: prev == null ? (preset.loNote ?? 0) : Math.floor((prev + pitch) / 2) + 1,
        hiKey: next == null ? (preset.hiNote ?? 127) : Math.floor((pitch + next) / 2),
        loVel: 0, hiVel: 127,
        rootKey: pitch, tune: 0, gain: 0,
        loopMode: 'off', loopStart: 0, loopEnd: 1,
      })
    } catch { skipped++ }
  }
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
