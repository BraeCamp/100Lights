import { DawEngine } from '@/lib/daw-engine'
import type { DawProject } from '@/lib/daw-types'
import { initLibrary } from '@/lib/sound-library'
import { seedDefaultSamples } from '@/lib/default-samples'
import { combinePresets } from '@/lib/midi-presets'
import { decodeWav } from '@/lib/wav-codec'

// Bounce the REAL project audio for a beat window, so a song-video can use the
// actual mix instead of the preview synth. Reuses the studio's own engine path
// (the same one behind window.__dawRenderWav): boot an engine, sync the project
// (which pre-warms sample/preset buffers), let those resolve, then render.
// Client-only (AudioContext + IndexedDB library). Import it lazily.

// Interleaved 16-bit PCM WAV — universally playable in <audio>, unlike the
// engine's 32-bit float output.
function encodeWav16(channels: Float32Array[], sampleRate: number): ArrayBuffer {
  const numCh = channels.length || 1
  const numFrames = channels[0]?.length ?? 0
  const blockAlign = numCh * 2
  const dataLen = numFrames * blockAlign
  const buf = new ArrayBuffer(44 + dataLen)
  const dv = new DataView(buf)
  const ws = (off: number, s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i)) }
  ws(0, 'RIFF'); dv.setUint32(4, 36 + dataLen, true); ws(8, 'WAVE')
  ws(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, numCh, true)
  dv.setUint32(24, sampleRate, true); dv.setUint32(28, sampleRate * blockAlign, true)
  dv.setUint16(32, blockAlign, true); dv.setUint16(34, 16, true)
  ws(36, 'data'); dv.setUint32(40, dataLen, true)
  let off = 44
  for (let f = 0; f < numFrames; f++) {
    for (let ch = 0; ch < numCh; ch++) {
      let v = channels[ch][f]; v = v < -1 ? -1 : v > 1 ? 1 : v
      dv.setInt16(off, v < 0 ? v * 0x8000 : v * 0x7fff, true); off += 2
    }
  }
  return buf
}

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
    await new Promise(r => setTimeout(r, 2200))
    const res = await engine.renderWav({ startBeat: opts.startBeat, endBeat: opts.endBeat, tailSec: 0.8 })
    const bytes = Uint8Array.from(atob(res.master), c => c.charCodeAt(0))
    const decoded = decodeWav(bytes.buffer)
    return new Blob([encodeWav16(decoded.channels, decoded.sampleRate)], { type: 'audio/wav' })
  } finally {
    engine.dispose()
  }
}
