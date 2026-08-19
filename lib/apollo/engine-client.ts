'use client'
// Apollo main-thread engine controller: owns the AudioContext + worklet node,
// mirrors patch state into the engine, transfers tables/samples/spectral data,
// computes LFO/remap LUTs, and exposes note/transport/param APIs to the UI.

import { ApolloPatch, FxUnit, LfoPoint, PARAMS, FX_DEFS } from '@/lib/apollo/patch'
import { generateFactoryTable, tableFromBase64, buildTableMips } from '@/lib/apollo/tables'
import { analyzeSpectralInWorker, SpectralAnalysis } from '@/lib/apollo/spectral'
import { ENGINE_VERSION } from '@/lib/apollo/engine-version'

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

  /**
   * Standalone init creates its own AudioContext + master/analyser chain.
   * DAW-instrument mode passes an existing context + destination: the node
   * connects straight to the destination and no analyser is created.
   */
  async init(opts?: { ctx?: BaseAudioContext; destination?: AudioNode }): Promise<void> {
    if (this.ready) return
    const external = !!opts?.ctx
    const ctx = (opts?.ctx as AudioContext) || new AudioContext({ latencyHint: 'interactive' })
    this.ctx = ctx
    await ctx.audioWorklet.addModule('/apollo/engine.js?v=' + ENGINE_VERSION)
    const node = new AudioWorkletNode(ctx, 'apollo-engine', {
      numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
    })
    // A worklet crash is otherwise SILENT (audio just stops) — surface it to
    // Sentry with the engine version so stale-cache pairings are diagnosable.
    node.onprocessorerror = () => {
      void import('@sentry/nextjs')
        .then(S => S.captureException(new Error(`Apollo engine processor crashed (v${ENGINE_VERSION})`)))
        .catch(() => {})
    }
    this.node = node
    if (external) {
      node.connect(opts?.destination || ctx.destination)
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
      } else if (m.type === 'procError') {
        // the engine caught an exception in process() and recovered (killed
        // voices, kept the processor alive) — surface it for diagnosis
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
    let frames = 0
    let data: Float32Array | null = null
    const user = patch?.userTables?.[tableId]
    if (user) {
      data = tableFromBase64(user.data)
      frames = user.frames
    } else {
      const t = generateFactoryTable(tableId)
      if (t) { data = t.data; frames = t.frames }
    }
    if (!data) return
    this.tablesSent.add(tableId)
    const copy = new Float32Array(data) // keep original for UI drawing
    const mips = buildTableMips(data, frames)
    this.post({ type: 'table', id: tableId, frames, data: copy, mips }, [copy.buffer, mips.buffer])
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
    const sr = this.ctx?.sampleRate || 48000
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
      if (user) {
        const d = tableFromBase64(user.data)
        post({ type: 'table', id, frames: user.frames, data: d, mips: buildTableMips(d, user.frames) })
      } else {
        const t = generateFactoryTable(id)
        if (t) post({ type: 'table', id, frames: t.frames, data: t.data, mips: buildTableMips(t.data, t.frames) })
      }
    }
    // samples + spectral
    for (const [id, smp] of this.samples) {
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
}

let singleton: ApolloEngine | null = null
export function getApolloEngine(): ApolloEngine {
  if (!singleton) singleton = new ApolloEngine()
  return singleton
}
