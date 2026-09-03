// Words this person has decided mean something, for as long as they are here.
//
// Brae: "The user can also say 'ta means closed hi hat, and cha means snare'
// then it will listen to those as an alternative for the duration of that
// session unless changed later. For piano roll the user can say the name of the
// chord or similarly create a shorthand, like numbers or terms."
//
// ── Why this matters more than it looks ────────────────────────────────────
//
// Saying a rhythm out loud only works if the words are SHORT. "Closed hi-hat"
// takes most of a beat to say; "ta" takes a sixteenth. The built-in syllables
// (boom, ka, ts) are short for exactly that reason, but they are somebody
// else's shorthand — and a person who beatboxes has their own. Letting them
// declare it is the difference between a feature they adapt to and one that
// adapts to them.
//
// The same argument applies twice over on the piano roll: "E flat minor seven"
// is four words and cannot be placed on a beat at all. "Four" can.
//
// ⚠️ Session-scoped ON PURPOSE. These are working shorthand, not settings — the
// meaning of "ta" belongs to the take you are doing, and carrying it into next
// week would be a trap the first time somebody said it meaning something else.
// Changing one replaces it; clearing is one command away.

import { laneForWord, type LaneKey } from './beatbox'
import { parseChord, readChordAt, type SpokenChord } from './chords-spoken'
import { DRUM_LANES } from '@/lib/drum-presets'

export type Meaning =
  | { kind: 'drum'; lane: LaneKey; said: string }
  | { kind: 'chord'; pitches: number[]; said: string }

/** alias → what it means. Lower-cased, single words only. */
const vocab = new Map<string, Meaning>()

/** Everything defined this session, for a read-back or a settings list. */
export function definitions(): Array<{ word: string; means: Meaning }> {
  return [...vocab].map(([word, means]) => ({ word, means }))
}

export function clearVocab(): void { vocab.clear() }

export function define(word: string, means: Meaning): void {
  const w = word.toLowerCase().trim()
  if (w) vocab.set(w, means)
}

/** What this word means, if it has been given a meaning. */
export function meaningOf(word: string): Meaning | null {
  return vocab.get(word.toLowerCase().trim()) ?? null
}

// ── Reading a definition out of a sentence ─────────────────────────────────

const laneByLabel = new Map<string, LaneKey>()
for (const l of DRUM_LANES) {
  laneByLabel.set(l.label.toLowerCase(), l.key)
  laneByLabel.set(l.key.toLowerCase(), l.key)
}
// The names people actually use for the same lanes.
const LANE_SYNONYMS: Record<string, LaneKey> = {
  'hi hat': 'closedHat', 'hihat': 'closedHat', 'hat': 'closedHat',
  'closed hi hat': 'closedHat', 'closed hihat': 'closedHat', 'closed hat': 'closedHat',
  'open hi hat': 'openHat', 'open hihat': 'openHat', 'open hat': 'openHat',
  'kick drum': 'kick', 'bass drum': 'kick', 'snare drum': 'snare',
  'cymbal': 'crash', 'crash cymbal': 'crash', 'ride': 'crash',
  'rimshot': 'rim', 'rim shot': 'rim', 'handclap': 'clap', 'hand clap': 'clap',
  'high tom': 'tomHi', 'mid tom': 'tomMid', 'low tom': 'tomLo',
  'tom': 'tomMid',
}

/** A drum lane from however somebody said its name. */
export function laneFromName(phrase: string): LaneKey | null {
  const p = phrase.toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim()
  return laneByLabel.get(p) ?? LANE_SYNONYMS[p] ?? null
}

export interface Definition { word: string; means: Meaning }

/**
 * Read every "X means Y" out of a sentence.
 *
 * Handles the shape Brae wrote it in — "ta means closed hi hat, and cha means
 * snare" — which is two definitions in one breath, and the reason this splits
 * on the connectives rather than expecting one per sentence.
 *
 * ⚠️ The ALIAS is a single word. A shorthand you have to say two words to use
 * is not a shorthand, and allowing phrases would make "boom ka means kick"
 * silently define something that can never match a single spoken token.
 */
export function parseDefinitions(sentence: string): Definition[] {
  const out: Definition[] = []
  // "ta means X, and cha means Y" → ["ta means X", "cha means Y"]. Splitting on
  // "and" only where a definition follows keeps "rock and roll" in one piece.
  const parts = sentence.split(/,|\band\b|\bthen\b/i)
  for (const part of parts) {
    const m = /(?:^|\s)([a-z0-9'-]+)\s+(?:means|equals|is|=)\s+(.+)$/i.exec(part.trim())
    if (!m) continue
    const word = m[1].toLowerCase()
    const rest = m[2].trim().replace(/[.!?]+$/, '').replace(/^(a|an|the)\s+/i, '')
    if (!word || !rest) continue

    const lane = laneFromName(rest)
    if (lane) { out.push({ word, means: { kind: 'drum', lane, said: rest } }); continue }

    const chord = parseChord(rest)
    if (chord) { out.push({ word, means: { kind: 'chord', pitches: chord.pitches, said: chord.name } }); continue }

    // A word that means another drum syllable — "ta means boom" — is a
    // perfectly reasonable thing to say and costs nothing to support.
    const viaSyllable = laneForWord(rest)
    if (viaSyllable) out.push({ word, means: { kind: 'drum', lane: viaSyllable, said: rest } })
  }
  return out
}

/** Apply them, and say what happened. */
export function applyDefinitions(defs: Definition[]): string {
  for (const d of defs) define(d.word, d.means)
  if (!defs.length) return ''
  return defs.map(d => `"${d.word}" is ${d.means.said}`).join(', ')
}

// ── Resolving, with the session's own words first ──────────────────────────

/**
 * The drum a word means: this session's shorthand first, then the built-ins.
 *
 * Order matters and is not arbitrary. Somebody who says "ta means snare" has
 * overridden whatever the phonetic fallback would have guessed, and the guess
 * must not win — that is the entire point of being able to say it.
 */
export function drumForWord(word: string): LaneKey | null {
  const m = meaningOf(word)
  if (m) return m.kind === 'drum' ? m.lane : null
  return laneForWord(word)
}

/** The chord a word or phrase means, session shorthand first. */
export function chordAt(words: string[], i: number, octave = 4): (SpokenChord & { alias?: string }) | null {
  const m = meaningOf(words[i] ?? '')
  if (m?.kind === 'chord') {
    return { pitches: m.pitches, name: m.said, used: 1, alias: words[i] }
  }
  if (m) return null      // it means a drum; it is not a chord
  return readChordAt(words, i, octave)
}
