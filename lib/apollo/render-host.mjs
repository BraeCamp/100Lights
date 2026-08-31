// Running Apollo's real engine in plain Node — no browser, no AudioContext.
//
// Extracted from scripts/apollo-render.mjs, which proved this works and was the
// only thing that could do it. It is pulled out here because three callers want
// it now and a copy would drift: the CLI, the desktop app's background render
// worker, and (later) a server render queue. The engine is the same
// public/apollo/engine.js the browser loads, so what these render and what you
// hear are the same code.
//
// What stays in the CLI: argument parsing, loading samples off disk, the
// listening analysis, and writing a WAV. What lives here is the part that is
// genuinely shared — booting the worklet, handing it a patch, and turning notes
// into audio.

export const SAMPLE_RATE = 48000
const BLOCK = 128

// ── The app's TypeScript, loaded from Node ──────────────────────────────────
//
// Through scripts/lib/ts-import.mjs, which is the shared version of a trick
// three scripts had each implemented privately. It copies a module and
// everything it reaches into one temp ESM directory, rewriting both import
// forms Node cannot resolve — the '@/' alias and extensionless relative paths
// — and caches, so there is exactly ONE instance of patch.ts and presets.ts
// shares its initPatch and uid rather than getting a second.
//
// This file carried its own copy of that loader until the day CI went red for
// want of it elsewhere, which is the argument for not having four.

let modulesPromise = null

/** patch.ts and tables.ts, loaded once per process. */
export function apolloModules() {
  modulesPromise ??= (async () => {
    const { importTs } = await import(new URL('../../scripts/lib/ts-import.mjs', import.meta.url).href)
    // presets.ts is deliberately NOT loaded. It imports `ApolloPatch` as a
    // value rather than with the `type` keyword, so Node's type stripping
    // leaves a named import for something that does not exist at runtime —
    // "does not provide an export named 'ApolloPatch'". The CLI works around
    // that with a stub header; nothing here needs factory presets, so the
    // simpler answer is not to carry the workaround for an unused export.
    const [patchMod, tablesMod] = await Promise.all([
      importTs('lib/apollo/patch.ts'),
      importTs('lib/apollo/tables.ts'),
    ])
    return {
      initPatch: patchMod.initPatch,
      PARAMS: patchMod.PARAMS,
      FX_DEFS: patchMod.FX_DEFS,
      generateFactoryTable: tablesMod.generateFactoryTable,
      buildTableMips: tablesMod.buildTableMips,
    }
  })()
  return modulesPromise
}

// ── The worklet, in Node ────────────────────────────────────────────────────

let engineClassPromise = null

/**
 * The engine class from public/apollo/engine.js.
 *
 * `sampleRate` is a global the engine reads at module scope, so it is fixed for
 * the life of the process — every render in a process shares it. Loaded once:
 * the import is cached anyway, and re-registering the processor would leave the
 * second class dangling.
 */
export function loadEngineClass(source) {
  engineClassPromise ??= (async () => {
    globalThis.sampleRate = SAMPLE_RATE
    globalThis.currentTime = 0
    globalThis.AudioWorkletProcessor = class {
      constructor() {
        // Keep what the engine posts back. It wraps every message handler and
        // every process() call in crash armor that reports faults through this
        // port — so a shim that throws them away turns "the patch was rejected"
        // into "the render is silent for no reason", which is exactly the
        // mystery that has been costing time.
        this.errors = []
        this.port = {
          postMessage: m => { if (m && m.type === 'procError') this.errors.push(m.message) },
          onmessage: null,
        }
      }
    }
    globalThis.registerProcessor = (_name, cls) => { globalThis.__cls = cls }
    // ⚠️ `source` exists for the SERVER. Here in a script this file sits next to
    // the repo and can reach public/apollo/engine.js by relative URL, but a
    // Next server bundle has neither that layout nor a bundler that will follow
    // a computed import — so the route reads the engine itself and hands the
    // text in. Same engine either way; only how it is found differs.
    // ⚠️ new Function, NOT a dynamic import of a data: URL. Turbopack cannot
    // resolve an import whose specifier is computed — "Module not found: Can't
    // resolve <dynamic>" — and it fails the BUILD, not the request. (webpack
    // allowed it, which is why a local `next build` passed and Vercel did not.)
    //
    // Executing the source directly needs no bundler cooperation at all.
    // engine.js is a plain script: no imports, no exports, no top-level await,
    // and one registerProcessor() call at the end, which the shim above catches.
    if (source) new Function(source)()
    else await import(new URL('../../public/apollo/engine.js', import.meta.url).href)
    return globalThis.__cls
  })()
  return engineClassPromise
}

/** Replicates engine-client's lfoLutFromPoints. */
export function lutFromPoints(points, size = 257) {
  const lut = new Float32Array(size)
  const pts = points?.length ? [...points].sort((a, b) => a.x - b.x) : [{ x: 0, y: 0, curve: 0 }, { x: 1, y: 1, curve: 0 }]
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
    if (c !== 0) { const k = Math.pow(4, Math.abs(c) * 2); t = c > 0 ? Math.pow(t, k) : 1 - Math.pow(1 - t, k) }
    lut[i] = p0.y + (p1.y - p0.y) * t
  }
  return lut
}

/**
 * Boot a processor for one patch and hand back something that renders notes.
 *
 * Mirrors ApolloEngine.renderToBuffer: ranges, wavetables, then the LFO and
 * remap lookup tables, then the patch itself. Order matters — the engine sizes
 * things from `ranges` and resolves table ids when the patch lands.
 */
export async function createRenderHost({ patch, bpm, playing = false, seed = 1, modules, engineSource } = {}) {
  // `modules` and `engineSource` are the server's way in. apolloModules() reads
  // the app's TypeScript off disk through ts-import, which is right for a script
  // and impossible in a deployed function, where only compiled JS exists — so a
  // caller that already HAS these (a Next route imports patch.ts directly) hands
  // them over instead.
  const [Cls, mods] = await Promise.all([
    loadEngineClass(engineSource),
    modules ?? apolloModules(),
  ])
  const { PARAMS, FX_DEFS, generateFactoryTable, buildTableMips } = mods

  const proc = new Cls()
  const post = m => proc.onMessage(m)

  const ranges = {}
  for (const pd of PARAMS) ranges[pd.path] = [pd.min, pd.max]
  const collectFx = units => {
    for (const u of units || []) {
      ranges[`fx.${u.id}.mix`] = [0, 1]
      for (const pp of (FX_DEFS[u.type]?.params || [])) ranges[`fx.${u.id}.${pp.key}`] = [pp.min, pp.max]
      if (u.chains) u.chains.forEach(collectFx)
    }
  }
  collectFx(patch.fxMain); collectFx(patch.fxBus1); collectFx(patch.fxBus2)
  post({ type: 'ranges', ranges })

  for (const id of new Set(patch.oscs.map(o => o.wt.tableId))) {
    const user = patch.userTables?.[id]
    if (user) {
      const raw = Buffer.from(user.data, 'base64')
      const d = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)
      post({ type: 'table', id, frames: user.frames, data: new Float32Array(d), mips: buildTableMips(new Float32Array(d), user.frames) })
    } else {
      const t = generateFactoryTable(id)
      if (t) post({ type: 'table', id, frames: t.frames, data: t.data, mips: buildTableMips(t.data, t.frames) })
    }
  }

  patch.lfos.forEach((lfo, i) => post({
    type: 'lfoLut', index: i,
    main: lutFromPoints(lfo.points),
    y: lfo.mode === 'path' ? lutFromPoints(lfo.pathPoints) : null,
  }))
  patch.oscs.forEach((osc, i) => { if (osc.wt.remapCurve?.length) post({ type: 'remapLut', key: `osc${i}`, lut: lutFromPoints(osc.wt.remapCurve) }) })
  for (const row of patch.matrix) if (row.curve?.length) post({ type: 'remapLut', rowId: row.id, lut: lutFromPoints(row.curve) })

  /** Everything above happens before samples and the patch, which the caller
   *  posts itself — the CLI reads samples off disk, a worker gets them as data,
   *  and neither belongs in here. */
  const finish = () => {
    post({ type: 'patch', patch })
    if (bpm || playing) post({ type: 'transport', playing: !!playing, bpm: bpm ?? patch.global.bpm })
  }

  /**
   * Render `notes` for `seconds`, in stereo.
   * Notes are `{ note, t, dur, vel }` with times in SECONDS.
   */
  const render = (notes, seconds) => {
    // Put the engine's shared randomness back to a known state, HERE rather
    // than when the host was created.
    //
    // The global RNG every voice draws from, and the serial counter that seeds
    // each voice, live at module scope and advance as notes play — so a second
    // render in the same process differs from the first, measured at 0.65
    // peak-to-peak on one note, and the reason offline renders of a project
    // drift run to run. Resetting at creation is not enough: a worker builds
    // hosts up front and renders later, so another host's render moves the
    // generator in between. Resetting per render is the only point at which
    // "the same input gives the same audio" is actually true — which is the
    // whole premise of caching renders.
    post({ type: 'reseed', seed })
    const totalBlocks = Math.ceil(seconds * SAMPLE_RATE / BLOCK)
    const events = (notes ?? []).flatMap(n => [
      { t: n.t, type: 'on', note: n.note, vel: n.vel ?? 0.9 },
      { t: n.t + n.dur, type: 'off', note: n.note },
    ]).sort((a, b) => a.t - b.t)

    const outL = new Float32Array(totalBlocks * BLOCK)
    const outR = new Float32Array(totalBlocks * BLOCK)
    let evIdx = 0
    for (let b = 0; b < totalBlocks; b++) {
      const tNow = b * BLOCK / SAMPLE_RATE
      while (evIdx < events.length && events[evIdx].t <= tNow) {
        const ev = events[evIdx++]
        if (ev.type === 'on') proc.noteOn(ev.note, ev.vel, false)
        else proc.noteOff(ev.note, false)
      }
      const L = new Float32Array(BLOCK), R = new Float32Array(BLOCK)
      globalThis.currentTime = tNow
      proc.process([], [[L, R]])
      outL.set(L, b * BLOCK); outR.set(R, b * BLOCK)
    }
    return { left: outL, right: outR, sampleRate: SAMPLE_RATE }
  }

  /** Anything the engine complained about. Empty is the expected state. */
  const errors = () => proc.errors ?? []

  return { proc, post, finish, render, errors }
}
