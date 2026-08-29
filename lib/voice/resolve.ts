// Turning what someone SAID into things in their project.
//
// "loop 'bass 2' three more times" only means something once "bass 2" is a real
// track or clip and "three more times" is a number of beats. That translation
// is where a voice system is mostly right and occasionally, confidently wrong —
// so it lives here, on its own, where it can be tested without a microphone.
//
// Two rules shape all of it:
//
//   Never guess silently. Every resolver returns the match AND how it was
//   found, so the UI can say "I used Bass 2" and the user can tell instantly
//   that it picked the wrong thing. A voice command that edits the wrong track
//   without saying so is worse than one that fails.
//
//   Speech is not typing. A transcript says "bass two", "Bass 2", "the bass
//   too" — so matching folds case, digits-vs-words, and punctuation before
//   comparing, rather than hoping for an exact string.

export interface NamedThing { id: string; name?: string }

export interface Match<T> {
  item: T
  /** How sure we are, 0..1 — 1 is an exact name, lower is a fuzzier route. */
  score: number
  /** Why this matched, shown to the user: "exact name", "starts with", … */
  how: string
}

// ── Normalising speech ──────────────────────────────────────────────────────

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, sixteen: 16, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, hundred: 100,
}

/**
 * Fold a spoken name into something comparable.
 *
 * "Bass 2" and "bass two" and "the bass, 2" all have to reach the same string,
 * because a transcriber picks whichever it likes and the user does not know
 * which one it picked.
 */
export function foldName(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[''`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map(w => (w in NUMBER_WORDS ? String(NUMBER_WORDS[w]) : w))
    .filter(w => w !== 'the')          // "the bass" is "bass"
    .join(' ')
    .trim()
}

/** "three", "3", "a couple" → a number, or null when it is not one. */
export function spokenNumber(s: string | number | undefined | null): number | null {
  if (typeof s === 'number') return Number.isFinite(s) ? s : null
  if (s == null) return null
  const t = String(s).trim().toLowerCase()
  if (!t) return null
  const digits = t.match(/-?\d+(\.\d+)?/)
  if (digits) return Number(digits[0])
  if (t === 'a' || t === 'an' || t === 'once') return 1
  if (t === 'a couple' || t === 'couple' || t === 'twice') return 2
  if (t === 'a few') return 3
  const w = NUMBER_WORDS[t]
  return w == null ? null : w
}

/** "80%", "80", 0.8 → 0.8. Percentages and 0..1 both mean the same thing. */
export function spokenFraction(s: string | number | undefined | null): number | null {
  if (s == null) return null
  if (typeof s === 'number') return s > 1 ? s / 100 : s
  const t = String(s).trim()
  const n = spokenNumber(t)
  if (n == null) return null
  if (/%/.test(t) || n > 1) return n / 100
  return n
}

// ── Finding the thing they meant ────────────────────────────────────────────

/**
 * The best match for a spoken name among things that have one.
 *
 * Tried in descending confidence: the whole folded name, then a prefix, then
 * "all the words appear". Anything vaguer than that returns null rather than a
 * guess — "loop the thing" should ask, not pick track one.
 */
export function findByName<T extends NamedThing>(spoken: string, items: T[]): Match<T> | null {
  const want = foldName(spoken)
  if (!want) return null
  const named = items.filter(i => (i.name ?? '').trim())

  const exact = named.filter(i => foldName(i.name!) === want)
  if (exact.length === 1) return { item: exact[0], score: 1, how: 'exact name' }
  // Two tracks genuinely called the same thing: the first is as good a guess as
  // any, but say the name was ambiguous so the UI can show it.
  if (exact.length > 1) return { item: exact[0], score: 0.6, how: `${exact.length} tracks share that name` }

  const starts = named.filter(i => foldName(i.name!).startsWith(want))
  if (starts.length === 1) return { item: starts[0], score: 0.85, how: 'name starts with that' }

  const contains = named.filter(i => foldName(i.name!).includes(want))
  if (contains.length === 1) return { item: contains[0], score: 0.75, how: 'name contains that' }

  // Every spoken word appears somewhere in the name, in any order — catches
  // "the second bass" against "Bass 2".
  const words = want.split(' ').filter(Boolean)
  const allWords = named.filter(i => {
    const n = foldName(i.name!)
    return words.every(w => n.includes(w))
  })
  if (allWords.length === 1) return { item: allWords[0], score: 0.6, how: 'all those words are in the name' }

  return null
}

// ── Time, in the units a musician speaks ────────────────────────────────────

export interface Timing { tempo: number; beatsPerBar: number }

/** Seconds → beats. "the first 8 seconds" has to become a beat range. */
export const secondsToBeats = (sec: number, t: Timing): number => (sec * t.tempo) / 60

/** Beats → seconds. */
export const beatsToSeconds = (beats: number, t: Timing): number => (beats * 60) / t.tempo

/** Bars → beats. "move everything over by one bar". */
export const barsToBeats = (bars: number, t: Timing): number => bars * t.beatsPerBar

/**
 * A spoken duration in whatever unit was said, as beats.
 *
 * Accepts { seconds } or { bars } or { beats }; returns null when none was
 * given, so a caller can tell "they did not say" from "they said zero".
 */
export function durationToBeats(
  d: { seconds?: number | null; bars?: number | null; beats?: number | null } | null | undefined,
  t: Timing,
): number | null {
  if (!d) return null
  if (d.beats != null && Number.isFinite(d.beats)) return d.beats
  if (d.bars != null && Number.isFinite(d.bars)) return barsToBeats(d.bars, t)
  if (d.seconds != null && Number.isFinite(d.seconds)) return secondsToBeats(d.seconds, t)
  return null
}
