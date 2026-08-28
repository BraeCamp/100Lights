'use client'
// ============================================================================
//  Talking to the Beacon Bridge — the native process that hosts real Audio
//  Unit and VST3 plug-ins.
//
//  Beacon connects to it over a WebSocket on loopback. Web plugins do not need
//  any of this; a bridge plugin is the same thing to the rest of the DAW, but
//  its audio is rendered in another process and streamed in.
//
//  Latency is the honest cost. The bridge cannot reach the audio thread, so
//  the main thread pulls rendered blocks and a worklet plays them out of a ring
//  buffer. `getLatencyMs()` reports that so the UI can show it rather than
//  pretend it is not there.
// ============================================================================

import { mergeBridgePlugins, clearBridgePlugins } from './registry'
import type { PluginDescriptor } from './types'

const DEFAULT_PORT = 8788
const PLAYER_MODULE = '/plugins/_bridge/bridge-player.js'

export type BridgeStatus = 'offline' | 'connecting' | 'connected' | 'scanning' | 'refused'

export interface BridgeNativePlugin {
  id: string
  name: string
  vendor: string
  version: string
  format: 'AudioUnit' | 'VST3'
  category: string
  isInstrument: boolean
  path: string
}

interface Pending {
  resolve: (value: Record<string, unknown>) => void
  reject: (err: Error) => void
  op: string
}

// ---------------------------------------------------------------------------

class BridgeClient {
  private socket: WebSocket | null = null
  private status: BridgeStatus = 'offline'
  private listeners = new Set<() => void>()
  private pending: Pending[] = []
  private binaryWaiters: Array<(data: ArrayBuffer) => void> = []
  private plugins: BridgeNativePlugin[] = []
  private scanProgress = { done: 0, total: 100, current: '' }
  private connectPromise: Promise<boolean> | null = null

  // ------------------------------------------------------------- status --

  getStatus(): BridgeStatus { return this.status }
  getPlugins(): BridgeNativePlugin[] { return this.plugins }
  getScanProgress() { return this.scanProgress }
  isConnected(): boolean { return this.status === 'connected' || this.status === 'scanning' }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private notify() {
    for (const fn of this.listeners) {
      try { fn() } catch { /* a broken listener must not break the client */ }
    }
  }

  private setStatus(next: BridgeStatus) {
    if (this.status === next) return
    this.status = next
    this.notify()
  }

  // -------------------------------------------------------- connection --

  /** Try to reach the bridge. Resolves false when it simply is not running,
      which is the normal case for a browser user who never installed it. */
  async connect(port = DEFAULT_PORT): Promise<boolean> {
    if (this.isConnected()) return true
    if (this.connectPromise) return this.connectPromise

    this.connectPromise = new Promise<boolean>(resolve => {
      this.setStatus('connecting')

      let socket: WebSocket
      try {
        socket = new WebSocket(`ws://127.0.0.1:${port}/`)
      } catch {
        this.setStatus('offline')
        resolve(false)
        return
      }

      socket.binaryType = 'arraybuffer'

      // Not running is much more common than running, so fail fast and quietly.
      const timer = setTimeout(() => {
        try { socket.close() } catch { /* already gone */ }
        this.setStatus('offline')
        resolve(false)
      }, 1200)

      socket.onopen = () => {
        clearTimeout(timer)
        this.socket = socket
        this.send({ op: 'hello' })
      }

      socket.onmessage = (event: MessageEvent) => {
        if (typeof event.data !== 'string') {
          const waiter = this.binaryWaiters.shift()
          if (waiter) waiter(event.data as ArrayBuffer)
          return
        }

        let msg: Record<string, unknown>
        try { msg = JSON.parse(event.data) as Record<string, unknown> } catch { return }

        if (msg.op === 'welcome') {
          this.setStatus('connected')
          resolve(true)
          void this.refreshPlugins()
          return
        }

        if (msg.op === 'scanning') {
          this.scanProgress = {
            done: Number(msg.done ?? 0),
            total: Number(msg.total ?? 100),
            current: String(msg.current ?? ''),
          }
          this.setStatus('scanning')
          this.notify()
          return
        }

        if (msg.op === 'plugins') {
          this.plugins = (msg.items as BridgeNativePlugin[]) ?? []
          this.publishToRegistry()
          this.setStatus('connected')
          return
        }

        // Everything else answers a request, oldest first.
        const p = this.pending.shift()
        if (!p) return
        if (msg.op === 'error') p.reject(new Error(String(msg.message ?? 'The bridge refused that.')))
        else p.resolve(msg)
      }

      socket.onerror = () => {
        clearTimeout(timer)
        // A refused connection and a blocked one look the same from here; the
        // bridge simply is not available either way.
        this.setStatus('offline')
        resolve(false)
      }

      socket.onclose = () => {
        clearTimeout(timer)
        this.socket = null
        this.plugins = []
        clearBridgePlugins()
        this.setStatus('offline')
        for (const p of this.pending) p.reject(new Error('The bridge disconnected.'))
        this.pending = []
        this.binaryWaiters = []
        resolve(false)
      }
    }).finally(() => { this.connectPromise = null })

    return this.connectPromise
  }

  disconnect() {
    try { this.socket?.close() } catch { /* already gone */ }
    this.socket = null
  }

  private send(obj: Record<string, unknown>) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(obj))
  }

  private request(obj: Record<string, unknown>, timeoutMs = 30000): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      if (this.socket?.readyState !== WebSocket.OPEN) { reject(new Error('The bridge is not connected.')); return }

      const entry: Pending = { resolve, reject, op: String(obj.op) }
      this.pending.push(entry)
      this.send(obj)

      setTimeout(() => {
        const i = this.pending.indexOf(entry)
        if (i >= 0) { this.pending.splice(i, 1); reject(new Error(`The bridge did not answer "${entry.op}".`)) }
      }, timeoutMs)
    })
  }

  // ----------------------------------------------------------- plugins --

  async refreshPlugins(): Promise<BridgeNativePlugin[]> {
    if (!this.isConnected()) return []
    const reply = await this.request({ op: 'plugins' }).catch(() => null)
    if (reply) {
      this.plugins = (reply.items as BridgeNativePlugin[]) ?? []
      this.publishToRegistry()
    }
    return this.plugins
  }

  /** Ask the bridge to walk the plug-in folders again. Slow; progress arrives
      through onChange + getScanProgress. */
  rescan() {
    if (!this.isConnected()) return
    this.setStatus('scanning')
    this.send({ op: 'scan' })
  }

  private publishToRegistry() {
    const descriptors: PluginDescriptor[] = this.plugins.map(p => ({
      id: `bridge:${p.id}`,
      name: p.name,
      vendor: p.vendor,
      version: p.version,
      kind: p.isInstrument ? 'instrument' : 'effect',
      source: 'bridge',
      baseUrl: '',
      manifest: null,
      nativeFormat: p.format,
      nativePath: p.path,
    }))
    mergeBridgePlugins(descriptors)
    this.notify()
  }

  // -------------------------------------------------------- instances ---

  async open(nativeId: string, sampleRate: number, blockSize = 512) {
    const reply = await this.request({ op: 'open', id: nativeId, sampleRate, blockSize }, 60000)
    return reply as { uid: number; plugin: Record<string, unknown> }
  }

  close(uid: number) { this.send({ op: 'close', uid }) }
  setParam(uid: number, index: number, value: number) { this.send({ op: 'param', uid, index, value }) }
  showEditor(uid: number, show = true) { this.send({ op: 'editor', uid, show }) }

  async getState(uid: number): Promise<string> {
    const reply = await this.request({ op: 'getState', uid })
    return String(reply.state ?? '')
  }

  setState(uid: number, state: string) { this.send({ op: 'setState', uid, state }) }

  /** Render one block. Resolves with de-interleaved channels. */
  render(
    uid: number,
    frames: number,
    events: Array<{ offset: number; on: boolean; pitch: number; velocity: number }>,
  ): Promise<{ left: Float32Array; right: Float32Array }> {
    return new Promise((resolve, reject) => {
      if (this.socket?.readyState !== WebSocket.OPEN) { reject(new Error('The bridge is not connected.')); return }

      this.binaryWaiters.push(buffer => {
        const view = new DataView(buffer)
        const gotFrames = view.getInt32(4, true)
        const left = new Float32Array(gotFrames)
        const right = new Float32Array(gotFrames)
        for (let i = 0; i < gotFrames; i++) {
          left[i] = view.getFloat32(8 + i * 8, true)
          right[i] = view.getFloat32(8 + i * 8 + 4, true)
        }
        resolve({ left, right })
      })

      this.send({ op: 'render', uid, frames, events })

      setTimeout(() => reject(new Error('The bridge did not return audio in time.')), 10000)
    })
  }
}

export const bridge = new BridgeClient()

// ===========================================================================
//  Playing a bridge plugin on a track
// ===========================================================================

interface ScheduledNote { time: number; on: boolean; pitch: number; velocity: number }

/** One native plug-in, streamed into an AudioWorkletNode. */
export class BridgeVoice {
  private node: AudioWorkletNode | null = null
  private uid = -1
  private ctx: BaseAudioContext
  private notes: ScheduledNote[] = []
  private renderFrame = 0
  private frameZeroTime = 0      // context time at which output frame 0 played
  private haveClock = false
  private inFlight = false
  private stopped = false

  constructor(ctx: BaseAudioContext) { this.ctx = ctx }

  get instanceId() { return this.uid }

  /** Ring depth in milliseconds — the latency of hosting out of process. */
  getLatencyMs(target = 4096) { return (target / this.ctx.sampleRate) * 1000 }

  async start(nativeId: string, destination: AudioNode, targetFrames = 4096): Promise<void> {
    const opened = await bridge.open(nativeId, this.ctx.sampleRate, 512)
    this.uid = opened.uid

    await this.ctx.audioWorklet.addModule(PLAYER_MODULE).catch(() => { /* already added */ })

    this.node = new AudioWorkletNode(this.ctx, 'beacon-bridge-player', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { targetFrames },
    })

    this.node.port.onmessage = (event: MessageEvent) => {
      const msg = event.data as {
        type: string; playFrame: number; contextTime: number; wanted: number
      }
      if (msg.type !== 'position') return

      // The worklet is the only place that knows exactly which context time
      // corresponds to which output frame. Anchor on that.
      this.frameZeroTime = msg.contextTime - msg.playFrame / this.ctx.sampleRate
      this.haveClock = true

      if (msg.wanted > 0) void this.pump(Math.max(512, Math.min(4096, msg.wanted)))
    }

    this.node.connect(destination)
    void this.pump(targetFrames)
  }

  /** Schedule a note at an absolute AudioContext time. */
  note(on: boolean, pitch: number, velocity: number, time: number) {
    this.notes.push({ on, pitch, velocity, time })
    this.notes.sort((a, b) => a.time - b.time)
  }

  setParam(index: number, value: number) {
    if (this.uid >= 0) bridge.setParam(this.uid, index, value)
  }

  showEditor(show = true) {
    if (this.uid >= 0) bridge.showEditor(this.uid, show)
  }

  stop() {
    this.stopped = true
    if (this.node) {
      try { this.node.port.postMessage({ type: 'stop' }) } catch { /* gone */ }
      try { this.node.disconnect() } catch { /* gone */ }
    }
    this.node = null
    if (this.uid >= 0) { bridge.close(this.uid); this.uid = -1 }
  }

  /** Render the next block and hand it to the worklet. */
  private async pump(frames: number) {
    if (this.inFlight || this.stopped || this.uid < 0 || !this.node) return
    this.inFlight = true

    try {
      // Which notes fall inside the frames we are about to render?
      const events: Array<{ offset: number; on: boolean; pitch: number; velocity: number }> = []

      if (this.haveClock) {
        const sr = this.ctx.sampleRate
        const blockStartFrame = this.renderFrame
        const blockEndFrame = blockStartFrame + frames

        while (this.notes.length > 0) {
          const n = this.notes[0]
          const frame = Math.round((n.time - this.frameZeroTime) * sr)
          if (frame >= blockEndFrame) break

          // A note whose time has already gone by is played immediately rather
          // than dropped: late is recoverable, missing is not.
          events.push({
            offset: Math.max(0, frame - blockStartFrame),
            on: n.on,
            pitch: n.pitch,
            velocity: n.velocity,
          })
          this.notes.shift()
        }
      }

      const audio = await bridge.render(this.uid, frames, events)
      this.renderFrame += frames

      if (!this.stopped && this.node) {
        this.node.port.postMessage(
          { type: 'audio', left: audio.left, right: audio.right },
          [audio.left.buffer, audio.right.buffer],
        )
      }
    } catch {
      // The bridge went away mid-session. The worklet keeps playing silence,
      // which is the least alarming failure available.
    } finally {
      this.inFlight = false
    }
  }
}
