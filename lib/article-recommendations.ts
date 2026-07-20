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

/** Age at which the recency bonus has halved. */
const RECENCY_HALF_LIFE_DAYS = 45
/** How much a brand-new article is favoured over an old one, at most. */
const RECENCY_MAX_BOOST = 1.5

/**
 * Multiplier that fades from 2.5× on the day of publication toward 1× as an
 * article ages.
 *
 * Deliberately a multiplier on top of tag relevance rather than a term beside
 * it. Publishing daily means new pieces would otherwise sit at the back of
 * every shortlist forever, since they compete against a growing pile of older
 * articles with identical tag overlap — but recency must never let an
 * unrelated new article outrank a well-matched old one, and as a bounded
 * multiplier inside the related tier it can't.
 */
export function recencyBoost(date: string, now: number = Date.now()): number {
  const t = Date.parse(date)
  if (Number.isNaN(t)) return 1
  const ageDays = Math.max(0, (now - t) / 86400_000)
  return 1 + RECENCY_MAX_BOOST * Math.exp(-ageDays / RECENCY_HALF_LIFE_DAYS)
}

/**
 * Weight for a candidate that shares at least one tag.
 *
 * Squared, so two shared tags is four times as likely as one rather than
 * merely twice — with only three slots the difference has to be pronounced
 * to be felt at all.
 */
export function weightFor(shared: number): number {
  return shared * shared
}

/** Draw one item, chance proportional to weight. Mutates `pool`. */
function drawWeighted<T extends { weight: number }>(pool: T[], rng: () => number): T | undefined {
  const total = pool.reduce((s, c) => s + c.weight, 0)
  if (total <= 0) return pool.splice(Math.floor(rng() * pool.length), 1)[0]
  let r = rng() * total
  let idx = pool.length - 1          // guard against float drift at the tail
  for (let i = 0; i < pool.length; i++) {
    r -= pool[i].weight
    if (r <= 0) { idx = i; break }
  }
  return pool.splice(idx, 1)[0]
}

/**
 * Pick [count] recommendations, weighted by shared tags, without repeats.
 *
 * Articles sharing a tag are drawn first and exhausted before any unrelated
 * one is considered. An earlier version gave zero-overlap articles a small
 * floor weight instead, which sounds harmless but isn't: with 23 articles and
 * only three slots, the ~14 unrelated candidates collectively outvoted the
 * related ones often enough to take roughly a fifth of all slots. Three slots
 * is too few to spend any of them on an article that has nothing to do with
 * what someone just read — the fallback exists only so a piece with unique
 * tags isn't a dead end.
 *
 * [rng] is injectable so the selection can be tested deterministically.
 */
export function pickRecommendations(
  current: LearnArticle,
  all: LearnArticle[],
  count = 3,
  rng: () => number = Math.random,
  now: number = Date.now(),
): Recommendation[] {
  const candidates = all
    .filter(a => a.slug !== current.slug && !a.draft)
    .map(a => {
      const shared = sharedTags(current, a)
      // Recency scales the tag weight rather than adding to it, so a fresh
      // article rises among equally-related ones without ever jumping ahead
      // of a better-matched older one.
      return {
        article: a,
        shared,
        weight: weightFor(shared.length) * recencyBoost(a.date, now),
      }
    })

  const related = candidates.filter(c => c.shared.length > 0)
  const unrelated = candidates.filter(c => c.shared.length === 0)

  const picked: Recommendation[] = []
  while (picked.length < count && related.length > 0) {
    const c = drawWeighted(related, rng)
    if (!c) break
    picked.push({ article: c.article, shared: c.shared })
  }
  // Only now, and only to fill what's left. These carry weight 0 from the
  // tag term, so give them the recency multiplier alone — otherwise the
  // fallback would be a flat coin-flip across everything unrelated.
  for (const c of unrelated) c.weight = recencyBoost(c.article.date, now)
  while (picked.length < count && unrelated.length > 0) {
    const c = drawWeighted(unrelated, rng)
    if (!c) break
    picked.push({ article: c.article, shared: c.shared })
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
