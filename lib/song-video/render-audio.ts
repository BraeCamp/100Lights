import { DawEngine } from '@/lib/daw-engine'
import type { DawProject } from '@/lib/daw-types'
import { initLibrary } from '@/lib/sound-library'
import { seedDefaultSamples } from '@/lib/default-samples'
import { combinePresets } from '@/lib/midi-presets'
import { decodeWav } from '@/lib/wav-codec'
import { encodeWav16 } from './wav16'

// Bounce the REAL project audio for a beat window, so a song-video can use the
// actual mix instead of the preview synth. Reuses the studio's own engine path
// (the same one behind window.__dawRenderWav): boot an engine, sync the project
// (which pre-warms sample/preset buffers), let those resolve, then render.
// Client-only (AudioContext + IndexedDB library). Import it lazily.

export async function renderProjectAudioBlob(
  project: DawProject,
  opts: { startBeat: number; endBeat: number; userId?: string | null },
): Promise<Blob> {
  initLibrary(opts.userId ?? null)
  await seedDefaultSamples().catch(() => {})
  const engine = new DawEngine()
  try {
    engine.setPresets(combinePresets(project.presets))
    engine.updateProject(project) // syncs tracks/clips and fires async buffer pre-warm
    // Give those buffer loads time to resolve — the bounce plays in real time,
    // and a note whose sample hasn't decoded yet is dropped (silent first pass).
    await new Promise(r => setTimeout(r, 2500))
    // tailSec:0 → the clip is EXACTLY the window length, so it loops seamlessly in
    // sync with the video's beat clock (a reverb tail would make it drift).
    const res = await engine.renderWav({ startBeat: opts.startBeat, endBeat: opts.endBeat, tailSec: 0 })
    const bytes = Uint8Array.from(atob(res.master), c => c.charCodeAt(0))
    const decoded = decodeWav(bytes.buffer)
    return new Blob([encodeWav16(decoded.channels, decoded.sampleRate)], { type: 'audio/wav' })
  } finally {
    engine.dispose()
  }
}
