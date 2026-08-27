// Combining, off the main thread.
//
// A combine used to run through an OfflineAudioContext, and Chrome runs that on
// the MAIN THREAD when it carries JS worklets — so every render froze the
// interface for its whole duration. That is why baking had to stop the moment
// anyone pressed play, and why a first listen through a project baked nothing at
// all: the good path existed and never got to run.
//
// Nothing in a combine needs Web Audio. The graph is Apollo engines summed into
// channels — no convolver, no biquad, no browser DSP — and the engine is plain
// JavaScript that has run headless in this repo's tooling for as long as it has
// existed. So it runs here instead, block by block, on a thread nobody is
// drawing on.
//
// Setup messages are ordinary function calls here rather than an asynchronous
// MessagePort, which also removes the race that made renders come back silent:
// a processor could previously be asked for samples before it had been told
// which patch to play.

import { renderJobs, type EngineCtor, type RenderJob } from './render-core'

interface AssetMessage { type: string; id?: string }

/** Tables and samples, kept for the life of the worker.
 *  A wavetable with its mipmaps is around half a megabyte; sending them with
 *  every render would put megabytes of structured-clone in front of each window
 *  for data that never changes. The main thread sends each one once. */
const assets: AssetMessage[] = []
const assetIds = new Set<string>()

let Engine: EngineCtor | null = null
let engineError: string | null = null

/** engine.js is a plain script that ends in registerProcessor(), so the globals
 *  an AudioWorkletGlobalScope would provide have to exist before it evaluates. */
async function loadEngine(sampleRate: number): Promise<EngineCtor> {
  if (Engine) return Engine
  if (engineError) throw new Error(engineError)
  const g = globalThis as unknown as Record<string, unknown>
  g.sampleRate = sampleRate
  g.currentTime = 0
  g.AudioWorkletProcessor = class {
    port = { postMessage: () => {}, onmessage: null }
  }
  g.registerProcessor = (_name: string, cls: unknown) => { g.__apolloEngine = cls }
  try {
    // An ABSOLUTE url. A root-relative path is not a valid module specifier in a
    // worker — it fails with "Failed to resolve module specifier", which the
    // caller then treats as "no worker" and falls back to the main-thread path
    // without anything obviously being wrong.
    const url = new URL('/apollo/engine.js', self.location.origin).href
    await import(/* webpackIgnore: true */ url)
  } catch (err) {
    engineError = `engine.js failed to load in the worker: ${String(err)}`
    throw new Error(engineError)
  }
  Engine = g.__apolloEngine as EngineCtor
  if (!Engine) throw new Error('engine.js loaded but registered nothing')
  return Engine
}

type InMessage =
  | { type: 'assets'; msgs: AssetMessage[] }
  | { type: 'render'; id: number; jobs: RenderJob[]; frames: number; sampleRate: number }

self.onmessage = async (e: MessageEvent<InMessage>) => {
  const msg = e.data
  if (msg.type === 'assets') {
    for (const m of msg.msgs) {
      const key = `${m.type}:${m.id ?? ''}`
      if (assetIds.has(key)) continue
      assetIds.add(key)
      assets.push(m)
    }
    return
  }
  if (msg.type !== 'render') return

  const { id, jobs, frames, sampleRate } = msg
  try {
    const Ctor = await loadEngine(sampleRate)
    const g = globalThis as unknown as Record<string, unknown>
    // Every engine gets the shared assets first, then its own patch and notes.
    const full: RenderJob[] = jobs.map(j => ({ messages: [...assets, ...j.messages] }))
    const channels = renderJobs(
      Ctor, full, frames, sampleRate,
      t => { g.currentTime = t },
      done => { (self as unknown as Worker).postMessage({ type: 'progress', id, done }) },
    )
    const copies = channels.map(c => new Float32Array(c))
    ;(self as unknown as Worker).postMessage(
      { type: 'done', id, channels: copies, sampleRate },
      copies.map(c => c.buffer),
    )
  } catch (err) {
    // Never fatal: the caller falls back to the OfflineAudioContext path, which
    // is exactly what happens today.
    ;(self as unknown as Worker).postMessage({ type: 'error', id, message: String(err) })
  }
}
