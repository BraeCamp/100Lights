// ── Comping: take management engine ──────────────────────────────────────────
//
// "Comping" = loop-recording multiple takes and selecting the best phrases
// from each. At any point in time, at most one take's region is active.

export const TAKE_COLORS: string[] = [
  '#7c3aed', '#2563eb', '#059669', '#d97706',
  '#dc2626', '#ec4899', '#0891b2', '#f97316',
]

// ── Core types ───────────────────────────────────────────────────────────────

export interface TakeRegion {
  id: string
  startTime: number   // within the clip, seconds from clip start (0 = loop start)
  endTime: number
  selected: boolean
}

export interface Take {
  id: string
  index: number        // take number (1, 2, 3…)
  clipId: string       // reference to AudioClip in the main clips array
  recordedAt: number   // Date.now() timestamp
  color: string        // auto-assigned from TAKE_COLORS
  active: boolean      // whether this take is currently "selected" (active in the comp)
  regions: TakeRegion[] // time ranges of this take selected for the comp
}

export interface CompGroup {
  id: string
  laneType: string
  loopStart: number
  loopEnd: number
  takes: Take[]
}

// ── Region helpers ────────────────────────────────────────────────────────────

/** Sort + merge adjacent regions with the same `selected` state. */
export function normalizeRegions(regions: TakeRegion[]): TakeRegion[] {
  if (regions.length === 0) return []
  const sorted = [...regions].sort((a, b) => a.startTime - b.startTime)
  const result: TakeRegion[] = []
  for (const r of sorted) {
    if (r.endTime - r.startTime < 1e-9) continue   // skip zero-length
    const last = result[result.length - 1]
    if (last && last.selected === r.selected && last.endTime >= r.startTime - 1e-9) {
      last.endTime = Math.max(last.endTime, r.endTime)
    } else {
      result.push({ ...r })
    }
  }
  return result
}

/**
 * Paint [paintStart, paintEnd] as `selected` in the regions array.
 * Assumes regions are normalized and cover [0, loopDuration] completely.
 */
export function paintRegion(
  regions: TakeRegion[],
  paintStart: number,
  paintEnd: number,
  selected: boolean,
): TakeRegion[] {
  if (paintEnd <= paintStart) return regions
  const result: TakeRegion[] = []
  for (const r of regions) {
    if (r.endTime <= paintStart || r.startTime >= paintEnd) {
      // No overlap — keep as-is
      result.push({ ...r })
    } else {
      // Left remainder
      if (r.startTime < paintStart) {
        result.push({ ...r, endTime: paintStart })
      }
      // Overlapping portion
      result.push({
        id: crypto.randomUUID(),
        startTime: Math.max(r.startTime, paintStart),
        endTime:   Math.min(r.endTime, paintEnd),
        selected,
      })
      // Right remainder
      if (r.endTime > paintEnd) {
        result.push({ ...r, id: crypto.randomUUID(), startTime: paintEnd })
      }
    }
  }
  return normalizeRegions(result)
}

/**
 * Apply a selection paint to an entire CompGroup.
 * - Sets [start, end] as `selected` for `takeId`
 * - When selecting, deselects [start, end] in all other takes (mutex rule)
 */
export function applyCompSelection(
  group: CompGroup,
  takeId: string,
  start: number,
  end: number,
  selected: boolean,
): CompGroup {
  const takes = group.takes.map(take => {
    if (take.id === takeId) {
      return { ...take, regions: paintRegion(take.regions, start, end, selected) }
    }
    // When selecting, deselect overlapping regions in all other takes
    if (selected) {
      return { ...take, regions: paintRegion(take.regions, start, end, false) }
    }
    return take
  })
  return { ...group, takes }
}

// ── Comp rendering ────────────────────────────────────────────────────────────

interface ClipWithBuf {
  id: string
  buf: AudioBuffer
}

/**
 * Stitch together the selected regions from all takes into a single AudioBuffer.
 * At each point in time, uses whichever take has a selected region there.
 * Applies linear crossfades at region edges to avoid clicks.
 */
export async function renderComp(
  group: CompGroup,
  clips: ClipWithBuf[],
  crossfadeDuration = 0.01,
): Promise<AudioBuffer> {
  const loopDuration = group.loopEnd - group.loopStart

  // Find a reference clip to get sampleRate + channel count
  const firstClip = clips.find(c => group.takes.some(t => t.clipId === c.id))
  const sampleRate  = firstClip?.buf.sampleRate ?? 44100
  const numChannels = firstClip?.buf.numberOfChannels ?? 2
  const outputLength = Math.max(1, Math.ceil(loopDuration * sampleRate))

  const output = new AudioBuffer({ numberOfChannels: numChannels, length: outputLength, sampleRate })
  const outChannels = Array.from<unknown, Float32Array>(
    { length: numChannels },
    (_, ch) => output.getChannelData(ch),
  )

  // Collect selected segments sorted by region.startTime
  type Seg = { take: Take; region: TakeRegion; clip: ClipWithBuf }
  const segs: Seg[] = []
  for (const take of group.takes) {
    const clip = clips.find(c => c.id === take.clipId)
    if (!clip) continue
    for (const region of take.regions) {
      if (region.selected) segs.push({ take, region, clip })
    }
  }
  segs.sort((a, b) => a.region.startTime - b.region.startTime)

  const fadeSamples = Math.max(1, Math.ceil(crossfadeDuration * sampleRate))

  for (const seg of segs) {
    const { clip, region } = seg
    const srcStart = Math.floor(region.startTime * sampleRate)
    const srcEnd   = Math.min(clip.buf.length, Math.floor(region.endTime * sampleRate))
    const dstStart = Math.floor(region.startTime * sampleRate)
    const segLen   = srcEnd - srcStart

    for (let ch = 0; ch < numChannels; ch++) {
      const srcCh  = Math.min(ch, clip.buf.numberOfChannels - 1)
      const srcData = clip.buf.getChannelData(srcCh)
      const dstData = outChannels[ch]

      for (let i = 0; i < segLen; i++) {
        const dstIdx = dstStart + i
        if (dstIdx >= outputLength) break

        let gain = 1
        if (i < fadeSamples) {
          gain = i / fadeSamples
        } else if (i >= segLen - fadeSamples) {
          gain = (segLen - i) / fadeSamples
        }

        dstData[dstIdx] += srcData[srcStart + i] * gain
      }
    }
  }

  return output
}
