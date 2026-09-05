// Delay compensation, without the audio graph.
//
// Some things in a chain take time: a plug-in hosted out of process fills a
// ring buffer before it answers, a lookahead limiter holds the signal to see
// what is coming. A track with one of those plays LATE against a track
// without, and the drums land behind the bass by however long the plug-in
// takes. Every DAW fixes this the same way — find the slowest track, and
// delay every other track by the difference so they all arrive together.
// That arithmetic lives here so it can be tested; the engine owns the
// DelayNodes.

/** Frames of delay each track gets so that all of them line up. */
export function compensationDelays(latencies: Map<string, number>, on: boolean): Map<string, number> {
  const out = new Map<string, number>()
  if (!on || latencies.size === 0) {
    for (const id of latencies.keys()) out.set(id, 0)
    return out
  }
  let max = 0
  for (const v of latencies.values()) max = Math.max(max, Number.isFinite(v) && v > 0 ? v : 0)
  for (const [id, v] of latencies) out.set(id, Math.max(0, max - (Number.isFinite(v) && v > 0 ? v : 0)))
  return out
}

/** A latency the way a person reads it: "4.2 ms", "0 ms". */
export function describeLatency(samples: number, sampleRate: number): string {
  if (!samples || sampleRate <= 0) return '0 ms'
  const ms = (samples / sampleRate) * 1000
  return ms >= 10 ? `${Math.round(ms)} ms` : `${ms.toFixed(1)} ms`
}
