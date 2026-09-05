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
import { findLibrarySound } from './library-match'
import { beatWordsOf } from './beatbox'
import { parseDefinitions } from './vocab'
import { COMMAND_SUMMARIES } from './command-summaries'
import { macroNames, macroKey } from './macros'

/** Drum names a single-lane recording can be asked for. */
const DRUM_WORDS = ['kick', 'snare', 'clap', 'crash', 'rim', 'hat', 'hihat', 'tom']

import type { VoiceCall } from './execute-music'
import { Words, near } from './words'
import { matchApolloParam, matchFilterType, moduleHint } from '../apollo/spoken-params'
import { characterWordsIn } from './preset-character'
import { parseClipAddress, colourOf } from '../clip-address'
import { parseNoteAddress, pitchOf } from '../note-address'
import { parseFilter } from '../find-notes'
import { parseLoopLength } from '../clip-time'
import { parseTrackAddress } from '../track-address'
import { viewOf, snapOf, overlayOf, matchCommand } from './workspace'

const SECTION_WORDS = ['chorus', 'verse', 'bridge', 'intro', 'outro', 'drop', 'breakdown', 'hook', 'refrain', 'solo', 'build', 'pre-chorus', 'prechorus', 'interlude', 'coda', 'ending']
/** Section names a sentence can use as places: the song's own markers, plus the usual words. */
function sectionNames(ctx: InterpretContext): string[] {
  const names = new Set<string>(SECTION_WORDS)
  for (const m of ctx.markers ?? []) { const n = String(m.name ?? '').toLowerCase().trim(); if (n) names.add(n) }
  return [...names].sort((a, b) => b.length - a.length)
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// A SET of clips named out loud — "all the pad intro parts", "the third pad
// clip", "pad intro part 2", "the pad clips after bar 9", "the clips shorter
// than a bar", "the ones that are not a full bar long", "the clips between
// bar 9 and 17", "everything on the pad after the chorus", "them". Returns
// the address fields a select / remove_clip / set_colour call carries, or
// null when the words name one thing (the rule's own path) or nothing at all.
function clipSetIn(body: string, ctx: InterpretContext): Record<string, unknown> | null {
  let s = body.toLowerCase().replace(/[.,!?]+$/, '').replace(/\s+/g, ' ').trim()
  const out: Record<string, unknown> = {}
  let filtered = false
  // ── The selection, pointed at ──────────────────────────────────────────
  // "delete them", "colour these blue": the ids of what is selected.
  const sel = ctx.selectedClipIds?.length ? ctx.selectedClipIds : ctx.selectedClipId ? [ctx.selectedClipId] : []
  if (sel.length && /^(?:(?:all\s+(?:of\s+)?)?(?:the\s+)?(?:selection|selected(?:\s+(?:clips?|items?|parts?|ones?))?|these(?:\s+(?:clips?|items?|parts?|ones?))?|those(?:\s+(?:clips?|items?|parts?|ones?))?|them|it|this))$/.test(s)) {
    return { target: sel.length > 1 ? `#sel:${sel.join(',')}` : `#${sel[0]}` }
  }
  const count = (n: string): number => n === 'a' || n === 'an' || n === 'one' ? 1 : n === 'half a' ? 0.5 : (spokenNumber(n) ?? Number(n))
  const length = (n: string, unit: string): Record<string, number> => /beat/.test(unit) ? { beats: count(n) } : { bars: count(n) }
  const keep = (l: Record<string, number>): boolean => Number.isFinite(Object.values(l)[0])
  // ── Ranges: "between bar 9 and 17", "from bar 9 to bar 17" ────────────
  s = s.replace(/\b(?:between|from)\s+(?:bars?|measures?)\s*(\d{1,3})\s+(?:and|to|through|until|till)\s+(?:bars?|measures?)?\s*(\d{1,3})\b/, (_, a, b) => { out.after = { bar: Number(a) }; out.before = { bar: Number(b) }; filtered = true; return ' ' })
  // ── Sections, by marker name: "after the chorus", "in the drop" ───────
  const secRe = `(${sectionNames(ctx).map(escapeRe).join('|')})`
  s = s.replace(new RegExp(`\\b(?:after|from|past|following|since)\\s+(?:the\\s+)?${secRe}\\b`), (_, n) => { out.after = { marker: n }; filtered = true; return ' ' })
  s = s.replace(new RegExp(`\\b(?:before|until|up to|prior to|till)\\s+(?:the\\s+)?${secRe}\\b`), (_, n) => { out.before = { marker: n }; filtered = true; return ' ' })
  s = s.replace(new RegExp(`\\b(?:in|inside|within|during|throughout)\\s+(?:the\\s+)?${secRe}\\b`), (_, n) => { out.section = n; filtered = true; return ' ' })
  s = s.replace(/\b(?:after|from|past|beyond|following)\s+(?:bar|measure)\s+(\d{1,3})\b/, (_, n) => { out.after = { bar: Number(n) }; filtered = true; return ' ' })
  s = s.replace(/\b(?:before|until|up to|prior to)\s+(?:bar|measure)\s+(\d{1,3})\b/, (_, n) => { out.before = { bar: Number(n) }; filtered = true; return ' ' })
  s = s.replace(/\b(?:at|on|in|around)\s+(?:bar|measure)\s+(\d{1,3})\b/, (_, n) => { out.at = { bar: Number(n) }; filtered = true; return ' ' })
  s = s.replace(/\b(?:shorter|less|smaller)\s+than\s+(a|an|one|half a|\d+(?:\.\d+)?|[a-z]+)\s+(?:full\s+)?(bars?|beats?|measures?)\b(?:\s+long)?/, (_, n, u) => { const l = length(n, u); if (keep(l)) { out.shorterThan = l; filtered = true }; return ' ' })
  s = s.replace(/\b(?:longer|more|bigger)\s+than\s+(a|an|one|half a|\d+(?:\.\d+)?|[a-z]+)\s+(?:full\s+)?(bars?|beats?|measures?)\b(?:\s+long)?/, (_, n, u) => { const l = length(n, u); if (keep(l)) { out.longerThan = l; filtered = true }; return ' ' })
  s = s.replace(/\b(?:that\s+(?:are|aren't|are not|is|isn't|is not)|not|aren't|isn't)\s+(?:a\s+)?(?:full|whole)\s+(bar|beat)(?:\s+long)?\b/, (_, u) => { out.shorterThan = length('a', u); filtered = true; return ' ' })
  // "everything" is all the clips, however the rest narrows it.
  s = s.replace(/\b(?:everything|all of it|all of them|the lot)\b/, 'all the clips').replace(/\s+/g, ' ').trim()
  // ── A track: "on the pad", "in the drums track" ────────────────────────
  const trackM = /\b(?:on|in|from)\s+(?:the\s+)?([a-z0-9][a-z0-9' ]*?)(?:\s+track)?\s*$/.exec(s)
  if (trackM) {
    const want = foldName(trackM[1])
    const isTrack = !!want && (ctx.tracks ?? []).some(t => { const n = foldName(t.name ?? ''); return n === want || n.startsWith(want) || n.includes(want) })
    if (isTrack) { out.track = trackM[1].trim(); filtered = true; s = s.slice(0, trackM.index).trim() }
  }
  s = s.replace(/\b(?:that|which|ones?|the)\s*$/, '').replace(/\s+/g, ' ').trim()
  const parsed = parseClipAddress(s)
  let which: number | 'first' | 'last' | 'all' | undefined = parsed.which
  let name = parsed.name.replace(/\b(?:the|clips?|parts?|copies|items|ones?|them|all)\b/g, ' ').replace(/\s+/g, ' ').trim()
  // "pad intro 2": a bare trailing number is the second one when "pad intro"
  // is a clip and "pad intro 2" is not the name of anything.
  const bare = /^(.+?)\s+(\d{1,3})$/.exec(name)
  if (bare && which === undefined) {
    const full = foldName(name)
    const base = foldName(bare[1])
    const isName = (ctx.clips ?? []).some(c => foldName(c.name ?? '') === full) || (ctx.tracks ?? []).some(t => foldName(t.name ?? '') === full)
    const baseIsClip = (ctx.clips ?? []).some(c => foldName(c.name ?? '').includes(base))
    if (!isName && baseIsClip) { which = Number(bare[2]); name = bare[1].trim() }
  }
  if (which === undefined && !filtered) return null
  if (which === 'all' && !name && !filtered) return null
  if (name) out.target = name
  if (which !== undefined) out.which = which
  return out
}

// A SET of tracks named out loud — "all the drum tracks", "every muted
// track", "the tracks with reverb", "everything except the drums". Null when
// the words name one track, which is every mixer command's own path.
// `strip` takes the rule's own words out first, so "turn all the drum tracks
// down a bit" is read as "all the drum tracks".
function trackSetIn(raw: string, ctx: InterpretContext, strip: RegExp): Record<string, unknown> | null {
  const s = raw.toLowerCase().replace(/[.,!?]+$/, '')
    .replace(strip, ' ')
    .replace(/\b(?:please|light|hey|okay|ok|for me|would you|could you|can you)\b/g, ' ')
    .replace(/\s+/g, ' ').trim()
  if (!/\btracks\b|\b(?:every|each|all)\b|\bexcept\b|\b(?:with|that have)\b/.test(s)) return null
  const addr = parseTrackAddress(s)
  if (!addr) return null
  // Pointed at: "mute these" with several clips selected means their tracks.
  const out: Record<string, unknown> = { target: addr.name ?? s }
  if (addr.all) out.all = true
  if (addr.only?.length) out.only = addr.only
  if (addr.withEffect) out.withEffect = addr.withEffect
  if (addr.except?.length) out.except = addr.except
  void ctx
  return out
}

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
  clips?: { id: string; name?: string; trackId: string; kind?: 'audio' | 'midi' }[]
  /** Every selected clip — so "delete them" and "colour these" can mean a set. */
  selectedClipIds?: string[]
  /** The song's markers, so "after the chorus" reads as a place. */
  markers?: { name: string; beat: number }[]
  /** The studio's own commands (the ⌘K palette), so any of them can be said. */
  commands?: { id: string; label: string; keywords?: string; group?: string }[]
  /**
   * The sound library, as far as this machine has one.
   *
   * Resolved HERE rather than in the executor because the library is not part
   * of the song — it lives in local storage and differs per machine, while the
   * executor is pure and sees only the project. So the rule turns "a violin"
   * into an id and the executor applies it, which keeps the executor honest and
   * the library where it actually is.
   */
  library?: { id: string; name: string; group?: string; folder?: string | null; category?: string | null; tags?: string[] | null }[]
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
  group: 'Transport' | 'Mixer' | 'Timing' | 'Arrangement' | 'Notes' | 'Project' | 'Questions' | 'View'
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

/**
 * The name after "called"/"as", stopping where the name stops.
 *
 * ⚠️ A name ends at a conjunction. Without that, "add a track called Keys and
 * turn it down" is a track named "Keys And Turn It Down", and the reading marks
 * every word as used — so it scores full coverage and the sentence never splits
 * into the two commands it obviously is. Over-claiming coverage is worse than
 * under-claiming: it silences the machinery built to notice a second command.
 */
function nameAfter(raw: string, lead: RegExp): string {
  const after = raw.toLowerCase().split(lead)[1]
  if (!after) return ''
  const upToConjunction = after
    .split(/\s+(?:and|then|,|plus|also)\s+/)[0]
    .trim()
    .replace(/[^a-z0-9\s'-]/g, '')
    .replace(/^the\s+/, '')
    .trim()
  // ⚠️ And it stops at a COMMAND WORD too, after the first word of the name.
  //
  // The sequence reader rebuilds each span from CONTENT words, which throws the
  // conjunction away before any rule sees it — so inside a span "called keys
  // turn down" has no "and" to stop at, the name swallowed "turn down", the
  // reading claimed full coverage, and the sentence stopped splitting. The
  // conjunction is the better cue and it is used first; this is the fallback
  // for when it has already been discarded.
  //
  // After the FIRST word, deliberately: a track really can be called "Stop",
  // and a name that is one command word is a name. A name that CONTINUES into
  // one is a sentence carrying on.
  const parts = upToConjunction.split(/\s+/)
  const end = parts.findIndex((word, idx) => idx > 0 && isTriggerWord(word))
  return (end === -1 ? parts : parts.slice(0, end)).join(' ').trim()
}

/** "before the drop" → "Before The Drop". Names are shown, so they are cased. */
function title(name: string): string {
  return name.replace(/\b[a-z]/g, c => c.toUpperCase())
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
  // Several clips selected — "delete them", "colour these" — is the set,
  // carried as ids so the planner never re-resolves it by name.
  const many = ctx.selectedClipIds?.length ? ctx.selectedClipIds : ctx.selectedClipId ? [ctx.selectedClipId] : []
  if (!many.length) return null
  const leftover = w.all.filter(x =>
    !remove.includes(x)
    && !DEICTIC.includes(x)
    && !(opts.dropNums && spokenNumber(x) != null))
  if (leftover.length) return null
  // The id form, which the executor resolves directly rather than by name.
  return { name: many.length > 1 ? `#sel:${many.join(',')}` : `#${many[0]}`, score: 0.85 }
}

function nameOrSelected(
  w: Words,
  ctx: InterpretContext,
  remove: string[],
  opts: { dropNums?: boolean } = {},
): { name: string; score: number } | null {
  const named = nameFrom(w, ctx, remove, opts)
  if (named) return named
  // Several clips selected and pointed at — "mute these" — means THEIR
  // tracks, carried as the selection so the planner finds them by id.
  const manyClips = (ctx.selectedClipIds?.length ?? 0) > 1 ? ctx.selectedClipIds! : null
  if (!ctx.selectedTrackName && !manyClips) return null

  // Only when nothing else could have been the object. Leftover words that are
  // neither command words nor pointers mean the speaker named something this
  // parser failed to find, and acting on the selection instead would be acting
  // on the wrong thing while appearing to understand.
  const leftover = w.all.filter(x =>
    !remove.includes(x)
    && !DEICTIC.includes(x)
    && !(opts.dropNums && spokenNumber(x) != null))
  if (leftover.length) return null
  if (manyClips && (/\b(?:them|these|those|selected|selection)\b/i.test(w.raw) || !ctx.selectedTrackName)) {
    return { name: `#sel:${manyClips.join(',')}`, score: 0.85 }
  }
  return { name: ctx.selectedTrackName!, score: 0.8 }
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
  // ── A clip named on its own — "delete the beat clip" ─────────────────────
  //
  // ⚠️ Clips were only ever found THROUGH their track ("bass body 1"): a clip
  // whose name did not start with its track's name could not be said at all
  // ("delete the beat clip" → nothing), and one that did came back glued
  // ("Organ Organ chords") at a score under the gate, so a signed-out delete
  // was refused. The whole leftover naming one clip exactly is as specific as
  // it gets; a track named exactly the same still wins, as it always did.
  const exactClip = (phrase: string): string | null => {
    const want = foldName(phrase)
    if (!want) return null
    if ((ctx.tracks ?? []).some(t => foldName(t.name ?? '') === want)) return null
    return (ctx.clips ?? []).find(c => foldName(c.name ?? '') === want)?.name ?? null
  }
  const namedClip = exactClip(withNumbers) ?? exactClip(rest)
  if (namedClip) {
    for (const word of w.all) w.markWord(word, 0)
    return { name: namedClip, score: 1 }
  }
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
    say: ['mute the drums', 'unmute the bass', 'mute bass 2', 'mute all the drum tracks', 'unmute every muted track'],
    match(w, ctx) {
      const on = w.has('mute', 'silence')
      const off = w.has('unmute') || (on && w.has('un'))
      if (!on && !off) return null
      // "mute all the drum tracks", "unmute every muted track" — a set.
      const set = trackSetIn(w.raw, ctx, /\b(?:mute|unmute|silence)\b/)
      if (set && (set.only || set.withEffect || (set.except && !on) || (set.target !== undefined && !set.all && !set.except))) {
        for (const word of w.all) w.markWord(word, 0)
        return { calls: [{ name: 'set_track', input: { ...set, muted: !off } }], confidence: 0.9, needsName: true }
      }
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
    say: ['solo the vocals', 'unsolo the guitar', 'solo bass 2', 'solo the audio tracks'],
    match(w, ctx) {
      const on = w.has('solo')
      const off = w.has('unsolo')
      if (!on && !off) return null
      const set = trackSetIn(w.raw, ctx, /\b(?:solo|unsolo)\b/)
      if (set && (set.only || set.withEffect || set.except || set.all)) {
        for (const word of w.all) w.markWord(word, 0)
        return { calls: [{ name: 'set_track', input: { ...set, solo: !off } }], confidence: 0.9, needsName: true }
      }
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
      // "humanize the guitar 30 percent" is an AMOUNT for time_feel, not a
      // fader level — the percent is the only thing the two sentences share.
      if (w.has('humanize', 'humanise', 'loosen')) return null
      // The name is resolved BEFORE the number is read, because which numbers
      // are arguments depends on which are part of the name.
      const set = trackSetIn(w.raw, ctx, /\b(?:set|put|to|at|volume|level|percent)\b|\d+(?:\.\d+)?|%/g)
      if (set) {
        const level = argNumbers(w, '')[0]
        if (level == null || level < 0 || level > 100) return null
        for (const word of w.all) w.markWord(word, 0)
        return { calls: [{ name: 'set_track', input: { ...set, volume: level } }], confidence: 0.9, needsName: true }
      }
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
    say: ['turn the bass up', 'bring the drums down a bit', 'make the pad louder', 'turn down the tracks with reverb'],
    match(w, ctx) {
      // ⚠️ THE TRIGGER FIRST, THEN THE GUARDS.
      //
      // Every guard below is a fuzzy word search, and EFFECTS.some runs one per
      // effect name — all of it before asking whether the sentence contains an
      // up or a down at all. Most sentences do not, so most of that work was
      // being done to reach a `return null`. Measured at 164µs per sentence,
      // the most expensive rule of the hundred, and this rule is read once per
      // hypothesis per span.
      //
      // Pure reordering: the guards only ever mattered when the trigger had
      // matched, and a rule that returns null marks nothing — the reading is
      // discarded whole, so the accounting cannot drift.
      const up = w.has(...UP)
      const down = w.has(...DOWN)
      if (!up && !down) return null
      // "turn all the drum tracks down a bit", "bring the tracks with reverb
      // down 3 dB" — a set, moved by an amount rather than to a level, because
      // each track starts from its own. Read before the guards below: "with
      // reverb" names WHICH tracks, not an effect to change.
      if (up !== down) {
        const set = trackSetIn(w.raw, ctx, new RegExp(`\\b(?:${[...UP, ...DOWN].join('|')}|turn|bring|make|push|pull|crank|bit|touch|little|slightly|hair|lot|way|much|loads|by|volume|level|db|dbs|decibels?|percent|points)\\b|\\d+(?:\\.\\d+)?`, 'g'))
        if (set && (set.only || set.withEffect || set.except || set.all)) {
          const amount = argNumbers(w, '')[0]
          const dbSaid = w.has('db', 'dbs', 'decibel', 'decibels')
          if (amount != null && !dbSaid && !w.has('percent', 'points')) return null
          for (const word of w.all) w.markWord(word, 0)
          const input: Record<string, unknown> = { ...set }
          if (amount != null && dbSaid) input.volumeDb = up ? amount : -amount
          else input.volumeBy = up ? (amount ?? nudgeSize(w)) : -(amount ?? nudgeSize(w))
          return { calls: [{ name: 'set_track', input }], confidence: 0.9, needsName: true }
        }
      }

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
      // ⚠️ ACCOUNT FOR THE VERB. "Turn", "bring" and "make" were never passed
      // to has(), so they came back UNEXPLAINED and "turn the bass up" scored
      // 0.67 coverage — under the 0.75 a span needs to be taken as one command
      // inside a longer sentence. Invisible on its own, fatal in company:
      // "turn the bass up and pan it left" could not be split, so the volume
      // half was silently dropped and only the pan happened.
      //
      // They are already in the ignore list below, but that only keeps them
      // out of the NAME; it does not say the reading used them. This does.
      w.has('turn', 'bring', 'make', 'push', 'pull', 'crank')
      // Both directions in one sentence is not a nudge, it is a sentence this
      // parser has misread. Saying so costs nothing; guessing costs a mix.
      if (up === down) return null
      const hit = nameOrSelected(w, ctx, [...UP, ...DOWN, 'turn', 'bring', 'make', 'bit', 'touch', 'little',
          'slightly', 'hair', 'lot', 'way', 'much', 'loads', 'track', 'volume',
          'db', 'dbs', 'decibel', 'decibels', 'percent', 'points', 'by'])
      if (!hit) return null
      // Relative needs somewhere to start from. Without the current level this
      // would be a guess dressed up as an instruction.
      const now = volumeOf(hit.name, ctx)
      if (now == null) return null
      // ⚠️ AN AMOUNT THAT WAS SAID IS THE AMOUNT. "Bring the bass down 3 dB"
      // was nudged by the default 15 points with the "3 dB" left unexplained —
      // a true read-back of the wrong move, in the one unit mixers actually
      // speak. Decibels move the fader on its own scale; "by 10 percent" moves
      // it by points. A bare number is neither, and is not guessed at: the
      // sentence goes on to the assistant, which can ask.
      const amount = argNumbers(w, hit.name)[0]
      let next: number
      if (amount != null && w.has('db', 'dbs', 'decibel', 'decibels')) {
        const gain = Math.pow(10, (up ? amount : -amount) / 20)
        next = Math.max(0, Math.min(100, Math.round(now * gain)))
      } else if (amount != null && w.has('percent', 'points')) {
        next = Math.max(0, Math.min(100, now + (up ? amount : -amount)))
      } else if (amount != null) {
        return null
      } else {
        next = Math.max(0, Math.min(100, now + (up ? nudgeSize(w) : -nudgeSize(w))))
      }
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
      const set = trackSetIn(w.raw, ctx, /\b(?:pan|panned|left|right|hard|full|center|centre|middle|percent)\b|\d+/g)
      if (set) {
        const n0 = argNumbers(w, '')[0]
        const amount0 = centre ? 0 : n0 != null && n0 >= 0 && n0 <= 100 ? n0 : w.has('hard', 'full', 'all') ? 100 : 60
        for (const word of w.all) w.markWord(word, 0)
        return { calls: [{ name: 'set_track', input: { ...set, pan: left ? -amount0 : amount0 } }], confidence: 0.9, needsName: true }
      }
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
      // ⚠️ AND THE PAIR HAS TO BE SAID AS A PAIR. Brae: "Change the name of the
      // item drums 1 to drums 2" changed the TIME SIGNATURE — "change" cleared
      // the announcement test above, and the 1 and the 2 became 1/2.
      //
      // A meter is always adjacent: "three four", "6/8", "5 4". Numbers with
      // words between them are two different arguments to something else, and
      // that is true of every sentence this rule was stealing — renaming an
      // item, moving clip 1 to bar 2, taking take 2 to lane 3.
      //
      // Read off the raw sentence, because the tokeniser has already thrown
      // away what sat between them.
      if (!/\b\d{1,2}\s*[\/\-]?\s*\d{1,2}\b/.test(w.raw)) return null
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
      // "warp the clip as a 2 bar loop" is the clip's warp (warp_markers), not the song loop.
      if (w.has('warp', 'warped', 'warping')) return null
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
    id: 'copy_notes',
    tool: 'copy_notes',
    group: 'Arrangement',
    what: 'Copy the first chord (or first bars) of a clip somewhere',
    say: ['take the first chord of the pad and put it at bar 1', 'copy the first bar of the bass 2 to bar 9', 'recreate the opening chord of the chord stack at the first bar and repeat it 4 times', 'copy the third chord of the organ chords to bar 9'],
    match(w, ctx) {
      // A PART of a clip, named: the first chord / note / N bars. Without one
      // of these words this is a whole-clip move or duplicate, which sit
      // below and own those sentences.
      // Read on the raw sentence: "first" and "take" are filler to the
      // matcher, and they are the whole point here.
      const raw = w.raw.toLowerCase()
      // The part is read from the words BEFORE "of / in / from": "take the
      // third chord OF the pad and put it AT BAR 9" — the bar after "of" is
      // the destination, not where the chord is.
      const partPhrase = raw.split(/\s+(?:of|in|from)\s+/)[0]
      const na = parseNoteAddress(partPhrase)
      const chord = !!na && (na.addr.chord != null || na.addr.note != null)
      const bars = /\b(?:first|opening|1st)\s+(?:\d+\s+)?(?:bars?|beats?)\b/.test(raw)
      if (!chord && !bars) return null
      if (!/\b(?:take|copy|put|place|recreate|add|move|grab|repeat|duplicate)\b/.test(raw)) return null
      // Mark what this reading explains, so the rest of it scores as read.
      w.has('chord'); w.has('note'); w.has('bars'); w.has('bar'); w.has('beats')
      w.has('take'); w.has('copy'); w.has('put'); w.has('place'); w.has('recreate'); w.has('repeat'); w.has('times')
      const hit = clipOrSelected(w, ctx, ['take', 'copy', 'put', 'place', 'recreate', 'add', 'move', 'grab', 'first', 'opening',
        'chord', 'note', 'bars', 'bar', 'beats', 'from', 'of', 'in', 'at', 'to', 'it', 'that', 'repeat', 'times', 'track', 'clip'], { dropNums: true })
      const nums = argNumbers(w, hit?.name ?? '')
      // "…at bar 1 … repeat it 4 times": the bar is the number beside "bar",
      // the count the one beside "times". Read positionally when both appear.
      const ORD: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 }
      // "at the first bar" / "at bar 9" / "at the 9th bar" — but NOT the
      // "first bar" that names the part being copied ("the first bar of…").
      const barM = /\bbar\s+(\d+)\b|\b(\d+)(?:st|nd|rd|th)?\s+bar\b(?!\s+of)|\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+bar\b(?!\s+of)/.exec(raw)
      const timesM = /\b(\d+)\s*(?:times|x)\b/.exec(raw)
      const times = timesM ? Number(timesM[1]) : (w.has('twice') ? 2 : 1)
      const at = barM ? Number(barM[1] ?? barM[2] ?? ORD[barM[3]]) : (nums.find(n => n !== times) ?? null)
      const partM = /\bfirst\s+(\d+)\s+(bars?|beats?)\b|\bfirst\s+(bar|beat)\b/.exec(raw)
      const part = chord && na ? na.label.replace(/^the /, '') : partM ? (partM[1] ? `${partM[1]} ${partM[2]}` : `1 ${partM[3]}`) : 'first chord'
      // The clip is what follows "of / in / from": "the first chord OF THE PAD
      // INTRO and put it…". clipOrSelected returns the track's name glued on
      // ("Pad Pad intro") when a clip and its track share a word, and the
      // planner then cannot find it.
      const srcM = /\b(?:of|in|from)\s+(?:the\s+)?([a-z0-9' ]+?)(?=\s+(?:and|at|to|then|onto|into)\b|[,.]|$)/.exec(raw)
      const target = srcM?.[1]?.trim() || hit?.name
      if (!target) return null
      return {
        calls: [{ name: 'copy_notes', input: { target, part, ...(at != null ? { at: { bar: at } } : {}), ...(times > 1 ? { times } : {}) } }],
        // The sentence shape is unmistakable — a part, a verb, a place — so it
        // does not hang on how well the name scored.
        confidence: 0.94,
        needsName: false,
      }
    },
  },
  {
    id: 'set_clip_active',
    tool: 'set_clip_active',
    group: 'Arrangement',
    what: 'Park a clip without deleting it, or bring it back',
    say: ['deactivate the pad clip', 'turn the drums clip off', 'activate the vox take again'],
    match(w, ctx) {
      // Live's Clip Activator. "Off"/"on" only count with the word "clip",
      // because "turn the bass off" is the track (mute), not a clip. Read from
      // the raw sentence: "on" and "off" are filler words the token list drops.
      const raw = w.raw.toLowerCase()
      // ⚠️ A literal look first. w.has() bends every word of the sentence
      // against every candidate by edit distance; on a long sentence, three
      // rules doing that pushed the whole read past its 25 ms budget.
      if (!/activat|disabl|enabl|park|\b(?:turn|switch|bring)\b/.test(raw)) return null
      // "deactivate the pad notes" is the NOTES (edit_notes); a clip is never called notes or chords.
      if (/\bnotes?\b|\bchords?\b/.test(w.raw.toLowerCase())) return null
      const off = w.has('deactivate', 'disable') || w.exact('park')
        || /\b(?:turn|switch)\b[^.]*\bclip\b[^.]*\boff\b/.test(raw)
      const on = w.has('activate', 'reactivate', 'enable') || w.exact('unpark')
        || /\b(?:turn|switch|bring)\b[^.]*\bclip\b[^.]*\b(?:on|back)\b/.test(raw)
      if (!off && !on) return null
      if (w.has('track', 'mute', 'unmute')) return null
      const hit = clipOrSelected(w, ctx, ['deactivate', 'disable', 'park', 'activate', 'reactivate', 'enable', 'unpark',
        'turn', 'switch', 'bring', 'off', 'on', 'back', 'again', 'clip'], { dropNums: true })
      if (!hit) return null
      // The whole sentence is this request — "again" is not a repeat and
      // "back" is not the strip-back — so claim every word.
      for (const word of w.all) w.markWord(word, 0)
      return {
        calls: [{ name: 'set_clip_active', input: { target: hit.name, active: !!on && !off } }],
        confidence: nameConfidence(hit.score),
        needsName: true,
      }
    },
  },
  {
    id: 'duplicate_clip',
    tool: 'duplicate_clip',
    group: 'Arrangement',
    what: 'Repeat a clip back to back',
    say: ['loop the bass 3 more times', 'repeat the drums twice', 'duplicate the pad'],
    match(w, ctx) {
      // A PART of a clip — "the first chord", "the first two bars" — is
      // copy_notes, whatever verb comes with it; repeating the whole clip is
      // this.
      if (/\b(?:first|second|third|fourth|fifth|sixth|last|opening|\d+(?:st|nd|rd|th))\s+(?:(?:one|two|three|four|\d+)\s+)?(?:chords?|notes?|(?:\d+\s+)?(?:bars?|beats?))\b|\bchord\s+\d/.test(w.raw.toLowerCase())) return null
      // "activate the pad clip again" is the clip activator, not a repeat:
      // "again" there means "as before".
      if (w.has('activate', 'reactivate', 'deactivate', 'enable', 'disable') || w.exact('park', 'unpark')) return null
      const asked = w.has('repeat', 'duplicate', 'again', 'copy')
        || (w.has('loop') && w.has('times', 'more'))
        || w.has('double')
      if (!asked) return null
      // "duplicate the pad loop" is the clip's loop BRACE doubling (clip_time);
      // a loop word here only means a repeat when it carries a count.
      if (w.has('loop') && !w.has('times', 'more')) return null
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
    say: ['move the drums back 2 bars', 'push the bass back one bar', 'move the pad earlier by 1 bar', 'move everything on the pad before the chorus back 2 bars'],
    match(w, ctx) {
      if (!w.has('move', 'push', 'shift', 'nudge', 'slide')) return null
      const hit = nameFrom(w, ctx, ['move', 'push', 'shift', 'nudge', 'slide', 'back',
        'over', 'earlier', 'sooner', 'forward', 'left', 'bar', 'bars', 'measure',
        'measures', 'beat', 'beats', 'second', 'seconds', 'by', 'track', 'clip',
        'everything', 'all'], { dropNums: true })
      // "back a bar" is one bar: the article is the count.
      const one = /\b(?:a|an|another)\s+(?:bar|beat|measure|second)\b/i.test(w.raw) ? 1 : undefined
      const by = lengthWith(w, argNumbers(w, hit?.name ?? '')[0] ?? one)
      if (!by) return null
      // The contract's own examples treat "back" as LATER, which is how the
      // operation is named in every DAW; "earlier" is the only word that
      // reverses it.
      const earlier = w.has('earlier', 'sooner', 'forward', 'left')
      const signed = Object.fromEntries(
        Object.entries(by).map(([k, v]) => [k, earlier ? -(v as number) : v]),
      )
      // A set — "the pad clips after bar 9", "everything on the pad after the
      // chorus", "them" — moves together.
      const moveBody = w.raw.toLowerCase().replace(/[.,!?]+$/, '')
        .replace(/^.*?\b(?:move|push|shift|nudge|slide)\b\s*/, '')
        .replace(/\s*\b(?:back|over|earlier|sooner|forward|forwards|left|right|later|ahead|by)?\s*(?:by\s+)?(?:a|an|\d+(?:\.\d+)?|one|two|three|four|half a|half)\s+(?:bars?|beats?|measures?|seconds?)(?:\s+(?:back|over|earlier|sooner|forward|forwards|left|right|later|ahead|to the (?:left|right)))?\s*$/, '')
        .replace(/\s*\b(?:back|over|earlier|sooner|forward|forwards|left|right|later|ahead)\s*$/, '')
        .trim()
      const set = clipSetIn(moveBody, ctx)
      if (set && (set.target !== undefined || set.track !== undefined || set.after !== undefined || set.before !== undefined || set.section !== undefined || set.at !== undefined)) {
        for (const word of w.all) w.markWord(word, 0)
        return { calls: [{ name: 'move_clips', input: { ...set, by: signed } }], confidence: 0.9, needsName: true }
      }
      // Pointed at — "move them back a bar" — with several clips selected.
      const sel = ctx.selectedClipIds?.length ? ctx.selectedClipIds : ctx.selectedClipId ? [ctx.selectedClipId] : []
      if (!hit && sel.length && /\b(?:them|these|those|it|this|that|selected|selection)\b/i.test(w.raw)) {
        for (const word of w.all) w.markWord(word, 0)
        return { calls: [{ name: 'move_clips', input: { target: sel.length > 1 ? `#sel:${sel.join(',')}` : `#${sel[0]}`, by: signed } }], confidence: 0.88, needsName: true }
      }
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
    say: ['take the bass up an octave', 'drop the pad down a fifth', 'transpose the lead up 3 semitones', 'transpose the third chord of the organ chords up an octave', 'take the lead up two scale degrees'],
    match(w, ctx) {
      const up = w.has('up', 'raise', 'higher')
      const down = w.has('down', 'drop', 'lower')
      if (up === down) return null
      if (!w.has('transpose', 'octave', 'semitone', 'semitones', 'fifth', 'fourth', 'third', 'step', 'steps', 'degree', 'degrees')) {
        return null
      }
      // Part of a clip: "transpose the third chord of the pad up an octave",
      // "take the notes above C5 down an octave". The clip is what follows
      // "of / in / on"; the part is read by lib/note-address.ts.
      const rawT = w.raw.toLowerCase().replace(/[.,!?]+$/, '')
      // "pitch the vocal clip up 3" is the audio clip's own pitch (set_clip_audio).
      if (/\b(?:pitch|tune)\b/.test(rawT) && /\bclips?\b/.test(rawT)) return null
      const na = parseNoteAddress(rawT)
      const srcM = na ? /\b(?:of|in|on|from)\s+(?:the\s+)?([a-z0-9' ]+?)(?=\s+(?:up|down|by|an?\s+octave|and|then)\b|[,.]|$)/.exec(rawT) : null
      const hit = clipOrSelected(w, ctx, ['transpose', 'take', 'drop', 'move', 'up', 'down', 'raise', 'lower',
          'higher', 'octave', 'semitone', 'semitones', 'fifth', 'fourth', 'third',
          'second', 'step', 'steps', 'half', 'tone', 'whole', 'by', 'track', 'clip',
          'degree', 'degrees', 'scale', 'key', 'diatonic',
          ...(na ? ['chord', 'chords', 'note', 'notes', 'above', 'below', 'over', 'under', 'every', 'all', 'at', 'bar', 'bars', 'beat', 'beats', 'of', 'in', 'on', 'from', 'to', 'two', 'three', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'last', 'highest', 'lowest', 'top', 'bottom', 'opening'] : [])], { dropNums: true })
      const target = srcM?.[1]?.trim() || hit?.name
      if (!target) return null
      const named = Object.keys(INTERVALS).filter(k => !na || !new RegExp(`\\b${k}\\s+(?:one|two|three|four|\\d+\\s+)?(?:chords?|notes?)`).test(rawT)).find(k => w.has(k))
      // "take bass 2 up 3 semitones" — the 2 is the track, the 3 is the move.
      const n = argNumbers(w, hit?.name ?? target).filter(x => !na || (x !== na.addr.chord && x !== na.addr.note))[0]
      // An explicit number always wins over the named interval, because the
      // interval word is often the UNIT rather than the size: "up 3 semitones"
      // is three, not one, and reading the word first made every counted
      // transposition move by exactly one.
      // "up two scale degrees", "a step up in the scale", "down a degree":
      // by degree, in the song's key (lib/pitch-time.ts). One degree when no
      // number is said.
      const byDegree = /\bdegrees?\b|\bin (?:the )?(?:scale|key)\b|\bdiatonic/.test(rawT)
      const size = n != null && n > 0 && n <= 48 ? n : byDegree ? 1 : named ? INTERVALS[named] : null
      if (size == null) return null
      if (na || byDegree) for (const word of w.all) w.markWord(word, 0)
      const move = byDegree ? { degrees: up ? size : -size } : { semitones: up ? size : -size }
      return {
        calls: [{ name: 'transpose', input: { target, ...move, ...(na ? { notes: na.label } : {}) } }],
        confidence: na ? 0.9 : nameConfidence(hit?.score ?? 0.8),
        needsName: true,
      }
    },
  },
  {
    id: 'set_chance',
    tool: 'set_chance',
    group: 'Notes',
    what: 'How often a part plays — chance per note',
    say: ['make the drums 50 percent chance', 'play the pad half the time', 'the vocals only sometimes'],
    match(w, ctx) {
      const raw = w.raw.toLowerCase()
      if (!/chance|probab|half the time|the time\b|sometimes|rarely|always play|every pass|randomly/.test(raw)) return null
      // "randomize the hats" is the lane's Randomize; a sweep is automation.
      if (w.has('automate', 'automation', 'sweep', 'randomize', 'humanize')) return null
      const pctM = /(\d+)\s*(?:%|percent)/.exec(raw)
      const chance = pctM ? Number(pctM[1])
        : /half the time|half of the time/.test(raw) ? 50
        : /(?:a )?quarter of the time/.test(raw) ? 25
        : /\bsometimes\b/.test(raw) ? 30
        : /\brarely\b|once in a while/.test(raw) ? 15
        : /always/.test(raw) ? 100
        : /never/.test(raw) ? 0
        : null
      if (chance == null) return null
      const hit = clipOrSelected(w, ctx, ['chance', 'chances', 'probability', 'percent', 'half', 'quarter', 'time', 'sometimes', 'rarely',
        'always', 'never', 'play', 'plays', 'randomly', 'only', 'make', 'give', 'set', 'notes', 'note', 'track', 'clip', 'every', 'pass'], { dropNums: true })
      if (!hit) return null
      for (const word of w.all) w.markWord(word, 0)
      return { calls: [{ name: 'set_chance', input: { target: hit.name, chance } }], confidence: nameConfidence(hit.score), needsName: true }
    },
  },
  {
    id: 'set_delay_compensation',
    tool: 'set_delay_compensation',
    group: 'Mixer',
    what: 'Delay compensation on or off',
    say: ['turn delay compensation off', 'turn latency compensation on'],
    match(w) {
      if (!/compensat|\bpdc\b/.test(w.raw.toLowerCase())) return null
      if (!w.has('compensation', 'compensate', 'pdc')) return null
      if (!w.has('delay', 'latency', 'plugin', 'plug-in', 'pdc')) return null
      const raw = w.raw.toLowerCase()
      const off = /\boff\b/.test(raw) || w.has('disable', 'without', 'stop')
      const on = /\bon\b/.test(raw) || w.has('enable', 'compensate')
      if (off === on) return null
      for (const word of w.all) w.markWord(word, 0)
      // ⚠️ 0.92, not 0.9. The palette has a command whose label IS this
      // sentence ("Turn delay compensation on"), and the generic by-name rule
      // reads it at 0.86 with full coverage — within the ambiguity margin of a
      // 0.9 reading, so the studio stopped to ask which of two identical
      // things was meant. A dedicated rule for a sentence outranks the palette
      // match for the same sentence by more than the margin.
      return { calls: [{ name: 'set_delay_compensation', input: { on: !off } }], confidence: 0.92 }
    },
  },
  {
    id: 'modulate_parameter',
    tool: 'modulate_parameter',
    group: 'Arrangement',
    what: 'Put an LFO on a parameter — a wobble, a tremolo, an auto-pan',
    say: ['put an LFO on the pad filter', 'wobble the bass 2 cutoff every eighth', 'take the LFO off the pad'],
    match(w, ctx) {
      // A literal look before the fuzzy one — see set_clip_active.
      if (!/lfo|wobbl|tremolo|modulat|auto-?pan|breath|puls/.test(w.raw.toLowerCase())) return null
      const lfo = w.has('lfo', 'wobble', 'wobbling', 'wobbly', 'tremolo', 'modulate', 'modulation', 'modulating', 'autopan', 'auto-pan', 'breathe', 'pulse', 'pulsing')
      if (!lfo) return null
      // "Automate" is the ramp; a length ("over 4 bars") is a ramp too.
      if (w.has('automate', 'automation', 'sweep', 'ramp', 'fade')) return null
      // "LFO 2 rate to 5 hertz on the synth" is one of Apollo's own LFOs
      // (set_apollo_param), not a modulator on a track parameter.
      if (/\blfo\s*\d/.test(w.raw.toLowerCase()) || w.has('rate', 'synth', 'apollo', 'patch', 'oscillator', 'osc')) return null
      const off = w.has('stop', 'remove', 'kill', 'delete', 'off', 'without') || /\b(?:take|turn)\b[^.]*\b(?:off|out)\b/.test(w.raw.toLowerCase())
      const parameter = w.has('filter', 'cutoff', 'lowpass', 'low-pass') ? 'lowpass'
        : w.has('highpass', 'high-pass') ? 'highpass'
        : w.has('tremolo', 'volume', 'level', 'loudness') ? 'volume'
        : w.has('pan', 'autopan', 'auto-pan', 'panning') ? 'pan'
        : w.has('reverb') ? 'reverb' : w.has('delay') ? 'delay' : w.has('drive', 'saturation') ? 'drive' : w.has('chorus') ? 'chorus'
        : null
      const raw = w.raw.toLowerCase()
      const rateM = /(\d+\s*\/\s*\d+)|(\d+(?:\.\d+)?)\s*(?:hz|hertz)|\b(every beat|once a bar|every bar|eighths?|sixteenths?|quarters?|triplets?|slow|slowly|fast|quickly)\b/.exec(raw)
      const rate = rateM ? (rateM[1] ? rateM[1].replace(/\s+/g, '') : rateM[2] ? `${rateM[2]} hz` : rateM[3]) : undefined
      const depthM = /(\d+)\s*(?:%|percent)/.exec(raw)
      const hit = nameFrom(w, ctx, ['lfo', 'wobble', 'wobbling', 'wobbly', 'tremolo', 'modulate', 'modulation', 'modulating',
        'autopan', 'auto-pan', 'breathe', 'pulse', 'pulsing', 'filter', 'cutoff', 'lowpass', 'low-pass', 'highpass', 'high-pass',
        'volume', 'level', 'loudness', 'pan', 'panning', 'reverb', 'delay', 'drive', 'saturation', 'chorus',
        'stop', 'remove', 'kill', 'delete', 'off', 'out', 'take', 'turn', 'put', 'add', 'every', 'once', 'beat', 'bar', 'bars',
        'eighth', 'eighths', 'sixteenth', 'sixteenths', 'quarter', 'quarters', 'triplet', 'triplets', 'slow', 'slowly', 'fast', 'quickly',
        'hz', 'hertz', 'percent', 'deep', 'depth', 'sine', 'triangle', 'saw', 'square', 'random', 'wave', 'track'], { dropNums: true })
      if (!hit) return null
      for (const word of w.all) w.markWord(word, 0)
      const input: Record<string, unknown> = { target: hit.name }
      if (parameter) input.parameter = parameter
      if (off) input.off = true
      else {
        if (rate) input.rate = rate
        if (depthM) input.depth = Number(depthM[1])
        const shape = ['triangle', 'saw', 'square', 'random'].find(s => w.has(s))
        if (shape) input.shape = shape
      }
      return { calls: [{ name: 'modulate_parameter', input }], confidence: nameConfidence(hit.score), needsName: true }
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
      // ⚠️ And a SWITCH is not a layer either. "Make oscillator 2 granular"
      // names the engine it should run; bringing the oscillator in is a
      // side effect of that, not the request. Same shape as the dial guard
      // below, and the same reason: this rule sees "osc" + a number and would
      // otherwise answer every sentence that contains both.
      if (w.all.some(x => ['wavetable', 'sample', 'granular', 'spectral', 'multisample',
        'engine', 'unison', 'warp'].includes(x))) return null
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
    id: 'edit_note',
    tool: 'edit_note',
    group: 'Notes',
    what: 'Put in or take out a single note',
    say: ['put a C on beat 3 of the bass', 'delete the last note of the bass', 'add an E flat at bar 2 of the bass', 'delete the third note of the bass 2 clip', 'remove the notes above C5 in the organ chords'],
    match(w, ctx) {
      // ⚠️ The word "note", singular, is what separates this from every bulk
      // command. "Make the notes longer" is note_length; "put a note in" is
      // this one. Plus the pitch form — "put a C on beat three" names no note
      // word at all, so a bare pitch letter counts too.
      // ⚠️ "A" IS BOTH AN ARTICLE AND A NOTE. "Put a C on beat three" matched
      // the article first and added an A. Collect every candidate and drop a
      // bare "a" when there is another — but keep it when it is the only one,
      // because "put an A on beat three" means exactly that note.
      const candidates = [...w.raw.matchAll(/\b([a-g])\s?(sharp|flat|#|b)?\s?(-?\d)?\b/gi)]
      const pitch = candidates.find(m => m[1].toLowerCase() !== 'a' || m[2] || m[3])
        ?? candidates.find(m => m[1].toLowerCase() !== 'a')
        ?? candidates[0] ?? null
      const rawN = w.raw.toLowerCase().replace(/[.,!?]+$/, '')
      // "delete the third note", "remove the notes above C5", "take out every
      // C", "delete the last chord" — one or many, by address.
      const na = w.has('delete', 'remove', 'take') ? parseNoteAddress(rawN) : null
      // ⚠️ "chords" on its own is not a note word: "delete the organ chords
      // clip" names a clip. A chord counts only when a part was addressed —
      // "the last chord", "chord 3".
      const saysNote = w.has('note') || !!na
      if (!saysNote && !pitch && !na) return null

      const removing = w.has('delete', 'remove') || (w.has('take') && w.has('out'))
      if (removing) {
        if (!saysNote && !na) return null      // "take the bass out" is a mute, not a note
        const which = w.has('first') ? 'first' : w.has('highest') ? 'highest'
          : w.has('lowest') ? 'lowest' : 'last'
        const srcM = /\b(?:of|in|from|on)\s+(?:the\s+)?([a-z0-9' ]+?)(?=\s+(?:and|then)\b|[,.]|$)/.exec(rawN)
        const named = nameOrSelected(w, ctx, ['delete', 'remove', 'take', 'out', 'the', 'note',
          'last', 'first', 'highest', 'lowest', 'of', 'from', ...(na ? ['chord', 'chords', 'note', 'notes', 'above', 'below', 'over', 'under', 'every', 'all', 'at', 'bar', 'bars', 'beat', 'beats', 'of', 'in', 'on', 'from', 'to', 'two', 'three', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'last', 'highest', 'lowest', 'top', 'bottom', 'opening'] : [])], { dropNums: true })
        const target = srcM?.[1]?.trim() || named?.name
        if (!target) return null
        if (na) for (const word of w.all) w.markWord(word, 0)
        return {
          calls: [{ name: 'edit_note', input: { action: 'remove', target, ...(na ? { notes: na.label } : { which }) } }],
          confidence: 0.88,
          destructive: true,
        }
      }

      if (!w.has('put', 'add', 'place')) return null
      if (!pitch) return null
      // A bar/beat if one was said. lengthWith/positions are handled by the
      // shared readers everywhere else; here only bar and beat make sense.
      const bar = w.has('bar', 'measure') ? w.num() : null
      const beat = w.has('beat') ? (w.nums()[bar != null ? 1 : 0] ?? null) : null
      if (bar == null && beat == null) return null
      const note = `${pitch[1]}${pitch[2] ? ` ${pitch[2]}` : ''}${pitch[3] ?? ''}`.trim()
      const named = nameOrSelected(w, ctx, ['put', 'add', 'place', 'a', 'an', 'the', 'note',
        'on', 'at', 'of', 'in', 'to', 'bar', 'measure', 'beat', 'sharp', 'flat',
        pitch[1].toLowerCase()], { dropNums: true })
      if (!named) return null
      return {
        calls: [{
          name: 'edit_note',
          input: {
            action: 'add', target: named.name, note,
            at: { ...(bar != null ? { bar } : {}), ...(beat != null ? { beat } : {}) },
          },
        }],
        confidence: 0.87,
      }
    },
  },

  {
    id: 'project_action',
    tool: 'project_action',
    group: 'Project',
    what: 'Open, start, version or rename a project',
    say: [
      'save a version called before the drop',
      'what versions are there',
      'rename this project to Late Checkout',
    ],
    match(w) {
      const raw = w.raw.toLowerCase()
      // ⚠️ "Version" is the word that makes this unambiguous. Without it,
      // "open the drums" and "save" belong to other commands entirely, and a
      // rule that grabbed either would be the greedy kind this file keeps
      // having to un-greedy.
      const versiony = w.has('version', 'versions')
      // "called X" or "to X" — both are how people name a thing out loud.
      const named = (/\s+(?:called|named)\s+(.+)$/.exec(raw)?.[1]
        ?? /\s+to\s+(.+)$/.exec(raw)?.[1] ?? '')
        .trim().replace(/[^a-z0-9\s'-]/g, '').trim()

      // ⚠️ ORDER MATTERS, and getting it wrong cost the commonest sentence
      // here: "save a version called before the drop" was answered by the
      // LIST branch, because its trigger words were checked first and has()
      // bends short words into them. The specific actions go first, and the
      // list is what is left when nobody asked for one of them.
      if (versiony && named && w.has('save', 'keep', 'snapshot')) {
        return { calls: [{ name: 'project_action', input: { action: 'save_version', name: title(named) } }], confidence: 0.9 }
      }
      if (versiony && named && w.has('back', 'restore', 'revert', 'return')) {
        return { calls: [{ name: 'project_action', input: { action: 'restore_version', name: title(named) } }], confidence: 0.9 }
      }
      // ⚠️ EXACT. "What versions are there" is a question, and the question
      // words are short and ordinary — exactly the ones has() bends other words
      // into. Third time this lesson has been learned in this file.
      if (versiony && w.all.some(x => x === 'what' || x === 'which' || x === 'list' || x === 'many')) {
        return { calls: [{ name: 'project_action', input: { action: 'list_versions' } }], confidence: 0.9 }
      }
      // Renaming the PROJECT, not a track or a clip — those rules require the
      // word "track"/"clip" or a name that resolves to one.
      if (w.has('project') && named && w.has('rename', 'name', 'call')) {
        return { calls: [{ name: 'project_action', input: { action: 'rename', name: title(named) } }], confidence: 0.9 }
      }
      // ⚠️ EXACT, and it must say "new". has() bends "take" into "make", so
      // "take me to my projects" — a NAVIGATION sentence — was creating a
      // project. The fourth time a short verb has been bent into a command in
      // this file; the answer is the same one every time.
      if (w.has('project') && w.all.includes('new')
        && w.all.some(x => x === 'start' || x === 'create' || x === 'make' || x === 'new')) {
        return { calls: [{ name: 'project_action', input: { action: 'new', ...(named ? { name: title(named) } : {}) } }], confidence: 0.88 }
      }
      return null
    },
  },

  {
    id: 'write_part',
    tool: 'write_part',
    group: 'Notes',
    what: 'Add a new part, with a sound picked by how it should feel',
    say: [
      'put in a bassline using one of the darker sad piano presets',
      'add a warm bass part',
      'give me eight bars of low notes on a mellow piano',
    ],
    match(w) {
      // Something that does not exist yet. "Put in", "add", "give me" — a
      // request to CREATE, not to change what is already there.
      if (!w.has('put', 'add', 'give', 'make', 'create', 'write')) return null
      // ⚠️ And it has to say what KIND of part. Without this the rule competes
      // with add_track and add_effect for every "add ..." sentence there is.
      // ⚠️ It has to say a PART is wanted, not merely mention a bass. Matching
      // on the word "bass" alone made "put a low pass bar on the bass 2 for 4
      // bars" — an effect bar — read as a request for a new bassline.
      const bass = w.has('bassline', 'baseline')
        || (w.has('bass') && w.has('part', 'line'))
        || (w.has('low') && w.has('notes'))
      if (!bass) return null
      // A clip, a take, an automation lane: things you put ON something that
      // already exists, which is the opposite of making a part. "Bars" is NOT
      // here — "eight bars of low notes" is a length, not a lane.
      if (w.has('clip', 'take', 'lane', 'automation')) return null
      // ⚠️ "Put a LOW PASS bar on the bass 2" is an effect bar. EFFECTS catches
      // the one-word spellings; said as two words it needs this.
      //
      // ⚠️⚠️ EXACT, not has(). "bass" is ONE EDIT from "pass", and has() bends
      // words — so `w.has('pass')` was true for "add a warm bass PART" and this
      // rule declined the very sentence it exists for. The one-edit trap, walked
      // into while guarding against a different collision. A guard against a
      // word that is one edit from your own trigger word must not be fuzzy.
      if (w.all.includes('pass') || w.all.includes('lowpass') || w.all.includes('highpass')) return null
      // "Add reverb to the bass" is not a new part.
      if (EFFECTS.some(e => w.has(e))) return null

      const words = characterWordsIn(w.raw)
      const INSTRUMENTS = ['piano', 'bass', 'strings', 'synth', 'guitar', 'organ',
        'mallets', 'brass', 'woodwinds', 'keys']
      const instrument = INSTRUMENTS.find(g => w.has(g)) ?? null
      // A bare "add a bass" with no character and no instrument is add_track's.
      if (!words.length && !instrument) return null

      const n = w.num()
      const bars = n != null && w.has('bar', 'bars') ? n : null
      return {
        calls: [{
          name: 'write_part',
          input: {
            part: 'bass',
            character: words.join(' '),
            ...(instrument ? { instrument } : {}),
            ...(bars != null ? { bars } : {}),
          },
        }],
        confidence: 0.87,
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
    id: 'set_apollo_switch',
    tool: 'set_apollo_switch',
    group: 'Notes',
    what: "Apollo's choices — engine, warp, unison, octave",
    say: [
      'make oscillator 2 granular on the synth',
      'set the warp to sync on the synth',
      'unison of 4 on oscillator 1 of the synth',
    ],
    match(w, ctx) {
      const ENGINES = ['wavetable', 'sample', 'granular', 'spectral', 'multisample']
      const engine = ENGINES.find(e => w.all.includes(e))
      const warpy = w.has('warp')
      const unison = w.has('unison')
      const octave = w.has('octave') && w.has('osc', 'oscillator', 'sub')
      if (!engine && !warpy && !unison && !octave) return null

      const setting = engine ? 'engine' : warpy ? 'warp' : unison ? 'unison' : 'octave'
      // ⚠️ The warp MODE, not the warp amount — "more warp" is a dial and
      // set_apollo_param owns it. A mode has to be named.
      const WARPS = ['off', 'sync', 'bend', 'pwm', 'asym', 'flip', 'mirror', 'quantize',
        'squeeze', 'fm', 'am', 'rm', 'saturate', 'shift']
      const warpMode = warpy ? WARPS.find(x => w.all.includes(x)) : null
      if (setting === 'warp' && !warpMode) return null

      const n = w.nums()
      // "Oscillator 2 ... unison of 4" — the first number is the module.
      const moduleNum = /(\d+)$/.exec(moduleHint(w.all.join(' ')) ?? '')?.[1]
      const values = moduleNum ? n.filter((x, k) => !(k === 0 && String(x) === moduleNum)) : n
      const value = setting === 'engine' ? engine
        : setting === 'warp' ? warpMode
          : String(values[0] ?? (w.has('up') ? 1 : w.has('down') ? -1 : ''))
      if (!value) return null

      const named = nameOrSelected(w, ctx, ['make', 'set', 'put', 'the', 'a', 'an', 'to', 'on', 'of',
        'osc', 'oscillator', 'sub', 'engine', 'warp', 'unison', 'octave', 'voices', 'up', 'down',
        ...ENGINES, ...WARPS], { dropNums: true })
      if (!named) return null
      if (isNotApollo(named.name, ctx)) return null
      return {
        calls: [{
          name: 'set_apollo_switch',
          input: { target: named.name, setting, value: String(value), module: moduleHint(w.all.join(' ')) ?? undefined },
        }],
        confidence: 0.89,
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
    say: ['select everything', 'select the loop', 'select nothing', 'select the pad',
      'select all the pad clips', 'select the first pad clip', 'select the clips after bar 1', 'select the clips longer than a beat',
      'select everything on the pad before the chorus', 'select the clips between bar 1 and 5'],
    match(w, ctx) {
      if (!w.has('select', 'selected')) return null
      if (w.has('nothing', 'none', 'deselect')) {
        return { calls: [{ name: 'select', input: { what: 'none' } }], confidence: 0.93 }
      }
      // "select the loop" is the song's loop; "select the notes in the loop of
      // the pad" is a clip's brace — clip_time's.
      if (w.has('loop')) return /\bnotes?\b/.test(w.raw.toLowerCase()) ? null : { calls: [{ name: 'select', input: { what: 'loop' } }], confidence: 0.93 }
      // Notes inside a clip — Find & Select by voice (lib/find-notes.ts):
      // "select every C in the pad", "select the quiet notes in the lead",
      // "select the notes off the scale in the bass". The clip is what follows
      // "in / on / of"; the rest of the sentence is the filter.
      const rawSel = w.raw.toLowerCase().replace(/[.,!?]+$/, '')
      const noteFilter = parseFilter(rawSel, s => pitchOf(s)?.pitch ?? null)
      // ⚠️ "the clips longer than a beat" also reads as a note filter (long).
      // Notes are meant only when the sentence says notes, or names a pitch
      // class or the scale — and never when it says clips.
      const meansNotes = !/\bclips?\b/.test(rawSel) && (/\bnotes?\b|\bchords?\b/.test(rawSel) || (noteFilter != null && (noteFilter.pitchClass != null || noteFilter.scale != null)))
      if (meansNotes) {
        const inM = /\b(?:in|on|of|from)\s+(?:the\s+)?([a-z0-9' ]+?)$/.exec(rawSel)
        const target = inM?.[1]?.trim() || ctx.selectedTrackName
        if (target) {
          for (const word of w.all) w.markWord(word, 0)
          const filter = inM ? rawSel.slice(0, inM.index).replace(/^.*?\bselect(?:ed)?\b\s*/, '').trim() : rawSel.replace(/^.*?\bselect(?:ed)?\b\s*/, '').trim()
          return { calls: [{ name: 'select', input: { what: 'notes', target, filter } }], confidence: 0.9, needsName: true }
        }
      }
      // ⚠️ The multi-select, by voice. "all the pad intro parts", "the third
      // pad intro part", "pad intro part 2", "the pad clips after bar 9", "the
      // clips shorter than a bar" — each names a SET of clips, and the set is
      // what gets selected. Before this, "select all the pad clips" selected
      // the whole song.
      const set = clipSetIn(w.raw.toLowerCase().replace(/^.*?\bselect(?:ed)?\b\s*/, ''), ctx)
      if (set) {
        for (const word of w.all) w.markWord(word, 0)
        return { calls: [{ name: 'select', input: { what: 'clips', ...set } }], confidence: 0.9, needsName: true }
      }
      const named = nameOrSelected(w, ctx, ['select', 'selected', 'the', 'all', 'everything',
        'clips', 'clip', 'on'])
      if (named && !w.has('all', 'everything')) {
        return { calls: [{ name: 'select', input: { what: 'track', target: named.name } }], confidence: 0.9 }
      }
      return { calls: [{ name: 'select', input: { what: 'all' } }], confidence: 0.9 }
    },
  },
  {
    id: 'set_colour',
    tool: 'set_colour',
    group: 'Project',
    what: 'Colour a clip or a track',
    say: ['colour the pad clips blue', 'make the drums track red', 'paint the pad clip green', 'colour all the drum tracks red'],
    match(w, ctx) {
      const col = colourOf(w.raw)
      if (!col) return null
      const raw = w.raw.toLowerCase().replace(/[.,!?]+$/, '')
      // A colour word alone is a description ("the blue pad") as often as a
      // command, and "make the white noise louder" has a colour in it. A
      // colouring verb makes it one; otherwise the colour must be what the
      // sentence ends on, or what something is turned TO.
      // ⚠️ Raw regexes: "make" and "turn" are bent by has(), and the colour
      // itself is the object here.
      const colourVerb = /\b(?:re)?colou?r(?:ed|ing)?\b|\bpaint(?:ed)?\b/.test(raw)
      const otherVerb = /\b(?:make|turn|set|mark|change)\b/.test(raw)
      const colourIsObject = new RegExp(`\\b(?:to|into|as)\\s+(?:the\\s+colou?r\\s+)?${col.name}\\b|\\b${col.name}\\s*$`).test(raw)
      if (!colourVerb && !(otherVerb && colourIsObject)) return null
      const body = raw
        .replace(/\b(?:please|light|hey|okay|ok)\b/g, ' ')
        .replace(/\b(?:re)?colou?r(?:ed|ing)?\b|\bpaint(?:ed)?\b|\b(?:make|turn|set|mark|change)\b/g, ' ')
        .replace(new RegExp(`\\b${col.name}\\b`, 'i'), ' ')
        .replace(/#[0-9a-f]{6}\b/i, ' ')
        // ⚠️ Not "it / them / these": pointing at the selection is the whole
        // sentence in "colour them blue", and clipSetIn reads the pointer.
        .replace(/\b(?:to|into|as|in|of)\b/g, ' ')
        .replace(/\s+/g, ' ').trim()
      const of = /\btracks?\b/.test(body) ? 'track' : /\b(?:clips?|parts?|copies|items)\b/.test(body) ? 'clip' : undefined
      // "colour all the drum tracks red", "make the muted tracks grey".
      const tset = /\btracks\b|\b(?:every|each|all)\b[\w ]*\btrack/.test(body) ? trackSetIn(body, ctx, /^$/) : null
      if (tset) {
        for (const word of w.all) w.markWord(word, 0)
        return { calls: [{ name: 'set_colour', input: { ...tset, colour: col.name, of: 'track' } }], confidence: 0.9, needsName: true }
      }
      const set = clipSetIn(body.replace(/\btracks?\b/g, ' '), ctx)
      const name = body.replace(/\b(?:the|a|tracks?|clips?|parts?|copies|items|all|every|each)\b/g, ' ').replace(/\s+/g, ' ').trim()
      let target = (typeof set?.target === 'string' && set.target) || name
      // "Colour them blue", "make it red": pointed at, with something selected.
      const selC = ctx.selectedClipIds?.length ? ctx.selectedClipIds : ctx.selectedClipId ? [ctx.selectedClipId] : []
      if (!target && selC.length && /\b(?:them|these|those|it|this|that|selected|selection)\b/.test(raw)) {
        target = selC.length > 1 ? `#sel:${selC.join(',')}` : `#${selC[0]}`
      }
      if (!target) return null
      // The whole sentence was read by the regexes above, so the whole
      // sentence is explained: coverage is what decides between rules, and
      // "make the drums track red" is otherwise an add_track.
      for (const word of w.all) w.markWord(word, 0)
      const rest = set ? Object.fromEntries(Object.entries(set).filter(([k]) => k !== 'target')) : {}
      return {
        calls: [{ name: 'set_colour', input: { target, colour: col.name, ...(of ? { of } : {}), ...rest } }],
        confidence: 0.9,
        needsName: true,
      }
    },
  },
  {
    id: 'audio_to_midi',
    tool: 'audio_to_midi',
    group: 'Arrangement',
    what: 'Slice an audio clip to a new MIDI track, or convert it to MIDI notes',
    say: ['slice the vox take clip to a new midi track', 'convert the vox take clip to midi', 'convert the vox take clip harmony to midi', 'convert the vox take clip to midi drums'],
    match(w, ctx) {
      const raw = w.raw.toLowerCase().replace(/[.,!?]+$/, '')
      if (!/\bmidi\b/.test(raw)) return null
      const slice = /\bslice\b/.test(raw)
      const convert = /\bconvert\b|\bturn\b|\bto midi\b|\binto midi\b|\bas midi\b/.test(raw)
      if (!slice && !convert) return null
      // The clip's own name first, as set_clip_audio does — a clip called
      // "Drums" must not make this a drum conversion of something else.
      const spoken = (ctx.clips ?? [])
        .filter(c => c.name && raw.includes(c.name.toLowerCase()))
        .sort((a, b) => (b.name?.length ?? 0) - (a.name?.length ?? 0))[0] ?? null
      const rest = spoken?.name ? raw.replace(spoken.name.toLowerCase(), ' ') : raw
      let target = spoken?.name ?? null
      let score = 1
      if (!target) {
        const hit = clipOrSelected(w, ctx, ['slice', 'slices', 'convert', 'turn', 'clip', 'clips', 'to', 'a', 'an', 'new', 'midi', 'track', 'into', 'as', 'the', 'its',
          'harmony', 'melody', 'drums', 'drum', 'notes', 'pads', 'transients', 'transient', 'markers', 'marker', 'bar', 'bars', 'grid', 'per', 'every', 'each', 'audio', 'sample'], { dropNums: true })
        if (!hit) return null
        target = hit.name
        score = hit.score
      }
      const op = slice ? 'slice' : /\bharmony\b|\bchords?\b/.test(rest) ? 'harmony' : /\bdrums?\b|\bbeat\b|\bkick\b/.test(rest) ? 'drums' : 'melody'
      const input: Record<string, unknown> = { target, op }
      if (slice) {
        const per = /\bmarkers?\b/.test(rest) ? 'markers' : /\b(?:per|every|each|on the|at the)\s+(bar|beat|quarter|eighth|sixteenth|1\/\d+)/.exec(rest)?.[1]
        if (per) input.per = per
        const maxM = /\b(?:at most|max(?:imum)?(?: of)?|up to)\s+(\d+)/.exec(rest)
        if (maxM) input.max = Number(maxM[1])
      }
      for (const word of w.all) w.markWord(word, 0)
      return { calls: [{ name: 'audio_to_midi', input }], confidence: 0.94, needsName: true }
    },
  },
  {
    id: 'import_settings',
    tool: 'import_settings',
    group: 'View',
    what: 'How samples land when dropped — one-shot, loop or auto; auto-warp long samples',
    say: ['import short samples as one shots', 'loop short samples when they land', 'stop auto warping long samples'],
    match(w) {
      const raw = w.raw.toLowerCase()
      // Always about "samples" in general — a named clip is set_clip_audio's.
      if (!/\bsamples\b/.test(raw)) return null
      const longM = /\blong samples\b/.test(raw) && /\bauto[- ]?warp/.test(raw)
      const shortM = /\bshort samples\b/.test(raw) || /\b(?:import(?:ed)?|drop(?:ped)?|land(?:s|ed)?|when they land)\b/.test(raw)
      if (!longM && !shortM) return null
      const input: Record<string, unknown> = {}
      if (longM) input.autoWarpLong = !/\b(?:stop|off|don't|do not|no longer|never)\b/.test(raw)
      else if (/\bone[- ]?shots?\b|\bunwarped\b/.test(raw)) input.shortSamples = 'oneshot'
      else if (/\bloops?\b|\bwarped\b/.test(raw)) input.shortSamples = 'loop'
      else if (/\bauto\b|\bdecide\b/.test(raw)) input.shortSamples = 'auto'
      else return null
      for (const word of w.all) w.markWord(word, 0)
      // ⚠️ The palette has commands called "Short samples land as: …", so the
      // studio-command-by-name rule (0.86) reads this sentence too. Within the
      // ambiguity margin the studio asks (or defers to the assistant) instead
      // of acting; this rule knows exactly what was said and must win outright.
      return { calls: [{ name: 'import_settings', input }], confidence: 0.96 }
    },
  },
  {
    id: 'set_clip_audio',
    tool: 'set_clip_audio',
    group: 'Arrangement',
    what: 'Fade, level, reverse or loop an audio clip',
    say: ['fade in the vox take clip over a bar', 'fade out the vox take clip over two beats', 'reverse the vox take', 'loop the vox take clip', 'turn the vox take clip down to 60%',
      'warp the vox take clip', 'set the vox take clip to complex mode', 'pitch the vox take clip up 3', 'the vox take clip is 90 bpm', 'put the vox take clip in beats mode',
      'make the vox take clip the tempo leader', 'slip the vox take clip 20 milliseconds'],
    match(w, ctx) {
      const raw = w.raw.toLowerCase().replace(/[.,!?]+$/, '')
      // ⚠️ A clip called "Drum loop" has "loop" in it, and "reverse the drum
      // loop" is not a loop command. The clip's own name is found first and
      // taken out before any keyword is read.
      const spoken = (ctx.clips ?? [])
        .filter(c => c.name && raw.includes(c.name.toLowerCase()))
        .sort((a, b) => (b.name?.length ?? 0) - (a.name?.length ?? 0))[0] ?? null
      const spokenClip = spoken?.name ?? null
      const rest = spokenClip ? raw.replace(spokenClip.toLowerCase(), ' ') : raw
      // ⚠️ "clip" is the word that makes these the clip's own settings. "Fade
      // out the drums over two bars" is a volume ramp on the track; "loop bars
      // 1 to 4" is the transport; "turn the guitar down to 60%" is the fader.
      // Without it, only a name that is an AUDIO clip and nothing else counts
      // — "reverse the lead" on a MIDI clip is reverse_notes.
      const pointed = /\b(?:them|these|those|it|this|that|selected|selection)\b/.test(raw) && !!(ctx.selectedClipIds?.length || ctx.selectedClipId)
      const clipWord = /\bclips?\b/.test(raw) || pointed
      const fadeIn = /\bfade[\s-]*in\b|\bfades?\s+(?:the\s+)?[\w\s]+?\s+in\b/.test(rest)
      const fadeOut = /\bfade[\s-]*out\b|\bfades?\s+(?:the\s+)?[\w\s]+?\s+out\b/.test(rest)
      const reverseSaid = /\b(?:reverse|reversed|backwards?)\b/.test(rest)
      // Shaping a clip's loop — cropping to it, doubling it, its length, the
      // notes in it — is clip_time's; this only switches looping on and off.
      if (/\bcrop\b|\bduplicate\b|\bdouble\b|\bselect\b|\bloop\b.*\bto\b.*\b(?:bars?|beats?)\b|\bloop (?:length|end)\b/.test(rest)) return null
      // Warping a clip AS a loop, straight, at a tempo, or its markers is warp_markers'; here Warp only switches on and off.
      if (/\bwarp/.test(rest) && /\bas an? \S+[- ]bars?\b|\bas a loop\b|\bstraight\b|\bat\s+\d+(?:\.\d+)?\s*bpm\b|\bmarkers?\b/.test(rest)) return null
      // Slip: the audio slides under the clip (lib/sample-editor.ts).
      const slipM = clipWord && /\bslip\b|\bslide\b.*\baudio\b|\baudio\b.*\bslide\b/.test(rest)
        ? /\b(?:by\s+)?(a|an|one|half a|\d+(?:\.\d+)?)\s*(milliseconds?|ms|seconds?|secs?|beats?|bars?)\b/.exec(rest)
        : null
      const loopSaid = /\bloop(?:ed|ing)?\b/.test(rest) && clipWord
      const gainM = clipWord ? /\b(?:to|at)\s+(\d{1,3})\s*(?:%|percent)/.exec(rest) : null
      // The Sample Editor's settings (lib/sample-editor.ts), all wanting the
      // word "clip": warp on / off, its mode, the pitch, the sample's own
      // tempo, the edge fade.
      const warpSaid = clipWord && /\bwarp(?:ed|ing)?\b/.test(rest) ? !/\b(?:un-?warp|stop|off|don't|do not|no longer)\b/.test(rest) : null
      // The warp mode needs the word "mode" (or "warp") beside it — "beats" and "texture" mean other things alone.
      const modeM = clipWord && /\bmode\b|\bwarp/.test(rest) ? /\b(re-?pitch|complex|beats|tones|texture)\b/.exec(rest) : null
      const pitchM = clipWord && /\b(?:pitch|tune)\b/.test(rest) ? /\b(up|down)\s+(?:by\s+)?(\d+(?:\.\d+)?)/.exec(rest) : null
      const bpmM = clipWord ? /(\d+(?:\.\d+)?)\s*bpm\b/.exec(rest) : null
      const fadeM = clipWord && /\b(?:edge|clip) fades?\b/.test(rest) ? !/\boff\b|\bno\b|\bstop\b/.test(rest) : null
      // Tempo leader (lib/tempo-leader.ts): "make the drums clip the tempo leader", "the song follows the drums clip's tempo".
      const leaderSaid = clipWord && /\bleader\b|\bfollows?\b[\w\s']*\btempo\b|\bdrives? the (?:song'?s? )?tempo\b/.test(rest)
        ? !/\b(?:stop|no longer|not|un-?set|release|isn't|is not|don't|do not)\b/.test(rest) : null
      if (!fadeIn && !fadeOut && !reverseSaid && !loopSaid && !gainM && warpSaid == null && !modeM && !pitchM && !bpmM && fadeM == null && leaderSaid == null && !slipM) return null
      if ((fadeIn || fadeOut) && !clipWord) return null
      let target = spokenClip
      let score = 1
      let kind: 'audio' | 'midi' | undefined = spoken?.kind
      if (!target) {
        const hit = clipOrSelected(w, ctx, ['fade', 'fades', 'reverse', 'reversed', 'backwards', 'backward', 'loop', 'looped', 'looping', 'unloop',
          'turn', 'set', 'make', 'play', 'stop', 'start', 'level', 'volume', 'gain', 'clip', 'clips', 'audio', 'over', 'for', 'by', 'across',
          'bar', 'bars', 'beat', 'beats', 'measure', 'measures', 'second', 'seconds', 'percent', 'half', 'down', 'up', 'in', 'out', 'the', 'a', 'an',
          'to', 'at', 'it', 'this', 'that', 'again', 'forwards', 'forward', 'tempo', 'leader', 'follow', 'follows', 'song', 'drives', 'drive'], { dropNums: true })
        if (!hit) return null
        const selIds = hit.name.startsWith('#sel:') ? hit.name.slice(5).split(',') : null
        const byId = selIds ? null : (ctx.clips ?? []).find(c => hit.name === c.id || hit.name === `#${c.id}`)
        const named = selIds ? (ctx.clips ?? []).filter(c => selIds.includes(c.id)) : byId ? [byId] : (ctx.clips ?? []).filter(c => foldName(c.name ?? '').includes(foldName(hit.name)))
        if (!clipWord && !named.length) return null
        kind = named.length && named.every(c => c.kind === 'midi') ? 'midi' : named.some(c => c.kind === 'audio') ? 'audio' : undefined
        target = hit.name
        score = hit.score
      }
      // Without the word "clip", only a clip known to be audio is this
      // command; and reversing a MIDI clip is reverse_notes whatever is said.
      if (!clipWord && kind !== 'audio') return null
      if (reverseSaid && kind === 'midi') return null
      const spanM = /\b(?:over|for|across|by|in)\s+(a|an|one|half a|\d+(?:\.\d+)?|[a-z]+)\s+(bars?|beats?|measures?|seconds?)\b/.exec(rest)
      const span = spanM
        ? (() => {
            const n = spanM[1] === 'a' || spanM[1] === 'an' || spanM[1] === 'one' ? 1 : spanM[1] === 'half a' ? 0.5 : (spokenNumber(spanM[1]) ?? Number(spanM[1]))
            if (!Number.isFinite(n)) return null
            return /beat/.test(spanM[2]) ? { beats: n } : /second/.test(spanM[2]) ? { seconds: n } : { bars: n }
          })()
        : null
      const input: Record<string, unknown> = { target }
      if (fadeIn) input.fadeIn = span ?? { beats: 1 }
      if (fadeOut) input.fadeOut = span ?? { beats: 1 }
      if (reverseSaid) input.reverse = !/\b(?:un-?reverse|stop|forwards?|back to normal)\b/.test(rest)
      if (loopSaid) input.loop = !/\b(?:stop|unloop|don't|do not|no longer|off)\b/.test(rest)
      if (gainM) input.gain = `${gainM[1]}%`
      if (warpSaid != null) input.warp = warpSaid
      if (modeM) input.warpMode = /complex/.test(modeM[1]) ? 'complex' : /beats/.test(modeM[1]) ? 'beats' : /tones/.test(modeM[1]) ? 'tones' : /texture/.test(modeM[1]) ? 'texture' : 'repitch'
      if (pitchM) input.transpose = (pitchM[1] === 'down' ? -1 : 1) * Number(pitchM[2])
      if (bpmM) input.segBpm = Number(bpmM[1])
      if (fadeM != null) input.fade = fadeM
      if (leaderSaid != null) input.tempoLeader = leaderSaid
      if (slipM) {
        const n = slipM[1] === 'a' || slipM[1] === 'an' || slipM[1] === 'one' ? 1 : slipM[1] === 'half a' ? 0.5 : (spokenNumber(slipM[1]) ?? Number(slipM[1]))
        if (Number.isFinite(n)) {
          input.slip = /^(?:milliseconds?|ms)$/.test(slipM[2]) ? { seconds: n / 1000 }
            : /second|sec/.test(slipM[2]) ? { seconds: n }
              : /beat/.test(slipM[2]) ? { beats: n } : { bars: n }
          input.slipDirection = /\bback\b|\bearlier\b|\bleft\b/.test(rest) ? 'earlier' : 'later'
        }
      }
      for (const word of w.all) w.markWord(word, 0)
      return { calls: [{ name: 'set_clip_audio', input }], confidence: clipWord ? 0.95 : nameConfidence(score), needsName: true }
    },
  },
  {
    id: 'move_track',
    tool: 'move_track',
    group: 'Project',
    what: 'Change where a track sits in the list',
    say: ['move the drums track to the top', 'put the pad below the bass', 'move the vocal track up one', 'send the synth track to the bottom'],
    match(w, ctx) {
      const raw = w.raw.toLowerCase().replace(/[.,!?]+$/, '')
      if (!/\b(?:move|put|send|drag|bring|shift|reorder)\b/.test(raw)) return null
      // ⚠️ Tracks only. "move the pad clip up", "move the bass up an octave"
      // and "move to the top" (bar 1, nothing named) are other commands: a
      // clip, a distance or a pitch word means this is not the track list, and
      // the thing moved must be a track — by the word, or by being one.
      if (/\b(?:clips?|bars?|beats?|octaves?|semitones?|steps?|db|decibels?|percent|notes?|%)\b/.test(raw)) return null
      const trackWord = /\btracks?\b/.test(raw)
      const relM = /\b(above|below|under|underneath|beneath|on top of)\s+(?:the\s+)?(.+?)(?:\s+tracks?)?\s*$/.exec(raw)
      // ⚠️ "bring the drums down a bit" is the fader. Up or down the LIST is
      // the bare word at the end, or a count of places: "up one", "down two",
      // "down a slot".
      const stepM = /\b(up|down)(?:\s+(?:by\s+)?(?:one|two|three|four|five|\d+|a\s+(?:slot|place|row|step|track|notch|spot)))?\s*$/.exec(raw)
      const to = /\btop\b/.test(raw) ? 'top' : /\bbottom\b/.test(raw) ? 'bottom' : stepM ? stepM[1] : null
      if (!relM && !to) return null
      const tgtM = /\b(?:move|put|send|drag|bring|shift|reorder)\s+(?:the\s+)?(.+?)\s+(?:tracks?\s+)?(?:(?:up\s+)?to\s+(?:the\s+)?(?:top|bottom)|up|down|above|below|under|underneath|beneath|on top of)\b/.exec(raw)
      let target = tgtM ? tgtM[1].replace(/\s+tracks?$/, '').replace(/^the\s+/, '').trim() : ''
      if (!target && ctx.selectedTrackName) target = ctx.selectedTrackName
      if (!target) return null
      const isTrack = (ctx.tracks ?? []).some(t => foldName(t.name ?? '').includes(foldName(target)))
      if (!isTrack && !trackWord) return null
      const rel = relM ? relM[2].replace(/\s+tracks?$/, '').trim() : ''
      const input: Record<string, unknown> = { target }
      if (relM && rel) {
        if (relM[1] === 'above' || relM[1] === 'on top of') input.before = rel
        else input.after = rel
      } else if (to) input.to = to
      for (const word of w.all) w.markWord(word, 0)
      return { calls: [{ name: 'move_track', input }], confidence: 0.92, needsName: true }
    },
  },
  // ── The workspace ────────────────────────────────────────────────────────
  //
  // Brae: "look at more navigation options that could be wired into voice
  // control." What a hand does between two edits: the view, zoom, scroll,
  // snap, an overlay, the Sound panel, a track brought into view — and the
  // editor's own palette, by name.
  {
    id: 'workspace.view',
    tool: 'workspace',
    group: 'View',
    what: 'Switch between the arrangement, session and mixer',
    say: ['show the mixer', 'switch to the arrangement view', 'go to session view', 'back to the arrangement'],
    match(w) {
      const raw = w.raw.toLowerCase().replace(/[.,!?]+$/, '')
      const view = viewOf(raw)
      if (!view) return null
      // A view word beside a thing to do to a track is not a view change:
      // "the mixer channel for the pad", "mixer volume".
      if (/\b(?:volume|level|fader|channel|pan|mute|solo|track|effects?|devices?|clip)\b/.test(raw)) return null
      if (!/\b(?:show|switch|go|open|back|view|take me|bring up|see|let'?s|to the|the)\b/.test(raw)) return null
      for (const word of w.all) w.markWord(word, 0)
      return { calls: [{ name: 'workspace', input: { view } }], confidence: 0.9 }
    },
  },
  {
    id: 'workspace.zoom',
    tool: 'workspace',
    group: 'View',
    what: 'Zoom the arrangement in, out, or to fit',
    say: ['zoom in', 'zoom out', 'zoom to fit', 'fit the song to the screen'],
    match(w) {
      const raw = w.raw.toLowerCase().replace(/[.,!?]+$/, '')
      const zoom = /\bzoom\s+(?:all the way\s+|right\s+)?in\b/.test(raw) ? 'in'
        : /\bzoom\s+(?:all the way\s+|right\s+)?out\b/.test(raw) ? 'out'
          : /\bzoom\s+to\s+fit\b|\bfit\s+(?:the\s+)?(?:song|everything|it|it all|all of it|whole song)\b|\bfit\s+to\s+(?:the\s+)?(?:screen|window|view)\b|\bzoom\s+to\s+(?:the\s+)?(?:whole|full|entire)\s+song\b/.test(raw) ? 'fit'
            : null
      if (!zoom) return null
      for (const word of w.all) w.markWord(word, 0)
      return { calls: [{ name: 'workspace', input: { zoom } }], confidence: 0.93 }
    },
  },
  {
    id: 'workspace.scroll',
    tool: 'workspace',
    group: 'View',
    what: 'Bring a bar or a section into view',
    say: ['show me bar 17', 'scroll to bar 9', 'scroll to the chorus', 'bring bar 5 into view'],
    match(w, ctx) {
      const raw = w.raw.toLowerCase().replace(/[.,!?]+$/, '')
      if (!/\b(?:show me|show|scroll|bring|look at|centre on|center on|let me see)\b/.test(raw)) return null
      // ⚠️ Not "show the effects on…" (show_view), not "show me the drums"
      // (workspace.focus): a bar or a section only, and the playhead stays.
      if (/\b(?:effects?|devices?|automation|notes?|chords?|clips?|tracks?|overlay|mixer|arrangement|session|pads?|sound|library|sidebar)\b/.test(raw)) return null
      const barM = /\b(?:bar|measure)\s+(\d{1,3})\b/.exec(raw)
      const secRe = `(${sectionNames(ctx).map(escapeRe).join('|')})`
      const secM = new RegExp(`\\b(?:to|at|me|show|see)\\s+(?:the\\s+)?${secRe}\\b`).exec(raw)
      if (!barM && !secM) return null
      for (const word of w.all) w.markWord(word, 0)
      return { calls: [{ name: 'workspace', input: { scrollTo: barM ? { bar: Number(barM[1]) } : { marker: secM![1] } } }], confidence: 0.9 }
    },
  },
  {
    id: 'workspace.snap',
    tool: 'workspace',
    group: 'View',
    what: 'What the grid snaps to',
    say: ['snap to bars', 'snap to eighths', 'turn snap off', 'snap to beats'],
    match(w) {
      const raw = w.raw.toLowerCase().replace(/[.,!?]+$/, '')
      if (!/\bsnap(?:ping)?\b/.test(raw)) return null
      const snap = snapOf(raw.replace(/\bsnap(?:ping)?\b/g, ' '))
      if (!snap) return null
      for (const word of w.all) w.markWord(word, 0)
      return { calls: [{ name: 'workspace', input: { snap } }], confidence: 0.92 }
    },
  },
  {
    id: 'workspace.overlay',
    tool: 'workspace',
    group: 'View',
    what: 'Grey out one kind of thing — an overlay',
    say: ['show the loading overlay', 'overlay the sections', 'clear the overlay', "show what's not loaded"],
    match(w) {
      const raw = w.raw.toLowerCase().replace(/[.,!?]+$/, '')
      const mentions = /\boverlays?\b/.test(raw) || /\bwhat'?s not (?:loaded|synced)\b|\bnot loaded\b|\bunloaded\b|\bout of key\b/.test(raw)
      if (!mentions) return null
      const clearing = /\b(?:clear|off|remove|hide|turn off|no|away|none)\b/.test(raw) && !/\b(?:not loaded|unloaded|not synced|out of key)\b/.test(raw)
      const kind = clearing ? 'none' : overlayOf(raw.replace(/\boverlays?\b/g, ' ').replace(/\b(?:show|put|turn on|switch on|the|a|an|me|what'?s|is)\b/g, ' '))
      if (!kind) return null
      for (const word of w.all) w.markWord(word, 0)
      return { calls: [{ name: 'workspace', input: { overlay: kind } }], confidence: 0.9 }
    },
  },
  {
    id: 'workspace.sound',
    tool: 'workspace',
    group: 'View',
    what: "Open a clip's Sound panel",
    say: ['open the sound panel', 'open the sound settings for the pad clip', 'show the sound panel on the bass 2 clip'],
    match(w) {
      const raw = w.raw.toLowerCase().replace(/[.,!?]+$/, '')
      if (!/\bsound\s+(?:panel|settings?)\b/.test(raw)) return null
      if (!/\b(?:open|show|bring up|pull up|see|edit)\b/.test(raw)) return null
      const srcM = /\b(?:for|on|of)\s+(?:the\s+)?([a-z0-9' ]+?)(?:\s+clip)?\s*$/.exec(raw)
      for (const word of w.all) w.markWord(word, 0)
      return { calls: [{ name: 'workspace', input: { soundPanel: true, ...(srcM ? { target: srcM[1].trim() } : {}) } }], confidence: 0.9 }
    },
  },
  {
    id: 'workspace.focus',
    tool: 'workspace',
    group: 'View',
    what: 'Bring a track into view and select it',
    say: ['show me the drums track', 'take me to the pad', 'scroll to the bass 2 track'],
    match(w, ctx) {
      const raw = w.raw.toLowerCase().replace(/[.,!?]+$/, '')
      const verb = /\b(?:show me|take me to|scroll to|find|bring up|jump to)\b/.exec(raw)
      if (!verb) return null
      // ⚠️ "the pads" is the pad card; "the pad" is a track called Pad.
      if (/\b(?:bar|measure|effects?|devices?|automation|notes?|chords?|clips?|mixer|arrangement|session|overlay|sound|pads|sequencer|piano|library|sidebar|marker|playhead)\b/.test(raw)) return null
      const name = raw.slice(verb.index + verb[0].length).replace(/^\s*(?:the\s+)?/, '').replace(/\s+track$/, '').trim()
      if (!name) return null
      const want = foldName(name)
      const track = (ctx.tracks ?? []).find(t => foldName(t.name ?? '') === want) ?? (ctx.tracks ?? []).find(t => foldName(t.name ?? '').startsWith(want))
      if (!track) return null
      for (const word of w.all) w.markWord(word, 0)
      return { calls: [{ name: 'workspace', input: { focus: track.name } }], confidence: 0.88, needsName: true }
    },
  },
  {
    id: 'workspace.command',
    tool: 'workspace',
    group: 'View',
    what: "Any of the studio's own commands, by name",
    // ⚠️ Not "open the sound library" as an example: it is a hair from
    // open_editor's "open the library" (the library PAGE), and the suite
    // rightly calls that a close call. It still works when the palette
    // offers it — see the workspace test.
    say: ['hide the sidebar', 'start a new section here', 'go to the end of the song', 'drop a marker at the playhead', 'import an audio file'],
    match(w, ctx) {
      if (!ctx.commands?.length) return null
      const raw = w.raw.toLowerCase().replace(/[.,!?]+$/, '')
      const hit = matchCommand(ctx.commands, raw)
      // ⚠️ 0.8, not lower: "open the library" says two of the three words of
      // "Open Sound Library" and scores 0.77 — and it is open_editor's
      // sentence (the library page), not the sidebar tab.
      if (!hit || hit.score < 0.8) return null
      for (const word of w.all) w.markWord(word, 0)
      return { calls: [{ name: 'workspace', input: { command: hit.command.label } }], confidence: 0.86 }
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
      // "Bring the pad clip back" is one parked clip returning (set_clip_active),
      // not the whole mix.
      const restore = w.has('bring') && w.has('back', 'everything', 'all') && !w.has('clip', 'clips')
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
      // A LINE turned over — "upside down", or a word for a line — is
      // invert_notes (lib/pitch-time.ts), not a chord voicing.
      if (/\bupside down\b|\b(?:melody|line|riff|pattern|notes|part)\b/.test(w.raw.toLowerCase())) return null
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
      // ⚠️ Shaping something that EXISTS is not the same as asking for a new
      // part that sounds a certain way. "Add a warm bass part" wants a bass
      // written with a warm sound; warming up the bass already there is a
      // different edit, and it was winning because it saw "warm" first.
      if (w.has('bassline', 'baseline')
        || (w.has('part', 'line') && w.has('add', 'put', 'give', 'write', 'create'))) return null
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
      'lay the pad back a bit', 'push the drums ahead', 'humanize the guitar 30 percent',
    ],
    match(w, ctx) {
      const feel = (w.has('half') && w.has('time')) ? 'half'
        : (w.has('double') && w.has('time')) ? 'double'
          : w.has('humanize', 'humanise', 'loosen') ? 'humanize'
            : (w.has('lay', 'laid', 'behind', 'lazy') && !w.has('ahead')) ? 'behind'
              : w.has('ahead', 'push', 'rushed') ? 'ahead' : null
      if (!feel) return null
      // "humanize the guitar 30 percent" — the Amount (lib/pitch-time.ts).
      const pctM = /(\d+)\s*(?:%|percent)/.exec(w.raw)
      const named = nameOrSelected(w, ctx, ['make', 'the', 'half', 'double', 'time',
        'humanize', 'humanise', 'loosen', 'lay', 'laid', 'back', 'behind', 'lazy',
        'ahead', 'push', 'rushed', 'a', 'bit', 'percent', 'by'], { dropNums: true })
      if (!named) return null
      return { calls: [{ name: 'time_feel', input: { target: named.name, feel, ...(pctM ? { amount: Number(pctM[1]) } : {}) } }], confidence: 0.88 }
    },
  },
  {
    id: 'note_length',
    tool: 'note_length',
    group: 'Notes',
    what: 'Legato, staccato, or just longer and shorter notes',
    say: ['make the pad legato', 'staccato the guitar', 'shorter notes on the lead', 'make the pad eighth notes'],
    match(w, ctx) {
      const raw = w.raw.toLowerCase()
      // One length for every note — Set Length (lib/pitch-time.ts): "make the
      // pad eighth notes", "set the lead to 1/16". Not when something is being
      // ADDED in that length — that is a beat or a clip. ⚠️ Not "two beats
      // long": that is resize_clip's sentence, and the clip is what it means.
      const lenM = /\b((?:thirty[- ]second|sixteenth|eighth|quarter|half|whole)\s+notes?|1\/(?:32|16|8|4|2)(?:\s+notes?)?)\b/.exec(raw)
      const style = w.has('legato') ? 'legato'
        : w.has('staccato', 'stabs', 'stabby') ? 'staccato'
          : (w.has('shorter') && w.has('note', 'notes')) ? 'shorter'
            : (w.has('longer') && w.has('note', 'notes')) ? 'longer'
              : lenM && !w.has('add', 'insert', 'put', 'play', 'draw', 'write', 'record', 'quantize', 'quantise', 'snap', 'swing', 'grid',
                'arpeggiate', 'arpeggio', 'arp', 'arpeggiator', 'rate', 'strum', 'repeat', 'echo', 'delay', 'stutter', 'roll') ? 'set' : null
      if (!style) return null
      const named = nameOrSelected(w, ctx, ['make', 'the', 'legato', 'staccato', 'stabs',
        'stabby', 'shorter', 'longer', 'note', 'notes', 'on', 'set', 'to', 'every', 'all', 'long', 'in', 'of', 'turn', 'into',
        'thirty', 'second', 'sixteenth', 'eighth', 'quarter', 'half', 'whole', 'beat', 'beats', 'one', 'two', 'three', 'four'], { dropNums: true })
      if (!named) return null
      if (style === 'set') for (const word of w.all) w.markWord(word, 0)
      const length = style === 'set' ? lenM![1].replace(/\s+long$/, '') : undefined
      return { calls: [{ name: 'note_length', input: { target: named.name, style, ...(length ? { length } : {}) } }], confidence: 0.9 }
    },
  },
  {
    id: 'dynamics_ramp',
    tool: 'dynamics_ramp',
    group: 'Notes',
    what: 'Build or fall away across a part',
    say: ['crescendo the pad', 'diminuendo the guitar', 'make the drums build'],
    match(w, ctx) {
      // ⚠️ 'fall' is EXACT, not fuzzy. "Call drums 1 the intro" was becoming a
      // DIMINUENDO, because "call" is one edit from "fall" and has() bends
      // words. A trigger this short and this ordinary cannot also be a spelling
      // correction target — the musical word is "diminuendo", and "fall" is a
      // convenience that must not go looking for near misses.
      const dir = w.has('crescendo', 'build', 'swell') ? 'crescendo'
        : (w.has('diminuendo', 'decrescendo') || w.all.includes('fall')) ? 'diminuendo' : null
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
      // ⚠️ An AUDIO clip named in the sentence — "reverse the vox take" — is
      // set_clip_audio: there are no notes to reverse. Left to this rule as
      // well, the two read the sentence at nearly the same score, the studio
      // called it a close call, and a signed-out session did neither.
      const raw = w.raw.toLowerCase()
      if ((ctx.clips ?? []).some(c => c.kind === 'audio' && c.name && raw.includes(c.name.toLowerCase()))) return null
      const named = nameOrSelected(w, ctx, ['reverse', 'reversed', 'backwards',
        'backward', 'play', 'the'])
      if (!named) return null
      return { calls: [{ name: 'reverse_notes', input: { target: named.name } }], confidence: 0.9 }
    },
  },
  {
    id: 'invert_notes',
    tool: 'invert_notes',
    group: 'Notes',
    what: 'Flip a part upside down — the highest note becomes the lowest',
    say: ['flip the lead upside down', 'invert the pad melody', 'turn the guitar riff upside down'],
    match(w, ctx) {
      const raw = w.raw.toLowerCase()
      // Plain "invert the keys" is chord_inversion — a voicing. This is the
      // LINE turned over, and the sentence has to say so: "upside down", or
      // "invert" beside a word for a line. ⚠️ Not w.has('flip'): it is one
      // edit from "clip" and would swallow half the studio.
      if (!/\bupside down\b|\binvert(?:ed)?\b.*\b(?:melody|line|riff|pattern|notes|part)\b|\b(?:melody|line|riff|pattern|notes|part)\b.*\binvert/.test(raw)) return null
      if (w.has('chord', 'chords', 'inversion', 'selection', 'voicing')) return null
      const named = nameOrSelected(w, ctx, ['invert', 'inverted', 'flip', 'turn', 'upside', 'down', 'the',
        'melody', 'line', 'riff', 'pattern', 'notes', 'part', 'of', 'in', 'on'])
      if (!named) return null
      for (const word of w.all) w.markWord(word, 0)
      // 0.92: "down" is also the volume rule's word, and a tie there is a
      // question nobody should be asked.
      return { calls: [{ name: 'invert_notes', input: { target: named.name } }], confidence: 0.92 }
    },
  },
  {
    id: 'stretch_notes',
    tool: 'stretch_notes',
    group: 'Timing',
    what: 'Stretch a part in time — twice as long, half, or by a factor',
    say: ['stretch the lead to twice as long', 'stretch the pad by 1.5', 'squash the guitar to half'],
    match(w, ctx) {
      const raw = w.raw.toLowerCase()
      if (!/\bstretch|\bsquash|\bsquish/.test(raw)) return null
      // Audio is warping (a later batch); a bar count is a clip resize.
      if (w.has('warp', 'audio', 'sample', 'bars', 'bar')) return null
      const numM = /(?:by|to|times|x)\s*(\d+(?:\.\d+)?)\b|\b(\d+(?:\.\d+)?)\s*(?:x|times|×)\b/.exec(raw)
      const factor = /\btwice\b|\bdouble\b|\b2x\b/.test(raw) ? 2
        : /\bhalf\b/.test(raw) ? 0.5
          : /\bthree times\b|\btriple\b/.test(raw) ? 3
            : /one and a half/.test(raw) ? 1.5
              : numM ? Number(numM[1] ?? numM[2]) : null
      if (factor == null || !(factor > 0) || factor === 1) return null
      const named = nameOrSelected(w, ctx, ['stretch', 'stretched', 'squash', 'squish', 'the', 'to', 'by', 'twice', 'as', 'long',
        'double', 'half', 'times', 'x', 'factor', 'of', 'a', 'one', 'and', 'triple', 'three', 'out', 'notes', 'part', 'it'], { dropNums: true })
      if (!named) return null
      for (const word of w.all) w.markWord(word, 0)
      return { calls: [{ name: 'stretch_notes', input: { target: named.name, factor } }], confidence: 0.9 }
    },
  },
  {
    id: 'warp_markers',
    tool: 'warp_markers',
    group: 'Arrangement',
    what: 'Warp an audio clip — as a loop of N bars, straight, at a tempo; clear its markers',
    say: ['warp the vox take clip as a 2 bar loop', 'warp the vox take clip straight', 'warp the vox take clip at 90 bpm', 'clear the warp markers on the vox take clip'],
    match(w, ctx) {
      const raw = w.raw.toLowerCase()
      if (!/\bwarp/.test(raw)) return null
      const op = /\bas an? (\d+|one|two|four|eight)[- ]bars?\b|\bas a loop\b/.test(raw) ? 'as_loop'
        : /\bstraight\b/.test(raw) ? 'straight'
          : /\bat\s+\d+(?:\.\d+)?\s*bpm\b/.test(raw) ? 'at_bpm'
            : /\bclear\b|\bremove\b|\bdelete\b/.test(raw) && /\bmarkers?\b/.test(raw) ? 'clear'
              : null
      if (!op) return null
      const named = nameOrSelected(w, ctx, ['warp', 'warped', 'the', 'clip', 'as', 'a', 'an', 'bar', 'bars', 'loop', 'straight', 'at', 'bpm', 'clear', 'remove', 'delete',
        'markers', 'marker', 'on', 'of', 'from', 'one', 'two', 'four', 'eight'], { dropNums: true })
      if (!named) return null
      const input: Record<string, unknown> = { target: named.name, op }
      if (op === 'as_loop') {
        const m = /\bas an? (\d+|one|two|four|eight)/.exec(raw)
        const WORDS: Record<string, number> = { one: 1, two: 2, four: 4, eight: 8 }
        input.bars = m ? (WORDS[m[1]] ?? Number(m[1])) : 1
      }
      if (op === 'at_bpm') input.bpm = Number(/\bat\s+(\d+(?:\.\d+)?)\s*bpm/.exec(raw)![1])
      for (const word of w.all) w.markWord(word, 0)
      return { calls: [{ name: 'warp_markers', input }], confidence: 0.95 }
    },
  },
  {
    id: 'clip_time',
    tool: 'clip_time',
    group: 'Notes',
    what: 'A clip\'s loop: its length, doubling it, cropping to it, selecting inside it — and cropping an audio clip\'s sample',
    say: ['set the pad loop to two bars', 'duplicate the pad loop', 'select the notes in the loop of the pad', 'crop the vox take clip'],
    match(w, ctx) {
      const raw = w.raw.toLowerCase()
      // "Crop the vocal clip" is the audio crop (the sample loses what the clip
      // never plays) and says nothing about a loop; everything else here does.
      const croppingAudio = /\bcrop\b/.test(raw) && !/\bloop/.test(raw)
      if (!/\bloop/.test(raw) && !croppingAudio) return null
      // The SONG loop ("loop the chorus", "loop bars 1 to 5", "select the loop")
      // and looping a clip on or off belong to other rules; this is a clip's
      // loop being SHAPED — its length, doubled, cropped to, its notes picked.
      const op = /\bduplicate\b|\bdouble\b/.test(raw) ? 'duplicate_loop'
        : /\bcrop\b/.test(raw) ? 'crop'
          : /\bselect\b/.test(raw) && /\bnotes?\b/.test(raw) ? 'select_in_loop'
            : /\bloop\b.*\bto\b.*\b(?:bars?|beats?)\b|\bloop (?:length|of)\b.*\b(?:bars?|beats?)\b/.test(raw) && /\b(?:set|make|change)\b/.test(raw) ? 'set_loop_length'
              : null
      if (!op) return null
      const named = nameOrSelected(w, ctx, ['set', 'make', 'change', 'the', 'loop', 'loops', "loop's", 'to', 'of', 'its', 'duplicate', 'double', 'crop', 'clip',
        'select', 'notes', 'note', 'in', 'inside', 'bar', 'bars', 'beat', 'beats', 'long', 'length', 'one', 'two', 'three', 'four', 'six', 'eight', 'a', 'an',
        'sample', 'audio', 'plays', 'play', 'what', 'it'], { dropNums: true })
        // ⚠️ A clip named on its own — "crop the vox take clip" — is invisible
        // to that lookup: it protects the words of TRACK names only, so "take"
        // is eaten as a near-miss of "make" and the leftover names nothing.
        // Read the clip out of the sentence the way set_clip_audio does.
        ?? (() => {
          const spoken = (ctx.clips ?? [])
            .filter(c => c.name && raw.includes(c.name.toLowerCase()))
            .sort((a, b) => (b.name?.length ?? 0) - (a.name?.length ?? 0))[0]
          return spoken?.name ? { name: spoken.name, score: 1 } : null
        })()
      if (!named) return null
      const input: Record<string, unknown> = { target: named.name, op }
      if (op === 'set_loop_length') {
        const beats = parseLoopLength(raw, 4)
        if (beats == null) return null
        input.length = { beats }
      }
      for (const word of w.all) w.markWord(word, 0)
      // Above the song-loop and duplicate-clip rules, which share its words.
      return { calls: [{ name: 'clip_time', input }], confidence: 0.93 }
    },
  },
  {
    id: 'edit_notes',
    tool: 'edit_notes',
    group: 'Notes',
    what: 'Split, chop, join, fit or deactivate the notes of a part',
    say: ['split the pad notes in half', 'chop the lead notes into four', 'join the pad notes', 'deactivate the pad notes', 'fit the pad notes to the loop'],
    match(w, ctx) {
      const raw = w.raw.toLowerCase()
      // These verbs belong to clips too — "split the pad at bar 2", "deactivate
      // the pad clip" — so the sentence has to say NOTES (or a chord).
      if (!/\bnotes?\b|\bchords?\b/.test(raw)) return null
      const op = /\bchop\b/.test(raw) ? 'chop'
        : /\bsplit\b|\bcut\b.*\bin half\b/.test(raw) ? 'split'
          : /\bjoin\b|\bmerge\b|\bglue\b/.test(raw) ? 'join'
            : /\bfit\b/.test(raw) ? 'fit'
              : /\bdeactivate\b|\bturn off\b|\bsilence\b/.test(raw) ? 'deactivate'
                : /\breactivate\b|\bactivate\b|\bturn (?:back )?on\b/.test(raw) ? 'activate' : null
      if (!op) return null
      // "fit … to the loop" is ours; "fit to scale" is the roll's key fix.
      if (op === 'fit' && /\bscale\b|\bkey\b/.test(raw)) return null
      const partsM = /\binto\s+(\d+|two|three|four|five|six|eight)\b/.exec(raw)
      const WORDS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, eight: 8 }
      const parts = /\bin half\b|\bin two\b/.test(raw) ? 2 : partsM ? (WORDS[partsM[1]] ?? Number(partsM[1])) : undefined
      const named = nameOrSelected(w, ctx, ['split', 'chop', 'cut', 'join', 'merge', 'glue', 'fit', 'deactivate', 'reactivate', 'activate',
        'turn', 'off', 'on', 'back', 'silence', 'the', 'notes', 'note', 'chord', 'chords', 'in', 'half', 'into', 'to', 'loop', 'clip',
        'two', 'three', 'four', 'five', 'six', 'eight', 'parts', 'pieces', 'of', 'every', 'all'], { dropNums: true })
      if (!named) return null
      for (const word of w.all) w.markWord(word, 0)
      const input: Record<string, unknown> = { target: named.name, op }
      if (parts && (op === 'split' || op === 'chop')) input.parts = parts
      if (op === 'fit') input.range = /\bloop\b/.test(raw) ? 'loop' : 'clip'
      return { calls: [{ name: 'edit_notes', input }], confidence: 0.9 }
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
      // ⚠️ A PLACE, not an editor — the same command, because "open the piano
      // roll" and "open the video module" are one request in anybody's head.
      // Checked first: "projects" and "library" are not editors, and reading
      // them as one would open a sequencer on a track nobody named.
      //
      // ⚠️ EXACT, and behind a cheap gate. The first version tested eight place
      // words with has(), which bends words and costs an edit-distance pass
      // each — on a rule that runs for every sentence, inside a reader that
      // tries many hypotheses. It pushed a long sentence from under 25 ms to
      // 26.5 and the performance test caught it. Place names are distinctive
      // nouns that nobody needs corrected into, so plain comparison is both
      // faster and safer here — the same lesson as 'call' being bent to 'fall'.
      // ⚠️ Read off the RAW sentence, not the content words. "Go to the
      // community" reduces to just ["community"] — "go" is filler and is
      // stripped before any rule sees it — so a gate that looked for the verb
      // among the content words could never fire on the commonest phrasing
      // there is. One regex, and no edit distance.
      const going = /\b(open|opens|go|goto|going|take|switch|show|jump|navigate|bring)\b/
        .test(w.raw.toLowerCase())
      if (going) {
        const PLACES = ['video', 'projects', 'library', 'community', 'dashboard',
          'settings', 'apps', 'learn', 'studio']
        const found = PLACES.find(x => w.all.includes(x))
        if (found) {
          const place = found === 'studio' ? 'audio' : found
          w.has(found)              // account for the word, on the hit path only
          return { calls: [{ name: 'open_editor', input: { editor: place } }], confidence: 0.9 }
        }
        if (w.all.includes('audio')) {
          w.has('audio')
          return { calls: [{ name: 'open_editor', input: { editor: 'audio' } }], confidence: 0.9 }
        }
      }

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
    say: ['what notes are being played', 'what chord is this', 'what notes are these', 'what is the first chord in the chord stack', 'what are the chords in the chord stack'],
    match(w) {
      if (!w.has('note', 'notes', 'chord', 'chords')) return null
      if (!w.has('what', 'which', 'name', 'tell')) return null
      // A question, not an edit. Everything here that also takes notes as its
      // object is an instruction, and they share the noun.
      if (w.has('add', 'delete', 'remove', 'move', 'transpose', 'quantize', 'louder', 'quieter')) return null
      // ⚠️ The record, 23:37: "What is the chord, the 1st chord in pad intro,
      // about a 2nd into it?" → every note in the clip. Which clip, and which
      // part of it, are both read here and answered on their own.
      const rawQ = w.raw.toLowerCase().replace(/[.,!?]+$/, '')
      const na = parseNoteAddress(rawQ)
      const srcM = /\b(?:in|of|on|from)\s+(?:the\s+)?([a-z0-9' ]+?)(?=\s+(?:about|around|at|and|then)\b|[,.]|$)/.exec(rawQ)
      const input: Record<string, unknown> = {}
      if (srcM && na) {
        const name = srcM[1].trim()
        if (name && !/^(?:the\s+)?(?:song|track|project|arrangement|this|that|it|here|there)$/.test(name)) input.target = name
      }
      if (na) input.notes = na.label
      if (na) for (const word of w.all) w.markWord(word, 0)
      return { calls: [{ name: 'name_notes', input }], confidence: 0.9 }
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
      // ⚠️ The name was never read. add_track's tool takes one and its executor
      // uses it, but this rule sent `{}` every time, so "add a track called
      // Keys" made a track called "Track 4" — and left "called Keys"
      // unexplained, which dragged coverage to 0.5 and stopped the sentence
      // splitting as well. Same shape as add_marker, which reads its name the
      // same way.
      const name = nameAfter(w.raw, /\s+(?:called|named|labell?ed)\s+/)
      if (name) {
        w.has('called', 'named', 'labelled', 'labeled')
        for (const word of name.split(/\s+/)) w.markWord(word, 0)
      }
      return {
        calls: [{ name: 'add_track', input: name ? { name: name.replace(/\b[a-z]/g, c => c.toUpperCase()) } : {} }],
        confidence: 0.88,
      }
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
    say: ['delete the pad track', 'remove the guitar track', 'delete the empty tracks'],
    // Confirmed before it runs. A mishearing that deletes a track is not
    // undone by saying the opposite.
    destructive: true,
    match(w, ctx) {
      if (!w.has('track')) return null
      if (!w.has('delete', 'remove', 'get')) return null
      // "delete the empty tracks", "remove every muted track" — a set.
      const set = trackSetIn(w.raw, ctx, /\b(?:delete|remove|get rid of|get|rid|of)\b/)
      if (set && !w.has('clip', 'clips')) {
        for (const word of w.all) w.markWord(word, 0)
        return { calls: [{ name: 'remove_track', input: set }], confidence: 0.9, needsName: true }
      }
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
      const name = nameAfter(w.raw, /\s+(?:as|called|named|labell?ed)\s+/)
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
    say: ['delete the bass 2 clip', 'remove the drums clip', 'delete all the pad clips', 'delete the first pad clip', 'delete everything on the pad before the chorus'],
    destructive: true,
    match(w, ctx) {
      if (!w.has('delete', 'remove', 'get')) return null
      // "delete everything on the pad before the chorus", "delete them": a
      // set with no clip word in it, named by place or by pointing.
      if (!w.has('clip', 'item', 'clips', 'items', 'copies', 'parts')) {
        if (w.has('track', 'tracks', 'note', 'notes', 'marker', 'effect')) return null
        const set0 = clipSetIn(w.raw.toLowerCase().replace(/^.*?\b(?:delete|remove|get rid of)\b\s*/, ''), ctx)
        if (!set0 || (set0.track === undefined && set0.after === undefined && set0.before === undefined && set0.section === undefined && set0.at === undefined && set0.shorterThan === undefined && set0.longerThan === undefined && !String(set0.target ?? '').startsWith('#'))) return null
        // "remove the delay from the pad" names an effect on a track, not a
        // clip on it: a name that is no clip's name is somebody else's command.
        const named0 = String(set0.target ?? '')
        if (named0 && !named0.startsWith('#') && !(ctx.clips ?? []).some(c => foldName(c.name ?? '').includes(foldName(named0)))) return null
        for (const word of w.all) w.markWord(word, 0)
        return { calls: [{ name: 'remove_clip', input: { target: '', ...set0 } }], confidence: 0.9, needsName: true }
      }
      // ⚠️ "all" / an ordinal name a SET, and the set goes in one call. The
      // record, 23:43: "Delete all pad intro part" was answered one clip at a
      // time, five commands over.
      const all = w.has('all', 'every', 'each')
      const ordM = /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|\d{1,2}(?:st|nd|rd|th))\s+(?!bar\b|beat\b)/i.exec(w.raw)
      const hit = clipOrSelected(w, ctx, ['delete', 'remove', 'get', 'rid', 'clip', 'item', 'clips', 'items', 'copies', 'parts',
        'all', 'every', 'each', 'of', 'them', 'other', 'first', 'second', 'third', 'fourth', 'fifth', 'last'],
        { dropNums: !ordM })
      if (!hit) return null
      const ORD: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 }
      const which = all ? 'all' : ordM ? (ordM[1].toLowerCase() === 'last' ? 'last' : (ORD[ordM[1].toLowerCase()] ?? Number(ordM[1].replace(/\D/g, '')))) : undefined
      // A place or a length narrows the set: "the pad intro parts after bar
      // 9", "the ones that are not a full bar long".
      const set = clipSetIn(w.raw.toLowerCase().replace(/^.*?\b(?:delete|remove|get rid of)\b\s*/, ''), ctx)
      const filters = set ? Object.fromEntries(Object.entries(set).filter(([k]) => ['after', 'before', 'at', 'shorterThan', 'longerThan'].includes(k))) : {}
      // ⚠️ The name finder prefers the track "Pad" to the clips "Pad intro"
      // — right for one clip, wrong for a set. The words as spoken, when they
      // say more than the track's name, are the set's name.
      const spokenName = typeof set?.target === 'string' ? set.target : ''
      const target = spokenName && foldName(spokenName) !== foldName(hit.name) && foldName(spokenName).includes(foldName(hit.name)) ? spokenName : hit.name
      return {
        calls: [{ name: 'remove_clip', input: { target, ...(which !== undefined ? { which } : {}), ...filters } }],
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
    say: ['quantize the drums', 'quantize the bass 2 to eighth notes', 'tighten up the drums', 'quantize the drums to eighth note triplets', 'quantize the ends of the pad notes'],
    match(w, ctx) {
      if (!w.has('quantize', 'quantise') && !w.hasPhrase('tighten', 'up') && !w.has('tighten')) {
        return null
      }
      const hit = clipOrSelected(w, ctx, ['quantize', 'quantise', 'tighten', 'up', 'grid',
        'note', 'notes', 'to', 'track', 'clip', 'eighth', 'sixteenth', 'quarter',
        'half', 'percent', 'by', 'triplet', 'triplets', 'end', 'ends', 'endings', 'starts', 'both', 'of', 'the'], { dropNums: true })
      if (!hit) return null
      // The grid, said the way musicians say it. A quarter note is the default
      // because it is what "quantize this" means when nobody specifies.
      const division = w.has('sixteenth', 'sixteenths') ? 0.25
        : w.has('eighth', 'eighths') ? 0.5
          : w.has('half') ? 2
            : 1
      // Triplets (lib/quantize.ts: two thirds of the value) and which end moves.
      const triplet = w.has('triplet', 'triplets')
      const adjust = w.all.includes('end') || w.all.includes('ends') || w.has('endings') ? 'end' : w.all.includes('both') ? 'both' : undefined
      const n = argNumbers(w, hit.name)[0]
      const strength = n != null && n > 0 && n <= 100 && w.has('percent') ? n : undefined
      return {
        calls: [{
          name: 'quantize',
          input: { target: hit.name, division, ...(triplet ? { feel: 'triplet' } : {}), ...(adjust ? { adjust } : {}), ...(strength != null ? { strength } : {}) },
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
    say: ['make the drums softer', 'play the bass 2 harder', 'set the pad velocity to 90', 'make the last chord of the organ chords softer'],
    match(w, ctx) {
      const softer = w.has('softer', 'gentler', 'lighter')
      const harder = w.has('harder', 'stronger', 'punchier')
      const named = w.has('velocity')
      if (!softer && !harder && !named) return null
      if (softer && harder) return null
      // Part of a clip: "make the last chord of the pad softer".
      const rawV = w.raw.toLowerCase().replace(/[.,!?]+$/, '')
      const na = parseNoteAddress(rawV)
      const srcM = na ? /\b(?:of|in|on|from)\s+(?:the\s+)?([a-z0-9' ]+?)(?=\s+(?:softer|harder|gentler|lighter|stronger|punchier|a bit|a little|a lot|to|by|and|then)\b|[,.]|$)/.exec(rawV) : null
      const hit = clipOrSelected(w, ctx, ['softer', 'gentler', 'lighter', 'harder',
        'stronger', 'punchier', 'velocity', 'make', 'play', 'set', 'track', 'clip',
        'bit', 'lot', ...(na ? ['chord', 'chords', 'note', 'notes', 'above', 'below', 'over', 'under', 'every', 'all', 'at', 'bar', 'bars', 'beat', 'beats', 'of', 'in', 'on', 'from', 'to', 'two', 'three', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'last', 'highest', 'lowest', 'top', 'bottom', 'opening'] : [])], { dropNums: true })
      const target = srcM?.[1]?.trim() || hit?.name
      if (!target) return null
      const score = na ? 1 : (hit?.score ?? 0.8)
      const extra = na ? { notes: na.label } : {}
      if (na) for (const word of w.all) w.markWord(word, 0)
      const n = argNumbers(w, hit?.name ?? target).filter(x => !na || (x !== na.addr.chord && x !== na.addr.note))[0]
      if (named && n != null && n > 0 && n <= 127) {
        return {
          calls: [{ name: 'set_velocity', input: { target, velocity: n, ...extra } }],
          confidence: nameConfidence(score),
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
          input: { target, scale: softer ? 100 - step : 100 + step, ...extra },
        }],
        confidence: nameConfidence(score),
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
    say: ['make the bass 2 a violin', 'put a piano on the pad', 'change the drums to a cello', 'change the drums to a hihat', 'put a kick sample on the drums'],
    match(w, ctx) {
      if (!ctx.library?.length) return null
      if (!w.has('make', 'put', 'change', 'use', 'load', 'swap')) return null

      // The sound is whatever the sentence names — a library NAME ("a violin",
      // matched against the library rather than guessed at, so it only means
      // something when there is a violin to mean), a KIND ("a hihat" is any
      // sound whose category is hihat), or a FOLDER. See lib/voice/library-match.ts:
      // Brae's "There is no hihat sample", with a folder of them in the library.
      const found = findLibrarySound(w.all, ctx.library, { strict: true, raw: w.raw })
      if (!found) return null
      const sound = { id: found.sound.id, name: found.sound.name }
      const soundWords = found.words

      // The TRACK is what is left once the instrument's own words are out of
      // the way — otherwise "make the bass a violin" looks for a track called
      // "bass violin".
      const hit = nameOrSelected(w, ctx, ['make', 'put', 'change', 'use', 'load', 'swap',
        'into', 'onto', 'track', 'sound', 'sounds', 'instrument', 'preset', 'presets', 'sample', 'samples', ...soundWords], { dropNums: true })
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
      // "take the first chord of the pad intro…" is a copy of some notes, not
      // the removal of a chord effect — see copy_notes.
      if (/\b(?:first|opening|1st)\s+(?:chord|note)\b/.test(w.raw.toLowerCase())) return null
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
    id: 'describe.library',
    tool: 'describe',
    group: 'Questions',
    what: 'Ask what sounds you have',
    say: ['what dark pads do I have', 'what pianos do I have', 'what is in my library'],
    match(w) {
      // ⚠️ "Have" and "my" are what make this a question about the LIBRARY
      // rather than about the song. "What tracks do I have" is the song, and
      // describe.tracks owns it, so the noun has to be a library one.
      const INSTRUMENTS = /\b(pianos?|organs?|guitars?|strings?|brass|mallets?|woodwinds?|synths?|basses|pads?|leads?|keys)\b/
      const asksWhatIHave = w.has('have') && (characterWordsIn(w.raw).length > 0 || INSTRUMENTS.test(w.raw.toLowerCase()))
      // ⚠️ IT HAS TO BE A QUESTION. "Sounds" bends from "sound", so "make it
      // SOUND better" — a tone request — was being answered with a list of
      // presets. Fifth time a short word has been bent into a command here.
      // A question word, or the word "library", or an explicit "do I have".
      // ⚠️ And it must not be a request to MAKE something. Brae's own sentence
      // — "put in a baseline preset that uses ... sad piano presets" — contains
      // the word "presets", so a question rule keyed on that word answered a
      // request to write music with a list of instruments. A question does not
      // ask for anything to be put anywhere.
      if (w.all.some(x => x === 'put' || x === 'add' || x === 'make' || x === 'give'
        || x === 'write' || x === 'create' || x === 'use' || x === 'set')) return null
      // ⚠️ A QUESTION WORD, or the word "library". Nothing weaker.
      //
      // Keying on "presets" or "sounds" was too weak twice over: it answered
      // "make it SOUND better" with a list, and — because the sequence reader
      // tries SPANS of a sentence, not just the whole thing — a fragment like
      // "sad piano presets" inside a request to write a bassline read as a
      // question on its own. A guard on the whole sentence cannot help there;
      // the trigger itself has to be question-shaped.
      const isQuestion = w.all.some(x => x === 'what' || x === 'which' || x === 'any')
        || w.has('library')
      if (!isQuestion && !asksWhatIHave) return null
      if (!w.has('library', 'sounds', 'presets', 'instruments') && !asksWhatIHave) return null
      if (w.has('track', 'tracks', 'clip', 'clips')) return null
      // The whole sentence goes as `target` — the executor reads both the tag
      // words and the instrument words out of it, and it is the only thing that
      // knows which is which.
      const words = characterWordsIn(w.raw)
      const asked = words.length || INSTRUMENTS.test(w.raw.toLowerCase())
      return {
        calls: [{ name: 'describe', input: { topic: 'library', ...(asked ? { target: w.raw } : {}) } }],
        confidence: 0.9,
      }
    },
  },
  {
    id: 'describe.loading',
    tool: 'describe',
    group: 'Questions',
    what: 'Ask whether the song has finished loading',
    say: ['is it still loading', 'is it ready yet', 'how far along is the loading'],
    match(w) {
      if (!w.has('loading', 'loaded', 'ready', 'baking', 'rendering')) return null
      // "Load the project" is an instruction; this is a question about state.
      if (w.has('project', 'file')) return null
      return { calls: [{ name: 'describe', input: { topic: 'loading' } }], confidence: 0.9 }
    },
  },
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
    say: ['rename the bass 2 clip to intro', 'rename the drums clip to verse',
      'change the name of the item guitar clip to intro'],
    match(w, ctx) {
      // "Rename X to Y", and also "CHANGE THE NAME OF X TO Y", which is how
      // Brae said it and which reached no rule at all.
      const asksToRename = w.has('rename')
        || (w.has('name') && w.has('change', 'set', 'make', 'call'))
      if (!asksToRename) return null
      const parts = w.raw.toLowerCase().split(/\s+to\s+/)
      if (parts.length !== 2) return null
      const fresh = parts[1].trim().replace(/[^a-z0-9\s'-]/g, '').trim()
      if (!fresh) return null
      const said = parts[0]
        .replace(/\b(rename|change|set|make|call|the|name|of|clip|item|track|please)\b/g, ' ')
        .trim()
      // ⚠️ IT SEARCHED ctx.tracks FOR A CLIP NAME. There is no TRACK called
      // "Drums 1", so renaming a clip could never resolve and the sentence fell
      // through to whatever else would take it. Clips are in ctx.clips.
      const hit = said ? findByName(said, ctx.clips ?? []) : null
      if (!hit || hit.score < 0.6) return null
      // Saying "clip" or "item" is not required when the name IS a clip's — but
      // when the same words also name a track, the word decides which was meant
      // and rename_track owns the sentence without it.
      if (!w.has('clip', 'item')) {
        const alsoATrack = findByName(said, ctx.tracks)
        if (alsoATrack && alsoATrack.score >= hit.score) return null
      }
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
      // ⚠️ EXACT, because this runs without the model in every mode. has()
      // bent "reverb" into "revert", so "the reverb is too much", "turn on the
      // reverb", "less reverb" — any reverb sentence no other rule read —
      // silently undid the last edit. See Words.exact.
      if (!w.exact('undo', 'revert')) {
        // "take that back" — but "take the reverb back a bit" names a thing
        // to take back, which is a nudge on that thing, not an undo.
        if (!(w.has('take') && w.has('back'))) return null
        if (!w.only(new Set(['take', 'back', 'last', 'change', 'edit', 'one', 'again']))) return null
      }
      if (w.exact('redo')) return null
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
      // Exact for the same reason as undo: "red" and "reds" were a redo.
      if (!w.exact('redo')) return null
      return { calls: [{ name: 'redo', input: {} }], confidence: 0.93 }
    },
  },

  // ── Browsing the shelf ───────────────────────────────────────────────────
  //
  // Only STARTING is a rule. The words said while browsing — next, back, again,
  // faster — are read in the voice control itself and never registered here, on
  // purpose: they already mean transport and tempo, and giving them a second
  // meaning application-wide to serve a mode that is usually not running would
  // make every one of those sentences ambiguous. See readBrowseCommand.
  {
    id: 'browse_sounds',
    tool: 'browse_sounds',
    group: 'Project',
    what: 'Play through your sounds or recipes so you can hear them',
    say: ['show me the recipes', 'play me the sounds tagged dark', 'let me hear the drum samples', 'what recipes do you have', 'show me drum beats', 'play me some trap beats'],
    match(w) {
      // ⚠️ Brae: "I asked to see recipes and it said that it can't do that for
      // me." It could — but this rule only listened for "browse" or for
      // play/hear WITH sounds/samples/library, so "show me the recipes", "let
      // me see the recipes" and "what recipes do you have" resolved to nothing
      // and went to the assistant, which had no phrasing like that to match
      // either. And "browse the recipes" DID match — as a search of sample
      // names for the word "recipes", which found nothing and said so.
      //
      // The word "recipes" is the kind, never the query.
      //
      // ⚠️ Brae: "When I ask the voice control to show me drum beats it tells
      // me a bunch of beats." The same hole, one shelf over: "beats" was no
      // kind at all, so the sentence went to the assistant, which had nothing
      // to play them with and READ THE LIST OUT instead. Beats are the drum
      // patterns, and "drum"/"drums" beside them is the kind, not a search.
      // ⚠️ PLURAL, AND EXACT. "give me a beat like doom ts doom ts" is a beat to
      // MAKE (make_beat), not a shelf to browse — and has() bends "beat" to
      // "beats" in one edit, so the singular must not be in the list at all.
      // Browsing is always "beats", "grooves", "rhythms": a shelf, not a thing.
      const beats = w.exact('beats', 'grooves', 'rhythms')
      const recipes = w.has('recipes', 'recipe', 'progressions', 'patterns')
      const sounds = w.has('sounds', 'samples', 'library', 'instruments')
      // "let's check out some different drum beats", "find me some beats",
      // "give me a few grooves" — the sentences that actually got said.
      const asked = w.has('browse', 'audition', 'show', 'see', 'hear', 'play', 'listen', 'check', 'find', 'give')
        || (w.has('what') && w.has('have', 'got'))
      if (!asked || (!recipes && !sounds && !beats)) return null
      // Whatever is left once the asking words are accounted for IS the search.
      // has() marks what it matches, so consuming these here keeps them out of
      // the query — "play me the sounds tagged dark" should look for "dark",
      // not for "sounds tagged dark". "new", "different", "other", "more" say
      // browse, not what for: "show me some new drum beats" is every beat.
      // ⚠️ One word per call: has(a, b, c) marks the FIRST of them it finds and
      // stops, so a single call over this list left "some different" in the
      // query. Each word is asked for on its own.
      for (const filler of ['tagged', 'tag', 'some', 'all', 'anything', 'everything', 'my', 'through', 'want', 'have', 'got',
        'new', 'different', 'other', 'ones', 'more', 'few', 'out', 'couple']) w.has(filler)
      // "drum beats", "drum patterns" — the drums are what beats are made of.
      if (beats || recipes) for (const d of ['drum', 'drums', 'percussion']) w.has(d)
      const q = w.unexplained().join(' ').trim()
      // Recipes and beats may be asked for with no filter — dozens, not hours.
      if (!q && !recipes && !beats) return null
      const kind = beats && !recipes && !sounds ? 'beats'
        : recipes && !sounds ? 'recipes' : sounds && !recipes ? 'sounds' : 'both'
      return {
        calls: [{ name: 'browse_sounds', input: { kind, ...(q ? { query: q } : {}) } }],
        confidence: 0.88,
      }
    },
  },

  // ── Named shapes ─────────────────────────────────────────────────────────
  //
  // ⚠️ A RULE, NOT AN ASSISTANT JOB, AND THAT IS THE WHOLE ECONOMICS OF MACROS.
  // Deriving a shape costs a turn; running one by name has to cost nothing, or
  // a macro is only ever as cheap as asking for it again from scratch. This is
  // also why the studio says the name back when it saves one — "do the same
  // thing" points at the selection and can never be cached, a name always can.
  //
  // Bar ranges are deliberately left to the assistant: "from bar 9 to 25" needs
  // real position parsing, it is the rarer half, and a rule that guessed at it
  // would be wrong in a way nobody could see.
  {
    id: 'run_macro',
    tool: 'run_macro',
    group: 'Arrangement',
    what: 'Run a shape you have named',
    say: ['steady swell on the pad', 'do the steady swell on the bass'],
    match(w, ctx) {
      const names = macroNames()
      if (!names.length) return null
      // Longest first, so "steady swell" wins over a macro merely called "swell".
      const hit = names
        .slice()
        .sort((a, b) => b.length - a.length)
        .find(n => {
          const words = macroKey(n).split(' ').filter(Boolean)
          return words.length > 0 && words.every(word => w.has(word))
        })
      if (!hit) return null
      const stop = [...macroKey(hit).split(' '), 'run', 'do', 'put', 'across', 'over', 'apply', 'use']
      const t = nameOrSelected(w, ctx, stop)
      return {
        calls: [{ name: 'run_macro', input: { name: hit, ...(t ? { target: t.name } : {}) } }],
        confidence: t ? nameConfidence(t.score) : 0.88,
        needsName: !!t,
      }
    },
  },

  // ── The workspace ────────────────────────────────────────────────────────
  //
  // Brae: "Give Light control over changing visuals, like changing
  // customization options, opening lanes and piano rolls and sequencers."
  //
  // Rules rather than assistant-only, because these are the commands most worth
  // having instantly: "open the piano roll on the bass" is a request to SEE
  // something, and a second of thinking time is the whole cost of the feature.
  // Nothing here changes the song, so a rule being wrong costs a panel opening.
  {
    id: 'select.focus_track',
    tool: 'select',
    group: 'View',
    what: 'Focus a track, so "this" means that one',
    say: ["let's edit the bass track", 'focus on the drums', 'work on the pad'],
    match(w, ctx) {
      // ⚠️ NOT A MODE — see the summary. This is the selection the studio
      // already has, set out loud, so everything afterwards that names nothing
      // acts on it exactly as it always did.
      // ⚠️ CONTENT WORDS ONLY. "work on the pad" arrives here as ['work','pad']
      // — 'on', 'the' and "let's" are all FILLER and stripped before any rule
      // sees the sentence, so hasPhrase('work','on') could never match and the
      // phrasing silently did nothing. The track name is the real guard here;
      // the verb only has to be recognisable.
      if (!w.has('focus', 'work', 'edit')) return null
      // These belong to open_editor and to the colours rule below.
      if (w.has('notes', 'roll', 'piano', 'sequencer')) return null
      if (w.has('colours', 'colors', 'appearance', 'theme')) return null
      const hit = nameOrSelected(w, ctx, ['focus', 'let', 'lets', 'edit', 'work', 'on', 'track'])
      if (!hit) return null
      return {
        calls: [{ name: 'select', input: { what: 'track', target: hit.name } }],
        confidence: nameConfidence(hit.score),
        needsName: true,
      }
    },
  },
  {
    id: 'show_view.colours',
    tool: 'show_view',
    group: 'View',
    what: "Open the studio's own colours and patterns",
    say: ["let's edit the UI colours", 'change the studio colours', 'open the appearance panel'],
    match(w) {
      // ⚠️ The STUDIO's colours, not a track's. A bare "colour" is far more
      // likely to be about a track, so the theme words have to be there.
      const isTheme = w.has('appearance', 'theme')
        || (w.has('colours', 'colors', 'colour', 'color') && w.has('ui', 'studio', 'interface', 'app', 'editor'))
      if (!isTheme) return null
      if (!w.has('edit', 'change', 'open', 'show', 'let', 'lets', 'customise', 'customize')) return null
      return {
        calls: [{ name: 'show_view', input: { view: 'colours', open: !w.has('close', 'hide') } }],
        confidence: 0.92,
      }
    },
  },
  {
    id: 'show_view.devices',
    tool: 'show_view',
    group: 'View',
    what: "Open a track's effect rack",
    say: ['open the devices on the pad', 'show the rack for the bass', 'close the devices'],
    match(w, ctx) {
      // ⚠️ "effects" alone belongs to the rules that ADD one — they sit above
      // this and get first refusal, so reaching here means nobody asked for a
      // change, only to look.
      //
      // ⚠️ AND "rack" NEEDS A VERB WITH IT. The matcher hears near-homophones on
      // purpose, so a bare 'rack' also catches "lay the pad BACK a bit" — a
      // groove command with no interest in devices. Requiring somebody to have
      // asked to open or show it costs nothing and settles that.
      // ⚠️ The record, 20:20: "Show me the automation lanes of Stab Effect" —
      // the word "effect" made this the rack, and the automation the sentence
      // was actually about went to show_view.automation never. The more
      // specific noun wins: automation beside a track name is the lanes.
      if (w.has('automation', 'automated', 'lanes', 'lane')) return null
      // ⚠️ EXACT "rack": it is one edit from "track", so "show me the drums
      // track" read as "open the drums rack" and tied with bringing the track
      // into view — a close call, so a signed-out session did neither.
      if (!(w.has('devices') || ((w.exact('rack', 'racks') || w.has('effects')) && w.has('open', 'show', 'bring')))) return null
      const open = !w.has('close', 'hide')
      const hit = open ? nameOrSelected(w, ctx, ['open', 'show', 'devices', 'device', 'rack', 'effects', 'for', 'on']) : null
      if (open && !hit) return null
      return {
        calls: [{ name: 'show_view', input: { view: 'devices', open, ...(hit ? { target: hit.name } : {}) } }],
        confidence: hit ? nameConfidence(hit.score) : 0.9,
        needsName: open,
      }
    },
  },
  {
    id: 'show_view.automation',
    tool: 'show_view',
    group: 'View',
    what: 'Show a drawable automation lane under a track',
    say: ['show automation on the drums', 'open the automation lane for the pad'],
    match(w, ctx) {
      if (!(w.has('automation') && w.has('open', 'show', 'add', 'see', 'bring'))) return null
      // "the automation lanes OF stab effect": the noun words around the name
      // are not the name.
      const hit = nameOrSelected(w, ctx, ['open', 'show', 'add', 'see', 'bring', 'automation', 'lane', 'lanes', 'graph', 'graphs', 'for', 'on', 'of', 'effect', 'effects'])
      if (!hit) return null
      return {
        calls: [{ name: 'show_view', input: { view: 'automation', target: hit.name } }],
        confidence: nameConfidence(hit.score),
        needsName: true,
      }
    },
  },
  {
    id: 'show_view.transcript',
    tool: 'show_view',
    group: 'View',
    what: 'Open the transcript — what you said, what Light said, what it did',
    say: ['show me the transcript', 'open the voice log', 'what did you do', 'what have you done so far'],
    match(w) {
      // "what did you do" — read on the raw words, since "did" and "you" are
      // filler to the matcher and never reach has().
      const didYou = /\bwhat (?:did|have) (?:you|light) (?:do|done|change|changed)\b/i.test(w.raw)
      const asked = w.has('show', 'open', 'see', 'bring', 'read') || didYou
      const noun = w.has('transcript', 'log', 'history', 'conversation') || didYou
      if (!asked || !noun) return null
      // "what did you do TO the pad" is a question about the pad, not the log.
      if (w.has('track', 'clip', 'pad', 'bass', 'drums')) return null
      return { calls: [{ name: 'show_view', input: { view: 'transcript', open: !w.has('close', 'hide') } }], confidence: 0.9 }
    },
  },
  {
    id: 'show_view.help',
    tool: 'show_view',
    group: 'View',
    what: 'Open the list of everything Light can do',
    say: ['open the list of commands', 'what can I say', 'show me what you can do', 'open the help'],
    match(w) {
      // ⚠️ The record, 17:52: "Open the list of commands that I can" → a
      // spoken summary of eight groups, when the request was to OPEN the list.
      // "what you can do" / "what can I say" — the words that carry it are
      // filler to the matcher, so they are read on the raw sentence.
      const whatCan = /\bwhat (?:you|light) can do\b|\bwhat can (?:you|light|i) (?:do|say|ask)\b/i.test(w.raw)
      const asked = w.has('open', 'show', 'see', 'bring', 'list', 'pull') || whatCan
      const noun = w.has('commands', 'command', 'help', 'phrases', 'phrasings')
        || (w.has('what') && w.has('say', 'ask', 'tell')) || whatCan
      if (!asked || !noun) return null
      return { calls: [{ name: 'show_view', input: { view: 'help', open: !w.has('close', 'hide') } }], confidence: 0.88 }
    },
  },
  {
    id: 'show_view.voice',
    tool: 'show_view',
    group: 'View',
    what: "Open the voice card's own settings, costs or named shapes",
    say: ['open the voice settings', 'show me the usage', 'show the macros', 'open the named shapes'],
    match(w) {
      if (!w.has('open', 'show', 'see', 'bring')) return null
      const view = w.has('settings', 'setting', 'preferences') ? 'settings'
        : w.has('usage', 'costs', 'cost', 'spend', 'spent', 'lumens') ? 'usage'
        : w.has('macros', 'macro', 'shapes') ? 'macros' : null
      if (!view) return null
      // "show the settings on the reverb" is a device, and the device rules
      // sit above this — reaching here with a track name means something else.
      return { calls: [{ name: 'show_view', input: { view, open: !w.has('close', 'hide') } }], confidence: 0.85 }
    },
  },
  {
    id: 'describe.playhead',
    tool: 'describe',
    group: 'Questions',
    what: 'Ask where the playhead is',
    say: ['where is the playhead', 'where am I', 'what bar are we on', 'where are we in the song'],
    match(w) {
      // ⚠️ The record, 17:55: "Where is the playhead right now?" → "The loop
      // is set from bar 1 to bar 71, but looping is off." The question was
      // about the playhead and the answer was about the loop.
      // "where am I" / "where are we": every word but "where" is filler to
      // the matcher, so it is read on the raw sentence.
      const whereAreWe = /\bwhere (?:am i|are we)\b/i.test(w.raw)
      const where = w.has('where') || whereAreWe || (w.has('what') && w.has('bar', 'position'))
      const what = w.has('playhead', 'cursor', 'position') || whereAreWe || w.has('bar')
      if (!where || !what) return null
      return { calls: [{ name: 'describe', input: { topic: 'position' } }], confidence: 0.9 }
    },
  },
  {
    id: 'show_view.pads',
    tool: 'show_view',
    group: 'View',
    what: 'Open or close the playable pads',
    say: ['open the pads', 'show me the pads', 'close the pads'],
    match(w) {
      if (!w.has('pads')) return null
      if (!w.has('open', 'show', 'close', 'hide', 'bring')) return null
      // ⚠️ "open the devices on the PAD" is not a request for the pads. The
      // singular and the plural are one word to a recogniser, so the panel
      // somebody actually named wins.
      if (w.has('devices', 'rack', 'effects', 'automation')) return null
      return {
        calls: [{ name: 'show_view', input: { view: 'pads', open: !w.has('close', 'hide') } }],
        confidence: 0.92,
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
      // "beginning" on its own is not a request to restart — "i like the
      // beginning" was one, because the word alone satisfied this. It needs a
      // going-back word with it; "restart" needs nothing. Exact, like the
      // other instant commands (see Words.exact).
      const asked = w.exact('restart', 'restarted')
        || w.hasPhrase('start', 'over')
        || w.said('from the top', 'from the beginning', 'to the beginning', 'to the top', 'back to the start')
        || (w.exact('beginning', 'top') && w.has('take', 'go', 'start', 'back', 'again', 'play'))
      if (!asked) return null
      // Read the rest of the phrase so the reading explains it.
      w.exact('beginning', 'top')
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
      // "warp the clip as a 2 bar loop" names bars to warp across, not a place to go.
      if (w.has('warp', 'warped', 'warping')) return null
      // ⚠️ The record, 16:40: "Start a low pass on bar 5. Keep it at" → moved
      // the playhead to bar 5. A thing to START at a bar — a filter, a sweep, a
      // fade, a reverb — is an automation that begins there, and the bar is
      // where it begins, not where to go. Naming any parameter or shape beside
      // the bar means this is not a locate.
      if (w.has('pass', 'filter', 'sweep', 'fade', 'reverb', 'delay', 'volume', 'cutoff', 'automation', 'ramp', 'descend', 'ascend', 'lowpass', 'highpass')) return null
      // ⚠️ The record, 23:45: "It doesn't seem to be that it's 1 full bar
      // long" → moved the playhead to bar 1. A bar number inside a sentence
      // about something else is not a destination. Going somewhere needs a
      // verb of going, or the bare place — "bar 9", "to bar 9" — and nothing
      // else in the sentence.
      // ⚠️ Raw regexes: "take" and "back" are filler to has().
      const raw = w.raw.toLowerCase().replace(/[.,!?]+$/, '').trim()
      const verb = /\b(?:go|goes|going|jump|take|skip|locate|scrub|rewind|head|move|start|play|cue|put me|bring me)\b/.test(raw)
      const bare = /^(?:(?:go\s+)?to\s+)?(?:the\s+)?(?:bar|measure)\s+\d{1,3}(?:\s+(?:please|now))?$/.test(raw)
      if (!verb && !bare) return null
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
      // ⚠️ EXACT. "hat" and "half" are one edit from "halt", "top" and "step"
      // from "stop" — and this fires instantly, with nothing downstream to
      // catch it, so "the hat is too much" stopped the song. The plural and
      // past tense are listed because a recogniser produces them for "stop".
      // ⚠️ Not "stopped": that is the READ-BACK, and hearing it back ran the
      // command again (the record: "Pause." ×5 in a minute). Nobody commands
      // a studio in the past tense.
      if (!w.exact('stop', 'stops', 'halt')) return null
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
      // Exact: "pulse" is a synth word one edit from "pause".
      if (!w.exact('pause') && !w.said('hold on')) return null
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
/**
 * Is this word one the rules react to?
 *
 * ⚠️ Used by the sequence reader to decide whether a single reading really has
 * explained a sentence. A RATIO cannot tell the difference between four
 * unexplained filler words and one unexplained "pan" — and the second is a
 * command going in the bin. "Turn the bass up and pan it left" scored exactly
 * 0.80 with "pan" left over, cleared the 0.8 bar, and did half of what was
 * asked without saying so.
 */
export function isTriggerWord(word: string): boolean {
  return TRIGGER_SET.has(word.toLowerCase())
}

const TRIGGER_WORDS: readonly string[] = [
  // The volume verbs. They ARE words the rules react to — the relative volume
  // rule reads them — and leaving them out meant a name could run straight
  // through one ("a track called Keys turn down") and a span could look
  // complete while a command sat unexplained inside it.
  'turn', 'bring', 'crank', 'push', 'pull',
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

const TRIGGER_SET = new Set<string>(TRIGGER_WORDS)

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
    ['Transport', 'Mixer', 'Timing', 'Arrangement', 'Notes', 'View', 'Project', 'Questions']
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
