'use client'
// Everything the studio can do, as a searchable list.
//
// The studio has a lot of surface: three views, a device chain, a piano roll, a
// mixer, an Apollo rack, effect lanes, a sound library. All of it is reachable,
// and none of it is reachable QUICKLY — you have to know which panel a thing
// lives in before you can use it. That is the cost this file exists to remove:
// press one key, type what you want, get it.
//
// A command is deliberately dumb — a label, some words that should find it, and
// something to run. The registry is built fresh from the studio's context on
// every open, so commands can read the CURRENT selection and say useful things
// like "Mute Bass" rather than "Mute selected track".

/** What ranking needs. Structural on purpose, so this sorts the editor's real
 *  Command objects (lib/commands.ts) without importing or duplicating them. */
export interface Rankable {
  label: string
  keywords?: string
  group?: string
}

/**
 * Score a command against what has been typed.
 *
 * Returns -1 for no match. Higher is better. The rules are ordered by how
 * confident they make us: an exact label beats a prefix, a prefix beats a word
 * boundary, and a subsequence match ("wvtb" finding "Wavetable") comes last
 * because it is the loosest and would otherwise drown the obvious answers.
 */
export function scoreCommand(cmd: Rankable, query: string): number {
  const q = query.trim().toLowerCase()
  if (!q) return 0
  const label = cmd.label.toLowerCase()
  const hay = `${label} ${cmd.keywords ?? ''} ${cmd.group}`.toLowerCase()

  if (label === q) return 1000
  if (label.startsWith(q)) return 900 - label.length
  // A match at the start of any word — "mix" finding "Open Mixer".
  if (new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(label)) return 800 - label.length
  if (label.includes(q)) return 700 - label.length
  if (hay.includes(q)) return 600 - label.length

  // Subsequence: every character in order, anywhere. Cheap fuzzy matching that
  // rewards matches packed close together, so "arr" prefers "Arrangement" over
  // a label where a, r and r happen to be scattered across three words.
  // Several words typed together mean "all of these", matched independently —
  // "rename clip" should find "Rename the clip under the playhead" even though
  // those two words never sit next to each other. Confining the fuzzy match to
  // one word (below) is right for abbreviations and wrong here, so a multi-word
  // query is scored as every term having to land somewhere.
  const terms = q.split(/\s+/).filter(Boolean)
  if (terms.length > 1) {
    let total = 0
    for (const t of terms) {
      if (new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(hay)) total += 100
      else if (hay.includes(t)) total += 60
      else return -1
    }
    return Math.max(1, 500 + total - label.length)
  }

  // ...but WITHIN A SINGLE WORD, and starting at that word's first letter.
  //
  // Letting a subsequence wander across the whole haystack is what made this
  // matcher lie. Every command carries a long keyword list, so given enough
  // text almost any word can be spelled out of almost any command — and the
  // longer the query the easier that gets, which is exactly backwards. Live,
  // "humanise" returned "Change the studio's colours", "vocoder" found "Play
  // harder" (v-o-c from "velocity", o-d-e-r from "louder"), and "autotune"
  // found "Draw volume automation". Each answer was confident and wrong, which
  // is worse than an empty list: it teaches people the palette doesn't
  // understand them, and they stop typing.
  //
  // Confining it to one word matches what abbreviating actually is — "wvtb" is
  // a squeezed "wavetable", not letters gathered from four different words.
  // Queries that genuinely span words ("mute bass") are already handled above,
  // as a substring of the label.
  let best = -1
  for (const word of hay.split(/[^a-z0-9]+/)) {
    if (word.length < q.length || word[0] !== q[0]) continue
    let i = 0, gaps = 0, ok = true
    for (const ch of q) {
      const at = word.indexOf(ch, i)
      if (at === -1) { ok = false; break }
      if (i > 0) gaps += at - i
      i = at + 1
    }
    if (ok) best = Math.max(best, 400 - gaps)
  }
  if (best < 0) return -1

  return Math.max(1, best)
}

/** Rank commands for a query, best first, dropping non-matches. */
export function rankCommands<T extends Rankable>(commands: T[], query: string): T[] {
  if (!query.trim()) return commands
  return commands
    .map(c => ({ c, s: scoreCommand(c, query) }))
    .filter(x => x.s >= 0)
    .sort((a, b) => b.s - a.s)
    .map(x => x.c)
}
