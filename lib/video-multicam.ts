// Multicam "spotlight" — switch which camera/track is shown full-frame over time. A SPOTLIGHT ITEM
// (contentType 'spotlight') names a target track for its span; while one is active, the compositor
// shows ONLY that track (a hard multicam cut). buildMulticam auto-generates a switching sequence,
// either round-robin or "audio-dominant" (cut to the loudest track — i.e. whoever's talking, by sound).
// A later pass adds mouth-movement/speaker detection (face-landmark ML) as a smarter picker.
import type { TimelineItem } from './editor-types'

/** The spotlight target track active at t (from spotlight items), or null. Structural-friendly. */
export function activeSpotlight(
  items: ReadonlyArray<{ contentType?: string; startTime: number; inPoint: number; outPoint: number; spotlightTrackId?: string }>,
  t: number,
): string | null {
  for (const i of items) {
    if (i.contentType !== 'spotlight' || !i.spotlightTrackId) continue
    if (t >= i.startTime && t < i.startTime + (i.outPoint - i.inPoint)) return i.spotlightTrackId
  }
  return null
}

export interface MulticamOptions {
  barsPerCut?: number          // switch every N bars when there's a beat map (default 2)
  fallbackSeconds?: number     // switch cadence with no beat map (default 3s)
  mode?: 'roundrobin' | 'audio' // audio = cut to the loudest track each segment (default 'audio' if energyAt given)
  seed?: number
  colors?: string[]
}

export interface MulticamInput {
  cameraTrackIds: string[]     // the camera tracks to switch between (≥ 2)
  laneId: string               // the track the spotlight items sit on (a "program" lane)
  songEnd: number              // fill switches up to here
  startAt?: number
  bars: number[]
  beats?: number[]
  /** Per-track audio energy at a time (0..1), for 'audio' mode. Absent → round-robin. */
  energyAt?: (trackId: string, t: number) => number
  options?: MulticamOptions
}

const DEFAULT_COLORS = ['#f59e0b', '#ec4899', '#22d3ee', '#a3e635', '#a78bfa', '#fb7185']

function rng(seed?: number): () => number {
  if (seed == null) return Math.random
  let a = seed >>> 0
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

function boundaries(input: MulticamInput): number[] {
  const startAt = input.startAt ?? 0
  const per = Math.max(1, Math.round(input.options?.barsPerCut ?? 2))
  const fb = Math.max(0.5, input.options?.fallbackSeconds ?? 3)
  const inRange = (a: number[]) => a.filter(t => t > startAt + 0.05 && t < input.songEnd - 0.05).sort((x, y) => x - y)
  const barsR = inRange(input.bars)
  let mids: number[]
  if (barsR.length) mids = barsR.filter((_, i) => i % per === 0)
  else {
    const beatsR = inRange(input.beats ?? [])
    if (beatsR.length) mids = beatsR.filter((_, i) => i % Math.max(1, per * 4) === 0)
    else { mids = []; for (let t = startAt + fb; t < input.songEnd - 0.05; t += fb) mids.push(t) }
  }
  return [startAt, ...mids, input.songEnd]
}

/** Generate the spotlight-item switching sequence. Returns the spotlight items to place on `laneId`. */
export function buildMulticam(input: MulticamInput): { items: TimelineItem[]; switches: number } {
  const cams = input.cameraTrackIds.filter(Boolean)
  if (cams.length < 2 || input.songEnd <= (input.startAt ?? 0) + 0.1) return { items: [], switches: 0 }
  const o = input.options ?? {}
  const colors = o.colors ?? DEFAULT_COLORS
  const rand = rng(o.seed)
  const mode = o.mode ?? (input.energyAt ? 'audio' : 'roundrobin')
  const bounds = boundaries(input)

  const items: TimelineItem[] = []
  let rr = 0
  let prevCam: string | null = null
  for (let i = 0; i + 1 < bounds.length; i++) {
    const startTime = bounds[i]
    const dur = bounds[i + 1] - startTime
    if (dur < 0.08) continue
    let cam: string
    if (mode === 'audio' && input.energyAt) {
      // Loudest track at the segment's midpoint = who's talking. Ties broken toward NOT the prev cam
      // so a silent stretch still cuts occasionally rather than freezing on one camera.
      const mid = startTime + dur / 2
      let best = cams[0], bestE = -1
      for (const c of cams) { const e = input.energyAt(c, mid) + (c !== prevCam ? 1e-4 : 0); if (e > bestE) { bestE = e; best = c } }
      cam = best
    } else {
      cam = cams[rr % cams.length]; rr++
    }
    prevCam = cam
    const camIdx = cams.indexOf(cam)
    items.push({
      id: (globalThis.crypto?.randomUUID?.() ?? `sl-${i}-${Math.floor(rand() * 1e9)}`),
      label: `Cam ${camIdx + 1}`,
      startTime: +startTime.toFixed(3), inPoint: 0, outPoint: +dur.toFixed(3),
      captions: [], color: colors[camIdx % colors.length],
      trackId: input.laneId, contentType: 'spotlight', spotlightTrackId: cam,
    })
  }
  return { items, switches: items.length }
}
