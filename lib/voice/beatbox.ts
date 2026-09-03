// Saying a beat out loud and getting that beat.
//
// Brae: "users can use filler words to create beats with their voice. This way
// the user can say something like 'I want to make a beat like boom ka boom boom
// ka' It will be able to decipher that and turn it into a drum beat based on
// the timing."
//
// Two jobs, and they are independent: WHICH drum each syllable means, and WHEN
// it happened. Keeping them apart matters because the second one degrades — a
// browser's own recogniser hands back words with no timings at all — and a beat
// with guessed timing is still a beat, while a beat with guessed drums is
// noise.
//
// ── Why this cannot be a lookup table alone ─────────────────────────────────
//
// Nobody is transcribing beatbox syllables accurately. Ask a speech model for
// "boom ka boom boom ka" and it will happily return "boom car boom boom ka",
// "bloom kah", or "b um ka". A table of exact spellings would work in a test
// and fail on a person. So the table is a fast path over a phonetic fallback:
// what a syllable SOUNDS like decides the drum, and that survives the
// transcriber being wrong about the spelling.
//
// The rule behind the fallback is the one vocal percussion has always used:
// a low voiced plosive on a round vowel is the kick (boom, dum, buh), a sharp
// unvoiced attack on an open vowel is the snare (ka, ta, pah), and anything
// that is mostly hiss is a cymbal (ts, chh, sss).

import { DRUM_LANES, STEP_BEATS, STEPS_PER_BAR } from '@/lib/drum-presets'
import type { MidiNote } from '@/lib/daw-types'

export type LaneKey = (typeof DRUM_LANES)[number]['key']

/** A word as the transcriber heard it. `s`/`e` are seconds, when it says. */
export interface SpokenWord {
  word: string
  s?: number
  e?: number
}

export interface BeatHit {
  lane: LaneKey
  /** Position on the 16th-note grid, 0-based. */
  step: number
  velocity: number
  /** The syllable this came from, so the studio can say what it heard. */
  word: string
}

export interface ParsedBeat {
  hits: BeatHit[]
  /** Grid length, always a whole number of bars. */
  steps: number
  bars: number
  /** 'heard' when real word timings placed the hits; 'even' when they were
   *  spaced by hand because the recogniser gave no times. Worth saying out
   *  loud — the two produce very different beats from the same words. */
  timing: 'heard' | 'even'
  /** Syllables that were not drum sounds. Usually the sentence in front. */
  ignored: string[]
}

// ── Which drum a syllable means ────────────────────────────────────────────
//
// The fast path. Spellings people and transcribers actually produce, not a
// phonetic ideal.
const LEXICON: Record<string, LaneKey> = {}
const define = (lane: LaneKey, ...words: string[]) => { for (const w of words) LEXICON[w] = lane }

define('kick',
  'boom', 'bloom', 'boo', 'bom', 'bomb', 'bum', 'bump', 'buh', 'bu', 'bo', 'b',
  'doom', 'dum', 'dumb', 'dun', 'duh', 'dom', 'thump', 'thud',
  'kick', 'puh', 'pum', 'poom', 'booms')
define('snare',
  'ka', 'kah', 'cah', 'ca', 'car', 'k', 'kat', 'kap', 'cat', 'cap',
  'ta', 'tah', 'tak', 'tat', 'tap', 'pa', 'pah', 'pat', 'pak',
  'bap', 'pop', 'pow', 'crack', 'clack', 'whack', 'snare')
define('closedHat',
  'ts', 'tss', 'tsk', 'ch', 'chh', 'chk', 'chick', 'chik', 'tick', 'tik', 'tik',
  'ss', 'sss', 's', 't', 'hat', 'tch', 'ki', 'chi', 'tss')
define('openHat', 'tsss', 'tssss', 'shh', 'shhh', 'sh', 'ssh', 'chhh', 'ish', 'tish', 'tsh')
define('crash',   'crash', 'ksh', 'pssh', 'psh', 'splash', 'cash', 'kssh')
define('clap',    'clap', 'snap', 'klap')
define('rim',     'rim', 'klick', 'clik')
define('tomHi',   'tee', 'ti')
define('tomMid',  'tom', 'dow', 'doh')
define('tomLo',   'dow', 'daw', 'duh-duh')

// ⚠️ Words that are ENGLISH first and drum-shaped second.
//
// The phonetic fallback is deliberately loose, and loose costs something: "t"
// plus an open vowel reads as a snare, which makes "tempo" a snare and "that
// cat" a two-hit beat. Both are sentences somebody will say to this studio.
// Beatbox syllables are nonsense; real words that merely resemble them are the
// false positives, so they are named. Words that ARE percussion vocabulary
// (kick, snare, tick, pop) stay mappable — saying them is a real way to ask for
// a beat.
const STOP = new Set([
  'that', 'the', 'this', 'these', 'those', 'them', 'then', 'than', 'they',
  'to', 'too', 'two', 'do', 'does', 'done', 'go', 'get', 'got', 'give',
  'be', 'by', 'but', 'put', 'take', 'talk', 'tell', 'top', 'tape', 'test',
  'can', 'come', 'could', 'would', 'keep', 'cut', 'copy', 'back', 'bad',
  'big', 'bit', 'box', 'buy', 'down', 'day', 'de', 'tempo', 'track', 'time',
  'beat', 'bar', 'bars', 'bass', 'key', 'clip', 'click', 'take', 'play',
  'good', 'goes', 'boot', 'bud', 'don', 'a', 'at', 'it', 'is', 'in', 'and',
])

// A beatbox syllable is short. Nothing longer than this reaches the phonetic
// fallback, so a long English word can never be guessed into a drum.
const MAX_SYLLABLE = 5

const VOWELS = /[aeiouy]/
const ROUND = /(oo+|ou|o|u)/          // boom, dum, buh
const OPEN  = /(aa+|ah|a|e)/          // ka, ta, pah
const SIBILANT = /(ts|tsh|sh|ch|ss|s|z|x)/

/**
 * The drum a syllable means, or null if it is just a word.
 *
 * ⚠️ Order matters. The hiss test runs BEFORE the plosive tests because "ts"
 * and "ch" begin with letters that would otherwise read as a snare, and a
 * hi-hat misheard as a snare is the single most obvious way this gets a beat
 * wrong — it turns a groove into a march.
 */
export function laneForWord(raw: string): LaneKey | null {
  const w = raw.toLowerCase().replace(/[^a-z]/g, '')
  if (!w) return null
  // The table wins: 'kick' and 'pop' are percussion words even though they are
  // also English.
  const known = LEXICON[w]
  if (known) return known
  if (STOP.has(w) || w.length > MAX_SYLLABLE) return null

  // Mostly hiss, barely a vowel: a cymbal. Length decides open vs closed —
  // that is exactly the distinction a person makes when they say "tss" against
  // "tssss".
  const vowels = (w.match(/[aeiou]/g) ?? []).length
  if (SIBILANT.test(w) && vowels <= 1) {
    const tail = /(s{2,}|h{2,})$/.test(w)
    return tail || w.length >= 5 ? 'openHat' : 'closedHat'
  }

  if (!VOWELS.test(w)) return w.length <= 3 ? 'closedHat' : null

  // Voiced, low, round — the kick.
  if (/^(b|p|d|g|th|v)/.test(w) && ROUND.test(w)) return 'kick'
  // Sharp attack on an open vowel — the snare.
  if (/^(k|c|q|t|p|g)/.test(w) && OPEN.test(w)) return 'snare'
  // A bare plosive with any vowel still reads as a kick more often than not.
  if (/^(b|d)/.test(w) && w.length <= 4) return 'kick'

  return null
}

/**
 * The part of what was said that is actually the beat.
 *
 * A person says "I want to make a beat like boom ka boom boom ka", so the beat
 * is at the END, after a sentence that is not a beat. Taking the longest
 * TRAILING run of drum syllables strips the preamble without needing to
 * understand it — and without a list of lead-in phrases that would have to grow
 * forever.
 *
 * ⚠️ A single stray syllable is not a beat. "make a beat like that" ends in
 * words that mean nothing percussive, but a sentence ending in one accidental
 * match ("...like a cat") would otherwise become a one-hit drum part.
 */
export function beatWordsOf(words: SpokenWord[]): { beat: SpokenWord[]; ignored: string[] } {
  const mapped = words.map(w => ({ w, lane: laneForWord(w.word) }))
  let start = mapped.length
  for (let i = mapped.length - 1; i >= 0; i--) {
    if (!mapped[i].lane) break
    start = i
  }
  const run = mapped.slice(start)
  if (run.length < 2) return { beat: [], ignored: words.map(w => w.word) }
  return { beat: run.map(x => x.w), ignored: mapped.slice(0, start).map(x => x.w.word) }
}

/**
 * Turn what was said into hits on the 16th-note grid.
 *
 * `bpm` converts seconds to beats, so it must be the tempo the person was
 * hearing — the metronome's, which is the song's.
 *
 * `originSec` is the moment the grid starts. With the metronome running that
 * is a real downbeat, and passing it is what makes "sing along to the click"
 * land on the beat instead of merely in time with itself. Without it, the first
 * syllable becomes beat one, which is right for someone speaking a beat with no
 * click.
 */
export function parseSpokenBeat(
  words: SpokenWord[],
  opts: { bpm: number; originSec?: number; maxBars?: number } = { bpm: 120 },
): ParsedBeat {
  const bpm = opts.bpm > 0 ? opts.bpm : 120
  const maxBars = opts.maxBars ?? 4
  const { beat, ignored } = beatWordsOf(words)
  if (!beat.length) return { hits: [], steps: STEPS_PER_BAR, bars: 1, timing: 'even', ignored }

  const timed = beat.every(w => typeof w.s === 'number')
    && new Set(beat.map(w => w.s)).size === beat.length

  const raw: BeatHit[] = []
  if (timed) {
    const origin = opts.originSec ?? (beat[0].s as number)
    for (const w of beat) {
      const beats = ((w.s as number) - origin) * bpm / 60
      const step = Math.round(beats / STEP_BEATS)
      if (step < 0) continue
      raw.push({ lane: laneForWord(w.word)!, step, velocity: 0, word: w.word })
    }
  } else {
    // ⚠️ No timings, so this is NOT the rhythm they said — it is an even one.
    // Eighths up to eight syllables, sixteenths beyond, which is how a spoken
    // beat is almost always meant. The caller is told, so it can say so.
    const sub = beat.length <= 8 ? 2 : 1
    beat.forEach((w, i) => raw.push({ lane: laneForWord(w.word)!, step: i * sub, velocity: 0, word: w.word }))
  }

  if (!raw.length) return { hits: [], steps: STEPS_PER_BAR, bars: 1, timing: timed ? 'heard' : 'even', ignored }

  // One bar minimum, and a whole number of bars — a loop that ends mid-bar does
  // not loop, it stumbles.
  const last = Math.max(...raw.map(h => h.step))
  const bars = Math.min(maxBars, Math.max(1, Math.ceil((last + 1) / STEPS_PER_BAR)))
  const steps = bars * STEPS_PER_BAR

  const seen = new Set<string>()
  const hits: BeatHit[] = []
  for (const h of raw) {
    if (h.step >= steps) continue                 // past the loop: dropped, not wrapped
    const key = `${h.lane}:${h.step}`
    if (seen.has(key)) continue                   // two syllables, one drum, one moment
    seen.add(key)
    // Downbeats louder. Deterministic on purpose — the same sentence should
    // give the same beat every time, and a random velocity is the kind of
    // detail that makes a feature feel unreliable without ever looking broken.
    hits.push({ ...h, velocity: h.step % 4 === 0 ? 108 : 92 })
  }
  hits.sort((a, b) => a.step - b.step)

  return { hits, steps, bars, timing: timed ? 'heard' : 'even', ignored }
}

const pitchOf = new Map(DRUM_LANES.map(l => [l.key, l.pitch]))

/** The hits as notes for a drum clip. */
export function beatToNotes(beat: ParsedBeat, newId: () => string): MidiNote[] {
  return beat.hits.map(h => ({
    id: newId(),
    pitch: pitchOf.get(h.lane) ?? 36,
    startBeat: h.step * STEP_BEATS,
    durationBeats: STEP_BEATS,
    velocity: h.velocity,
  }))
}

/** "kick, hat, kick, kick, hat" — what the studio says it heard. */
export function describeBeat(beat: ParsedBeat): string {
  if (!beat.hits.length) return 'nothing I could turn into drums'
  const label = new Map(DRUM_LANES.map(l => [l.key, l.label.toLowerCase()]))
  const names = beat.hits.map(h => label.get(h.lane) ?? h.lane)
  const counts = new Map<string, number>()
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1)
  return [...counts].map(([n, c]) => (c > 1 ? `${c} ${n}s` : `1 ${n}`)).join(', ')
}
