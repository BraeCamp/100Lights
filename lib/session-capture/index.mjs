// ── Session capture · public interface ───────────────────────────────────────
// Isolated layer that emits a self-contained artifact directory per AI music
// generation run. It ONLY writes artifacts — no marketing, publishing, network,
// or media editing (a separate process consumes the outputs). Disable the whole
// layer with the SESSION_CAPTURE env flag or { enabled:false }.
//
//   import { createSession } from '@/lib/session-capture'
//   const s = createSession({ root: './sessions', sessionId })
//   s.setMusical(...).setGeneration(...)
//   s.event('take_started', { seed })
//   s.event('take_rejected', { reason: '…', changed: '…' })   // reason REQUIRED
//   s.roi({ x, y, w, h, panel })
//   s.end('completed')   // → atomic rename to <name>/  (or .failed/ on abort)

export { createSession, ingestSession, assembleManifest, validateManifest, readSessionLogs } from './session-recorder.mjs'
export { manifestSchema, SCHEMA_VERSION, EVENT_TYPES } from './manifest-schema.mjs'
export { roiGaps, roiIsCovered, fullFrameRect, panelRectToCapture } from './roi.mjs'
export { isEnabled, DEFAULT_ROOT, MAX_ROI_GAP_S } from './config.mjs'
