// A take recorder that keeps every sample.
//
// Takes used to go through MediaRecorder, which means Opus at ~128 kb/s: a
// lossy, block-aligned stream whose first packet lands whenever the encoder
// feels like it. Fine for the jam buffer (a rolling "what did I just play"),
// wrong for a take — punch-in, record-quantize, comping and a lossless bounce
// all need to know exactly which sample the take starts on and exactly what
// the microphone heard. This records float32 frames straight off the graph
// and writes a 32-bit float WAV, the format Live records by default.
//
// The capture backend is a ScriptProcessorNode — the same pattern renderWav
// uses (lib/daw-engine.ts), proven on every browser Beacon runs in. It runs
// on the main thread, so a long stall there (an Apollo offline render) would
// drop frames; nobody records during one, and the backend is one class to
// swap for an AudioWorklet when the engine grows one.

import { encodeWav } from './wav-codec'

export interface PcmTake {
  /** One Float32Array per channel, all the same length. */
  channels: Float32Array[]
  sampleRate: number
  /** Frames per channel — sample-exact length of the take. */
  frames: number
  /** 32-bit float WAV (`audio/wav`). */
  blob: Blob
}

export interface PcmRecorderOptions {
  /** 1 or 2. A mono source recorded in stereo gets the same signal on both. */
  channels?: 1 | 2
  /** ScriptProcessor block size — bigger is safer under load, coarser to stop. */
  bufferSize?: 256 | 512 | 1024 | 2048 | 4096 | 8192 | 16384
}

export class PcmRecorder {
  readonly ctx: BaseAudioContext
  readonly source: AudioNode
  readonly channels: number
  readonly bufferSize: number
  state: 'inactive' | 'recording' | 'stopping' | 'stopped' = 'inactive'
  /** Frames captured so far (per channel). */
  frames = 0

  private proc: ScriptProcessorNode | null = null
  private sink: GainNode | null = null
  private chunks: Float32Array[][] = []
  private startedAt = 0

  constructor(ctx: BaseAudioContext, source: AudioNode, opts: PcmRecorderOptions = {}) {
    this.ctx = ctx
    this.source = source
    this.channels = opts.channels ?? 2
    this.bufferSize = opts.bufferSize ?? 4096
  }

  /** A recorder on a live input (the microphone, an interface channel). */
  static fromStream(ctx: AudioContext, stream: MediaStream, opts: PcmRecorderOptions = {}): PcmRecorder {
    const src = ctx.createMediaStreamSource(stream)
    const mono = stream.getAudioTracks()[0]?.getSettings?.().channelCount === 1
    return new PcmRecorder(ctx, src, { channels: mono ? 1 : 2, ...opts })
  }

  start(): void {
    if (this.state === 'recording') return
    const proc = this.ctx.createScriptProcessor(this.bufferSize, this.channels, this.channels)
    // A ScriptProcessor only runs while it is wired to the destination; a
    // silent gain keeps it in the graph without letting the take back out.
    const sink = this.ctx.createGain()
    sink.gain.value = 0
    proc.onaudioprocess = e => {
      const ib = e.inputBuffer
      const block: Float32Array[] = []
      for (let ch = 0; ch < this.channels; ch++) {
        const from = ib.numberOfChannels > ch ? ch : 0
        block.push(new Float32Array(ib.getChannelData(from)))
      }
      this.chunks.push(block)
      this.frames += ib.length
      this.onBlock?.()
    }
    this.source.connect(proc)
    proc.connect(sink)
    sink.connect(this.ctx.destination)
    this.proc = proc
    this.sink = sink
    this.chunks = []
    this.frames = 0
    this.startedAt = this.ctx.currentTime
    this.state = 'recording'
  }

  /**
   * Stop and hand back the take, as long as the time that passed on the
   * graph clock — sample-exact, not rounded to the block size.
   *
   * ⚠️ A ScriptProcessor only hands over a block once it is FULL, so at the
   * moment of stopping, up to one block of the take is still inside it.
   * Tearing down at once lost the last 256 ms at 16 kHz (measured: a 1.008 s
   * take came back 0.768 s). So the recorder stays wired until the block
   * that carries the last frame arrives, then trims to the clock. The wait
   * is at most one block; a graph that has gone quiet is given two.
   */
  stop(): Promise<PcmTake> {
    if (this.state !== 'recording' || !this.proc || !this.sink) {
      return Promise.resolve({ channels: Array.from({ length: this.channels }, () => new Float32Array(0)), sampleRate: this.ctx.sampleRate, frames: 0, blob: new Blob([], { type: 'audio/wav' }) })
    }
    const elapsed = Math.max(0, this.ctx.currentTime - this.startedAt)
    const wanted = Math.round(elapsed * this.ctx.sampleRate)
    this.state = 'stopping'
    return new Promise(resolve => {
      let done = false
      const finish = () => {
        if (done) return
        done = true
        this.onBlock = null
        this.teardown()
        const frames = Math.min(this.frames, wanted > 0 ? wanted : this.frames)
        const channels = joinBlocks(this.chunks, this.channels, frames)
        this.chunks = []
        const blob = new Blob([encodeWav(channels, this.ctx.sampleRate)], { type: 'audio/wav' })
        resolve({ channels, sampleRate: this.ctx.sampleRate, frames, blob })
      }
      if (this.frames >= wanted) return finish()
      this.onBlock = () => { if (this.frames >= wanted) finish() }
      setTimeout(finish, Math.ceil((this.bufferSize / this.ctx.sampleRate) * 2000) + 100)
    })
  }

  private onBlock: (() => void) | null = null

  private teardown(): void {
    if (this.proc) {
      try { this.source.disconnect(this.proc) } catch { /* already gone */ }
      this.proc.onaudioprocess = null
      try { this.proc.disconnect() } catch { /* ok */ }
    }
    if (this.sink) { try { this.sink.disconnect() } catch { /* ok */ } }
    this.proc = null
    this.sink = null
    this.state = 'stopped'
  }
}

/** Concatenate captured blocks into one buffer per channel, cut to `frames`. */
export function joinBlocks(blocks: Float32Array[][], channels: number, frames: number): Float32Array[] {
  const out = Array.from({ length: channels }, () => new Float32Array(frames))
  let at = 0
  for (const block of blocks) {
    if (at >= frames) break
    const n = Math.min(block[0]?.length ?? 0, frames - at)
    for (let ch = 0; ch < channels; ch++) out[ch].set(block[Math.min(ch, block.length - 1)].subarray(0, n), at)
    at += n
  }
  return out
}
