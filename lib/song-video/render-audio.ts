import { DawEngine } from '@/lib/daw-engine'
import { RENDER_SAMPLE_RATE } from '@/lib/render-rate'
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
// render path (OfflineAudioContext) — faster-than-real-time. Client-only
// (OfflineAudioContext + IndexedDB library). Import it lazily.

export interface RenderedMix {
  blob: Blob
  durationSec: number
  peaks: number[]   // 80-band max-abs, matching the timeline waveform format
}

// ⚠️ Was a hardcoded 44100 while the engine used the device's rate and the
// freeze cache used 48000 — three different answers to one question, in three
// files. One constant now.
const SR = RENDER_SAMPLE_RATE

// cyrb53 — cheap stable hash for fingerprints.
function hash(str: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

let seededOnce = false
async function ensureSeeded(userId?: string | null) {
  initLibrary(userId ?? null)
  await seedDefaultSamples().catch(() => {})
  // The offline bounce is one synchronous scheduling pass, so any preset whose
  // library folder isn't populated yet resolves to a null buffer and its notes
  // are silently dropped. Await the seeds so the whole mix is present. Idempotent
  // (localStorage-gated), and we only pay the Promise.all setup once per session.
  if (seededOnce) return
  await Promise.all([
    seedKeyboardNotes(), seedRealInstruments(), seedBass(), seedStrings(),
    seedBrass(), seedWind(), seedDarkwave(), seedDarkKit(), seedArp(),
    seedFx(), seedPercussion(),
  ].map(p => p.catch(() => {})))
  seededOnce = true
}

function peaksFrom(ch0: Float32Array): number[] {
  const bands = 80, step = Math.max(1, Math.floor(ch0.length / bands))
  return Array.from({ length: bands }, (_, i) => {
    let max = 0
    for (let j = 0; j < step; j++) max = Math.max(max, Math.abs(ch0[i * step + j] ?? 0))
    return max
  })
}

/**
 * How loud each of these tracks actually sounds, measured rather than guessed.
 *
 * Brae's audit called level matching "needs work — the offline analysis exists;
 * the in-app path does not". This is that path: each track is rendered on its
 * own through the real engine, with its own instrument and effects, and
 * measured with K-weighting.
 *
 * ⚠️ `dryMaster` on every stem, so the master compressor is not applied to each
 * track individually. Measuring through it would make a loud track measure
 * quieter than it is — the compressor pulls it down — and the balance would
 * then over-correct in exactly the wrong direction.
 *
 * Client-only (OfflineAudioContext). Import it lazily; it renders audio.
 */
export async function measureTrackLoudness(
  project: DawProject,
  trackIds: string[],
  opts: { startBeat: number; endBeat: number },
): Promise<Array<{ trackId: string; lufs: number; peak: number }>> {
  const { loudnessLufs } = await import('@/lib/loudness')
  const out: Array<{ trackId: string; lufs: number; peak: number }> = []
  // In series, not in parallel. Offline contexts are a limited resource — the
  // engine's own notes record that back-to-back ones start coming back silent —
  // and a silent stem would read as "this track is inaudible, turn it up 18 dB".
  for (const id of trackIds) {
    try {
      const { channels } = await renderChannels(project, opts, { soloTrackId: id, dryMaster: true })
      const m = loudnessLufs(channels, SR)
      out.push({ trackId: id, lufs: m.lufs, peak: m.peak })
    } catch {
      // A track that will not render is left out rather than reported as
      // silent, because silent means "turn it up".
    }
  }
  return out
}

// Render a project's channels through the offline engine. With `soloTrackId`, only
// that track's clips play (others muted) — its isolated stem. With `dryMaster`, the
// master DynamicsCompressor is bypassed (tap post-analyser, pre-compressor), so the
// sum of dry stems reconstructs the full pre-compressor bus EXACTLY (everything up
// to the compressor is linear), and the compressor is re-applied once to the sum.
async function renderChannels(
  project: DawProject,
  opts: { startBeat: number; endBeat: number },
  o?: { soloTrackId?: string; dryMaster?: boolean },
): Promise<{ channels: Float32Array[]; durSec: number }> {
  const segs = tempoSegments(project)
  const durSec = Math.max(0.1, beatToSeconds(opts.endBeat, segs) - beatToSeconds(opts.startBeat, segs))
  const octx = new OfflineAudioContext(2, Math.ceil(durSec * SR), SR)

  let proj = project
  if (o?.soloTrackId) {
    const id = o.soloTrackId
    proj = {
      ...project,
      arrangementClips: (project.arrangementClips ?? []).filter(c => c.trackId === id),
      // Clear solo on EVERY track (not just the target): the engine silences the
      // target if ANY other track still carries solo, which would make a stem —
      // and thus a summed mix with 2+ soloed tracks — come out silent.
      tracks: project.tracks.map(t => t.id === id ? { ...t, mute: false, solo: false } : { ...t, mute: true, solo: false }),
    }
  }

  const engine = new DawEngine({ ctx: octx as unknown as AudioContext })
  engine.setPresets(combinePresets(project.presets))
  engine.updateProject(proj)
  if (o?.dryMaster) {
    // masterAnalyser → destination, skip the compressor.
    try {
      engine.masterAnalyser.disconnect()
      engine.masterAnalyser.connect(octx.destination as unknown as AudioNode)
      engine.masterCompressor.disconnect()
    } catch { /* if the graph shape ever changes, fall through to normal render */ }
  }
  const { channels } = await engine.renderOffline({ startBeat: opts.startBeat, endBeat: opts.endBeat })
  return { channels, durSec }
}

// Re-apply ONLY the master DynamicsCompressor (same settings as the live engine,
// daw-engine.ts:225-230) to a summed dry buffer.
async function applyMasterCompressor(channels: Float32Array[], sampleRate: number): Promise<Float32Array[]> {
  const len = channels[0]?.length ?? 0
  if (!len) return channels
  const octx = new OfflineAudioContext(2, len, sampleRate)
  const buf = octx.createBuffer(2, len, sampleRate)
  buf.getChannelData(0).set(channels[0])
  buf.getChannelData(1).set(channels[1] ?? channels[0])
  const src = octx.createBufferSource()
  src.buffer = buf
  const comp = octx.createDynamicsCompressor()
  comp.threshold.value = -6
  comp.knee.value = 10
  comp.ratio.value = 2.5
  comp.attack.value = 0.003
  comp.release.value = 0.25
  src.connect(comp)
  comp.connect(octx.destination)
  src.start()
  const out = await octx.startRendering()
  return [out.getChannelData(0).slice(), out.getChannelData(1).slice()]
}

// Per-track stem summing is bit-exact ONLY when every track sums linearly into
// masterGain: no group buses, no non-zero sends/returns, no sidechained
// compressors. Otherwise fall back to a single full render.
function stemSafe(project: DawProject): boolean {
  const tracks = project.tracks ?? []
  if (tracks.some(t => t.groupId || t.kind === 'group')) return false
  if ((project.returnTracks?.length ?? 0) > 0) return false
  if (tracks.some(t => t.sendAmounts && Object.values(t.sendAmounts).some(v => v > 0))) return false
  if (tracks.some(t => (t.effects ?? []).some(e =>
    e.type === 'compressor' && (e.params as { sidechainTrackId?: string | null })?.sidechainTrackId))) return false
  return true
}

// Fingerprint one track's dry stem: its own settings + its clips + the presets it
// references + global timing. Changing an UNRELATED track/preset leaves this
// unchanged, so its cached stem is reused — that's the "change one instrument
// across the whole song, re-render just that one" win.
function trackStemFingerprint(project: DawProject, trackId: string, timingKey: string): string {
  const t = project.tracks.find(x => x.id === trackId)
  const clips = (project.arrangementClips ?? []).filter(c => c.trackId === trackId)
  const presetIds = new Set<string>()
  for (const c of clips) { const pid = (c as { presetId?: string }).presetId; if (pid) presetIds.add(pid) }
  const presets = (project.presets ?? []).filter(p => presetIds.has(p.id))
  // NOTE: `name` is NOT stripped — for a sample clip without an r2Key the engine
  // resolves WHICH sample plays from the clip's name, so a rename can change the
  // sound. Only truly-cosmetic keys are dropped.
  const json = JSON.stringify({ t, clips, presets, timingKey },
    (k, v) => (k === 'color' || k === 'colour' || k === 'label') ? undefined : v)
  return hash(json)
}

// Stems are cached as PEAK-NORMALIZED 16-bit PCM (half the memory of Float32, and
// normalization means a loud dry stem — which can exceed ±1 before the compressor
// — never clips). Reconstructing to Float32 for the sum reintroduces only 16-bit
// (~-96 dB) quantization, imperceptible in a summed mix. `gain` is the stem's peak.
export interface StemEntry { chans: Int16Array[]; gain: number }

function toStem(channels: Float32Array[]): StemEntry {
  let peak = 1e-6
  for (const ch of channels) for (let i = 0; i < ch.length; i++) { const a = ch[i] < 0 ? -ch[i] : ch[i]; if (a > peak) peak = a }
  const inv = 32767 / peak
  const chans = channels.map(ch => {
    const o = new Int16Array(ch.length)
    for (let i = 0; i < ch.length; i++) o[i] = Math.round(ch[i] * inv)   // in [-32767,32767] since peak is the max
    return o
  })
  return { chans, gain: peak }
}

// Decode a 16-bit stem back to float and add it into the running sum.
function addStem(sumL: Float32Array, sumR: Float32Array, stem: StemEntry, len: number): void {
  const l = stem.chans[0], r = stem.chans[1] ?? stem.chans[0]
  const g = stem.gain / 32767
  const n = Math.min(len, l.length)
  for (let i = 0; i < n; i++) { sumL[i] += l[i] * g; sumR[i] += r[i] * g }
}

// 16-bit stems halve per-stem memory, so a higher cap still fits many stems.
const MEM_CAP_BYTES = 512 * 1024 * 1024

// Full-mix render with a per-track stem CACHE. Re-renders only the tracks whose
// audio changed since last time and reuses cached stems for the rest, then sums
// and re-applies the master compressor. Falls back to a single full render when
// the project isn't stem-safe, is trivial (<2 tracks), or would exceed the cache
// memory budget. `cache` is owned by the caller (one Map per linked source).
export async function renderProjectMixCached(
  project: DawProject,
  opts: { startBeat: number; endBeat: number; userId?: string | null },
  cache: Map<string, StemEntry>,
): Promise<RenderedMix> {
  const t0 = performance.now()
  await ensureSeeded(opts.userId)
  const segs = tempoSegments(project)
  const durSec = Math.max(0.1, beatToSeconds(opts.endBeat, segs) - beatToSeconds(opts.startBeat, segs))
  const len = Math.ceil(durSec * SR)

  const hasSolo = project.tracks.some(t => t.solo)
  const audible = project.tracks.filter(t =>
    !t.mute && (!hasSolo || t.solo) &&
    (project.arrangementClips ?? []).some(c => c.trackId === t.id))

  // 16-bit → 2 bytes/sample/channel; +1 for stems that momentarily co-reside with
  // stale ones before eviction below.
  const memEstimate = (audible.length + 1) * len * 2 * 2
  if (!stemSafe(project) || audible.length < 2 || memEstimate > MEM_CAP_BYTES) {
    cache.clear()
    return renderProjectAudioBlob(project, opts)
  }

  const timingKey = hash(JSON.stringify(segs))
  const sumL = new Float32Array(len)
  const sumR = new Float32Array(len)
  const live = new Set<string>()
  let rendered = 0, reused = 0
  for (const t of audible) {
    const fp = trackStemFingerprint(project, t.id, timingKey)
    live.add(fp)
    let stem = cache.get(fp)
    if (!stem) {
      const { channels } = await renderChannels(project, opts, { soloTrackId: t.id, dryMaster: true })
      stem = toStem(channels)
      cache.set(fp, stem)
      rendered++
    } else {
      reused++
    }
    addStem(sumL, sumR, stem, len)
  }
  for (const k of Array.from(cache.keys())) if (!live.has(k)) cache.delete(k)

  const t1 = performance.now()
  const mastered = await applyMasterCompressor([sumL, sumR], SR)
  const { blob } = await encodeMix(mastered, SR)
  const peaks = peaksFrom(mastered[0] ?? new Float32Array(0))
  const t2 = performance.now()
  console.log(`[dawmix] stems rendered ${rendered} reused ${reused} · synth ${(t1 - t0) | 0}ms · master+encode ${(t2 - t1) | 0}ms · total ${(t2 - t0) | 0}ms`)
  return { blob, durationSec: durSec, peaks }
}

// Single full render (no stem cache). Used by the song-video pipeline, the
// audio-editor cross link, and as the fallback inside renderProjectMixCached.
export async function renderProjectAudioBlob(
  project: DawProject,
  opts: { startBeat: number; endBeat: number; userId?: string | null },
): Promise<RenderedMix> {
  const t0 = performance.now()
  await ensureSeeded(opts.userId)
  const { channels, durSec } = await renderChannels(project, opts)
  const t1 = performance.now()
  const { blob } = await encodeMix(channels, SR)
  const peaks = peaksFrom(channels[0] ?? new Float32Array(0))
  const t2 = performance.now()
  console.log(`[dawmix] full render ${(t1 - t0) | 0}ms · encode+peaks ${(t2 - t1) | 0}ms · total ${(t2 - t0) | 0}ms`)
  return { blob, durationSec: durSec, peaks }
}
