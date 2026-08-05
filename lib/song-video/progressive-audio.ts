// ── Progressive, gapless Web Audio player ────────────────────────────────────
// The song-video maker renders the real mix in CHUNKS (render outpaces the
// playhead ~30×), so we can start playing as soon as the first chunk is ready
// and keep dropping later chunks in WITHOUT a click or gap. This class owns the
// sample-accurate scheduling: each section is an AudioBufferSourceNode started
// at an absolute context time derived from a single play anchor, with a tiny
// equal-power crossfade at the joins so any residual boundary discontinuity is
// inaudible. It also drives the engine's clock via a duck-typed media shim
// (makeMediaShim) so the visuals follow the audio exactly.

const XFADE_SEC = 0.010 // equal-power crossfade / edge fade (~10ms)

// Precomputed equal-power fade curves (sin up, cos down): powers sum to 1 across
// a join, so a contiguous cut of two deterministic renders can't dip to silence.
const CURVE_N = 32
const UP = new Float32Array(CURVE_N + 1)
const DOWN = new Float32Array(CURVE_N + 1)
for (let i = 0; i <= CURVE_N; i++) {
  const x = i / CURVE_N
  UP[i] = Math.sin((x * Math.PI) / 2)
  DOWN[i] = Math.cos((x * Math.PI) / 2)
}

type Section = {
  id: number
  startSec: number       // logical media start (join point with the previous section)
  leadSec: number        // seconds of pre-roll audio in `buffer` BEFORE startSec (crossfade overlap)
  bufStartMedia: number  // media time the buffer's sample 0 corresponds to  (= startSec - leadSec)
  endSec: number         // logical media end (= bufStartMedia + buffer.duration)
  buffer: AudioBuffer
}

type Live = { src: AudioBufferSourceNode; gain: GainNode }

export class ProgressivePlayer {
  private ctx: AudioContext
  private dest: AudioNode
  totalSec: number
  loop: boolean

  private sections: Section[] = []
  private idc = 0
  private _playing = false
  private anchor = 0        // ctx time at which media position 0 of the CURRENT play occurs
  private pausedAt = 0      // media position (within [0,totalSec)) while paused
  private live = new Map<string, Live>()   // key `${section.id}:${iteration}` → scheduled source
  private scheduled = new Set<string>()
  private timer: ReturnType<typeof setInterval> | null = null

  private readonly aheadSec = 0.35
  private readonly tickMs = 40

  constructor(opts: { ctx: AudioContext; destination: AudioNode; totalSec: number; loop?: boolean }) {
    this.ctx = opts.ctx
    this.dest = opts.destination
    this.totalSec = Math.max(0.01, opts.totalSec)
    this.loop = !!opts.loop
  }

  get playing() { return this._playing }

  get currentTime(): number {
    if (!this._playing) return this.pausedAt
    const t = this.ctx.currentTime - this.anchor
    if (this.loop && this.totalSec > 0) return ((t % this.totalSec) + this.totalSec) % this.totalSec
    return Math.min(Math.max(0, t), this.totalSec)
  }
  set currentTime(sec: number) { this.seek(sec) }

  /** Reset for a new window/song: drop all audio, reset the clock. */
  reset(totalSec: number) {
    this.stopAll()
    this.sections = []
    this._playing = false
    this.pausedAt = 0
    this.totalSec = Math.max(0.01, totalSec)
  }

  /**
   * Insert a rendered section. `buffer` covers [startSec - leadSec, endSec] of
   * media time; `leadSec` (>0 for every chunk after the first) is the pre-roll
   * that crossfades with the previous section's tail. If playing, any part of
   * this section from the current position onward is scheduled immediately.
   */
  pushSection(startSec: number, buffer: AudioBuffer, leadSec = 0) {
    const bufStartMedia = startSec - leadSec
    const endSec = bufStartMedia + buffer.duration
    // Replace a logically-overlapping re-render (not the intentional lead overlap).
    for (let i = this.sections.length - 1; i >= 0; i--) {
      const s = this.sections[i]
      if (s.startSec < endSec - 0.02 && s.endSec > startSec + 0.02) {
        this.dropSectionLive(s.id)
        this.sections.splice(i, 1)
      }
    }
    const sec: Section = { id: ++this.idc, startSec, leadSec, bufStartMedia, endSec, buffer }
    let lo = 0
    while (lo < this.sections.length && this.sections[lo].startSec < startSec) lo++
    this.sections.splice(lo, 0, sec)
    if (this._playing) this.tick()
  }

  play() {
    if (this._playing) return
    if (this.ctx.state === 'suspended') this.ctx.resume?.()
    this.anchor = this.ctx.currentTime - this.pausedAt
    this._playing = true
    this.tick()
    if (!this.timer) this.timer = setInterval(() => this.tick(), this.tickMs)
  }

  pause() {
    if (!this._playing) return
    this.pausedAt = this.currentTime
    this._playing = false
    if (this.timer) { clearInterval(this.timer); this.timer = null }
    this.stopAll()
  }

  seek(sec: number) {
    const clamped = ((): number => {
      if (this.loop && this.totalSec > 0) return ((sec % this.totalSec) + this.totalSec) % this.totalSec
      return Math.min(Math.max(0, sec), this.totalSec)
    })()
    if (this._playing) {
      this.stopAll()
      this.anchor = this.ctx.currentTime - clamped
      this.tick()
    } else {
      this.pausedAt = clamped
    }
  }

  destroy() {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
    this.stopAll()
    this.sections = []
    this._playing = false
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private stopAll() {
    for (const { src, gain } of this.live.values()) {
      try { src.onended = null; src.stop() } catch { /* already stopped */ }
      try { src.disconnect() } catch { /* noop */ }
      try { gain.disconnect() } catch { /* noop */ }
    }
    this.live.clear()
    this.scheduled.clear()
  }

  private dropSectionLive(sectionId: number) {
    for (const [key, { src, gain }] of [...this.live.entries()]) {
      if (key.startsWith(sectionId + ':')) {
        try { src.onended = null; src.stop() } catch { /* noop */ }
        try { src.disconnect() } catch { /* noop */ }
        try { gain.disconnect() } catch { /* noop */ }
        this.live.delete(key)
      }
    }
    for (const key of [...this.scheduled]) if (key.startsWith(sectionId + ':')) this.scheduled.delete(key)
  }

  // Look ahead and schedule any not-yet-scheduled section (across loop iterations)
  // whose audio falls within the scheduling horizon.
  private tick() {
    if (!this._playing) return
    const T = this.ctx.currentTime - this.anchor
    const horizon = T + this.aheadSec
    const maxK = this.loop && this.totalSec > 0 ? Math.floor(horizon / this.totalSec) : 0
    for (let k = 0; k <= maxK; k++) {
      const base = k * this.totalSec
      for (const s of this.sections) {
        const key = s.id + ':' + k
        if (this.scheduled.has(key)) continue
        const absBufStart = base + s.bufStartMedia
        const absEnd = base + s.endSec
        if (absEnd <= T + 0.001) { this.scheduled.add(key); continue } // wholly in the past
        if (absBufStart > horizon) continue                            // not yet — a later tick gets it
        this.scheduleSection(s, k, base)
        this.scheduled.add(key)
      }
    }
  }

  private scheduleSection(s: Section, k: number, base: number) {
    const inStartCtx = this.anchor + base + s.bufStartMedia
    const now = this.ctx.currentTime
    let whenStart = inStartCtx
    let offset = 0
    if (whenStart < now) {
      offset = now - whenStart
      whenStart = now
      if (offset >= s.buffer.duration - 0.0005) return // fully past
    }

    const src = this.ctx.createBufferSource()
    src.buffer = s.buffer
    const gain = this.ctx.createGain()
    src.connect(gain); gain.connect(this.dest)

    const inEndCtx = inStartCtx + s.leadSec
    const outStartCtx = this.anchor + base + s.endSec - XFADE_SEC
    const outEndCtx = this.anchor + base + s.endSec
    const g = gain.gain

    // Fade in (equal-power over the lead overlap, or a 3ms de-click when no lead).
    if (offset >= s.leadSec) {
      g.setValueAtTime(1, whenStart)
    } else if (s.leadSec > 0.0005) {
      if (offset > 0) {
        const x = offset / s.leadSec
        g.setValueAtTime(Math.sin((x * Math.PI) / 2), whenStart)
        g.linearRampToValueAtTime(1, inEndCtx)
      } else {
        g.setValueCurveAtTime(UP, inStartCtx, s.leadSec)
      }
    } else {
      g.setValueAtTime(0.0001, whenStart)
      g.linearRampToValueAtTime(1, Math.min(outEndCtx, whenStart + 0.003))
    }

    // Fade out (equal-power over the last XFADE — the overlap with the next
    // section's lead, giving a constant-power crossfade at the join).
    if (outStartCtx > whenStart + 0.0011) {
      g.setValueCurveAtTime(DOWN, outStartCtx, XFADE_SEC)
    } else {
      g.linearRampToValueAtTime(0.0001, outEndCtx)
    }

    const key = s.id + ':' + k
    src.onended = () => {
      const cur = this.live.get(key)
      if (cur && cur.src === src) this.live.delete(key)
      try { src.disconnect() } catch { /* noop */ }
      try { gain.disconnect() } catch { /* noop */ }
    }
    src.start(whenStart, offset)
    this.live.set(key, { src, gain })
  }
}

export type MediaShim = {
  currentTime: number
  play: () => Promise<void>
  pause: () => void
  readonly paused: boolean
}

/** Duck-typed HTMLMediaElement stand-in so the engine can drive/read the player. */
export function makeMediaShim(player: ProgressivePlayer): MediaShim {
  return {
    get currentTime() { return player.currentTime },
    set currentTime(v: number) { player.currentTime = v },
    play() { player.play(); return Promise.resolve() },
    pause() { player.pause() },
    get paused() { return !player.playing },
  }
}

export { XFADE_SEC }
