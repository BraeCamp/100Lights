'use client'
// ============================================================================
//  Beacon plugin host — runs web plugins as DAW track instruments.
//
//  One AudioWorkletNode per (context, track destination), fed absolute-time
//  note events so live playback and offline render behave identically. This
//  follows the shape of lib/apollo/daw-instrument.ts deliberately: that file
//  already learned the lessons (queue until ready, drop nodes on stop because
//  the DAW swaps per-track buses, wait for readiness before a render).
// ============================================================================

import {
  mergeValues,
  type HostMessage,
  type PluginDescriptor,
  type PluginInstrumentParams,
  type PluginParamValue,
  type ProcessorMessage,
} from './types'
import { findPlugin, resolveAsset } from './registry'

interface Queued { message: HostMessage }

interface Managed {
  node: AudioWorkletNode | null
  descriptor: PluginDescriptor
  ready: boolean
  failed: boolean
  queue: Queued[]
  lastValues: Record<string, PluginParamValue>
  lastState: string | undefined
  peak: number
}

const byDest = new WeakMap<AudioNode, Managed>()
const byCtx = new WeakMap<BaseAudioContext, Set<Managed>>()
const ctxTempo = new WeakMap<BaseAudioContext, number>()

/** Worklet modules are registered per context; adding one twice throws. */
const modulesAdded = new WeakMap<BaseAudioContext, Set<string>>()

/** A plugin's wasm is fetched once per page, then cloned into each processor. */
const wasmCache = new Map<string, ArrayBuffer>()

// ---------------------------------------------------------------------------

async function ensureModule(ctx: BaseAudioContext, url: string): Promise<void> {
  let added = modulesAdded.get(ctx)
  if (!added) { added = new Set(); modulesAdded.set(ctx, added) }
  if (added.has(url)) return

  await ctx.audioWorklet.addModule(url)
  added.add(url)
}

async function ensureWasm(url: string): Promise<ArrayBuffer> {
  const hit = wasmCache.get(url)
  if (hit) return hit

  const res = await fetch(url)
  if (!res.ok) throw new Error(`the wasm binary could not be fetched (${res.status})`)
  const buf = await res.arrayBuffer()
  wasmCache.set(url, buf)
  return buf
}

/** postMessage clones, so every processor gets its own copy and the cached
    buffer is never detached. Transferring it would break the second instance. */
function copyOf(buf: ArrayBuffer): ArrayBuffer {
  return buf.slice(0)
}

// ---------------------------------------------------------------------------

function create(
  ctx: BaseAudioContext,
  dest: AudioNode,
  params: PluginInstrumentParams,
): Managed {
  const m: Managed = {
    node: null,
    descriptor: {
      id: params.pluginId,
      name: params.displayName ?? params.pluginId,
      vendor: '', version: '', kind: 'instrument',
      source: 'builtin', baseUrl: '', manifest: null,
    },
    ready: false,
    failed: false,
    queue: [],
    lastValues: {},
    lastState: params.state,
    peak: 0,
  }

  byDest.set(dest, m)
  let set = byCtx.get(ctx)
  if (!set) { set = new Set(); byCtx.set(ctx, set) }
  set.add(m)

  void (async () => {
    try {
      const descriptor = await findPlugin(params.pluginId)
      if (!descriptor || !descriptor.manifest)
        throw new Error(`plugin "${params.pluginId}" is not installed`)

      m.descriptor = descriptor
      const manifest = descriptor.manifest

      await ensureModule(ctx, resolveAsset(descriptor, manifest.processor))

      const outputs = manifest.outputs === 1 ? 1 : 2
      const node = new AudioWorkletNode(ctx, manifest.processorName, {
        numberOfInputs: manifest.kind === 'effect' ? 1 : 0,
        numberOfOutputs: 1,
        outputChannelCount: [outputs],
      })

      node.port.onmessage = (event: MessageEvent<ProcessorMessage>) => {
        const msg = event.data
        if (msg.type === 'ready') {
          m.ready = true
          for (const q of m.queue) node.port.postMessage(q.message)
          m.queue = []
        } else if (msg.type === 'meter') {
          m.peak = msg.peak
        } else if (msg.type === 'error') {
          console.warn(`[beacon-plugin] ${descriptor.name}: ${msg.message}`)
        }
      }

      node.onprocessorerror = () => {
        m.failed = true
        m.ready = false
        console.warn(
          `[beacon-plugin] "${descriptor.name}" crashed in the audio thread and has been ` +
          'stopped. Its track will be silent until the project is reloaded.',
        )
      }

      const values = mergeValues(manifest, params.values)
      m.lastValues = values

      const init: HostMessage = {
        type: 'init',
        sampleRate: ctx.sampleRate,
        values,
        state: params.state,
        ...(manifest.wasm
          ? { wasmBinary: copyOf(await ensureWasm(resolveAsset(descriptor, manifest.wasm))) }
          : {}),
      }

      node.connect(dest)
      m.node = node
      node.port.postMessage(init)

      const bpm = ctxTempo.get(ctx)
      if (bpm) node.port.postMessage({ type: 'transport', bpm, playing: false } as HostMessage)
    } catch (err) {
      m.failed = true
      console.warn(
        `[beacon-plugin] could not start "${params.pluginId}": ` +
        (err instanceof Error ? err.message : String(err)),
      )
    }
  })()

  return m
}

function ensure(
  ctx: BaseAudioContext,
  dest: AudioNode,
  params: PluginInstrumentParams,
): Managed {
  let m = byDest.get(dest)

  if (!m || (m.descriptor.id !== params.pluginId && m.descriptor.manifest)) {
    // A different plugin on this destination: tear the old one down first.
    if (m) destroy(ctx, dest, m)
    m = create(ctx, dest, params)
    return m
  }

  if (m.ready && m.node && m.descriptor.manifest) {
    const merged = mergeValues(m.descriptor.manifest, params.values)
    const changed: Record<string, PluginParamValue> = {}
    let any = false
    for (const key of Object.keys(merged)) {
      if (m.lastValues[key] !== merged[key]) { changed[key] = merged[key]; any = true }
    }
    if (any) {
      m.lastValues = merged
      m.node.port.postMessage({ type: 'params', values: changed } as HostMessage)
    }
    if (params.state !== undefined && params.state !== m.lastState) {
      m.lastState = params.state
      m.node.port.postMessage({ type: 'state', state: params.state } as HostMessage)
    }
  }

  return m
}

function destroy(ctx: BaseAudioContext, dest: AudioNode, m: Managed): void {
  try { m.node?.port.postMessage({ type: 'panic' } as HostMessage) } catch { /* gone */ }
  try { m.node?.disconnect() } catch { /* gone */ }
  m.node = null
  m.ready = false
  byDest.delete(dest)
  byCtx.get(ctx)?.delete(m)
}

function send(m: Managed, message: HostMessage): void {
  if (m.failed) return
  if (m.ready && m.node) m.node.port.postMessage(message)
  else m.queue.push({ message })
}

// ---------------------------------------------------------------------------
//  Public API — mirrors the Apollo instrument surface
// ---------------------------------------------------------------------------

/** The DAW reports project tempo so synced LFOs and delays follow it. */
export function setPluginCtxTempo(ctx: BaseAudioContext, bpm: number): void {
  ctxTempo.set(ctx, bpm)
  const set = byCtx.get(ctx)
  if (!set) return
  for (const m of set) send(m, { type: 'transport', bpm, playing: true })
}

/** Schedule one note (on and off) at absolute context time. */
export function playPluginNote(
  ctx: BaseAudioContext,
  dest: AudioNode,
  params: PluginInstrumentParams,
  pitch: number,
  velocity: number,      // 0..127
  when: number,
  duration: number,
): void {
  const m = ensure(ctx, dest, params)
  const vel = Math.max(0.05, velocity / 127)

  send(m, { type: 'note', on: true, pitch, velocity: vel, time: when, duration })
  send(m, { type: 'note', on: false, pitch, velocity: 0, time: when + Math.max(0.02, duration) })
}

/** Live parameter change from the UI. */
export function setPluginParam(
  dest: AudioNode,
  id: string,
  value: PluginParamValue,
): void {
  const m = byDest.get(dest)
  if (!m) return
  m.lastValues[id] = value
  send(m, { type: 'param', id, value })
}

/** Peak level of the plugin's last block, for a meter. */
export function pluginPeak(dest: AudioNode): number {
  return byDest.get(dest)?.peak ?? 0
}

/** Warm the module, the wasm and the parameters before playback or a render. */
export async function preloadPluginInstrument(
  ctx: BaseAudioContext,
  dest: AudioNode | undefined,
  params: PluginInstrumentParams,
): Promise<void> {
  if (!dest) {
    // No destination yet: at least get the module compiled for this context.
    const descriptor = await findPlugin(params.pluginId)
    if (descriptor?.manifest) {
      try { await ensureModule(ctx, resolveAsset(descriptor, descriptor.manifest.processor)) }
      catch { /* warmed elsewhere, or unavailable — reported on the real load */ }
    }
    return
  }

  const m = ensure(ctx, dest, params)

  const start = Date.now()
  while (!m.ready && !m.failed && Date.now() - start < 8000) {
    await new Promise(r => setTimeout(r, 25))
  }

  if (!m.ready) {
    // Same trap Apollo documents: the notes were queued against an engine that
    // never came up, so they are dropped and the track is simply ABSENT from
    // the render, with no error anywhere and a "success" at the end.
    console.warn(
      `[beacon-plugin] "${m.descriptor.name}" was not ready after 8s — ` +
      'its notes will be missing from this render',
    )
  }
}

/** Transport stop: silence everything and drop the nodes, because the DAW
    swaps its per-track input buses and our connections are about to dangle. */
/**
 * @param release Discard the plugin instances too, not just silence them.
 *
 * ⚠️ Same split as apolloStopAll, for the same reason: a loop wraparound and a
 * seek happen constantly and only need the plugin QUIET, while discarding it
 * forces the next pass to build the worklet and reload its wasm — main-thread
 * work landing exactly when the transport wants to schedule notes. A stop is
 * the moment to hand those resources back.
 */
export function pluginStopAll(ctx: BaseAudioContext, release = false): void {
  const set = byCtx.get(ctx)
  if (!set) return
  for (const m of [...set]) {
    try { m.node?.port.postMessage({ type: 'panic' } as HostMessage) } catch { /* gone */ }
    if (!release) { m.queue = []; continue }
    try { m.node?.disconnect() } catch { /* gone */ }
    m.node = null
    m.ready = false
    m.queue = []
    set.delete(m)
  }
}

/** Ask a running plugin for its opaque state, so the project can save it. */
export function requestPluginState(
  dest: AudioNode,
  timeoutMs = 1500,
): Promise<string | undefined> {
  const m = byDest.get(dest)
  if (!m?.node || !m.ready) return Promise.resolve(undefined)

  return new Promise(resolve => {
    const node = m.node
    if (!node) { resolve(undefined); return }

    const previous = node.port.onmessage
    const done = (value: string | undefined) => {
      node.port.onmessage = previous
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => done(undefined), timeoutMs)

    node.port.onmessage = (event: MessageEvent<ProcessorMessage>) => {
      if (event.data.type === 'state') { done(event.data.state); return }
      if (previous) previous.call(node.port, event)
    }

    node.port.postMessage({ type: 'requestState' } as HostMessage)
  })
}
