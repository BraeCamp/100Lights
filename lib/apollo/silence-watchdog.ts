'use client'
// "At some point all of the sound disappeared."
//
// That report is real and I could not reproduce it — a full pass through the
// song with seeks and a stop/resume stayed audible throughout, and a single
// unexplained instance showed up in a test harness and never came back. Chasing
// an intermittent fault by guessing is how you end up fixing things that were
// never broken, so instead: notice it when it happens, and write down everything
// that could explain it while the evidence is still there.
//
// The rule is deliberately conservative. The transport must be running, the
// master must be silent for several seconds continuously, and the song must
// actually have notes under the playhead — a genuine rest, a fade-out or an
// empty bar is not a fault, and a watchdog that cries during the quiet part of a
// song is one nobody reads.

export interface SilenceReport {
  at: string
  beat: number
  quietForSec: number
  /** Everything that could explain silence, captured at the moment it happened. */
  state: Record<string, unknown>
}

const KEY = 'apollo-silence-reports'
const MAX_KEPT = 10

/** Past reports, newest last. Cheap to read; meant for a bug report. */
export function silenceReports(): SilenceReport[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as SilenceReport[] } catch { return [] }
}

function record(r: SilenceReport): void {
  try {
    const all = [...silenceReports(), r].slice(-MAX_KEPT)
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch { /* private mode — the console line below is still there */ }
}

interface WatchedEngine {
  isPlaying: boolean
  currentBeat: number
  masterAnalyser?: AnalyserNode
  ctx: BaseAudioContext & { state?: string }
  masterVolume?: number
}

const SILENT_PEAK = 0.0008     // below this is silence, not just quiet
const NEEDED_SEC = 4           // how long it must stay silent to count
const POLL_MS = 500

let timer: ReturnType<typeof setInterval> | null = null
let quietSince: number | null = null
let lastReportBeat = -1

/**
 * Watch the master bus while the transport runs.
 *
 * `expectedNow(beat)` answers "should anything be sounding here?" — the caller
 * knows the arrangement, this file does not. Returning false suppresses a report,
 * which is what makes a fade-out or a rest not look like a fault.
 */
export function startSilenceWatchdog(
  /** A GETTER, not the engine. The editor can dispose and rebuild its engine —
   *  StrictMode does it on every mount — and holding the object means watching a
   *  dead one forever, which looks exactly like "no faults found". This was
   *  caught by testing that the watchdog actually FIRES rather than only that it
   *  stays quiet; a detector that can never trigger passes the quiet test. */
  getEngine: () => WatchedEngine | null,
  expectedNow: (beat: number) => boolean,
  extraState: () => Record<string, unknown> = () => ({}),
): void {
  stopSilenceWatchdog()
  let buf = new Float32Array(2048)
  timer = setInterval(() => {
    const engine = getEngine()
    if (!engine?.isPlaying || !engine.masterAnalyser) { quietSince = null; return }
    if (buf.length !== engine.masterAnalyser.fftSize) buf = new Float32Array(engine.masterAnalyser.fftSize)
    engine.masterAnalyser.getFloatTimeDomainData(buf)
    let peak = 0
    for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i]); if (v > peak) peak = v }

    if (peak > SILENT_PEAK) { quietSince = null; return }
    const beat = engine.currentBeat
    if (!expectedNow(beat)) { quietSince = null; return }   // supposed to be quiet here

    quietSince ??= Date.now()
    const quietFor = (Date.now() - quietSince) / 1000
    if (quietFor < NEEDED_SEC) return
    // One report per stretch, not one every tick.
    if (Math.abs(beat - lastReportBeat) < 8) return
    lastReportBeat = beat

    const report: SilenceReport = {
      at: new Date().toISOString(),
      beat: +beat.toFixed(2),
      quietForSec: +quietFor.toFixed(1),
      state: {
        audioContextState: engine.ctx.state ?? 'unknown',
        masterVolume: engine.masterVolume,
        sampleRate: (engine.ctx as { sampleRate?: number }).sampleRate,
        ...extraState(),
      },
    }
    record(report)
    console.warn('[silence] the transport is running but nothing is sounding —', report)
  }, POLL_MS)
}

export function stopSilenceWatchdog(): void {
  if (timer !== null) { clearInterval(timer); timer = null }
  quietSince = null
}

if (typeof window !== 'undefined') {
  ;(window as unknown as { __silenceReports?: typeof silenceReports }).__silenceReports = silenceReports
}
