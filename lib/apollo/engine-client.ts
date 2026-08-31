'use client'
// Apollo main-thread engine controller: owns the AudioContext + worklet node,
// mirrors patch state into the engine, transfers tables/samples/spectral data,
// computes LFO/remap LUTs, and exposes note/transport/param APIs to the UI.

import { ApolloPatch, FxUnit, LfoPoint, PARAMS, FX_DEFS } from '@/lib/apollo/patch'
import { RENDER_SAMPLE_RATE } from '@/lib/render-rate'
import { buildTableMips, factoryTableWithMips, userTableWithMips, copyBuilt } from '@/lib/apollo/tables'
import { analyzeSpectralInWorker, SpectralAnalysis } from '@/lib/apollo/spectral'
import { ENGINE_VERSION } from '@/lib/apollo/engine-version'
import { samplesUsedBy } from '@/lib/apollo/samples-used'

export interface ApolloMeters {
  peak: number
  voices: number
  beat: number
  playing: boolean
  lfo: number[]
  lfoPhase: number[]
  env: number[]
  grain: number[]
  spec: number[]
  macros: number[]
  /** Envelope-follower level (0..1) — the 'follower' mod source's live value. */
  follower?: number
  /** Per-compressor gain reduction in dB (negative = reducing), keyed by unit id. */
  fxGr?: Record<string, number[]>
}

export interface LoadedSample {
  id: string
  name: string
  sr: number
  len: number
  l: Float32Array
  r: Float32Array | null
}

export function lfoLutFromPoints(points: LfoPoint[], size = 257): Float32Array {
  const lut = new Float32Array(size)
  const pts = points.length ? [...points].sort((a, b) => a.x - b.x) : [{ x: 0, y: 0, curve: 0 }, { x: 1, y: 1, curve: 0 }]
  if (pts[0].x > 0) pts.unshift({ x: 0, y: pts[0].y, curve: 0 })
  if (pts[pts.length - 1].x < 1) pts.push({ x: 1, y: pts[pts.length - 1].y, curve: 0 })
  let seg = 0
  for (let i = 0; i < size; i++) {
    const x = i / (size - 1)
    while (seg < pts.length - 2 && x > pts[seg + 1].x) seg++
    const p0 = pts[seg], p1 = pts[seg + 1]
    const span = p1.x - p0.x
    let t = span > 1e-6 ? (x - p0.x) / span : 1
    const c = p0.curve || 0
    if (c !== 0) {
      const k = Math.pow(4, Math.abs(c) * 2)
      t = c > 0 ? Math.pow(t, k) : 1 - Math.pow(1 - t, k)
    }
    lut[i] = p0.y + (p1.y - p0.y) * t
  }
  return lut
}

export function collectFxRanges(units: FxUnit[], out: Record<string, [number, number]>): void {
  for (const u of units) {
    const def = FX_DEFS[u.type]
    out[`fx.${u.id}.mix`] = [0, 1]
    if (def) for (const p of def.params) out[`fx.${u.id}.${p.key}`] = [p.min, p.max]
    if (u.chains) for (const c of u.chains) collectFxRanges(c, out)
  }
}

export class ApolloEngine extends EventTarget {
  /** True once the worklet has died. It never comes back by itself. */
  crashed = false

  /**
   * Exceptions the audio thread caught and recovered from.
   *
   * `count` is every one, not the five that get reported: the difference
   * between "it threw once on a stale patch" and "it is throwing 128 times a
   * second and the song is silent" is the whole diagnosis, and both look
   * identical from a console that stops after five.
   */
  readonly procErrors: { count: number; first: string; last: string; lastAt: number } =
    { count: 0, first: '', last: '', lastAt: 0 }

  ctx: AudioContext | null = null
  node: AudioWorkletNode | null = null
  analyser: AnalyserNode | null = null
  master: GainNode | null = null
  meters: ApolloMeters = { peak: 0, voices: 0, beat: 0, playing: false, lfo: Array(10).fill(0), lfoPhase: Array(10).fill(0), env: [0, 0, 0, 0], grain: [0, 0, 0], spec: [0, 0, 0], macros: Array(8).fill(0) }
  samples = new Map<string, LoadedSample>()
  private spectralCache = new Map<string, SpectralAnalysis>()
  private spectralSent = new Set<string>()
  private tablesSent = new Set<string>()
  private lastPatchJson = ''
  private pendingPv: Record<string, number> = {}
  private pvTimer: ReturnType<typeof setTimeout> | null = null
  ready = false

  private _flushId = 0

  /**
   * Wait until everything already posted has actually REACHED the processor.
   *
   * ⚠️ This is the fix for notes going missing from a render. `startRendering()`
   * does not wait for the port: the offline scheduler makes ONE pass, posts every
   * note event, and renders immediately — so whatever is still in flight when the
   * render starts is simply not played. It is intermittent by nature (measured at
   * roughly one render in eight), and the way it fails is the worst kind: the
   * render succeeds, reports no error, and is quietly missing notes. The symptom
   * that found it was a four-note chord whose level never built, because only the
   * first note ever sounded.
   *
   * Port messages are delivered IN ORDER, so a reply to a ping posted after the
   * notes proves the notes arrived. renderMany() already did this for the combine
   * path; the DAW's own offline render did not, which is why it was the one that
   * drifted.
   *
   * The timeout is a safety net rather than the mechanism — an engine too old to
   * answer, or a node that has died, falls back to the old behaviour instead of
   * hanging the render forever.
   */
  flush(timeoutMs = 4000): Promise<void> {
    const node = this.node
    if (!node || this.crashed) return Promise.resolve()
    const id = ++this._flushId
    return new Promise<void>(resolve => {
      const timer = setTimeout(() => { node.port.removeEventListener('message', onMsg); resolve() }, timeoutMs)
      const onMsg = (e: MessageEvent) => {
        const d = e.data as { type?: string; id?: number }
        if (d?.type === 'ready' && d.id === id) {
          clearTimeout(timer)
          node.port.removeEventListener('message', onMsg)
          resolve()
        }
      }
      node.port.addEventListener('message', onMsg)
      node.port.start()
      try { node.port.postMessage({ type: 'ping', id }) } catch { clearTimeout(timer); resolve() }
    })
  }

  /**
   * Standalone init creates its own AudioContext + master/analyser chain.
   * DAW-instrument mode passes an existing context + destination: the node
   * connects straight to the destination and no analyser is created.
   */
  async init(opts?: { ctx?: BaseAudioContext; destination?: AudioNode; fxInput?: boolean; analyse?: boolean }): Promise<void> {
    if (this.ready) return
    const external = !!opts?.ctx
    const ctx = (opts?.ctx as AudioContext) || new AudioContext({ latencyHint: 'interactive' })
    this.ctx = ctx
    await ctx.audioWorklet.addModule('/apollo/engine.js?v=' + ENGINE_VERSION)
    const node = new AudioWorkletNode(ctx, 'apollo-engine', {
      numberOfInputs: opts?.fxInput ? 2 : 0, numberOfOutputs: 1, outputChannelCount: [2],
    })
    // A worklet crash is otherwise SILENT (audio just stops) — surface it to
    // Sentry with the engine version so stale-cache pairings are diagnosable.
    //
    // ⚠️ Reporting is not recovering. A dead AudioWorkletNode never produces a
    // sample again, so anything routed THROUGH it is gone until the page is
    // reloaded — and in Beacon that is the whole mix, because the master glue
    // bus is one of these. Telling Sentry and leaving the user in silence is
    // the "it goes quiet and doesn't come back" report. The event lets the host
    // put the audio back on a path that still works.
    node.onprocessorerror = () => {
      this.crashed = true
      void import('@sentry/nextjs')
        .then(S => S.captureException(new Error(`Apollo engine processor crashed (v${ENGINE_VERSION})`)))
        .catch(() => {})
      try { this.dispatchEvent(new CustomEvent('processorError')) } catch { /* no listeners */ }
    }
    this.node = node
    if (external) {
      // Hosted in someone else's graph. `analyse` keeps the scope alive for a
      // host that shows Apollo's UI (Beacon's rack window); the per-track
      // instrument path leaves it off and connects straight through.
      if (opts?.analyse) {
        this.analyser = ctx.createAnalyser()
        this.analyser.fftSize = 2048
        node.connect(this.analyser)
        this.analyser.connect(opts?.destination || ctx.destination)
      } else {
        node.connect(opts?.destination || ctx.destination)
      }
    } else {
      this.master = ctx.createGain()
      this.analyser = ctx.createAnalyser()
      this.analyser.fftSize = 2048
      node.connect(this.master)
      this.master.connect(this.analyser)
      this.analyser.connect(ctx.destination)
    }
    node.port.onmessage = (e: MessageEvent) => {
      const m = e.data
      if (m.type === 'meters') {
        this.meters = m as ApolloMeters
        this.dispatchEvent(new CustomEvent('meters', { detail: m }))
      } else if (m.type === 'voiceOn' || m.type === 'voiceOff') {
        this.dispatchEvent(new CustomEvent(m.type, { detail: m }))
      } else if (m.type === 'fxModeAck') {
        this.dispatchEvent(new CustomEvent('fxModeAck'))
      } else if (m.type === 'procError') {
        // the engine caught an exception in process() and recovered (killed
        // voices, kept the processor alive) — surface it for diagnosis
        //
        // Kept on the engine as well as logged, because the console is not in
        // a bug report. An exception that recurs on EVERY block is heard as a
        // crackle and then silence that never comes back — the armour keeps the
        // processor alive but every block it produces is zeros — and until this
        // was recorded, a diagnose capture of exactly that said nothing at all
        // about it.
        this.procErrors.count++
        if (!this.procErrors.first) this.procErrors.first = String(m.message).slice(0, 400)
        this.procErrors.last = String(m.message).slice(0, 400)
        this.procErrors.lastAt = Date.now()
        console.warn('[apollo] engine recovered from a processing error:', m.message)
        void import('@sentry/nextjs')
          .then(S => S.captureException(new Error(`Apollo engine process() threw (v${ENGINE_VERSION}, #${m.count}): ${String(m.message).slice(0, 400)}`)))
          .catch(() => {})
      }
    }
    // static param range table (patch-level params)
    const ranges: Record<string, [number, number]> = {}
    for (const p of PARAMS) ranges[p.path] = [p.min, p.max]
    node.port.postMessage({ type: 'ranges', ranges })
    this.ready = true
  }

  resume(): void { void this.ctx?.resume() }

  /** Watchdog: the browser suspends/interrupts AudioContexts on its own
   * (device switches, focus loss on some platforms, bluetooth renegotiation)
   * — the "audio just cuts out" report. Auto-resume whenever the tab is
   * visible and the context leaves 'running'. */
  private watchdogWired = false
  wireResumeWatchdog(): void {
    if (this.watchdogWired || !this.ctx || typeof document === 'undefined') return
    this.watchdogWired = true
    const kick = () => {
      if (document.visibilityState === 'visible' && this.ctx && this.ctx.state !== 'running') void this.ctx.resume()
    }
    this.ctx.addEventListener('statechange', kick)
    document.addEventListener('visibilitychange', kick)
  }

  private post(msg: unknown, transfer?: Transferable[]): void {
    this.node?.port.postMessage(msg, transfer || [])
  }

  sendPatch(patch: ApolloPatch): void {
    if (!this.node) return
    // ranges: static params + per-fx-unit params
    const ranges: Record<string, [number, number]> = {}
    for (const p of PARAMS) ranges[p.path] = [p.min, p.max]
    collectFxRanges(patch.fxMain, ranges)
    collectFxRanges(patch.fxBus1, ranges)
    collectFxRanges(patch.fxBus2, ranges)
    this.post({ type: 'ranges', ranges })
    // ensure tables + samples + LUTs the patch references are in the engine
    patch.oscs.forEach((osc, i) => {
      this.ensureTable(osc.wt.tableId, patch)
      if (osc.wt.remapCurve?.length) this.post({ type: 'remapLut', key: `osc${i}`, lut: lfoLutFromPoints(osc.wt.remapCurve) })
    })
    patch.lfos.forEach((lfo, i) => this.sendLfoLut(i, lfo.points, lfo.mode === 'path' ? lfo.pathPoints : null))
    for (const row of patch.matrix) {
      if (row.curve && row.curve.length) this.post({ type: 'remapLut', rowId: row.id, lut: lfoLutFromPoints(row.curve) })
    }
    this.post({ type: 'patch', patch })
    this.pendingPv = {}
    this.lastPatchJson = ''
  }

  ensureTable(tableId: string, patch?: ApolloPatch): void {
    if (this.tablesSent.has(tableId)) return
    // Built once per page and shared across engines — see tables.ts. Every synth
    // track owns an engine, and they all send their patch on the same tick when
    // playback starts, so this used to be N identical FFT builds in a row.
    const user = patch?.userTables?.[tableId]
    const built = user ? userTableWithMips(user.data, user.frames) : factoryTableWithMips(tableId)
    if (!built) return
    this.tablesSent.add(tableId)
    const { frames, data, mips } = copyBuilt(built)   // postMessage transfers these
    this.post({ type: 'table', id: tableId, frames, data, mips }, [data.buffer, mips.buffer])
  }

  sendTable(tableId: string, frames: number, data: Float32Array): void {
    this.tablesSent.add(tableId)
    const copy = new Float32Array(data)
    const mips = buildTableMips(data, frames)
    this.post({ type: 'table', id: tableId, frames, data: copy, mips }, [copy.buffer, mips.buffer])
  }

  // continuous knob changes: engine-side override until next full patch send
  setParam(path: string, value: number): void {
    this.pendingPv[path] = value
    if (!this.pvTimer) {
      this.pvTimer = setTimeout(() => {
        this.pvTimer = null
        const values = this.pendingPv
        this.pendingPv = {}
        this.post({ type: 'pv', values })
      }, 12)
    }
  }

  loadSample(id: string, name: string, buffer: AudioBuffer): LoadedSample {
    const l = new Float32Array(buffer.getChannelData(0))
    const r = buffer.numberOfChannels > 1 ? new Float32Array(buffer.getChannelData(1)) : null
    const smp: LoadedSample = { id, name, sr: buffer.sampleRate, len: buffer.length, l, r }
    this.samples.set(id, smp)
    const tl = new Float32Array(l)
    const tr = r ? new Float32Array(r) : null
    this.post(
      { type: 'sample', id, sr: smp.sr, len: smp.len, l: tl, r: tr },
      tr ? [tl.buffer, tr.buffer] : [tl.buffer],
    )
    this.spectralSent.delete(id)
    this.spectralCache.delete(id)
    return smp
  }

  async ensureSpectral(id: string, onProgress?: (p: number) => void): Promise<boolean> {
    if (this.spectralSent.has(id)) return true
    const smp = this.samples.get(id)
    if (!smp) return false
    let analysis = this.spectralCache.get(id)
    if (!analysis) {
      const mono = smp.r ? new Float32Array(smp.len) : smp.l
      if (smp.r) for (let i = 0; i < smp.len; i++) mono[i] = (smp.l[i] + smp.r[i]) * 0.5
      analysis = await analyzeSpectralInWorker(mono, smp.sr, onProgress)
      this.spectralCache.set(id, analysis)
    }
    const mags = new Float32Array(analysis.mags)
    const phases = new Float32Array(analysis.phases)
    const onsets = new Uint8Array(analysis.onsets)
    this.post(
      { type: 'spectral', id, frames: analysis.frames, bins: analysis.bins, hop: analysis.hop, sr: analysis.sr, mags, phases, onsets },
      [mags.buffer, phases.buffer, onsets.buffer],
    )
    this.spectralSent.add(id)
    return true
  }

  getSpectral(id: string): SpectralAnalysis | null { return this.spectralCache.get(id) || null }

  /** Inject a precomputed spectral analysis (restored image-import spectra). */
  loadSpectralData(id: string, an: SpectralAnalysis): void {
    this.spectralCache.set(id, an)
    this.post(
      { type: 'spectral', id, frames: an.frames, bins: an.bins, hop: an.hop, sr: an.sr, mags: new Float32Array(an.mags), phases: new Float32Array(an.phases), onsets: new Uint8Array(an.onsets) },
      [],
    )
    this.spectralSent.add(id)
  }

  // Image import: luminance becomes spectral magnitude.
  // x axis = time frames, y axis = log-spaced frequency (top = high).
  loadImageSpectral(id: string, img: HTMLImageElement): boolean {
    const W = Math.min(600, Math.max(16, img.naturalWidth))
    const H = 256
    const cv = document.createElement('canvas')
    cv.width = W; cv.height = H
    const g = cv.getContext('2d')
    if (!g) return false
    g.drawImage(img, 0, 0, W, H)
    const px = g.getImageData(0, 0, W, H).data
    const bins = 1025
    const frames = W
    const mags = new Float32Array(frames * bins)
    const sr = this.ctx?.sampleRate || 48000
    for (let f = 0; f < frames; f++) {
      for (let y = 0; y < H; y++) {
        const i4 = (y * W + f) * 4
        const lum = (px[i4] * 0.299 + px[i4 + 1] * 0.587 + px[i4 + 2] * 0.114) / 255
        if (lum < 0.03) continue
        // top row = highest frequency, log spacing
        const bin = Math.max(1, Math.round(Math.pow((H - 1 - y) / (H - 1), 2.2) * (bins - 2)) + 1)
        const m = lum * lum * 40
        if (m > mags[f * bins + bin]) mags[f * bins + bin] = m
      }
    }
    const phases = new Float32Array(frames * bins)
    const onsets = new Uint8Array(frames)
    onsets[0] = 1
    const analysis: SpectralAnalysis = { frames, bins, hop: 512, sr, mags, phases, onsets }
    this.spectralCache.set(id, analysis)
    this.post(
      { type: 'spectral', id, frames, bins, hop: 512, sr, mags: new Float32Array(mags), phases: new Float32Array(phases), onsets: new Uint8Array(onsets) },
      [],
    )
    this.spectralSent.add(id)
    return true
  }

  sendLfoLut(index: number, points: LfoPoint[], pathPoints: { x: number; y: number; curve: number }[] | null): void {
    const main = lfoLutFromPoints(points)
    let y: Float32Array | null = null
    if (pathPoints && pathPoints.length) {
      // path mode: main = X coordinate over time, y = Y coordinate over time
      y = lfoLutFromPoints(pathPoints.map(p => ({ x: p.x, y: p.y, curve: p.curve })))
    }
    this.post({ type: 'lfoLut', index, main, y })
  }

  sendRemapLut(rowId: string, curve: LfoPoint[]): void {
    this.post({ type: 'remapLut', rowId, lut: lfoLutFromPoints(curve) })
  }

  sendOscRemapLut(oscKey: string, curve: LfoPoint[]): void {
    this.post({ type: 'remapLut', key: oscKey, lut: lfoLutFromPoints(curve) })
  }

  noteOn(note: number, vel = 0.9): void { this.resume(); this.post({ type: 'noteOn', note, vel }) }
  noteOff(note: number): void { this.post({ type: 'noteOff', note }) }
  panic(): void { this.post({ type: 'panic' }) }
  allOff(): void { this.post({ type: 'allOff' }) }
  sustain(on: boolean): void { this.post({ type: 'sustain', on }) }
  setMacro(index: number, value: number): void { this.post({ type: 'macro', index, value }) }
  setWheel(pitch: number | null, mod: number | null): void { this.post({ type: 'wheel', pitch, mod }) }
  setAftertouch(value: number): void { this.post({ type: 'aftertouch', value }) }
  setTransport(opts: { playing?: boolean; bpm?: number; click?: boolean; beat?: number }): void {
    this.post({ type: 'transport', ...opts })
  }

  /** Absolute-context-time note events (DAW instrument mode). */
  scheduleEvents(events: { t: number; type: 'noteOn' | 'noteOff'; note: number; vel?: number }[]): void {
    this.post({ type: 'scheduleAt', events })
  }

  clearScheduled(): void { this.post({ type: 'clearScheduled' }) }

  dispose(): void {
    this.node?.disconnect()
    void this.ctx?.close()
    this.ctx = null; this.node = null; this.ready = false
    this.tablesSent.clear(); this.spectralSent.clear()
  }

  // Offline render: replay full state into an OfflineAudioContext instance of
  // the engine and schedule notes sample-accurately.
  async renderToBuffer(
    patch: ApolloPatch,
    notes: { t: number; dur: number; note: number; vel: number }[],
    seconds: number,
  ): Promise<AudioBuffer> {
    // ⚠️ NOT `this.ctx.sampleRate`. Rendering at the device's rate is what made
    // the same song sound different on a 44.1 kHz machine and a 48 kHz one —
    // and freezeStamp never mentioned the rate, so the two shared a cache key.
    // A render is a durable artifact: it gets cached, shared between users and
    // served from the backend, so it cannot depend on whatever the listener's
    // sound card happens to be running at.
    const sr = RENDER_SAMPLE_RATE
    const octx = new OfflineAudioContext(2, Math.ceil(seconds * sr), sr)
    await octx.audioWorklet.addModule('/apollo/engine.js?v=' + ENGINE_VERSION)
    const node = new AudioWorkletNode(octx, 'apollo-engine', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] })
    node.connect(octx.destination)
    const post = (msg: unknown) => node.port.postMessage(msg)
    const ranges: Record<string, [number, number]> = {}
    for (const p of PARAMS) ranges[p.path] = [p.min, p.max]
    collectFxRanges(patch.fxMain, ranges)
    collectFxRanges(patch.fxBus1, ranges)
    collectFxRanges(patch.fxBus2, ranges)
    post({ type: 'ranges', ranges })
    // tables
    const tableIds = new Set(patch.oscs.map(o => o.wt.tableId))
    for (const id of tableIds) {
      const user = patch.userTables?.[id]
      const built = user ? userTableWithMips(user.data, user.frames) : factoryTableWithMips(id)
      if (built) post({ type: 'table', id, ...copyBuilt(built) })
    }
    // samples + spectral — only the ones THIS patch plays.
    //
    // The sibling path (renderManyToBuffer) was fixed for this and this one was
    // missed, which is the worse half: it copied every sample loaded in the
    // engine into the render, so the cost scaled with the size of the user's
    // library rather than with the clip being rendered. One multisampled piano
    // is dozens of buffers, and none of them are audible in a render of a bass
    // line.
    for (const id of samplesUsedBy(patch)) {
      const smp = this.samples.get(id)
      if (!smp) continue
      post({ type: 'sample', id, sr: smp.sr, len: smp.len, l: new Float32Array(smp.l), r: smp.r ? new Float32Array(smp.r) : null })
      const an = this.spectralCache.get(id)
      if (an) post({ type: 'spectral', id, frames: an.frames, bins: an.bins, hop: an.hop, sr: an.sr, mags: new Float32Array(an.mags), phases: new Float32Array(an.phases), onsets: new Uint8Array(an.onsets) })
    }
    patch.lfos.forEach((lfo, i) => {
      post({ type: 'lfoLut', index: i, main: lfoLutFromPoints(lfo.points), y: lfo.mode === 'path' ? lfoLutFromPoints(lfo.pathPoints) : null })
    })
    for (const row of patch.matrix) if (row.curve?.length) post({ type: 'remapLut', rowId: row.id, lut: lfoLutFromPoints(row.curve) })
    post({ type: 'patch', patch })
    const events: { t: number; type: string; note: number; vel?: number }[] = []
    for (const n of notes) {
      events.push({ t: n.t, type: 'noteOn', note: n.note, vel: n.vel })
      events.push({ t: n.t + n.dur, type: 'noteOff', note: n.note })
    }
    post({ type: 'schedule', events })
    if (patch.clipMode || patch.arp.on) post({ type: 'transport', playing: true, bpm: patch.global.bpm })
    return octx.startRendering()
  }

  /**
   * Render SEVERAL patches at once, each to its own stereo pair, in ONE
   * OfflineAudioContext.
   *
   * A browser only allows a couple of audio contexts to exist at a time, and
   * renderToBuffer builds one per call: back to back, the first one or two
   * produce audio and the rest come back silent — which looks like a broken
   * patch and is really a resource ceiling. (Measured on a seven-track project:
   * exactly two tracks rendered, whichever two got there first, no matter how
   * far apart the calls were spaced.)
   *
   * So: one context, one worklet node per patch, and a merger that keeps each
   * patch on its own channel pair so they can be pulled apart afterwards
   * instead of arriving pre-mixed.
   */
  /**
   * Render every patch in ONE offline context and hand back the merged result.
   * Item `i` occupies channels `i*2` (left) and `i*2+1` (right) — see the note
   * at the return for why this is not split into per-item buffers.
   */
  async renderManyToBuffer(
    items: { patch: ApolloPatch; notes: { t: number; dur: number; note: number; vel: number }[] }[],
    seconds: number,
  ): Promise<AudioBuffer | null> {
    if (!items.length) return null
    const sr = this.ctx?.sampleRate || 48000
    const frames = Math.ceil(seconds * sr)
    const octx = new OfflineAudioContext(items.length * 2, frames, sr)
    await octx.audioWorklet.addModule('/apollo/engine.js?v=' + ENGINE_VERSION)
    const merger = octx.createChannelMerger(items.length * 2)
    merger.connect(octx.destination)

    const nodes: AudioWorkletNode[] = []
    items.forEach(({ patch, notes }, idx) => {
      const node = new AudioWorkletNode(octx, 'apollo-engine',
        { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] })
      nodes.push(node)
      const splitter = octx.createChannelSplitter(2)
      node.connect(splitter)
      splitter.connect(merger, 0, idx * 2)
      splitter.connect(merger, 1, idx * 2 + 1)
      const post = (msg: unknown) => node.port.postMessage(msg)

      const ranges: Record<string, [number, number]> = {}
      for (const p of PARAMS) ranges[p.path] = [p.min, p.max]
      collectFxRanges(patch.fxMain, ranges)
      collectFxRanges(patch.fxBus1, ranges)
      collectFxRanges(patch.fxBus2, ranges)
      post({ type: 'ranges', ranges })

      for (const id of new Set(patch.oscs.map(o => o.wt.tableId))) {
        const user = patch.userTables?.[id]
        const built = user ? userTableWithMips(user.data, user.frames) : factoryTableWithMips(id)
        if (built) post({ type: 'table', id, ...copyBuilt(built) })
      }
      // ── Only the samples THIS patch plays ─────────────────────────────
      //
      // This used to send every sample the engine had loaded, to every node, on
      // every render — and each is a full Float32Array copy of the audio. The
      // cost scaled with the user's LIBRARY rather than with the song: harmless
      // when a patch meant one drum hit, ruinous once multisampled instruments
      // arrived, because one piano is 42 buffers and a two-clip render copied
      // all of them twice.
      //
      // That is the shape of the report it came from — "two tracks without any
      // effects takes a LONG time", "it loaded perfectly fine before we
      // implemented Apollo" — because the work was never about those two tracks.
      for (const id of samplesUsedBy(patch)) {
        const smp = this.samples.get(id)
        if (!smp) continue
        post({ type: 'sample', id, sr: smp.sr, len: smp.len, l: new Float32Array(smp.l), r: smp.r ? new Float32Array(smp.r) : null })
        const an = this.spectralCache.get(id)
        if (an) post({ type: 'spectral', id, frames: an.frames, bins: an.bins, hop: an.hop, sr: an.sr, mags: new Float32Array(an.mags), phases: new Float32Array(an.phases), onsets: new Uint8Array(an.onsets) })
      }
      patch.lfos.forEach((lfo, i) => {
        post({ type: 'lfoLut', index: i, main: lfoLutFromPoints(lfo.points), y: lfo.mode === 'path' ? lfoLutFromPoints(lfo.pathPoints) : null })
      })
      for (const row of patch.matrix) if (row.curve?.length) post({ type: 'remapLut', rowId: row.id, lut: lfoLutFromPoints(row.curve) })
      post({ type: 'patch', patch })

      const events: { t: number; type: string; note: number; vel?: number }[] = []
      for (const n of notes) {
        events.push({ t: n.t, type: 'noteOn', note: n.note, vel: n.vel })
        events.push({ t: n.t + n.dur, type: 'noteOff', note: n.note })
      }
      post({ type: 'schedule', events })
      if (patch.clipMode || patch.arp.on) post({ type: 'transport', playing: true, bpm: patch.global.bpm })
    })

    // Wait until every node says it has everything before rendering a sample.
    //
    // This is the fix for silent renders, and it turns out they were never about
    // "running out of offline contexts" at all. startRendering() does not wait
    // for the port: setup goes over an ASYNCHRONOUS MessagePort, and rendering
    // can begin before a processor has been told which patch to play or which
    // notes to play — so it renders exactly what it knows, which is nothing.
    //
    // The evidence: Iced's Pad failed in the seven-track render but combined
    // perfectly (4 of 4) as the only track in the project. It is the LAST node
    // set up, so it is the one whose messages are most likely to still be in
    // flight. Inserting a blunt 250ms delay before rendering fixed the Pad — and
    // moved the failure to the four clips of the OPENING batch, the first render
    // on the page, where setup is slowest. A delay just relocates the race.
    //
    // Messages are delivered in order, so a reply to a ping posted after the
    // patch and the schedule proves both arrived. The timeout is a safety net,
    // not the mechanism: an engine too old to answer (or a node that dies) falls
    // back to the previous behaviour rather than hanging the combine forever.
    await Promise.all(nodes.map((node, idx) => new Promise<void>(resolve => {
      const timer = setTimeout(resolve, 4000)
      const onMsg = (e: MessageEvent) => {
        const d = e.data as { type?: string; id?: number }
        if (d?.type === 'ready' && d.id === idx) {
          clearTimeout(timer)
          node.port.removeEventListener('message', onMsg)
          resolve()
        }
      }
      node.port.addEventListener('message', onMsg)
      node.port.start()
      node.port.postMessage({ type: 'ping', id: idx })
    })))

    // The merged render goes back as-is: item N is on channels N*2 and N*2+1.
    //
    // This used to de-interleave into one AudioBuffer per item, which meant
    // copying the whole song for every track — and the only consumer then copied
    // it AGAIN, clip by clip, to cut its slices. Two full passes over every
    // sample when one will do. Profiled on Iced, the de-interleave alone was
    // 339ms and the largest long task in the combine phase; the copy the caller
    // actually needs is the second one, so this one just goes away, along with
    // seven full-length buffer allocations per pass.
    return octx.startRendering()
  }
}

// Hung off globalThis, not a module-scoped variable. ApolloCard is loaded
// through next/dynamic, so this module exists in both the main bundle and that
// chunk — a module-scoped singleton gives each copy its OWN engine, and the
// second one quietly builds a second AudioContext and worklet. Beacon then
// sends transport to an engine nobody is listening to while the card plays on
// the other. One key on globalThis is what actually makes it one engine.
const ENGINE_KEY = '__apolloEngineSingleton'
type EngineHost = typeof globalThis & { [ENGINE_KEY]?: ApolloEngine }
export function getApolloEngine(): ApolloEngine {
  const host = globalThis as EngineHost
  if (!host[ENGINE_KEY]) host[ENGINE_KEY] = new ApolloEngine()
  return host[ENGINE_KEY]
}
