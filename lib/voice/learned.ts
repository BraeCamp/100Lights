'use client'
// ── What the assistant worked out once, the program keeps ────────────────────
//
// Brae: "how else can we combine the program with the AI to make idle and
// simple commands cheaper for voice control".
//
// The ladder already runs local-rules → assistant. What it never had was a way
// DOWN: a sentence the rules could not read went to the model, and went to the
// model again the next time, and the time after that. The same eight or ten
// phrasings get said all day in a session — "drop the pad back a bit", "give the
// hats some swing" — and each one was a fresh round trip to work out an answer
// that had already been worked out.
//
// ⚠️ WHAT IS STORED IS THE CALL, NOT THE RESULT. `VoiceCall[]` — `{ name,
// input }` — is the swap point local-resolve already documents: planVoiceCalls
// takes it without caring whether a model or a parser produced it, and resolves
// the names against the song AS IT IS NOW. So a remembered "mute the pad" mutes
// whatever the pad is today, in a different song, after the track was renamed
// and renamed back. Caching the ACTIONS would freeze a track id and quietly act
// on the wrong thing months later; caching the call cannot.
//
// The useful consequence is that this survives the assistant being off, and
// survives running out of Lumens. Anything taught once keeps working for free.

import type { VoiceCall } from './execute-music'

export interface LearnedEntry {
  /** The normalised sentence — the key. */
  text: string
  calls: VoiceCall[]
  /** When it was taught, and how often it has paid off since. */
  at: number
  used: number
}

const KEY = 'light.learned.v1'
/** Enough for a long session's vocabulary; the least-used go first. */
const MAX = 300

/**
 * The same sentence said twice is rarely the same string. "Okay, mute the pad."
 * and "mute the pad" are one command, and a cache that misses on the filler word
 * is a cache that never hits — the exact failure the anchored regular
 * expressions in ./interpret were replaced for.
 */
export function normalise(text: string): string {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}%\s]/gu, ' ')
    .replace(/\b(um+|uh+|er+|okay|ok|so|now|please|could you|can you|would you|i want you to|i need you to)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * ⚠️ WORDS WHOSE MEANING IS NOT IN THE WORDS. "do that again", "put it here",
 * "the same on this one" — every one of them resolves against the selection or
 * the playhead at the moment it was said. Replaying the stored call would apply
 * yesterday's target to today's selection, which is the one way this cache
 * could do something the person did not ask for.
 *
 * They are cheap to spot and rare enough that refusing to learn them costs
 * almost nothing, so they are never stored.
 */
const DEICTIC = /\b(this|that|these|those|it|its|them|they|here|there|again|same|current|selected|previous|last|next)\b/

/**
 * Is this call fully determined by the sentence that produced it?
 *
 * ⚠️ NUMBERS ARE THE STALE ONES. A name is resolved against the live song by
 * planVoiceCalls, so "pad" is safe however the song changes. A number often is
 * not: when the model answers "add four bars at the end" it may compute an
 * absolute beat from the song as it stood, and that number means somewhere else
 * tomorrow. So a numeric input is only trusted when the person actually said
 * that number — then it is a fact about the sentence, not about the song.
 */
function determinedBySentence(text: string, calls: VoiceCall[]): boolean {
  const said = normalise(text)
  const spoken: Record<string, number> = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
    nine: 9, ten: 10, eleven: 11, twelve: 12, sixteen: 16, twenty: 20, thirty: 30,
    forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
  }
  const saidNumbers = new Set<number>()
  for (const m of said.matchAll(/\d+(?:\.\d+)?/g)) saidNumbers.add(Number(m[0]))
  for (const [word, n] of Object.entries(spoken)) {
    if (new RegExp(`\\b${word}\\b`).test(said)) saidNumbers.add(n)
  }

  const ok = (v: unknown): boolean => {
    if (v == null || typeof v === 'boolean' || typeof v === 'string') return true
    if (typeof v === 'number') return saidNumbers.has(v)
    if (Array.isArray(v)) return v.every(ok)
    if (typeof v === 'object') return Object.values(v as Record<string, unknown>).every(ok)
    return false
  }
  return calls.every(c => Object.values(c.input ?? {}).every(ok))
}

// ── the store ───────────────────────────────────────────────────────────────
//
// Kept in memory and mirrored to localStorage, which can throw (private mode,
// blocked site data) and must never take the voice control down with it — the
// cache going away costs money, not correctness.

let mem: LearnedEntry[] | null = null
let hits = 0
let misses = 0

function load(): LearnedEntry[] {
  if (mem) return mem
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : []
    mem = Array.isArray(parsed) ? parsed.filter(e => e && typeof e.text === 'string' && Array.isArray(e.calls)) : []
  } catch { mem = [] }
  return mem
}

function save(): void {
  try { localStorage.setItem(KEY, JSON.stringify(mem ?? [])) } catch { /* nothing to keep it in */ }
}

/** The calls this sentence produced last time, or null to go and ask. */
export function recallCommand(text: string): VoiceCall[] | null {
  const key = normalise(text)
  if (!key) return null
  const found = load().find(e => e.text === key)
  if (!found) { misses++; return null }
  hits++
  found.used++
  found.at = Date.now()
  save()
  // A copy, because the caller hands these to a planner that is free to keep
  // them, and a stored entry must not change shape after the fact.
  return found.calls.map(c => ({ name: c.name, input: { ...c.input } }))
}

/**
 * ⚠️ NEVER LEARN A COMMAND THAT TAKES SOMETHING AWAY. The rules ask before
 * anything destructive runs, and that confirmation is keyed to a flag the model
 * does not send — so a remembered delete would be the one path into the studio
 * that removes a track without asking. Cheap to refuse, and nobody says "delete
 * the bass track" often enough for the saving to matter.
 */
const DESTRUCTIVE = /delete|remove|clear|wipe|reset|erase|drop_/i

export type LearnResult =
  'stored' | 'nothing-to-learn' | 'depends-on-context' | 'depends-on-song' | 'destructive'

/**
 * Teach the program what the assistant just did. Called only for a turn that
 * finished cleanly — a plan that failed, or that the person undid, is not an
 * answer worth repeating for free forever.
 */
export function rememberCommand(text: string, calls: VoiceCall[]): LearnResult {
  const key = normalise(text)
  if (!key || !calls.length) return 'nothing-to-learn'
  if (DEICTIC.test(key)) return 'depends-on-context'
  if (calls.some(c => DESTRUCTIVE.test(c.name))) return 'destructive'
  if (!determinedBySentence(text, calls)) return 'depends-on-song'

  const list = load()
  const existing = list.findIndex(e => e.text === key)
  if (existing >= 0) list.splice(existing, 1)
  list.push({ text: key, calls: calls.map(c => ({ name: c.name, input: { ...c.input } })), at: Date.now(), used: 0 })

  // Least valuable first: never used, then least recently used.
  if (list.length > MAX) {
    list.sort((a, b) => (a.used - b.used) || (a.at - b.at))
    list.splice(0, list.length - MAX)
  }
  save()
  return 'stored'
}

/** What the cache has saved, for the report in the HUD and the admin panel. */
export function learnedStats(): { entries: number; hits: number; misses: number } {
  return { entries: load().length, hits, misses }
}

export function learnedEntries(): LearnedEntry[] {
  return load().slice().sort((a, b) => b.used - a.used || b.at - a.at)
}

/** Forget one sentence, or all of them — the fix when it learned something wrong. */
export function forgetLearned(text?: string): void {
  if (text == null) { mem = []; save(); return }
  const key = normalise(text)
  mem = load().filter(e => e.text !== key)
  save()
}
