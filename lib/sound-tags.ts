// The words for what a sound IS and what it is LIKE — one vocabulary, shared by
// samples and presets.
//
// Brae: "We should have tags on all presets and samples that the voice control,
// Light, can refer to."
//
// ⚠️ Samples already had this and presets had nothing, which is why "one of the
// darker piano presets" needed a matcher of its own. The tables below are the
// SAME ones the library's filter bar has always used — moved here, not copied,
// and re-exported from sound-library.ts so nothing that imports them changes.
// A second vocabulary would mean "Dark" meaning one thing in the filter bar and
// another to Light, which is worse than no tags at all.
//
// ⚠️ AND THEY ARE MOSTLY DERIVED, NOT WRITTEN. Hand-tagging a hundred presets
// is a hundred opinions to maintain and nothing at all for the preset somebody
// makes tomorrow. Everything here comes from what an item already carries:
//
//   its CATEGORY   → what it is (Drums, Keys, Pad…) and its obvious character
//   its SHAPING    → what it measurably sounds like (a low-pass at 2.6 kHz is
//                    dark whatever anybody called it)
//   its own `tags` → what a person actually chose to write, which always wins
//
// Explicit tags are still honoured, and are the right place for anything that
// cannot be derived: a genre, an era, a project, a mood only the author knows.

import type { BeatType } from './beat-analyzer'

export type LibraryCategory = BeatType | 'voice' | 'custom'

/** Ordered list of type tags shown in the filter bar */
export const TYPE_TAGS = ['Drums', 'Percussion', 'Bass', 'Lead', 'Keys', 'Pad', 'Guitar', 'Strings', 'Arp', 'Brass', 'Wind', 'Voice', 'FX'] as const
export type TypeTag = typeof TYPE_TAGS[number]

/** Ordered list of character tags shown in the filter bar */
export const CHARACTER_TAGS = ['Dark', 'Bright', 'Warm', 'Hard', 'Soft', 'Ambient', 'Crunchy', 'Glitchy'] as const
export type CharacterTag = typeof CHARACTER_TAGS[number]

/** Maps each LibraryCategory to a type tag for filter chip matching */
export const CATEGORY_TO_TYPE_TAG: Record<LibraryCategory, TypeTag | null> = {
  kick:              'Drums',
  snare:             'Drums',
  hihat:             'Drums',
  'open-hihat':      'Drums',
  clap:              'Drums',
  tom:               'Drums',
  crash:             'Drums',
  rim:               'Drums',
  '808':             'Drums',
  ride:              'Drums',
  shaker:            'Percussion',
  'guitar-acoustic': 'Guitar',
  'guitar-electric': 'Guitar',
  'guitar-nylon':    'Guitar',
  'piano-grand':     'Keys',
  'piano-electric':  'Keys',
  'piano-rhodes':    'Keys',
  'synth-lead':      'Lead',
  'synth-pad':       'Pad',
  'synth-bass':      'Bass',
  'synth-arp':       'Arp',
  'synth-strings':   'Strings',
  'synth-organ':     'Keys',
  'synth-choir':     'Voice',
  'synth-dark':      'Lead',
  'synth-drone':     'FX',
  'synth-pluck':     'Lead',
  violin:            'Strings',
  viola:             'Strings',
  other:             null,
  voice:             'Voice',
  custom:            null,
}

/** Maps each LibraryCategory to implicit character tags */
export const CATEGORY_CHAR_TAGS: Partial<Record<LibraryCategory, string[]>> = {
  kick:         ['Hard'],
  '808':        ['Dark', 'Hard'],
  ride:         ['Bright'],
  shaker:       ['Bright'],
  snare:        ['Hard'],
  hihat:        ['Bright'],
  'open-hihat': ['Bright'],
  crash:        ['Bright', 'Hard'],
  'synth-bass': ['Dark', 'Warm'],
  'synth-dark': ['Dark'],
  'synth-drone':['Dark', 'Ambient'],
  'synth-pluck':['Hard'],
  'synth-pad':  ['Warm', 'Ambient', 'Soft'],
  'synth-strings': ['Warm', 'Soft'],
  'piano-grand': ['Bright', 'Warm'],
  'piano-rhodes': ['Warm', 'Soft'],
  'synth-lead': ['Bright'],
  violin:       ['Bright', 'Warm'],
  viola:        ['Warm', 'Soft'],
}

/**
 * A preset's display group maps onto the same type words, so a preset and a
 * sample of the same instrument answer to the same tag.
 */
const GROUP_TO_TYPE_TAG: Record<string, TypeTag> = {
  Piano: 'Keys', Mallets: 'Percussion', Organ: 'Keys', Guitar: 'Guitar',
  Bass: 'Bass', Strings: 'Strings', Brass: 'Brass', Woodwinds: 'Wind',
  World: 'Percussion', Synth: 'Lead',
}

/** Anything that can be tagged: a library sample or an instrument preset. */
export interface Taggable {
  name?: string
  category?: string | null
  /** Preset display group ("Piano", "Synth"). */
  group?: string | null
  /** What a person wrote. Always kept. */
  tags?: string[] | null
  /**
   * ⚠️ THIS USER'S OWN WORDS, WHICH NOBODY ELSE SEES.
   *
   * Brae: "These user specific tag edits are only for the user. Universal tags
   * remain only changeable in the admin page."
   *
   * A catalog sound belongs to everybody, so its `tags` are the admin's and are
   * refreshed from the catalog whenever it changes. That refresh is exactly why
   * a second field is needed rather than letting people edit `tags` directly:
   * anything written there would be overwritten the next time an admin touched
   * that sound, silently and much later.
   */
  userTags?: string[] | null
  /** Measured character, 0..1 per trait — from lib/voice/preset-character.ts. */
  measured?: Partial<Record<'dark' | 'bright' | 'warm' | 'soft' | 'space' | 'grit', number>> | null
}

/** How strong a measured trait must be before it earns its word. Below this it
 *  is a nudge on a dial rather than a thing anybody would call the sound. */
const MEASURED_FLOOR = 0.35

/**
 * Words that cannot both be true of one sound.
 *
 * Used to let a measurement veto its category's assumption — not to veto a tag
 * a PERSON wrote, which is deliberate: if somebody calls their heavily filtered
 * preset "Bright", that is a statement about their music and not a mistake to
 * correct.
 */
const OPPOSITE: Record<string, string> = {
  Dark: 'Bright', Bright: 'Dark', Soft: 'Hard', Hard: 'Soft',
}

/** Measured traits, in the words the filter bar already uses. */
const TRAIT_TAG: Record<string, CharacterTag> = {
  dark: 'Dark', bright: 'Bright', warm: 'Warm', soft: 'Soft',
  space: 'Ambient', grit: 'Crunchy',
}

/**
 * Every tag that applies to one sample or preset.
 *
 * Explicit first — a person's own word is never overruled by a derivation —
 * then what its category says it is, then what it measurably sounds like.
 * Deduplicated case-insensitively so "dark" typed by hand and "Dark" derived
 * are one tag, not two.
 */
export function tagsOf(item: Taggable): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const add = (tag: string | null | undefined): void => {
    if (!tag) return
    const key = tag.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push(tag)
  }

  // A person's own words, always — theirs first, then the ones it shipped with.
  for (const t of item.userTags ?? []) add(t)
  for (const t of item.tags ?? []) add(t)

  // ⚠️ WHAT IT MEASURABLY IS BEATS WHAT ITS CATEGORY GENERALLY IS, and the
  // measurement has to be known before the category is consulted or the two
  // contradict each other. "Dark Upright" is built on the grand piano samples,
  // whose category implies Bright — so it came out tagged Bright AND Dark, and
  // "a bright piano" would have found the darkest one in the library.
  //
  // The category describes the FOLDER. The shaping describes THIS preset.
  const measured = new Set<string>()
  for (const [trait, score] of Object.entries(item.measured ?? {})) {
    if ((score ?? 0) >= MEASURED_FLOOR) {
      const tag = TRAIT_TAG[trait]
      if (tag) measured.add(tag)
    }
  }

  const category = (item.category ?? '') as LibraryCategory
  const categoryType = category ? CATEGORY_TO_TYPE_TAG[category] : null
  if (categoryType) add(categoryType)
  // ⚠️ The group only speaks when the category has not. A preset's group is
  // "Synth" for everything from a pad to a lead, and its category knows which —
  // so adding both made "Cinematic Pad" answer to Pad AND Lead.
  else if (item.group) add(GROUP_TO_TYPE_TAG[item.group])

  for (const t of CATEGORY_CHAR_TAGS[category] ?? []) {
    if (!measured.has(OPPOSITE[t] ?? '')) add(t)
  }
  for (const t of measured) add(t)
  return out
}

/** Does this item answer to every one of these words? Case-insensitive. */
export function hasTags(item: Taggable, wanted: string[]): boolean {
  if (!wanted.length) return true
  const mine = new Set(tagsOf(item).map(t => t.toLowerCase()))
  return wanted.every(w => mine.has(w.toLowerCase()))
}

/** The whole vocabulary, for the help panel and for priming the recogniser. */
export const ALL_TAGS: readonly string[] = [...TYPE_TAGS, ...CHARACTER_TAGS]
