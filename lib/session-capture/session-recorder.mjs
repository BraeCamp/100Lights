// ── Session recorder ─────────────────────────────────────────────────────────
// The isolated capture layer. A session begins when generation starts and ends
// when it completes or aborts. It emits a self-contained artifact directory and
// does NOTHING else — no marketing, publishing, network, or media editing.
//
// Atomicity: everything is written to `<name>.partial/` and renamed to `<name>/`
// on success, or `<name>.failed/` on abort/crash. A watcher never sees a
// half-written directory, and a `.partial` is never left behind.
//
// Crash resilience: events and ROI are appended to JSONL as they occur, and a
// `session.json` header/footer is kept on disk, so the replay CLI can rebuild
// manifest.json even for a run that died mid-flight.

import Ajv from 'ajv'
import { existsSync, mkdirSync, appendFileSync, writeFileSync, renameSync, rmSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { manifestSchema, SCHEMA_VERSION } from './manifest-schema.mjs'
import { fullFrameRect } from './roi.mjs'
import { isEnabled, DEFAULT_ROOT } from './config.mjs'

const ajv = new Ajv({ allErrors: true })
const validate = ajv.compile(manifestSchema)

/** Validate a manifest against the schema. Throws loudly on failure. */
export function validateManifest(manifest) {
  if (!validate(manifest)) {
    throw new Error('session manifest failed schema validation:\n' + ajv.errorsText(validate.errors, { separator: '\n' }))
  }
  return manifest
}

/** Assemble a manifest from a stored header + the raw event/roi logs. Pure — the
 *  replay CLI reuses this to regenerate manifest.json without re-running music gen. */
export function assembleManifest({ header, events, roi }) {
  const fallback = header.roi_fallback ?? fullFrameRect(header.capture)
  return {
    schema_version: SCHEMA_VERSION,
    session_id: header.session_id,
    started_at: header.started_at,
    duration_s: header.duration_s ?? 0,
    capture: header.capture ?? null,
    audio: header.audio ?? null,
    musical: header.musical ?? { bpm: null, key: null, time_signature: null, genre_tags: [], instrument_list: [] },
    generation: header.generation ?? { model: 'unknown', prompt_or_seed: null, total_takes: 0, rejected_takes: 0 },
    events: [...events].sort((a, b) => a.t - b.t),
    roi: [...roi].sort((a, b) => a.t - b.t),
    roi_fallback: fallback,
    outcome: header.outcome ?? 'failed',
  }
}

// Filesystem-safe directory stem from an ISO timestamp (`:` and `.` are unsafe).
const safeStamp = iso => iso.replace(/[:.]/g, '-')

/** A no-op recorder with the full interface, returned when capture is disabled. */
function noopRecorder() {
  const self = {
    enabled: false, dir: null,
    event() { return self }, roi() { return self },
    setMusical() { return self }, setGeneration() { return self },
    setAudio() { return self }, setCapture() { return self },
    writeArtifact() { return self },
    end() { return null }, abort() { return null }, fail() { return null },
    get t() { return 0 },
  }
  return self
}

/**
 * Begin a session. Returns a recorder. Pass { enabled:false } or set
 * SESSION_CAPTURE off to get a no-op with the same shape.
 *
 * @param {object} [opts]
 * @param {string} [opts.root]        output root (default ./sessions)
 * @param {string} [opts.sessionId]   defaults to a random UUID
 * @param {boolean} [opts.enabled]    overrides the env flag
 * @param {boolean} [opts.handleCrashes]  rename to .failed on uncaught crash/SIGINT (default true)
 * @param {number}  [opts.now]        injectable clock start (epoch ms) for tests
 */
export function createSession(opts = {}) {
  const enabled = opts.enabled ?? isEnabled()
  if (!enabled) return noopRecorder()

  const root = opts.root ?? DEFAULT_ROOT
  const clock = opts.clock ?? (() => Date.now())          // injectable for tests
  const t0 = opts.now ?? clock()
  const startedAtIso = new Date(t0).toISOString()
  const sessionId = opts.sessionId ?? randomUUID()

  // One directory per session, named with the UTC timestamp. Disambiguate the
  // rare same-instant collision with a short id suffix so we never clobber.
  mkdirSync(root, { recursive: true })
  let stem = safeStamp(startedAtIso)
  if (existsSync(join(root, stem)) || existsSync(join(root, stem + '.partial')) || existsSync(join(root, stem + '.failed'))) {
    stem += '-' + sessionId.slice(0, 8)
  }
  const partialDir = join(root, stem + '.partial')
  const finalDir = join(root, stem)
  const failedDir = join(root, stem + '.failed')
  mkdirSync(partialDir, { recursive: true })

  const eventsPath = join(partialDir, 'events.jsonl')
  const roiPath = join(partialDir, 'roi.jsonl')
  const headerPath = join(partialDir, 'session.json')

  const events = []
  const roi = []
  /** @type {any} */
  const header = {
    session_id: sessionId,
    started_at: startedAtIso,
    capture: null, audio: null, musical: null, generation: null,
    roi_fallback: null, outcome: null, duration_s: 0,
  }
  let done = false
  const nowT = () => +((clock() - t0) / 1000).toFixed(3)

  const persistHeader = () => writeFileSync(headerPath, JSON.stringify(header, null, 2))
  persistHeader()

  // Guarantee we never leave a `.partial` behind on an unexpected exit.
  let cleanup = null
  const removeHandlers = () => {
    if (!cleanup) return
    process.off('uncaughtException', cleanup.ue)
    process.off('unhandledRejection', cleanup.ur)
    process.off('SIGINT', cleanup.sig)
    process.off('SIGTERM', cleanup.sig)
    cleanup = null
  }
  // outcome ∈ 'completed' | 'aborted' | 'failed'. Directory is `<name>/` only on
  // completion; 'aborted' and 'failed' both land in `<name>.failed/`.
  const finalize = outcome => {
    if (done) return outcome === 'completed' ? finalDir : failedDir
    done = true
    removeHandlers()
    header.outcome = outcome
    header.duration_s = nowT()
    persistHeader()
    const target = outcome === 'completed' ? finalDir : failedDir
    const manifest = assembleManifest({ header, events, roi })
    if (outcome === 'completed') {
      // Validate BEFORE the atomic rename. Fail loudly → land in `.failed`.
      try {
        validateManifest(manifest)
      } catch (err) {
        header.outcome = 'failed'
        persistHeader()
        safeRename(partialDir, failedDir)
        throw err
      }
      writeFileSync(join(partialDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
    } else {
      // Best-effort manifest for aborted/failed runs; if it can't validate we
      // still keep the raw logs so the replay CLI can rebuild it later.
      try { validateManifest(manifest); writeFileSync(join(partialDir, 'manifest.json'), JSON.stringify(manifest, null, 2)) } catch { /* logs suffice */ }
    }
    safeRename(partialDir, target)
    return target
  }

  if (opts.handleCrashes ?? true) {
    const onCrash = () => { try { finalize('failed') } catch { /* already failing */ } }
    cleanup = {
      ue: err => { onCrash(); throw err },
      ur: () => onCrash(),
      sig: () => { onCrash(); process.exit(130) },
    }
    process.on('uncaughtException', cleanup.ue)
    process.on('unhandledRejection', cleanup.ur)
    process.on('SIGINT', cleanup.sig)
    process.on('SIGTERM', cleanup.sig)
  }

  const self = {
    enabled: true,
    dir: partialDir,
    sessionId,
    get t() { return nowT() },

    /** Emit a timestamped event. For take_rejected/retry, payload MUST include
     *  { reason, changed } — enforced by the schema at finalize time. */
    event(type, payload = {}) {
      const e = { t: nowT(), type, payload }
      events.push(e)
      appendFileSync(eventsPath, JSON.stringify(e) + '\n')
      return self
    },
    /** Record the active panel's rect (capture-pixel coords) at this moment. */
    roi(rect) {
      const r = { t: nowT(), x: rect.x, y: rect.y, w: rect.w, h: rect.h, panel: rect.panel ?? 'unknown' }
      roi.push(r)
      appendFileSync(roiPath, JSON.stringify(r) + '\n')
      return self
    },
    setMusical(m) { header.musical = m; persistHeader(); return self },
    setGeneration(g) { header.generation = g; persistHeader(); return self },
    setAudio(a) { header.audio = a; persistHeader(); return self },
    setCapture(c) {
      header.capture = c
      if (!header.roi_fallback) header.roi_fallback = fullFrameRect(c)
      persistHeader()
      return self
    },
    /** Copy an arbitrary artifact into the session dir (e.g. the generated spec). */
    writeArtifact(relPath, data) {
      writeFileSync(join(partialDir, relPath), data)
      return self
    },

    /** Finish successfully: assemble + validate + atomic rename to `<name>/`. */
    end(outcome = 'completed') { return finalize(outcome === 'completed' ? 'completed' : outcome) },
    /** Abort cleanly (user cancelled) → `<name>.failed/`, outcome 'aborted'. */
    abort(reason) { if (reason) self.event('error', { reason: String(reason), aborted: true }); return finalize('aborted') },
    /** Fail on error → `<name>.failed/`, outcome 'failed'. */
    fail(err) { if (err) self.event('error', { reason: err?.message ?? String(err) }); return finalize('failed') },
  }
  return self
}

// Rename that tolerates a pre-existing target (replaces it) and is same-FS atomic
// because `.partial` lives in the same parent as the final directory.
function safeRename(from, to) {
  if (existsSync(to)) rmSync(to, { recursive: true, force: true })
  renameSync(from, to)
}

/**
 * Ingest a COMPLETE session payload in one shot and write the artifact directory
 * atomically. This is the server-side counterpart to createSession(): the browser
 * collects everything live (it can't write the filesystem), then POSTs the logs +
 * media here, and this lands them as `<name>/` (or `<name>.failed/`).
 *
 * @param {object} p
 * @param {string} [p.root]
 * @param {string} [p.sessionId]
 * @param {object} p.header   { started_at, capture, audio, musical, generation, outcome, duration_s, roi_fallback }
 * @param {Array}  [p.events]
 * @param {Array}  [p.roi]
 * @param {Array<{name:string,data:Buffer|Uint8Array|string}>} [p.files]  artifacts to drop in (capture.mp4, final_mix.wav, stems/*)
 * @returns {string} the final directory path
 */
export function ingestSession({ root = DEFAULT_ROOT, sessionId, header = {}, events = [], roi = [], files = [] }) {
  const sid = sessionId || header.session_id || randomUUID()
  const startedAtIso = header.started_at || new Date().toISOString()

  mkdirSync(root, { recursive: true })
  let stem = safeStamp(startedAtIso)
  if (existsSync(join(root, stem)) || existsSync(join(root, stem + '.partial')) || existsSync(join(root, stem + '.failed'))) {
    stem += '-' + sid.slice(0, 8)
  }
  const partialDir = join(root, stem + '.partial')
  const finalDir = join(root, stem)
  const failedDir = join(root, stem + '.failed')
  mkdirSync(partialDir, { recursive: true })

  const fullHeader = {
    session_id: sid,
    started_at: startedAtIso,
    capture: header.capture ?? null,
    audio: header.audio ?? null,
    musical: header.musical ?? null,
    generation: header.generation ?? null,
    roi_fallback: header.roi_fallback ?? fullFrameRect(header.capture),
    outcome: header.outcome ?? 'completed',
    duration_s: header.duration_s ?? 0,
  }

  if (events.length) writeFileSync(join(partialDir, 'events.jsonl'), events.map(e => JSON.stringify(e)).join('\n') + '\n')
  if (roi.length) writeFileSync(join(partialDir, 'roi.jsonl'), roi.map(r => JSON.stringify(r)).join('\n') + '\n')

  for (const f of files) {
    const rel = String(f.name).replace(/^[/\\]+/, '')
    if (!rel || rel.split(/[/\\]/).includes('..')) continue // no path traversal
    const dest = join(partialDir, rel)
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, f.data)
  }

  writeFileSync(join(partialDir, 'session.json'), JSON.stringify(fullHeader, null, 2))

  const manifest = assembleManifest({ header: fullHeader, events, roi })
  const target = fullHeader.outcome === 'completed' ? finalDir : failedDir
  if (fullHeader.outcome === 'completed') {
    try { validateManifest(manifest) } catch (err) { safeRename(partialDir, failedDir); throw err }
    writeFileSync(join(partialDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  } else {
    try { validateManifest(manifest); writeFileSync(join(partialDir, 'manifest.json'), JSON.stringify(manifest, null, 2)) } catch { /* logs suffice */ }
  }
  safeRename(partialDir, target)
  return target
}

/** Read a session dir's stored logs back into { header, events, roi }. */
export function readSessionLogs(dir) {
  const header = JSON.parse(readFileSync(join(dir, 'session.json'), 'utf8'))
  const readJsonl = p => existsSync(p)
    ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
    : []
  return { header, events: readJsonl(join(dir, 'events.jsonl')), roi: readJsonl(join(dir, 'roi.jsonl')) }
}
