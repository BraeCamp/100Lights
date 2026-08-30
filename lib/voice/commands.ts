'use client'
// ── Every command the studio can be told, in one list ───────────────────────
//
// Brae: "We want to make every function work in voice controls." And later:
// "set up as much of the voice controls as possible as though it's a complete
// system."
//
// The first version of the parser was a single function with the rules written
// out in sequence as `if` blocks. That works for six commands and quietly stops
// working somewhere around fifteen, for reasons that are worth writing down
// because they are what this file exists to fix:
//
//   NOTHING KNOWS WHAT THE SYSTEM CAN DO. The help text, the transcriber's
//   vocabulary hint and the tests each held their own copy of the command list,
//   so a new command meant remembering three other places. It never was.
//
//   NOTHING PROVES IT WORKS. A rule that stopped matching failed silently — the
//   sentence just fell through to the paid path, which looked like the system
//   working rather than a command that had broken.
//
// So a command is one entry: what it does, how people say it, and how to read
// it. Everything else is DERIVED from that entry — the help panel people read,
// the keyterms the transcriber is primed with, and a test that every example
// phrasing still resolves to the command that claims it. Adding a command is
// adding one object, and the test suite immediately starts holding it to
// account.
//
// The `say` list is doing three jobs at once and all three matter. It is
// documentation, it is the vocabulary hint that makes a noisy room legible, and
// it is the test corpus. That triple duty is deliberate: an example that stops
// working fails the build, which means the documentation cannot rot.

import { findByName, foldName, spokenNumber } from './resolve'
import type { VoiceCall } from './execute-music'
import { Words, near } from './words'

export interface InterpretContext {
  /**
   * The project's tracks. Volume and pan are read for RELATIVE commands —
   * "turn the bass up" has to know where the bass currently is — and are
   * optional so a caller with only names still gets everything else.
   */
  tracks: { id: string; name?: string; volume?: number; pan?: number }[]
  /** Current song tempo, for "a bit faster". */
  tempo?: number
}

export interface Match {
  calls: VoiceCall[]
  /** 0–1, this rule's own certainty that it read the sentence correctly. */
  confidence: number
  /**
   * Did this depend on resolving a spoken NAME?
   *
   * It decides how much the transcriber's own confidence matters downstream: a
   * rule that matched a fixed vocabulary carries its own proof, one that had to
   * find "the pad" among a dozen tracks is only as good as the word it was
   * given.
   */
  needsName?: boolean
}

export interface VoiceCommand {
  /** Unique. Also the key used by the help panel and the tests. */
  id: string
  /** Which entry in MUSIC_TOOLS this produces. */
  tool: string
  /** Which group it appears under in the help panel. */
  group: 'Transport' | 'Mixer' | 'Timing' | 'Arrangement' | 'Notes' | 'Project'
  /** One line, in a person's terms, for the help panel. */
  what: string
  /**
   * How people say it. Documentation, transcriber hint, and test corpus.
   * Every one of these MUST resolve to this command — that is asserted.
   */
  say: string[]
  /**
   * Does it destroy work? A destructive command is confirmed before it runs,
   * because a mishearing that deletes a track is not recoverable by saying the
   * opposite.
   */
  destructive?: boolean
  /** Read the sentence, or decline. */
  match(w: Words, ctx: InterpretContext): Match | null
}

// ── Shared reading ──────────────────────────────────────────────────────────

/** How confident a name match makes us. Deliberately capped below certainty:
 *  a name is the one part of a command the speaker and the project can
 *  disagree about. */
const nameConfidence = (score: number): number => Math.min(0.93, 0.55 + score * 0.38)

/**
 * Every word that appears in some track's name, so those words are never
 * mistaken for part of a command.
 *
 * Cached against the TRACKS ARRAY rather than the context object. The reducer
 * replaces that array on every edit, so a rename produces a new array and a
 * fresh set; keying on the context would hand a stale set to any caller that
 * reuses one, and a stale name set is precisely a wrong context check — the
 * thing this whole mechanism exists to get right.
 */
const nameWordCache = new WeakMap<object, Set<string>>()
export function nameWords(ctx: InterpretContext): Set<string> {
  let set = nameWordCache.get(ctx.tracks)
  if (!set) {
    set = new Set<string>()
    for (const t of ctx.tracks) {
      for (const word of foldName(t.name ?? '').split(' ')) if (word) set.add(word)
    }
    nameWordCache.set(ctx.tracks, set)
  }
  return set
}

/**
 * Find the track someone named, from whatever is left once the command's own
 * words are taken out.
 *
 * The removal is fuzzy, because the command word is exactly what a bad
 * transcript garbles — "moot the drums" has to lose "moot" or the lookup asks
 * for a track called "moot drums" and finds nothing.
 *
 * But fuzzy removal will happily delete the ANSWER. "bass" is one edit from
 * "bars", so "close the filter on the bass over 4 bars" had its track name
 * removed as if it were a unit of time and resolved to nothing at all. A word
 * that names something real is therefore never removed, whatever it resembles —
 * the project is the authority on what is a name, and a command word that
 * survives into the leftover only weakens a lookup, while a deleted name
 * destroys it.
 *
 * Returns null both when nothing was said and when nothing matched well enough.
 * The caller declines either way, which sends the sentence on to be confirmed
 * rather than acted on. Muting the wrong track is quiet and easy to miss, which
 * is exactly why this refuses instead of picking a best effort.
 */
function nameFrom(
  w: Words,
  ctx: InterpretContext,
  remove: string[],
  opts: { dropNums?: boolean } = {},
): { name: string; score: number } | null {
  const protect = nameWords(ctx)
  const kept = w.all
    .filter(x => !(opts.dropNums && spokenNumber(x) != null))
    .filter(x => protect.has(x) || !remove.some(t =>
      x === t || (t.length >= 4 && Math.abs(x.length - t.length) <= 1 && near(x, t))))
  const rest = kept.join(' ').trim()
  if (!rest) return null

  let used = kept
  let hit = findByName(rest, ctx.tracks)

  // A word the rule did not think to remove will otherwise destroy the lookup,
  // because findByName requires every spoken word to appear in the name: "play
  // the bass louder" left "play bass", which matches no track, and the whole
  // command was lost to one stray verb.
  //
  // So if the leftover as a whole finds nothing, fall back to the words in it
  // that NAME something. This is the same context check the rest of the file
  // rests on — the project decides which words are names — and it is a fallback
  // rather than the first move because the full leftover is better evidence
  // when it works, and narrowing to names would happily find "Bass" inside a
  // sentence that was never about the bass.
  if (!hit || hit.score < 0.6) {
    const named = kept.filter(x => protect.has(x))
    if (named.length && named.length < kept.length) {
      const narrowed = findByName(named.join(' '), ctx.tracks)
      if (narrowed && narrowed.score >= 0.6) { hit = narrowed; used = named }
    }
  }
  if (!hit || hit.score < 0.6) return null

  // Only the words actually used for the name count as explained. The stray
  // ones stay unexplained, which lowers this reading's coverage — honestly, and
  // in a way a competing reading can win on.
  for (const word of used) w.markWord(word, 0)
  // A loose match is a correction like any other: a reading that had to stretch
  // to find its track should lose to one that did not.
  if (hit.score < 1) w.corrections += 1 - hit.score
  return { name: hit.item.name ?? '', score: hit.score }
}

/**
 * The numbers in the sentence that are ARGUMENTS, not part of the track's name.
 *
 * "pan the bass 2 left" contains one number and it is not the pan amount — it
 * is the second half of "Bass 2". Reading it as the argument panned the track
 * two percent left, which is a real command, a plausible-looking read-back and
 * completely wrong. "set bass 2 to 40 percent" had the same flaw and set the
 * volume to 2%.
 *
 * Track names with numbers in them are not an edge case: Bass 2, Take 3, Verse
 * 1. So the numbers belonging to the resolved name are removed before anything
 * is read as an argument — one occurrence per number in the name, so "set bass
 * 2 to 2 percent" still finds its 2.
 */
function argNumbers(w: Words, name: string): number[] {
  const spare = new Map<number, number>()
  for (const token of foldName(name).split(' ')) {
    const n = spokenNumber(token)
    if (n != null) spare.set(n, (spare.get(n) ?? 0) + 1)
  }
  const out: number[] = []
  for (const n of w.nums()) {
    const left = spare.get(n) ?? 0
    if (left > 0) { spare.set(n, left - 1); continue }
    out.push(n)
  }
  return out
}

/** The track's current volume as a percentage, for relative moves. */
function volumeOf(name: string, ctx: InterpretContext): number | null {
  const t = ctx.tracks.find(x => (x.name ?? '') === name)
  return typeof t?.volume === 'number' ? Math.round(t.volume * 100) : null
}

/** How big a nudge did they ask for? "a bit" is smaller than "a lot". */
function nudgeSize(w: Words): number {
  if (w.has('bit', 'touch', 'little', 'slightly', 'hair')) return 8
  if (w.has('lot', 'way', 'much', 'loads')) return 25
  return 15
}

/** Words that mean "make it bigger" and "make it smaller". */
const UP = ['up', 'louder', 'boost', 'raise', 'increase', 'higher', 'more']
const DOWN = ['down', 'quieter', 'lower', 'reduce', 'decrease', 'softer', 'less']

/** Named intervals, so "up an octave" and "down a fifth" work as spoken. */
const INTERVALS: Record<string, number> = {
  octave: 12, fifth: 7, fourth: 5, third: 4, second: 2, semitone: 1, half: 1, tone: 2, whole: 2,
}

/**
 * A musical length from the sentence: "2 bars", "one beat", "3 seconds".
 *
 * Takes the number explicitly rather than reading it, because in "fade bass 2
 * in over 4 bars" the first number belongs to the track and the second is the
 * length. Only the caller knows which is which, and only after it has resolved
 * the name.
 */
function lengthWith(w: Words, n: number | undefined | null): { bars?: number; beats?: number; seconds?: number } | null {
  if (n == null) return null
  if (w.has('bar', 'bars', 'measure', 'measures')) return { bars: n }
  if (w.has('beat', 'beats')) return { beats: n }
  if (w.has('second', 'seconds')) return { seconds: n }
  return null
}

/** For rules with no track name to disambiguate against. */
const lengthFrom = (w: Words) => lengthWith(w, w.num())

// ── The commands ────────────────────────────────────────────────────────────
//
// Order is precedence: the first rule that reads the sentence wins, so the
// specific ones come before the general ones. The clearest case is that
// anything naming a track must be tried before the bare transport, or "play the
// bass louder" is heard as "play".

const COMMANDS: VoiceCommand[] = [
  // ── Mixer ────────────────────────────────────────────────────────────────
  {
    id: 'set_track.mute',
    tool: 'set_track',
    group: 'Mixer',
    what: 'Mute or unmute a track',
    say: ['mute the drums', 'unmute the bass', 'mute bass 2'],
    match(w, ctx) {
      const on = w.has('mute', 'silence')
      const off = w.has('unmute') || (on && w.has('un'))
      if (!on && !off) return null
      const hit = nameFrom(w, ctx, ['mute', 'unmute', 'silence', 'track'])
      // A mixer verb with no findable track is exactly the ambiguity worth
      // asking about, so decline rather than guess which track was meant.
      if (!hit) return null
      return {
        calls: [{ name: 'set_track', input: { target: hit.name, muted: !off } }],
        confidence: nameConfidence(hit.score),
        needsName: true,
      }
    },
  },
  {
    id: 'set_track.solo',
    tool: 'set_track',
    group: 'Mixer',
    what: 'Solo a track, or drop the solo',
    say: ['solo the vocals', 'unsolo the guitar', 'solo bass 2'],
    match(w, ctx) {
      const on = w.has('solo')
      const off = w.has('unsolo')
      if (!on && !off) return null
      const hit = nameFrom(w, ctx, ['solo', 'unsolo', 'track'])
      if (!hit) return null
      return {
        calls: [{ name: 'set_track', input: { target: hit.name, solo: !off } }],
        confidence: nameConfidence(hit.score),
        needsName: true,
      }
    },
  },
  {
    id: 'set_track.volume',
    tool: 'set_track',
    group: 'Mixer',
    what: 'Set a track to an exact level',
    say: ['set the bass to 50 percent', 'drums volume 70', 'put the pad at 30 percent'],
    match(w, ctx) {
      if (!w.has('percent', 'volume', 'level')) return null
      // The name is resolved BEFORE the number is read, because which numbers
      // are arguments depends on which are part of the name.
      const hit = nameFrom(w, ctx, ['percent', 'volume', 'level', 'set', 'put', 'track'], { dropNums: true })
      if (!hit) return null
      const n = argNumbers(w, hit.name)[0]
      if (n == null || n < 0 || n > 100) return null
      return {
        calls: [{ name: 'set_track', input: { target: hit.name, volume: n } }],
        confidence: nameConfidence(hit.score),
        needsName: true,
      }
    },
  },
  {
    id: 'set_track.volume.relative',
    tool: 'set_track',
    group: 'Mixer',
    what: 'Nudge a track louder or quieter',
    say: ['turn the bass up', 'bring the drums down a bit', 'make the pad louder'],
    match(w, ctx) {
      const up = w.has(...UP)
      const down = w.has(...DOWN)
      // Both directions in one sentence is not a nudge, it is a sentence this
      // parser has misread. Saying so costs nothing; guessing costs a mix.
      if (up === down) return null
      const hit = nameFrom(w, ctx, [...UP, ...DOWN, 'turn', 'bring', 'make', 'bit', 'touch', 'little',
          'slightly', 'hair', 'lot', 'way', 'much', 'loads', 'track', 'volume'])
      if (!hit) return null
      // Relative needs somewhere to start from. Without the current level this
      // would be a guess dressed up as an instruction.
      const now = volumeOf(hit.name, ctx)
      if (now == null) return null
      const next = Math.max(0, Math.min(100, now + (up ? nudgeSize(w) : -nudgeSize(w))))
      return {
        calls: [{ name: 'set_track', input: { target: hit.name, volume: next } }],
        confidence: nameConfidence(hit.score),
        needsName: true,
      }
    },
  },
  {
    id: 'set_track.pan',
    tool: 'set_track',
    group: 'Mixer',
    what: 'Place a track left or right',
    say: ['pan the guitar left', 'pan the pad hard right', 'center the vocals', 'pan drums 30 left'],
    match(w, ctx) {
      const centre = w.has('center', 'centre', 'middle')
      const left = w.has('left')
      const right = w.has('right')
      if (!centre && !left && !right) return null
      if (!centre && !w.has('pan', 'panned')) return null
      if (left && right) return null
      const hit = nameFrom(w, ctx, ['pan', 'panned', 'left', 'right', 'hard', 'center', 'centre',
          'middle', 'track', 'percent'], { dropNums: true })
      if (!hit) return null
      const n = argNumbers(w, hit.name)[0]
      const amount = centre ? 0
        : n != null && n >= 0 && n <= 100 ? n
          : w.has('hard', 'full', 'all') ? 100
            : 60
      return {
        calls: [{ name: 'set_track', input: { target: hit.name, pan: left ? -amount : amount } }],
        confidence: nameConfidence(hit.score),
        needsName: true,
      }
    },
  },

  // ── Timing ───────────────────────────────────────────────────────────────
  {
    id: 'set_tempo',
    tool: 'set_tempo',
    group: 'Timing',
    what: 'Change the tempo',
    say: ['set the tempo to 120', 'take it to 128 bpm', 'change the tempo to 90'],
    match(w) {
      const n = w.num()
      if (n == null || n < 20 || n > 300) return null
      if (!w.has('tempo', 'bpm')) return null
      // "at bar 17" makes it a tempo CHANGE rather than the song tempo, which
      // is a different action with a different result — a fact worth reading
      // rather than flattening.
      const bar = w.has('bar', 'measure') ? w.nums()[1] : null
      const input: Record<string, unknown> = { bpm: n }
      if (bar != null && bar > 0) input.at = { bar }
      return { calls: [{ name: 'set_tempo', input }], confidence: 0.93 }
    },
  },
  {
    id: 'set_tempo.relative',
    tool: 'set_tempo',
    group: 'Timing',
    what: 'Speed up or slow down',
    say: ['speed it up', 'slow it down a bit', 'a little faster'],
    match(w, ctx) {
      const up = w.has('faster', 'quicker') || w.hasPhrase('speed', 'up')
      const down = w.has('slower') || w.hasPhrase('slow', 'down')
      if (up === down) return null
      if (ctx.tempo == null) return null
      const step = w.has('bit', 'little', 'touch', 'slightly') ? 4 : w.has('lot', 'way', 'much') ? 16 : 8
      const bpm = Math.max(20, Math.min(300, Math.round(ctx.tempo + (up ? step : -step))))
      return { calls: [{ name: 'set_tempo', input: { bpm } }], confidence: 0.9 }
    },
  },
  {
    id: 'set_time_signature',
    tool: 'set_time_signature',
    group: 'Timing',
    what: 'Change the time signature',
    say: ['put it in 3 4', 'switch to 6 8', 'change the time signature to 5 4'],
    match(w) {
      // "3/4" reaches here as two separate numbers however it was said, so the
      // meter is the PAIR — and a lone number is not a time signature, which is
      // what keeps "go to bar 3" out of this rule.
      const ns = w.nums()
      if (ns.length < 2) return null
      // A bare pair of numbers is not a meter — "loop bars 4 to 8" is two
      // numbers and means something else entirely — so the sentence has to
      // announce itself. The loop rules are tried first for the same reason.
      const announced = w.has('time', 'signature', 'meter', 'switch', 'change', 'put', 'make')
        || w.said('over')
      if (!announced) return null
      const [num, den] = ns
      if (!(num >= 1 && num <= 32)) return null
      if (![1, 2, 4, 8, 16, 32].includes(den)) return null
      return {
        calls: [{ name: 'set_time_signature', input: { numerator: num, denominator: den } }],
        confidence: 0.9,
      }
    },
  },
  {
    id: 'set_loop_region.off',
    tool: 'set_loop_region',
    group: 'Timing',
    what: 'Turn looping off',
    say: ['loop off', 'stop looping', 'turn off the loop'],
    match(w) {
      if (!w.has('loop', 'looping')) return null
      if (!w.has('off', 'stop', 'disable')) return null
      return {
        calls: [{ name: 'set_loop_region', input: { enabled: false } }],
        confidence: 0.92,
      }
    },
  },
  {
    id: 'set_loop_region.on',
    tool: 'set_loop_region',
    group: 'Timing',
    what: 'Turn looping on',
    say: ['loop on', 'turn looping on', 'enable the loop'],
    match(w) {
      if (!w.has('loop', 'looping')) return null
      // "on" is filler, so this cannot ask for it directly and instead acts as
      // the fallback for the whole loop family: a sentence about looping that
      // named no range, no length and no opposite. The rules that DO want
      // something specific are ordered above this one and take it first.
      if (w.has('off', 'stop', 'disable')) return null
      if (w.has('first')) return null
      if (w.nums().length >= 2) return null
      return {
        calls: [{ name: 'set_loop_region', input: { enabled: true } }],
        confidence: 0.92,
      }
    },
  },
  {
    id: 'set_loop_region.range',
    tool: 'set_loop_region',
    group: 'Timing',
    what: 'Loop a range of bars',
    say: ['loop bars 9 to 17', 'loop from bar 1 to 5', 'loop bar 4 to 8'],
    match(w) {
      if (!w.has('loop', 'looping')) return null
      const ns = w.nums()
      if (ns.length < 2 || ns[1] <= ns[0]) return null
      return {
        calls: [{ name: 'set_loop_region', input: { start: { bar: ns[0] }, end: { bar: ns[1] } } }],
        confidence: 0.9,
      }
    },
  },
  {
    id: 'set_loop_region.first',
    tool: 'set_loop_region',
    group: 'Timing',
    what: 'Loop the first stretch of the song',
    say: ['loop the first 8 bars', 'loop the first four bars'],
    match(w) {
      if (!w.has('loop', 'looping')) return null
      if (!w.has('first')) return null
      const n = w.num()
      if (n == null || n < 1) return null
      if (!w.has('bar', 'bars', 'measure', 'measures')) return null
      return {
        calls: [{ name: 'set_loop_region', input: { start: { bar: 1 }, length: { bars: n } } }],
        confidence: 0.9,
      }
    },
  },

  // ── Arrangement ──────────────────────────────────────────────────────────
  {
    id: 'duplicate_clip',
    tool: 'duplicate_clip',
    group: 'Arrangement',
    what: 'Repeat a clip back to back',
    say: ['loop the bass 3 more times', 'repeat the drums twice', 'duplicate the pad'],
    match(w, ctx) {
      const asked = w.has('repeat', 'duplicate', 'again', 'copy')
        || (w.has('loop') && w.has('times', 'more'))
        || w.has('double')
      if (!asked) return null
      const hit = nameFrom(w, ctx, ['repeat', 'duplicate', 'again', 'copy', 'loop', 'times', 'more',
          'double', 'twice', 'track', 'clip'], { dropNums: true })
      if (!hit) return null
      // "loop bass 2 three more times" has two numbers and only one of them is
      // the count — the other names the track.
      const n = argNumbers(w, hit.name)[0]
      const count = n != null && n > 0 && n < 64 ? n
        : w.has('twice') ? 2
          // "duplicate the pad" and "double it" are one more copy. Only "loop
          // it N times" genuinely needs its number, and that phrasing always
          // carries one.
          : w.has('duplicate', 'copy', 'double', 'again', 'repeat') ? 1
            : null
      if (count == null) return null
      return {
        calls: [{ name: 'duplicate_clip', input: { target: hit.name, count } }],
        confidence: nameConfidence(hit.score),
        needsName: true,
      }
    },
  },
  {
    id: 'move_clips',
    tool: 'move_clips',
    group: 'Arrangement',
    what: 'Shift clips later or earlier',
    say: ['move the drums back 2 bars', 'push the bass back one bar', 'move the pad earlier by 1 bar'],
    match(w, ctx) {
      if (!w.has('move', 'push', 'shift', 'nudge', 'slide')) return null
      const hit = nameFrom(w, ctx, ['move', 'push', 'shift', 'nudge', 'slide', 'back',
        'over', 'earlier', 'sooner', 'forward', 'left', 'bar', 'bars', 'measure',
        'measures', 'beat', 'beats', 'second', 'seconds', 'by', 'track', 'clip',
        'everything', 'all'], { dropNums: true })
      const by = lengthWith(w, argNumbers(w, hit?.name ?? '')[0])
      if (!by) return null
      // The contract's own examples treat "back" as LATER, which is how the
      // operation is named in every DAW; "earlier" is the only word that
      // reverses it.
      const earlier = w.has('earlier', 'sooner', 'forward', 'left')
      const signed = Object.fromEntries(
        Object.entries(by).map(([k, v]) => [k, earlier ? -(v as number) : v]),
      )
      // No name means the whole arrangement, which the tool supports and people
      // say constantly ("move everything over a bar").
      if (!hit || w.has('everything', 'all')) {
        return { calls: [{ name: 'move_clips', input: { by: signed } }], confidence: 0.88 }
      }
      return {
        calls: [{ name: 'move_clips', input: { target: hit.name, by: signed } }],
        confidence: nameConfidence(hit.score),
        needsName: true,
      }
    },
  },
  {
    id: 'insert_clip',
    tool: 'insert_clip',
    group: 'Arrangement',
    what: 'Drop a sound into the arrangement',
    say: ['put a crash at the beginning', 'add a kick on bar 9', 'put a snare at bar 5'],
    match(w) {
      if (!w.has('put', 'add', 'insert', 'drop', 'place')) return null
      // Only sounds the executor knows how to make. Anything else is a request
      // to invent an instrument, which is not this rule's to answer.
      const SOUNDS = ['crash', 'kick', 'snare', 'hat', 'hats', 'hihat', 'clap', 'tom', 'ride', 'cymbal']
      const sound = SOUNDS.find(s => w.has(s))
      if (!sound) return null
      const n = w.num()
      const at = w.has('beginning', 'start', 'top') ? { bar: 1 }
        : n != null && n > 0 && w.has('bar', 'measure') ? { bar: n }
          : null
      if (!at) return null
      const length = lengthFrom(w)
      const input: Record<string, unknown> = { sound, at }
      if (length) input.length = length
      return { calls: [{ name: 'insert_clip', input }], confidence: 0.87 }
    },
  },

  // ── Notes ────────────────────────────────────────────────────────────────
  {
    id: 'transpose',
    tool: 'transpose',
    group: 'Notes',
    what: 'Move a part up or down in pitch',
    say: ['take the bass up an octave', 'drop the pad down a fifth', 'transpose the lead up 3 semitones'],
    match(w, ctx) {
      const up = w.has('up', 'raise', 'higher')
      const down = w.has('down', 'drop', 'lower')
      if (up === down) return null
      if (!w.has('transpose', 'octave', 'semitone', 'semitones', 'fifth', 'fourth', 'third', 'step', 'steps')) {
        return null
      }
      const hit = nameFrom(w, ctx, ['transpose', 'take', 'drop', 'move', 'up', 'down', 'raise', 'lower',
          'higher', 'octave', 'semitone', 'semitones', 'fifth', 'fourth', 'third',
          'second', 'step', 'steps', 'half', 'tone', 'whole', 'by', 'track', 'clip'], { dropNums: true })
      if (!hit) return null
      const named = Object.keys(INTERVALS).find(k => w.has(k))
      // "take bass 2 up 3 semitones" — the 2 is the track, the 3 is the move.
      const n = argNumbers(w, hit.name)[0]
      // An explicit number always wins over the named interval, because the
      // interval word is often the UNIT rather than the size: "up 3 semitones"
      // is three, not one, and reading the word first made every counted
      // transposition move by exactly one.
      const size = n != null && n > 0 && n <= 48 ? n : named ? INTERVALS[named] : null
      if (size == null) return null
      return {
        calls: [{ name: 'transpose', input: { target: hit.name, semitones: up ? size : -size } }],
        confidence: nameConfidence(hit.score),
        needsName: true,
      }
    },
  },
  {
    id: 'automate_parameter.fade',
    tool: 'automate_parameter',
    group: 'Arrangement',
    what: 'Fade a track in or out over a stretch',
    say: ['fade the pad in over 4 bars', 'fade the drums out over 2 bars'],
    match(w, ctx) {
      if (!w.has('fade')) return null
      // "in" is filler in every other sentence in the language and is the whole
      // instruction in this one, so this rule reads the raw words.
      const inward = w.said('in') || w.said('up')
      const outward = w.said('out') || w.said('away')
      if (inward === outward) return null
      const hit = nameFrom(w, ctx, ['fade', 'in', 'out', 'up', 'away', 'over', 'across', 'bar', 'bars',
          'measure', 'measures', 'beat', 'beats', 'second', 'seconds', 'track'], { dropNums: true })
      if (!hit) return null
      const length = lengthWith(w, argNumbers(w, hit.name)[0])
      if (!length) return null
      return {
        calls: [{
          name: 'automate_parameter',
          input: {
            target: hit.name, parameter: 'volume',
            from: inward ? 0 : 100, to: inward ? 100 : 0, length,
          },
        }],
        confidence: nameConfidence(hit.score),
        needsName: true,
      }
    },
  },
  {
    id: 'automate_parameter.filter',
    tool: 'automate_parameter',
    group: 'Arrangement',
    what: 'Sweep a filter open or closed',
    say: ['open the filter on the pad over 8 bars', 'close the filter on the bass over 4 bars'],
    match(w, ctx) {
      if (!w.has('filter', 'lowpass', 'cutoff')) return null
      const open = w.has('open', 'opening', 'up', 'rising', 'ascending')
      const close = w.has('close', 'closing', 'down', 'falling', 'descending')
      if (open === close) return null
      const hit = nameFrom(w, ctx, ['open', 'opening', 'close', 'closing', 'up', 'down', 'rising',
          'falling', 'ascending', 'descending', 'filter', 'lowpass', 'cutoff', 'over',
          'across', 'bar', 'bars', 'measure', 'measures', 'beat', 'beats', 'second',
          'seconds', 'track', 'sweep'], { dropNums: true })
      if (!hit) return null
      const length = lengthWith(w, argNumbers(w, hit.name)[0])
      if (!length) return null
      return {
        calls: [{
          name: 'automate_parameter',
          input: {
            target: hit.name, parameter: 'lowpass',
            from: open ? 0 : 100, to: open ? 100 : 0, length,
          },
        }],
        confidence: nameConfidence(hit.score),
        needsName: true,
      }
    },
  },

  // ── Transport ────────────────────────────────────────────────────────────
  //
  // Last, because these words turn up inside sentences that are about something
  // else entirely. "play the bass louder" contains "play" and is not a
  // transport command; every rule above gets first refusal for that reason.
  {
    id: 'transport.restart',
    tool: 'transport',
    group: 'Transport',
    what: 'Go back to the beginning and play',
    say: ['restart', 'start over', 'from the top', 'take it from the beginning'],
    match(w) {
      const asked = w.has('restart', 'beginning')
        || w.hasPhrase('start', 'over')
        || w.hasPhrase('from', 'top')
        || (w.has('top') && w.has('take', 'go', 'start'))
      if (!asked) return null
      return { calls: [{ name: 'transport', input: { action: 'restart' } }], confidence: 0.93 }
    },
  },
  {
    id: 'transport.locate',
    tool: 'transport',
    group: 'Transport',
    what: 'Move the playhead to a bar',
    say: ['go to bar 9', 'jump to bar 17', 'take me to bar 5'],
    match(w) {
      if (!w.has('bar', 'measure')) return null
      const n = w.num()
      if (n == null || n <= 0) return null
      return {
        calls: [{ name: 'transport', input: { action: 'locate', at: { bar: n } } }],
        confidence: 0.9,
      }
    },
  },
  {
    id: 'transport.stop',
    tool: 'transport',
    group: 'Transport',
    what: 'Stop playback',
    say: ['stop', 'halt', 'stop playing'],
    match(w) {
      if (!w.has('stop', 'halt')) return null
      return { calls: [{ name: 'transport', input: { action: 'stop' } }], confidence: 0.95 }
    },
  },
  {
    id: 'transport.pause',
    tool: 'transport',
    group: 'Transport',
    what: 'Pause where you are',
    say: ['pause', 'hold on', 'pause it'],
    match(w) {
      if (!w.has('pause') && !w.said('hold on')) return null
      return { calls: [{ name: 'transport', input: { action: 'pause' } }], confidence: 0.95 }
    },
  },
  {
    id: 'transport.play',
    tool: 'transport',
    group: 'Transport',
    what: 'Start playing',
    say: ['play', 'start', 'go', 'play it'],
    match(w) {
      // Only when the sentence is ENTIRELY about the transport. A loose word
      // count is not enough of a guard: "play the bass louder" is three content
      // words after filler and was being heard as a bare play.
      const ONLY = new Set(['play', 'start', 'go', 'playing', 'playback', 'begin', 'resume'])
      if (!w.has('play', 'start', 'go')) return null
      if (!w.only(ONLY)) return null
      return { calls: [{ name: 'transport', input: { action: 'play' } }], confidence: 0.94 }
    },
  },
]

// ── The order they are TRIED, which is not the order they are read ─────────
//
// Precedence used to be wherever a block happened to be pasted, which is a
// terrible place to keep a decision this consequential: the rules above are
// grouped so a person can read them, and the order they must be attempted in is
// almost the opposite of that. Three constraints drive it, and every one of them
// was a bug first:
//
//   ANYTHING NAMING A TRACK BEATS THE BARE TRANSPORT. "play the bass louder"
//   contains "play" and is not a transport command.
//
//   SPECIFIC BEATS CATCH-ALL WITHIN A FAMILY. "on" is a filler word, so "loop
//   on" cannot be recognised by asking for "on" — the loop rule that turns
//   looping on is the fallback for the whole family, and every loop rule that
//   wants a range, a length or an "off" has to be offered the sentence first.
//
//   A COUNT BEATS A BRACE. "loop the bass 3 more times" is a duplicate, not a
//   loop region, so duplicating is tried before any loop rule.
//
// Listed explicitly, and asserted to name every command exactly once, so adding
// a rule forces a decision about where it sits rather than silently landing last.
const PRECEDENCE: string[] = [
  // Mixer — all of these name a track, so they go first.
  'set_track.mute',
  'set_track.solo',
  'set_track.volume',
  'set_track.volume.relative',
  'set_track.pan',
  // Notes and arrangement — also named, and more specific than the loop family.
  'transpose',
  'automate_parameter.fade',
  'automate_parameter.filter',
  'duplicate_clip',
  'move_clips',
  'insert_clip',
  // Loop: every specific form before the catch-all.
  'set_loop_region.off',
  'set_loop_region.range',
  'set_loop_region.first',
  'set_loop_region.on',
  // Timing. The meter comes after the loop rules because "loop bars 4 to 8" is
  // a pair of numbers that would otherwise read as 4/8.
  'set_tempo',
  'set_tempo.relative',
  'set_time_signature',
  // Transport last — its words appear inside sentences about everything else.
  'transport.restart',
  'transport.locate',
  'transport.stop',
  'transport.pause',
  'transport.play',
]

/** The commands, in the order they are tried. */
export const VOICE_COMMANDS: VoiceCommand[] = (() => {
  const byId = new Map(COMMANDS.map(c => [c.id, c]))
  const ordered = PRECEDENCE.map(id => byId.get(id)).filter((c): c is VoiceCommand => !!c)
  // A command missing from the list still runs — last, and the test says so.
  // Dropping it entirely would make a typo in PRECEDENCE silently disable a
  // command, which is the failure this whole file exists to prevent.
  const rest = COMMANDS.filter(c => !PRECEDENCE.includes(c.id))
  return [...ordered, ...rest]
})()

/** Every command the precedence list forgot. Asserted empty. */
export const UNORDERED_COMMANDS: string[] =
  COMMANDS.filter(c => !PRECEDENCE.includes(c.id)).map(c => c.id)

// ── What the rest of the system reads off this list ─────────────────────────

/** By id, for the tests and the help panel. */
export const COMMANDS_BY_ID: Record<string, VoiceCommand> =
  Object.fromEntries(VOICE_COMMANDS.map(c => [c.id, c]))

/**
 * The words worth priming the transcriber with.
 *
 * Derived from the examples rather than hand-listed, so a new command's words
 * are hinted the moment it is added — the previous hand-written list drifted out
 * of date the first time anyone touched the parser. Common English is filtered
 * out because hinting "the" helps nobody; what earns its place is a word the
 * recogniser would otherwise have to guess at, like "unsolo" or "semitones".
 */
export const COMMAND_VOCABULARY: readonly string[] = (() => {
  const skip = new Set([
    'the', 'a', 'an', 'to', 'it', 'in', 'on', 'at', 'of', 'by', 'me', 'over',
    'and', 'from', 'put', 'take', 'is', 'that', 'this', 'more', 'out', 'up',
    'down', 'off', 'on', 'all', 'one', 'two', 'three', 'four', 'five',
  ])
  const seen = new Set<string>()
  for (const c of VOICE_COMMANDS) {
    for (const phrase of c.say) {
      for (const word of phrase.toLowerCase().split(/[^a-z0-9]+/)) {
        if (!word || skip.has(word) || /^\d+$/.test(word)) continue
        seen.add(word)
      }
    }
  }
  return [...seen].sort()
})()

/** The help panel's contents, grouped the way it displays them. */
export function commandHelp(): { group: string; items: { what: string; say: string }[] }[] {
  const order: VoiceCommand['group'][] = ['Transport', 'Mixer', 'Timing', 'Arrangement', 'Notes', 'Project']
  return order
    .map(group => ({
      group,
      items: VOICE_COMMANDS.filter(c => c.group === group).map(c => ({
        what: c.what,
        say: c.say[0],
      })),
    }))
    .filter(g => g.items.length > 0)
}
