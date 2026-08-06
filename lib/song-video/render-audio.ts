import { DawEngine } from '@/lib/daw-engine'
import type { DawProject } from '@/lib/daw-types'
import { initLibrary } from '@/lib/sound-library'
import {
  seedDefaultSamples,
  seedKeyboardNotes, seedRealInstruments, seedBass, seedStrings,
  seedBrass, seedWind, seedDarkwave, seedDarkKit, seedArp, seedFx, seedPercussion,
} from '@/lib/default-samples'
import { combinePresets } from '@/lib/midi-presets'
import { tempoSegments, beatToSeconds } from '@/lib/tempo-map'
import { encodeMix } from './encode-audio'

// Bounce the REAL project audio for a beat window, so a song-video can use the
// actual mix instead of the preview synth. Uses the studio engine's OFFLINE
// render path (OfflineAudioContext) — faster-than-real-time, so a 4-minute song
// renders in a fraction of the time instead of 4 minutes. Client-only
// (OfflineAudioContext + IndexedDB library). Import it lazily.

export interface RenderedMix {
  blob: Blob
  durationSec: number
  peaks: number[]   // 80-band max-abs, matching the timeline waveform format
}

export async function renderProjectAudioBlob(
  project: DawProject,
  opts: { startBeat: number; endBeat: number; userId?: string | null },
): Promise<RenderedMix> {
  const t0 = performance.now()
  initLibrary(opts.userId ?? null)
  await seedDefaultSamples().catch(() => {})
  // seedDefaultSamples() fires the multisample instrument folders (Rhodes/EP/
  // pad/bass/strings/brass/…) off WITHOUT awaiting them, to keep normal app load
  // fast. But the offline bounce runs a single synchronous scheduling pass, so
  // any preset whose library folder isn't populated yet resolves to a null
  // buffer and every one of its notes is silently skipped — which is why only
  // the (synth) drums came through. Await the seeds here so the whole mix is
  // present before we render. Idempotent: already-seeded folders return fast.
  await Promise.all([
    seedKeyboardNotes(), seedRealInstruments(), seedBass(), seedStrings(),
    seedBrass(), seedWind(), seedDarkwave(), seedDarkKit(), seedArp(),
    seedFx(), seedPercussion(),
  ].map(p => p.catch(() => {})))

  // Size the offline context to the window's exact duration through the tempo map.
  const segs = tempoSegments(project)
  const durSec = Math.max(0.1, beatToSeconds(opts.endBeat, segs) - beatToSeconds(opts.startBeat, segs))
  const sampleRate = 44100
  const octx = new OfflineAudioContext(2, Math.ceil(durSec * sampleRate), sampleRate)

  // Build the whole engine graph in the offline context, then render one pass.
  const engine = new DawEngine({ ctx: octx as unknown as AudioContext })
  engine.setPresets(combinePresets(project.presets))
  engine.updateProject(project)
  const t1 = performance.now()
  const { channels, sampleRate: sr } = await engine.renderOffline({ startBeat: opts.startBeat, endBeat: opts.endBeat })
  const t2 = performance.now()
  // Compress to AAC/Opus when possible (falls back to WAV) — the returned blob's
  // `.type` tells callers which it is, so they can name/presign the file right.
  const { blob } = await encodeMix(channels, sr)
  // Duration + 80-band peaks straight from the rendered PCM, so callers don't
  // re-decode the file twice (readDuration + computeAudioPeaks each cost a decode).
  const ch0 = channels[0] ?? new Float32Array(0)
  const bands = 80, step = Math.max(1, Math.floor(ch0.length / bands))
  const peaks = Array.from({ length: bands }, (_, i) => {
    let max = 0
    for (let j = 0; j < step; j++) max = Math.max(max, Math.abs(ch0[i * step + j] ?? 0))
    return max
  })
  const t3 = performance.now()
  console.log(`[dawmix] setup ${(t1 - t0) | 0}ms · render ${(t2 - t1) | 0}ms · encode+peaks ${(t3 - t2) | 0}ms · total ${(t3 - t0) | 0}ms`)
  return { blob, durationSec: durSec, peaks }
}
