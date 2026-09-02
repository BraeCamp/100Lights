'use client'
// ── What the assistant worked out once, the program keeps ────────────────────
//
// Brae: "how else can we combine the program with the AI to make idle and
// simple commands cheaper for voice control" — and then: "are there more ways
// that we can safely have the program decrypt words so that the AI doesn't need
// to".
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
import { COMMAND_VOCABULARY } from './commands'

export interface LearnedEntry {
  /** The normalised sentence — the key. Templates carry {0} / {n0} slots. */
  text: string
  /** The calls, with the same slot tokens standing in for their values. */
  calls: VoiceCall[]
  /** Whether this entry generalises, or answers exactly one sentence. */
  templated: boolean
  /** When it was taught, and how often it has paid off since. */
  at: number
  used: number
}

/** A hit, and enough about it for the caller to know what to forget. */
export interface Recalled {
  calls: VoiceCall[]
  from: 'exact' | 'template'
  key: string
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
 * ⚠️ NEVER LEARN A COMMAND THAT TAKES SOMETHING AWAY. The rules ask before
 * anything destructive runs, and that confirmation is keyed to a flag the model
 * does not send — so a remembered delete would be the one path into the studio
 * that removes a track without asking. Cheap to refuse, and nobody says "delete
 * the bass track" often enough for the saving to matter.
 */
const DESTRUCTIVE = /delete|remove|clear|wipe|reset|erase|drop_/i

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
const SPOKEN: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, sixteen: 16, twenty: 20, thirty: 30,
  forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
}

function numbersIn(said: string): Set<number> {
  const out = new Set<number>()
  for (const m of said.matchAll(/\d+(?:\.\d+)?/g)) out.add(Number(m[0]))
  for (const [word, n] of Object.entries(SPOKEN)) {
    if (new RegExp(`\\b${word}\\b`).test(said)) out.add(n)
  }
  return out
}

function determinedBySentence(text: string, calls: VoiceCall[]): boolean {
  const saidNumbers = numbersIn(normalise(text))
  const ok = (v: unknown): boolean => {
    if (v == null || typeof v === 'boolean' || typeof v === 'string') return true
    if (typeof v === 'number') return saidNumbers.has(v)
    if (Array.isArray(v)) return v.every(ok)
    if (typeof v === 'object') return Object.values(v as Record<string, unknown>).every(ok)
    return false
  }
  return calls.every(c => Object.values(c.input ?? {}).every(ok))
}

// ── generalising one lesson into a family ───────────────────────────────────
//
// Brae: "are there more ways that we can safely have the program decrypt words
// so that the AI doesn't need to".
//
// ⚠️ REMEMBERING EXACT SENTENCES BARELY HELPS. "Mute the pad" teaches nothing
// about "mute the bass", so a studio with ten tracks needs ten paid lessons for
// one idea — and the phrasing has to match to the word besides. The cache only
// pays for itself if a lesson generalises.
//
// So the parts of the sentence that are ARGUMENTS become slots. A value is only
// slotted when it is safe to: the name must be something in this project AND
// appear in the sentence, so the slot is demonstrably the place that name was
// said; a number must have been said too. Everything else stays literal, which
// is what keeps "add reverb to {0}" from ever answering a question about delay.
//
// The binding is not trusted either — a bound name goes through planVoiceCalls
// like any other, so "mute the xylophone" against a song with no xylophone
// fails the way it always would, and asks the assistant instead.

const SLOT = /^\{n?\d+\}$/
const STR_SLOT = /^\{\d+\}$/

/** Replace the arguments with slots, or null when nothing generalises. */
function templateFrom(text: string, calls: VoiceCall[], projectWords: readonly string[]):
  { text: string; calls: VoiceCall[] } | null {
  const said = normalise(text)
  const known = new Set(projectWords.map(w => normalise(w)).filter(w => w.length > 2))
  const saidNumbers = numbersIn(said)

  let tpl = said
  const token = new Map<string, string>()   // the value as said -> its slot
  let nStr = 0
  let nNum = 0

  const slotFor = (v: unknown): string | null => {
    if (typeof v === 'string') {
      const low = normalise(v)
      if (!low || !known.has(low)) return null
      const word = new RegExp(`\\b${low.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
      if (!word.test(tpl)) return null
      const existing = token.get(low)
      if (existing) return existing
      const t = `{${nStr++}}`
      tpl = tpl.replace(new RegExp(word, 'g'), t)
      token.set(low, t)
      return t
    }
    if (typeof v === 'number') {
      if (!saidNumbers.has(v)) return null
      const digits = new RegExp(`\\b${v}\\b`)
      if (!digits.test(tpl)) return null           // said as a word, not a numeral
      const existing = token.get(String(v))
      if (existing) return existing
      const t = `{n${nNum++}}`
      tpl = tpl.replace(new RegExp(digits, 'g'), t)
      token.set(String(v), t)
      return t
    }
    return null
  }

  const slotted = calls.map(c => {
    const input: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(c.input ?? {})) input[k] = slotFor(v) ?? v
    return { name: c.name, input }
  })

  if (!token.size) return null
  // ⚠️ A template must still SAY something. "{0}" on its own would match every
  // sentence ever spoken; requiring real words outside the slots keeps the
  // generalisation to the shape of a command rather than to anything at all.
  const literal = tpl.replace(/\{n?\d+\}/g, ' ')
  if (!/[\p{L}]{2,}/u.test(literal)) return null
  return { text: tpl, calls: slotted }
}

/** The slots of a template, in the order their capture groups appear. */
function slotOrder(tpl: string): string[] {
  return (tpl.match(/\{n?\d+\}/g) ?? [])
}

function matcher(tpl: string): RegExp {
  const src = tpl
    .split(/(\{n?\d+\})/)
    .map(part => {
      if (STR_SLOT.test(part)) return '([\\p{L}\\p{N}][\\p{L}\\p{N} ]{0,23}?)'
      if (SLOT.test(part)) return '(\\d+(?:\\.\\d+)?)'
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    })
    .join('')
  return new RegExp(`^${src}$`, 'u')
}

/** Put the captured words back where the arguments were. */
function bind(entry: LearnedEntry, said: string): VoiceCall[] | null {
  const m = matcher(entry.text).exec(said)
  if (!m) return null
  const order = slotOrder(entry.text)
  const bound = new Map<string, string | number>()
  order.forEach((slot, i) => {
    if (bound.has(slot)) return
    const raw = (m[i + 1] ?? '').trim()
    if (!raw) return
    bound.set(slot, STR_SLOT.test(slot) ? raw : Number(raw))
  })
  if (bound.size !== new Set(order).size) return null

  const fill = (v: unknown): unknown =>
    typeof v === 'string' && SLOT.test(v) ? (bound.get(v) ?? v) : v

  return entry.calls.map(c => {
    const input: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(c.input ?? {})) input[k] = fill(v)
    return { name: c.name, input }
  })
}

// ── the store ───────────────────────────────────────────────────────────────
//
// Kept in memory and mirrored to localStorage, which can throw (private mode,
// blocked site data) and must never take the voice control down with it — the
// cache going away costs money, not correctness.

let mem: LearnedEntry[] | null = null
let hits = 0
let templateHits = 0
let sharedHits = 0
let misses = 0

// ── What every other studio has been taught ────────────────────────────────
//
// Brae: "The pooled cache and macro ideas don't seem to require much fund at
// all. How much can we do right now?"
//
// A template carries no user content — every argument was replaced by a slot
// before it was stored — so one person's paid lesson can answer everybody
// else's sentence for nothing. This is that pool, fetched once and consulted
// LAST, after this studio's own exact and template entries.
//
// ⚠️ LAST ON PURPOSE. What somebody taught THIS studio must always beat what a
// stranger taught the pool: a person who has corrected the same sentence twice
// has said something about how they work, and a shared entry outvoting them
// would feel like the studio forgetting.
const SHARED_KEY = 'light.learned.shared.v1'
let shared: LearnedEntry[] | null = null

function loadShared(): LearnedEntry[] {
  if (shared) return shared
  try {
    const raw = localStorage.getItem(SHARED_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    shared = Array.isArray(parsed)
      ? parsed.filter(e => e && typeof e.text === 'string' && Array.isArray(e.calls))
        .map(e => ({ ...e, templated: true, used: e.used ?? 0, at: e.at ?? 0 }))
      : []
  } catch { shared = [] }
  return shared
}

/** Install the pool. Kept out of the local store so the two never blur. */
export function mergeShared(entries: { template: string; calls: VoiceCall[] }[]): number {
  const clean = entries
    .filter(e => e && typeof e.template === 'string' && Array.isArray(e.calls) && e.calls.length)
    .map(e => ({ text: e.template, calls: copy(e.calls), templated: true, at: 0, used: 0 }))
  shared = clean
  try { localStorage.setItem(SHARED_KEY, JSON.stringify(clean)) } catch { /* nothing to keep it in */ }
  return clean.length
}

/**
 * Is this template safe to offer the pool?
 *
 * ⚠️ EVERY LITERAL WORD MUST BE ONE THE STUDIO ALREADY KNOWS. The slots take
 * out the names, but the rest of a sentence is still something a person said,
 * and a pooled entry is shown to strangers. Requiring the leftovers to come
 * from the command vocabulary means nothing personal can travel even in
 * principle — and it throws away junk templates as a side effect, which is the
 * cheapest quality filter available.
 */
const CONNECTIVES = new Set([
  'the', 'a', 'an', 'to', 'on', 'in', 'at', 'of', 'for', 'and', 'it', 'its', 'by',
  'me', 'my', 'that', 'this', 'with', 'from', 'up', 'down', 'off', 'out', 'all',
  'is', 'be', 'as', 'so', 'bit', 'little', 'lot', 'more', 'less', 'percent',
])
let vocab: Set<string> | null = null

export function shareable(template: string, calls: VoiceCall[]): boolean {
  if (!/\{n?\d+\}/.test(template)) return false
  vocab ??= new Set(COMMAND_VOCABULARY.map(w => w.toLowerCase()))
  const literals = template.replace(/\{n?\d+\}/g, ' ').split(/\s+/).filter(Boolean)
  if (!literals.some(w => w.length > 1)) return false
  if (!literals.every(w => vocab!.has(w) || CONNECTIVES.has(w))) return false
  // The call names travel too, so they have to be plain.
  return calls.every(c => /^[a-z_]{2,32}$/.test(c.name))
}

/** The generalised form of a lesson, for offering to the pool. */
export function shareableTemplate(
  text: string, calls: VoiceCall[], projectWords: readonly string[] = [],
): { template: string; calls: VoiceCall[] } | null {
  const key = normalise(text)
  if (!key || !calls.length) return null
  if (DEICTIC.test(key)) return null
  if (calls.some(c => DESTRUCTIVE.test(c.name))) return null
  if (!determinedBySentence(text, calls)) return null
  const tpl = templateFrom(text, calls, projectWords)
  if (!tpl || !shareable(tpl.text, tpl.calls)) return null
  return { template: tpl.text, calls: tpl.calls }
}

function load(): LearnedEntry[] {
  if (mem) return mem
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : []
    mem = Array.isArray(parsed)
      ? parsed.filter(e => e && typeof e.text === 'string' && Array.isArray(e.calls))
        .map(e => ({ ...e, templated: !!e.templated }))
      : []
  } catch { mem = [] }
  return mem
}

function save(): void {
  try { localStorage.setItem(KEY, JSON.stringify(mem ?? [])) } catch { /* nothing to keep it in */ }
}

const copy = (calls: VoiceCall[]): VoiceCall[] => calls.map(c => ({ name: c.name, input: { ...c.input } }))

/** The calls this sentence produced last time, or null to go and ask. */
export function recallCommand(text: string): Recalled | null {
  const said = normalise(text)
  if (!said) return null
  const list = load()

  // Exact first: it is the cheapest and the one that cannot generalise wrongly.
  const exact = list.find(e => !e.templated && e.text === said)
  if (exact) {
    hits++
    exact.used++
    exact.at = Date.now()
    save()
    return { calls: copy(exact.calls), from: 'exact', key: exact.text }
  }

  // Then the families. Most-used first, so the phrasing somebody actually uses
  // wins over one they said once.
  for (const e of list.filter(x => x.templated).sort((a, b) => b.used - a.used)) {
    const calls = bind(e, said)
    if (!calls) continue
    hits++
    templateHits++
    e.used++
    e.at = Date.now()
    save()
    return { calls, from: 'template', key: e.text }
  }

  // Then what everybody else has been taught.
  for (const e of loadShared()) {
    const calls = bind(e, said)
    if (!calls) continue
    hits++
    sharedHits++
    return { calls, from: 'template', key: e.text }
  }

  misses++
  return null
}

export type LearnResult =
  'stored' | 'stored-with-template' | 'nothing-to-learn' | 'depends-on-context' | 'depends-on-song' | 'destructive'

/**
 * Teach the program what the assistant just did. Called only for a turn that
 * finished cleanly — a plan that failed is not an answer worth repeating for
 * free forever.
 */
export function rememberCommand(text: string, calls: VoiceCall[], projectWords: readonly string[] = []): LearnResult {
  const key = normalise(text)
  if (!key || !calls.length) return 'nothing-to-learn'
  if (DEICTIC.test(key)) return 'depends-on-context'
  if (calls.some(c => DESTRUCTIVE.test(c.name))) return 'destructive'
  if (!determinedBySentence(text, calls)) return 'depends-on-song'

  put({ text: key, calls: copy(calls), templated: false, at: Date.now(), used: 0 })

  // The same lesson, generalised — kept ALONGSIDE the exact one rather than
  // instead of it, so the sentence that was actually taught keeps its fast,
  // literal path and never depends on a regular expression matching.
  const tpl = templateFrom(text, calls, projectWords)
  if (tpl && tpl.text !== key) {
    put({ text: tpl.text, calls: tpl.calls, templated: true, at: Date.now(), used: 0 })
    return 'stored-with-template'
  }
  return 'stored'
}

function put(entry: LearnedEntry): void {
  const list = load()
  const at = list.findIndex(e => e.text === entry.text && e.templated === entry.templated)
  if (at >= 0) list.splice(at, 1)
  list.push(entry)
  // Least valuable first: never used, then least recently used.
  if (list.length > MAX) {
    list.sort((a, b) => (a.used - b.used) || (a.at - b.at))
    list.splice(0, list.length - MAX)
  }
  save()
}

/** What the cache has saved, for the voice report. */
export function learnedStats(): {
  entries: number; templates: number; shared: number
  hits: number; templateHits: number; sharedHits: number; misses: number
} {
  const list = load()
  return {
    entries: list.length,
    templates: list.filter(e => e.templated).length,
    shared: loadShared().length,
    hits, templateHits, sharedHits, misses,
  }
}

export function learnedEntries(): LearnedEntry[] {
  return load().slice().sort((a, b) => b.used - a.used || b.at - a.at)
}

/**
 * Forget one entry by its key — the fix when it learned something wrong.
 *
 * ⚠️ Only ever called for an EXACT entry. A template that fails to plan is not
 * wrong, it has been handed a name this song does not have: throwing away the
 * family because one of its members missed would undo the generalisation the
 * first time somebody named a track that does not exist.
 */
export function forgetKey(key: string): void {
  mem = load().filter(e => e.text !== key)
  save()
}

/** Forget one sentence, or all of them. */
export function forgetLearned(text?: string): void {
  if (text == null) { mem = []; save(); return }
  forgetKey(normalise(text))
}
