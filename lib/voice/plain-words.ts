// ── The words people actually use ───────────────────────────────────────────
//
// Brae: "I'm worried that the AI voice assistant is bound by enough rules that
// users won't be able to use natural language with it… 'I want it to sound
// fuzzy' … 'Let's make the sound wiggle'."
//
// `shape_tone` knows eight qualities and they are an enum — brighter, darker,
// warmer, cleaner, punchier, softer, fuller, thinner. Say "fuzzier" and no rule
// matches. That is worse than declining, because an unknown word does not fail
// safely, it fails SIDEWAYS: it falls through to whatever else happens to
// match. "Turn the session take slot down to 60%" was read as a tempo change
// for exactly this reason, until "slot" became a word the studio knew.
//
// So: a table from everyday words to what this studio can actually do. Two
// rules keep it from becoming a pile of opinions.
//
//   ⚠️ A SENSE IS A REAL MOVE, NOT A MOOD. Every one names a tool call that
//   already exists, at a strength. If it cannot be written as an edit it does
//   not belong here — which is why "wiggle" has no vibrato sense: the studio's
//   LFOs reach volume, pan and the filter, and not pitch. Listing it would be
//   promising a sound nobody can make.
//
//   ⚠️ ONE QUESTION, THEN ACT. A word with two senses earns a question. A word
//   with one is just done. Nothing here earns two questions in a row: an edit
//   you can hear and undo is a better question than another question.
//
// Words the studio can MEASURE are not here — "dark" is derived from a preset's
// low-pass sitting at 2.6 kHz (lib/voice/preset-character.ts), which cannot
// drift away from what the preset sounds like because it IS what it sounds
// like. This table is for words that name a CHANGE, which is not something you
// can read off anything.

import type { VoiceCall } from './execute-music'

export interface PlainSense {
  /** Short id, and what the answer is matched back to. */
  id: string
  /** How it is offered in the question: "more muffled". */
  label: string
  /** What it sounds like, for someone who does not know the word: "like it is behind a door". */
  says: string
  /** Fragments that pick this sense out of an answer. */
  keywords: string[]
  /** Where the strength starts when nobody says a number, 0–100. */
  amount: number
  /** The edit itself, at a strength. */
  call: (target: string, amount: number) => VoiceCall
}

export interface PlainWord {
  /** The plain form, for messages. */
  word: string
  /** Every way it gets said. Matched whole-word, so "fuzz" does not catch "fuzzball". */
  said: string[]
  /**
   * What Light asks when the word carries more than one sense. Written to be
   * heard, and to be answerable with a fragment.
   */
  asks?: string
  senses: PlainSense[]
}

const effect = (type: string) => (target: string, amount: number): VoiceCall =>
  ({ name: 'add_effect', input: { target, effect: type, amount: Math.round(amount) } })

const modulate = (parameter: string, rate: string) => (target: string, amount: number): VoiceCall =>
  ({ name: 'modulate_parameter', input: { target, parameter, depth: Math.round(amount), rate } })

const tone = (quality: string) => (target: string, amount: number): VoiceCall =>
  ({ name: 'shape_tone', input: { target, quality, amount: Math.round(amount) } })

/**
 * ⚠️ THE ORDER MATTERS. The first word whose forms appear in the sentence wins,
 * so a longer, more specific form is listed before a shorter one it contains.
 */
export const PLAIN_WORDS: PlainWord[] = [
  {
    word: 'fuzzy',
    said: ['fuzzy', 'fuzzier', 'fuzz', 'gritty', 'grittier', 'grit', 'rough', 'rougher', 'dirty', 'dirtier'],
    asks: 'Do you mean more like static, or more muffled?',
    senses: [
      { id: 'static', label: 'more like static', says: 'grit on top of it, like a slightly broken speaker', keywords: ['static', 'grit', 'gritty', 'dirty', 'distorted', 'distortion', 'crunchy', 'broken', 'first'], amount: 40, call: effect('saturator') },
      { id: 'muffled', label: 'more muffled', says: 'like it is playing behind a door', keywords: ['muffled', 'muffle', 'behind', 'door', 'duller', 'dull', 'darker', 'covered', 'second'], amount: 50, call: effect('filter') },
    ],
  },
  {
    word: 'wiggle',
    // ⚠️ Not "pulse" or "pulsing": on their own they are ordinary words about
    // a song ("the pulse is too much"), and claiming them turned a remark into
    // a tremolo. They still ANSWER the question below, which is where they
    // genuinely mean this.
    said: ['wiggle', 'wiggly', 'wobble', 'wobbly', 'warble', 'shimmer'],
    asks: 'Do you mean the volume pulsing, the tone moving underneath, or it swaying side to side?',
    senses: [
      { id: 'tremolo', label: 'the volume pulsing', says: 'it gets louder and quieter in time, like a pump', keywords: ['volume', 'pulsing', 'pulse', 'pump', 'pumping', 'loud', 'louder', 'tremolo', 'first'], amount: 50, call: modulate('volume', '1/8') },
      { id: 'warble', label: 'the tone moving underneath', says: 'the brightness sweeping up and down under the note', keywords: ['tone', 'brightness', 'filter', 'sweep', 'sweeping', 'warble', 'wah', 'under', 'underneath', 'second'], amount: 55, call: modulate('lowpass', '1/8') },
      { id: 'sway', label: 'it swaying side to side', says: 'the sound moving between your ears', keywords: ['side', 'sides', 'pan', 'panning', 'stereo', 'ears', 'left', 'right', 'sway', 'third'], amount: 60, call: modulate('pan', '1/2') },
    ],
  },
  {
    word: 'bigger',
    // ⚠️ Not "wider": that is stereo width and set_width owns it exactly.
    said: ['bigger', 'big', 'huge', 'epic', 'massive', 'grand'],
    asks: 'Do you mean more space around it, or more body in it?',
    senses: [
      { id: 'space', label: 'more space around it', says: 'a room for it to ring out in', keywords: ['space', 'room', 'reverb', 'echo', 'hall', 'around', 'first'], amount: 45, call: effect('reverb') },
      { id: 'body', label: 'more body in it', says: 'thicker and fuller, without moving it away from you', keywords: ['body', 'fuller', 'full', 'thicker', 'thick', 'weight', 'in it', 'second'], amount: 50, call: tone('fuller') },
    ],
  },
  {
    word: 'dreamy',
    said: ['dreamy', 'dreamier', 'washy', 'floaty', 'ethereal', 'ambient', 'spacey', 'spacy'],
    asks: 'Do you mean it washing out into a room, or repeating away into the distance?',
    senses: [
      { id: 'wash', label: 'washing out into a room', says: 'a long tail on everything', keywords: ['wash', 'washing', 'room', 'reverb', 'tail', 'hall', 'first'], amount: 60, call: effect('reverb') },
      { id: 'echoes', label: 'repeating away into the distance', says: 'echoes trailing off behind it', keywords: ['repeat', 'repeating', 'echo', 'echoes', 'delay', 'distance', 'trailing', 'second'], amount: 45, call: effect('delay') },
    ],
  },
  {
    word: 'harder',
    said: ['harder', 'heavier', 'meaner', 'nastier', 'aggressive', 'angrier'],
    asks: 'Do you mean more grit on it, or more punch to it?',
    senses: [
      { id: 'grit', label: 'more grit on it', says: 'driven, with an edge', keywords: ['grit', 'drive', 'driven', 'distortion', 'distorted', 'edge', 'saturation', 'first'], amount: 50, call: effect('saturator') },
      { id: 'punch', label: 'more punch to it', says: 'hitting harder at the front of each note', keywords: ['punch', 'punchy', 'hit', 'hits', 'attack', 'front', 'second'], amount: 55, call: tone('punchier') },
    ],
  },
  // ── One sense: nothing to ask about ────────────────────────────────────────
  {
    word: 'muffled',
    said: ['muffled', 'muffle', 'duller', 'underwater', 'covered'],
    senses: [{ id: 'muffled', label: 'muffled', says: 'like it is playing behind a door', keywords: [], amount: 50, call: effect('filter') }],
  },
  {
    word: 'crunchy',
    said: ['crunchy', 'crunch', 'crushed', 'distorted', 'overdriven', 'saturated'],
    senses: [{ id: 'crunch', label: 'crunchy', says: 'driven until it breaks up', keywords: [], amount: 55, call: effect('saturator') },],
  },
  {
    word: 'echoey',
    said: ['echoey', 'echoy', 'echo', 'echoes', 'repeats'],
    senses: [{ id: 'echo', label: 'echoing', says: 'repeats trailing off behind it', keywords: [], amount: 45, call: effect('delay') }],
  },
  {
    word: 'roomy',
    said: ['roomy', 'reverby', 'cavernous', 'hall'],
    senses: [{ id: 'room', label: 'in a room', says: 'a tail on it, like a big space', keywords: [], amount: 50, call: effect('reverb') }],
  },
]

const forms = new Map<string, PlainWord>()
for (const w of PLAIN_WORDS) for (const f of w.said) if (!forms.has(f)) forms.set(f, w)

/** Every form the vocabulary knows, for the assistant's prompt and for tests. */
export function plainForms(): string[] { return [...forms.keys()].sort() }

/**
 * The word this sentence is reaching for, if any.
 *
 * ⚠️ WHOLE WORDS ONLY. "Fuzz" must not fire on "fuzzball", and — more to the
 * point — a track called "Big Muff" must not turn every sentence about it into
 * a request to sound bigger. The caller strips names before asking.
 */
export function plainWordIn(sentence: string): PlainWord | null {
  const said = ` ${String(sentence ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `
  let best: { word: PlainWord; at: number; len: number } | null = null
  for (const [form, word] of forms) {
    const at = said.indexOf(` ${form} `)
    if (at < 0) continue
    // The longest form wins where two overlap ("wobbly" over "wobble"),
    // then the earliest, so the first thing said is what it is about.
    if (!best || form.length > best.len || (form.length === best.len && at < best.at)) best = { word, at, len: form.length }
  }
  return best?.word ?? null
}

/** True when the word carries more than one sense and so earns a question. */
export function needsAsking(word: PlainWord): boolean {
  return word.senses.length > 1 && !!word.asks
}

/**
 * Which sense an answer picked. A fragment is enough — "the muffled one", "more
 * like static", "the second" — because that is how people answer.
 * Null when the answer names none of them.
 */
export function senseFromAnswer(word: PlainWord, answer: string): PlainSense | null {
  const said = ` ${String(answer ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `
  const has = (k: string) => said.includes(` ${k} `)
  for (const s of word.senses) {
    if (has(s.id) || s.keywords.some(has)) return s
    // The label as said back: "the volume pulsing" answers "the volume pulsing".
    if (s.label.split(/\s+/).filter(x => x.length > 3).every(has)) return s
  }
  return null
}

/**
 * The sense to use when the answer settled nothing and asking twice would be
 * worse than acting: the first, which is the commoner reading of every word
 * here. The caller says which it picked.
 */
export function defaultSense(word: PlainWord): PlainSense {
  return word.senses[0]
}

/** "a saturator at 40%" — what is about to happen, in words. */
export function describeSense(sense: PlainSense, amount: number, target?: string): string {
  const call = sense.call(target ?? 'it', amount)
  const i = call.input as Record<string, unknown>
  const pct = `${Math.round(amount)}%`
  if (call.name === 'add_effect') {
    const label: Record<string, string> = { filter: 'a filter closing it down', saturator: 'some grit on it', reverb: 'a room around it', delay: 'echoes behind it' }
    return `${label[String(i.effect)] ?? String(i.effect)} at ${pct}`
  }
  if (call.name === 'modulate_parameter') {
    const label: Record<string, string> = { volume: 'the volume pulsing', lowpass: 'the tone sweeping', pan: 'it swaying side to side' }
    return `${label[String(i.parameter)] ?? String(i.parameter)} at ${pct}, every ${String(i.rate)}`
  }
  return `${String(i.quality)} at ${pct}`
}

/** The question, with the senses spelled out for the ear. */
export function askText(word: PlainWord): string {
  return word.asks ?? ''
}
