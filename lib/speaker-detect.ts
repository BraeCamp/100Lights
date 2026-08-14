// Speaker (mouth-movement) detection — an OFFLINE pass that scores, per camera, how much the person is
// TALKING over time, so multicam can cut to whoever's speaking (not just whoever's loudest). Browser-only
// (needs <video> + canvas). No model/dependency: it measures MOTION in the mouth region (centre-lower of
// the frame, where a talking head's mouth sits) frame-to-frame — a talking mouth flickers, a still face
// doesn't. A face-landmark model (true lip-openness) can drop in later behind the same interface.

export interface SpeakerTrack {
  times: number[]        // sampled timeline-relative seconds (from the clip's own start)
  activity: number[]     // 0..1 mouth-region motion at each time (higher = more likely talking)
}

export interface SpeakerOpts {
  from?: number          // start seconds within the source (default 0)
  to?: number            // end seconds (default duration)
  step?: number          // sample interval seconds (default 0.4)
  maxSamples?: number    // hard cap so long clips stay fast (default 200)
  signal?: AbortSignal
  onProgress?: (frac: number) => void
}

/** Sample a video's mouth region over time and return a motion (talking) envelope. Resolves with an
 *  empty envelope on any failure (no face, CORS-tainted, decode error) so callers fall back gracefully. */
export async function analyzeSpeaker(videoUrl: string, opts: SpeakerOpts = {}): Promise<SpeakerTrack> {
  if (typeof document === 'undefined') return { times: [], activity: [] }
  const step = Math.max(0.1, opts.step ?? 0.4)
  const maxSamples = Math.max(1, opts.maxSamples ?? 200)

  const video = document.createElement('video')
  video.crossOrigin = 'anonymous'
  video.muted = true
  video.preload = 'auto'
  video.src = videoUrl

  const wait = (ev: string, ms = 8000) => new Promise<void>((res, rej) => {
    const on = () => { cleanup(); res() }
    const onErr = () => { cleanup(); rej(new Error(ev + ' error')) }
    const to = setTimeout(() => { cleanup(); rej(new Error(ev + ' timeout')) }, ms)
    const cleanup = () => { clearTimeout(to); video.removeEventListener(ev, on); video.removeEventListener('error', onErr) }
    video.addEventListener(ev, on); video.addEventListener('error', onErr)
  })

  try {
    await wait('loadedmetadata')
    const dur = isFinite(video.duration) && video.duration > 0 ? video.duration : (opts.to ?? 0)
    const from = Math.max(0, opts.from ?? 0)
    const to = Math.min(dur || Infinity, opts.to ?? dur)
    if (!(to > from)) return { times: [], activity: [] }

    // Small canvas over the mouth region (centre-x, lower-middle-y) — tiny = fast, motion-only.
    const CW = 48, CH = 32
    const canvas = document.createElement('canvas'); canvas.width = CW; canvas.height = CH
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return { times: [], activity: [] }
    const VW = video.videoWidth || 1280, VH = video.videoHeight || 720
    const sx = Math.round(VW * 0.28), sy = Math.round(VH * 0.50), sw = Math.round(VW * 0.44), sh = Math.round(VH * 0.34)

    const nSteps = Math.min(maxSamples, Math.max(1, Math.floor((to - from) / step) + 1))
    const times: number[] = [], activity: number[] = []
    let prev: Uint8ClampedArray | null = null

    for (let i = 0; i < nSteps; i++) {
      if (opts.signal?.aborted) break
      const t = from + i * step
      video.currentTime = Math.min(t, to - 0.001)
      await wait('seeked')
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, CW, CH)
      const px = ctx.getImageData(0, 0, CW, CH).data
      // Grayscale + mean abs diff vs the previous sample = motion in the mouth region.
      const gray = new Uint8ClampedArray(CW * CH)
      for (let p = 0, g = 0; p < px.length; p += 4, g++) gray[g] = (px[p] * 0.299 + px[p + 1] * 0.587 + px[p + 2] * 0.114) | 0
      let motion = 0
      if (prev) { let sum = 0; for (let g = 0; g < gray.length; g++) sum += Math.abs(gray[g] - prev[g]); motion = sum / (gray.length * 255) }
      prev = gray
      times.push(t); activity.push(motion)
      opts.onProgress?.((i + 1) / nSteps)
    }

    // Normalise to 0..1 by the observed peak (so a quiet clip still ranks its own loudest moments).
    const peak = Math.max(1e-6, ...activity)
    const norm = activity.map(a => Math.min(1, a / peak))
    // First sample has no predecessor → set it to the second's value so it isn't a spurious 0.
    if (norm.length > 1) norm[0] = norm[1]
    return { times, activity: norm }
  } catch {
    return { times: [], activity: [] }
  } finally {
    video.removeAttribute('src'); video.load()
  }
}

/** Read a SpeakerTrack's activity at time t (nearest sample). 0 when empty. */
export function speakerActivityAt(track: SpeakerTrack | undefined, t: number): number {
  if (!track || !track.times.length) return 0
  // nearest sample (times are sorted, uniform-ish)
  let lo = 0, hi = track.times.length - 1
  if (t <= track.times[0]) return track.activity[0]
  if (t >= track.times[hi]) return track.activity[hi]
  while (lo <= hi) { const m = (lo + hi) >> 1; if (track.times[m] < t) lo = m + 1; else hi = m - 1 }
  const a = hi, b = lo
  return (t - track.times[a]) <= (track.times[b] - t) ? track.activity[a] : track.activity[b]
}
