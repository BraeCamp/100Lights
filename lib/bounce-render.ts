/**
 * The browser half of a bounce (lib/bounce.ts): render one track's devices to
 * audio, and put the result somewhere it survives a reload.
 *
 * Client-only — OfflineAudioContext and the IndexedDB sound library. Import it
 * lazily so the studio's first paint does not pull in the render path.
 *
 * ⚠️ The result goes into the Sound Library rather than a blob: URL. A blob URL
 * dies with the page, so a bounce made from one would be a clip that plays
 * beautifully until you reload and then plays nothing — the worst possible
 * failure for a command whose whole promise is "this is committed now". The
 * freeze path learned this the same way (lib/apollo/daw-freeze.ts).
 */

import type { DawProject } from './daw-types'
import { preMixerProject, type BounceSpan } from './bounce'
import { RENDER_SAMPLE_RATE } from './render-rate'

export interface BounceResult {
  libraryId: string
  durationSec: number
  /** Loudest sample in the render — 0 means the track printed silence. */
  peak: number
}

/**
 * Render one track over a span and save it as a sound.
 *
 * Silence is thrown rather than returned. A bounce that prints nothing is
 * almost always a mistake somewhere else (a muted source, a span with no clips,
 * an instrument that failed to load), and a silent clip on the timeline looks
 * exactly like a working one until somebody presses play.
 */
export async function bounceTrackToLibrary(
  project: DawProject,
  trackId: string,
  span: BounceSpan,
  name: string,
): Promise<BounceResult> {
  const [{ renderChannels }, { libraryAdd }, { audioBufferToWav }] = await Promise.all([
    import('./song-video/render-audio'),
    import('./sound-library'),
    import('./wav-encoder'),
  ])

  const { channels, durSec } = await renderChannels(
    preMixerProject(project, trackId),
    { startBeat: span.startBeat, endBeat: span.endBeat },
    // Solo the track, and skip the master compressor: the bounce is this
    // track's devices, not the whole mix's glue.
    { soloTrackId: trackId, dryMaster: true },
  )

  let peak = 0
  for (const ch of channels) for (let i = 0; i < ch.length; i += 64) { const v = Math.abs(ch[i]); if (v > peak) peak = v }
  if (peak < 1e-4) throw new Error('That track printed silence — check it is not muted and that its clips are in the span.')

  const octx = new OfflineAudioContext(Math.max(1, channels.length), channels[0].length, RENDER_SAMPLE_RATE)
  const buffer = octx.createBuffer(Math.max(1, channels.length), channels[0].length, RENDER_SAMPLE_RATE)
  channels.forEach((ch, i) => buffer.getChannelData(i).set(ch))

  const libraryId = `bounce_${Date.now().toString(36)}`
  await libraryAdd({
    id: libraryId,
    name,
    category: 'custom',
    audioBlob: audioBufferToWav(buffer),
    duration: buffer.duration,
    addedAt: new Date().toISOString(),
    folder: 'Bounces',
    tags: ['bounce'],
  })

  return { libraryId, durationSec: durSec, peak }
}
