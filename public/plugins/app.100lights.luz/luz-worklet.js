/* ===========================================================================
   Luz — Beacon Plugin Format v1 processor.

   Drives the Aurora engine compiled to WebAssembly. The DSP is byte for byte
   the same code as the AU/VST3/CLAP plug-in; only the shell differs.

   Two things here are worth reading before changing anything:

   1. A worklet has no fetch(). The wasm bytes arrive in the `init` message and
      are instantiated here. A processor that tries to load its own wasm never
      starts, and nothing in the console says why.

   2. Note timing is sample accurate by SEGMENTING the block. Events are sorted
      by time, the engine renders up to each event, the event is applied, then
      rendering continues. Applying every event at the start of a 128 sample
      block would smear timing by up to 2.7 ms at 48 kHz, which is audible on
      fast arpeggios and makes a bounce differ from what you heard.
   =========================================================================== */

'use strict'

/* AudioWorkletGlobalScope has no TextEncoder, so UTF-8 is encoded by hand.
   This is the whole reason Luz loaded but never sounded in the browser. */
function encodeUtf8 (str) {
  const out = []
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      const lo = str.charCodeAt(i + 1)
      if (lo >= 0xdc00 && lo <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (lo - 0xdc00); i++ }
    }
    if (c < 0x80) out.push(c)
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63))
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
  }
  return new Uint8Array(out)
}

const RENDER_QUANTUM = 128

class LuzProcessor extends AudioWorkletProcessor {
  constructor() {
    super()

    this.wasm = null
    this.exports = null
    this.handle = -1
    this.heapF32 = null
    this.heapU8 = null
    this.memory = null

    this.paramIndex = new Map()   // id -> engine parameter index
    this.pendingValues = null
    this.ready = false
    this.failed = false

    this.events = []              // sorted by time
    this.peak = 0
    this.meterCountdown = 0

    this.outLeftPtr = 0
    this.outRightPtr = 0

    this.port.onmessage = (e) => { this.onMessage(e.data) }
  }

  /* ------------------------------------------------------------- memory -- */

  refreshHeap() {
    const buf = this.memory.buffer
    this.heapF32 = new Float32Array(buf)
    this.heapU8 = new Uint8Array(buf)
  }

  writeCString(str) {
    const bytes = encodeUtf8(str)
    const ptr = this.exports.malloc(bytes.length + 1)
    this.heapU8.set(bytes, ptr)
    this.heapU8[ptr + bytes.length] = 0
    return ptr
  }

  /* ------------------------------------------------------------ messages -- */

  async onMessage(msg) {
    try {
      switch (msg.type) {
        case 'init':
          await this.init(msg)
          break

        case 'note':
          this.insertEvent(msg)
          break

        case 'param':
          this.applyParam(msg.id, msg.value)
          break

        case 'params':
          for (const id of Object.keys(msg.values)) this.applyParam(id, msg.values[id])
          break

        case 'transport':
          if (this.ready) this.exports.luz_set_transport(this.handle, msg.bpm, msg.playing ? 1 : 0)
          break

        case 'state':
          // Every setting Luz exposes on the web is a parameter, so there is
          // no extra state to restore. Kept for format compatibility.
          break

        case 'requestState':
          this.port.postMessage({ type: 'state', state: '' })
          break

        case 'panic':
          if (this.ready) this.exports.luz_all_notes_off(this.handle)
          this.events.length = 0
          break

        default:
          break
      }
    } catch (err) {
      this.failed = true
      this.port.postMessage({ type: 'error', message: String(err && err.message ? err.message : err) })
    }
  }

  async init(msg) {
    if (!msg.wasmBinary) throw new Error('no wasm binary was supplied in the init message')

    // STANDALONE_WASM still asks for a couple of host functions. Stub the ones
    // that can be reached and make the rest loud rather than silent.
    const notImplemented = (name) => () => {
      this.port.postMessage({ type: 'error', message: `the engine called ${name}, which the worklet does not provide` })
      return 0
    }

    const imports = {
      env: {
        emscripten_notify_memory_growth: () => { this.refreshHeap(); this.cacheOutputPointers() },
      },
      wasi_snapshot_preview1: {
        fd_write: () => 0,
        fd_close: () => 0,
        fd_seek: () => 0,
        fd_read: () => 0,
        environ_get: () => 0,
        environ_sizes_get: () => 0,
        proc_exit: notImplemented('proc_exit'),
        clock_time_get: () => 0,
        random_get: (ptr, len) => {
          // The engine seeds its own RNGs deterministically; this exists only
          // so a libc that wants entropy does not trap.
          for (let i = 0; i < len; i++) this.heapU8[ptr + i] = (Math.random() * 256) | 0
          return 0
        },
      },
    }

    const { instance } = await WebAssembly.instantiate(msg.wasmBinary, imports)
    this.exports = instance.exports
    this.memory = this.exports.memory
    this.refreshHeap()

    if (typeof this.exports._initialize === 'function') this.exports._initialize()

    this.handle = this.exports.luz_create(sampleRate)
    if (this.handle < 0) throw new Error('the engine refused to start')

    // Resolve ids to indices once, so the audio path only deals in integers.
    const count = this.exports.luz_param_count()
    this.paramIndex.clear()
    for (const id of Object.keys(msg.values ?? {})) {
      const ptr = this.writeCString(id)
      const index = this.exports.luz_param_index(ptr)
      this.exports.free(ptr)
      if (index >= 0) this.paramIndex.set(id, index)
    }
    if (count === 0) throw new Error('the engine reported no parameters')

    this.cacheOutputPointers()

    this.ready = true
    for (const id of Object.keys(msg.values ?? {})) this.applyParam(id, msg.values[id])

    this.port.postMessage({ type: 'ready' })
  }

  cacheOutputPointers() {
    if (this.handle < 0) return
    this.outLeftPtr = this.exports.luz_out_left(this.handle)
    this.outRightPtr = this.exports.luz_out_right(this.handle)
  }

  applyParam(id, value) {
    if (!this.ready) return
    const index = this.paramIndex.get(id)
    if (index === undefined) return
    const v = typeof value === 'boolean' ? (value ? 1 : 0) : Number(value)
    if (!Number.isFinite(v)) return
    this.exports.luz_set_param(this.handle, index, v)
  }

  insertEvent(msg) {
    const t = msg.time
    let i = this.events.length
    while (i > 0 && this.events[i - 1].time > t) i--
    this.events.splice(i, 0, msg)
  }

  /* ------------------------------------------------------------- process -- */

  process(_inputs, outputs) {
    const out = outputs[0]
    if (!out || out.length === 0) return true

    const left = out[0]
    const right = out.length > 1 ? out[1] : null
    const frames = left.length

    if (!this.ready || this.failed) {
      left.fill(0)
      if (right) right.fill(0)
      return true
    }

    const blockStart = currentTime
    const invSr = 1 / sampleRate

    let done = 0
    let consumed = 0

    while (done < frames) {
      // How far can we render before the next event lands?
      let segment = frames - done

      while (consumed < this.events.length) {
        const ev = this.events[consumed]
        const offset = Math.round((ev.time - blockStart) / invSr)

        if (offset <= done) {
          // due now (or overdue, which happens when the host schedules late)
          if (ev.on) this.exports.luz_note_on(this.handle, ev.pitch, ev.velocity)
          else this.exports.luz_note_off(this.handle, ev.pitch)
          consumed++
          continue
        }

        if (offset < done + segment) segment = offset - done
        break
      }

      if (segment <= 0) segment = 1

      this.exports.luz_process(this.handle, segment)

      // luz_out_* are stable for the life of the instance unless the heap
      // grew, and the growth callback re-caches them.
      const lBase = this.outLeftPtr >> 2
      const rBase = this.outRightPtr >> 2
      for (let i = 0; i < segment; i++) {
        left[done + i] = this.heapF32[lBase + i]
        if (right) right[done + i] = this.heapF32[rBase + i]
      }

      done += segment
    }

    if (consumed > 0) this.events.splice(0, consumed)

    // ---- meter
    let blockPeak = 0
    for (let i = 0; i < frames; i++) {
      const a = left[i] < 0 ? -left[i] : left[i]
      if (a > blockPeak) blockPeak = a
    }
    this.peak = Math.max(this.peak * 0.85, blockPeak)

    this.meterCountdown -= frames
    if (this.meterCountdown <= 0) {
      this.meterCountdown = sampleRate / 20
      this.port.postMessage({ type: 'meter', peak: this.peak })
    }

    return true
  }
}

registerProcessor('luz-aurora', LuzProcessor)
