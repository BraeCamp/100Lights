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
  let i = 0, gaps = 0, last = -1
  for (const ch of q) {
    const at = hay.indexOf(ch, i)
    if (at === -1) return -1
    if (last >= 0) gaps += at - last - 1
    last = at
    i = at + 1
  }
  return Math.max(1, 400 - gaps)
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
