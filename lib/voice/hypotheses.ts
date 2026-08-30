'use client'
// ── Not deciding what was said until something can check it ─────────────────
//
// Brae: "it's okay to have the system recognize multiple possible words from
// the audio instead of deciding on one and having the next part decide what
// closest word it can be corrected to if context doesn't fit well. Every step
// has possibilities for improvement... the idea of widening the net to find the
// solution is there."
//
// A recogniser hands over one sentence. It did not have one sentence — it had a
// distribution, and it collapsed it, usually before anything downstream knew
// which words mattered. By the time the parser sees "close the filter on the
// bars", the reading that would have won is gone, and no amount of cleverness
// downstream can recover a word that was never passed on.
//
// So the collapse is undone here, deliberately and cheaply, before anything
// commits. From one transcript this produces a small set of sentences that COULD
// have been said, each carrying what it cost to believe. The parser reads all of
// them and the project picks the winner.
//
// Two things keep the net wide in the right direction rather than merely large:
//
//   IT ONLY SUBSTITUTES WORDS THE SYSTEM KNOWS. Replacing a word with another
//   word nothing downstream recognises cannot change any outcome, so the
//   replacements come from the command vocabulary and the project's own track
//   names. That is a few hundred words, not a language.
//
//   IT LISTENS FOR SOUND, NOT SPELLING. "mute" and "moot" are two edits apart
//   and one syllable apart, which is the wrong way round for a system whose
//   input came from a microphone. A rough phonetic key catches the pairs that
//   actually get misheard, and — usefully — keeps apart pairs that edit distance
//   would have merged: "bass" and "bars" sound different and stay different.
//
// Everything here is only a PROPOSAL. A rewritten sentence has to beat the one
// actually heard by a clear margin before it is believed, because the transcript
// remains the only direct evidence of what was said.

/** How many sentences may be proposed for one utterance. */
const MAX_HYPOTHESES = 24
/** At most this many words may be rewritten in a single hypothesis. */
const MAX_SUBSTITUTIONS = 2
/** Words the recogniser was this unsure of are the ones worth reconsidering. */
const UNSURE_BELOW = 0.85

export interface HeardWord {
  word: string
  /** The recogniser's own confidence in this word, 0–1. */
  confidence: number
}

export interface Heard {
  /** What the recogniser settled on. */
  text: string
  /** Per-word confidence, when the recogniser reports it. */
  words?: HeardWord[]
  /** Whole other sentences it considered, if it offered any. */
  alternatives?: string[]
  /** Its confidence in the utterance as a whole. */
  confidence?: number
}

export interface Hypothesis {
  text: string
  /**
   * What it costs to believe this instead of what was heard. Zero for the
   * transcript itself; higher the more words had to be reconsidered and the
   * surer the recogniser was about them.
   */
  cost: number
  /** Human-readable account of the change, for the log and the read-back. */
  why: string
}

/**
 * A rough phonetic key — what a word sounds like, spelled consistently.
 *
 * Deliberately crude. It exists to make "mute"/"moot" and "sole"/"solo" collide
 * while leaving "bass"/"bars" apart, and anything more sophisticated would need
 * a pronunciation dictionary this cannot carry. Vowels after the first letter
 * are dropped because they are what a microphone smears most; consonants that
 * are routinely confused are folded together.
 */
export function phoneticKey(word: string): string {
  const w = String(word ?? '').toLowerCase().replace(/[^a-z]/g, '')
  if (!w) return ''
  const fold = (c: string): string => {
    if ('ckq'.includes(c)) return 'k'
    if ('sz'.includes(c)) return 's'
    if ('fv'.includes(c)) return 'f'
    if ('dt'.includes(c)) return 't'
    if ('mn'.includes(c)) return 'n'
    if ('bp'.includes(c)) return 'p'
    if ('gj'.includes(c)) return 'j'
    return c
  }
  let out = fold(w[0])
  for (let i = 1; i < w.length; i++) {
    const c = w[i]
    if ('aeiouyhw'.includes(c)) continue
    const f = fold(c)
    if (f !== out[out.length - 1]) out += f
  }
  return out
}

/** Levenshtein distance, abandoned once it exceeds `cap`. */
export function editDistance(a: string, b: string, cap = 3): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > cap) return cap + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      const v = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost)
      row.push(v)
      if (v < best) best = v
    }
    if (best > cap) return cap + 1
    prev = row
  }
  return prev[b.length]
}

/**
 * Which known words could this one actually have been?
 *
 * Sounding the same is the strongest evidence and costs least. Being spelled
 * almost the same is weaker — it is how a transcript looks, not how speech
 * fails — so it costs more, and two edits costs more again.
 */
function couldHaveBeen(word: string, vocabulary: readonly string[]): { word: string; cost: number }[] {
  const w = word.toLowerCase()
  const key = phoneticKey(w)
  const out: { word: string; cost: number }[] = []
  for (const candidate of vocabulary) {
    if (candidate === w) continue
    // A one-letter word has no room to be almost anything else; matching on its
    // sound would make every short word a candidate for every other.
    if (candidate.length < 3 || w.length < 3) continue
    if (key && phoneticKey(candidate) === key) { out.push({ word: candidate, cost: 0.5 }); continue }
    const d = editDistance(w, candidate, 2)
    if (d <= 2) out.push({ word: candidate, cost: d === 1 ? 1 : 1.8 })
  }
  return out.sort((a, b) => a.cost - b.cost).slice(0, 4)
}

/**
 * Every sentence this utterance could reasonably have been, cheapest first.
 *
 * The transcript itself is always first and always free — it is the only direct
 * evidence, and everything else here is a guess about how it might be wrong.
 */
export function hypotheses(heard: Heard, vocabulary: readonly string[]): Hypothesis[] {
  const text = String(heard.text ?? '').trim()
  if (!text) return []

  const out: Hypothesis[] = [{ text, cost: 0, why: 'as heard' }]
  const seen = new Set([text.toLowerCase()])

  // Whole sentences the recogniser itself considered. It had reasons; they are
  // just not reasons that knew anything about this project.
  for (const alt of heard.alternatives ?? []) {
    const t = String(alt ?? '').trim()
    if (!t || seen.has(t.toLowerCase())) continue
    seen.add(t.toLowerCase())
    out.push({ text: t, cost: 0.6, why: 'the recogniser\'s second guess' })
  }

  // ── Reconsider the words it was least sure of ────────────────────────────
  const tokens = text.split(/\s+/)
  const confidenceOf = (i: number): number => {
    const w = heard.words?.[i]
    if (w && w.word.toLowerCase().replace(/[^a-z0-9]/g, '') === tokens[i].toLowerCase().replace(/[^a-z0-9]/g, '')) {
      return w.confidence
    }
    // No per-word data: the utterance's own confidence stands in for every word.
    return heard.words?.length ? 1 : (heard.confidence ?? 1)
  }

  // ── When to reconsider anything at all ───────────────────────────────────
  //
  // Widening the net on a transcript the recogniser was sure of is how a system
  // starts hearing what it expects. Left unguarded it did exactly that: "what
  // time is it", at 0.9 confidence, became "halt time is it" and stopped the
  // transport, because "halt" is two edits from "what" and nothing was weighing
  // the cost of rewriting a perfectly ordinary English word.
  //
  // So a recogniser that reports confidence gets believed. Rewriting is for the
  // words it flagged as shaky, or — when it offers no per-word detail — for
  // utterances it was unsure of as a whole.
  const detailed = !!heard.words?.length
  const utteranceSure = (heard.confidence ?? 1) >= UNSURE_BELOW
  if (!detailed && utteranceSure) return out.sort((a, b) => a.cost - b.cost).slice(0, MAX_HYPOTHESES)

  const vocab = vocabulary.map(v => v.toLowerCase())
  const swaps: { index: number; word: string; cost: number }[] = []
  for (let i = 0; i < tokens.length; i++) {
    const bare = tokens[i].toLowerCase().replace(/[^a-z0-9]/g, '')
    if (!bare) continue
    const confidence = confidenceOf(i)
    if (confidence >= UNSURE_BELOW && vocab.includes(bare)) continue
    for (const option of couldHaveBeen(bare, vocab)) {
      // A word the recogniser was sure of costs more to overrule. This is the
      // whole reason per-word confidence is worth plumbing through: without it
      // every word is equally suspect and the net widens where it need not.
      swaps.push({ index: i, word: option.word, cost: option.cost * (1.2 - confidence * 0.6) })
    }
  }
  swaps.sort((a, b) => a.cost - b.cost)

  const apply = (changes: { index: number; word: string }[]): string =>
    tokens.map((t, i) => changes.find(c => c.index === i)?.word ?? t).join(' ')

  for (const swap of swaps) {
    if (out.length >= MAX_HYPOTHESES) break
    const t = apply([swap])
    if (seen.has(t.toLowerCase())) continue
    seen.add(t.toLowerCase())
    out.push({ text: t, cost: swap.cost, why: `"${tokens[swap.index]}" → "${swap.word}"` })
  }

  // Pairs, for the sentence where two words came out wrong at once. Only the
  // cheapest few are combined: this is the step that would explode, and a
  // third simultaneous mishearing is better served by asking than by guessing.
  if (MAX_SUBSTITUTIONS >= 2) {
    const top = swaps.slice(0, 6)
    for (let a = 0; a < top.length; a++) {
      for (let b = a + 1; b < top.length; b++) {
        if (out.length >= MAX_HYPOTHESES) break
        if (top[a].index === top[b].index) continue
        const t = apply([top[a], top[b]])
        if (seen.has(t.toLowerCase())) continue
        seen.add(t.toLowerCase())
        out.push({
          text: t,
          cost: top[a].cost + top[b].cost,
          why: `"${tokens[top[a].index]}" → "${top[a].word}", "${tokens[top[b].index]}" → "${top[b].word}"`,
        })
      }
    }
  }

  return out.sort((a, b) => a.cost - b.cost).slice(0, MAX_HYPOTHESES)
}
