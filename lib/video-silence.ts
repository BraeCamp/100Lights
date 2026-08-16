// Audio-driven silence detection for the jump-cut editor. Unlike the caption-based trim (which needs
// a transcript), this decodes the clip's own audio and finds silent gaps by RMS — so it works on any
// talking footage. Returns gaps in SOURCE seconds, already shrunk by `pad` so speech isn't clipped.
// Client-only (Web Audio); import from the editor.
export interface SilenceGap { start: number; end: number }
export interface SilenceOpts {
  threshold?: number   // RMS floor (0..1); windows below this are "silent" (default 0.02)
  minSilence?: number  // shortest gap to cut, seconds (default 0.35)
  pad?: number         // keep this much audio around speech, seconds (default 0.08)
  from?: number        // analyze from this source second (default 0)
  to?: number          // …to this source second (default duration)
  win?: number         // RMS window seconds (default 0.02)
}

export async function detectSilenceGaps(url: string, opts: SilenceOpts = {}): Promise<{ gaps: SilenceGap[]; duration: number }> {
  const threshold = opts.threshold ?? 0.02
  const minSilence = opts.minSilence ?? 0.35
  const pad = opts.pad ?? 0.08
  const winSec = opts.win ?? 0.02

  const arr = await fetch(url).then(r => r.arrayBuffer())
  const ctx = new OfflineAudioContext(1, 1, 44100)
  const buf = await ctx.decodeAudioData(arr)
  const sr = buf.sampleRate
  const data = buf.getChannelData(0)
  const from = Math.max(0, Math.floor((opts.from ?? 0) * sr))
  const to = Math.min(data.length, Math.floor((opts.to ?? buf.duration) * sr))
  const w = Math.max(1, Math.floor(winSec * sr))

  // RMS per window → silent flags
  const flags: { t: number; silent: boolean }[] = []
  for (let i = from; i < to; i += w) {
    let s = 0, n = 0
    const end = Math.min(i + w, to)
    for (let j = i; j < end; j++) { const v = data[j] || 0; s += v * v; n++ }
    flags.push({ t: i / sr, silent: Math.sqrt(s / Math.max(1, n)) < threshold })
  }

  // Coalesce silent runs ≥ minSilence, then shrink each by `pad` on both sides.
  const gaps: SilenceGap[] = []
  let runStart: number | null = null
  for (let k = 0; k <= flags.length; k++) {
    const silent = k < flags.length && flags[k].silent
    if (silent && runStart === null) runStart = flags[k].t
    else if (!silent && runStart !== null) {
      const runEnd = k < flags.length ? flags[k].t : to / sr
      if (runEnd - runStart >= minSilence) {
        const gs = runStart + pad, ge = runEnd - pad
        if (ge > gs) gaps.push({ start: +gs.toFixed(3), end: +ge.toFixed(3) })
      }
      runStart = null
    }
  }
  return { gaps, duration: buf.duration }
}
