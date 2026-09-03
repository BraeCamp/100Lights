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
  by: 'local' | 'assistant' | 'learned'
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
 * The last few exchanges, as one line each, for the assistant to read.
 *
 * ⚠️ Brae: "We probably need it to remember the last 5 or 10 commands too so
 * that it knows the context. This is especially important because it answers in
 * a way that asks for specifics then doesn't know what to do when I give them
 * because it forgets."
 *
 * The conversation array the assistant already receives is cleared the moment a
 * command succeeds, deliberately: replaying a tool_use turn into the next
 * sentence would need its results alongside it, and a conversation carrying one
 * without the other is rejected outright. So every finished command left no
 * trace, and "make that one louder too" had no "that one" to point at.
 *
 * This is the missing half, and it sidesteps that problem by not being
 * conversation at all — just a few lines of plain text saying what was asked
 * and what happened. It goes in AFTER the cached prefix, next to the song
 * state, so it costs a few dozen tokens and no cache hit.
 *
 * Old exchanges are worse than none: a command from this morning is not context
 * for this sentence, it is a red herring. Hence the window.
 */
/** Commands that carry nothing a later sentence could refer back to. "Stop"
 *  is not a "that", and every line here is paid for on every turn. */
const NO_REFERENT = new Set(['transport', 'metronome'])

export function recentContext(n = 10, withinMs = 10 * 60_000): string {
  load()
  const cutoff = Date.now() - withinMs
  const lines = ring
    .filter(e => e.t >= cutoff && !e.undone)   // an undone edit is a wrong example
    // ⚠️ Sent UNCACHED on every assistant turn, at full price. A session's
    // "play", "stop", "stop", "play" lines were a fifth of a turn's input and
    // could never resolve "that one" or "the same again".
    .filter(e => !(e.calls.length && e.calls.every(c => NO_REFERENT.has(c.name))))
    .slice(-n)
    .map(e => {
      const said = e.said.length > 90 ? e.said.slice(0, 88) + '…' : e.said
      const outcome = e.failed ? `failed: ${e.failed}`
        : e.asked ? `asked back: ${e.asked}`
        : e.said_back || (e.calls.length ? e.calls.map(c => c.name).join(', ') : 'nothing')
      const short = outcome.length > 90 ? outcome.slice(0, 88) + '…' : outcome
      return `- "${said}" → ${short}`
    })
  return lines.join('\n')
}

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

/**
 * Every command in this session, and what became of each — as text.
 *
 * ⚠️ Brae: "I put a bunch of commands in and they almost all failed. Can you
 * figure out what the problems were for each of them and tell me what they
 * were so that I can understand the errors?"
 *
 * The answer was already recorded and unreadable. __voiceMemory() has returned
 * the raw exchanges all along, but twenty of those as JSON is not something
 * anybody reads, and the server-side gaps table had exactly one row in it — so
 * a session full of failures left nothing anyone could look at, which is why
 * every round of this has been guesswork.
 *
 * Each line says what was SAID, what happened, and — the part that matters —
 * WHICH KIND of failure it was, because the four kinds have completely
 * different fixes:
 *
 *   not-heard      the transcript is wrong; nothing downstream could help
 *   not-understood no tool was chosen; the request has no home yet
 *   wrong-action   a tool ran and was undone; it chose badly
 *   refused        it understood and declined, and said why
 *   asked-back     it needed something more before acting
 */
export function voiceReport(n = 30): string {
  load()
  const rows = ring.slice(-n)
  if (!rows.length) return 'No commands recorded yet.'

  const kindOf = (e: VoiceExchange): string => {
    if (e.failed) return 'refused'
    if (e.undone) return 'wrong-action'
    if (e.asked) return 'asked-back'
    if (!e.calls.length) return e.heard < 0.6 ? 'not-heard' : 'not-understood'
    // ⚠️ THE HARDEST KIND: it ran, reported success, and did the wrong thing.
    // Nothing downstream can know that unless the user undoes it — which is why
    // a session somebody describes as "almost all failed" can look clean here.
    //
    // One shape of it IS detectable, and it is the one Brae hit: an edit that
    // also moved the transport. "Change reverb so it stays at 100% until the
    // 6th bar" became set_effect plus a jump to bar 6, because the bar number
    // read as a destination. Asking for an edit and getting a playhead move
    // alongside it is nearly always that mistake.
    const names = e.calls.map(c => c.name)
    if (names.length > 1 && names.includes('transport')
        && names.some(n => n !== 'transport')) return 'moved-playhead-too'
    return 'ok'
  }

  const lines: string[] = []
  const tally = new Map<string, number>()
  for (const e of rows) {
    const kind = kindOf(e)
    tally.set(kind, (tally.get(kind) ?? 0) + 1)
    const mark = kind === 'ok' ? '\u2713' : kind === 'moved-playhead-too' ? '?' : '\u2717'
    const when = new Date(e.t).toISOString().slice(11, 19)
    lines.push(`${mark} [${kind}] ${when}  "${e.said}"`)
    const bits: string[] = [
      `heard ${e.heard.toFixed(2)}`,
      e.by,
      e.matched ? `rule ${e.matched}` : 'no rule',
      e.calls.length ? `called ${e.calls.map(c => c.name).join(', ')}` : 'called nothing',
    ]
    lines.push(`    ${bits.join(' \u00b7 ')}`)
    const answer = e.failed || e.asked || e.said_back
    if (answer) lines.push(`    said: "${String(answer).slice(0, 160)}"`)
  }

  const summary = [...tally.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${v} ${k}`)
    .join(', ')
  // ⚠️ Said plainly, because a clean-looking report is exactly what made this
  // hard to chase: "ok" means it ran without complaining, NOT that it did what
  // was meant. Pressing undo is what turns one into wrong-action.
  return `${rows.length} commands: ${summary}\n`
    + `("ok" means it ran without error, not that it did what you meant — `
    + `undo marks one as wrong-action.)\n\n${lines.join('\n')}`
}

// Ungated, like the other diagnostics on this path: the whole value is being
// able to look at what has accumulated during ordinary use, and a hook that
// only exists on a developer's machine records nothing worth having.
if (typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__voiceMemory = Object.assign(
    () => allExchanges(),
    { all: allExchanges, queue: learningQueue, stats: voiceStats, clear: clearVoiceMemory,
      // The one to run when something went wrong: readable, and short
      // enough to paste to somebody who can act on it.
      report: (n?: number) => voiceReport(n) },
  )
}
