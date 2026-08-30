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
  /**
   * The track currently selected in the studio.
   *
   * The largest gap in the language: nobody working on one track keeps saying
   * its name. They say "louder", "mute this", "pan it left" — and every one of
   * those resolved to nothing, because every rule demanded a name and the
   * sentence contained a pronoun instead.
   *
   * Used ONLY when the sentence names nothing at all, or names only a word like
   * "this" or "it". A sentence that names a track always means that track.
   */
  selectedTrackName?: string
  /**
   * The clip currently selected, if any.
   *
   * Brae: "The user will be able to select things in this space, and when
   * they're selected, Light will recognize that and act edit that selected item
   * unless the user refers directly to a different item or feature."
   *
   * Carried as an ID rather than a name because a clip's name is not unique and
   * often absent — the selection is a specific thing, and resolving it by name
   * would land back in the ambiguity that selecting it was meant to settle.
   */
  selectedClipId?: string
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
  group: 'Transport' | 'Mixer' | 'Timing' | 'Arrangement' | 'Notes' | 'Project' | 'Questions'
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
  /**
   * Carried out by the studio rather than by the executor.
   *
   * Almost every command becomes reducer actions, which is what makes them
   * testable in isolation. Undo is not one: it needs the editor's own history
   * stack, which is not in the project and cannot be. Declaring the exception
   * keeps it honest — the conformance suite checks that UI-handled commands are
   * the ones that skip the executor, rather than quietly excusing any command
   * that fails to plan.
   */
  handledBy?: 'ui'
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
/**
 * Words that point at something without naming it.
 *
 * Stripped as filler everywhere else, which is right — but their PRESENCE is
 * evidence that the speaker meant the thing in front of them, so a rule that
 * finds no name checks for them before falling back.
 */
const DEICTIC = ['this', 'that', 'it', 'here', 'there', 'them', 'these', 'those', 'current', 'selected']

/**
 * The track a sentence means, including when it does not say.
 *
 * A named track always wins. Failing that, a sentence that pointed ("mute
 * this") or simply gave an instruction with no object at all ("louder") means
 * the track the person is looking at.
 *
 * Confidence is lower for the implicit case and deliberately so: it is inferred
 * from the studio's state rather than from anything that was said, and if the
 * selection is not what they thought, the wrong track moves.
 */
/**
 * The clip a sentence means, including when it does not say.
 *
 * Same rule as for tracks, and the same limit: a named clip always wins, and a
 * name that could not be found NEVER falls back — that would edit the selected
 * thing while appearing to have understood a different one.
 */
function clipOrSelected(
  w: Words,
  ctx: InterpretContext,
  remove: string[],
  opts: { dropNums?: boolean } = {},
): { name: string; score: number } | null {
  const named = nameFrom(w, ctx, remove, opts)
  if (named) return named
  if (!ctx.selectedClipId) return null
  const leftover = w.all.filter(x =>
    !remove.includes(x)
    && !DEICTIC.includes(x)
    && !(opts.dropNums && spokenNumber(x) != null))
  if (leftover.length) return null
  // The id form, which the executor resolves directly rather than by name.
  return { name: `#${ctx.selectedClipId}`, score: 0.85 }
}

function nameOrSelected(
  w: Words,
  ctx: InterpretContext,
  remove: string[],
  opts: { dropNums?: boolean } = {},
): { name: string; score: number } | null {
  const named = nameFrom(w, ctx, remove, opts)
  if (named) return named
  if (!ctx.selectedTrackName) return null

  // Only when nothing else could have been the object. Leftover words that are
  // neither command words nor pointers mean the speaker named something this
  // parser failed to find, and acting on the selection instead would be acting
  // on the wrong thing while appearing to understand.
  const leftover = w.all.filter(x =>
    !remove.includes(x)
    && !DEICTIC.includes(x)
    && !(opts.dropNums && spokenNumber(x) != null))
  if (leftover.length) return null
  return { name: ctx.selectedTrackName, score: 0.8 }
}

function nameFrom(
  w: Words,
  ctx: InterpretContext,
  remove: string[],
  opts: { dropNums?: boolean } = {},
): { name: string; score: number } | null {
  const protect = nameWords(ctx)
  const words = w.all.filter(x => !(opts.dropNums && spokenNumber(x) != null))
  const isUnitWord = (x: string) => remove.some(t =>
    x === t || (t.length >= 4 && Math.abs(x.length - t.length) <= 1 && near(x, t)))

  // ── Two readings of the leftover, not one ────────────────────────────────
  //
  // Protecting name words is what stops "bass" being deleted as "bars". But
  // protection alone breaks the opposite case, and it broke it in the most
  // ordinary project imaginable: a new track is called "Track 2" by default, so
  // the word "track" becomes a name word, so "delete the drums track" keeps
  // "track" in the leftover, looks for a track called "drums track", and finds
  // nothing. One added track and every "the X track" phrasing stops working.
  //
  // Neither rule is right on its own, so both readings are produced and the
  // project picks — the same argument as everywhere else here. The protected
  // reading is preferred on a tie, and the unprotected one carries a small cost
  // for having discarded a word that names something.
  const kept = words.filter(x => protect.has(x) || !isUnitWord(x))
  const stripped = words.filter(x => !isUnitWord(x))
  const rest = kept.join(' ').trim()
  if (!rest && !stripped.length) return null

  let used = kept
  let hit = findByName(rest, ctx.tracks)
  if (stripped.length && stripped.length < kept.length) {
    const bare = findByName(stripped.join(' '), ctx.tracks)
    if (bare && bare.score > (hit?.score ?? 0)) {
      hit = bare
      used = stripped
      w.corrections += 0.5
    }
  }

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

/**
 * The effects reachable by name.
 *
 * Hoisted because two rules build commands from it and two more must DECLINE
 * when one appears: "reverb on the drums 40 percent" has a number, a percent
 * and a track name, so the plain volume rule reads it perfectly and answers the
 * wrong question. Naming an effect settles what the sentence is about.
 */
const EFFECTS = ['reverb', 'delay', 'filter', 'compressor', 'saturator', 'chorus', 'limiter']

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
      const hit = nameOrSelected(w, ctx, ['mute', 'unmute', 'silence', 'track'])
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
      const hit = nameOrSelected(w, ctx, ['solo', 'unsolo', 'track'])
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
      // A named effect makes this a different command entirely.
      if (EFFECTS.some(e => w.has(e))) return null
      // The name is resolved BEFORE the number is read, because which numbers
      // are arguments depends on which are part of the name.
      const hit = nameOrSelected(w, ctx, ['percent', 'volume', 'level', 'set', 'put', 'track'], { dropNums: true })
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
      if (EFFECTS.some(e => w.has(e))) return null
      const up = w.has(...UP)
      const down = w.has(...DOWN)
      // Both directions in one sentence is not a nudge, it is a sentence this
      // parser has misread. Saying so costs nothing; guessing costs a mix.
      if (up === down) return null
      const hit = nameOrSelected(w, ctx, [...UP, ...DOWN, 'turn', 'bring', 'make', 'bit', 'touch', 'little',
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
      const hit = nameOrSelected(w, ctx, ['pan', 'panned', 'left', 'right', 'hard', 'center', 'centre',
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
      const hit = clipOrSelected(w, ctx, ['repeat', 'duplicate', 'again', 'copy', 'loop', 'times', 'more',
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
      const hit = clipOrSelected(w, ctx, ['transpose', 'take', 'drop', 'move', 'up', 'down', 'raise', 'lower',
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

  // ── The studio around the song ───────────────────────────────────────────
  {
    id: 'set_master_volume',
    tool: 'set_master_volume',
    group: 'Mixer',
    what: 'Set the level of the whole mix',
    say: ['master volume 80 percent', 'turn everything down', 'set the master to 100 percent'],
    match(w) {
      const named = w.has('master', 'everything')
      if (!named) return null
      const n = w.num()
      if (n != null && n >= 0 && n <= 100) {
        return { calls: [{ name: 'set_master_volume', input: { volume: n } }], confidence: 0.92 }
      }
      // "turn everything down" has no number and still means something
      // definite. A fixed step rather than a guess at how much they meant.
      const up = w.has(...UP)
      const down = w.has(...DOWN)
      if (up === down) return null
      return {
        calls: [{ name: 'set_master_volume', input: { volume: up ? 90 : 60 } }],
        confidence: 0.86,
      }
    },
  },
  {
    id: 'set_swing',
    tool: 'set_swing',
    group: 'Timing',
    what: 'Swing the offbeats, or straighten them',
    say: ['add some swing', 'swing 30 percent', 'straighten it out'],
    match(w) {
      if (w.has('straighten', 'straight')) {
        return { calls: [{ name: 'set_swing', input: { amount: 0 } }], confidence: 0.9 }
      }
      if (!w.has('swing', 'shuffle', 'groove')) return null
      const n = w.num()
      const amount = n != null && n >= 0 && n <= 100 ? n : w.has('some', 'add', 'bit') ? 25 : null
      if (amount == null) return null
      return { calls: [{ name: 'set_swing', input: { amount } }], confidence: 0.9 }
    },
  },
  {
    id: 'add_track',
    tool: 'add_track',
    group: 'Project',
    what: 'Add a new empty track',
    say: ['add a track', 'add a new track', 'give me another track'],
    match(w) {
      if (!w.has('track')) return null
      if (!w.has('add', 'new', 'another', 'create', 'make')) return null
      // "add a kick on bar 9" is an insert, and "add a track" is this. The
      // difference is the word "track", which is why it is required above.
      if (w.has('delete', 'remove', 'duplicate', 'rename', 'copy')) return null
      return { calls: [{ name: 'add_track', input: {} }], confidence: 0.88 }
    },
  },
  {
    id: 'duplicate_track',
    tool: 'duplicate_track',
    group: 'Project',
    what: 'Copy a whole track',
    say: ['duplicate the drums track', 'copy the pad track'],
    match(w, ctx) {
      if (!w.has('track')) return null
      if (!w.has('duplicate', 'copy', 'clone')) return null
      const hit = nameFrom(w, ctx, ['duplicate', 'copy', 'clone', 'track'], { dropNums: true })
      if (!hit) return null
      return {
        calls: [{ name: 'duplicate_track', input: { target: hit.name } }],
        confidence: nameConfidence(hit.score),
        needsName: true,
      }
    },
  },
  {
    id: 'rename_track',
    tool: 'rename_track',
    group: 'Project',
    what: 'Rename a track',
    say: ['rename the pad to strings', 'rename the drums to beats'],
    match(w, ctx) {
      if (!w.has('rename', 'call')) return null
      // "rename X to Y" — the target is before "to" and the new name after it,
      // and "to" is filler everywhere else, so the raw sentence is the only
      // place that split survives.
      const parts = w.raw.toLowerCase().split(/\s+to\s+/)
      if (parts.length !== 2) return null
      const fresh = parts[1].trim().replace(/[^a-z0-9\s'-]/g, '').trim()
      if (!fresh) return null
      const hit = findByName(
        parts[0].replace(/\b(rename|call|the|track|please|can|you)\b/g, ' ').trim(),
        ctx.tracks,
      )
      if (!hit || hit.score < 0.6) return null
      // Every word counts as read: the target, the new name, and the verb.
      for (const word of w.all) w.markWord(word, 0)
      return {
        calls: [{
          name: 'rename_track',
          input: {
            target: hit.item.name ?? '',
            // Title case, because it becomes a label people read.
            name: fresh.replace(/\b[a-z]/g, c => c.toUpperCase()),
          },
        }],
        confidence: nameConfidence(hit.score),
        needsName: true,
      }
    },
  },
  {
    id: 'remove_track',
    tool: 'remove_track',
    group: 'Project',
    what: 'Delete a track and everything on it',
    say: ['delete the pad track', 'remove the guitar track'],
    // Confirmed before it runs. A mishearing that deletes a track is not
    // undone by saying the opposite.
    destructive: true,
    match(w, ctx) {
      if (!w.has('track')) return null
      if (!w.has('delete', 'remove', 'get')) return null
      const hit = nameFrom(w, ctx, ['delete', 'remove', 'get', 'rid', 'track'], { dropNums: true })
      if (!hit) return null
      return {
        calls: [{ name: 'remove_track', input: { target: hit.name } }],
        confidence: nameConfidence(hit.score),
        needsName: true,
      }
    },
  },
  {
    id: 'add_marker',
    tool: 'add_marker',
    group: 'Arrangement',
    what: 'Name a place in the song',
    say: ['mark this as the chorus', 'mark bar 17 as the drop'],
    match(w) {
      if (!w.has('mark', 'marker', 'label')) return null
      // "mark X as Y" — the name is what follows "as".
      const after = w.raw.toLowerCase().split(/\s+as\s+/)[1]
      const name = (after ?? '').trim().replace(/[^a-z0-9\s'-]/g, '').replace(/^the\s+/, '').trim()
      if (!name) return null
      const bar = w.has('bar', 'measure') ? w.num() : null
      for (const word of w.all) w.markWord(word, 0)
      return {
        calls: [{
          name: 'add_marker',
          input: {
            name: name.replace(/\b[a-z]/g, c => c.toUpperCase()),
            ...(bar != null && bar > 0 ? { at: { bar } } : {}),
          },
        }],
        confidence: 0.88,
      }
    },
  },
  {
    id: 'add_effect',
    tool: 'add_effect',
    group: 'Mixer',
    what: 'Put an effect on a track',
    say: ['put reverb on the vocals', 'add delay to the guitar'],
    match(w, ctx) {
      const effect = EFFECTS.find(e => w.has(e))
      if (!effect) return null
      if (!w.has('put', 'add', 'give', 'stick')) return null
      const hit = nameFrom(w, ctx, [...EFFECTS, 'put', 'add', 'give', 'stick', 'some',
        'percent', 'track'], { dropNums: true })
      if (!hit) return null
      const n = argNumbers(w, hit.name)[0]
      if (n != null) w.has('percent')
      return {
        calls: [{
          name: 'add_effect',
          input: { target: hit.name, effect, ...(n != null && n >= 0 && n <= 100 ? { amount: n } : {}) },
        }],
        confidence: nameConfidence(hit.score),
        needsName: true,
      }
    },
  },
  {
    id: 'set_effect',
    tool: 'set_effect',
    group: 'Mixer',
    what: 'Change how much of an effect a track has',
    say: ['more reverb on the pad', 'less delay on the guitar', 'reverb on the drums 40 percent'],
    match(w, ctx) {
      const effect = EFFECTS.find(e => w.has(e))
      if (!effect) return null
      const hit = nameFrom(w, ctx, [...EFFECTS, 'more', 'less', 'percent', 'track',
        'take', 'off', 'up', 'down'], { dropNums: true })
      if (!hit) return null
      const n = argNumbers(w, hit.name)[0]
      // Reading "40 percent" means reading the unit as well as the number.
      if (n != null) w.has('percent')
      const amount = n != null && n >= 0 && n <= 100 ? n
        : w.has('off', 'remove') ? 0
          : w.has('more', 'up', 'louder') ? 60
            : w.has('less', 'down', 'quieter') ? 15
              : null
      if (amount == null) return null
      return {
        calls: [{ name: 'set_effect', input: { target: hit.name, effect, amount } }],
        confidence: nameConfidence(hit.score),
        needsName: true,
      }
    },
  },

  // ── Everything at once ───────────────────────────────────────────────────
  {
    id: 'set_all_tracks.solo_off',
    tool: 'set_all_tracks',
    group: 'Mixer',
    what: 'Clear the solo on every track',
    say: ['clear the solo', 'unsolo everything', 'turn off solo'],
    match(w) {
      if (!w.has('solo', 'unsolo', 'soloed')) return null
      if (!w.has('clear', 'everything', 'all', 'off', 'unsolo', 'no')) return null
      return { calls: [{ name: 'set_all_tracks', input: { solo: false } }], confidence: 0.92 }
    },
  },
  {
    id: 'set_all_tracks.mute',
    tool: 'set_all_tracks',
    group: 'Mixer',
    what: 'Mute or unmute every track',
    say: ['mute everything', 'unmute everything', 'unmute all the tracks'],
    match(w) {
      const on = w.has('mute', 'silence')
      const off = w.has('unmute')
      if (!on && !off) return null
      if (!w.has('everything', 'all')) return null
      return {
        calls: [{ name: 'set_all_tracks', input: { muted: !off } }],
        confidence: 0.92,
      }
    },
  },

  // ── Key ──────────────────────────────────────────────────────────────────
  {
    id: 'set_key_scale',
    tool: 'set_key_scale',
    group: 'Timing',
    what: 'Set the key and scale',
    say: ['put it in f minor', 'set the key to d major', 'change the key to a minor'],
    match(w) {
      // Read from the RAW sentence, not the content words.
      //
      // "A minor" is the commonest key in popular music and its note name is
      // the indefinite article, so the filter that makes every other command
      // robust deletes it. So do "a" in "in a major key" — which is why the
      // note has to be read as part of a PHRASE with the scale rather than
      // hunted for on its own. A bare letter is a note only when a scale word
      // is standing next to it.
      const NOTES: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }
      const m = /\b([a-g])\s*(sharp|flat|#)?\s+(major|minor|dorian|chromatic)\b/i.exec(w.raw)
      if (!m) return null
      const base = NOTES[m[1].toLowerCase()]
      if (base == null) return null
      const accidental = (m[2] ?? '').toLowerCase()
      const key = accidental === 'flat' ? (base + 11) % 12
        : accidental ? (base + 1) % 12
          : base
      // Everything the phrase covers is read, so a sentence that is only this
      // scores as fully explained.
      for (const word of w.all) w.markWord(word, 0)
      return {
        calls: [{ name: 'set_key_scale', input: { key, scale: m[3].toLowerCase() } }],
        confidence: 0.9,
      }
  },
  },

  // ── Deleting a clip ──────────────────────────────────────────────────────
  {
    id: 'remove_clip',
    tool: 'remove_clip',
    group: 'Arrangement',
    what: 'Delete a clip',
    say: ['delete the bass 2 clip', 'remove the drums clip'],
    destructive: true,
    match(w, ctx) {
      if (!w.has('clip', 'item')) return null
      if (!w.has('delete', 'remove', 'get')) return null
      const hit = clipOrSelected(w, ctx, ['delete', 'remove', 'get', 'rid', 'clip', 'item'],
        { dropNums: true })
      if (!hit) return null
      return {
        calls: [{ name: 'remove_clip', input: { target: hit.name } }],
        confidence: nameConfidence(hit.score),
        needsName: true,
      }
    },
  },

  // ── Questions ────────────────────────────────────────────────────────────
  //
  // These answer instead of acting. They barely existed as a category before
  // there was a voice to answer with, and they are the best argument for one:
  // the tempo is on screen somewhere, and reading it means stopping what you
  // are doing, looking away, and losing the thought.
  //
  // Every one of them is computed from the project. None costs anything and
  // none needs the assistant.
  {
    id: 'describe.tempo',
    tool: 'describe',
    group: 'Questions',
    what: 'Ask the tempo',
    say: ['what is the tempo', 'how fast is this', 'what bpm is this'],
    match(w) {
      if (!w.has('tempo', 'bpm', 'fast')) return null
      // A question, not an instruction. "set the tempo to 120" shares its only
      // distinctive word with this, and what separates them is a number to set
      // it to and a verb that means to set it.
      if (w.num() != null) return null
      if (w.has('set', 'change', 'make', 'take', 'speed', 'slow')) return null
      return { calls: [{ name: 'describe', input: { topic: 'tempo' } }], confidence: 0.92 }
    },
  },
  {
    id: 'describe.tracks',
    tool: 'describe',
    group: 'Questions',
    what: 'Ask what tracks there are',
    say: ['what tracks are there', 'how many tracks are there', 'list the tracks'],
    match(w) {
      if (!w.has('track', 'tracks')) return null
      if (!w.has('what', 'how', 'many', 'list', 'which')) return null
      if (w.has('add', 'delete', 'remove', 'rename', 'duplicate', 'mute', 'solo')) return null
      return { calls: [{ name: 'describe', input: { topic: 'tracks' } }], confidence: 0.9 }
    },
  },
  {
    id: 'describe.muted',
    tool: 'describe',
    group: 'Questions',
    what: 'Ask what is muted or soloed',
    say: ['is anything muted', 'is anything soloed', 'what is muted'],
    match(w, ctx) {
      if (!w.has('muted', 'soloed')) return null
      if (!w.has('anything', 'what', 'which', 'any')) return null
      // "mute the bass" names a track and is an instruction; a question names
      // nothing. That is the whole difference, so it is what gets checked.
      if (nameFrom(w, ctx, ['muted', 'soloed', 'anything', 'what', 'which', 'any'],
        { dropNums: true })) return null
      return { calls: [{ name: 'describe', input: { topic: 'muted' } }], confidence: 0.9 }
    },
  },
  {
    id: 'describe.length',
    tool: 'describe',
    group: 'Questions',
    what: 'Ask how long the song is',
    say: ['how long is this', 'how long is the song'],
    match(w) {
      if (!w.hasPhrase('how', 'long')) return null
      return { calls: [{ name: 'describe', input: { topic: 'length' } }], confidence: 0.9 }
    },
  },
  {
    id: 'describe.clips',
    tool: 'describe',
    group: 'Questions',
    what: 'Ask what clips are on a track',
    say: ['how many clips are on the bass 2', 'what clips are on the drums'],
    match(w, ctx) {
      if (!w.has('clip', 'clips', 'item', 'items')) return null
      if (!w.has('what', 'how', 'many', 'which', 'list')) return null
      const hit = nameFrom(w, ctx, ['clip', 'clips', 'item', 'items', 'what', 'how',
        'many', 'which', 'list', 'track'], { dropNums: true })
      return {
        calls: [{ name: 'describe', input: { topic: 'clips', ...(hit ? { target: hit.name } : {}) } }],
        confidence: hit ? nameConfidence(hit.score) : 0.88,
        needsName: !!hit,
      }
    },
  },
  {
    id: 'describe.key',
    tool: 'describe',
    group: 'Questions',
    what: 'Ask what key the song is in',
    say: ['what key is this', 'what key is the song in'],
    match(w) {
      if (!w.has('key')) return null
      if (!w.has('what', 'which')) return null
      return { calls: [{ name: 'describe', input: { topic: 'key' } }], confidence: 0.9 }
    },
  },
  {
    id: 'describe.volume',
    tool: 'describe',
    group: 'Questions',
    what: 'Ask where a track is set',
    say: ['how loud is the bass 2', 'how loud is the drums'],
    match(w, ctx) {
      // "set" is deliberately not a trigger. It made this collide with "what is
      // the loop SET to", and two questions that are equally good readings of
      // one sentence is a question the studio has to ask rather than answer.
      if (!w.has('loud', 'volume', 'level')) return null
      if (!w.has('how', 'where', 'what')) return null
      const hit = nameOrSelected(w, ctx, ['loud', 'volume', 'level', 'how',
        'where', 'what', 'track'], { dropNums: true })
      return {
        calls: [{ name: 'describe', input: { topic: 'volume', ...(hit ? { target: hit.name } : {}) } }],
        confidence: hit ? nameConfidence(hit.score) : 0.86,
        needsName: !!hit,
      }
    },
  },
  {
    id: 'describe.position',
    tool: 'describe',
    group: 'Questions',
    what: 'Ask where the loop is',
    say: ['where is the loop', 'what is the loop set to'],
    match(w) {
      if (!w.has('loop', 'looping')) return null
      if (!w.has('where', 'what')) return null
      return { calls: [{ name: 'describe', input: { topic: 'position' } }], confidence: 0.88 }
    },
  },
  {
    id: 'rename_clip',
    tool: 'rename_clip',
    group: 'Arrangement',
    what: 'Rename a clip',
    say: ['rename the bass 2 clip to intro', 'rename the drums clip to verse'],
    match(w, ctx) {
      if (!w.has('rename')) return null
      if (!w.has('clip', 'item')) return null
      const parts = w.raw.toLowerCase().split(/\s+to\s+/)
      if (parts.length !== 2) return null
      const fresh = parts[1].trim().replace(/[^a-z0-9\s'-]/g, '').trim()
      if (!fresh) return null
      const said = parts[0].replace(/\b(rename|call|the|clip|item|please)\b/g, ' ').trim()
      const hit = said ? findByName(said, ctx.tracks) : null
      if (!hit || hit.score < 0.6) return null
      for (const word of w.all) w.markWord(word, 0)
      return {
        calls: [{
          name: 'rename_clip',
          input: {
            target: hit.item.name ?? '',
            name: fresh.replace(/\b[a-z]/g, c => c.toUpperCase()),
          },
        }],
        confidence: nameConfidence(hit.score),
        needsName: true,
      }
    },
  },

  {
    id: 'undo',
    tool: 'undo',
    group: 'Project',
    what: 'Take back the last change',
    say: ['undo that', 'undo', 'take that back'],
    handledBy: 'ui',
    match(w) {
      if (!w.has('undo', 'revert')) {
        if (!(w.has('take') && w.has('back'))) return null
      }
      if (w.has('redo')) return null
      return { calls: [{ name: 'undo', input: {} }], confidence: 0.93 }
    },
  },
  {
    id: 'redo',
    tool: 'redo',
    group: 'Project',
    what: 'Put back what you just undid',
    say: ['redo that', 'redo'],
    handledBy: 'ui',
    match(w) {
      if (!w.has('redo')) return null
      return { calls: [{ name: 'redo', input: {} }], confidence: 0.93 }
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
  // Everything-at-once before the single-track rules: "mute everything" is not
  // an instruction about a track called everything.
  'set_all_tracks.solo_off',
  'set_all_tracks.mute',
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
  // The studio around the song. These all carry a distinctive noun — "track",
  // an effect's name, "master", "swing" — so they are unambiguous enough to sit
  // ahead of the general timing rules.
  'rename_track',
  // Deleting a CLIP before deleting a track: both say "delete", and only one
  // of them says "clip".
  'remove_clip',
  'remove_track',
  'duplicate_track',
  'add_track',
  'add_effect',
  'set_effect',
  'set_master_volume',
  'add_marker',
  'set_swing',
  // Timing. The meter comes after the loop rules because "loop bars 4 to 8" is
  // a pair of numbers that would otherwise read as 4/8.
  'set_tempo',
  'set_tempo.relative',
  'set_time_signature',
  // Questions before the instructions they resemble: "what's the tempo" and
  // "set the tempo to 120" share their only distinctive word.
  'describe.tempo',
  'describe.tracks',
  'describe.muted',
  'describe.length',
  'describe.clips',
  'describe.key',
  'describe.volume',
  'describe.position',
  'set_key_scale',
  'rename_clip',
  // Undo before the transport: "take that back" contains no transport word, but
  // keeping the pair together is clearer than scattering them.
  'undo',
  'redo',
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

/**
 * Words the transcriber may be PRIMED with but which must never be substituted
 * INTO.
 *
 * The two vocabularies look like one and are not. Hinting "how" to a recogniser
 * is free and occasionally helps. Allowing the hypothesis search to rewrite some
 * other word INTO "how" is a different act entirely: it changes the mood of the
 * sentence, and a statement rewritten into a question is a command nobody gave.
 *
 * It was doing exactly that — "the drums are too loud in the room" became "the
 * drums are HOW loud in the room" for the cost of two letters, and the studio
 * answered a question that had not been asked.
 *
 * So: interrogatives, quantifiers and the commonest function words are
 * off-limits as substitution targets. They are cheap to reach from almost
 * anything and almost never what was actually said.
 */
export const NEVER_SUBSTITUTE: readonly string[] = [
  'how', 'what', 'where', 'which', 'when', 'why', 'who',
  'all', 'any', 'no', 'not', 'is', 'are', 'was', 'be',
  'the', 'and', 'or', 'to', 'in', 'on', 'at', 'of', 'for', 'with',
  'this', 'that', 'it', 'them', 'more', 'less',
]

/** The help panel's contents, grouped the way it displays them. */
export function commandHelp(): { group: string; items: { what: string; say: string }[] }[] {
  const order: VoiceCommand['group'][] =
    ['Transport', 'Mixer', 'Timing', 'Arrangement', 'Notes', 'Project', 'Questions']
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
