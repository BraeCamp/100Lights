'use client'
// ── Turning normal use into training data ───────────────────────────────────
//
// Brae: "have it remember its responses to questions and statements ... this
// way we turn normal use into learning."
//
// Every command is a labelled example whether or not anyone writes it down:
// somebody said a sentence, something turned it into edits, and then the person
// either kept the result or undid it. That last part is the label, and it is
// free — it is the difference between a corpus and a pile of transcripts.
//
// What this records, per exchange:
//
//   what was SAID       the corrected sentence, and the raw alternatives
//   how well it was HEARD   the recogniser's own confidence
//   who ANSWERED        the local resolver, or the assistant
//   what it BECAME      the VoiceCall[] — the same shape either way, which is
//                       what makes them comparable at all
//   what HAPPENED       accepted, or undone within a few seconds
//
// The point of recording the assistant's answers specifically: each one is a
// worked example of a sentence local-resolve.ts could not handle. Sorted by
// frequency, that list IS the build order for replacing it — the phrasings
// people actually use, ranked by how often they use them, rather than the ones
// anybody guessed at.
//
// Kept local. This is a person's working habits and their song; it belongs on
// their machine unless they choose otherwise, and everything useful can be done
// with it there.

import type { VoiceCall } from './execute-music'

export interface VoiceExchange {
  t: number
  /** The sentence acted on, after name repair. */
  said: string
  /** What the recogniser offered before repair — the raw material. */
  alternatives?: string[][]
  /** The recogniser's own 0–1 rating of what it heard. */
  heard: number
  /** Which resolver produced the calls. */
  by: 'local' | 'assistant'
  /** Why local fired, or why it declined. */
  matched: string
  /** Local's own 0–1 rating of its answer. 0 when it declined. */
  understood: number
  /** The commands — identical in shape whichever resolver produced them. */
  calls: VoiceCall[]
  /** What the studio said back. */
  said_back?: string
  /** The assistant asked something instead of acting. */
  asked?: string
  /** Set later: the edit was undone shortly after, so this example is a bad one. */
  undone?: boolean
  /** Set later: nothing happened — a refusal or a failure. */
  failed?: string
}

const KEY = 'beacon.voice.memory.v1'
const MAX = 500
const ring: VoiceExchange[] = []
let loaded = false

function load(): void {
  if (loaded) return
  loaded = true
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) ring.push(...(JSON.parse(raw) as VoiceExchange[]))
  } catch { /* private mode, or a corrupt entry — start fresh */ }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
function save(): void {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    try { localStorage.setItem(KEY, JSON.stringify(ring.slice(-MAX))) } catch { /* full */ }
  }, 500)
}

/** Write down one exchange. Returns its index so the outcome can be added. */
export function remember(e: Omit<VoiceExchange, 't'>): number {
  load()
  ring.push({ ...e, t: Date.now() })
  if (ring.length > MAX) ring.splice(0, ring.length - MAX)
  save()
  // Mirror into the diagnostics journal, which already reaches the disk when
  // running locally — so a session's commands can be read without asking
  // anyone to export anything.
  void import('@/lib/diag-journal')
    .then(m => m.diag('note', `voice: ${e.by} — ${e.said}`, { matched: e.matched, heard: e.heard, calls: e.calls.map(c => c.name) }))
    .catch(() => {})
  return ring.length - 1
}

/**
 * Mark the most recent exchange as undone.
 *
 * This is the label that makes the rest worth keeping. An undo within a few
 * seconds of a command is the clearest signal available that the interpretation
 * was wrong — nobody undoes an edit they asked for and got.
 */
export function markUndone(withinMs = 12_000): void {
  load()
  const last = ring[ring.length - 1]
  if (last && Date.now() - last.t < withinMs) { last.undone = true; save() }
}

/** Mark the most recent exchange as having produced nothing. */
export function markFailed(why: string): void {
  load()
  const last = ring[ring.length - 1]
  if (last) { last.failed = why.slice(0, 200); save() }
}

export function allExchanges(): VoiceExchange[] { load(); return ring.slice() }

/**
 * What the assistant is being asked that the local resolver cannot do.
 *
 * The build order for replacing it, in the order the answer matters: grouped by
 * the commands produced, most-used first, with the real phrasings attached. A
 * group with many different phrasings and one call is a rule waiting to be
 * written; a group with one phrasing seen once is not worth the risk.
 */
export function learningQueue(): {
  calls: string
  count: number
  phrasings: string[]
  everUndone: boolean
}[] {
  load()
  const groups = new Map<string, { count: number; phrasings: Set<string>; undone: boolean }>()
  for (const e of ring) {
    if (e.by !== 'assistant' || !e.calls.length || e.failed) continue
    const key = e.calls.map(c => c.name).join(' + ')
    const g = groups.get(key) ?? { count: 0, phrasings: new Set<string>(), undone: false }
    g.count++
    g.phrasings.add(e.said)
    if (e.undone) g.undone = true
    groups.set(key, g)
  }
  return [...groups.entries()]
    .map(([calls, g]) => ({
      calls, count: g.count, phrasings: [...g.phrasings].slice(0, 12), everUndone: g.undone,
    }))
    .sort((a, b) => b.count - a.count)
}

/** How the two resolvers are doing against each other. */
export function voiceStats(): {
  total: number; local: number; assistant: number
  localShare: number; undone: number; failed: number
} {
  load()
  const total = ring.length
  const local = ring.filter(e => e.by === 'local').length
  return {
    total, local, assistant: total - local,
    localShare: total ? +(local / total).toFixed(3) : 0,
    undone: ring.filter(e => e.undone).length,
    failed: ring.filter(e => e.failed).length,
  }
}

export function clearVoiceMemory(): void {
  load(); ring.length = 0
  try { localStorage.removeItem(KEY) } catch { /* private mode */ }
}

// Ungated, like the other diagnostics on this path: the whole value is being
// able to look at what has accumulated during ordinary use, and a hook that
// only exists on a developer's machine records nothing worth having.
if (typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__voiceMemory = Object.assign(
    () => allExchanges(),
    { all: allExchanges, queue: learningQueue, stats: voiceStats, clear: clearVoiceMemory },
  )
}
