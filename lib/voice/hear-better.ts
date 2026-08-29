'use client'
// ── Making the recogniser hear THIS project ─────────────────────────────────
//
// Brae: "Do we have good voice recognition right now?"
//
// Honestly: adequate for plain English, weak for a studio. The browser's
// recogniser is general-purpose and knows nothing about the song open in front
// of it, so the words it is least sure about are exactly the ones that matter —
// the nouns. "Bass 2" comes back as "base two", "Stab" as "stap" or "stop",
// "Bm7" as "be minor seven".
//
// Two cheap things fix most of it, and neither needs a different recogniser:
//
//   ALTERNATIVES. maxAlternatives was 1, so every guess but the first was
//   thrown away — including, often, the right one. Asking for several costs
//   nothing; the recogniser has already computed them.
//
//   THE PROJECT'S OWN NOUNS. A studio always knows what its tracks are called,
//   which turns "did I hear that right" from an open question into a lookup
//   against a list of a dozen names. That is a much easier problem than general
//   transcription, and it is the one that decides whether a command lands.
//
// So: score each alternative by how many of the project's real names it
// contains, and prefer the one that mentions things that actually exist. Then
// repair the surviving text word-group by word-group, so the sentence handed to
// the model says "Bass 2" where the microphone heard "base two".
//
// Deliberately conservative. A wrong "correction" is worse than a wrong
// transcript, because the model can often recover from a slightly odd sentence
// but not from confidently renaming the wrong track. Nothing is replaced unless
// the spoken words map to exactly one real name.

import { foldName } from './resolve'

export interface Nameable { id: string; name?: string }

/** Numbers arrive as words far more often than as digits. */
const NUMBER_WORDS: Record<string, string> = {
  one: '1', two: '2', three: '3', four: '4', five: '5', six: '6',
  seven: '7', eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12',
  to: '2', too: '2', for: '4', ate: '8',    // the ones a recogniser reaches for
}

/** Fold a phrase the way a name is folded, with number words as digits. */
function foldSpoken(s: string): string {
  return foldName(s).split(' ').map(w => NUMBER_WORDS[w] ?? w).filter(Boolean).join(' ')
}

/**
 * How much of this project does the sentence appear to mention?
 *
 * Counts the real names it contains, longest first so "Bass 2" beats "Bass".
 * Used only to CHOOSE between alternatives the recogniser already produced —
 * never to alter one.
 */
export function scoreAgainstNames(text: string, names: string[]): number {
  const t = foldSpoken(text)
  if (!t) return 0
  let score = 0
  for (const n of names) {
    const f = foldSpoken(n)
    if (f && t.includes(f)) score += f.split(' ').length
  }
  return score
}

/**
 * Pick the alternative that mentions the most real things.
 *
 * Ties keep the recogniser's own order, which is its confidence ranking — we
 * only overrule it when another alternative demonstrably refers to the song.
 */
export function pickAlternative(alternatives: string[], names: string[]): string {
  const alts = alternatives.map(a => a.trim()).filter(Boolean)
  if (alts.length <= 1) return alts[0] ?? ''
  let best = alts[0]
  let bestScore = scoreAgainstNames(alts[0], names)
  for (let i = 1; i < alts.length; i++) {
    const s = scoreAgainstNames(alts[i], names)
    if (s > bestScore) { best = alts[i]; bestScore = s }
  }
  return best
}

/**
 * Rewrite the words that clearly meant one of the project's names.
 *
 * Walks the sentence looking at runs of 1–4 words, longest first, and replaces
 * a run only when its folded form matches EXACTLY ONE real name. "base two"
 * becomes "Bass 2"; "the bass" is left alone when there are two bass tracks,
 * because the model asking which one is better than this guessing.
 */
export function repairNames(text: string, items: Nameable[]): string {
  const names = items.map(i => (i.name ?? '').trim()).filter(Boolean)
  if (!names.length || !text.trim()) return text

  // folded name -> the real names that fold to it
  const byFolded = new Map<string, string[]>()
  for (const n of names) {
    const f = foldSpoken(n)
    if (!f) continue
    byFolded.set(f, [...(byFolded.get(f) ?? []), n])
  }

  // ── One letter of slack, and no more ──────────────────────────────────────
  //
  // The failures that matter are phonetic, not lexical: "bass" heard as "base",
  // "stab" as "stap", "pad" as "pat". Exact matching cannot bridge those, and
  // they are precisely the words that decide which track a command lands on.
  //
  // Edit distance 1, per word, only for runs of the same length — enough for a
  // single swapped or dropped letter and nothing like enough to reach a
  // different name. Combined with the "exactly one match" rule below, an
  // ambiguous near-miss is still left alone for the assistant to ask about.
  const within1 = (a: string, b: string): boolean => {
    if (a === b) return true
    if (Math.abs(a.length - b.length) > 1) return false
    // Too short to spare a letter: "pad"/"bad" is a real name collision, not a
    // mishearing worth guessing at.
    if (Math.min(a.length, b.length) < 4) return false
    let i = 0, j = 0, edits = 0
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue }
      if (++edits > 1) return false
      if (a.length > b.length) i++
      else if (b.length > a.length) j++
      else { i++; j++ }
    }
    return edits + (a.length - i) + (b.length - j) <= 1
  }
  const nearMatch = (run: string): string[] => {
    const rw = run.split(' ')
    const hits: string[] = []
    for (const [folded, real] of byFolded) {
      const fw = folded.split(' ')
      if (fw.length !== rw.length) continue
      if (rw.every((w, k) => within1(w, fw[k]))) hits.push(...real)
    }
    return hits
  }

  const words = text.split(/\s+/).filter(Boolean)
  const out: string[] = []
  let i = 0
  while (i < words.length) {
    let replaced = false
    for (let len = Math.min(4, words.length - i); len >= 1 && !replaced; len--) {
      const run = words.slice(i, i + len).join(' ')
      const folded = foldSpoken(run)
      const hits = byFolded.get(folded) ?? (folded ? nearMatch(folded) : undefined)
      // Exactly one, and never a single word that is just a number — "2" on its
      // own is a count far more often than it is a track called "2".
      if (hits && hits.length === 1 && !(len === 1 && /^\d+$/.test(foldSpoken(run)))) {
        out.push(hits[0])
        i += len
        replaced = true
      }
    }
    if (!replaced) { out.push(words[i]); i++ }
  }
  return out.join(' ')
}

/** Both steps: choose the best alternative, then repair its names. */
export function hearBetter(alternatives: string[], items: Nameable[]): string {
  const names = items.map(i => (i.name ?? '').trim()).filter(Boolean)
  return repairNames(pickAlternative(alternatives, names), items)
}
