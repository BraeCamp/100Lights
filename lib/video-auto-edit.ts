// Auto-edit: turn a pile of footage + an audio bed into a beat-synced montage. Pure + deterministic
// (given a seed), so it's testable and drives BOTH the toolbar "Auto-edit" button and the programmatic
// window.__video.autoEdit hook (the AI/agent surface). It lays the pool clips end-to-end on one video
// track, cutting on musical BARS when the audio carries a beat map (see lib/video-beats), or on a
// steady cadence otherwise, and drops a short transition on every cut.
import type { TimelineItem, TransitionType } from './editor-types'

export interface AutoEditPoolClip {
  url: string
  duration?: number   // source seconds, if known (lets us pick varied in-points)
  label?: string
}

export interface AutoEditOptions {
  barsPerCut?: number          // cut every N bars when a beat map exists (default 2)
  fallbackSeconds?: number     // cut cadence when there's no beat map (default 2.4s)
  transition?: TransitionType | 'none'   // transition on each cut (default 'dissolve')
  transitionDuration?: number  // seconds (default 0.28)
  shuffle?: boolean            // shuffle the clip order (default true)
  varyInPoints?: boolean       // start each cut at a varied point in its source clip (default true)
  colors?: string[]
  look?: string                // a lib/video-effects id to grade every cut with (e.g. 'blockbuster')
  seed?: number                // deterministic RNG (tests); omit for Math.random
}

export interface AutoEditInput {
  keepItems: TimelineItem[]    // items to KEEP untouched (audio, titles, other tracks)
  pool: AutoEditPoolClip[]     // source video clips to cut from
  trackId: string              // target video track the montage is written to
  songEnd: number              // fill the montage up to this timeline-second
  bars: number[]               // downbeat times in timeline seconds (may be empty)
  beats?: number[]             // beat times (fallback when there are no bars)
  startAt?: number             // where the montage begins (default 0)
  options?: AutoEditOptions
}

const DEFAULT_COLORS = ['#2563eb', '#7c3aed', '#059669', '#d97706', '#dc2626', '#0891b2', '#9333ea']

// Tiny seeded RNG (mulberry32) so a given seed reproduces the same edit.
function rng(seed?: number): () => number {
  if (seed == null) return Math.random
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Build the cut boundaries (timeline seconds) between startAt and songEnd. */
function cutBoundaries(input: AutoEditInput): number[] {
  const { bars, beats = [], startAt = 0, songEnd } = input
  const barsPerCut = Math.max(1, Math.round(input.options?.barsPerCut ?? 2))
  const fallback = Math.max(0.4, input.options?.fallbackSeconds ?? 2.4)
  const inRange = (a: number[]) => a.filter(t => t > startAt + 0.05 && t < songEnd - 0.05).sort((x, y) => x - y)

  let mids: number[]
  const barsR = inRange(bars)
  if (barsR.length >= 1) {
    mids = barsR.filter((_, i) => i % barsPerCut === 0)          // every Nth bar
  } else {
    const beatsR = inRange(beats)
    if (beatsR.length >= 1) {
      const step = Math.max(1, barsPerCut * 4)                   // ~N bars of 4 beats
      mids = beatsR.filter((_, i) => i % step === 0)
    } else {
      mids = []                                                  // no musical grid → steady cadence
      for (let t = startAt + fallback; t < songEnd - 0.05; t += fallback) mids.push(t)
    }
  }
  return [startAt, ...mids, songEnd]
}

export function autoEditTimeline(input: AutoEditInput): { items: TimelineItem[]; cuts: number } {
  const o = input.options ?? {}
  const colors = o.colors ?? DEFAULT_COLORS
  const transition = o.transition ?? 'dissolve'
  const transitionDuration = o.transitionDuration ?? 0.28
  const rand = rng(o.seed)

  if (!input.pool.length || input.songEnd <= (input.startAt ?? 0) + 0.1) {
    return { items: input.keepItems, cuts: 0 }
  }

  // Clip order: optionally shuffled (Fisher–Yates with our RNG so it's seed-stable).
  const order = input.pool.map((_, i) => i)
  if (o.shuffle !== false) {
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1));[order[i], order[j]] = [order[j], order[i]] }
  }

  const bounds = cutBoundaries(input)
  const montage: TimelineItem[] = []
  let ci = 0
  for (let i = 0; i + 1 < bounds.length; i++) {
    const startTime = bounds[i]
    const dur = bounds[i + 1] - startTime
    if (dur < 0.08) continue
    const clip = input.pool[order[ci % order.length]]; ci++
    // Pick a start point inside the source clip; if the clip is longer than the cut, vary where it
    // begins so repeats don't look identical. Clamp so we never read past the clip's end.
    const srcLen = clip.duration && clip.duration > 0 ? clip.duration : dur
    const maxIn = Math.max(0, srcLen - dur)
    const inPoint = o.varyInPoints === false ? 0 : +(rand() * maxIn).toFixed(3)
    const outPoint = +Math.min(inPoint + dur, srcLen).toFixed(3)
    montage.push({
      id: (globalThis.crypto?.randomUUID?.() ?? `ae-${i}-${Math.floor(rand() * 1e9)}`),
      label: clip.label || 'Auto clip',
      startTime: +startTime.toFixed(3),
      inPoint, outPoint,
      captions: [],
      color: colors[i % colors.length],
      trackId: input.trackId,
      contentType: 'video',
      url: clip.url,
      ...(o.look ? { look: o.look } : {}),
      ...(i > 0 && transition !== 'none' ? { transitionIn: transition as TransitionType, transitionDuration } : {}),
    })
  }

  return { items: [...input.keepItems, ...montage], cuts: montage.length }
}
