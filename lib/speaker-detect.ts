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

/** MOTION analyzer — samples the mouth region and measures frame-to-frame movement. No model; the
 *  robust fallback. Resolves empty on any failure so callers degrade gracefully. */
export async function analyzeSpeakerMotion(videoUrl: string, opts: SpeakerOpts = {}): Promise<SpeakerTrack> {
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

// ── Face-landmark analyzer (MediaPipe) — true lip-openness, more accurate than motion ─────────────
const MP_VERSION = '1.0.1'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _landmarker: any = null
let _landmarkerFailed = false
async function getFaceLandmarker() {
  if (_landmarker) return _landmarker
  if (_landmarkerFailed || typeof document === 'undefined') return null
  try {
    const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision')
    const vision = await FilesetResolver.forVisionTasks(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`)
    _landmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task' },
      runningMode: 'VIDEO', numFaces: 1,
    })
    return _landmarker
  } catch { _landmarkerFailed = true; return null }
}

/** LANDMARK analyzer — detects the face and measures lip-openness fluctuation (talking makes the mouth
 *  open/close). Returns empty if the model can't load or no face is found in enough frames → the caller
 *  falls back to motion. Lip indices are MediaPipe FaceMesh: 13 (upper inner lip), 14 (lower inner),
 *  10/152 (brow/chin) for face-height normalisation. */
export async function analyzeSpeakerLandmarks(videoUrl: string, opts: SpeakerOpts = {}): Promise<SpeakerTrack> {
  if (typeof document === 'undefined') return { times: [], activity: [] }
  const lm = await getFaceLandmarker()
  if (!lm) return { times: [], activity: [] }
  const step = Math.max(0.1, opts.step ?? 0.4)
  const maxSamples = Math.max(1, opts.maxSamples ?? 200)

  const video = document.createElement('video')
  video.crossOrigin = 'anonymous'; video.muted = true; video.preload = 'auto'; video.src = videoUrl
  const wait = (ev: string, ms = 8000) => new Promise<void>((res, rej) => {
    const on = () => { cleanup(); res() }; const onErr = () => { cleanup(); rej(new Error(ev)) }
    const to = setTimeout(() => { cleanup(); rej(new Error(ev + ' timeout')) }, ms)
    const cleanup = () => { clearTimeout(to); video.removeEventListener(ev, on); video.removeEventListener('error', onErr) }
    video.addEventListener(ev, on); video.addEventListener('error', onErr)
  })

  try {
    await wait('loadedmetadata')
    const dur = isFinite(video.duration) && video.duration > 0 ? video.duration : (opts.to ?? 0)
    const from = Math.max(0, opts.from ?? 0), to = Math.min(dur || Infinity, opts.to ?? dur)
    if (!(to > from)) return { times: [], activity: [] }
    const nSteps = Math.min(maxSamples, Math.max(1, Math.floor((to - from) / step) + 1))
    const times: number[] = [], openness: number[] = []
    let faceFrames = 0
    for (let i = 0; i < nSteps; i++) {
      if (opts.signal?.aborted) break
      const t = from + i * step
      video.currentTime = Math.min(t, to - 0.001)
      await wait('seeked')
      let open = openness.length ? openness[openness.length - 1] : 0
      try {
        const r = lm.detectForVideo(video, Math.round(t * 1000))
        const face = r?.faceLandmarks?.[0]
        if (face && face.length > 152) {
          const mouth = Math.abs(face[13].y - face[14].y)
          const faceH = Math.abs(face[152].y - face[10].y) || 1
          open = mouth / faceH
          faceFrames++
        }
      } catch { /* keep the previous openness */ }
      times.push(t); openness.push(open)
      opts.onProgress?.((i + 1) / nSteps)
    }
    // Not enough face → let the caller fall back to motion.
    if (faceFrames < Math.max(2, nSteps * 0.25)) return { times: [], activity: [] }
    // Talking = fluctuation of lip-openness (frame-to-frame change), normalised.
    const fluct = openness.map((o, i) => (i === 0 ? 0 : Math.abs(o - openness[i - 1])))
    const peak = Math.max(1e-6, ...fluct)
    const activity = fluct.map(f => Math.min(1, f / peak))
    if (activity.length > 1) activity[0] = activity[1]
    return { times, activity }
  } catch {
    return { times: [], activity: [] }
  } finally {
    video.removeAttribute('src'); video.load()
  }
}

/** Smart entry: try face-landmark lip-openness (accurate); fall back to mouth-region motion if the model
 *  can't load or there's no face (e.g. b-roll). Same shape either way. */
export async function analyzeSpeaker(videoUrl: string, opts: SpeakerOpts = {}): Promise<SpeakerTrack> {
  const byFace = await analyzeSpeakerLandmarks(videoUrl, opts)
  if (byFace.times.length) return byFace
  return analyzeSpeakerMotion(videoUrl, opts)
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
