// What a preset SOUNDS like, in the words people use to ask for one.
//
// Brae: "Put in a baseline preset that uses low notes of 1 of the darker /
// melancolic and sad piano presets."
//
// Nothing in the studio could answer that. A preset carries a name, a group, a
// sampled range and its sound shaping — and no notion of character at all, so
// "darker" and "sad" had nothing to match against and the sentence died.
//
// ⚠️ The obvious fix is a mood tag on every preset, and it is the wrong one.
// Somebody has to write 100 of them, they are opinions rather than facts, and
// a preset a user makes tomorrow has none. But the character is ALREADY THERE,
// measurable, in `sound.fx`: "Dark Upright" is dark because its low-pass sits
// at 2.6 kHz with 5 dB off the top, not because of the word in its name. So
// character is DERIVED from the shaping. That works on presets nobody has
// tagged, including ones the user makes, and it cannot drift away from what the
// preset actually sounds like — because it IS what the preset sounds like.
//
// Neutral values come from lib/roll-fx.ts: attack 0, high-pass 20 (off),
// low-pass 18000 (open), reverb 0, gain 1, EQ 0 dB.

import type { RollFx } from '@/lib/daw-types'
import { tagsOf, ALL_TAGS } from '@/lib/sound-tags'

export interface PresetLike {
  id: string
  name: string
  group?: string
  loNote?: number
  hiNote?: number
  /** The preset's own shaping — `MidiPreset.sound.fx`. */
  fx?: RollFx | null
  /** `MidiPreset.category` / a sample's category — what it IS. */
  category?: string | null
  /** What a person wrote, if anything. Always beats a derivation. */
  tags?: string[] | null
}

/**
 * Every word this preset answers to — its own tags, what its category says it
 * is, and what it measurably sounds like.
 *
 * Brae: "We should have tags on all presets and samples that the voice control,
 * Light, can refer to." This is that list for one item, and it is the SAME
 * function the sample library uses, so "a dark pad" means one thing everywhere.
 */
export function presetTags(preset: PresetLike): string[] {
  return tagsOf({
    name: preset.name,
    category: preset.category,
    group: preset.group,
    tags: preset.tags,
    measured: characterOf(preset),
  })
}

export interface Character {
  dark: number
  bright: number
  soft: number
  warm: number
  space: number
  grit: number
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** How far a low-pass is closed, 0 = wide open, 1 = very dark. Log, because
 *  hearing is: 18 kHz to 9 kHz and 1 kHz to 500 Hz are the same size of move. */
function closedness(hz: number | undefined): number {
  if (hz == null || hz >= 17_500) return 0
  const lo = 200, hi = 18_000
  return clamp01(1 - Math.log(Math.max(lo, hz) / lo) / Math.log(hi / lo))
}

/** Score one preset's character from the shaping it actually carries. */
export function characterOf(preset: PresetLike): Character {
  const fx = (preset.fx ?? {}) as RollFx
  const treble = (fx.treble as number | undefined) ?? 0
  const bass = (fx.bass as number | undefined) ?? 0
  const closed = closedness(fx.filterHz as number | undefined)
  const highpass = (fx.highpassHz as number | undefined) ?? 20
  const attack = (fx.attack as number | undefined) ?? 0
  const gain = (fx.gain as number | undefined) ?? 1
  const reverb = (fx.reverbWet as number | undefined) ?? 0
  const size = (fx.reverbSize as number | undefined) ?? 0
  const width = (fx.width as number | undefined) ?? 1
  const crush = (fx.bitcrush as number | undefined) ?? 0
  const drive = (fx.drive as number | undefined) ?? 0
  const detune = (fx.detune as number | undefined) ?? 0

  return {
    dark: clamp01(closed * 0.75 + clamp01(-treble / 8) * 0.45),
    bright: clamp01(clamp01(treble / 8) * 0.6 + clamp01((highpass - 20) / 400) * 0.35 + (closed === 0 ? 0.12 : 0)),
    // Slow attack and a pulled-back level are what "gentle" is made of.
    soft: clamp01(clamp01(attack / 0.05) * 0.6 + clamp01((1 - gain) / 0.25) * 0.4),
    // Warmth is body WITHOUT top — a bass lift under a raised treble is not warm.
    warm: clamp01(clamp01(bass / 6) * 0.7 + clamp01(-treble / 10) * 0.3 - clamp01(treble / 6) * 0.5),
    space: clamp01(reverb * 0.75 + size * 0.15 + clamp01((width - 1) / 0.5) * 0.15),
    grit: clamp01(crush * 0.6 + drive * 0.4 + clamp01(detune / 20) * 0.35),
  }
}

/**
 * Spoken word → the traits it asks for, and how strongly.
 *
 * ⚠️ "Sad" and "melancholic" are not one dial. Nobody means a single filter by
 * them: they mean dark AND gentle, and usually a bit of room. Mapping a mood
 * onto several traits is the difference between a preset that matches the word
 * and one that matches the feeling. The NOTES carry the rest of it — a mood is
 * mostly what is played, and this only chooses what plays it.
 */
const WORDS: Record<string, Partial<Character>> = {
  dark: { dark: 1 }, darker: { dark: 1 }, darkest: { dark: 1 },
  moody: { dark: 0.8, soft: 0.3 }, sombre: { dark: 0.9, soft: 0.4 }, somber: { dark: 0.9, soft: 0.4 },
  muted: { dark: 0.7, soft: 0.3 }, shadowy: { dark: 0.9 },
  sad: { dark: 0.7, soft: 0.6, space: 0.2 },
  melancholic: { dark: 0.7, soft: 0.6, space: 0.25 },
  melancholy: { dark: 0.7, soft: 0.6, space: 0.25 },
  // ⚠️ Spelled as it is actually typed and heard. Brae wrote "meloncolic", and
  // a recogniser will hand over worse than that. A word list that only accepts
  // the dictionary spelling of a hard word is a word list that fails on the
  // sentence it was written for.
  melancolic: { dark: 0.7, soft: 0.6, space: 0.25 },
  meloncolic: { dark: 0.7, soft: 0.6, space: 0.25 },
  meloncholic: { dark: 0.7, soft: 0.6, space: 0.25 },
  melancholick: { dark: 0.7, soft: 0.6, space: 0.25 },
  mournful: { dark: 0.8, soft: 0.5, space: 0.3 },
  wistful: { dark: 0.4, soft: 0.7, space: 0.3 },
  plaintive: { dark: 0.5, soft: 0.6 },
  soft: { soft: 1 }, softer: { soft: 1 }, gentle: { soft: 1 }, mellow: { soft: 0.7, dark: 0.5 },
  intimate: { soft: 0.8, space: -0.4 }, tender: { soft: 0.9 }, delicate: { soft: 0.9 },
  felt: { soft: 0.9, dark: 0.4 },
  bright: { bright: 1 }, brighter: { bright: 1 }, crisp: { bright: 0.9 },
  sharp: { bright: 0.8 }, clear: { bright: 0.7 }, sparkly: { bright: 0.9 },
  warm: { warm: 1 }, warmer: { warm: 1 }, round: { warm: 0.8 }, rounded: { warm: 0.8 }, full: { warm: 0.7 },
  spacious: { space: 1 }, wide: { space: 0.8 }, airy: { space: 0.8, bright: 0.3 },
  cinematic: { space: 0.9 }, lush: { space: 0.8, warm: 0.3 }, ambient: { space: 0.9, soft: 0.4 },
  distant: { space: 0.9, dark: 0.3 }, big: { space: 0.7 },
  gritty: { grit: 1 }, dirty: { grit: 0.9 }, lofi: { grit: 0.8, dark: 0.4 },
  crunchy: { grit: 0.9 }, gnarly: { grit: 0.9 },
}

/**
 * Every word a person can use to pick a sound — the moods above AND the
 * library's own tag words.
 *
 * ⚠️ One list. The filter bar's chips ("Pad", "Ambient", "Crunchy") are words
 * people already see in this app, so they are the first ones they will say, and
 * a voice control that did not know its own filter bar's vocabulary would be a
 * strange thing to explain.
 */
export const CHARACTER_WORDS: string[] = [
  ...Object.keys(WORDS),
  ...ALL_TAGS.map(t => t.toLowerCase()).filter(t => !(t in WORDS)),
]

/** Does this sentence ask for a character at all? */
export function characterWordsIn(text: string): string[] {
  const words = String(text ?? '').toLowerCase().replace(/[^a-z\s-]/g, ' ').split(/\s+/)
  const known = new Set(CHARACTER_WORDS)
  const out: string[] = []
  for (const raw of words) {
    // ⚠️ PLURALS. Nobody asks for "a dark pad" when browsing — they ask "what
    // dark PADS do I have", and the tag is "Pad". The plural was simply not
    // matching, so the type word fell out of the question and the answer came
    // back full of pianos. Exact first, then the singular.
    if (known.has(raw)) { out.push(raw); continue }
    const singular = raw.replace(/e?s$/, '')
    if (singular && known.has(singular)) out.push(singular)
  }
  return out
}

export interface PresetMatch {
  preset: PresetLike
  /** Why this one — said out loud, because a choice nobody can check is a guess. */
  why: string
  /** How many presets it chose between. */
  considered: number
}

/**
 * The preset that best fits the words, within a group if one was named.
 *
 * Returns null rather than a bad match: "one of the darker piano presets" when
 * the library holds no pianos is a sentence to answer honestly, not to satisfy
 * with a dark trombone.
 */
export function matchPresetByCharacter(
  presets: PresetLike[],
  opts: { words: string[]; group?: string | null; instrument?: string | null },
): PresetMatch | null {
  const wanted: Partial<Character> = {}
  for (const w of opts.words) {
    for (const [trait, weight] of Object.entries(WORDS[w] ?? {})) {
      wanted[trait as keyof Character] = (wanted[trait as keyof Character] ?? 0) + (weight as number)
    }
  }

  const groupWanted = opts.group?.toLowerCase().trim()
  const instrument = opts.instrument?.toLowerCase().trim()
  let pool = presets
  if (groupWanted) pool = pool.filter(p => (p.group ?? '').toLowerCase() === groupWanted)
  else if (instrument) {
    // By group, by name — or by what its category says it IS. A library
    // sample sits in the "Samples" group whatever it is, so "a dark bass"
    // has to find an 808 whose category is synth-bass through its type tag.
    pool = pool.filter(p => (p.group ?? '').toLowerCase().includes(instrument)
      || p.name.toLowerCase().includes(instrument)
      || presetTags(p).some(t => t.toLowerCase().includes(instrument)))
  }
  if (!pool.length) return null
  if (!Object.keys(wanted).length) return { preset: pool[0], why: pool[0].name, considered: pool.length }

  const asked = opts.words.map(w => w.toLowerCase())
  let best: { preset: PresetLike; score: number; ch: Character } | null = null
  for (const preset of pool) {
    const ch = characterOf(preset)
    let score = 0
    for (const [trait, weight] of Object.entries(wanted)) {
      score += ch[trait as keyof Character] * (weight as number)
    }
    // ⚠️ A TAG COUNTS EVEN WHEN NOTHING MEASURES IT. "Pad", "Arp", "Glitchy"
    // are not dials — no amount of reading `sound.fx` will tell you a preset is
    // a pad — and a preset whose author tagged it by hand is stating something
    // no derivation can. Weighted above a measured trait for exactly that
    // reason: somebody wrote it down.
    const mine = new Set(presetTags(preset).map(t => t.toLowerCase()))
    for (const word of asked) if (mine.has(word)) score += 1.2
    // A preset whose NAME says the word is a deliberate statement by whoever
    // made it, and worth a nudge — but only a nudge, so a preset that merely
    // says "dark" cannot beat one that measurably is.
    for (const w of opts.words) if (preset.name.toLowerCase().includes(w)) score += 0.15
    if (!best || score > best.score) best = { preset, score, ch }
  }
  if (!best) return null

  // ⚠️ Everything scoring zero means nothing in the pool has the character that
  // was asked for. Handing back the first one would be a confident wrong
  // answer; saying so lets the caller offer what it does have.
  if (best.score <= 0) return null

  const strongest = (Object.entries(best.ch) as [keyof Character, number][])
    .filter(([t]) => (wanted[t] ?? 0) > 0)
    .sort((a, b) => b[1] - a[1])[0]
  const SUPERLATIVE: Record<keyof Character, string> = {
    dark: 'darkest', bright: 'brightest', soft: 'softest',
    warm: 'warmest', space: 'most spacious', grit: 'grittiest',
  }
  const why = strongest && strongest[1] > 0.15
    ? `${best.preset.name} — the ${SUPERLATIVE[strongest[0]]} ${(best.preset.group ?? 'sound').toLowerCase()} in your library`
    : best.preset.name
  return { preset: best.preset, why, considered: pool.length }
}
