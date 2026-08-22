// Drop a sampled instrument onto a Beacon track.
//
// Apollo could already import SFZ, but only from inside its own Multisample
// panel, where the logic was tangled up with the Apollo provider — so a Beacon
// track had no way to become a real multisampled instrument. This is that
// import as a plain function over (patch, files, engine), which Beacon can call
// and which the panel could equally use.
//
// SFZ is the lingua franca for free sampled instruments, so this is the
// shortest path from "I downloaded a piano" to "my track plays it".

import { matchSfzFiles, parseSfz } from '@/lib/apollo/sfz'
import { persistApolloSample } from '@/lib/apollo/sample-store'
import { decodeFileAudio } from '@/lib/media-import'
import type { ApolloEngine } from '@/lib/apollo/engine-client'
import type { ApolloPatch, MultisampleZone } from '@/lib/apollo/patch'

export interface SfzImportResult {
  patch: ApolloPatch
  name: string
  zones: number
  /** Regions whose audio file was not among the selected files. Reported
   *  rather than swallowed: a half-mapped instrument plays silence in exactly
   *  the range you did not test, which is worse than a visible warning. */
  missing: string[]
}

export class SfzImportError extends Error {}

/**
 * Parse an .sfz plus its audio files into oscillator `oscIndex` as a
 * multisample.
 *
 * The engine is loaded AND the library persisted for every unique sample,
 * because Beacon's per-track engine restores a patch's samples from the
 * library on load — a patch referencing samples that were never persisted
 * comes back silent after a reload.
 */
export async function importSfzToPatch(
  patch: ApolloPatch,
  files: File[],
  engine: ApolloEngine,
  opts: { oscIndex?: number } = {},
): Promise<SfzImportResult> {
  const i = opts.oscIndex ?? 0
  const sfzFile = files.find(f => f.name.toLowerCase().endsWith('.sfz'))
  if (!sfzFile) throw new SfzImportError('Select the .sfz file together with its audio files')

  const regions = parseSfz(await sfzFile.text())
  if (!regions.length) throw new SfzImportError('No <region> entries found in that .sfz')

  const matched = matchSfzFiles(regions, files)
  const zones: MultisampleZone[] = []
  const missing: string[] = []
  const loaded = new Map<string, { id: string; len: number }>()

  for (const r of regions) {
    const f = matched.get(r.sample)
    if (!f) { if (!missing.includes(r.sample)) missing.push(r.sample); continue }
    let rec = loaded.get(r.sample)
    if (!rec) {
      const buf = await decodeFileAudio(f)
      const id = `sfz_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`
      engine.loadSample(id, f.name.replace(/\.[^.]+$/, ''), buf)
      await persistApolloSample(id, f.name, buf).catch(() => {})
      rec = { id, len: buf.length }
      loaded.set(r.sample, rec)
    }
    zones.push({
      sampleId: rec.id, loKey: r.loKey, hiKey: r.hiKey, loVel: r.loVel, hiVel: r.hiVel,
      rootKey: r.rootKey, tune: r.tune, gain: r.gain, loopMode: r.loopMode,
      loopStart: rec.len > 0 ? r.loopStart / rec.len : 0,
      loopEnd: rec.len > 0 && r.loopEnd > 0 ? Math.min(1, r.loopEnd / rec.len) : 1,
    })
  }
  if (!zones.length) throw new SfzImportError('Regions found, but none of their audio files were selected')

  const name = sfzFile.name.replace(/\.sfz$/i, '')
  const next: ApolloPatch = JSON.parse(JSON.stringify(patch))
  const osc = next.oscs[i]
  if (osc) {
    osc.enabled = true
    osc.engine = 'multisample'
    osc.level = osc.level > 0 ? osc.level : 0.8
    osc.ms.zones = zones
    osc.ms.name = name
  }
  const amp = next.envs?.[0]
  if (amp && amp.attack === 0 && amp.decay === 0 && amp.sustain === 0 && amp.release === 0) {
    amp.attack = 0.005; amp.decay = 0.2; amp.sustain = 1; amp.release = 0.25
  }
  return { patch: next, name, zones: zones.length, missing }
}
