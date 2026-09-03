'use client'
// Talking to the render worker.
//
// ⚠️ THE POINT OF ALL OF THIS IS THAT THE MAIN THREAD NEVER WAITS. Rendering a
// clip used to happen inline, which is why auto-freeze was switched off in
// August: an eleven-second stall is worse than the dropouts it was curing. Every
// call here returns a promise and nothing blocks — the render happens on another
// thread and arrives when it arrives.
//
// One worker, not one per job. Spinning up a worker costs a fresh import and
// compile of the whole engine, which is far more than most renders.

import { ENGINE_VERSION } from './engine-version'

export interface RenderJob {
  patch: unknown
  /** Absolute-time note events, seconds from the clip's start. */
  events: { t: number; type: 'noteOn' | 'noteOff'; note: number; vel?: number; ch?: number; nf?: unknown }[]
  seconds: number
  sampleRate: number
}

export interface RenderResult {
  left: Float32Array
  right: Float32Array
  sampleRate: number
  /** How long the worker took. Useful for deciding whether to keep doing this. */
  ms: number
}

type Pending = { resolve: (r: RenderResult) => void; reject: (e: Error) => void }

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, Pending>()

/** Is a worker even possible here? Offline renders and tests run without one. */
export function canRenderInWorker(): boolean {
  return typeof Worker !== 'undefined' && typeof window !== 'undefined'
}

function ensureWorker(): Worker | null {
  if (worker) return worker
  if (!canRenderInWorker()) return null
  try {
    // ⚠️ Versioned, for the same reason every other engine url is: the service
    // worker serves .js stale-while-revalidate, and a worker rendering with a
    // different engine build than playback uses would produce clips that do not
    // match what the live path makes — the worst kind of wrong, because it
    // sounds almost right.
    worker = new Worker(`/apollo/render-worker.js?v=${ENGINE_VERSION}`)
    worker.onmessage = e => {
      const { id, ok, left, right, sampleRate, error, ms } = e.data || {}
      const p = pending.get(id)
      if (!p) return
      pending.delete(id)
      if (ok) p.resolve({ left: new Float32Array(left), right: new Float32Array(right), sampleRate, ms })
      else p.reject(new Error(error || 'render failed'))
    }
    worker.onerror = ev => {
      // A worker that cannot start must not leave callers waiting for ever.
      const err = new Error(`render worker failed: ${ev.message || 'unknown'}`)
      for (const [, p] of pending) p.reject(err)
      pending.clear()
      try { worker?.terminate() } catch { /* already gone */ }
      worker = null
    }
  } catch {
    worker = null
  }
  return worker
}

/**
 * Render one clip. Resolves with raw channels; never blocks the caller.
 *
 * Rejects rather than falling back to a main-thread render on purpose: a silent
 * fallback would reintroduce exactly the stall this exists to avoid, and the
 * caller is better placed to decide whether to play live instead.
 */
export function renderClip(job: RenderJob): Promise<RenderResult> {
  const w = ensureWorker()
  if (!w) return Promise.reject(new Error('no worker available'))
  const id = nextId++
  return new Promise<RenderResult>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    w.postMessage({ id, job })
  })
}

/** Drop the worker (a user leaving the studio, a test tearing down). */
export function disposeRenderWorker(): void {
  try { worker?.terminate() } catch { /* already gone */ }
  worker = null
  for (const [, p] of pending) p.reject(new Error('render worker disposed'))
  pending.clear()
}

/** How many renders are in flight — for deciding whether to ask for more. */
export function rendersInFlight(): number { return pending.size }
