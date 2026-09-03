'use client'
// ── The studio's flight recorder ────────────────────────────────────────────
//
// Brae: "Loading seems to have lots of errors. Can we have all of those
// rendering errors load to a part of the program that you can access and use
// whenever I have you correct?"
//
// Yes, and it is overdue. Almost every bug in this area has cost a round trip
// for the same reason: the failure leaves no trace. A render comes back silent
// and is discarded; a preset resolves to nothing and its notes are dropped; a
// worklet throws and the armour swallows it. By the time anyone looks, the only
// evidence is "it sounds wrong", and the next step is always to build a
// one-off probe to reproduce something that already happened.
//
// So: everything that goes wrong is written down, kept across reloads, and
// readable three ways —
//
//   window.__diag()          in the console, right now
//   __dawDiagnose().journal  inside the report Brae already pastes
//   .diag/errors.jsonl       on disk, when running locally, so it can be read
//                            directly without asking anyone to copy anything
//
// It is a RING, not a growing log: the last N events, capped, so it can never
// become the thing that fills the disk or the quota.

export type DiagKind =
  | 'error'         // an exception that reached the top
  | 'rejection'     // an unhandled promise rejection
  | 'console'       // console.error / console.warn
  | 'render'        // an offline render: started, finished, failed, silent
  | 'load'          // project/sample/preset loading
  | 'audio'         // the audio thread: worklet errors, dropouts
  | 'note'          // something deliberate worth recording

export interface DiagEvent {
  /** Wall clock, so events line up with what someone saw. */
  t: number
  /** Seconds since the page opened — usually the more useful axis. */
  at: number
  kind: DiagKind
  msg: string
  /** Anything structured worth keeping. Kept small; this is a log, not a dump. */
  data?: unknown
}

const MAX = 400
const KEY = 'contentforge-diag-v1'
const ring: DiagEvent[] = []
const started = Date.now()
let installed = false

/** Round-trip through JSON so a live AudioBuffer or DOM node can never be
 *  retained by the log, and so the on-disk copy is exactly what is in memory. */
function safe(data: unknown): unknown {
  if (data === undefined) return undefined
  try {
    const s = JSON.stringify(data, (_k, v) => {
      if (typeof v === 'number' && !Number.isFinite(v)) return String(v)
      if (v instanceof Error) return { name: v.name, message: v.message }
      if (ArrayBuffer.isView(v) || v instanceof ArrayBuffer) return `[binary ${(v as ArrayBufferView).byteLength ?? 0}B]`
      return v
    })
    return s.length > 4000 ? JSON.parse(s.slice(0, 0) || '{}') : JSON.parse(s)
  } catch { return String(data).slice(0, 400) }
}

/** Write one event down. Never throws — a broken logger must not break audio. */
export function diag(kind: DiagKind, msg: string, data?: unknown): void {
  try {
    const e: DiagEvent = {
      t: Date.now(), at: +((Date.now() - started) / 1000).toFixed(2),
      kind, msg: String(msg).slice(0, 400), data: safe(data),
    }
    ring.push(e)
    if (ring.length > MAX) ring.splice(0, ring.length - MAX)
    persist(e)
  } catch { /* the recorder is never the reason anything fails */ }
}

/** Everything recorded this session. */
export function diagEvents(): DiagEvent[] { return ring.slice() }

/** Just the bad news, which is what a report usually wants. */
export function diagTrouble(): DiagEvent[] {
  return ring.filter(e => e.kind === 'error' || e.kind === 'rejection' || e.kind === 'console'
    || /fail|silent|stall|drop|missing|unable|could not/i.test(e.msg))
}

export function diagClear(): void {
  ring.length = 0
  try { localStorage.removeItem(KEY) } catch { /* private mode */ }
}

// ── Keeping it across a reload ──────────────────────────────────────────────
// localStorage rather than IndexedDB on purpose: this has to survive the very
// failures being recorded, and IndexedDB is one of the things that goes wrong
// (a connection that is closing throws on every transaction). A few hundred
// short rows is well inside the quota.
let flushTimer: ReturnType<typeof setTimeout> | null = null
function persist(e: DiagEvent): void {
  void e
  if (flushTimer || typeof localStorage === 'undefined') return
  flushTimer = setTimeout(() => {
    flushTimer = null
    try { localStorage.setItem(KEY, JSON.stringify(ring.slice(-MAX))) } catch { /* full or private */ }
  }, 400)
}

/** What the previous session left behind — the crash you cannot reproduce. */
export function diagPrevious(): DiagEvent[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as DiagEvent[]) : []
  } catch { return [] }
}

// ── The disk sink ───────────────────────────────────────────────────────────
// Only when the studio is running locally with hooks on, which is how it is
// tested. It means a failing run leaves a file that can simply be read, instead
// of a person being asked to copy a console. Fire-and-forget and batched; it
// must never sit in front of anything the user is waiting for.
let pending: DiagEvent[] = []
let sinkTimer: ReturnType<typeof setTimeout> | null = null
function toDisk(e: DiagEvent): void {
  if (!SINK_ON) return
  pending.push(e)
  if (sinkTimer) return
  sinkTimer = setTimeout(() => {
    sinkTimer = null
    const batch = pending; pending = []
    void fetch('/api/diag', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events: batch }), keepalive: true,
    }).catch(() => { /* no sink here; the in-page log is still complete */ })
  }, 1000)
}

const SINK_ON = typeof window !== 'undefined'
  && (process.env.NODE_ENV === 'development' || process.env.NEXT_PUBLIC_DAW_HOOKS === '1')
  && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)

/**
 * Start recording. Idempotent, and safe to call from anywhere in the client.
 *
 * console.error is WRAPPED rather than replaced: everything still reaches the
 * real console, it is only also written down. A logger that swallowed output
 * would make debugging worse, not better.
 */
export function installDiag(): void {
  if (installed || typeof window === 'undefined') return
  installed = true

  window.addEventListener('error', ev => {
    diag('error', ev.message || 'window error', {
      source: ev.filename ? `${ev.filename}:${ev.lineno}:${ev.colno}` : undefined,
      stack: ev.error instanceof Error ? String(ev.error.stack).slice(0, 600) : undefined,
    })
  })
  window.addEventListener('unhandledrejection', ev => {
    const r = ev.reason
    diag('rejection', r instanceof Error ? r.message : String(r).slice(0, 300), {
      stack: r instanceof Error ? String(r.stack).slice(0, 600) : undefined,
    })
  })

  for (const level of ['error', 'warn'] as const) {
    const original = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      original(...args)
      try {
        const msg = args.map(a => (a instanceof Error ? a.message : typeof a === 'string' ? a : '')).join(' ').trim()
        // The recorder's own output must not feed itself.
        if (msg && !msg.startsWith('[diag]')) diag('console', `${level}: ${msg}`)
      } catch { /* never break logging */ }
    }
  }

  ;(window as unknown as Record<string, unknown>).__diag = Object.assign(
    () => diagEvents(),
    {
      all: diagEvents,
      trouble: diagTrouble,
      previous: diagPrevious,
      clear: diagClear,
      /** One string, ready to paste. */
      text: () => diagEvents().map(e => `${e.at.toFixed(2)}s ${e.kind}: ${e.msg}${e.data ? ' ' + JSON.stringify(e.data) : ''}`).join('\n'),
    },
  )
  diag('note', 'diagnostics recording started')
}

// Send to disk as well as to memory. Kept separate from diag() so the ring is
// filled even if the sink is off or fails.
const _push = ring.push.bind(ring)
ring.push = ((...items: DiagEvent[]) => {
  for (const i of items) toDisk(i)
  return _push(...items)
}) as typeof ring.push
