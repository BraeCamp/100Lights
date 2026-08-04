// ── Session-capture config · the single on/off flag ─────────────────────────
// The whole layer is disabled by setting SESSION_CAPTURE to a falsy value (or
// passing { enabled: false } to createSession). When off, createSession returns
// a no-op recorder with the same interface, so callers need no branching.

const FALSY = new Set(['0', 'false', 'off', 'no', ''])

/** True unless SESSION_CAPTURE is explicitly falsy. Default: ON. */
export function isEnabled() {
  const v = process.env.SESSION_CAPTURE
  if (v === undefined) return true
  return !FALSY.has(String(v).trim().toLowerCase())
}

/** Default output root; overridable per-session or via SESSION_CAPTURE_ROOT. */
export const DEFAULT_ROOT = process.env.SESSION_CAPTURE_ROOT || './sessions'

/** ROI gaps longer than this (seconds) with no covering rect are a coverage hole. */
export const MAX_ROI_GAP_S = 2
