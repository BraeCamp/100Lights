/**
 * Tag-weighted article recommendations.
 *
 * An article's chance of being recommended scales with how many tags it
 * shares with the one being read, so a piece tagged `chords, theory` is far
 * more likely to surface under another chords/theory article than under a
 * mixing one — but not guaranteed, so the same article doesn't always sit
 * under the same neighbours. Rotation matters here: fixed "related posts"
 * concentrate internal links on a handful of pages, while a rotating set
 * spreads them across the whole section over time.
 */

import type { LearnArticle } from './learn-articles'

export interface Recommendation {
  article: LearnArticle
  /** Tags in common with the article being read. */
  shared: string[]
}

const norm = (t: string) => t.trim().toLowerCase()

/** How many tags two articles have in common. */
export function sharedTags(a: LearnArticle, b: LearnArticle): string[] {
  const set = new Set(a.tags.map(norm))
  return b.tags.filter(t => set.has(norm(t)))
}

/**
 * Weight for one candidate.
 *
 * Squared so that the difference between one shared tag and three is
 * pronounced rather than merely present — with linear weights a
 * three-tag match is only 3× as likely as a one-tag match, which in practice
 * reads as almost random. Zero-overlap articles keep a small floor so a
 * niche piece with unique tags still has somewhere to send readers.
 */
export function weightFor(shared: number): number {
  return shared === 0 ? 0.15 : shared * shared
}

/**
 * Pick [count] recommendations, weighted by shared tags, without repeats.
 *
 * [rng] is injectable so the selection can be tested deterministically and so
 * callers can seed it — see `seededRng`.
 */
export function pickRecommendations(
  current: LearnArticle,
  all: LearnArticle[],
  count = 3,
  rng: () => number = Math.random,
): Recommendation[] {
  const pool = all
    .filter(a => a.slug !== current.slug && !a.draft)
    .map(a => {
      const shared = sharedTags(current, a)
      return { article: a, shared, weight: weightFor(shared.length) }
    })

  const picked: Recommendation[] = []
  const remaining = [...pool]

  while (picked.length < count && remaining.length > 0) {
    const total = remaining.reduce((s, c) => s + c.weight, 0)
    if (total <= 0) break
    let r = rng() * total
    let idx = remaining.length - 1        // guard against float drift at the tail
    for (let i = 0; i < remaining.length; i++) {
      r -= remaining[i].weight
      if (r <= 0) { idx = i; break }
    }
    const [chosen] = remaining.splice(idx, 1)
    picked.push({ article: chosen.article, shared: chosen.shared })
  }

  return picked
}

/**
 * Deterministic RNG from a string seed (mulberry32 over a cheap string hash).
 *
 * Used so a given article's recommendations are stable within one render —
 * the server and any re-render agree — while still differing per article and
 * rotating whenever the seed includes something time-based.
 */
export function seededRng(seed: string): () => number {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  let a = h >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
