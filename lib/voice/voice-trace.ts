'use client'
// A flight recorder for what the assistant DOES.
//
// Brae: "Let's implement something that records how the AI interacts with the
// program so that we can see what it is doing with what commands."
//
// ⚠️ voice-memory ALREADY RECORDS THE OUTCOME, and it is not enough. It knows
// what was said, which tools were named and what came back at the end — the
// shape of the conversation. It does not know what happened INSIDE: the
// arguments each tool was given, what the studio answered, whether the model
// tried again, or what actually changed in the song.
//
// That gap is why "it said reverb at 100% and moved the playhead" took a human
// noticing. From the outside it was one line saying two tools ran. From in
// here it is: set_effect{track:"pad",effect:"reverb",amount:100} → "already at
// 100%", transport{bar:6} → "bar 6", and the mistake is legible.
//
// ⚠️ ARGUMENTS ARE THE POINT. A tool NAME tells you almost nothing — set_effect
// is right for "more reverb" and wrong for "keep reverb up until bar 6", and
// only the arguments and the reply distinguish them.

/** One tool call, what it was given, and what the studio said back. */
export interface TraceCall {
  name: string
  input: unknown
  /** What the executor answered — the same text the model was handed. */
  result: string
  ok: boolean
}

/** One turn of the assistant loop. */
export interface TraceTurn {
  n: number
  calls: TraceCall[]
  /** Reducer actions actually dispatched — what CHANGED, as opposed to what
   *  was asked for. An empty list beside a successful call is a no-op. */
  actions: string[]
}

export interface Trace {
  t: number
  said: string
  turns: TraceTurn[]
  /** What was said back at the end. */
  say: string
  /** Why it stopped, if it stopped badly. */
  problem: string
  ms: number
}

const KEY = 'beacon.voice.trace.v1'
// ⚠️ Small on purpose. This holds full tool ARGUMENTS, which are far heavier
// than voice-memory's rows, and it is written during playback — the one time
// this app has no main-thread budget to spare. Fifty is enough to explain a
// session and small enough to serialise without being noticed.
const MAX = 50

const traces: Trace[] = []
let loaded = false
let current: Trace | null = null

function load(): void {
  if (loaded) return
  loaded = true
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) traces.push(...(JSON.parse(raw) as Trace[]))
  } catch { /* private mode, or a corrupt entry — start fresh */ }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
function save(): void {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    try { localStorage.setItem(KEY, JSON.stringify(traces.slice(-MAX))) } catch { /* full */ }
  }, 800)
}

/** A sentence has been handed to the assistant. */
export function traceStart(said: string): void {
  load()
  current = { t: Date.now(), said, turns: [], say: '', problem: '', ms: 0 }
}

/** One turn's tool calls, their answers, and what they changed. */
export function traceTurn(n: number, calls: TraceCall[], actions: string[]): void {
  if (!current) return
  current.turns.push({ n, calls, actions })
}

/** The assistant is done with this sentence. */
export function traceEnd(say: string, problem = ''): void {
  if (!current) return
  current.say = say
  current.problem = problem
  current.ms = Date.now() - current.t
  traces.push(current)
  if (traces.length > MAX) traces.splice(0, traces.length - MAX)
  current = null
  save()
}

export function allTraces(): Trace[] { load(); return traces.slice() }

export function clearTraces(): void {
  load(); traces.length = 0
  try { localStorage.removeItem(KEY) } catch { /* private mode */ }
}

/** Trim a value for display without hiding what it was. */
function brief(v: unknown): string {
  if (v == null) return ''
  try {
    const s = typeof v === 'string' ? v : JSON.stringify(v)
    return s.length > 120 ? s.slice(0, 118) + '…' : s
  } catch { return String(v) }
}

/**
 * The session, as something a person can read.
 *
 * Each command, each turn, each call with its arguments and the answer, and
 * what actually changed. The last line of each is the one that usually
 * explains it — a call that succeeded while changing nothing.
 */
export function traceReport(n = 15): string {
  load()
  const rows = traces.slice(-n)
  if (!rows.length) return 'No assistant activity recorded yet. Say something with the assistant on.'

  const out: string[] = []
  for (const tr of rows) {
    out.push(`\n"${tr.said}"   ${new Date(tr.t).toISOString().slice(11, 19)} · ${tr.ms}ms · ${tr.turns.length} turn${tr.turns.length === 1 ? '' : 's'}`)
    for (const turn of tr.turns) {
      for (const c of turn.calls) {
        out.push(`   ${c.ok ? '→' : '✗'} ${c.name}(${brief(c.input)})`)
        out.push(`       ${c.result}`)
      }
      // ⚠️ The tell for a command that "worked" and did nothing.
      out.push(turn.actions.length
        ? `   changed: ${turn.actions.join(', ')}`
        : `   changed: NOTHING`)
    }
    if (tr.problem) out.push(`   stopped: ${tr.problem}`)
    else if (tr.say) out.push(`   said: "${tr.say}"`)
  }
  return `${rows.length} assistant commands (newest last):\n${out.join('\n')}`
}

// Ungated, like the other diagnostics here: a recorder that only exists on a
// developer's machine records nothing worth having.
if (typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__voiceTrace = Object.assign(
    () => traceReport(),
    { report: traceReport, all: allTraces, clear: clearTraces },
  )
}
