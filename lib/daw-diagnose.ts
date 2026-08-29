/**
 * A playback diagnostic you can run in the browser where the problem happens.
 *
 * Brae: "I'm still having problems with audio not playing before and after full
 * song loading." Four rounds of headless testing could not reproduce it — cold
 * and baked, with and without the Apollo rack, real user gesture, no autoplay
 * override, on a production build. Twice the measurement produced a false
 * positive that only came apart on inspection: reading nine analysers per tick
 * starved headless Chrome's null audio sink until the playhead read 20% of real
 * time, and sampling short percussion once a second made a kick track look 88%
 * silent. Neither was the studio.
 *
 * So rather than guess again from here, this collects the evidence there:
 *
 *   window.__dawDiagnose()        // start watching, then press play
 *   window.__dawDiagnose.report() // after ~30 seconds of playing
 *
 * Deliberately NOT behind the dev-hooks flag. Every other hook is, which is
 * exactly why nothing could be measured on 100lights.com, which is where the
 * problem lives. It only reads meters and clocks — it never changes playback.
 */

interface TrackWatch { peak: number; sounded: number; samples: number }

interface Diagnostic {
  durationSec: number
  context: { state: string; sampleRate: number; baseLatency: number; outputLatency: number }
  /** Audio clock against wall clock. Below ~0.95 means the audio device itself
   *  is falling behind, which is a very different fault from silence. */
  audioClockRate: number
  transport: { playing: boolean; fromBeat: number; toBeat: number; beatsPerSecond: number }
  /** Longest gap between animation frames — the main thread being blocked. */
  longestStallMs: number
  /** Per track: did it ever sound, and how often was it above the noise floor? */
  tracks: Record<string, { everSounded: boolean; peak: number; soundedPct: number }>
  master: { everSounded: boolean; peak: number }
  combine: unknown
  /**
   * What loading the SAMPLES cost — fetch + decode, before a note can sound.
   *
   * Missing from every earlier report, and it is the one cost that scales with
   * how many sampled instruments a song uses rather than with anything the
   * loader measures. A multisample is one id per zone, so this can be hundreds
   * of round trips on a song the combine stats describe as nearly idle.
   */
  samples: unknown
  /** Exceptions the audio thread caught — silence with a cause. */
  engineErrors: unknown
}

type Watch = {
  started: number
  startedCtx: number
  startBeat: number
  stall: number
  lastFrame: number
  tracks: Map<string, TrackWatch>
  master: TrackWatch
  timer: ReturnType<typeof setInterval> | null
  raf: number | null
}

let watch: Watch | null = null
/**
 * The finished report from the last capture, kept after Stop.
 *
 * Brae: "when I stop recording for the one that's there, allow me to copy the
 * analysis if another recording has not been created." Stopping used to throw
 * the capture away, so the natural order — stop, then decide to send it — lost
 * the very thing you stopped to look at. It survives until the next capture
 * starts, which is the point at which it stops being the current one.
 */
let lastReport: Diagnostic | null = null

function peakOf(an: AnalyserNode): number {
  const buf = new Float32Array(an.fftSize)
  an.getFloatTimeDomainData(buf)
  let p = 0
  for (let i = 0; i < buf.length; i++) p = Math.max(p, Math.abs(buf[i]))
  return p
}

/** The parts of the engine this reads. Deliberately narrow — it must never be
 *  able to change anything. */
export interface DiagnoseEngine {
  ctx: AudioContext
  isPlaying: boolean
  currentBeat: number
  trackNodes: Map<string, { analyser: AnalyserNode }>
  masterAnalyser?: AnalyserNode
}

/**
 * Sampling runs IN the page at 40Hz and only accumulates; the report reads the
 * accumulator. Polling the meters from outside once a second was what made
 * short notes look like dropouts — a rim shot lasts about 0.2s, so a
 * once-a-second sample lands in the gap far more often than not, and a track
 * that is sounding perfectly reads as 88% silent.
 */
export function installDawDiagnose(
  getEngine: () => DiagnoseEngine | null,
  trackName?: (id: string) => string | undefined,
): () => void {
  const NOISE = 0.002

  const start = (): string => {
    stop()
    // A new capture replaces the old one, so the kept report goes now rather
    // than lingering to be copied by mistake alongside a fresh recording.
    lastReport = null
    const e = getEngine()
    if (!e) return 'no engine on this page — open a project first'
    watch = {
      started: performance.now(),
      startedCtx: e.ctx.currentTime,
      startBeat: e.currentBeat,
      stall: 0,
      lastFrame: performance.now(),
      tracks: new Map(),
      master: { peak: 0, sounded: 0, samples: 0 },
      timer: null,
      raf: null,
    }
    watch.timer = setInterval(() => {
      const eng = getEngine()
      const w = watch
      if (!eng || !w) return
      for (const [id, n] of eng.trackNodes) {
        let t = w.tracks.get(id)
        if (!t) { t = { peak: 0, sounded: 0, samples: 0 }; w.tracks.set(id, t) }
        const p = peakOf(n.analyser)
        t.peak = Math.max(t.peak, p)
        t.samples++
        if (p > NOISE) t.sounded++
      }
      if (eng.masterAnalyser) {
        const p = peakOf(eng.masterAnalyser)
        w.master.peak = Math.max(w.master.peak, p)
        w.master.samples++
        if (p > NOISE) w.master.sounded++
      }
      // 20Hz, not 40. At 40 the sampling itself was heavy enough to starve
      // headless Chrome's null audio sink — ctx.currentTime ran at 0.46x real
      // time, which on real hardware cannot happen, since that clock comes from
      // the device. 20Hz still gives four samples across a 0.2s rim shot, which
      // is what the short-note detection needs.
    }, 50)

    const tick = () => {
      const w = watch
      if (!w) return
      const now = performance.now()
      const gap = now - w.lastFrame
      if (gap > w.stall) w.stall = gap
      w.lastFrame = now
      w.raf = requestAnimationFrame(tick)
    }
    watch.raf = requestAnimationFrame(tick)
    return 'watching — press play, then run window.__dawDiagnose.report()'
  }

  const stop = () => {
    if (!watch) return
    // Take the report BEFORE tearing the capture down — afterwards there is
    // nothing left to build one from.
    const snap = report()
    if (typeof snap !== 'string') lastReport = snap
    if (watch.timer) clearInterval(watch.timer)
    if (watch.raf) cancelAnimationFrame(watch.raf)
    watch = null
  }

  const report = (): Diagnostic | string => {
    const e = getEngine()
    const w = watch
    // Stopped, but a capture was made and no new one has started: hand back
    // that one rather than pretending there is nothing to show.
    if (!w) return lastReport ?? 'not watching — run window.__dawDiagnose() first'
    if (!e) return 'no engine'
    const wallSec = (performance.now() - w.started) / 1000
    const ctxSec = e.ctx.currentTime - w.startedCtx
    const beats = e.currentBeat - w.startBeat
    const tracks: Diagnostic['tracks'] = {}
    for (const [id, t] of w.tracks) {
      // Keyed by name where there is one: a report full of UUIDs is not
      // something anyone can read at the moment they are annoyed.
      tracks[trackName?.(id) ?? id] = {
        everSounded: t.peak > NOISE,
        peak: +t.peak.toFixed(4),
        soundedPct: t.samples ? Math.round((t.sounded / t.samples) * 100) : 0,
      }
    }
    return {
      durationSec: +wallSec.toFixed(1),
      context: {
        state: e.ctx.state,
        sampleRate: e.ctx.sampleRate,
        baseLatency: +(e.ctx.baseLatency ?? 0).toFixed(4),
        outputLatency: +(e.ctx.outputLatency ?? 0).toFixed(4),
      },
      audioClockRate: wallSec > 0 ? +(ctxSec / wallSec).toFixed(3) : 0,
      transport: {
        playing: e.isPlaying,
        fromBeat: +w.startBeat.toFixed(2),
        toBeat: +e.currentBeat.toFixed(2),
        beatsPerSecond: wallSec > 0 ? +(beats / wallSec).toFixed(2) : 0,
      },
      longestStallMs: Math.round(w.stall),
      tracks,
      master: { everSounded: w.master.peak > NOISE, peak: +w.master.peak.toFixed(4) },
      combine: (window as unknown as { __combineStats?: () => unknown }).__combineStats?.() ?? null,
      samples: (window as unknown as { __sampleStats?: () => unknown }).__sampleStats?.() ?? null,
      // The audio thread's own failures. A song that crackles and then goes
      // quiet for good is process() throwing on every block: the armour keeps
      // the processor alive, so nothing else in this report would show it.
      engineErrors: (window as unknown as { __apolloEngineSingleton?: { procErrors?: unknown } })
        .__apolloEngineSingleton?.procErrors ?? null,
    }
  }

  /** Is there something to copy — either a live capture or a kept one? */
  const hasReport = () => !!watch || !!lastReport

  const api = Object.assign(start, { report, stop, hasReport })
  ;(window as unknown as { __dawDiagnose?: typeof api }).__dawDiagnose = api
  return () => {
    stop()
    delete (window as unknown as { __dawDiagnose?: typeof api }).__dawDiagnose
  }
}
