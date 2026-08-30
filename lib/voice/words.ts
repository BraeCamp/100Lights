'use client'
// ── The sentence, in a form rules can read ──────────────────────────────────
//
// Every command rule asks the same handful of questions: is this word in here,
// what number did they say, what is LEFT once the command words are taken out
// (that leftover is almost always the name of something). Written out longhand
// in each rule those questions become forty slightly-different implementations,
// and the differences are where the bugs live — one rule tolerant of a
// homophone and the next not, one stripping "track" and the next leaving it in.
//
// So they are answered once, here, and the rules just ask.
//
// The tolerance is the important part. A transcript is never clean: it arrives
// with a filler in front, a politeness on the end, a swallowed article, a
// homophone in the middle. What survives that reliably is the CONTENT words —
// "restart" survives, "could you" was never load-bearing — so the sentence is
// reduced to those first and every question is asked of them, with one edit of
// slack on anything long enough for that to be safe.

import { spokenNumber } from './resolve'

/**
 * What it costs a reading to bend a word that names something in the project.
 *
 * Three ordinary corrections. Enough that any reading which takes the name at
 * face value wins outright, and not so much that a project whose track is
 * called "Stop" can never be stopped.
 */
const NAME_BEND_COST = 3

/**
 * Words that carry no instruction.
 *
 * Politeness, hedging, and the noises a transcript picks up around a command.
 * Removing them first means "hey, could you please just stop it" and "stop"
 * reach the same place — which is the whole point, since people do not say the
 * second one.
 */
export const FILLER = new Set([
  'hey', 'ok', 'okay', 'um', 'uh', 'er', 'please', 'could', 'would', 'can', 'will',
  'you', 'i', 'want', 'need', 'like', 'just', 'now', 'then', 'and', 'so', 'lets',
  "let's", 'let', 'us', 'the', 'a', 'an', 'my', 'it', 'its', "it's", 'this', 'that',
  'to', 'for', 'of', 'on', 'at', 'in', 'be', 'is', 'are', 'do', 'does', 'did',
  'light', 'lights', 'beacon', 'thanks', 'thank',
  // Trailing address. "mute the pad for me" left "me" attached to the name, so
  // the lookup asked for a track called "pad me" and found nothing.
  'me', 'there', 'here',
])

/**
 * Is one of these just the plural of the other?
 *
 * A plural is not a mishearing, and charging a reading for one is a real bug
 * rather than a rounding error: rules list singular forms ("bar", "semitone",
 * "beat") and people speak plurals, so the correct reading of "up 3 semitones"
 * was being charged a full correction for the letter s and losing to a worse
 * reading by four thousandths of a point.
 */
export function pluralOf(a: string, b: string): boolean {
  return a === `${b}s` || b === `${a}s` || a === `${b}es` || b === `${a}es`
}

/** One edit apart, no more. */
export function near(a: string, b: string): boolean {
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

/** Split into meaningful words. Punctuation and case are noise here. */
export function contentWords(sentence: string): string[] {
  return String(sentence ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter(w => !FILLER.has(w))
}

/**
 * A sentence a rule can interrogate.
 *
 * Immutable and cheap: built once per utterance and handed to every rule in
 * turn, so forty rules asking forty questions still only split the string once.
 */
export class Words {
  readonly all: string[]
  /** The original text, for read-backs and for the assistant if it comes to that. */
  readonly raw: string

  // ── What this reading had to assume ──────────────────────────────────────
  //
  // Brae: "I see that words are correcting from other words, but why don't we
  // have overlapping possible changes, a context check between different
  // versions before correction."
  //
  // He is describing the failure exactly. Correcting greedily — bend the first
  // word that is one edit from a command word, commit, move on — throws away
  // the information needed to notice the correction was wrong. "bass" is one
  // edit from "bars", and a parser that has already rewritten it has nothing
  // left to compare against the fact that the project HAS a track called Bass.
  //
  // So a rule no longer just answers yes or no. It records what it consumed and
  // what it had to bend to get there, and the driver compares whole readings
  // against each other before any of them is believed. Two numbers come out of
  // that:
  //
  //   COVERAGE — how much of the sentence this reading actually explains. A
  //   reading that accounts for every word beats one that ignores half of them,
  //   which is the oldest and most reliable signal in parsing.
  //
  //   CORRECTIONS — how many words had to be bent. A reading that needs no
  //   correction beats one that needs two, all else being equal.
  //
  // Accounting is per ATTEMPT, not per sentence, which is what fork() is for.
  private readonly used = new Set<number>()
  corrections = 0

  /**
   * Words that name something real in this project.
   *
   * Bending one of these into a command word is the specific mistake Brae
   * described, and it is much worse than an ordinary correction: "bass" is one
   * edit from "bars", and rewriting it discards the very thing that identifies
   * which track was meant. So it is not forbidden — a project with a track
   * called "Stop" must still be able to stop — it is made expensive, and a
   * reading that avoids it wins unless nothing else fits at all.
   *
   * Only FUZZY hits pay this. An exact match is not a correction, so a track
   * genuinely called "Bars" costs nothing to hear as the word "bars".
   */
  private protectedWords: ReadonlySet<string> = new Set()

  constructor(sentence: string, shared?: { all: string[]; raw: string; protect: ReadonlySet<string> }) {
    if (shared) {
      this.all = shared.all
      this.raw = shared.raw
      this.protectedWords = shared.protect
      return
    }
    this.raw = String(sentence ?? '').trim()
    this.all = contentWords(sentence)
  }

  /** Tell this sentence which of its words name something real. */
  protecting(names: ReadonlySet<string>): this {
    this.protectedWords = names
    return this
  }

  /** What bending this particular word costs. */
  private bendCost(word: string, target: string): number {
    // Hearing "semitones" where a rule wrote "semitone" is not a correction at
    // all, so it costs nothing.
    if (pluralOf(word, target)) return 0
    return this.protectedWords.has(word) ? NAME_BEND_COST : 1
  }

  /**
   * A fresh accounting over the same words.
   *
   * The sentence is split once; each rule gets its own tally, so twenty rules
   * reading the same sentence stay independent without twenty string splits.
   */
  fork(): Words {
    return new Words('', { all: this.all, raw: this.raw, protect: this.protectedWords })
  }

  /** Note that a word was consumed, and what it cost to read it that way. */
  private mark(index: number, cost: number): void {
    this.used.add(index)
    this.corrections += cost
  }

  /** Mark a word this rule consumed by value rather than position — used by
   *  name resolution, which works on the leftover rather than on indices. */
  markWord(word: string, cost = 0): void {
    const i = this.all.indexOf(word)
    if (i >= 0) this.mark(i, cost)
    else this.corrections += cost
  }

  /**
   * How much of the sentence this reading explains, 0–1.
   *
   * The denominator is every content word. A command that read "mute" out of
   * "mute the drums" and never accounted for "drums" scores 0.5 and loses to
   * one that accounts for both.
   */
  coverage(): number {
    return this.all.length ? this.used.size / this.all.length : 0
  }

  /** The words this reading could not account for. Shown when asking. */
  unexplained(): string[] {
    return this.all.filter((_, i) => !this.used.has(i))
  }

  get length(): number { return this.all.length }

  /**
   * Is any of these words in the sentence — exactly, or one edit away?
   *
   * The edit slack only applies from four letters up. Below that it does more
   * harm than good: at three letters almost everything is one edit from
   * everything else, and "pan" would answer to "pad", which is a track name.
   */
  has(...targets: string[]): boolean {
    // Exact matches are looked for across the WHOLE sentence before any
    // correction is considered. Otherwise a rule bends the first word that is
    // merely close while the word it actually wanted sits later in the same
    // sentence, unread — the correction wins by being early rather than by
    // being right.
    for (let i = 0; i < this.all.length; i++) {
      if (targets.includes(this.all[i])) { this.mark(i, 0); return true }
    }
    for (let i = 0; i < this.all.length; i++) {
      const w = this.all[i]
      for (const t of targets) {
        if (t.length >= 4 && Math.abs(w.length - t.length) <= 1 && near(w, t)) {
          this.mark(i, this.bendCost(w, t))
          return true
        }
      }
    }
    return false
  }

  /** Does the sentence contain these two words next to each other, in order? */
  hasPhrase(...phrase: string[]): boolean {
    if (!phrase.length) return false
    for (let i = 0; i + phrase.length <= this.all.length; i++) {
      let ok = true
      let bent = 0
      for (let j = 0; j < phrase.length; j++) {
        const w = this.all[i + j], t = phrase[j]
        if (w === t) continue
        if (t.length >= 4 && Math.abs(w.length - t.length) <= 1 && near(w, t)) { bent += this.bendCost(w, t); continue }
        ok = false; break
      }
      if (ok) {
        for (let j = 0; j < phrase.length; j++) this.mark(i + j, j === 0 ? bent : 0)
        return true
      }
    }
    return false
  }

  /** The first number anywhere in the sentence, spoken or written. */
  num(): number | null {
    for (let i = 0; i < this.all.length; i++) {
      const n = spokenNumber(this.all[i])
      if (n != null) { this.mark(i, 0); return n }
    }
    return null
  }

  /** Every number in the sentence, in the order they were said. */
  nums(): number[] {
    const out: number[] = []
    for (let i = 0; i < this.all.length; i++) {
      const n = spokenNumber(this.all[i])
      if (n != null) { this.mark(i, 0); out.push(n) }
    }
    return out
  }

  /**
   * Was this word said AT ALL — filler included?
   *
   * Normally the small words are noise and stripping them is what makes the
   * parser robust. But a few commands ARE small words: "fade in" and "fade out"
   * differ by one, "loop on" and "loop off" likewise, and "in" and "on" are
   * both filler everywhere else in the language. Those rules ask the raw
   * sentence instead of the stripped one — exactly, with no edit slack, since a
   * two-letter word one edit from another two-letter word is most of English.
   */
  said(...targets: string[]): boolean {
    const text = ` ${this.raw.toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ').replace(/\s+/g, ' ')} `
    return targets.some(t => text.includes(` ${t.toLowerCase()} `))
  }

  /** Is every word in the sentence one of these? Used to prove a sentence is
   *  ENTIRELY about one thing — "play" alone is the transport, "play the bass
   *  louder" is not. */
  only(allowed: Set<string>): boolean {
    return this.all.every(w => allowed.has(w))
  }

  /**
   * Name extraction deliberately does NOT live here.
   *
   * Pulling the command's own words out of a sentence to find the name left
   * over sounds like a string operation, and it is not: it needs to know the
   * project's track names. Removing words by fuzzy match without them deletes
   * the answer — "bass" is one edit from "bars", so "close the filter on the
   * bass over 4 bars" lost its track and resolved to nothing. See nameFrom() in
   * ./commands, which protects any word that names something real.
   */
}
