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
    const dur = Math.min(c.outPoint - c.inPoint, Math.max(0, buffer.duration - c.inPoint))
    if (dur <= 0) continue

    const src = offline.createBufferSource()
    src.buffer = buffer

    // Per-clip EQ (matches the live shared-graph shelves).
    const chainIn: AudioNode[] = []
    if (c.eq && (c.eq.low || c.eq.mid || c.eq.high)) {
      const low  = offline.createBiquadFilter(); low.type  = 'lowshelf';  low.frequency.value  = 200;  low.gain.value  = c.eq.low
      const mid  = offline.createBiquadFilter(); mid.type  = 'peaking';   mid.frequency.value  = 1000; mid.Q.value = 1; mid.gain.value = c.eq.mid
      const high = offline.createBiquadFilter(); high.type = 'highshelf'; high.frequency.value = 6000; high.gain.value = c.eq.high
      low.connect(mid).connect(high)
      chainIn.push(low, high)
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

    if (chainIn.length) {
      src.connect(chainIn[0])
      chainIn[1].connect(g)
    } else {
      src.connect(g)
    }
    g.connect(offline.destination)
    src.start(start, c.inPoint, dur)
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
  }
}
