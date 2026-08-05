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
import { encodeWav16 } from './wav16'

// Bounce the REAL project audio for a beat window, so a song-video can use the
// actual mix instead of the preview synth. Uses the studio engine's OFFLINE
// render path (OfflineAudioContext) — faster-than-real-time, so a 4-minute song
// renders in a fraction of the time instead of 4 minutes. Client-only
// (OfflineAudioContext + IndexedDB library). Import it lazily.

export async function renderProjectAudioBlob(
  project: DawProject,
  opts: { startBeat: number; endBeat: number; userId?: string | null },
): Promise<Blob> {
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
  const { channels, sampleRate: sr } = await engine.renderOffline({ startBeat: opts.startBeat, endBeat: opts.endBeat })
  return new Blob([encodeWav16(channels, sr)], { type: 'audio/wav' })
}
