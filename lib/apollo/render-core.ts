// Rendering Apollo without an AudioContext.
//
// A combine currently runs through an OfflineAudioContext, and Chrome runs that
// on the MAIN THREAD when it carries JS worklets — so a render freezes the
// interface for its whole duration. That is why baking stops the moment you
// press play (freeze-cache: "baking resumes on pause"), and it is why a first
// listen through a project bakes nothing at all: the good path exists and never
// gets to run.
//
// But nothing in a combine actually needs Web Audio. The graph is Apollo nodes
// into a merger — no convolver, no biquad, no browser DSP of any kind. The
// engine is plain JavaScript that already runs headless: scripts/apollo-render
// .mjs has driven it in Node since this toolchain existed.
//
// So this drives it directly, block by block. No context, no worklet, no
// message port — which also removes the asynchronous-setup race that made
// renders come back silent, because here the messages are ordinary function
// calls that have returned before the first sample is asked for.
//
// It is deliberately free of browser and Node specifics so the same code can be
// tested against the known-good renderer and then run inside a Worker.

/** The processor class engine.js hands to registerProcessor. */
export interface EngineProcessor {
  onMessage(msg: unknown): void
  process(inputs: unknown[], outputs: Float32Array[][]): boolean
}
export type EngineCtor = new () => EngineProcessor

export interface RenderJob {
  /** Setup messages, in order: ranges, tables, samples, LFO LUTs, patch, schedule. */
  messages: unknown[]
}

export interface RenderProgress {
  /** 0..1 through the render. Called at block boundaries so a Worker can report. */
  (done: number): void
}

const BLOCK = 128

/**
 * Render every job in lockstep and return interleaved channels: two per job, in
 * job order, which is the layout renderManyToBuffer already produces.
 *
 * `setGlobals` is how the caller supplies the two globals engine.js reads —
 * `sampleRate` at construction and `currentTime` per block. They are globals in
 * an AudioWorkletGlobalScope, so there is no way to pass them in; the caller
 * owns whichever scope this is running in.
 */
export function renderJobs(
  Engine: EngineCtor,
  jobs: RenderJob[],
  frames: number,
  sampleRate: number,
  setGlobals: (currentTime: number) => void,
  onProgress?: RenderProgress,
): Float32Array[] {
  const blocks = Math.ceil(frames / BLOCK)
  const out: Float32Array[] = []
  for (let i = 0; i < jobs.length * 2; i++) out.push(new Float32Array(blocks * BLOCK))

  const procs: EngineProcessor[] = []
  for (const job of jobs) {
    setGlobals(0)
    const p = new Engine()
    // Straight calls, in order, all of them returned before any audio is asked
    // for. The OfflineAudioContext path sends these over a MessagePort and does
    // NOT wait, which is what made renders come back silent — a processor could
    // be asked for samples before it had been told which patch to play.
    for (const m of job.messages) p.onMessage(m)
    procs.push(p)
  }

  const L = new Float32Array(BLOCK), R = new Float32Array(BLOCK)
  for (let b = 0; b < blocks; b++) {
    const t = (b * BLOCK) / sampleRate
    setGlobals(t)
    for (let j = 0; j < procs.length; j++) {
      L.fill(0); R.fill(0)
      procs[j].process([], [[L, R]])
      out[j * 2].set(L, b * BLOCK)
      out[j * 2 + 1].set(R, b * BLOCK)
    }
    if (onProgress && (b & 63) === 0) onProgress(b / blocks)
  }
  onProgress?.(1)

  // Trim to the exact length asked for — the block loop always overshoots.
  return out.map(ch => (ch.length === frames ? ch : ch.subarray(0, frames)))
}
