// Saying a chord out loud.
//
// Brae: "For piano roll the user can say the name of the chord or similarly
// create a shorthand, like numbers or terms."
//
// ⚠️ This INVERTS lib/chord-analysis.ts's own QUALITIES table rather than
// carrying a second list of chord shapes. The two have to agree: "what chord is
// this" reads pitches through that table, and this writes pitches through it,
// so a chord you asked for by name must be named back the same way. Two tables
// would drift on the first chord anybody added to one of them.
//
// The hard part is not the theory, it is that a chord's NAME is several words
// ("E flat minor seven") while a beat is one moment. So parsing is greedy from
// the front and every chord keeps the time of its FIRST word — the moment you
// started saying it is the moment you meant.

import { QUALITIES } from '@/lib/chord-analysis'

const NOTE_PC: Record<string, number> = {
  c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11,
}

/** Spoken accidentals, including the ones a transcriber produces. */
const SHARP = new Set(['sharp', '#', 'sharps'])
const FLAT = new Set(['flat', 'b', '♭', 'flats'])

/**
 * Spoken quality → the interval set, longest first so "minor seven" is not
 * eaten by "minor".
 *
 * Built from QUALITIES so the shapes are shared, with the spoken spellings
 * layered on top — nobody says "m7♭5" out loud.
 */
const SPOKEN_QUALITY: Array<{ words: string[]; suffix: string }> = [
  { words: ['major', 'seven'], suffix: 'maj7' },
  { words: ['major', 'seventh'], suffix: 'maj7' },
  { words: ['maj', 'seven'], suffix: 'maj7' },
  { words: ['minor', 'seven'], suffix: 'm7' },
  { words: ['minor', 'seventh'], suffix: 'm7' },
  { words: ['min', 'seven'], suffix: 'm7' },
  { words: ['half', 'diminished'], suffix: 'm7♭5' },
  { words: ['dominant', 'seven'], suffix: '7' },
  { words: ['seven'], suffix: '7' },
  { words: ['seventh'], suffix: '7' },
  { words: ['six'], suffix: '6' },
  { words: ['sixth'], suffix: '6' },
  { words: ['sus', 'four'], suffix: 'sus4' },
  { words: ['sus', 'two'], suffix: 'sus2' },
  { words: ['suspended', 'four'], suffix: 'sus4' },
  { words: ['suspended', 'two'], suffix: 'sus2' },
  { words: ['sus'], suffix: 'sus4' },
  { words: ['augmented'], suffix: 'aug' },
  { words: ['aug'], suffix: 'aug' },
  { words: ['diminished'], suffix: 'dim' },
  { words: ['dim'], suffix: 'dim' },
  { words: ['minor'], suffix: 'm' },
  { words: ['min'], suffix: 'm' },
  { words: ['major'], suffix: '' },
  { words: ['maj'], suffix: '' },
]

const intervalsFor = (suffix: string): number[] | null =>
  QUALITIES.find(([, s]) => s === suffix)?.[0] ?? null

const clean = (w: string) => w.toLowerCase().replace(/[^a-z#♭]/g, '')

export interface SpokenChord {
  /** MIDI pitches, root first. */
  pitches: number[]
  /** What the studio will call it back — chord-analysis's own spelling. */
  name: string
  /** How many words it consumed. */
  used: number
}

/**
 * Read a chord starting at `i`, or null if there is not one there.
 *
 * ⚠️ Greedy and longest-first. "C minor seven" must not read as "C minor"
 * followed by a stray "seven", because the leftover would then look like
 * another chord's root and the bar would fill with nonsense.
 */
export function readChordAt(words: string[], i: number, octave = 4): SpokenChord | null {
  const first = clean(words[i] ?? '')
  // A single letter, possibly written as a chord symbol already: "F#m", "Bb".
  const m = /^([a-g])(#|♭|b)?(m|maj7|m7|7|dim|aug|sus4|sus2|6)?$/.exec(first)
  if (!m) return null
  let pc = NOTE_PC[m[1]]
  if (pc === undefined) return null
  let used = 1

  // Accidental, spoken or written.
  if (m[2] === '#') pc += 1
  else if (m[2] === '♭' || m[2] === 'b') pc -= 1
  else {
    const next = clean(words[i + 1] ?? '')
    // ⚠️ A bare "b" is ambiguous: B the note, or flat. It only counts as an
    // accidental AFTER another note letter, which is what this branch is.
    if (SHARP.has(next)) { pc += 1; used++ }
    else if (FLAT.has(next)) { pc -= 1; used++ }
  }

  // Quality: written on the symbol, or spoken after it.
  let suffix = m[3] ?? null
  if (suffix === null) {
    for (const q of SPOKEN_QUALITY) {
      const ok = q.words.every((w, n) => clean(words[i + used + n] ?? '') === w)
      if (!ok) continue
      suffix = q.suffix
      used += q.words.length
      break
    }
  }
  // No quality said at all is a major triad — "play a C" means C major, which
  // is what everybody means and what every chart assumes.
  const intervals = intervalsFor(suffix ?? '')
  if (!intervals) return null

  const root = 12 * (octave + 1) + ((pc % 12) + 12) % 12
  return {
    pitches: intervals.map(iv => root + iv),
    name: `${['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][((pc % 12) + 12) % 12]}${suffix ?? ''}`,
    used,
  }
}

/** The whole phrase as a chord, or null — used when defining a shorthand. */
export function parseChord(phrase: string, octave = 4): SpokenChord | null {
  const words = phrase.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return null
  const c = readChordAt(words, 0, octave)
  // Every word has to be part of the chord, or "C major thanks very much" would
  // define a shorthand for something the speaker did not say.
  return c && c.used === words.length ? c : null
}
