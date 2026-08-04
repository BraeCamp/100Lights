// ── Browser session recorder (Phase B) ───────────────────────────────────────
// The client half of the capture layer. It collects the event log + ROI track
// live, drives lib/screen-recorder for the video, takes an optional audio bounce
// + stems from the caller, and on completion POSTs everything to /api/session,
// which owns the atomic filesystem write (the browser can't write the FS itself).
//
// It shares NOTHING with the Node recorder's server-only code (no fs/ajv): the
// server assembles + validates + stamps the manifest. This module just gathers.
//
//   const s = new BrowserSessionRecorder({ sessionId })
//   await s.startCapture({ masterNode, audioContext })   // asks for screen share
//   s.setMusical(...).setGeneration(...).autoTrackPanels()
//   s.event('take_started', { seed })
//   s.event('take_rejected', { reason: '…', changed: '…' })   // reason REQUIRED
//   s.attachAudio(wavBlob, { sampleRate, durationS, stems })
//   const dir = await s.end('completed')   // → server writes sessions/<name>/

import { ScreenRecorder, type RecorderSources } from '../screen-recorder'

export interface CaptureInfo { path?: string; fps: number; width: number; height: number; started_at: string }
export interface MusicalInfo { bpm: number | null; key: string | null; time_signature: string | null; genre_tags: string[]; instrument_list: string[] }
export interface GenerationInfo { model: string; prompt_or_seed: unknown; total_takes: number; rejected_takes: number }
export interface AudioInfo { path?: string; sample_rate: number | null; duration_s: number | null; stems: string[] }
export interface Stem { name: string; blob: Blob }
export interface SessionEvent { t: number; type: string; payload: Record<string, unknown> }
export interface RoiEntry { t: number; x: number; y: number; w: number; h: number; panel: string }
export type Outcome = 'completed' | 'aborted' | 'failed'

export interface BrowserSessionOptions {
  endpoint?: string   // default '/api/session'
  sessionId?: string
  enabled?: boolean   // default true
}

const now = () => Date.now()

export class BrowserSessionRecorder {
  readonly enabled: boolean
  readonly sessionId: string
  private endpoint: string
  private t0 = now()
  private startedAt = new Date(this.t0).toISOString()
  private events: SessionEvent[] = []
  private roi: RoiEntry[] = []
  private musical: MusicalInfo | null = null
  private generation: GenerationInfo | null = null
  private audio: AudioInfo | null = null
  private capture: CaptureInfo | null = null
  private wavBlob: Blob | null = null
  private stems: Stem[] = []
  private rec: ScreenRecorder | null = null
  private viewport = { width: 0, height: 0 }
  private lastPanel = ''
  private detachTracker: (() => void) | null = null
  private ended = false
  /** Set if the user ends the share from the browser's own bar. */
  externalStop = false

  constructor(opts: BrowserSessionOptions = {}) {
    this.enabled = opts.enabled ?? true
    this.endpoint = opts.endpoint ?? '/api/session'
    this.sessionId = opts.sessionId ?? (globalThis.crypto?.randomUUID?.() ?? `s-${this.t0}`)
  }

  private t() { return +((now() - this.t0) / 1000).toFixed(3) }

  /** Start screen capture (asks for a share). Rebases the clock to the video
   *  start so event `t` aligns to frames. No-op if disabled. */
  async startCapture(sources: RecorderSources = {}): Promise<this> {
    if (!this.enabled) return this
    this.rec = new ScreenRecorder()
    this.rec.onExternalStop = () => { this.externalStop = true }
    await this.rec.start(sources)
    const d = this.rec.dimensions
    if (this.events.length === 0 && this.rec.startedAtMs) { this.t0 = this.rec.startedAtMs; this.startedAt = new Date(this.t0).toISOString() }
    this.viewport = { width: window.innerWidth, height: window.innerHeight }
    this.capture = { fps: d?.fps ?? 30, width: d?.width ?? 0, height: d?.height ?? 0, started_at: this.startedAt }
    return this
  }

  event(type: string, payload: Record<string, unknown> = {}): this {
    if (!this.enabled) return this
    this.events.push({ t: this.t(), type, payload })
    return this
  }

  /** Record an ROI in capture-pixel coords directly. */
  roiRect(rect: { x: number; y: number; w: number; h: number; panel: string }): this {
    if (!this.enabled) return this
    this.roi.push({ t: this.t(), ...rect })
    return this
  }

  /** Record the active panel's rect, mapping CSS px → capture px. De-duplicated:
   *  only emits when the active panel actually changes. */
  trackPanel(el: Element, panel: string): this {
    if (!this.enabled || panel === this.lastPanel) return this
    this.lastPanel = panel
    const r = el.getBoundingClientRect()
    const vw = this.viewport.width || window.innerWidth
    const vh = this.viewport.height || window.innerHeight
    const sx = this.capture?.width ? this.capture.width / vw : 1
    const sy = this.capture?.height ? this.capture.height / vh : 1
    this.roi.push({ t: this.t(), x: Math.round(r.x * sx), y: Math.round(r.y * sy), w: Math.round(r.width * sx), h: Math.round(r.height * sy), panel })
    return this
  }

  /** Auto-emit ROIs from focus/pointer on any `[data-session-panel]` element. */
  autoTrackPanels(root: HTMLElement = document.body): this {
    if (!this.enabled) return this
    const handler = (ev: Event) => {
      const el = (ev.target as HTMLElement)?.closest?.('[data-session-panel]')
      if (el) this.trackPanel(el, el.getAttribute('data-session-panel') || 'panel')
    }
    root.addEventListener('focusin', handler, true)
    root.addEventListener('pointerdown', handler, true)
    this.detachTracker = () => {
      root.removeEventListener('focusin', handler, true)
      root.removeEventListener('pointerdown', handler, true)
    }
    return this
  }

  setMusical(m: MusicalInfo): this { this.musical = m; return this }
  setGeneration(g: GenerationInfo): this { this.generation = g; return this }

  /** Provide the rendered master (and optional stems) for this run. */
  attachAudio(wav: Blob, meta: { sampleRate?: number; durationS?: number; stems?: Stem[] } = {}): this {
    if (!this.enabled) return this
    this.wavBlob = wav
    this.stems = meta.stems ?? []
    this.audio = {
      path: 'final_mix.wav',
      sample_rate: meta.sampleRate ?? null,
      duration_s: meta.durationS ?? null,
      stems: this.stems.map(s => `stems/${s.name}`),
    }
    return this
  }

  /** Stop capture, bundle everything, POST to the server. Returns the written
   *  directory path (or null if disabled). Throws if the server rejects. */
  async end(outcome: Outcome = 'completed'): Promise<string | null> {
    if (!this.enabled || this.ended) return null
    this.ended = true
    this.detachTracker?.()

    let videoExt = 'webm'
    let videoBlob: Blob | null = null
    if (this.rec) {
      const res = await this.rec.stop()
      if (res) {
        videoBlob = res.blob
        videoExt = res.mimeType.includes('mp4') ? 'mp4' : 'webm'
        if (this.capture) this.capture.path = `capture.${videoExt}`
      }
    }

    const header = {
      session_id: this.sessionId,
      started_at: this.startedAt,
      capture: this.capture,
      audio: this.audio,
      musical: this.musical,
      generation: this.generation,
      roi_fallback: this.capture
        ? { x: 0, y: 0, w: this.capture.width, h: this.capture.height, panel: 'full' }
        : { x: 0, y: 0, w: 0, h: 0, panel: 'full' },
      outcome,
      duration_s: this.t(),
    }

    const form = new FormData()
    form.append('meta', JSON.stringify({ sessionId: this.sessionId, header, events: this.events, roi: this.roi }))
    if (videoBlob) form.append('capture', videoBlob, `capture.${videoExt}`)
    if (this.wavBlob) form.append('audio', this.wavBlob, 'final_mix.wav')
    for (const s of this.stems) form.append('stems', s.blob, s.name)

    const res = await fetch(this.endpoint, { method: 'POST', body: form })
    if (!res.ok) throw new Error(`session ingest failed: ${res.status}`)
    const json = await res.json().catch(() => ({}))
    return json.dir ?? null
  }

  abort(reason?: string): Promise<string | null> {
    if (reason) this.event('error', { reason: String(reason), aborted: true })
    return this.end('aborted')
  }
  fail(err?: unknown): Promise<string | null> {
    if (err) this.event('error', { reason: (err as Error)?.message ?? String(err) })
    return this.end('failed')
  }
}
