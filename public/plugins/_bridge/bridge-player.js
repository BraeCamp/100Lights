/* ===========================================================================
   Plays audio that was rendered by the Beacon Bridge in another process.

   The bridge cannot reach the audio thread — nothing on a WebSocket can — so
   the main thread pulls rendered blocks and pushes them in here, and this
   worklet plays them out of a ring buffer at the audio clock.

   That buffer is the price of hosting a native plug-in in a browser: it is the
   latency between playing a note and hearing it. It is reported honestly
   through `framesBuffered` so Beacon can show it rather than hide it.

   The other job here is timing. This worklet is the only thing that knows the
   exact relationship between an AudioContext time and an output frame, so it
   reports both together; the main thread uses that to work out which frame a
   note should land on, several blocks before it is played.
   =========================================================================== */

'use strict'

const RING_FRAMES = 1 << 16   // 65536 frames, about 1.4 s at 48 kHz

class BridgePlayer extends AudioWorkletProcessor {
  constructor(options) {
    super()

    const opts = (options && options.processorOptions) || {}
    this.targetFrames = opts.targetFrames || 4096

    this.ringL = new Float32Array(RING_FRAMES)
    this.ringR = new Float32Array(RING_FRAMES)
    this.writeIndex = 0
    this.readIndex = 0
    this.available = 0

    this.playFrame = 0        // total frames sent to the output, ever
    this.requestedTo = 0      // frames the main thread says it has queued
    this.underruns = 0
    this.reportCountdown = 0
    this.running = true

    this.port.onmessage = (e) => {
      const msg = e.data
      if (msg.type === 'audio') {
        this.push(msg.left, msg.right)
      } else if (msg.type === 'reset') {
        this.writeIndex = this.readIndex = this.available = 0
        this.underruns = 0
      } else if (msg.type === 'stop') {
        this.running = false
      }
    }
  }

  push(left, right) {
    const n = left.length
    for (let i = 0; i < n; i++) {
      this.ringL[this.writeIndex] = left[i]
      this.ringR[this.writeIndex] = right[i]
      this.writeIndex = (this.writeIndex + 1) & (RING_FRAMES - 1)
    }
    this.available = Math.min(RING_FRAMES, this.available + n)
  }

  process(_inputs, outputs) {
    const out = outputs[0]
    if (!out || out.length === 0) return true

    const left = out[0]
    const right = out.length > 1 ? out[1] : null
    const frames = left.length

    if (this.available >= frames) {
      for (let i = 0; i < frames; i++) {
        left[i] = this.ringL[this.readIndex]
        if (right) right[i] = this.ringR[this.readIndex]
        this.readIndex = (this.readIndex + 1) & (RING_FRAMES - 1)
      }
      this.available -= frames
    } else {
      // Underrun. Output silence rather than repeating the last block: a click
      // is easier to diagnose than a stutter that sounds like the plug-in.
      left.fill(0)
      if (right) right.fill(0)
      this.underruns++
    }

    this.playFrame += frames

    // Tell the main thread where we are, often enough for it to keep the
    // buffer fed and to place notes accurately.
    this.reportCountdown -= frames
    if (this.reportCountdown <= 0) {
      this.reportCountdown = 512
      this.port.postMessage({
        type: 'position',
        playFrame: this.playFrame,
        contextTime: currentTime,
        buffered: this.available,
        wanted: Math.max(0, this.targetFrames - this.available),
        underruns: this.underruns,
      })
    }

    return this.running
  }
}

registerProcessor('beacon-bridge-player', BridgePlayer)
