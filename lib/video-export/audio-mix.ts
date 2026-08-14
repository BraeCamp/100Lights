/**
 * Offline timeline audio mixer.
 *
 * Renders the whole timeline's audio to a single AudioBuffer via an
 * OfflineAudioContext — decoding each clip once, scheduling it at its timeline
 * position, and applying per-track volume, per-clip fade in/out, and per-clip
 * EQ (the same low/mid/high shelves the editor's live EQ uses). This runs
 * faster than real-time and never touches the live <video> elements, so it
 * avoids the "one MediaElementSource per element" restriction.
 *
 * Overlapping clips on different tracks are summed (a real multitrack mix). For
 * a single sequential track — the common case — that is identical to what the
 * preview plays; it only differs when tracks genuinely overlap, which the
 * single-clip preview can't represent anyway.
 */

import type { TimelineItem, Track } from '@/lib/editor-types'
import { instantSpeed } from './speed'
import { wsola } from '@/lib/wsola'
import { buildVocalClarityChain } from '@/lib/vocal-clarity'

export interface MixClip {
  url?:         string
  file?:        File
  startTime:    number
  inPoint:      number
  outPoint:     number
  trackId:      string
  contentType?: string
  fadeIn?:      number
  fadeOut?:     number
  eq?:          { low: number; mid: number; high: number }
  vocalClarity?: number
  speed?:       number
  speedPoints?: Array<{ t: number; speed: number }>
}

const SAMPLE_RATE = 48000

async function fetchArrayBuffer(clip: MixClip): Promise<ArrayBuffer | null> {
  try {
    if (clip.file) return await clip.file.arrayBuffer()
    if (clip.url)  return await (await fetch(clip.url)).arrayBuffer()
  } catch { /* unreachable / expired URL */ }
  return null
}

/**
 * @returns the mixed AudioBuffer, or null if nothing audible was scheduled.
 */
export async function renderTimelineAudio(
  clips:      MixClip[],
  tracks:     Track[],
  totalDur:   number,
  onProgress?: (frac: number) => void,
): Promise<AudioBuffer | null> {
  if (totalDur <= 0) return null

  const isMedia = (tr: Track) => tr.type === 'media' || tr.type === 'video' || tr.type === 'audio'
  const hasSolo = tracks.some(tr => isMedia(tr) && tr.solo)
  const trackById = new Map(tracks.map(tr => [tr.id, tr]))
  const audible = (tr?: Track) => !!tr && isMedia(tr) && !tr.muted && (!hasSolo || !!tr.solo)

  // Only clips that carry audio and sit on an audible track.
  const work = clips.filter(c =>
    (c.contentType === 'video' || c.contentType === 'audio' || c.contentType == null) &&
    (c.url || c.file) &&
    audible(trackById.get(c.trackId)) &&
    c.outPoint - c.inPoint > 0,
  )
  if (work.length === 0) return null

  // Decode each unique source once (a temporary online ctx just for decoding).
  const decodeCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
  const bufCache = new Map<string, AudioBuffer | null>()
  let decoded = 0
  for (const c of work) {
    const key = c.url ?? c.file!.name + c.file!.size
    if (bufCache.has(key)) continue
    const ab = await fetchArrayBuffer(c)
    if (!ab) { bufCache.set(key, null); continue }
    try {
      bufCache.set(key, await decodeCtx.decodeAudioData(ab))
    } catch {
      bufCache.set(key, null)   // not decodable audio (e.g. video with no audio track)
    }
    onProgress?.(0.1 + 0.5 * (++decoded / work.length))
  }
  decodeCtx.close?.()

  const length = Math.ceil(totalDur * SAMPLE_RATE)
  const offline = new OfflineAudioContext(2, length, SAMPLE_RATE)

  let scheduled = 0
  for (const c of work) {
    const key = c.url ?? c.file!.name + c.file!.size
    const buffer = bufCache.get(key)
    if (!buffer) continue

    const track = trackById.get(c.trackId)
    const vol = Math.max(0, Math.min(1, track?.volume ?? 1))
    const speed = c.speed ?? 1
    const hasRamp = !!c.speedPoints?.length
    // Timeline seconds the clip occupies. At speed ≠ 1 the element consumes
    // source faster/slower, so the buffer-remaining clamp divides by speed.
    const timelineDur = c.outPoint - c.inPoint
    const dur = (speed !== 1 || hasRamp)
      ? Math.min(timelineDur, Math.max(0, (buffer.duration - c.inPoint) / Math.max(0.0625, speed)))
      : Math.min(timelineDur, Math.max(0, buffer.duration - c.inPoint))
    if (dur <= 0) continue

    // Clip speed. Constant speed: WSOLA time-stretch so pitch is preserved —
    // matching the live preview, whose <video> element pitch-corrects. Velocity
    // ramps: playbackRate curve (resampled — pitch follows the ramp; a ramped
    // WSOLA would need per-segment stretching). Compute BEFORE creating the
    // source node: an AudioBufferSourceNode's buffer can only be set once.
    let stretched: AudioBuffer | null = null
    if (speed !== 1 && !hasRamp) {
      try {
        const sr = buffer.sampleRate
        const srcStart = Math.max(0, Math.floor(c.inPoint * sr))
        const srcLen = Math.min(buffer.length - srcStart, Math.max(1, Math.ceil(dur * speed * sr)))
        if (srcLen > sr * 0.05) {
          const slice = new AudioBuffer({ length: srcLen, sampleRate: sr, numberOfChannels: buffer.numberOfChannels })
          for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
            slice.copyToChannel(buffer.getChannelData(ch).subarray(srcStart, srcStart + srcLen), ch)
          }
          stretched = wsola(slice, 1 / speed)
        }
      } catch {
        stretched = null   // fall through to the resampling path
      }
    }

    const src = offline.createBufferSource()
    src.buffer = stretched ?? buffer

    if (!stretched && (speed !== 1 || hasRamp)) {
      if (hasRamp) {
        const n = Math.max(8, Math.min(512, Math.ceil(dur * 20)))
        const curve = new Float32Array(n)
        for (let k = 0; k < n; k++) curve[k] = instantSpeed(c, (dur * k) / (n - 1))
        try {
          src.playbackRate.setValueCurveAtTime(curve, Math.max(0, c.startTime), dur)
        } catch {
          src.playbackRate.value = speed
        }
      } else {
        src.playbackRate.value = speed
      }
    }

    // Per-clip processing chain: source → [vocal clarity] → [EQ] → gain → dest. Built as a series of
    // [input,output] segments so any number can be chained.
    let head: AudioNode | null = null, tail: AudioNode | null = null
    const append = (input: AudioNode, output: AudioNode) => {
      if (!head) { head = input; tail = output } else { tail!.connect(input); tail = output }
    }
    // Vocal clarity (high-pass + presence + de-ess + compression) — before the tone EQ.
    if (c.vocalClarity && c.vocalClarity > 0) {
      const vc = buildVocalClarityChain(offline, c.vocalClarity)
      append(vc.input, vc.output)
    }
    // Per-clip EQ (matches the live shared-graph shelves).
    if (c.eq && (c.eq.low || c.eq.mid || c.eq.high)) {
      const low  = offline.createBiquadFilter(); low.type  = 'lowshelf';  low.frequency.value  = 200;  low.gain.value  = c.eq.low
      const mid  = offline.createBiquadFilter(); mid.type  = 'peaking';   mid.frequency.value  = 1000; mid.Q.value = 1; mid.gain.value = c.eq.mid
      const high = offline.createBiquadFilter(); high.type = 'highshelf'; high.frequency.value = 6000; high.gain.value = c.eq.high
      low.connect(mid).connect(high)
      append(low, high)
    }

    // Volume + fade envelope.
    const g = offline.createGain()
    const start = Math.max(0, c.startTime)
    const fin   = Math.max(0, Math.min(c.fadeIn ?? 0, dur))
    const fout  = Math.max(0, Math.min(c.fadeOut ?? 0, dur))
    g.gain.setValueAtTime(fin > 0 ? 0.0001 : vol, start)
    if (fin > 0)  g.gain.linearRampToValueAtTime(vol, start + fin)
    if (fout > 0) {
      g.gain.setValueAtTime(vol, Math.max(start + fin, start + dur - fout))
      g.gain.linearRampToValueAtTime(0.0001, start + dur)
    }

    if (head) {
      src.connect(head)
      tail!.connect(g)
    } else {
      src.connect(g)
    }
    g.connect(offline.destination)
    if (stretched) {
      // Pre-stretched to the timeline window: plays at rate 1 from its start.
      src.start(start, 0)
      src.stop(start + dur)
    } else if (speed !== 1 || hasRamp) {
      // start()'s duration arg is measured in SOURCE seconds and would be wrong
      // under a varying rate — start at the in point and stop at the timeline
      // window's end instead.
      src.start(start, c.inPoint)
      src.stop(start + dur)
    } else {
      src.start(start, c.inPoint, dur)
    }
    scheduled++
  }

  if (scheduled === 0) return null
  onProgress?.(0.65)
  const rendered = await offline.startRendering()
  onProgress?.(1)
  return rendered
}

/** Convenience: pull the audio-relevant fields off a TimelineItem. */
export function toMixClip(item: TimelineItem): MixClip {
  return {
    url: item.url,
    startTime: item.startTime,
    inPoint: item.inPoint,
    outPoint: item.outPoint,
    trackId: item.trackId,
    contentType: item.contentType,
    fadeIn: item.fadeIn,
    fadeOut: item.fadeOut,
    eq: item.eq,
    vocalClarity: item.vocalClarity,
    speed: item.speed,
    speedPoints: item.speedPoints,
  }
}
