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
import { beatWordsOf } from './beatbox'
import { parseDefinitions } from './vocab'
import { COMMAND_SUMMARIES } from './command-summaries'

/** Drum names a single-lane recording can be asked for. */
const DRUM_WORDS = ['kick', 'snare', 'clap', 'crash', 'rim', 'hat', 'hihat', 'tom']

import type { VoiceCall } from './execute-music'
import { Words, near } from './words'
import { matchApolloParam, matchFilterType, moduleHint } from '../apollo/spoken-params'

export interface InterpretContext {
  /**
   * The project's tracks. Volume and pan are read for RELATIVE commands —
   * "turn the bass up" has to know where the bass currently is — and are
   * optional so a caller with only names still gets everything else.
   */
  //
  // `instrument` is read by the Apollo rules, which have to stand aside on a
  // track that is not Apollo so the effect commands can take the sentence
  // instead. Optional, and absence means UNKNOWN rather than no — a caller
  // that only has names should not have every Apollo command declined.
  tracks: { id: string; name?: string; volume?: number; pan?: number; instrument?: { type?: string } | null }[]
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
  /**
   * The clips in the project, so a rule can read "Bass body 1" as one target.
   *
   * Naming a track AND an item is the most specific thing anybody can say, and
   * without the clips here the rules could only see the track half: "bass body
   * 1" matched no track, narrowed to "bass", and silently dropped the part that
   * made it unambiguous.
   */
  clips?: { id: string; name?: string; trackId: string }[]
  /**
   * The sound library, as far as this machine has one.
   *
   * Resolved HERE rather than in the executor because the library is not part
   * of the song — it lives in local storage and differs per machine, while the
   * executor is pure and sees only the project. So the rule turns "a violin"
   * into an id and the executor applies it, which keeps the executor honest and
   * the library where it actually is.
   */
  library?: { id: string; name: string; group?: string }[]
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
/**
 * Is this track known NOT to be Apollo?
 *
 * ⚠️ Three-valued on purpose. False means "Apollo, or we cannot tell" — a
 * context without instruments must not have every Apollo command declined, and
 * the executor's refusal is a good answer when it really is the wrong track.
 */
export function isNotApollo(name: string, ctx: InterpretContext): boolean {
  const t = ctx.tracks.find(x => foldName(x.name ?? '') === foldName(name))
  const type = t?.instrument?.type
  return type != null && type !== 'apollo'
}

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

/**
 * "Bass body 1" — a track and an item on it, said together.
 *
 * Returned as the whole phrase rather than resolved here: the executor already
 * knows how to read that form, and returning the phrase keeps one place
 * responsible for turning words into a clip. What matters at this level is that
 * the phrase survives instead of being narrowed to the track and losing the half
 * that made it specific.
 */
function compoundTarget(rest: string, ctx: InterpretContext): { name: string; score: number } | null {
  if (!ctx.clips?.length || !rest) return null
  const folded = ` ${foldName(rest)} `
  for (const track of ctx.tracks) {
    const tName = foldName(track.name ?? '')
    if (!tName) continue
    // Found ANYWHERE, not only at the start: the leftover often keeps a verb
    // the rule did not think to remove — "add bass body 1" — and requiring the
    // track name first threw away the most specific reading over the word
    // "add".
    const at = folded.indexOf(` ${tName} `)
    if (at < 0) continue
    const tail = folded.slice(at + tName.length + 2).trim()
    if (!tail) continue
    const onTrack = ctx.clips.filter(c => c.trackId === track.id)
    // The LONGEST leading part of the tail that names a clip. The rest of the
    // tail is usually an argument — "take the bass body 1 up 3 semitones" ends
    // "body 1 3" once the command words are out, and requiring the whole tail
    // to be the name meant the 3 broke the match and then became the answer.
    const tailWords = tail.split(' ').filter(Boolean)
    for (let n = tailWords.length; n >= 1; n--) {
      const hit = findByName(tailWords.slice(0, n).join(' '), onTrack)
      if (hit && hit.score >= 0.6) {
        return { name: `${track.name} ${hit.item.name ?? ''}`.trim(), score: Math.min(1, hit.score) }
      }
    }
  }
  return null
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

  // ── A track and an item together beats either alone ──────────────────────
  //
  // The most specific thing anybody can say, so it is tried first — and tried
  // against the leftover WITH its numbers, because "Body 2" is a name and its
  // digit is the half that says which one. Dropping numbers first left "bass
  // body", which matches Body 1 and Body 2 equally and so matches nothing.
  const withNumbers = w.all
    .filter(x => protect.has(x) || !isUnitWord(x))
    .join(' ')
    .trim()
  const compound = compoundTarget(withNumbers, ctx) ?? compoundTarget(rest, ctx)
  if (compound) {
    for (const word of w.all) w.markWord(word, 0)
    return compound
  }

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

  // ── Last resort: the number was part of the name after all ───────────────
  //
  // dropNums exists so "loop the bass 3 more times" does not go looking for a
  // track called "Bass 3". It has the opposite failure too: "duplicate Bass 2"
  // becomes "bass", which matches Bass 1 and Bass 2 equally well and therefore
  // matches NOTHING — every numbered track was unreachable for these commands,
  // including the phrasings the rules list as their own examples.
  //
  // The compound path above already had to learn this for clips ("Body 2"), and
  // this is the same lesson for tracks. Tried only after the dropped-number
  // reading has failed outright, so the ordinary case is untouched: a sentence
  // whose number really is an argument still resolves by name first, and only a
  // sentence left with no track at all asks whether the digit was the name.
  if ((!hit || hit.score < 0.6) && opts.dropNums) {
    const asName = w.all.filter(x => protect.has(x) || !isUnitWord(x))
    const digits = asName.filter(x => spokenNumber(x) != null)
    // "loop bass 2 3 more times" carries two numbers and only ONE of them is
    // the name — keeping both looks for a track called "Bass 2 3". So each
    // number is tried as the name's number in turn, with the others dropped,
    // and the project says which reading is real. argNumbers then takes the
    // leftover digit back as the argument, which is what it was written for.
    const tries = [asName, ...digits.map(d => {
      let kept = false
      return asName.filter(x => spokenNumber(x) == null || (x === d && !kept && (kept = true)))
    })]
    for (const attempt of tries) {
      const exact = findByName(attempt.join(' '), ctx.tracks)
      if (exact && exact.score >= 0.6 && exact.score > (hit?.score ?? 0)) { hit = exact; used = attempt }
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

/**
 * Words that mean THE WHOLE SONG rather than naming a part of it.
 *
 * Brae: "I was telling the voice control to 'Start the song' and it didn't know
 * what that meant, but it understood start. I don't want this kind of issue with
 * other commands too."
 *
 * The transport rule demanded that every word be one of seven, so it heard
 * "start" and refused "start the song" — the extra word was not a track, not
 * another command and not noise, it was the OBJECT, and the rule had no idea
 * such a thing existed.
 *
 * The wrong fix is a phrasing per sentence: "start the song", "play the music",
 * "start the track", and the fifth one still fails. This is the right size of
 * idea — one shared vocabulary for the thing a transport command acts on, used
 * by every transport rule at once. Naming the object is not a different command.
 *
 * It does NOT loosen anything. A word here is one that names the whole project;
 * a track name or another rule's verb is still a reason to decline, which is
 * what keeps "play the bass louder" out of the transport.
 */
const THE_SONG = [
  'song', 'track', 'music', 'tune', 'thing', 'whole', 'everything', 'project',
  'arrangement', 'playback', 'back', 'again', 'it',
]

/** Words that mean "make it bigger" and "make it smaller". */
/**
 * The frequency in a sentence, if it names one.
 *
 * ⚠️ "Boost 5k on the vocals" — which eq_band's own description calls the
 * commonest sentence in any mixing session — was setting the VOCAL FADER to 95%.
 * Two reasons, and both are about tokens rather than meaning:
 *
 *   "5k" is ONE token. The rule tested w.has('k'), which only matches a
 *   standalone "k", so it read "boost 5 k" (spaced) and missed "boost 5k",
 *   which is how everybody actually says and writes it.
 *
 *   "boost" is in UP, so the volume rule took the sentence instead — and it
 *   ignores the number entirely, nudging the fader by a step. An EQ request
 *   silently became a level change.
 *
 * Read off `raw` rather than the tokens, because the tokeniser splits "1.5k"
 * into "1" and "5k" and there is no recovering 1.5 from that afterwards.
 */
export function spokenHz(w: Words): number | null {
  const m = w.raw.toLowerCase().match(/(\d+(?:\.\d+)?)\s*(khz|k|hz|hertz)\b/)
  if (!m) return null
  const n = parseFloat(m[1])
  if (!isFinite(n)) return null
  const hz = /^k/.test(m[2]) ? n * 1000 : n
  return hz >= 20 && hz <= 20000 ? hz : null
}

/** Is this sentence asking to cut or boost AT A FREQUENCY? */
function readsAsEq(w: Words): boolean {
  if (!w.has('cut', 'reduce', 'remove', 'notch', 'boost', 'add', 'lift', 'raise')) return false
  if (w.has('percent', 'volume', 'level', 'db', 'decibels')) return false
  if (spokenHz(w) != null) return true
  // A bare number in the audible range, with a cut or boost word and no unit of
  // level anywhere. A fader runs 0-100, so "boost 5000" cannot be one.
  const n = w.num()
  return n != null && n >= 100 && n <= 20000
}

const UP = ['up', 'louder', 'boost', 'raise', 'increase', 'higher', 'more']
// "Softer" is deliberately NOT here. On a fader it means quieter; on a MIDI
// part it means played more gently, and those are different edits with
// different results — one moves a level, the other moves every note's velocity
// and changes the sound of the instrument. Musicians mean the second, so it
// belongs to set_velocity and "quieter" is left to mean the fader.
const DOWN = ['down', 'quieter', 'lower', 'reduce', 'decrease', 'less']

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
      // ⚠️ Apollo's layers have levels too, and "sub level to 40 on the pad"
      // turned the PAD down to 40 percent — a loud, wrong edit to the mix in
      // answer to a question about the synth. Third time this trap has been
      // sprung on a volume rule; the relative one has the same guard.
      if (w.has('sub', 'subs', 'noise', 'oscillator', 'osc')) return null
      // ⚠️ A FREQUENCY IS NOT A LEVEL. "Boost 5k on the vocals" was landing
      // here and nudging the fader, because 'boost' is in UP and this rule does
      // not even look at the number. eq_band owns anything that names a
      // frequency; see spokenHz.
      if (readsAsEq(w)) return null
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
      // ⚠️ Tone words share "up" and "more" with volume — "warm UP the guitar"
      // and "MORE punch" are not level changes, and this rule sees them first
      // because it is looking for exactly those two words. Naming a quality
      // means the sentence is about tone.
      if (w.has('warm', 'warmer', 'warmth', 'bright', 'brighter', 'brighten',
        'dark', 'darker', 'darken', 'punch', 'punchier', 'punchy', 'fuller',
        'thicker', 'thinner', 'cleaner', 'snappier', 'duller')) return null
      // Same trap with feel words: "loosen UP the pad" is a groove, not a
      // level. "Up" is the most overloaded word in the vocabulary.
      if (w.has('loosen', 'groove', 'shuffle', 'feel')) return null
      // And once more for Apollo's layers: "MORE sub on the pad" is the sub
      // oscillator coming in, not the track fader going up.
      if (w.has('sub', 'subs', 'noise', 'oscillator', 'osc')) return null
      if (EFFECTS.some(e => w.has(e))) return null
      // ⚠️ A FREQUENCY IS NOT A LEVEL. "Boost 5k on the vocals" was landing
      // here and nudging the fader, because 'boost' is in UP and this rule does
      // not even look at the number. eq_band owns anything that names a
      // frequency; see spokenHz.
      if (readsAsEq(w)) return null
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
      // A length is optional. "Fade the pad in" over what? Over the pad — the
      // executor already falls back to the clip's own length, and demanding a
      // duration made the studio refuse the shortest way of saying the thing.
      const length = lengthWith(w, argNumbers(w, hit.name)[0])
      return {
        calls: [{
          name: 'automate_parameter',
          input: {
            target: hit.name, parameter: 'volume',
            from: inward ? 0 : 100, to: inward ? 100 : 0,
            ...(length ? { length } : {}),
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
      // "add a descending filter", "put a rising filter on it" — the direction
      // word carries the whole meaning, so the verb in front of it can be
      // anything. Listing every verb would be a dozen near-identical commands;
      // reading the direction is one rule that covers all of them.
      const open = w.has('open', 'opening', 'up', 'rising', 'ascending', 'opens')
      const close = w.has('close', 'closing', 'down', 'falling', 'descending', 'closes')
      if (open === close) return null
      // ⚠️ A sweep MOVES OVER TIME. Either the sentence says how long, or it
      // uses a word that can only mean a movement — "a rising filter" is a
      // sweep with or without a length, but a bare "open the filter" is far
      // more likely to mean the filter is too closed right now. Without this,
      // a setting became a structural edit: a new effect plus an automation
      // lane, and on a track with no clip, an error instead of an answer.
      const moving = w.has('opening', 'closing', 'rising', 'falling', 'ascending',
        'descending', 'sweep', 'sweeps', 'gradually', 'slowly', 'over', 'across')
      if (!moving && !w.has('bar', 'bars', 'measure', 'measures', 'beat', 'beats',
        'second', 'seconds')) return null
      const hit = nameFrom(w, ctx, ['open', 'opening', 'close', 'closing', 'up', 'down', 'rising',
          'falling', 'ascending', 'descending', 'filter', 'lowpass', 'cutoff', 'over',
          'across', 'bar', 'bars', 'measure', 'measures', 'beat', 'beats', 'second',
          'seconds', 'track', 'sweep'], { dropNums: true })
      if (!hit) return null
      const length = lengthWith(w, argNumbers(w, hit.name)[0])
      return {
        calls: [{
          name: 'automate_parameter',
          input: {
            target: hit.name, parameter: 'lowpass',
            from: open ? 0 : 100, to: open ? 100 : 0,
            ...(length ? { length } : {}),
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
  // ── Saying a beat out loud ────────────────────────────────────────────────
  //
  // Brae: "I just said 'Can you make a beat like boom ka boom ka' and it didn't
  // know what I was talking about."
  //
  // The tool existed and the assistant had it. What was missing is THIS: with
  // the microphone held open, a sentence the built-in commands cannot read is
  // dropped silently as room noise (see shouldActOn) unless the assistant is
  // set to act on its own. A beat is unmistakably addressed to the studio -
  // nobody says "boom ka boom ka" to a person - so the studio should be able to
  // read it itself, without paying a model to tell it what it just heard.
  //
  // Reading it locally also makes it instant and free, which matters more here
  // than for most commands: saying a rhythm is something people do repeatedly,
  // adjusting it each time.
  {
    id: 'make_beat',
    tool: 'make_beat',
    group: 'Notes',
    what: 'Say a rhythm out loud and get it as drums',
    say: [
      'make a beat like boom ka boom boom ka',
      'can you make a beat like boom ka boom ka',
      'boom ka boom boom ka',
      'give me a beat like doom ts doom ts',
    ],
    match(w) {
      // The RAW sentence, not the filtered word list: the filter exists to drop
      // conversational noise, and a beat is made of exactly the kind of short
      // meaningless syllables it drops.
      const spoken = w.raw.split(/\s+/).filter(Boolean).map(word => ({ word }))
      const { beat } = beatWordsOf(spoken)
      if (beat.length < 2) return null
      // Two syllables are only a beat if they were asked for as one. Three or
      // more is a rhythm on its own - nobody ends a sentence with three drum
      // sounds by accident.
      const asked = w.has('beat', 'rhythm', 'drums', 'drum', 'pattern', 'groove')
      if (!asked && beat.length < 3) return null
      return {
        calls: [{ name: 'make_beat', input: { pattern: beat.map(b => b.word).join(' ') } }],
        confidence: 0.9,
      }
    },
  },
  {
    id: 'set_apollo_layer',
    tool: 'set_apollo_layer',
    group: 'Notes',
    what: 'Bring in Apollo\'s sub, noise or oscillators',
    say: ['add sub to the synth', 'more sub on the synth', 'take the sub off the synth'],
    match(w, ctx) {
      const layer = w.has('sub', 'subs') ? 'sub'
        : w.has('noise') ? 'noise'
          : (w.has('oscillator', 'osc') && w.num() != null) ? `osc ${w.num()}` : null
      if (!layer) return null
      // ⚠️ "Osc 2 detune to 20" names a DIAL, and this rule was taking it —
      // switching oscillator 2 on and never touching the detune, then saying so
      // as though it had done what was asked. Bringing a layer IN and moving one
      // of its dials are different commands that share every other word.
      if (matchApolloParam(w.all.join(' ')).ok) return null
      // A track has to be named, or "more sub" is about the mix and belongs to
      // whoever asked for it rather than to a guess.
      const named = nameOrSelected(w, ctx, ['add', 'more', 'less', 'take', 'off', 'bring',
        'in', 'to', 'the', 'a', 'some', 'on', 'up', 'down', 'turn', 'sub', 'subs',
        'noise', 'oscillator', 'osc', 'apollo'], { dropNums: true })
      if (!named) return null
      const off = w.has('off', 'remove', 'without') || (w.has('take') && w.has('out'))
      const n = w.num()
      return {
        calls: [{
          name: 'set_apollo_layer',
          input: {
            target: named.name, layer,
            ...(off ? { on: false } : { on: true }),
            ...(n != null && !/osc/.test(layer) ? { level: n } : {}),
          },
        }],
        confidence: 0.9,
      }
    },
  },

  {
    id: 'set_apollo_param',
    tool: 'set_apollo_param',
    group: 'Notes',
    what: "Any dial inside Apollo, by name",
    say: [
      'wavetable position halfway on the synth',
      'lfo 2 rate to 5 hertz on the synth',
      'filter 2 resonance to 40 on the synth',
      'macro 2 to 70 on the synth',
    ],
    match(w, ctx) {
      // ⚠️ THE GATE, and the whole reason this rule is safe.
      //
      // The matcher knows 166 dials, and their names include level, pan, rate,
      // width, mix, drive, phase and attack — words that belong to the mixer,
      // to set_width, to the effects. A rule that fired on those would answer a
      // sentence about the track with a change inside the synth, which is the
      // same class of mistake as answering it with the tempo.
      //
      // So a sentence has to SAY it is about the synth's insides: Apollo by
      // name, or one of its modules, or a dial that exists nowhere else.
      //
      // ⚠️ cutoff, resonance and detune are deliberately NOT here. They are
      // set_sound's, and set_sound now hands them to Apollo itself — two rules
      // reading the same sentence and letting the score decide is how a command
      // starts landing somewhere different depending on how it was phrased.
      // "Filter 2 resonance" still reaches this rule, through `filter`.
      const inside = w.has('apollo', 'osc', 'oscillator', 'sub', 'noise', 'wavetable',
        'wavetables', 'grain', 'grains', 'granular', 'spectral', 'warp', 'scan',
        'formant', 'glide', 'portamento', 'spray', 'macro', 'lfo', 'filter')
      if (!inside) return null
      // The layer command owns turning a layer ON. This one moves a dial, so a
      // bare "add sub to the pad" with no dial in it is not ours.
      const m = matchApolloParam(w.all.join(' '))
      if (!m.ok) return null

      // ⚠️ THE FIRST NUMBER IS USUALLY THE MODULE, NOT THE VALUE. "Macro 2 to
      // 70" set macro 2 to two percent; "LFO 2 rate to 5 hertz" set the rate to
      // 2 Hz, which is the default — so it reported success and changed
      // nothing, the exact failure this whole file keeps guarding against.
      const nums = w.nums()
      const moduleNum = Number(/(\d+)$/.exec(moduleHint(w.all.join(' ')) ?? '')?.[1] ?? NaN)
      const idx = Number.isFinite(moduleNum) ? nums.indexOf(moduleNum) : -1
      const values = idx >= 0 ? nums.filter((_, k) => k !== idx) : nums
      const n = values.length ? values[0] : null
      const pct = w.has('percent', 'per cent') ? n : null
      const half = w.has('halfway', 'half') ? 50 : w.has('all') && w.has('way') ? 100 : null
      const dir = w.has('more', 'up', 'open', 'longer', 'higher', 'faster') ? 'more'
        : w.has('less', 'down', 'close', 'shorter', 'lower', 'slower') ? 'less' : null
      if (n == null && half == null && !dir) return null

      const named = nameOrSelected(w, ctx, ['set', 'the', 'a', 'an', 'to', 'on', 'in', 'of',
        'make', 'give', 'it', 'its', 'apollo', 'percent', 'hertz', 'hz', 'halfway', 'half',
        'all', 'way', 'more', 'less', 'up', 'down', 'open', 'close', 'bit', 'touch',
        ...m.param.dial.split(' '), ...m.param.moduleLabel.split(' ')], { dropNums: true })
      if (!named) return null
      // ⚠️ "Filter cutoff to 500 on the drums" is not an Apollo sentence, and
      // answering it with "that is not Apollo" would be a refusal where
      // set_device_param would simply have done it. Stand aside and let the
      // effect commands read it. Unknown instrument still comes here, because
      // the executor's refusal names the fix.
      if (isNotApollo(named.name, ctx)) return null

      return {
        calls: [{
          name: 'set_apollo_param',
          input: {
            target: named.name,
            // The phrase, not the resolved path — the executor re-reads it, so
            // there is ONE matcher and the local and AI paths cannot disagree
            // about what "the level" meant.
            parameter: w.all.join(' '),
            ...(half != null ? { percent: half }
              : pct != null ? { percent: pct }
                : n != null ? { value: n } : { direction: dir }),
          },
        }],
        confidence: 0.88,
      }
    },
  },

  {
    id: 'set_apollo_filter',
    tool: 'set_apollo_filter',
    group: 'Notes',
    what: 'Change which filter model Apollo is using',
    say: ['give the synth a ladder filter', 'put a comb filter on the synth'],
    match(w, ctx) {
      // A filter TYPE has to be named. "More filter on the pad" is a different
      // command about a different thing, and this rule must not take it.
      if (!w.has('filter')) return null
      const found = matchFilterType(w.all.join(' '))
      if (!found) return null
      // ⚠️ add_effect owns "put a filter on it" as a separate device. This is
      // only ever the synth's own filter, so the sentence has to name a model.
      const which = w.has('2', 'two') && w.has('filter') ? 2 : 1
      const named = nameOrSelected(w, ctx, ['give', 'put', 'make', 'set', 'the', 'a', 'an',
        'to', 'on', 'in', 'it', 'its', 'filter', 'apollo', 'db', 'pole',
        ...found.label.toLowerCase().split(/[\s/]+/)], { dropNums: true })
      if (!named) return null
      // A ladder filter on a drum kit is add_effect's filter device, not a
      // refusal — Apollo is not the only thing in the studio with a filter.
      if (isNotApollo(named.name, ctx)) return null
      return {
        calls: [{ name: 'set_apollo_filter', input: { target: named.name, type: w.all.join(' '), filter: which } }],
        confidence: 0.9,
      }
    },
  },

  // ── The rest of the audit's open list ────────────────────────────────────
  //
  // Built for the assistant first — the tool descriptions carry the weight —
  // but each one gets a rule so the same sentence works with the assistant off
  // and is not dropped at the attention gate in a held-open session.
  {
    id: 'set_device_param',
    tool: 'set_device_param',
    group: 'Mixer',
    what: 'Set a dial inside an effect by name',
    say: [
      'set the compressor ratio to 4 on the pad',
      'make the reverb decay longer on the vocals',
      'delay feedback to 40 percent on the guitar',
    ],
    match(w, ctx) {
      // ⚠️ 'filter' and its dials were missing, so "filter cutoff to 500 on the
      // drums" read as nothing at all — the one device everybody adjusts by
      // name, and the sentence had nowhere to go.
      const DEVICES = ['reverb', 'delay', 'compressor', 'limiter', 'gate', 'chorus', 'saturator', 'eq', 'filter']
      const PARAMS = ['threshold', 'ratio', 'feedback', 'ceiling', 'decay', 'predelay', 'rate', 'depth', 'mix', 'cutoff', 'resonance']
      const device = DEVICES.find(d => w.has(d))
      const param = PARAMS.find(x => w.has(x))
      // ⚠️ BOTH required. A device on its own is add_effect or set_effect; a
      // parameter on its own is the instrument's own envelope (set_sound).
      // Naming both is the only sentence that is unambiguously this.
      if (!device || !param) return null
      // ⚠️ "Filter 2 resonance" is Apollo's SECOND FILTER, not a device — a
      // device has no number after its name. Without this the sentence added a
      // filter effect and set its resonance to 2, reading the module index as
      // the value, which is the same trap the Apollo rule already guards.
      const after = w.all[w.all.indexOf(device) + 1]
      if (device === 'filter' && /^(1|2|one|two)$/.test(after ?? '')) return null
      const n = w.num()
      const named = nameOrSelected(w, ctx, ['set', 'make', 'the', 'to', 'on', 'longer',
        'shorter', 'percent', 'a', 'bit', device, param], { dropNums: true })
      if (!named) return null
      return {
        calls: [{
          name: 'set_device_param',
          input: {
            target: named.name, device, parameter: param,
            ...(n != null ? (w.has('percent') ? { percent: n } : { value: n }) : {}),
            ...(n == null && w.has('longer', 'more') ? { percent: 75 } : {}),
            ...(n == null && w.has('shorter', 'less') ? { percent: 25 } : {}),
          },
        }],
        confidence: 0.9,
      }
    },
  },
  {
    id: 'set_sound',
    tool: 'set_sound',
    group: 'Notes',
    what: 'Shape the instrument itself — attack, release, cutoff',
    say: [
      'give the pad a slower attack', 'shorten the release on the pad',
      'more cutoff on the pad', 'more resonance on the pad',
    ],
    match(w, ctx) {
      const MAP: Array<[string[], string]> = [
        [['attack'], 'attack'],
        [['release'], 'release'],
        [['sustain'], 'sustain'],
        // ⚠️ No 'filter': automate_parameter owns it, and a sweep and a
        // setting are different commands that share the noun. 'cutoff' is
        // unambiguous.
        [['cutoff'], 'cutoff'],
        // ⚠️ Was deliberately absent: automate_parameter owned the noun. It now
        // owns only the sentences that MOVE over time, so "open the filter" —
        // which is a setting, and the commonest thing anybody says to a synth —
        // has somewhere to land. Still needs open or close: a bare "put a filter
        // on it" is a device, and that is add_effect's.
        [['filter'], 'cutoff'],
        [['resonance'], 'resonance'],
        [['detune'], 'detune'],
      ]
      const hit = MAP.find(([words]) => w.has(...words))
      if (!hit) return null
      // "Filter to 40" is not a cutoff — the number belongs to a device amount.
      // Only "open"/"close the filter" is this command.
      if (hit[0][0] === 'filter' && !w.has('open', 'close', 'opened', 'closed')) return null
      // And the reverse: "FILTER cutoff to 500" names a device and a dial, so
      // it belongs to set_device_param. Only "open/close the filter" — the
      // entry above, where the filter IS the dial — stays here.
      if (hit[0][0] !== 'filter' && w.has('filter')) return null
      // A named device means they mean that device's dial, not the synth's.
      if (w.has('compressor', 'reverb', 'delay', 'limiter', 'gate', 'chorus')) return null
      const dir = w.has('slower', 'longer', 'more', 'open', 'up') ? 'more'
        : w.has('faster', 'shorter', 'less', 'close', 'down') ? 'less' : null
      const n = w.num()
      if (dir == null && n == null) return null
      const named = nameOrSelected(w, ctx, ['give', 'make', 'the', 'a', 'an', 'to', 'on',
        'slower', 'faster', 'longer', 'shorter', 'more', 'less', 'open', 'close', 'up', 'down',
        'bit', ...hit[0]], { dropNums: true })
      if (!named) return null
      return {
        calls: [{
          name: 'set_sound',
          input: { target: named.name, parameter: hit[1], ...(n != null ? { value: n } : { direction: dir }) },
        }],
        confidence: 0.88,
      }
    },
  },
  {
    id: 'eq_band',
    tool: 'eq_band',
    group: 'Mixer',
    what: 'Cut or boost at a frequency',
    say: ['cut 300 hertz on the pad', 'boost 5k on the vocals'],
    match(w, ctx) {
      const cut = w.has('cut', 'reduce', 'remove', 'notch')
      const boost = w.has('boost', 'add', 'lift', 'raise')
      if (!cut && !boost) return null
      if (!readsAsEq(w)) return null
      // "5k", "5 k", "5 khz", "300 hertz" and a bare "5000" all land here.
      const hz = spokenHz(w) ?? w.num()
      if (hz == null) return null
      const named = nameOrSelected(w, ctx, ['cut', 'boost', 'reduce', 'remove', 'notch',
        'add', 'lift', 'raise', 'the', 'a', 'bit', 'of', 'at', 'on', 'some',
        'hertz', 'hz', 'k', 'khz'], { dropNums: true })
      if (!named) return null
      return {
        calls: [{ name: 'eq_band', input: { target: named.name, frequency: hz, action: cut ? 'cut' : 'boost' } }],
        confidence: 0.9,
      }
    },
  },
  {
    id: 'send_to',
    tool: 'send_to',
    group: 'Mixer',
    what: 'Send a track to a return bus',
    say: ['send the pad to the reverb', 'send the vocals to the reverb'],
    match(w, ctx) {
      if (!w.has('send', 'sending')) return null
      const m = /\bsend\w*\s+(?:the\s+)?(.+?)\s+(?:to|into)\s+(?:the\s+)?(.+?)\s*$/i.exec(w.raw)
      if (!m) return null
      const track = findByName(m[1].trim(), ctx.tracks ?? [])
      if (!track) return null
      for (const word of w.all) w.has(word)
      return {
        calls: [{ name: 'send_to', input: { target: track.item.name, to: m[2].trim().replace(/\b(return|bus|send)\b/gi, '').trim() } }],
        confidence: 0.9,
      }
    },
  },
  {
    id: 'nudge',
    tool: 'nudge',
    group: 'Arrangement',
    what: 'Move something by a few milliseconds',
    say: ['nudge the pad clip later', 'nudge the drums clip earlier'],
    match(w, ctx) {
      if (!w.has('nudge', 'nudged')) return null
      const dir = w.has('earlier', 'forward', 'ahead', 'before') ? 'earlier' : 'later'
      const n = w.num()
      const named = nameOrSelected(w, ctx, ['nudge', 'nudged', 'the', 'a', 'bit',
        'later', 'earlier', 'forward', 'ahead', 'before', 'back', 'milliseconds', 'ms'],
      { dropNums: true })
      if (!named) return null
      return {
        calls: [{ name: 'nudge', input: { target: named.name, direction: dir, ...(n != null ? { milliseconds: n } : {}) } }],
        confidence: 0.9,
      }
    },
  },
  {
    id: 'tempo_ramp',
    tool: 'tempo_ramp',
    group: 'Timing',
    what: 'Speed up or slow down gradually',
    say: ['gradually slow down to 100', 'ritardando to 90'],
    match(w) {
      const named = w.has('ritardando', 'rit', 'accelerando', 'accel')
      // ⚠️ "slow down" alone belongs to set_tempo.relative — the difference is
      // that this one happens OVER a stretch, so a gradual word is required.
      const gradual = w.has('gradually', 'slowly', 'over', 'into')
      if (!named && !gradual) return null
      if (!named && !w.has('slow', 'speed', 'faster', 'slower')) return null
      const n = w.num()
      const dir = w.has('accelerando', 'accel', 'speed', 'faster') ? 'faster' : 'slower'
      return {
        calls: [{ name: 'tempo_ramp', input: { ...(n != null ? { bpm: n } : { direction: dir }) } }],
        confidence: 0.88,
      }
    },
  },
  {
    id: 'select',
    tool: 'select',
    group: 'Project',
    what: 'Choose what "this" means, without the mouse',
    say: ['select everything', 'select the loop', 'select nothing', 'select the pad'],
    match(w, ctx) {
      if (!w.has('select', 'selected')) return null
      if (w.has('nothing', 'none', 'deselect')) {
        return { calls: [{ name: 'select', input: { what: 'none' } }], confidence: 0.93 }
      }
      if (w.has('loop')) return { calls: [{ name: 'select', input: { what: 'loop' } }], confidence: 0.93 }
      const named = nameOrSelected(w, ctx, ['select', 'selected', 'the', 'all', 'everything',
        'clips', 'clip', 'on'])
      if (named && !w.has('all', 'everything')) {
        return { calls: [{ name: 'select', input: { what: 'track', target: named.name } }], confidence: 0.9 }
      }
      return { calls: [{ name: 'select', input: { what: 'all' } }], confidence: 0.9 }
    },
  },
  {
    id: 'strip_back',
    tool: 'strip_back',
    group: 'Mixer',
    what: 'Leave only the tracks you name',
    say: ['just the drums', 'mute everything except the pad', 'bring everything back in'],
    match(w, ctx) {
      // ⚠️ No 'unmute': set_all_tracks already owns "unmute everything", and
      // two commands claiming one sentence is one command with a coin flip.
      // "Bring it back in" is the phrase that belongs to stripping back.
      const restore = w.has('bring') && w.has('back', 'everything', 'all')
      if (restore) return { calls: [{ name: 'strip_back', input: { restore: true } }], confidence: 0.9 }
      // ⚠️ said(), not has(): "just" is filler everywhere else in the language
      // and is stripped before any rule sees it — the same trap "go" and "thin"
      // fell into.
      const only = w.said('just') || w.has('only') || (w.has('except', 'apart') && w.has('mute', 'everything'))
      if (!only) return null
      const named = nameOrSelected(w, ctx, ['just', 'only', 'the', 'mute', 'everything',
        'except', 'apart', 'from', 'but', 'leave', 'strip', 'back', 'to'])
      if (!named) return null
      return { calls: [{ name: 'strip_back', input: { keep: [named.name] } }], confidence: 0.88 }
    },
  },
  {
    id: 'chord_inversion',
    tool: 'chord_inversion',
    group: 'Notes',
    what: 'Invert the chords in a part',
    say: ['invert the keys', 'invert the keys down'],
    match(w, ctx) {
      if (!w.has('invert', 'inverted', 'inversion')) return null
      const down = w.has('down', 'lower')
      const named = nameOrSelected(w, ctx, ['invert', 'inverted', 'inversion', 'the',
        'up', 'down', 'lower', 'higher', 'a'], { dropNums: true })
      if (!named) return null
      const n = w.num()
      return {
        calls: [{
          name: 'chord_inversion',
          input: { target: named.name, direction: down ? 'down' : 'up', ...(n != null ? { times: n } : {}) },
        }],
        confidence: 0.9,
      }
    },
  },
  {
    id: 'modulate',
    tool: 'modulate',
    group: 'Timing',
    what: 'Change key from a point onwards',
    say: ['modulate up 2 semitones', 'modulate down 3 semitones'],
    match(w) {
      if (!w.has('modulate', 'modulation')) return null
      const down = w.has('down', 'lower')
      let n = w.num()
      // ⚠️ said(), and NOT in the examples below. "a tone" is two semitones and
      // it is what people say — but as a three-letter vocabulary word it became
      // a rewrite target for every sentence: at low confidence "what time is
      // it" was rewritten to "hat tone is it", where "hat" is one edit from
      // "halt", and the studio stopped playback in answer to a clock question.
      // Reading it from the raw sentence keeps the phrase working without
      // putting the word in the recogniser's substitution pool.
      if (n == null && w.said('tone')) n = 2
      if (n == null && w.has('semitone', 'semitones')) n = 1
      if (n == null) return null
      return {
        calls: [{ name: 'modulate', input: { semitones: down ? -Math.abs(n) : Math.abs(n) } }],
        confidence: 0.9,
      }
    },
  },

  // ── The four the audit called "needs work" ───────────────────────────────
  //
  // Built for AI mode first, so the tool descriptions carry the weight. These
  // rules exist so the same sentences also work with the assistant off, and so
  // a held-open session does not drop them at the attention gate.
  {
    id: 'balance_levels',
    tool: 'balance_levels',
    group: 'Mixer',
    what: 'Measure the tracks and even out their levels',
    say: ['balance the mix', 'even out the levels', 'normalize the levels'],
    match(w, ctx) {
      // ⚠️ No bare 'match' as a trigger: it is ONE EDIT from "much", so "how
      // much reverb is on the pad" would balance the mix. The match-to-one-track
      // phrasing is read from the raw sentence below instead.
      if (!w.has('balance', 'normalize', 'normalise')
        && !(w.has('even') && w.has('level', 'levels', 'out'))) return null
      if (w.has('pan', 'panning')) return null      // "balance" is also a pan word
      const m = /\bmatch(?:es|ed)?\s+(?:the\s+)?(.+?)\s+to\s+(?:the\s+)?(.+?)\s*$/i.exec(w.raw)
      if (m) {
        const ref = findByName(m[2].trim(), ctx.tracks ?? [])
        if (ref) {
          for (const word of w.all) w.has(word)
          return {
            calls: [{ name: 'balance_levels', input: { reference: ref.item.name } }],
            confidence: 0.9,
          }
        }
      }
      return { calls: [{ name: 'balance_levels', input: {} }], confidence: 0.88 }
    },
  },
  {
    id: 'apply_groove',
    tool: 'apply_groove',
    group: 'Timing',
    what: 'Give a part a named feel — shuffle, laid back, off-grid',
    say: [
      'give the drums a shuffle', 'put the guitar back on the grid',
      'swing the drums',
    ],
    match(w, ctx) {
      // ⚠️ No 'laid': time_feel already owns "lay it back", and a groove
      // template that duplicated it made the two commands indistinguishable on
      // the sentence they both claim. The laid-back TEMPLATE still exists and
      // the assistant can ask for it by name — this rule just does not fight
      // over the words.
      // ⚠️ No 'loosen' either — time_feel's humanize already answers to it.
      // Two commands that both claim a word are one command with a coin flip.
      // The off-grid TEMPLATE is still there for the assistant to name.
      if (!w.has('groove', 'shuffle', 'swing', 'feel', 'grid')) return null
      // ⚠️ A NAMED PART is what separates this from set_swing, which sets one
      // number for the whole song at playback time. Both answer to the word
      // "swing", and the difference is whether a part was named.
      const named = nameOrSelected(w, ctx, [
        'give', 'make', 'put', 'the', 'a', 'some', 'bit', 'of', 'back', 'on',
        'groove', 'shuffle', 'swing', 'feel', 'grid', 'up',
      ])
      if (!named) return null
      // A percentage means they are talking about the song's swing amount.
      if (w.num() != null) return null
      const groove = w.has('shuffle') ? 'shuffle'
        : w.has('grid') ? 'straight'
          : w.has('swing') ? 'swing' : 'groove'
      return {
        calls: [{ name: 'apply_groove', input: { target: named.name, groove } }],
        confidence: 0.89,
      }
    },
  },
  {
    id: 'crossfade',
    tool: 'crossfade',
    group: 'Arrangement',
    what: 'Fade one clip out as the next fades in',
    say: ['crossfade the pad clip into the vocals clip', 'crossfade the drums clip into the guitar clip'],
    match(w, ctx) {
      if (!w.has('crossfade', 'crossfaded')) return null
      const m = /\bcrossfade\w*\s+(?:the\s+)?(.+?)\s+(?:into|with|to|and)\s+(?:the\s+)?(.+?)\s*$/i.exec(w.raw)
      if (m) {
        const a = findByName(m[1].trim(), ctx.clips ?? [])
        const b = findByName(m[2].trim(), ctx.clips ?? [])
        if (a && b) {
          for (const word of w.all) w.has(word)
          return {
            calls: [{ name: 'crossfade', input: { first: a.item.name, second: b.item.name } }],
            confidence: 0.92,
          }
        }
      }
      for (const word of w.all) w.has(word)
      return { calls: [{ name: 'crossfade', input: {} }], confidence: 0.85 }
    },
  },
  {
    id: 'stutter',
    tool: 'stutter',
    group: 'Notes',
    what: 'Chop notes into fast repeats',
    say: ['stutter the end of the lead', 'retrigger the drums at 32nds'],
    match(w, ctx) {
      // ⚠️ No 'roll': "piano roll" is a core noun in this app and open_editor
      // owns it. The word is in the tool description for the assistant, which
      // reads meaning rather than matching tokens.
      if (!w.has('stutter', 'stuttered', 'retrigger', 'retriggered')) return null
      const n = w.num()
      const named = nameOrSelected(w, ctx, [
        'stutter', 'stuttered', 'retrigger', 'retriggered', 'the', 'end', 'of',
        'at', 'last', 'note', 'notes', 'every', 'all',
      ], { dropNums: true })
      if (!named) return null
      const all = w.has('every', 'all')
      return {
        calls: [{
          name: 'stutter',
          input: {
            target: named.name,
            ...(n && [4, 8, 16, 32].includes(n) ? { division: n } : {}),
            ...(all ? { scope: 'all' } : {}),
          },
        }],
        confidence: 0.9,
      }
    },
  },

  // ── The words producers already use ──────────────────────────────────────
  //
  // Brae: "compile all music terms that we don't have commands for... take into
  // consideration more complex tasks so that we can make changes faster."
  //
  // Each of these is a sentence in place of a sequence. They are local for the
  // same reason everything else here is: the attention gate asks whether the
  // built-in rules can READ a sentence, so a tool without a rule is unreachable
  // in a held-open session.
  {
    id: 'shape_tone',
    tool: 'shape_tone',
    group: 'Mixer',
    what: 'Brighten, darken, warm up or add punch',
    say: [
      'make the pad brighter', 'warm up the guitar', 'the drums need more punch',
      'darken the pad', 'make the vocals fuller', 'make the guitar thinner',
    ],
    match(w, ctx) {
      const QUALITY: Array<[string[], string]> = [
        [['brighter', 'brighten', 'bright'], 'brighter'],
        // ⚠️ No 'duller': it is one edit from 'fuller', and this entry is
        // tested first, so "make the pad fuller" came back darker.
        [['darker', 'darken', 'dark'], 'darker'],
        [['warmer', 'warm', 'warmth'], 'warmer'],
        [['cleaner', 'clean', 'tighter'], 'cleaner'],
        [['punch', 'punchier', 'punchy', 'snappier'], 'punchier'],
        // ⚠️ NOT a bare "softer": set_velocity already owns that word, and
        // "make the drums softer" means play them softer far more often than
        // it means soften their attack. The transient reading has to be asked
        // for explicitly.
        [['attack', 'transient', 'transients'], 'softer'],
        [['fuller', 'thicker', 'bigger'], 'fuller'],
        // ⚠️ Not a bare "thin". It enters the substitution vocabulary, and at
        // low confidence "what time is it" was rewritten to "hat thin is it" —
        // where "hat" is one edit from "halt" and the studio stopped playback.
        // A short trigger word is a rewrite target for every sentence.
        [['thinner'], 'thinner'],
      ]
      const hit = QUALITY.find(([words]) => w.has(...words))
      if (!hit) return null
      // The attack reading only counts when they also asked for less of it.
      if (hit[1] === 'softer' && !w.has('softer', 'gentler', 'smoother', 'less')) return null
      // "clean up the mix" is a different request from "clean up the bass", and
      // neither is a tone move without a track to make it on.
      const named = nameOrSelected(w, ctx, [
        'make', 'the', 'up', 'more', 'a', 'bit', 'need', 'needs', 'little',
        'low', 'end', 'top', 'sound', 'sounds', 'out', ...hit[0],
      ])
      if (!named) return null
      return {
        calls: [{ name: 'shape_tone', input: { target: named.name, quality: hit[1] } }],
        confidence: 0.88,
      }
    },
  },
  {
    id: 'set_width',
    tool: 'set_width',
    group: 'Mixer',
    what: 'Spread a track wide, narrow it, or make it mono',
    say: ['make the pad wider', 'narrow the guitar', 'put the drums in mono'],
    match(w, ctx) {
      const width = w.has('wider', 'widen') ? 'wider'
        : w.has('narrower', 'narrow') ? 'narrower'
          : w.has('mono') ? 'mono' : null
      if (!width) return null
      const named = nameOrSelected(w, ctx, ['make', 'put', 'in', 'to', 'wider', 'widen',
        'narrower', 'narrow', 'mono', 'stereo', 'the'])
      if (!named) return null
      return { calls: [{ name: 'set_width', input: { target: named.name, width } }], confidence: 0.9 }
    },
  },
  {
    id: 'duck_under',
    tool: 'duck_under',
    group: 'Mixer',
    what: 'Duck one track under another',
    say: ['duck the pad under the drums', 'sidechain the guitar to the drums'],
    match(w, ctx) {
      if (!w.has('duck', 'ducking', 'sidechain', 'sidechained', 'pump')) return null
      // TWO names, and which is which is decided by the preposition, not by
      // order — "duck the pad under the kick" and "sidechain the bass to the
      // kick" put the key track in the same place but say it differently.
      const m = /\b(?:duck|sidechain|pump)\w*\s+(?:the\s+)?(.+?)\s+(?:under|to|with|against|from)\s+(?:the\s+)?(.+?)\s*$/i.exec(w.raw)
      if (!m) return null
      const who = findByName(m[1].trim(), ctx.tracks ?? [])
      const key = findByName(m[2].trim(), ctx.tracks ?? [])
      if (!who || !key) return null
      // findByName returns a MATCH — the thing is on .item, and reading .name
      // off the match is undefined rather than an error, which would have sent
      // the executor looking for a track called "undefined".
      for (const word of w.all) w.has(word)
      return {
        calls: [{ name: 'duck_under', input: { target: who.item.name, under: key.item.name } }],
        confidence: 0.92,
      }
    },
  },
  {
    id: 'time_feel',
    tool: 'time_feel',
    group: 'Timing',
    what: 'Half time, double time, humanize, push or lay back',
    say: [
      'make the drums half time', 'double time the pad', 'humanize the guitar',
      'lay the pad back a bit', 'push the drums ahead',
    ],
    match(w, ctx) {
      const feel = (w.has('half') && w.has('time')) ? 'half'
        : (w.has('double') && w.has('time')) ? 'double'
          : w.has('humanize', 'humanise', 'loosen') ? 'humanize'
            : (w.has('lay', 'laid', 'behind', 'lazy') && !w.has('ahead')) ? 'behind'
              : w.has('ahead', 'push', 'rushed') ? 'ahead' : null
      if (!feel) return null
      const named = nameOrSelected(w, ctx, ['make', 'the', 'half', 'double', 'time',
        'humanize', 'humanise', 'loosen', 'lay', 'laid', 'back', 'behind', 'lazy',
        'ahead', 'push', 'rushed', 'a', 'bit'])
      if (!named) return null
      return { calls: [{ name: 'time_feel', input: { target: named.name, feel } }], confidence: 0.88 }
    },
  },
  {
    id: 'note_length',
    tool: 'note_length',
    group: 'Notes',
    what: 'Legato, staccato, or just longer and shorter notes',
    say: ['make the pad legato', 'staccato the guitar', 'shorter notes on the lead'],
    match(w, ctx) {
      const style = w.has('legato') ? 'legato'
        : w.has('staccato', 'stabs', 'stabby') ? 'staccato'
          : (w.has('shorter') && w.has('note', 'notes')) ? 'shorter'
            : (w.has('longer') && w.has('note', 'notes')) ? 'longer' : null
      if (!style) return null
      const named = nameOrSelected(w, ctx, ['make', 'the', 'legato', 'staccato', 'stabs',
        'stabby', 'shorter', 'longer', 'note', 'notes', 'on'])
      if (!named) return null
      return { calls: [{ name: 'note_length', input: { target: named.name, style } }], confidence: 0.9 }
    },
  },
  {
    id: 'dynamics_ramp',
    tool: 'dynamics_ramp',
    group: 'Notes',
    what: 'Build or fall away across a part',
    say: ['crescendo the pad', 'diminuendo the guitar', 'make the drums build'],
    match(w, ctx) {
      const dir = w.has('crescendo', 'build', 'swell') ? 'crescendo'
        : w.has('diminuendo', 'decrescendo', 'fall') ? 'diminuendo' : null
      if (!dir) return null
      // A fade is a VOLUME move over time and already has a command; this is a
      // performance getting harder. Sharing the word would make one of them
      // unreachable.
      if (w.has('fade')) return null
      const named = nameOrSelected(w, ctx, ['make', 'the', 'crescendo', 'diminuendo',
        'decrescendo', 'build', 'swell', 'fall', 'away', 'across'])
      if (!named) return null
      return { calls: [{ name: 'dynamics_ramp', input: { target: named.name, direction: dir } }], confidence: 0.9 }
    },
  },
  {
    id: 'harmonize',
    tool: 'harmonize',
    group: 'Notes',
    what: 'Add a second voice a third, fifth or octave away',
    say: ['harmonize the lead a third above', 'add a fifth to the pad', 'double the lead an octave down'],
    match(w, ctx) {
      const INTERVALS = ['third', 'fourth', 'fifth', 'sixth', 'seventh', 'octave']
      const interval = INTERVALS.find(x => w.has(x))
      if (!interval) return null
      if (!w.has('harmonize', 'harmonise', 'harmony', 'add', 'double', 'stack')) return null
      const below = w.has('below', 'down', 'under')
      const named = nameOrSelected(w, ctx, ['harmonize', 'harmonise', 'harmony', 'add',
        'double', 'stack', 'a', 'the', 'to', 'an', 'above', 'below', 'up', 'down',
        'under', ...INTERVALS])
      if (!named) return null
      return {
        calls: [{ name: 'harmonize', input: { target: named.name, interval, direction: below ? 'below' : 'above' } }],
        confidence: 0.9,
      }
    },
  },
  {
    id: 'reverse_notes',
    tool: 'reverse_notes',
    group: 'Notes',
    what: 'Play a part backwards',
    say: ['reverse the lead', 'play the pad backwards', 'reverse the guitar'],
    match(w, ctx) {
      // ⚠️ No "flip": has() matches within one edit and "flip" is one edit
      // from "clip", so it swallowed "delete the bass 2 clip". A trigger word
      // that is a typo of a core noun is a trap however well it reads.
      if (!w.has('reverse', 'reversed', 'backwards', 'backward')) return null
      const named = nameOrSelected(w, ctx, ['reverse', 'reversed', 'backwards',
        'backward', 'play', 'the'])
      if (!named) return null
      return { calls: [{ name: 'reverse_notes', input: { target: named.name } }], confidence: 0.9 }
    },
  },
  {
    id: 'section',
    tool: 'section',
    group: 'Arrangement',
    what: 'Loop, jump to, or double a named section',
    say: ['loop the chorus', 'go to the drop', 'jump to the chorus'],
    match(w) {
      const SECTIONS = ['chorus', 'verse', 'bridge', 'intro', 'outro', 'drop',
        'breakdown', 'hook', 'refrain', 'solo', 'build']
      const name = SECTIONS.find(x => w.has(x))
      if (!name) return null
      const action = w.has('loop', 'looping') ? 'loop'
        : w.has('double', 'duplicate', 'repeat', 'copy') ? 'duplicate'
          // ⚠️ said(), not has(): "go" is filler everywhere else in the
          // language and never survives into the stripped word list. Exactly
          // the trap transport.play's own example fell into.
          // ⚠️ No 'take' here: "make" is ONE EDIT from it, so every sentence
          // beginning "make the…" read as a jump to a section. said('go')
          // because "go" is filler and never survives into the word list.
          : (w.said('go') || w.has('jump', 'skip')) ? 'go' : null
      if (!action) return null
      return { calls: [{ name: 'section', input: { name, action } }], confidence: 0.88 }
    },
  },

  // ── The sequencer and the piano roll ─────────────────────────────────────
  //
  // Local, like make_beat and for the same reason: with the microphone held
  // open, anything the built-in rules cannot read is dropped as room noise.
  // "Open the sequencer" is unmistakably addressed to the studio.
  {
    id: 'open_editor',
    tool: 'open_editor',
    group: 'Notes',
    what: 'Open or create a step sequencer or piano roll',
    say: [
      'open the sequencer', 'show me the piano roll', 'make a new sequencer',
      'open the step sequencer on the drums', 'new piano roll',
    ],
    match(w, ctx) {
      const roll = w.has('pianoroll', 'roll') || (w.has('piano') && !w.has('sequencer'))
      const seq = w.has('sequencer', 'stepsequencer', 'steps')
      if (!roll && !seq) return null
      // Recording is its own command and shares every one of these words.
      if (w.has('record', 'recording', 'tap', 'say')) return null
      const create = w.has('new', 'make', 'create', 'another', 'add')
      if (!create && !w.has('open', 'show', 'see', 'bring')) return null
      const named = nameOrSelected(w, ctx, ['open', 'show', 'see', 'bring', 'new', 'make',
        'create', 'another', 'add', 'sequencer', 'stepsequencer', 'steps', 'piano', 'roll',
        'pianoroll', 'step'])
      return {
        calls: [{
          name: 'open_editor',
          input: { editor: roll ? 'pianoroll' : 'sequencer', ...(named ? { target: named.name } : {}), ...(create ? { create: true } : {}) },
        }],
        confidence: 0.9,
      }
    },
  },
  {
    id: 'record_take',
    tool: 'record_take',
    group: 'Notes',
    what: 'Say a part in time and have it written down',
    say: [
      'record a beat', 'record the kick', 'let me record chords into the piano roll',
      'record a drum pattern', 'record notes in the piano roll',
    ],
    match(w, ctx) {
      if (!w.has('record', 'recording', 'tap')) return null
      const roll = w.has('pianoroll', 'roll', 'piano', 'chords', 'chord', 'notes', 'note')
      // Which single drum, if they named one. "record the kick" is one lane.
      const drum = DRUM_WORDS.find(d => w.has(d))
      // ⚠️ Naming a drum IS naming the sequencer. "record the kick" says which
      // editor it means as clearly as "record a beat" does, and requiring the
      // word "beat" as well would refuse the most natural way to ask.
      const seq = !!drum || w.has('sequencer', 'beat', 'drum', 'drums', 'pattern', 'steps')
      if (!roll && !seq) return null
      const named = nameOrSelected(w, ctx, ['record', 'recording', 'tap', 'let', 'me', 'into',
        'sequencer', 'beat', 'drum', 'drums', 'pattern', 'steps', 'piano', 'roll', 'pianoroll',
        'chords', 'chord', 'notes', 'note', ...(drum ? [drum] : [])])
      return {
        calls: [{
          name: 'record_take',
          input: {
            editor: roll && !seq ? 'pianoroll' : 'sequencer',
            ...(drum ? { drum } : {}),
            ...(named ? { target: named.name } : {}),
          },
        }],
        confidence: 0.9,
      }
    },
  },
  {
    id: 'define_word',
    tool: 'define_word',
    group: 'Notes',
    what: 'Give a word a meaning for this session',
    say: [
      'ta means closed hi hat', 'cha means snare', 'one means C major',
      'forget the shorthand',
    ],
    match(w) {
      if (w.has('forget', 'clear') && w.has('shorthand', 'shorthands', 'definitions', 'words')) {
        return { calls: [{ name: 'define_word', input: { clear: true } }], confidence: 0.9 }
      }
      // The RAW sentence, because the meaning is in the exact words and the
      // stripped list has already thrown the small ones away. Cheap enough to
      // parse twice: if it reads no definitions this is not the command.
      if (!/\b(means|equals)\b/i.test(w.raw)) return null
      const defs = parseDefinitions(w.raw)
      if (!defs.length) return null
      // Everything is accounted for, so this reading explains the sentence.
      for (const word of w.all) w.has(word)
      return { calls: [{ name: 'define_word', input: { phrase: w.raw } }], confidence: 0.92 }
    },
  },
  {
    id: 'metronome',
    tool: 'metronome',
    group: 'Transport',
    what: 'Turn the click on or off',
    say: ['turn on the metronome', 'give me a click', 'turn the click off', 'metronome off'],
    match(w) {
      if (!w.has('metronome', 'click')) return null
      const off = w.has('off', 'stop', 'kill', 'disable')
      const on = w.has('on', 'start', 'give', 'turn', 'want', 'need')
      // "the click is too loud" is about the click and is not a request to
      // toggle it, so one of these words is required rather than assumed.
      if (!off && !on) return null
      return { calls: [{ name: 'metronome', input: { on: !off } }], confidence: 0.9 }
    },
  },
  {
    id: 'name_notes',
    tool: 'name_notes',
    group: 'Questions',
    what: 'Ask what notes or chord are sounding',
    say: ['what notes are being played', 'what chord is this', 'what notes are these'],
    match(w) {
      if (!w.has('note', 'notes', 'chord', 'chords')) return null
      if (!w.has('what', 'which', 'name', 'tell')) return null
      // A question, not an edit. Everything here that also takes notes as its
      // object is an instruction, and they share the noun.
      if (w.has('add', 'delete', 'remove', 'move', 'transpose', 'quantize', 'louder', 'quieter')) return null
      return { calls: [{ name: 'name_notes', input: {} }], confidence: 0.9 }
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
    say: ['mark this as the chorus', 'mark bar 17 as the drop', 'add a marker at bar 9 called drop'],
    match(w) {
      if (!w.has('mark', 'marker', 'label')) return null
      // ⚠️ The name used to have to follow the word "as", and nothing else.
      // "Add a marker at bar 9 CALLED drop" therefore matched nothing here and
      // fell through to transport, which MOVED THE PLAYHEAD to bar 9 and made
      // no marker at all — a different action, silently, for a phrasing at
      // least as common as the one that worked. "Put a marker here called drop"
      // resolved to nothing whatsoever.
      const after = w.raw.toLowerCase().split(/\s+(?:as|called|named|labell?ed)\s+/)[1]
      const name = (after ?? '').trim().replace(/[^a-z0-9\s'-]/g, '').replace(/^the\s+/, '').trim()
      if (!name) return null
      const bar = w.has('bar', 'measure') ? w.num() : null
      // "Put a marker HERE" is the playhead, which is where a marker goes when
      // no bar is named — the executor's own default. Saying it explicitly is
      // not a different request.
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
      // "Add a DESCENDING filter" is a sweep, not a switch. The direction word
      // is the whole difference and it belongs to the automation rule, so this
      // one stands aside rather than adding a static filter at 1%.
      if (w.has('descending', 'ascending', 'rising', 'falling', 'opening', 'closing', 'sweep')) {
        return null
      }
      // ⚠️ And "a LADDER filter" is a filter MODEL, which is a choice inside
      // the synth rather than a device to add after it. Same shape as the sweep
      // guard above: the extra word is the whole difference. A bare "put a
      // filter on it" names no model and is still this command.
      const hit = nameFrom(w, ctx, [...EFFECTS, 'put', 'add', 'give', 'stick', 'some',
        'percent', 'track'], { dropNums: true })
      if (!hit) return null
      // ⚠️ Only defer on a track that HAS a synth filter to set. Deferring
      // everywhere dropped "give the drums a ladder filter" on the floor —
      // Apollo is not the only thing in the studio with a filter.
      if (effect === 'filter' && matchFilterType(w.all.join(' ')) && !isNotApollo(hit.name, ctx)) return null
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
      // A swept filter belongs to the automation rule, not here. Without this,
      // "add a descending filter to Bass body 1" set a static filter to 1% —
      // the "1" of "body 1" read as an amount.
      if (w.has('descending', 'ascending', 'rising', 'falling', 'opening', 'closing', 'sweep')) {
        return null
      }
      // And TAKING something off is not turning it down. "Turn the reverb off"
      // is this rule at zero; "take the reverb off the pad" removes it, and the
      // two were scoring within a hair of each other — which would have made
      // the studio stop and ask about a sentence that means one thing.
      if (w.has('remove', 'delete', 'lose') || (w.has('take') && w.said('off'))) return null
      // ⚠️ A NAMED DIAL is not an amount. "Filter 2 resonance to 40" was read
      // here as forty percent of a filter effect — the number is the same, and
      // nothing else in the sentence distinguishes them except the word that
      // says which dial. set_device_param and set_apollo_param own those.
      if (w.has('resonance', 'cutoff', 'ratio', 'threshold', 'feedback', 'ceiling', 'depth')) return null
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
      // ⚠️ "one means C major" is a shorthand being DEFINED, not a key being
      // set. A chord name and a key name are the same words, and the only thing
      // separating them is what the sentence is doing with them - so a sentence
      // that says "means" is not this command, however much of it looks like it.
      if (/\b(means|equals)\b/i.test(w.raw)) return null
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

  // ── The performance ──────────────────────────────────────────────────────
  {
    id: 'quantize',
    tool: 'quantize',
    group: 'Notes',
    what: 'Pull the notes onto the grid',
    say: ['quantize the drums', 'quantize the bass 2 to eighth notes', 'tighten up the drums'],
    match(w, ctx) {
      if (!w.has('quantize', 'quantise') && !w.hasPhrase('tighten', 'up') && !w.has('tighten')) {
        return null
      }
      const hit = clipOrSelected(w, ctx, ['quantize', 'quantise', 'tighten', 'up', 'grid',
        'note', 'notes', 'to', 'track', 'clip', 'eighth', 'sixteenth', 'quarter',
        'half', 'percent', 'by'], { dropNums: true })
      if (!hit) return null
      // The grid, said the way musicians say it. A quarter note is the default
      // because it is what "quantize this" means when nobody specifies.
      const division = w.has('sixteenth', 'sixteenths') ? 0.25
        : w.has('eighth', 'eighths') ? 0.5
          : w.has('half') ? 2
            : 1
      const n = argNumbers(w, hit.name)[0]
      const strength = n != null && n > 0 && n <= 100 && w.has('percent') ? n : undefined
      return {
        calls: [{
          name: 'quantize',
          input: { target: hit.name, division, ...(strength != null ? { strength } : {}) },
        }],
        confidence: nameConfidence(hit.score),
        needsName: true,
      }
    },
  },
  {
    id: 'set_velocity',
    tool: 'set_velocity',
    group: 'Notes',
    what: 'Play a part harder or softer',
    say: ['make the drums softer', 'play the bass 2 harder', 'set the pad velocity to 90'],
    match(w, ctx) {
      const softer = w.has('softer', 'gentler', 'lighter')
      const harder = w.has('harder', 'stronger', 'punchier')
      const named = w.has('velocity')
      if (!softer && !harder && !named) return null
      if (softer && harder) return null
      const hit = clipOrSelected(w, ctx, ['softer', 'gentler', 'lighter', 'harder',
        'stronger', 'punchier', 'velocity', 'make', 'play', 'set', 'track', 'clip',
        'bit', 'lot'], { dropNums: true })
      if (!hit) return null
      const n = argNumbers(w, hit.name)[0]
      if (named && n != null && n > 0 && n <= 127) {
        return {
          calls: [{ name: 'set_velocity', input: { target: hit.name, velocity: n } }],
          confidence: nameConfidence(hit.score),
          needsName: true,
        }
      }
      if (!softer && !harder) return null
      // A proportion rather than a fixed amount, so a quiet part and a loud one
      // both move by something that means the same to each.
      const step = w.has('bit', 'little', 'touch') ? 10 : w.has('lot', 'way', 'much') ? 30 : 20
      return {
        calls: [{
          name: 'set_velocity',
          input: { target: hit.name, scale: softer ? 100 - step : 100 + step },
        }],
        confidence: nameConfidence(hit.score),
        needsName: true,
      }
    },
  },

  // ── Clip surgery ─────────────────────────────────────────────────────────
  {
    id: 'split_clip',
    tool: 'split_clip',
    group: 'Arrangement',
    what: 'Cut a clip in two',
    say: ['split the bass 2 at bar 3', 'cut the pad at bar 5'],
    match(w, ctx) {
      if (!w.has('split', 'cut', 'divide', 'slice')) return null
      if (!w.has('bar', 'measure', 'beat')) return null
      const hit = clipOrSelected(w, ctx, ['split', 'cut', 'divide', 'slice', 'bar',
        'bars', 'measure', 'beat', 'beats', 'track', 'clip', 'at', 'in'], { dropNums: true })
      if (!hit) return null
      const n = argNumbers(w, hit.name)[0]
      if (n == null || n <= 0) return null
      const at = w.has('beat') && !w.has('bar', 'measure') ? { beat: n } : { bar: n }
      return {
        calls: [{ name: 'split_clip', input: { target: hit.name, at } }],
        confidence: nameConfidence(hit.score),
        needsName: true,
      }
    },
  },
  {
    id: 'resize_clip',
    tool: 'resize_clip',
    group: 'Arrangement',
    what: 'Make a clip longer or shorter',
    say: ['make the pad 8 bars long', 'make the bass 2 four bars long'],
    match(w, ctx) {
      if (!w.has('long', 'length', 'longer', 'shorter')) return null
      if (!w.has('bar', 'bars', 'beat', 'beats', 'measure', 'measures')) return null
      const hit = clipOrSelected(w, ctx, ['make', 'long', 'length', 'longer', 'shorter',
        'bar', 'bars', 'beat', 'beats', 'measure', 'measures', 'track', 'clip'],
        { dropNums: true })
      if (!hit) return null
      const n = argNumbers(w, hit.name)[0]
      if (n == null || n <= 0) return null
      const length = w.has('beat', 'beats') && !w.has('bar', 'bars') ? { beats: n } : { bars: n }
      return {
        calls: [{ name: 'resize_clip', input: { target: hit.name, length } }],
        confidence: nameConfidence(hit.score),
        needsName: true,
      }
    },
  },

  // ── Taking things off ────────────────────────────────────────────────────
  {
    id: 'remove_effect',
    tool: 'remove_effect',
    group: 'Mixer',
    what: 'Take an effect off a track',
    say: ['take the reverb off the drums', 'remove the delay from the pad'],
    match(w, ctx) {
      const effect = EFFECTS.find(e => w.has(e))
      if (!effect) return null
      if (!w.has('off', 'remove', 'delete', 'lose')) return null
      // "Turn the reverb off" is set_effect at zero; "take the reverb OFF the
      // pad" removes it. The difference is whether a track is named after it.
      const hit = nameOrSelected(w, ctx, [...EFFECTS, 'take', 'off', 'remove', 'delete',
        'lose', 'from', 'track'], { dropNums: true })
      if (!hit) return null
      return {
        calls: [{ name: 'remove_effect', input: { target: hit.name, effect } }],
        confidence: nameConfidence(hit.score),
        needsName: true,
      }
    },
  },
  {
    id: 'remove_marker',
    tool: 'remove_marker',
    group: 'Arrangement',
    what: 'Remove a marker',
    say: ['delete the chorus marker', 'remove the drop marker'],
    match(w) {
      if (!w.has('marker', 'markers')) return null
      if (!w.has('delete', 'remove', 'lose', 'clear')) return null
      const left = w.all.filter(x =>
        !['delete', 'remove', 'lose', 'clear', 'marker', 'markers', 'the'].includes(x))
      if (!left.length) return null
      for (const word of w.all) w.markWord(word, 0)
      return {
        calls: [{ name: 'remove_marker', input: { name: left.join(' ') } }],
        confidence: 0.88,
      }
    },
  },

  // ── The library ──────────────────────────────────────────────────────────
  {
    id: 'set_instrument',
    tool: 'set_instrument',
    group: 'Project',
    what: 'Put a library instrument on a track',
    say: ['make the bass 2 a violin', 'put a piano on the pad', 'change the drums to a cello'],
    match(w, ctx) {
      if (!ctx.library?.length) return null
      if (!w.has('make', 'put', 'change', 'use', 'load', 'swap')) return null

      // The instrument is whichever library name the sentence contains. Matched
      // against the library rather than guessed at, so "a violin" only means
      // something when there is a violin to mean.
      let sound: { id: string; name: string } | null = null
      let soundWords: string[] = []
      for (const preset of ctx.library) {
        const folded = foldName(preset.name)
        if (!folded) continue
        const parts = folded.split(' ').filter(Boolean)
        if (parts.every(part => w.all.includes(part))) {
          if (!sound || parts.length > soundWords.length) {
            sound = { id: preset.id, name: preset.name }
            soundWords = parts
          }
        }
      }
      if (!sound) return null

      // The TRACK is what is left once the instrument's own words are out of
      // the way — otherwise "make the bass a violin" looks for a track called
      // "bass violin".
      const hit = nameOrSelected(w, ctx, ['make', 'put', 'change', 'use', 'load', 'swap',
        'into', 'onto', 'track', 'sound', 'instrument', ...soundWords], { dropNums: true })
      if (!hit) return null
      return {
        calls: [{
          name: 'set_instrument',
          input: { target: hit.name, presetId: sound.id, presetName: sound.name },
        }],
        confidence: nameConfidence(hit.score),
        needsName: true,
      }
    },
  },

  // ── The note stream ──────────────────────────────────────────────────────
  {
    id: 'add_midi_effect',
    tool: 'add_midi_effect',
    group: 'Notes',
    what: 'Shape the notes before the instrument',
    say: ['arpeggiate the pad', 'put a chord effect on the bass 2', 'snap the pad to the scale'],
    match(w, ctx) {
      const kind = w.has('arpeggiate', 'arpeggiator', 'arp') ? 'arp'
        : w.has('chord', 'chords') && w.has('effect', 'put', 'add') ? 'chord'
          : w.has('scale') && w.has('snap', 'lock', 'force', 'put') ? 'scale'
            : null
      if (!kind) return null
      if (w.has('stop', 'remove', 'take', 'off', 'delete')) return null
      const hit = nameOrSelected(w, ctx, ['arpeggiate', 'arpeggiator', 'arp', 'chord',
        'chords', 'scale', 'snap', 'lock', 'force', 'effect', 'put', 'add', 'track',
        'sixteenth', 'eighth', 'quarter', 'notes', 'note'], { dropNums: true })
      if (!hit) return null
      const rate = w.has('sixteenth', 'sixteenths') ? 0.25
        : w.has('eighth', 'eighths') ? 0.5
          : w.has('quarter', 'quarters') ? 1
            : undefined
      const style = w.has('down') ? 'down' : w.has('random') ? 'random'
        : w.hasPhrase('up', 'down') ? 'updown' : undefined
      return {
        calls: [{
          name: 'add_midi_effect',
          input: {
            target: hit.name, effect: kind,
            ...(rate != null ? { rate } : {}),
            ...(style ? { style } : {}),
          },
        }],
        confidence: nameConfidence(hit.score),
        needsName: true,
      }
    },
  },
  {
    id: 'remove_midi_effect',
    tool: 'remove_midi_effect',
    group: 'Notes',
    what: 'Stop shaping the notes',
    say: ['stop arpeggiating the bass 2', 'remove the arpeggiator from the bass 2'],
    match(w, ctx) {
      const kind = w.has('arpeggiate', 'arpeggiating', 'arpeggiator', 'arp') ? 'arp'
        : w.has('chord', 'chords') ? 'chord'
          : w.has('scale') ? 'scale'
            : null
      if (!kind) return null
      if (!w.has('stop', 'remove', 'take', 'delete', 'lose')) return null
      const hit = nameOrSelected(w, ctx, ['stop', 'remove', 'take', 'delete', 'lose',
        'arpeggiate', 'arpeggiating', 'arpeggiator', 'arp', 'chord', 'chords', 'scale',
        'effect', 'off', 'from', 'track'], { dropNums: true })
      if (!hit) return null
      return {
        calls: [{ name: 'remove_midi_effect', input: { target: hit.name, effect: kind } }],
        confidence: nameConfidence(hit.score),
        needsName: true,
      }
    },
  },

  // ── A stretch of timeline with a parameter dialled in ────────────────────
  {
    id: 'add_clip_effect',
    tool: 'add_clip_effect',
    group: 'Arrangement',
    what: 'Dial a parameter in and out over a stretch',
    say: [
      'put a low pass bar on the bass 2 for 4 bars',
      'add a drive bar on the drums for 2 bars',
    ],
    match(w, ctx) {
      if (!w.has('bar', 'bars')) return null
      if (!w.has('put', 'add', 'draw')) return null
      // The bar's PARAMETER. Without one of these the sentence is about the
      // loop, the transport or a length, all of which also say "bars".
      const field = w.said('low pass') || w.has('lowpass') ? 'filterHz'
        : w.said('high pass') || w.has('highpass') ? 'highpassHz'
          : w.has('drive') ? 'drive'
            : w.has('distortion') ? 'distortion'
              : w.has('bitcrush', 'crush') ? 'bitcrush'
                : w.has('reverb') ? 'reverbWet'
                  : w.has('delay') ? 'delayWet'
                    : null
      if (!field) return null
      const hit = nameOrSelected(w, ctx, ['put', 'add', 'draw', 'bar', 'bars', 'for',
        'over', 'low', 'pass', 'lowpass', 'high', 'highpass', 'drive', 'distortion',
        'bitcrush', 'crush', 'reverb', 'delay', 'track', 'percent'], { dropNums: true })
      if (!hit) return null
      const nums = argNumbers(w, hit.name)
      const length = nums[0] != null && nums[0] > 0 ? { bars: nums[0] } : undefined
      const amount = w.has('percent') && nums[1] != null ? nums[1] : undefined
      return {
        calls: [{
          name: 'add_clip_effect',
          input: {
            target: hit.name, parameter: field,
            ...(length ? { length } : {}),
            ...(amount != null ? { amount } : {}),
          },
        }],
        confidence: nameConfidence(hit.score),
        needsName: true,
      }
    },
  },

  // ── Folders in the mixer ─────────────────────────────────────────────────
  {
    id: 'group_tracks',
    tool: 'group_tracks',
    group: 'Project',
    what: 'Fold tracks into one group',
    say: ['group the drums and the bass 2', 'group the pad and the drums'],
    match(w, ctx) {
      if (!w.has('group', 'bus', 'folder')) return null
      if (w.has('ungroup')) return null
      // Every track the sentence names, in the order it names them. A group is
      // the one command whose target is plural, so it cannot use the shared
      // name resolution — that answers "which ONE".
      const named: string[] = []
      for (const track of ctx.tracks) {
        const parts = foldName(track.name ?? '').split(' ').filter(Boolean)
        if (parts.length && parts.every(part => w.all.includes(part))) {
          named.push(track.name ?? '')
        }
      }
      if (named.length < 2) return null
      for (const word of w.all) w.markWord(word, 0)
      // "as Backing" names the group; without it the studio names it itself.
      const as = /\bas\s+([a-z0-9 '-]+)$/i.exec(w.raw)
      const label = as ? as[1].trim().replace(/\b[a-z]/g, c => c.toUpperCase()) : ''
      return {
        calls: [{
          name: 'group_tracks',
          input: { targets: named, ...(label ? { name: label } : {}) },
        }],
        confidence: 0.9,
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
    id: 'describe.notes',
    tool: 'describe',
    group: 'Questions',
    what: 'Ask what a part is playing',
    say: [
      'what note is the pad playing',
      'what notes are in the bass 2',
      'what chord is the pad playing',
      'what is the drums playing',
    ],
    match(w, ctx) {
      // The musical nouns. "Note", "chord" and "key" are what people ask about
      // a part; "playing" alone is enough when it follows a question word,
      // which is how "what is the pad playing" reads.
      const asks = w.has('note', 'notes', 'chord', 'chords', 'pitch', 'pitches')
        || (w.has('playing', 'play') && w.has('what', 'which'))
      if (!asks) return null
      if (!w.has('what', 'which')) return null
      const hit = nameOrSelected(w, ctx, ['note', 'notes', 'chord', 'chords', 'pitch',
        'pitches', 'playing', 'play', 'what', 'which', 'track', 'clip', 'item'],
        { dropNums: true })
      if (!hit) return null
      return {
        calls: [{ name: 'describe', input: { topic: 'notes', target: hit.name } }],
        confidence: nameConfidence(hit.score),
        needsName: true,
      }
    },
  },
  {
    id: 'describe.effects',
    tool: 'describe',
    group: 'Questions',
    what: 'Ask what effects are on a track',
    say: [
      'what are the filters on the bass 2',
      'what effects are on the pad',
      'what is on the drums',
    ],
    match(w, ctx) {
      // Asking about a specific effect by name is asking what is on the track:
      // "what are the FILTERS on bass 1" wants the rack, not a filter.
      // A more specific noun means a more specific question. This rule's
      // trigger is the loosest of the questions ("what ... on ..."), so it has
      // to stand aside for anything that names what it is actually about.
      if (w.has('automation', 'automated', 'note', 'notes', 'chord', 'chords',
        'instrument', 'sound', 'preset')) return null
      const asks = w.has('effect', 'effects', 'fx', 'rack', 'chain')
        || EFFECTS.some(e => w.has(e))
        // said() pads what it is given, so the argument is the bare word.
        || (w.has('what') && w.said('on'))
      if (!asks) return null
      if (!w.has('what', 'which')) return null
      const hit = nameOrSelected(w, ctx, [...EFFECTS, 'effect', 'effects', 'fx', 'rack',
        'chain', 'what', 'which', 'track', 'filters'], { dropNums: true })
      if (!hit) return null
      // An amount makes it an instruction rather than a question — but only a
      // number that is not part of the NAME. "What are the filters on bass 2"
      // has a number in it and is still a question.
      if (argNumbers(w, hit.name).length) return null
      return {
        calls: [{ name: 'describe', input: { topic: 'effects', target: hit.name } }],
        confidence: nameConfidence(hit.score),
        needsName: true,
      }
    },
  },
  {
    id: 'describe.instrument',
    tool: 'describe',
    group: 'Questions',
    what: 'Ask what a track is',
    say: ['what instrument is the bass 2', 'what sound is the pad'],
    match(w, ctx) {
      if (!w.has('instrument', 'sound', 'preset', 'patch')) return null
      if (!w.has('what', 'which')) return null
      const hit = nameOrSelected(w, ctx, ['instrument', 'sound', 'preset', 'patch',
        'what', 'which', 'track'], { dropNums: true })
      if (!hit) return null
      return {
        calls: [{ name: 'describe', input: { topic: 'instrument', target: hit.name } }],
        confidence: nameConfidence(hit.score),
        needsName: true,
      }
    },
  },
  {
    id: 'describe.automation',
    tool: 'describe',
    group: 'Questions',
    what: 'Ask what is automated',
    say: ['what is automated', 'is anything automated', 'what automation is on the pad'],
    match(w, ctx) {
      if (!w.has('automated', 'automation', 'automating')) return null
      const hit = nameFrom(w, ctx, ['automated', 'automation', 'automating', 'what',
        'which', 'anything', 'any', 'track'], { dropNums: true })
      return {
        calls: [{ name: 'describe', input: { topic: 'automation', ...(hit ? { target: hit.name } : {}) } }],
        confidence: hit ? nameConfidence(hit.score) : 0.9,
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
      for (const word of THE_SONG) w.has(word)
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
      // ⚠️ This rule fires on ANY sentence with a bar number in it and no verb
      // of its own, so it quietly won sentences that were about something else
      // entirely: "add a marker at bar 9" moved the playhead and made no
      // marker. Naming a thing to PUT at that bar is not asking to go there.
      if (w.has('mark', 'marker', 'label')) return null
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
      // The object of the command, read rather than left dangling.
      for (const word of THE_SONG) w.has(word)
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
      // The object of the command, read rather than left dangling.
      for (const word of THE_SONG) w.has(word)
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
      // Only when the sentence is entirely about the transport — but "about the
      // transport" includes saying WHAT to play. A loose word count is not
      // enough of a guard ("play the bass louder" is three content words after
      // filler and was being heard as a bare play), and a seven-word whitelist
      // is too tight: it refused "start the song".
      const ONLY = new Set([
        'play', 'start', 'go', 'playing', 'playback', 'begin', 'resume',
        ...THE_SONG,
      ])
      // ⚠️ `said`, not `has`, for "go": it is FILLER everywhere else in the
      // language ("go ahead", "let's go"), so the stripped word list never
      // contains it and w.has('go') is false for the bare sentence "go". The
      // command listed "go" as an example, and the conformance suite has been
      // reporting it as unreachable — the same shape as "fade in" vs "fade out",
      // which is what said() exists for.
      if (!w.has('play', 'start') && !w.said('go')) return null
      if (!w.only(ONLY)) return null
      // The object is read, not merely tolerated, so the reading explains the
      // whole sentence and scores like it. One call per word because has()
      // stops at its first hit.
      for (const word of THE_SONG) w.has(word)
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
  // The performance and clip surgery, before the general mixer rules: they all
  // name a track and several share a verb with something else.
  // Grouping and the library first: both name tracks, and grouping is the only
  // command whose target is plural.
  'group_tracks',
  'set_instrument',
  'add_midi_effect',
  'remove_midi_effect',
  'add_clip_effect',
  'quantize',
  'set_velocity',
  'split_clip',
  'resize_clip',
  'remove_effect',
  'remove_marker',
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
  // The musical questions before the general ones: "what note is the pad
  // playing" contains a track name, and a rule that only wants a topic would
  // otherwise take it first.
  'describe.notes',
  'describe.instrument',
  'describe.automation',
  // Effects LAST of the musical questions: its trigger is the loosest of them
  // ("what ... on ..."), so "what automation is on the pad" reached it first
  // and answered about the rack.
  'describe.effects',
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
/**
 * Every word the matchers react to, harvested from the rules above.
 *
 * Kept as a list rather than derived at runtime because the rules hold them as
 * arguments, not as data — but a test scans this file and fails if a rule reacts
 * to a word that is not here. That is what stops the transcriber being primed
 * for the examples while the parser listens for something else.
 */
const TRIGGER_WORDS: readonly string[] = [
  // Apollo's own vocabulary. Not in any `say` example — the examples show
  // sentences that work on a DEFAULT patch, and half of Apollo only exists once
  // somebody has chosen an engine. The recogniser still needs the words.
  'apollo', 'oscillator', 'osc', 'sub', 'noise', 'wavetable', 'grain', 'granular',
  'spectral', 'warp', 'scan', 'formant', 'vowel', 'glide', 'portamento', 'spray',
  'macro', 'lfo', 'envelope', 'resonance', 'detune', 'ladder', 'comb', 'notch',
  'smear', 'density',
  'add', 'again', 'all', 'another', 'any', 'anything', 'arrangement', 'ascending', 'away',
  'back', 'bar', 'bars', 'beat', 'beats', 'beginning', 'bit', 'boost', 'bpm', 'call',
  'center', 'centre', 'change', 'chorus', 'clear', 'clip', 'clips', 'clone', 'close',
  'closes', 'closing', 'compressor', 'copy', 'create', 'current', 'cutoff', 'decrease',
  'delay', 'delete', 'descending', 'disable', 'double', 'down', 'drop', 'duplicate',
  'earlier', 'everything', 'fade', 'falling', 'fast', 'faster', 'fifth', 'filter', 'first',
  'forward', 'fourth', 'from', 'full', 'get', 'give', 'go', 'groove', 'hair', 'halt',
  'hard', 'here', 'higher', 'hold on', 'how', 'in', 'increase', 'insert', 'it', 'item',
  'items', 'key', 'label', 'left', 'less', 'level', 'limiter', 'list', 'little', 'loads',
  'long', 'loop', 'looping', 'lot', 'loud', 'louder', 'lower', 'lowpass', 'make', 'many',
  'mark', 'marker', 'master', 'measure', 'measures', 'meter', 'middle', 'more', 'move',
  'much', 'music', 'mute', 'muted', 'new', 'no', 'nudge', 'octave', 'off', 'open',
  'opening', 'opens', 'out', 'over', 'pan', 'panned', 'pause', 'percent', 'place', 'play',
  'playback', 'project', 'push', 'put', 'quicker', 'quieter', 'raise', 'redo', 'reduce',
  'remove', 'rename', 'repeat', 'restart', 'reverb', 'revert', 'right', 'rising',
  'saturator', 'second', 'seconds', 'selected', 'semitone', 'semitones', 'set', 'shift',
  'shuffle', 'signature', 'silence', 'slide', 'slightly', 'slow', 'slower', 'softer',
  'solo', 'soloed', 'some', 'song', 'sooner', 'speed', 'start', 'step', 'steps', 'stick',
  'stop', 'straight', 'straighten', 'sweep', 'swing', 'switch', 'take', 'tempo', 'that',
  'them', 'there', 'these', 'thing', 'third', 'this', 'those', 'time', 'times', 'top',
  'touch', 'track', 'tracks', 'transpose', 'tune', 'twice', 'un', 'undo', 'unmute',
  'unsolo', 'up', 'volume', 'way', 'what', 'where', 'which', 'whole',
]

/**
 * Phrases worth telling the transcriber to expect.
 *
 * Brae: "'Light, add a descending low pass filter to pad A' turned into 'I'd
 * like to have some muscle pain'."
 *
 * Not a parsing failure — the words never arrived. The vocabulary was built from
 * the EXAMPLE phrasings, so a word the rules match on but no example happens to
 * use was never sent: "descending", "ascending", "low pass" and "lowpass" were
 * all missing, which is most of that sentence. A general recogniser hearing
 * "descending low pass filter" over a mix, with no reason to think those words
 * are likely, will produce something like "muscle pain", and it is hard to say
 * it was wrong to.
 *
 * Multi-word entries are here because Deepgram takes phrases, and a phrase is a
 * far stronger hint than its words apart: "low pass" as a unit is unmistakable
 * where "low" and "pass" are two of the commonest words in English.
 */
const KEY_PHRASES: readonly string[] = [
  'low pass', 'high pass', 'lowpass', 'highpass', 'band pass',
  'descending filter', 'ascending filter', 'filter sweep',
  'fade in', 'fade out', 'time signature', 'tap tempo',
  'go ahead', 'read them back', 'start collecting',
]

export const COMMAND_VOCABULARY: readonly string[] = (() => {
  const skip = new Set([
    'the', 'a', 'an', 'to', 'it', 'in', 'on', 'at', 'of', 'by', 'me', 'over',
    'and', 'from', 'put', 'take', 'is', 'that', 'this', 'more', 'out', 'up',
    'down', 'off', 'on', 'all', 'one', 'two', 'three', 'four', 'five',
  ])
  const seen = new Set<string>()
  const add = (word: string) => {
    const w = word.toLowerCase().trim()
    if (!w || skip.has(w) || /^\d+$/.test(w)) return
    seen.add(w)
  }
  for (const c of VOICE_COMMANDS) for (const phrase of c.say) {
    for (const word of phrase.toLowerCase().split(/[^a-z0-9]+/)) add(word)
  }
  // The words the rules actually REACT to, which is not the same set as the
  // words the examples happen to contain — and the difference is exactly what
  // went missing.
  for (const word of TRIGGER_WORDS) add(word)
  for (const phrase of KEY_PHRASES) seen.add(phrase)
  return [...seen].sort()
})()

/**
 * What a misheard word may be rewritten INTO. A much shorter list than the one
 * above, and deliberately so.
 *
 * Priming and substituting are opposite risks and were sharing a list. Telling
 * the recogniser that "halt" is a likely word costs nothing — it either heard it
 * or it did not. Allowing the parser to rewrite some other word INTO "halt" is a
 * different act: it invents a command that was never said. Widening the priming
 * list to cover every word the rules react to therefore widened the rewriting
 * net at the same time, and "what time is it" promptly became "halt time is it"
 * and stopped the transport.
 *
 * So substitution stays with the words that appear in the ADVERTISED phrasings.
 * Those are the words people actually say to the studio, which is exactly the
 * set worth guessing towards; the harvested trigger words are for hearing, not
 * for guessing.
 */
export const SUBSTITUTION_VOCABULARY: readonly string[] = (() => {
  const skip = new Set([
    'the', 'a', 'an', 'to', 'it', 'in', 'on', 'at', 'of', 'by', 'me', 'over',
    'and', 'from', 'put', 'take', 'is', 'that', 'this', 'more', 'out', 'up',
    'down', 'off', 'all', 'one', 'two', 'three', 'four', 'five',
  ])
  const seen = new Set<string>()
  for (const c of VOICE_COMMANDS) for (const phrase of c.say) {
    for (const word of phrase.toLowerCase().split(/[^a-z0-9]+/)) {
      if (!word || skip.has(word) || /^\d+$/.test(word)) continue
      seen.add(word)
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
export interface HelpItem {
  id: string
  /** The one-liner, for the list. */
  what: string
  /** The first phrasing, shown under the name. */
  say: string
  /** Every phrasing, for search and for the detail view. */
  phrasings: string[]
  /** A sentence or two, shown on hover. Falls back to `what`. */
  summary: string
  /** Destructive commands are read back before they run. */
  destructive: boolean
}

/**
 * Everything Light can do, grouped for reading.
 *
 * Brae: "create a library of functions that can be done through Light... so
 * that users can see what they can do."
 *
 * ⚠️ Generated from the command registry itself, never hand-listed. A written
 * list of what a program can do is out of date the day after it is written, and
 * wrong in the direction that matters most — it promises things. This cannot
 * promise anything the parser does not actually resolve, because it IS the
 * parser's own table.
 */
export function commandHelp(): { group: string; items: HelpItem[] }[] {
  const order: VoiceCommand['group'][] =
    ['Transport', 'Mixer', 'Timing', 'Arrangement', 'Notes', 'Project', 'Questions']
  return order
    .map(group => ({
      group,
      items: VOICE_COMMANDS.filter(c => c.group === group).map((c): HelpItem => ({
        id: c.id,
        what: c.what,
        say: c.say[0],
        phrasings: c.say,
        summary: COMMAND_SUMMARIES[c.id] ?? c.what,
        destructive: !!c.destructive,
      })),
    }))
    .filter(g => g.items.length > 0)
}
