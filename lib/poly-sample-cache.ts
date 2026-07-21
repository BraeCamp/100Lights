'use client'

/**
 * Buffer cache for the poly synth's "sample" oscillator layers.
 *
 * `playPolyVoice` is synchronous and engine-less, but library samples decode
 * asynchronously — so the audio thread reads decoded buffers from this
 * module-level cache with `getPolySample` (sync), and callers warm it ahead of
 * playback with `ensurePolySample` (async, deduped). A layer whose buffer isn't
 * cached yet is simply silent for that note; its sibling wave layers still play.
 */

import { libraryFulfill } from './default-samples'

const cache = new Map<string, AudioBuffer>()
const inflight = new Map<string, Promise<AudioBuffer | null>>()

/** Synchronous read for the audio thread. Undefined until warmed. */
export function getPolySample(id: string): AudioBuffer | undefined {
  return cache.get(id)
}

/** Decode a library sample into the cache. Idempotent and request-deduped, so
 *  it's safe to call on every render / selection / pre-warm. */
export function ensurePolySample(ctx: BaseAudioContext, id: string): Promise<AudioBuffer | null> {
  const hit = cache.get(id)
  if (hit) return Promise.resolve(hit)
  const pending = inflight.get(id)
  if (pending) return pending
  const p = (async () => {
    try {
      const entry = await libraryFulfill(id)
      if (!entry?.audioBlob) return null
      const buf = await ctx.decodeAudioData(await entry.audioBlob.arrayBuffer())
      cache.set(id, buf)
      return buf
    } catch {
      return null
    } finally {
      inflight.delete(id)
    }
  })()
  inflight.set(id, p)
  return p
}
