/**
 * Render Apollo clips to audio, off the main thread.
 *
 * Brae, after days of dropouts: "Why is nothing helping the Beacon lag."
 *
 * ⚠️ BECAUSE BEACON SYNTHESISES DURING PLAYBACK, AND IT CANNOT AFFORD TO.
 * Measured: one Apollo track playing chords costs 0.12–0.17 of real time, eight
 * cost 0.72 — of a SINGLE audio thread that must finish every 128-sample block
 * before its deadline. Safari's audio path absorbs that; Chromium's does not,
 * which is the whole "works in Safari, not in Brave". No cache fix, leak fix or
 * buffer size changes how much arithmetic there is.
 *
 * A rendered clip costs nothing to play. This is where the rendering happens.
 *
 * ⚠️ NO WEB AUDIO IN HERE, AND NONE IS NEEDED. OfflineAudioContext is not
 * available to workers, which is what made this look impossible in August and
 * left the render on the main thread, blocking it for eleven seconds at a time.
 * But Helios does not actually need Web Audio: it is a class that fills two
 * Float32Arrays. Shim the three globals an AudioWorklet would provide and it
 * runs anywhere — scripts/apollo-render.mjs has driven it from plain node for
 * months, and this is the same trick in a worker.
 */

// ⚠️ EVERYTHING BELOW IS SCOPED, because importScripts shares this global.
//
// engine.js declares about eighty top-level names — BLOCK, SR, Voice, clamp and
// the rest — straight into the worker's global scope. The first version of this
// file declared `const BLOCK = 128` beside it and the import died with
// "Identifier 'BLOCK' has already been declared", which reads as the engine
// being broken rather than as a name clash.
//
// A closure makes that impossible to hit again, whatever the engine adds later.
// Only self.onmessage escapes, which is the one thing that has to.
;(function () {
  const BLOCK = 128

  // ── The three globals an AudioWorkletGlobalScope would have ────────────────
  let SR = 48000
  self.sampleRate = SR
  self.currentTime = 0
  self.AudioWorkletProcessor = class {
    constructor() {
      // Helios talks to its host over a port. Nothing here listens, but it must
      // exist or the constructor throws.
      this.port = { postMessage: () => {}, onmessage: null, close: () => {} }
    }
  }
  let ProcessorClass = null
  self.registerProcessor = (_name, cls) => { ProcessorClass = cls }

  let loadFailed = null
  try {
    // The engine registers itself on import.
    importScripts('/apollo/engine.js?v=worker')
  } catch (err) {
    loadFailed = String(err && err.message ? err.message : err)
  }

  /**
   * One clip, start to finish.
   *
   * ⚠️ Events are applied by CALLING the processor, not by posting them. A posted
   * 'scheduleAt' would be handled by the engine's own message loop against
   * currentTime — which here is a variable this worker advances by hand, and the
   * two would drift. Driving noteOn/noteOff directly at the right block is exact.
   */
  function render({ patch, events, seconds, sampleRate: rate }) {
    if (loadFailed) throw new Error('engine failed to load: ' + loadFailed)
    if (!ProcessorClass) throw new Error('engine loaded but registered no processor')

    SR = rate || 48000
    self.sampleRate = SR

    const proc = new ProcessorClass()
    // The constructor wires this.port.onmessage -> onMessage(e.data), so a patch
    // delivered here takes exactly the path it takes during playback: quality and
    // oversampling, macros, tuning, sample restoration. There is no second setup
    // path that could drift from the real one.
    proc.port.onmessage({ data: { type: 'patch', patch } })

    const totalBlocks = Math.ceil((seconds * SR) / BLOCK)
    const outL = new Float32Array(totalBlocks * BLOCK)
    const outR = new Float32Array(totalBlocks * BLOCK)
    const ordered = (events || []).slice().sort((a, b) => a.t - b.t)

    let evIdx = 0
    const L = new Float32Array(BLOCK)
    const R = new Float32Array(BLOCK)
    for (let b = 0; b < totalBlocks; b++) {
      const tNow = (b * BLOCK) / SR
      while (evIdx < ordered.length && ordered[evIdx].t <= tNow) {
        const ev = ordered[evIdx++]
        if (ev.type === 'noteOn' || ev.type === 'on') {
          proc.noteOn(ev.note, ev.vel != null ? ev.vel : 0.9, false, ev.ch || 0, ev.nf)
        } else {
          proc.noteOff(ev.note, false)
        }
      }
      L.fill(0); R.fill(0)
      self.currentTime = tNow
      proc.process([], [[L, R]])
      outL.set(L, b * BLOCK)
      outR.set(R, b * BLOCK)
    }
    return { outL, outR, sampleRate: SR }
  }

  self.onmessage = e => {
    const { id, job } = e.data || {}
    if (!id) return
    try {
      const t0 = Date.now()
      const { outL, outR, sampleRate: rate } = render(job)
      // ⚠️ Transferred, not copied. A four-bar stereo clip is a couple of
      // megabytes; structured-cloning that per clip would put the cost straight
      // back on the thread this exists to protect.
      self.postMessage(
        { id, ok: true, left: outL.buffer, right: outR.buffer, sampleRate: rate, ms: Date.now() - t0 },
        [outL.buffer, outR.buffer],
      )
    } catch (err) {
      self.postMessage({ id, ok: false, error: String(err && err.message ? err.message : err) })
    }
  }

})()
