// What a spoken command actually DOES to the project.
//
// One validated tool call in, the DAW actions that perform it out. PURE — no
// dispatch, no engine, no clock — so every command can be tested by reading the
// actions it produces, which is the only way to know a voice system does what it
// says before letting it touch someone's song.
//
// Four rules:
//
//   Say what you did, in bars. Every plan carries `say`, and positions in it
//   read as "bar 5 beat 3", never as an absolute beat number, because nobody
//   counts a song that way and the read-back is the whole safety story.
//
//   Refuse rather than guess. If "bass" matches two tracks the plan is empty
//   and `problem` explains why.
//
//   Every position and length goes through the tempo and meter maps. A bar is
//   as long as the meter says at that point; a second is as long as the tempo
//   says at that point.
//
//   Never invent an id. Everything referenced is resolved from the project or
//   freshly minted here.

import type { DawProject, DawTrack, MidiClip, MidiNote, DawClip, AudioClip, EffectType, TrackEffect } from '../daw-types'
import { defaultDrumInstrument } from '../daw-types'
import { parseSpokenBeat, beatToNotes, describeBeat as describeSpokenBeat } from './beatbox'
import { parseDefinitions, applyDefinitions, clearVocab, definitions, laneFromName } from './vocab'
import { commandHelp } from './commands'
import { grooveNamed, applyGroove } from './grooves'
import {
  defaultTransientShaper, defaultUtility, defaultUnmask,
  defaultReverb, defaultDelay, defaultFilter, defaultCompressor,
  defaultSaturator, defaultChorus, defaultEq3, defaultLimiter,
  defaultVelocityMidi, defaultScaleMidi, defaultChordMidi, defaultArpMidi,
} from '../daw-types'
import { findByName, foldName, spokenNumber, spokenFraction } from './resolve'
import { matchPresetByCharacter, characterWordsIn, presetTags, type PresetLike } from './preset-character'
import { findLibrarySound, describeLibraryKinds } from './library-match'
import { SCALE_INTERVALS, type ScaleType } from '../scale-constants'
import {
  matchApolloParam, matchFilterType, moduleHint, resolveValue, readParam, writeParam,
  describeValue, FILTER_NAMES, type SpokenParam,
} from '../apollo/spoken-params'
import { FILTER_TYPES } from '../apollo/patch'
import type { ApolloPatch } from '../apollo/patch'
import type { VoiceAsk, AskOption } from './ask'
import {
  musicMaps, positionToBeat, durationToBeats, describeBeat, describeDuration,
  type MusicMaps, type MusicPosition, type MusicDuration,
} from './position'
import { beatToSeconds } from '../tempo-map'
import { parseModRate, describeModRate } from '../daw-modulation'
import { addressClips, parseClipAddress, clipLabel, colourOf, type ClipAddress } from '../clip-address'
import { parseNoteAddress, addressNotes, chordsOf, pitchOf, type NoteAddress, type Chord } from '../note-address'
import { splitAt, chopNotes, joinNotes, fitToRange, setActive } from '../note-ops'
import { parseFilter, findNotes, describeFilter } from '../find-notes'
import { quantizeNotes as quantizeWithSettings, parseGridSaid } from '../quantize'
import { loopRange, workingRange, notesInRange, duplicateLoop, cropToRange, insertTime, deleteTime, duplicateTime } from '../clip-time'
import { setSegBpm, slipByDrag, cropSample } from '../sample-editor'
import { warpAsLoop, warpAtBpm, warpStraight } from '../warp'
import { SHORT_SAMPLE_LABEL, type ShortSampleMode } from '../import-settings'
import { LAUNCH_MODE_LABEL, LAUNCH_MODE_HELP } from '../launch'
import { plainWordIn, needsAsking, senseFromAnswer, defaultSense, describeSense, askText } from './plain-words'
import {
  getProposal, describeSpan, playbackSpan, rampParameter, rampEnds, stepAmount, clampAmount,
  type Proposal, type StepSize,
} from './proposal'
import { addressTracks, parseTrackAddress, describeTracks, TRACK_WORDS, type TrackAddress } from '../track-address'
import { viewOf, snapOf, snapLabel, overlayOf, OVERLAY_LABEL } from './workspace'
import { isSampleRef, sampleRefId } from '../sample-preset'
import { LOWPASS_HZ, HIGHPASS_HZ, automatableParams, shortNameOf, type AutomatableParam } from '../daw-effect-params'
import { ADD_OPTIONS, APOLLO_ADD_OPTIONS, makeDefaultParams } from '../daw-effect-catalog'
import { nameChord, groupIntoChords } from '../chord-analysis'
import { rngFor } from '../seeded-random'
import { transposeNotes, transposeDegrees, invertNotes, addInterval, stretchNotes, setLength, humanizeNotes, reverseNotes, parseDuration, durationLabel, type Scale } from '../pitch-time'

import {
  defineMacro, findMacro, macroNames, toPoints, describeMacro, useMacro, type MacroShape,
} from './macros'
import { FX_FIELD_BY_KEY } from '@/lib/roll-fx'
import type { RollFx, AutomationLane } from '@/lib/daw-types'

/**
 * Effect amounts that can be drawn over time, by the name people say.
 *
 * ⚠️ EVERY ONE OF THESE IS 0–1, which is why they need no unit conversion the
 * way a filter cutoff does: "100% to 20%" maps straight onto the lane. Anything
 * added here that is NOT 0–1 needs its range carrying, or a percentage will be
 * written into a lane that reads Hertz — the bug that once silenced a pad.
 */
/**
 * Was that sentence a request to MOVE, or an edit that happened to name a bar?
 *
 * Brae: "it just moved my playhead again... I think that when I bring up bars
 * it thinks I'm moving the playhead."
 *
 * ⚠️ THE TOOL DESCRIPTION HAS WARNED ABOUT THIS FOR MONTHS AND IT KEPT
 * HAPPENING. A warning in a prompt is advice; this is a rule, and it is here
 * rather than in the prompt for that reason alone.
 *
 * The test is what ELSE the sentence contains. "Go to bar 9" is a move and
 * nothing else. "Make the reverb 100% then 20% at bar 9" is an edit that
 * mentions a bar — and of everything in it, moving the playhead is the one
 * thing nobody asked for.
 *
 * ⚠️ AND IT REFUSES OUT LOUD. A silent drop would leave the studio doing
 * nothing, which is only marginally better than doing the wrong thing. Saying
 * why hands the model a result it can act on, so it can answer properly in the
 * same command — which is what the turn loop is for.
 *
 * Returns the reason, or null when the move is genuinely what was asked.
 */
const EDITS = /\b(make|set|change|turn|put|add|raise|lower|drop|bring|fade|sweep|automate|ramp|louder|quieter|brighter|darker|wetter|drier|mute|solo|delete|remove|duplicate|copy|move|stretch|shorten|lengthen|reverb|delay|filter|volume|pan|gain|drive|chorus|eq|compress)\b/i
// "Move to bar 1" is a move: the record, 22:15, refused it as an edit because
// "move" is also an edit word. A move TO a bar, with nothing else in the
// sentence, is what going somewhere sounds like.
const MOVES = /\b(go|goto|jump|move the playhead|move (?:up |back |forward )?to (?:the )?(?:bar|measure|beginning|start|end|top)|take me|skip|scrub|locate|start from|play from|back to|rewind|position)\b/i

export function notAMove(said?: string): string | null {
  const t = String(said ?? '').trim()
  if (!t) return null                       // nothing to judge; trust the call
  if (MOVES.test(t)) return null             // it does ask to go somewhere
  if (!EDITS.test(t)) return null            // no edit in it either; harmless
  return 'That sounded like a change to the song rather than a request to move the playhead — '
    + 'the bar is WHERE it should happen. Make the edit at that position instead, '
    + 'and use automate_parameter when a value has to be one thing in one place and something else later.'
}

/**
 * What did they mean by that parameter name?
 *
 * ⚠️ PEOPLE AND MODELS BOTH NAME THESE LOOSELY, and every loose name used to
 * land on a low-pass filter. The lane a person is looking at is labelled "VERB
 * Wet"; the tool calls it "reverb"; somebody speaking says "the wet". Those are
 * one parameter, and none of them is a filter.
 *
 * Returns a canonical name, or null — and null is a QUESTION, never a guess.
 */
export function automatableName(said: string): string | null {
  const t = String(said ?? '').toLowerCase().replace(/[^a-z]/g, '')
  if (!t) return null
  if (/^(volume|level|gain|loudness|vol)$/.test(t)) return 'volume'
  if (/^(pan|panning|balance)$/.test(t)) return 'pan'
  // "verb", "reverbwet", "wet" — the last is unambiguous here because delay's
  // amount is always said as "delay".
  if (t.includes('verb') || t === 'wet' || t === 'space') return 'reverb'
  if (t.includes('delay') || t.includes('echo')) return 'delay'
  if (t.includes('chorus')) return 'chorus'
  if (t.includes('drive') || t.includes('saturat') || t.includes('dist')) return 'drive'
  if (t.includes('highpass') || t.includes('hipass') || t === 'hpf') return 'highpass'
  if (t.includes('lowpass') || t.includes('lopass') || t === 'lpf'
    || t.includes('cutoff') || t === 'filter' || t === 'brightness') return 'lowpass'
  return null
}

const FX_AUTOMATABLE: Record<string, { type: 'reverb' | 'delay' | 'saturator' | 'chorus'; key: string; label: string }> = {
  reverb: { type: 'reverb', key: 'wet', label: 'Reverb' },
  delay: { type: 'delay', key: 'wet', label: 'Delay' },
  drive: { type: 'saturator', key: 'drive', label: 'Drive' },
  chorus: { type: 'chorus', key: 'mix', label: 'Chorus' },
}

export interface VoiceCall { name: string; input: Record<string, unknown> }

export interface VoicePlan {
  actions: unknown[]
  say: string
  problem?: string
  /**
   * A change left on the table, still under discussion (lib/voice/proposal.ts).
   *
   * The planner does not store it — it hands it back and the studio holds it,
   * so planning stays something you can do twice with the same answer. `null`
   * means the opposite: whatever was on the table is finished with.
   */
  proposal?: Proposal | null
  /**
   * A question, when the sentence named something the project holds more than
   * one of.
   *
   * Distinct from `problem`, which means the command cannot be carried out. An
   * `ask` means it can be carried out several ways and the studio declines to
   * pick — the actions are empty until someone answers.
   */
  ask?: VoiceAsk
}

/**
 * Where a spoken fraction of a filter sweep actually lands, in Hertz.
 *
 * The RANGE comes from lib/daw-effect-params, which is also what the track's
 * automation menu offers, so a sweep somebody speaks and one they draw by hand
 * mean the same thing. They were two copies for about an hour, which is exactly
 * long enough for a curve to drift.
 *
 * The CURVE is logarithmic because that is how a cutoff is heard: halfway
 * between 200 Hz and 18 kHz by ear is around 1.9 kHz, not 9 kHz. A linear sweep
 * spends most of its travel in the top octave, where almost nothing happens,
 * and then falls off a cliff at the end.
 */
const logRange = (r: { min: number; max: number }) => ({
  min: r.min,
  max: r.max,
  fromNorm: (n: number) =>
    Math.round(r.min * Math.pow(r.max / r.min, Math.max(0, Math.min(1, n)))),
})
const FILTER_HZ = {
  lowpass: logRange(LOWPASS_HZ),
  highpass: logRange(HIGHPASS_HZ),
} as const

/** A cutoff, said the way a person would say it. */
const fmtHz = (v: number): string =>
  (v >= 1000 ? `${(v / 1000).toFixed(1).replace(/\.0$/, '')} kHz` : `${Math.round(v)} Hz`)

const newId = () => (globalThis.crypto?.randomUUID?.() ?? `v${Math.random().toString(36).slice(2)}`)

/** Does a modulator route's key mean the parameter somebody named? */
function routeIsParam(routeParam: string, param: string, track: DawTrack): boolean {
  if (param === 'volume' || param === 'pan') return routeParam === param
  if (!routeParam.startsWith('fx:')) return false
  const [, effectId, key] = routeParam.split(':')
  const fx = (track.effects ?? []).find(e => e.id === effectId)
  if (!fx) return false
  if (FX_AUTOMATABLE[param]) {
    const spec = FX_AUTOMATABLE[param]
    return fx.type === spec.type || (fx.type === 'helios' && (fx.params as { unit?: { type?: string } })?.unit?.type === spec.type)
  }
  const kind = param === 'highpass' ? 'highpass' : 'lowpass'
  return fx.type === 'filter' && (fx.params as { type?: string })?.type === kind && key === 'frequency'
}

/** "low-pass cutoff", "volume", "reverb" — for a sentence about a route. */
function labelOfParam(routeParam: string | undefined, track: DawTrack): string {
  if (!routeParam) return 'parameter'
  if (routeParam === 'volume' || routeParam === 'pan') return routeParam
  const [, effectId, key] = routeParam.split(':')
  const fx = (track.effects ?? []).find(e => e.id === effectId)
  if (!fx) return key ?? 'parameter'
  if (fx.type === 'filter') return `${(fx.params as { type?: string })?.type === 'highpass' ? 'high' : 'low'}-pass cutoff`
  return fx.type
}
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const fail = (problem: string): VoicePlan => ({ actions: [], say: '', problem })

/**
 * Why an Apollo command cannot run here, and what would fix it.
 *
 * ⚠️ "I can't do that" with no reason is the answer that sends somebody hunting
 * for a bug in their own project. Every Apollo command shares this wording so
 * the explanation cannot drift between them.
 */
const notApollo = (name: string, type?: string): string =>
  `${name} is ${type === 'drum' ? 'a drum kit' : type === 'sampler' ? 'a sampler' : `a ${type ?? 'plain'} instrument`}, `
  + 'not Apollo. Put an Apollo instrument on it first.'

/**
 * Make the thing a dial belongs to audible, or say why it cannot be.
 *
 * ⚠️ THE LARGEST TRAP IN THE WHOLE APOLLO SURFACE. In a default patch 84 of the
 * 166 registered parameters sit behind an off switch: BOTH FILTERS ARE
 * DISABLED, so "cutoff to 800 hertz" — the commonest sentence anybody says to a
 * synth — wrote 800 Hz into a filter that was not running and answered "Pad
 * filter 1 cutoff: 800 Hz". Every one of those is a command that reports
 * success and changes nothing you can hear, which is worse than a refusal
 * because nothing tells you to look.
 *
 * Two remedies, and which one applies is a judgement about intent:
 *
 *   TURN IT ON when asking for the dial can only mean wanting to hear it. A
 *   filter, a layer, an oscillator, a scan, an LFO you just gave a rate in
 *   Hertz — nobody sets those meaning them to stay silent. This is the same
 *   rule set_apollo_layer and set_apollo_filter already follow.
 *
 *   SAY SO when making it audible would be a bigger decision than the one that
 *   was asked for. Switching an oscillator from wavetable to granular is a
 *   different instrument, not a louder one, and choosing a warp mode on
 *   somebody's behalf picks a sound they did not ask for. Those explain
 *   instead, and name what would fix it.
 */
/**
 * Turning the sub ON has to say WHICH NOTE it follows.
 *
 * Brae: "Audio cutting out again. It isn't slowing down or lagging. Is it the
 * computer trying to play every separate note in a piano roll?"
 *
 * ⚠️ Yes — and this is how a voice command causes it. The engine reads an
 * ABSENT `sub.ref` as 'each', which is one sub oscillator per voice. That is
 * deliberate: a patch saved before the option existed was voiced against
 * per-note subs, and changing it under those presets stripped their low end
 * (qa-synth caught the wavetable strings jumping from a 164 Hz centroid to
 * 994 Hz). So absent MUST keep meaning 'each' in the engine.
 *
 * But a sub that is being switched on right now has no voicing to preserve —
 * it was silent. And per-note is the wrong default for a piano roll: a triad
 * stacks three subs, the low end triples, and the master limiter (instant
 * attack, 0.98 ceiling, 120 ms release) clamps EVERYTHING down to a fraction
 * for a tenth of a second. That is not a click or a lag. It sounds exactly like
 * the audio cutting out, and the engine's own comment says so.
 *
 * So: only when turning it on from off, and only when the patch never expressed
 * a preference, pin it to 'lowest' — one sub, following the lowest note, which
 * is what a sub is musically for.
 */
function pinSubReference(patch: ApolloPatch, wasEnabled: boolean): void {
  if (wasEnabled) return          // an existing voicing is not ours to change
  if (!patch.sub || patch.sub.ref) return
  patch.sub.ref = 'lowest'
}

function makeAudible(patch: ApolloPatch, param: SpokenParam): string | null {
  const path = param.def.path
  const oscIdx = /^osc([012])\./.exec(path)?.[1]
  if (oscIdx != null) {
    const osc = patch.oscs?.[Number(oscIdx)]
    if (!osc) return null
    const label = `Oscillator ${Number(oscIdx) + 1}`
    // The engine gates two thirds of the registry. Switching it is a different
    // instrument, not a louder one — and with no sample loaded it is silence.
    const needs = /\.gran\./.test(path) ? 'granular'
      : /\.spec\./.test(path) ? 'spectral'
        : /\.smp\./.test(path) ? 'sample' : null
    if (needs && osc.engine !== needs) {
      return `${label} is a ${osc.engine} oscillator, and ${param.dial} belongs to the ${needs} engine. Switch it to ${needs} in Apollo first.`
    }
    const warp = /\.wt\.warp([12])\./.exec(path)?.[1]
    if (warp && osc.wt?.[`warp${warp}` as 'warp1']?.mode === 'off') {
      return `${label}'s warp ${warp} is off, so the amount would do nothing. Choose a warp first — sync, bend, PWM, FM, saturate.`
    }
    if (/\.wt\.specWarp\./.test(path) && (osc.wt?.specWarp?.mode ?? 'off') === 'off') {
      return `${label}'s spectral warp is off, so the amount would do nothing. Choose one first — stretch, shift, smear, low-pass.`
    }
    // A scan with no mode is the one gate worth opening: asking for a scan rate
    // or a start point is asking for the table to travel.
    if (/\.wt\.scan\./.test(path) && osc.wt?.scan && osc.wt.scan.mode === 'off') osc.wt.scan.mode = 'loop'
    osc.enabled = true
    return null
  }
  // ⚠️ Both filters ship DISABLED. This one line is the difference between the
  // most-said sentence in the app working and silently doing nothing.
  const f = /^f([12])\./.exec(path)?.[1]
  if (f && patch.filters?.[Number(f) - 1]) patch.filters[Number(f) - 1].enabled = true
  if (path.startsWith('sub.') && patch.sub) {
    pinSubReference(patch, patch.sub.enabled)
    patch.sub.enabled = true
  }
  if (path.startsWith('noise.') && patch.noise) patch.noise.enabled = true
  // A rate in Hertz is a request for a free-running LFO. While it is synced to
  // the tempo the rate field is not read at all.
  const lfo = /^lfo(\d+)\.rate$/.exec(path)?.[1]
  if (lfo && patch.lfos?.[Number(lfo) - 1]?.sync) patch.lfos[Number(lfo) - 1].sync = false
  return null
}



// ── "Not said" and "said but unreadable" are different answers ──────────────
//
// Brae: "It didn't change the reverb ... but instead created a lowpass cutoff
// that did the shape that I wanted." The same fault, one argument over: every
// place that read a position wrote `positionToBeat(pos(i.at), maps) ?? 0` (or
// `?? clip.startBeat`), so a position the model DID send but in a shape the
// app could not read — `{ marker: 'chorus' }`, `"bar 9"`, `"the chorus"` —
// quietly became the start of the song. "Added a crash at bar 1" was then a
// true sentence about the wrong thing, which is the worst kind of read-back:
// it looks like it did what was asked, and the person only finds out when
// they play it. The run_macro case already caught this ("a stretch that did
// not parse is a question, not a clip"); this makes every position and length
// go through the same door.
//
// Three outcomes, and the caller has to handle all three:
//   nothing was said        → beat: null, no problem — the command's own rule
//                             for "unstated" applies (a clip's own start, the
//                             whole song, a global tempo)
//   something readable      → the beat
//   something unreadable    → a problem, in words that say what WOULD read
//
// A name is readable too: "the chorus" IS a place in the song when a marker
// says where it is. That is resolution, not a default — it either finds the
// marker that was named or refuses out loud.
interface Placed { beat: number | null; problem?: string }

/** Anything that is a number, including a model's "9". */
const finite = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

/** A cue marker by name — "chorus", "the drop", "Chorus 2". */
function markerNamed(name: string, project: DawProject): { beat: number; name: string } | null {
  const want = foldName(name.replace(/^(the|at|to|from|until|till)\s+/i, ''))
  if (!want) return null
  const markers = project.cueMarkers ?? []
  const exact = markers.find(m => foldName(m.name ?? '') === want)
  if (exact) return { beat: exact.beat, name: exact.name ?? '' }
  const loose = markers.filter(m => foldName(m.name ?? '').includes(want))
  return loose.length === 1 ? { beat: loose[0].beat, name: loose[0].name ?? '' } : null
}

/** "bar 9", "bar 9 beat 3", "32 seconds", "the beginning" — the forms a model
 *  writes when it puts a position in a string instead of an object. */
function positionFromWords(text: string): MusicPosition | null {
  const t = text.toLowerCase().trim()
  if (/^(the\s+)?(beginning|start|top)$/.test(t)) return { bar: 1 }
  const bar = /^(?:at\s+)?(?:bar|measure)\s*(\d+(?:\.\d+)?)(?:\s*(?:,|beat)\s*(\d+(?:\.\d+)?))?$/.exec(t)
  if (bar) return { bar: Number(bar[1]), beat: bar[2] != null ? Number(bar[2]) : null }
  const sec = /^(?:at\s+)?(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds)$/.exec(t)
  if (sec) return { seconds: Number(sec[1]) }
  return null
}

function placeOf(v: unknown, maps: MusicMaps, project: DawProject, what = 'that'): Placed {
  if (v == null || v === '') return { beat: null }
  const cannot = (said: string): Placed => ({
    beat: null,
    problem: `I couldn't work out where "${said}" is — say a bar number like "bar 9", a time like "32 seconds", or the name of a section marker.`,
  })
  if (typeof v === 'string' || typeof v === 'number') {
    const said = String(v).trim()
    if (!said) return { beat: null }
    // A bare number is not a place: bar 9, beat 9 and 9 seconds are three
    // different places, and picking one would be exactly the guess this exists
    // to refuse.
    if (finite(said) != null) return cannot(said)
    const marker = markerNamed(said, project)
    if (marker) return { beat: marker.beat }
    const parsed = positionFromWords(said)
    if (parsed) { const b = positionToBeat(parsed, maps); return b == null ? cannot(said) : { beat: b } }
    return cannot(said)
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    const coerced: MusicPosition = {
      bar: finite(o.bar), beat: finite(o.beat), seconds: finite(o.seconds), beats: finite(o.beats),
    }
    const b = positionToBeat(coerced, maps)
    if (b != null) return { beat: b }
    // { marker: 'chorus' }, { section: 'drop' }, { name: 'Verse 2' }: a place
    // by name, in a field the schema never advertised. Read rather than
    // refused, because it names something real.
    const named = [o.marker, o.section, o.name, o.at, o.bar, o.position].find(x => typeof x === 'string' && x.trim())
    if (typeof named === 'string') {
      const marker = markerNamed(named, project)
      if (marker) return { beat: marker.beat }
      const parsed = positionFromWords(named)
      if (parsed) { const b2 = positionToBeat(parsed, maps); if (b2 != null) return { beat: b2 } }
      return cannot(named)
    }
    return cannot(JSON.stringify(v).slice(0, 40))
  }
  return cannot(what)
}

/** A length, with the same three outcomes. Null with no problem means nothing
 *  was said, and the command's own rule for an unstated length applies. */
interface Spanned {
  beats: number | null
  /** The duration as understood, in the unit it was said in — for the read-back. */
  said?: MusicDuration
  problem?: string
}

function spanOf(v: unknown, atBeat: number, maps: MusicMaps): Spanned {
  if (v == null || v === '') return { beats: null }
  const cannot = (said: string): Spanned => ({
    beats: null,
    problem: `I couldn't read the length "${said}" — say it like "2 bars", "4 beats" or "8 seconds".`,
  })
  if (typeof v === 'string' || typeof v === 'number') {
    const said = String(v).trim()
    if (!said) return { beats: null }
    if (finite(said) != null) return cannot(said)
    const m = /^(?:for\s+|over\s+)?(\d+(?:\.\d+)?|a|an|one|two|three|four|six|eight)\s*(bars?|measures?|beats?|s|secs?|seconds?)$/i.exec(said)
    if (!m) return cannot(said)
    const n = spokenNumber(m[1])
    if (n == null) return cannot(said)
    const unit = m[2].toLowerCase()
    const d: MusicDuration = unit.startsWith('bar') || unit.startsWith('measure') ? { bars: n }
      : unit.startsWith('beat') ? { beats: n } : { seconds: n }
    const b = durationToBeats(d, atBeat, maps)
    return b == null ? cannot(said) : { beats: b, said: d }
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    const d: MusicDuration = { bars: finite(o.bars), beats: finite(o.beats), seconds: finite(o.seconds) }
    const b = durationToBeats(d, atBeat, maps)
    if (b != null) return { beats: b, said: d }
    return cannot(JSON.stringify(v).slice(0, 40))
  }
  return cannot(String(v))
}

/**
 * Every clip anybody can name — the arrangement's AND the session grid's.
 *
 * ⚠️ Slots used to be invisible here, so "reverse the drum loop slot" found
 * nothing while the same words worked on an arrangement clip. They are clips
 * with names, and the reducer now answers clip-shaped actions wherever the clip
 * lives (lib/daw-state.ts), so there is nothing left to keep them out.
 */
const allClips = (p: DawProject): DawClip[] => [...(p.arrangementClips ?? []), ...sessionClips(p)]

/**
 * The name to hand an ordinary tool call, given what somebody said. A track
 * wins over a clip of the same name, as everywhere else; when neither is found
 * the words are passed on unchanged so the inner call can decline in its own
 * voice rather than this one guessing.
 */
function resolveTrackOrClipName(spoken: string, p: DawProject): string | null {
  const track = resolveTrack(spoken, p)
  if (track) return track.name ?? spoken
  const clip = resolveClip(spoken, p)
  return clip ? (clip.clip.name ?? spoken) : null
}

/** Where a named track or clip lives, in beats — for playing a change back where it happens. */
function spanOfTargetFor(name: string, p: DawProject): { start: number; end: number } | null {
  const want = foldName(name)
  const clips = (p.arrangementClips ?? []).filter(c => {
    if (foldName(c.name ?? '') === want) return true
    const track = (p.tracks ?? []).find(t => t.id === c.trackId)
    return foldName(track?.name ?? '') === want
  })
  if (!clips.length) return null
  return { start: Math.min(...clips.map(c => c.startBeat)), end: Math.max(...clips.map(c => c.startBeat + c.durationBeats)) }
}

/** Where the song stops, so a playback span never runs off the end of it. */
function songEndBeat(p: DawProject): number {
  const clips = p.arrangementClips ?? []
  return clips.length ? Math.max(...clips.map(c => c.startBeat + c.durationBeats)) : 16
}

/** The session grid's clips, in track then scene order. */
export function sessionClips(p: Pick<DawProject, 'sessionGrid'>): DawClip[] {
  const out: DawClip[] = []
  for (const row of Object.values(p.sessionGrid ?? {})) for (const c of row ?? []) if (c) out.push(c)
  return out
}

/**
 * The effects a spoken command can reach, and how to build one.
 *
 * Deliberately a short list. Every entry here is an effect somebody asks for by
 * name in ordinary speech ("put some reverb on it"); the rest of the rack is
 * reached by hand, where the parameter that matters can actually be seen.
 */
const EFFECT_DEFAULTS: Partial<Record<EffectType, () => TrackEffect['params']>> = {
  reverb: defaultReverb, delay: defaultDelay, filter: defaultFilter,
  compressor: defaultCompressor, saturator: defaultSaturator,
  chorus: defaultChorus, eq3: defaultEq3, limiter: defaultLimiter,
}

/**
 * What a spoken effect name builds.
 *
 * ⚠️ The short list above was the ONLY thing a spoken "put an X on it" could
 * make, so every device added since — the Apollo units especially — could be
 * named by the model and then refused by the planner. This reads the same
 * catalogue the Add Device menu does, so the two cannot drift: an Apollo name
 * ('phaser', 'octaver') builds the 'helios' wrapper the menu builds, and a
 * Beacon name builds its own defaults.
 */
/**
 * The words people use for devices whose type has a different spelling.
 *
 * ⚠️ Eight devices Beacon already had were unreachable by voice because the
 * lookup wanted their exact type: nobody says "noisegate", "deesser" or
 * "redux". The refusal read as "we don't have a gate", which is the wrong
 * lesson entirely.
 */
const DEVICE_ALIASES: Record<string, string> = {
  gate: 'noisegate', 'noise gate': 'noisegate',
  'de-ess': 'deesser', deess: 'deesser', 'de-esser': 'deesser', esser: 'deesser', sibilance: 'deesser',
  bitcrush: 'redux', 'bit crush': 'redux', crush: 'redux', lofi: 'redux', 'lo-fi': 'redux',
  multiband: 'multibandcomp', 'multiband compressor': 'multibandcomp',
  'transient shaper': 'transientshaper', transient: 'transientshaper', punch: 'transientshaper',
  'dynamic eq': 'dyneq',
  'auto pan': 'autopan', autopan: 'autopan', panner: 'autopan',
  duck: 'unmask', ducker: 'unmask', sidechain: 'unmask',
  width: 'utility', stereo: 'utility', trim: 'utility', gain: 'utility',
  eq: 'eq3', equaliser: 'eq3', equalizer: 'eq3',
  saturation: 'saturator', warmth: 'saturator', drive: 'saturator', tape: 'saturator',
  comp: 'compressor', compression: 'compressor',
  flanger: 'chorus', verb: 'reverb', echo: 'delay',
  limit: 'limiter', maximiser: 'limiter', maximizer: 'limiter',
}

function buildSpokenEffect(rawName: string): { type: EffectType; params: TrackEffect['params'] } | null {
  const name = DEVICE_ALIASES[rawName.toLowerCase().trim()] ?? rawName
  const apollo = APOLLO_ADD_OPTIONS.find(o => o.fx === name)
  if (apollo) return { type: 'helios', params: makeDefaultParams('helios', apollo.fx) as TrackEffect['params'] }
  const beacon = ADD_OPTIONS.find(o => o.type === name)
  if (!beacon) return null
  const make = EFFECT_DEFAULTS[beacon.type]
  return {
    type: beacon.type,
    params: (make ? make() : makeDefaultParams(beacon.type)) as TrackEffect['params'],
  }
}

/**
 * The sound-shaping fields an effect BAR can dial, and what a percentage means
 * for each.
 *
 * Taken from the same set the piano-roll FX cascade uses, so a bar made by
 * speaking is the same object as one drawn by hand. Only the fields worth
 * naming out loud are here — the full list runs to dozens, most of which nobody
 * asks for by name.
 *
 * Each carries its own mapping because a percentage means something different
 * per field: a filter sweeps logarithmically over a range where the top is
 * "off", drive is already a fraction, and gain is a multiplier around unity.
 */
/**
 * The plain words for these fields.
 *
 * ⚠️ A model reads the schema and mostly uses the field names, but it says
 * "lowpass" often enough that refusing it is a real failure — and the refusal
 * ("I don't know how to shape lowpass") reads like the feature is missing
 * rather than like the word was wrong.
 */
const CLIP_FX_ALIASES: Record<string, string> = {
  lowpass: 'filterHz', 'low-pass': 'filterHz', 'low pass': 'filterHz',
  filter: 'filterHz', cutoff: 'filterHz', lpf: 'filterHz',
  highpass: 'highpassHz', 'high-pass': 'highpassHz', 'high pass': 'highpassHz', hpf: 'highpassHz',
  reverb: 'reverbWet', wet: 'reverbWet', space: 'reverbWet',
  delay: 'delayWet', echo: 'delayWet',
  crush: 'bitcrush', 'bit crush': 'bitcrush', lofi: 'bitcrush',
  saturation: 'drive', warmth: 'drive', overdrive: 'drive',
  volume: 'gain', level: 'gain',
}

const CLIP_FX_FIELDS: Record<string, { key: string; label: string; at: (unit: number) => number }> = {
  filterHz: { key: 'filterHz', label: 'Low-pass', at: u => Math.round(200 * Math.pow(90, 1 - u)) },
  highpassHz: { key: 'highpassHz', label: 'High-pass', at: u => Math.round(20 * Math.pow(100, u)) },
  drive: { key: 'drive', label: 'Drive', at: u => u },
  distortion: { key: 'distortion', label: 'Distortion', at: u => u },
  bitcrush: { key: 'bitcrush', label: 'Bitcrush', at: u => u },
  reverbWet: { key: 'reverbWet', label: 'Reverb', at: u => u },
  delayWet: { key: 'delayWet', label: 'Delay', at: u => u },
  gain: { key: 'gain', label: 'Level', at: u => 0.5 + u * 1.5 },
}

/**
 * "More reverb" means different things to different effects.
 *
 * There is no shared "amount" parameter, and pretending otherwise would set a
 * field that does not exist and report success. So each effect says which of
 * its own parameters the word maps to: the wet/dry mix for the ones people
 * think of as an amount, drive for saturation, cutoff for a filter — where
 * "more" sensibly means "more open" rather than "more filtered".
 */
/**
 * What an effect's amount currently IS, as a percentage — the mirror of
 * applyAmount, or null where the amount is not a single readable number.
 *
 * ⚠️ SO THAT "DONE" MEANS SOMETHING. Brae asked for reverb to stay at 100% until
 * bar 6; it was already at 100%, and the studio answered "Reverb at 100%" —
 * which reads exactly like success. Nothing had changed, and the request (a
 * shape over time) had been missed entirely. A report that cannot tell those
 * apart hides the failure it is describing.
 */
function readAmount(params: Record<string, unknown>, kind: EffectType): number | null {
  const pct = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) : null
  switch (kind) {
    case 'reverb': case 'delay': return pct(params.wet)
    case 'chorus': return pct(params.mix)
    case 'saturator': return pct(params.drive)
    // Everything else maps its amount onto a curve (a frequency, a ratio) where
    // the inverse is not exact. Returning null means "cannot tell", and the
    // caller reports the edit normally rather than guessing at a no-op.
    default: return null
  }
}

function applyAmount(params: Record<string, unknown>, kind: EffectType, pct: number): void {
  const unit = Math.max(0, Math.min(1, pct / 100))
  switch (kind) {
    case 'reverb': case 'delay': params.wet = unit; break
    case 'chorus': params.mix = unit; break
    case 'saturator': params.drive = unit; break
    // ⚠️ THIS IS THE ONE THAT SILENCED THE PAD. It was
    //     params.frequency = Math.round(20 * Math.pow(1000, unit))
    // which is wrong twice over.
    //
    // (1) THE FLOOR WAS 20 Hz. That is not a dark filter, it is silence — and
    //     it was reachable from ordinary numbers, not just from 0: any amount
    //     up to about 30% lands below 200 Hz (10% → 40 Hz, 25% → 112 Hz), and
    //     below 200 Hz a low-pass has removed everything anybody can hear. The
    //     sweep command already knew this and used LOWPASS_HZ, whose bottom is
    //     200 Hz for exactly this reason; this path never got the same fix.
    //
    // (2) IT RAN BACKWARDS. Every other case here reads "more amount, more
    //     effect" — 100% reverb is drenched. 100% filter meant 20 kHz, i.e.
    //     NO filtering, while a small number meant almost total removal. So
    //     "put a bit of a low-pass on the pad" was the request most likely to
    //     make it disappear, and "give it loads of low-pass" did nothing.
    //     CLIP_FX_FIELDS.filterHz in this same file already has it the right
    //     way round; the two now agree.
    //
    // The range is the shared one, so a filter set by percentage, swept by
    // voice, or drawn by hand all live between the same two frequencies — and
    // 100% is now as dark as the studio goes while STILL BEING AUDIBLE.
    case 'filter': {
      const highpass = (params.type as string) === 'highpass'
      const r = highpass ? HIGHPASS_HZ : LOWPASS_HZ
      // A low-pass filters more as it comes DOWN; a high-pass as it goes UP.
      const u = highpass ? unit : 1 - unit
      params.frequency = Math.round(r.min * Math.pow(r.max / r.min, u))
      break
    }
    case 'compressor': case 'limiter': params.threshold = Math.round(-60 + unit * 60); break
    case 'eq3': params.midGain = Math.round(-12 + unit * 24); break
    default: break
  }
}

function mapsOf(p: DawProject): MusicMaps {
  return musicMaps({
    tempo: p.tempo,
    timeSignatureNum: p.timeSignatureNum,
    timeSignatureDen: p.timeSignatureDen,
    tempoMarkers: (p as { tempoMarkers?: { id: string; beat: number; tempo: number }[] }).tempoMarkers,
    meterMarkers: (p as { meterMarkers?: { id: string; beat: number; num: number; den: number }[] }).meterMarkers,
  })
}

/**
 * Find the clip someone named.
 *
 * A clip can be named directly, or by its TRACK — and people say the track far
 * more often, so a track match falls through to that track's clips. With
 * several, the earliest is the one they mean, because that is the one in front
 * of them when they say "loop it".
 */
/**
 * Every clip the spoken words could plausibly mean.
 *
 * Two routes to a clip and they overlap: by the clip's own name, and by its
 * TRACK's name — people say the track far more often. When both routes hit, or
 * when the named track holds several clips, there is genuinely more than one
 * answer, and the old code resolved that by order: clips before tracks, and the
 * earliest clip on a track. Right often enough to be trusted, wrong often
 * enough to matter, and silent either way.
 *
 * So all of them come back, and the caller asks.
 */
function clipCandidates(
  spoken: string,
  p: DawProject,
  maps: MusicMaps,
): { clip: DawClip; how: string; label: string; keywords: string[]; namedDirectly: boolean }[] {
  const out: { clip: DawClip; how: string; label: string; keywords: string[]; namedDirectly: boolean }[] = []
  const seen = new Set<string>()
  const where = (c: DawClip) => describeBeat(c.startBeat, maps)

  // ── Track and item together — "Bass body 1" ──────────────────────────────
  //
  // Brae: "'add a descending filter to Bass body 1' … 'Bass (track) body 1
  // (item)'."
  //
  // This is how people disambiguate without being asked, and it was the one
  // form the studio could not read: it looked for a clip called "bass body 1"
  // and a track called "bass body 1", found neither, and either failed or
  // stopped to ask a question the speaker had already answered.
  //
  // Tried FIRST, because naming both is the most specific thing anybody can do
  // and there is nothing left to be ambiguous about once it matches.
  const spokenFolded = foldName(spoken)
  if (spokenFolded) {
    for (const track of p.tracks ?? []) {
      const tName = foldName(track.name ?? '')
      if (!tName || !spokenFolded.startsWith(`${tName} `)) continue
      const rest = spokenFolded.slice(tName.length).trim()
      if (!rest) continue
      const onTrack = allClips(p).filter(c => c.trackId === track.id)
      const hit = findByName(rest, onTrack as unknown as { id: string; name?: string }[])
      if (!hit || hit.score < 0.6) continue
      const clip = onTrack.find(c => c.id === hit.item.id)
      if (!clip) continue
      seen.add(clip.id)
      out.push({
        clip,
        how: `"${clip.name ?? clip.id}" on "${track.name}"`,
        label: `${clip.name ?? 'the clip'} on ${track.name}`,
        keywords: ['clip', 'item', where(clip), String(clip.name ?? '').toLowerCase()],
        namedDirectly: true,
      })
      // Named both halves: there is exactly one thing this can mean.
      return out
    }
  }

  // Named directly — "the bass clip".
  const byClip = findByName(spoken, allClips(p) as unknown as { id: string; name?: string }[])
  if (byClip) {
    const clip = allClips(p).find(c => c.id === byClip.item.id)
    if (clip) {
      seen.add(clip.id)
      out.push({
        clip,
        how: `"${clip.name ?? clip.id}"`,
        label: `the ${clip.name ?? 'clip'} clip at ${where(clip)}`,
        keywords: ['clip', 'item', where(clip), String(clip.name ?? '').toLowerCase()],
        namedDirectly: true,
      })
    }
  }

  // Named by its track — "the bass", meaning what is on the bass track.
  const byTrack = findByName(spoken, p.tracks as unknown as { id: string; name?: string }[])
  if (byTrack) {
    const track = p.tracks.find(x => x.id === byTrack.item.id)
    const onTrack = allClips(p)
      .filter(c => c.trackId === byTrack.item.id)
      .sort((a, b) => a.startBeat - b.startBeat)
    for (const clip of onTrack) {
      if (seen.has(clip.id)) continue
      seen.add(clip.id)
      out.push({
        clip,
        how: onTrack.length === 1
          ? `the clip on "${track?.name ?? ''}"`
          : `the clip at ${where(clip)} on "${track?.name ?? ''}"`,
        label: onTrack.length === 1
          ? `the ${track?.name ?? ''} track`
          : `the one at ${where(clip)} on ${track?.name ?? ''}`,
        keywords: ['track', where(clip), String(track?.name ?? '').toLowerCase()],
        namedDirectly: false,
      })
    }
  }
  return out
}

/**
 * The clip they meant, or the question to ask instead.
 *
 * `ask` and `clip` are never both set: either it is settled or it is not.
 */
function resolveClipOrAsk(
  spoken: string,
  p: DawProject,
  maps: MusicMaps,
  verb: string,
  rest: Record<string, unknown> = {},
): { clip?: DawClip; how?: string; ask?: VoiceAsk } {
  // An answer to a question this function asked, carrying the id of the clip
  // that was chosen. It must NOT be resolved by name again: re-entering the
  // lookup lands in the same ambiguity that produced the question, so the
  // answer would be met with the question a second time.
  const direct = resolveClip(spoken, p)
  if (spoken.startsWith('#')) return direct ? { clip: direct.clip, how: direct.how } : {}

  const found = clipCandidates(spoken, p, maps)
  if (!found.length) return {}
  if (found.length === 1) return { clip: found[0].clip, how: found[0].how }

  // ── Shape the question ───────────────────────────────────────────────────
  //
  // Brae's example is a binary — "the bass track, or the bass item on the bass
  // track at bar 15?" — and that is the right shape, because the two are
  // different KINDS of answer. Listing the named clip alongside every clip on
  // the track produced three options of which two were both "the track", so
  // answering "the track" tied them and the question was asked again. A
  // question whose obvious answer is not accepted is worse than no question.
  //
  // So: a name collision asks which THING was meant, and the track's own answer
  // is its first clip — the same one it would have used all along. Several
  // clips with no collision is a different question, asking which ONE, and
  // there the bar is the only thing that distinguishes them.
  const named = found.find(c => c.namedDirectly)
  const onTrack = found.filter(c => !c.namedDirectly)
  const call = (clip: DawClip) => [{ name: verb, input: { ...rest, target: `#${clip.id}` } }]

  const options: AskOption[] = named && onTrack.length
    ? [
      { label: named.label, calls: call(named.clip), keywords: named.keywords },
      {
        label: `the ${trackNameOf(onTrack[0].clip, p) ?? ''} track`,
        calls: call(onTrack[0].clip),
        keywords: ['track', String(trackNameOf(onTrack[0].clip, p) ?? '').toLowerCase()],
      },
    ]
    : [
      // ── "All of them" comes first, because it is usually the answer ──────
      //
      // "Take the bass up three semitones" almost always means the bass PART,
      // not one clip of it. Offering only the individual clips made the studio
      // ask a question whose real answer was not on the list, which is a worse
      // failure than not asking: the person has to pick something they did not
      // mean, or start again.
      //
      // It is one option producing several calls — planVoiceCalls already
      // applies a list — so nothing downstream needs to know this happened.
      ...(onTrack.length > 1
        ? [{
          // "all 2 clips" is not something anyone says. This is read aloud.
          label: onTrack.length === 2
            ? `both clips on ${trackNameOf(onTrack[0].clip, p) ?? ''}`
            : `all ${onTrack.length} clips on ${trackNameOf(onTrack[0].clip, p) ?? ''}`,
          calls: onTrack.map(c => ({ name: verb, input: { ...rest, target: `#${c.clip.id}` } })),
          keywords: ['all', 'everything', 'both', 'whole', 'track', 'them'],
        }]
        : []),
      ...found.slice(0, 4).map(c => ({
        label: c.label,
        calls: call(c.clip),
        keywords: c.keywords,
      })),
    ]

  // Only offer the rename when the confusion is a NAME collision — a clip
  // called "bass" sitting on a track called "Bass". Several clips on one track
  // is not a naming mistake and there is nothing to fix, so offering would be
  // noise.
  const collision = found.find(c => c.namedDirectly)
  const offer: VoiceAsk['offer'] = collision && found.some(c => !c.namedDirectly)
    ? {
      speak: `That name is on both. Would you like to rename the clip at ${describeBeat(collision.clip.startBeat, maps)} to avoid the confusion?`,
      prompt: 'What would you like to call it?',
      call: { name: 'rename_clip', input: { target: `#${collision.clip.id}` }, field: 'name' },
    }
    : undefined

  return {
    ask: {
      speak: options.length > 3
        // Reading five options aloud is not a question, it is a list nobody
        // will hold in their head. Past three, the first two are offered and
        // the rest are on screen.
        ? `Do you mean ${options[0].label}, ${options[1].label}, or one of the others?`
        : `Do you mean ${options.map(o => o.label).join(', or ')}?`,
      options,
      offer,
    },
  }
}

/** The name of the track a clip sits on. */
function trackNameOf(clip: DawClip, p: DawProject): string | undefined {
  return (p.tracks ?? []).find(t => t.id === clip.trackId)?.name
}

/**
 * The set of clips a call names, or null when it names exactly one thing the
 * ordinary resolver should handle (with its ambiguity question).
 *
 * A set is meant when the call says `all`, gives a `which`, a place, or a
 * length filter — or when the spoken target itself carries "all" / an ordinal
 * ("all the pad intro parts", "pad intro part 3", "the third pad clip").
 */
/** "#sel:id,id" — the studio's selection, carried as ids so it is never re-resolved by name. */
function selectionIds(target: string, i: Record<string, unknown>, heard?: VoiceContext): string[] | null {
  if (target.startsWith('#sel:')) return target.slice(5).split(',').filter(Boolean)
  const t = target.toLowerCase().trim()
  const saysSelection = i.selected === true
    || /^(?:the\s+)?(?:selection|selected(?:\s+(?:clips?|items?|parts?|ones?))?|these(?:\s+(?:clips?|items?|parts?|ones?))?|those(?:\s+(?:clips?|items?|parts?|ones?))?|them|it|this)$/.test(t)
  if (saysSelection && heard?.selectedClipIds?.length) return heard.selectedClipIds
  return null
}

function clipAddressOf(i: Record<string, unknown>, target: string, maps: MusicMaps, project: DawProject, heard?: VoiceContext): ClipAddress | null {
  // ── The selection ──────────────────────────────────────────────────────
  // "delete them", "colour these blue", "move the selected clips back a
  // bar": the ids of what is selected, narrowed by anything else said.
  const ids = selectionIds(target, i, heard)
  const parsed = ids ? { name: '', which: undefined as ClipAddress['which'] } : parseClipAddress(target)
  const whichIn = i.which
  const which: ClipAddress['which'] | undefined =
    i.all === true ? 'all'
      : whichIn === 'all' || whichIn === 'first' || whichIn === 'last' ? whichIn
        : typeof whichIn === 'number' ? whichIn
          : typeof whichIn === 'string' && /^\d+$/.test(whichIn) ? Number(whichIn)
            : Array.isArray(whichIn) ? (whichIn as unknown[]).map(Number).filter(n => Number.isFinite(n))
              : parsed.which
  const at = i.at != null ? placeOf(i.at, maps, project) : null
  const shorter = i.shorterThan != null ? spanOf(i.shorterThan, 0, maps) : null
  const longer = i.longerThan != null ? spanOf(i.longerThan, 0, maps) : null
  const after = i.after != null ? placeOf(i.after, maps, project) : null
  const before = i.before != null ? placeOf(i.before, maps, project) : null
  // "in the chorus": from its marker to the next one.
  const section = typeof i.section === 'string' && i.section.trim() ? i.section.trim() : undefined
  const track = typeof i.track === 'string' && i.track.trim() ? i.track.trim() : undefined
  const filtered = at?.beat != null || shorter?.beats != null || longer?.beats != null || after?.beat != null || before?.beat != null || !!section || !!track
  // ⚠️ "Bass 2" is a track, not the second Bass: a trailing number is only an
  // ordinal when the name without it exists on its own.
  const trailingIsName = typeof parsed.which === 'number' && !addressClips(project, { name: parsed.name }).length
  if (!ids && (which === undefined || (trailingIsName && !filtered && i.all !== true))) {
    if (!filtered) return null
  }
  return {
    ids: ids ?? undefined,
    name: trailingIsName ? target : parsed.name,
    track,
    which: trailingIsName ? undefined : which,
    at: at?.beat ?? undefined,
    shorterThan: shorter?.beats ?? undefined,
    longerThan: longer?.beats ?? undefined,
    after: after?.beat ?? undefined,
    before: before?.beat ?? undefined,
    section,
  }
}

/**
 * The clips a command edits: a set when the words name one ("all the pad
 * parts", "them"), otherwise the one clip — or the question, when the one
 * clip is ambiguous.
 */
function clipsForEdit(
  i: Record<string, unknown>, target: string, maps: MusicMaps, project: DawProject,
  heard: VoiceContext | undefined, verb: string, rest: Record<string, unknown> = {},
): { clips: DawClip[]; how: string; ask?: VoiceAsk } {
  const addr = clipAddressOf(i, target, maps, project, heard)
  if (addr) {
    const set = addressClips(project, addr)
    return { clips: set, how: set.length === 1 ? clipLabel(project, set[0]) : `${set.length} clips ${describeAddress(addr, maps)}` }
  }
  const chosen = resolveClipOrAsk(target, project, maps, verb, rest)
  if (chosen.ask) return { clips: [], how: '', ask: chosen.ask }
  return { clips: chosen.clip ? [chosen.clip] : [], how: chosen.how ?? '' }
}

type PickedPart = {
  notes: MidiClip['notes']; label: string; startBeat: number; endBeat: number; chords?: Chord[]
  /** True when nothing inside the clip was named — every note. */
  whole: boolean
}

/**
 * The notes inside a clip that a command names — "the first chord", "the
 * third note", "the notes above C5", "the chord at bar 3" — or every note
 * when nothing inside it was named.
 *
 * ⚠️ THE RECORD, 23:37: "the 1st chord in pad intro" → all fourteen notes.
 * A chord is a moment when two or more notes start together; see
 * lib/note-address.ts.
 */
function pickNotes(clip: MidiClip, i: Record<string, unknown>, maps: MusicMaps, project: DawProject): PickedPart | { problem: string } {
  const said = str(i.notes).trim()
  const parsed = said ? parseNoteAddress(said) : null
  const all = clip.notes ?? []
  if (!parsed) return { notes: all, label: 'the notes', startBeat: 0, endBeat: clip.durationBeats, whole: true }
  const addr: NoteAddress = { ...parsed.addr }
  const rel = (p: Placed): number | null => (p.beat == null ? null : p.beat - clip.startBeat)
  if (parsed.atSaid) { const p = placeOf(parsed.atSaid, maps, project); if (p.problem) return { problem: p.problem }; const b = rel(p); if (b != null) addr.at = b }
  if (parsed.fromSaid) { const p = placeOf(parsed.fromSaid, maps, project); if (p.problem) return { problem: p.problem }; const b = rel(p); if (b != null) addr.from = b }
  if (parsed.toSaid) { const p = placeOf(parsed.toSaid, maps, project); if (p.problem) return { problem: p.problem }; const b = rel(p); if (b != null) addr.to = b }
  if (parsed.atSeconds != null) { const s = spanOf({ seconds: parsed.atSeconds }, clip.startBeat, maps); if (s.beats != null) addr.at = s.beats }
  let picked = addressNotes(all, addr)
  let label = parsed.label
  // "The first chord" of a part that has no chords is its first note — a
  // melody's opening, which is what anybody pointing at it means.
  if (!picked.notes.length && (addr.chord === 'first' || addr.chord === 1) && addr.note == null) {
    picked = addressNotes(all, { ...addr, chord: undefined, note: 'first' })
    if (picked.notes.length) label = 'the first note (there is no chord)'
  }
  return { notes: picked.notes, label, startBeat: picked.startBeat, endBeat: picked.endBeat, chords: picked.chords, whole: false }
}

/**
 * A set of tracks, when the words name one — "all the drum tracks", "every
 * muted track", "the tracks with reverb" — or the selection's tracks.
 */
function trackAddressOf(i: Record<string, unknown>, target: string, project: DawProject, heard?: VoiceContext): TrackAddress | null {
  if (target.startsWith('#sel:')) {
    const ids = target.slice(5).split(',').filter(Boolean)
    const trackIds = [...new Set(allClips(project).filter(c => ids.includes(c.id)).map(c => c.trackId))]
    return trackIds.length ? { ids: trackIds } : null
  }
  const t = target.toLowerCase().trim()
  if (/^(?:the\s+)?(?:selected tracks?|these tracks?|those tracks?)$/.test(t) && heard?.selectedClipIds?.length) {
    const ids = heard.selectedClipIds
    const trackIds = [...new Set(allClips(project).filter(c => ids.includes(c.id)).map(c => c.trackId))]
    if (heard.selectedTrackId && !trackIds.includes(heard.selectedTrackId)) trackIds.push(heard.selectedTrackId)
    return trackIds.length ? { ids: trackIds } : null
  }
  const only = Array.isArray(i.only) ? (i.only as unknown[]).map(x => String(x).toLowerCase()) : typeof i.only === 'string' ? [i.only.toLowerCase()] : []
  const except = Array.isArray(i.except) ? (i.except as unknown[]).map(x => String(x)) : typeof i.except === 'string' ? [i.except] : []
  const withEffect = typeof i.withEffect === 'string' && i.withEffect.trim() ? i.withEffect.trim() : undefined
  const explicit = i.all === true || only.length > 0 || except.length > 0 || !!withEffect
  const parsed = parseTrackAddress(target)
  if (!explicit && !parsed) return null
  const addr: TrackAddress = { ...(parsed ?? {}) }
  if (i.all === true) addr.all = true
  if (only.length) addr.only = [...new Set([...(addr.only ?? []), ...only.map(o => TRACK_WORDS[o] ?? TRACK_WORDS[o.replace(/s$/, '')] ?? o)])] as TrackAddress['only']
  if (except.length) addr.except = [...(addr.except ?? []), ...except]
  if (withEffect) addr.withEffect = withEffect
  if (explicit && !parsed && !addr.name) {
    const name = t.replace(/^(?:the|all|every|each)\s+/, '').replace(/\s+tracks?$/, '').trim()
    if (name && !/^(?:tracks?|everything|all|every|each|them|these|those)$/.test(name)) addr.name = name
  }
  return addr
}

function describeTrackAddress(a: TrackAddress): string {
  const parts: string[] = []
  if (a.ids) parts.push('selected')
  if (a.name) parts.push(`called "${a.name}"`)
  if (a.only?.length) parts.push(`that are ${a.only.join(' and ')}`)
  if (a.withEffect) parts.push(`with ${a.withEffect}`)
  if (a.except?.length) parts.push(`except ${a.except.join(' and ')}`)
  return parts.join(' ') || 'like that'
}

function describeAddress(a: ClipAddress, maps: MusicMaps): string {
  const parts: string[] = []
  if (a.name) parts.push(`named "${a.name}"`)
  if (a.ids) parts.push(a.ids.length === 1 ? '(selected)' : `(the ${a.ids.length} selected)`)
  if (a.track) parts.push(`on ${a.track}`)
  if (a.section) parts.push(`in the ${a.section}`)
  if (a.which === 'first') parts.push('(the first)')
  else if (a.which === 'last') parts.push('(the last)')
  else if (typeof a.which === 'number') parts.push(`(number ${a.which})`)
  if (a.at != null) parts.push(`at ${describeBeat(a.at, maps)}`)
  if (a.after != null) parts.push(`from ${describeBeat(a.after, maps)}`)
  if (a.before != null) parts.push(`before ${describeBeat(a.before, maps)}`)
  if (a.shorterThan != null) parts.push(`shorter than ${+a.shorterThan.toFixed(2)} beats`)
  if (a.longerThan != null) parts.push(`longer than ${+a.longerThan.toFixed(2)} beats`)
  return parts.join(' ') || 'like that'
}

function resolveClip(spoken: string, p: DawProject): { clip: DawClip; how: string } | null {
  // An id, handed back when a question is answered: the choice was made against
  // a specific clip and must not be re-resolved by name, or answering the
  // question would land in the same ambiguity that prompted it.
  if (spoken.startsWith('#sel:')) {
    // The selection, several clips: a one-clip command takes the first.
    const ids = spoken.slice(5).split(',').filter(Boolean)
    const clip = allClips(p).find(c => ids.includes(c.id))
    return clip ? { clip, how: ids.length > 1 ? `"${clip.name ?? clip.id}" (the first of ${ids.length} selected)` : `"${clip.name ?? clip.id}"` } : null
  }
  if (spoken.startsWith('#')) {
    const clip = allClips(p).find(c => c.id === spoken.slice(1))
    return clip ? { clip, how: `"${clip.name ?? clip.id}"` } : null
  }
  const found = clipCandidates(spoken, p, mapsOf(p))
  return found.length ? { clip: found[0].clip, how: found[0].how } : null
}

function resolveTrack(spoken: string, p: DawProject): DawTrack | null {
  const m = findByName(spoken, p.tracks as unknown as { id: string; name?: string }[])
  return m ? (p.tracks.find(t => t.id === m.item.id) ?? null) : null
}

/** What the microphone reported, when the sentence came from one.
 *
 *  ⚠️ Only the beat needs this, and only because the model cannot carry it: an
 *  assistant relays WORDS, and a spoken rhythm is entirely a question of WHEN
 *  each syllable landed. The tool call says which syllables; this says when. */
export interface VoiceContext {
  words?: { word: string; confidence?: number; s?: number; e?: number }[]
  /** The clips selected in the studio, so "them" / "these" can mean a set. */
  selectedClipIds?: string[]
  /** The track selected in the studio. */
  selectedTrackId?: string
  /**
   * What was actually said, as one string.
   *
   * ⚠️ Needed because a single call cannot tell an edit from a move. The model
   * hands over `transport locate, bar 9` for both "go to bar 9" and "make the
   * reverb 20% at bar 9", and only the sentence distinguishes them. See
   * notAMove.
   */
  said?: string
  /** Where the playhead is, in beats. Not in the project - the project is a
   *  document and this is a moment - so anything that answers "what is playing
   *  RIGHT NOW" has to be told. */
  atBeat?: number
  /**
   * The sound library, so a preset can be chosen by CHARACTER here rather than
   * by the caller.
   *
   * ⚠️ set_instrument makes the caller resolve a preset name to an id, which is
   * right for a name — the library lives on the machine, not in the song. But
   * "one of the darker piano presets" is not a name, it is a QUESTION about the
   * library, and asking it in two different places (once in the local rules,
   * once in whatever the assistant does) is how the two paths drift apart. One
   * matcher, given the library, answers for both.
   */
  library?: PresetLike[]
  /**
   * How far the song has got with preparing itself.
   *
   * Not in the project — a document cannot say whether it has finished
   * rendering — so the studio passes it in, the same way the library is.
   */
  loading?: { done: number; total: number; error?: string | null } | null
}

const PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/**
 * A single spoken note → a MIDI number. "C", "E flat", "F#4", "b flat 3".
 *
 * ⚠️ Deliberately not parseChord(): that reads a CHORD and returns a triad,
 * which is a different question. Asking it for "C" would put three notes where
 * somebody asked for one.
 *
 * Returns a pitch in octave 4 when no octave is said; the caller moves it to
 * sit with the rest of the part, because a bare "C" in a bass line is a low C.
 */
function spokenPitch(said: string): number | null {
  const t = String(said ?? '').toLowerCase().trim()
    .replace(/\bsharp\b/g, '#').replace(/\bflat\b/g, 'b').replace(/\s+/g, '')
  const m = /^([a-g])(#|b)?(-?\d)?$/.exec(t)
  if (!m) return null
  const base = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1]]
  if (base == null) return null
  const accidental = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0
  const octave = m[3] != null ? Number(m[3]) : 4
  const pitch = (octave + 1) * 12 + base + accidental
  return pitch >= 0 && pitch <= 127 ? pitch : null
}

/** "C#4" - a pitch as a person would say it. */
function pitchName(pitch: number): string {
  return `${PITCH_NAMES[((pitch % 12) + 12) % 12]}${Math.floor(pitch / 12) - 1}`
}

/**
 * Name what is sounding - the spoken half of a tuner.
 *
 * Brae: "people can ask what notes are being played".
 *
 * Two questions wear the same words. With a target it means "what is in this
 * part", and the answer is that clip's notes. Without one it means "what is
 * under the playhead right now", which needs a moment as well as a document -
 * hence VoiceContext.atBeat. Answering the first when they asked the second is
 * worse than admitting the playhead is unknown, because both answers look
 * equally confident.
 */
function namePlayingNotes(
  project: DawProject,
  target: string,
  maps: ReturnType<typeof mapsOf>,
  atBeat?: number,
  notesAsked?: string,
): string {
  const clips = (project.arrangementClips ?? []).filter(
    (c): c is MidiClip => (c as MidiClip).kind === 'midi' && !!(c as MidiClip).notes?.length,
  )
  const drumTrack = new Set(
    (project.tracks ?? []).filter(t => t.instrument?.type === 'drum').map(t => t.id),
  )

  let sounding: { pitch: number; track: string }[] = []
  let where = ''
  let progression = ''

  if (target) {
    const chosen = resolveClipOrAsk(target, project, maps, 'name_notes', {})
    const clip = chosen.clip as MidiClip | null
    const track = resolveTrack(target, project)
    const wanted = clip
      ? [clip]
      : track ? clips.filter(c => c.trackId === track.id) : []
    if (!wanted.length) return `I couldn't find "${target}".`
    where = `in ${clip?.name || track?.name || target}`
    // ── A part of the clip ──────────────────────────────────────────────
    // ⚠️ THE RECORD, 23:37: "What is the chord, the 1st chord in pad intro,
    // about a 2nd into it?" → all fourteen notes in the clip, "that's E".
    // A chord is a moment; the clip holds several. Named, it is answered
    // on its own, with where it sits.
    const notesSaid = String(notesAsked ?? '').trim()
    const source = clip ?? wanted[0]
    if (notesSaid && source) {
      const pick = pickNotes(source, { notes: notesSaid }, maps, project)
      if ('problem' in pick) return pick.problem
      if (!pick.notes.length) return `I couldn't find ${pick.label} in "${source.name}".`
      const uniqP = [...new Set(pick.notes.map(n => n.pitch))].sort((a, b) => a - b)
      const chordName = uniqP.length > 1 ? nameChord(uniqP) : null
      const at = describeBeat(source.startBeat + pick.startBeat, maps)
      return `${pick.label[0].toUpperCase()}${pick.label.slice(1)} in "${source.name}" (${at}): ${uniqP.map(pitchName).join(', ')}${chordName ? ` - that's ${chordName}` : ''}.`
    }
    sounding = wanted.flatMap(c => c.notes.map(n => ({
      pitch: n.pitch,
      track: (project.tracks ?? []).find(t => t.id === c.trackId)?.name ?? '',
    })))
    // A whole clip with a progression in it: name the chords in order, so
    // "what are the chords in the pad" is answered as chords, not as one
    // pile of fourteen notes.
    if (clip) {
      const chords = chordsOf(clip.notes ?? [])
      if (chords.length > 1) {
        const names = chords.map(c => nameChord([...new Set(c.notes.map(n => n.pitch))].sort((a, b) => a - b)) ?? c.notes.map(n => pitchName(n.pitch)).join(' '))
        progression = ` ${chords.length} chords: ${names.join(', ')}.`
      }
    }
  } else {
    if (atBeat == null) {
      return 'Point me at a track or clip and I\'ll name its notes - I can\'t see where the playhead is.'
    }
    where = `at ${describeBeat(atBeat, maps)}`
    for (const c of clips) {
      if (atBeat < c.startBeat || atBeat >= c.startBeat + c.durationBeats) continue
      const local = atBeat - c.startBeat
      const name = (project.tracks ?? []).find(t => t.id === c.trackId)?.name ?? ''
      for (const n of c.notes) {
        if (local >= n.startBeat && local < n.startBeat + n.durationBeats) {
          sounding.push({ pitch: n.pitch, track: name })
        }
      }
    }
  }

  // Drums are pitches too, and naming a kick "C1" is technically true and
  // useless. They are left out of the chord and named as drums instead.
  const pitched = sounding.filter(x => !drumTrack.has(
    (project.tracks ?? []).find(t => t.name === x.track)?.id ?? '',
  ))
  const uniq = [...new Set(pitched.map(x => x.pitch))].sort((a, b) => a - b)

  if (!uniq.length) return `Nothing pitched is sounding ${where}.`
  if (uniq.length === 1) return `${pitchName(uniq[0])} ${where}.`

  const names = uniq.map(pitchName).join(', ')
  const chord = nameChord(uniq)
  // The chord name is the answer to "what chord is this"; the note list is the
  // answer to "what notes". Saying both costs one clause and covers both.
  return `${names} ${where}${chord ? ` - that's ${chord}` : ''}.${progression}`
}

/**
 * The clip an editor should open on, making one if it has to.
 *
 * ⚠️ The instrument decides the editor, not the other way round. A sequencer on
 * a synth track shows a grid of drum lanes that play chromatic pitches, which
 * looks like it worked and sounds like nothing anybody asked for - so a new
 * sequencer brings a drum kit with it, and a new piano roll does not.
 */
function editorTarget(
  project: DawProject,
  target: string,
  editor: 'sequencer' | 'pianoroll',
  create: boolean,
  maps: ReturnType<typeof mapsOf>,
): { actions: unknown[]; clipId: string; name: string; made: boolean; problem?: string } {
  const none = { actions: [], clipId: '', name: '', made: false }
  const clips = (project.arrangementClips ?? []).filter(
    (c): c is MidiClip => (c as MidiClip).kind === 'midi',
  )
  const wantsDrums = editor === 'sequencer'

  if (!create) {
    // Named a clip, named a track, or neither - in that order of specificity.
    const named = target ? clips.find(c => foldName(c.name ?? '') === foldName(target)) : null
    if (named) return { actions: [], clipId: named.id, name: named.name ?? 'that clip', made: false }
    const track = target ? resolveTrack(target, project) : null
    if (target && !track) return { ...none, problem: `I couldn't find "${target}".` }
    const onTrack = track ? clips.filter(c => c.trackId === track.id) : clips
    if (onTrack.length) {
      const c = onTrack[0]
      return { actions: [], clipId: c.id, name: c.name ?? track?.name ?? 'that clip', made: false }
    }
    if (!track) {
      return { ...none, problem: 'There is nothing to open yet - say "make a new sequencer".' }
    }
    // A track with no clips: making one is what they meant.
  }

  const track = target ? resolveTrack(target, project) : null
  const existing = track ?? (project.tracks ?? []).find(t =>
    wantsDrums ? t.instrument?.type === 'drum' : t.instrument?.type !== 'drum')
  const trackId = existing?.id ?? newId()
  const actions: unknown[] = []
  if (!existing) {
    actions.push({ type: 'ADD_TRACK', id: trackId, name: wantsDrums ? 'Drums' : 'Keys' })
    if (wantsDrums) actions.push({ type: 'SET_INSTRUMENT', trackId, instrument: defaultDrumInstrument() })
  }
  const clipId = newId()
  const startBeat = positionToBeat(undefined, maps) ?? 0
  actions.push({
    type: 'ADD_CLIP',
    clip: {
      id: clipId, trackId, kind: 'midi',
      name: wantsDrums ? 'Beat' : 'Notes',
      startBeat, durationBeats: 4, loopEnabled: false, notes: [],
    } as unknown as MidiClip,
  })
  return { actions, clipId, name: existing?.name ?? (wantsDrums ? 'a new Drums track' : 'a new Keys track'), made: true }
}

// ── Shared ground for the compound commands ────────────────────────────────
//
// All of them need the same two things: the MIDI clip somebody meant, and a way
// to put an effect on a track whether or not it already has one. Written once,
// because eight commands each resolving a clip slightly differently is eight
// slightly different ideas of what "the pad" means.

/** The MIDI clip a compound edit should act on, or a reason it cannot. */
/** A lib/pitch-time.ts patch set as one UPDATE_MIDI_NOTE per note — the shape the older tools have always emitted. */
const perNote = (clipId: string, patches: { id: string; patch: Partial<MidiNote> }[]) =>
  patches.map(p => ({ type: 'UPDATE_MIDI_NOTE', clipId, noteId: p.id, patch: p.patch }))

/**
 * The song's key as a scale for lib/pitch-time.ts — null when it is chromatic
 * (every note is in it, so degrees mean nothing). An unset key reads as C
 * major, the same fallback the roll's key highlighting uses.
 */
function projectScale(project: DawProject, strict = false): Scale | null {
  if (strict && project.scale == null) return null
  const scale = (project.scale ?? 'major') as ScaleType
  if (scale === 'chromatic') return null
  const intervals = SCALE_INTERVALS[scale] ?? SCALE_INTERVALS.major
  return { root: project.key ?? 0, intervals }
}

function midiClipFor(target: string, project: DawProject, verb: string):
{ clip: MidiClip; how: string } | { problem: string } {
  const found = resolveClip(target, project)
  if (!found) return { problem: `I couldn't find "${target || 'that'}" to ${verb}.` }
  const clip = found.clip
  if (!('notes' in clip)) return { problem: `That is an audio clip — there are no notes to ${verb}.` }
  const notes = (clip as MidiClip).notes
  if (!notes.length) return { problem: 'That clip has no notes yet.' }
  return { clip: clip as MidiClip, how: found.how ?? '' }
}

/**
 * Put an effect on a track, or find the one already there.
 *
 * ⚠️ Reuses an existing device of the same type rather than stacking another.
 * Saying "brighter" three times should brighten three times, not build a tower
 * of three EQs whose combined effect nobody can reason about — and which is
 * exactly what a naive add-every-time does.
 */
function effectOn(
  track: DawTrack,
  type: EffectType,
  make: () => Record<string, unknown>,
): { id: string; params: Record<string, unknown>; actions: unknown[] } {
  const existing = (track.effects ?? []).find(e => e.type === type)
  if (existing) {
    return { id: existing.id, params: { ...(existing.params as object) } as Record<string, unknown>, actions: [] }
  }
  const id = newId()
  const params = make()
  return {
    id,
    params,
    actions: [{ type: 'ADD_EFFECT', trackId: track.id, effect: { id, type, params } }],
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/**
 * A flam or a ghost note — drum detail that is not a repeat.
 *
 * A flam is a grace note a hair BEFORE the beat, quieter than the hit it leans
 * on; a ghost note is a quiet one between the hits. Both are what separate a
 * played drum part from a programmed one, and neither is expressible as
 * "repeat this faster".
 */
function flamOrGhost(clip: MidiClip, how: string, kind: 'flam' | 'ghost'): VoicePlan {
  const notes = clip.notes
  if (!notes.length) return { actions: [], say: '', problem: 'That clip has no notes.' }
  const extra = kind === 'flam'
    ? notes.map(n => ({
      ...n, id: newId(),
      // A 32nd before, and much quieter: a flam whose grace note is as loud as
      // the hit is just two hits.
      startBeat: Math.max(0, n.startBeat - 0.125),
      durationBeats: Math.min(0.1, n.durationBeats),
      velocity: Math.max(15, Math.round(n.velocity * 0.45)),
    }))
    : (() => {
      // Between the hits, on the sixteenths nothing is already using.
      const taken = new Set(notes.map(n => +n.startBeat.toFixed(3)))
      const out: typeof notes = []
      for (const n of notes) {
        const at = +(n.startBeat + 0.25).toFixed(3)
        if (taken.has(at) || at >= clip.durationBeats) continue
        taken.add(at)
        out.push({
          ...n, id: newId(), startBeat: at,
          durationBeats: Math.min(0.2, n.durationBeats),
          velocity: Math.max(12, Math.round(n.velocity * 0.3)),
        })
      }
      return out
    })()
  if (!extra.length) return { actions: [], say: '', problem: `There is no room for ${kind} notes in ${how}.` }
  return {
    actions: [{ type: 'UPDATE_CLIP', clipId: clip.id, patch: { notes: [...notes, ...extra] } }],
    say: `Added ${extra.length} ${kind} note${extra.length === 1 ? '' : 's'} to ${how}.`,
  }
}

export function planVoiceCall(call: VoiceCall, project: DawProject, heard?: VoiceContext): VoicePlan {
  const maps = mapsOf(project)
  const i = call.input ?? {}
  const target = str(i.target)

  switch (call.name) {
    // DUPLICATE — "loop bass 2 three more times"
    // ── Live's Clip Activator: park a clip, bring it back ─────────────────
    case 'set_clip_active': {
      const active = i.active === true || i.active === 'true'
      const chosen = resolveClipOrAsk(target, project, maps, 'set_clip_active', { active })
      if (chosen.ask) return { actions: [], say: '', ask: chosen.ask }
      if (!chosen.clip) return fail(`I couldn't find "${target || 'that'}" — say the track or clip name.`)
      const how = chosen.how ?? `"${chosen.clip.name}"`
      if ((chosen.clip.active !== false) === active) return { actions: [], say: `${how} is already ${active ? 'active' : 'parked'}.` }
      return {
        actions: [{ type: 'SET_CLIPS_ACTIVE', clipIds: [chosen.clip.id], active }],
        say: active ? `${how} is back on.` : `Parked ${how} — it stays put, silent, until you activate it again.`,
      }
    }

    case 'duplicate_clip': {
      const count = spokenNumber(i.count as string) ?? 1
      if (count < 1) return fail('Say how many more times to repeat it.')
      const chosen = resolveClipOrAsk(target, project, maps, 'duplicate_clip', { count })
      if (chosen.ask) return { actions: [], say: '', ask: chosen.ask }
      const found = chosen.clip ? { clip: chosen.clip, how: chosen.how ?? '' } : null
      if (!found) return fail(`I couldn't find "${target || 'that'}" — say the track or clip name.`)
      const { clip } = found
      const actions = Array.from({ length: count }, (_, n) => ({
        type: 'ADD_CLIP',
        clip: {
          ...clip,
          id: newId(),
          startBeat: clip.startBeat + clip.durationBeats * (n + 1),
          ...('notes' in clip ? { notes: (clip as MidiClip).notes.map(nt => ({ ...nt, id: newId() })) } : {}),
        },
      }))
      const endBeat = clip.startBeat + clip.durationBeats * (count + 1)
      return {
        actions,
        say: `Duplicated ${found.how} ${count} more time${count === 1 ? '' : 's'} — now runs to ${describeBeat(endBeat, maps)}.`,
      }
    }

    // ── COPY A PART OF A CLIP ───────────────────────────────────────────
    //
    // The record, three tries in forty minutes: "Take the 1st chord in pad
    // intro and place it at the 1st bar" → moved the WHOLE intro clip sixteen
    // bars; "take the 1st chord that's in pad intro and recreate it on pad at
    // the 1st bar" → read the note names out; "…and repeat that 4 times" → only
    // the move ran. There was no tool for a PART of a clip, so the model did
    // the nearest whole-clip thing each time, confidently.
    //
    // "The first chord" is every note that starts with the clip's first note;
    // "the first N bars/beats" is a span. Either becomes a new clip on the same
    // track at the place asked for, `times` copies back to back.
    case 'copy_notes': {
      const chosen = resolveClipOrAsk(target, project, maps, 'copy_notes', { part: i.part, at: i.at, times: i.times })
      if (chosen.ask) return { actions: [], say: '', ask: chosen.ask }
      const src = chosen.clip
      if (!src) return fail(`I couldn't find "${target || 'that'}" — say the track or clip name.`)
      if (!('notes' in src) || !(src as MidiClip).notes.length) return fail(`"${src.name}" has no notes to copy — it is ${'notes' in src ? 'empty' : 'an audio clip'}.`)
      const notes = (src as MidiClip).notes
      const partSaid = (str(i.notes) || str(i.part)).toLowerCase().trim()
      let picked: (typeof notes)[number][]
      let partLabel: string
      let spanBeats: number
      const noteAddr = partSaid ? parseNoteAddress(partSaid) : null
      if (noteAddr || !partSaid) {
        // ── A chord, told apart from the rest ─────────────────────────
        //
        // ⚠️ THE RECORD, 23:37: "the 1st chord in pad intro" → every note in
        // the clip. A chord is a moment when two or more notes start
        // together, and a clip holds several; "the first chord", "the third
        // chord", "the last chord", "the chord at bar 3" name ONE of them.
        // See lib/note-address.ts.
        const pick = pickNotes(src as MidiClip, { notes: partSaid || 'the first chord' }, maps, project)
        if ('problem' in pick) return fail(pick.problem)
        if (!pick.notes.length) return fail(`I couldn't find ${pick.label} in "${src.name}".`)
        const start = pick.startBeat
        spanBeats = Math.max(0.25, pick.endBeat - start)
        // A chord's notes land together: a strum's few hundredths of a beat
        // become one block chord on the grid.
        const snapped = (n: { startBeat: number }): number => {
          const rel = n.startBeat - start
          return pick.chords?.length && rel < 0.2 ? 0 : rel
        }
        picked = pick.notes.map(n => ({
          ...n,
          startBeat: snapped(n),
          durationBeats: Math.max(0.05, Math.min(n.durationBeats, spanBeats - snapped(n))),
        }))
        partLabel = `${pick.label} (${pick.notes.length} note${pick.notes.length === 1 ? '' : 's'})`
      } else {
        const span = spanOf(i.part, src.startBeat, maps)
        if (span.problem || span.beats == null) return fail(`Say which part — "the first chord", "the first bar", "the first two bars".`)
        spanBeats = span.beats
        picked = notes.filter(n => n.startBeat < spanBeats).map(n => ({ ...n, durationBeats: Math.min(n.durationBeats, spanBeats - n.startBeat) }))
        partLabel = `the first ${span.said ? describeDuration(span.said, spanBeats) : `${spanBeats} beats`}`
      }
      if (!picked.length) return fail(`There is nothing in ${partLabel} of "${src.name}".`)
      const place = placeOf(i.at, maps, project)
      if (place.problem) return fail(place.problem)
      const at = place.beat ?? src.startBeat
      const times = Math.max(1, Math.min(64, spokenNumber(i.times as string) ?? 1))
      const bar = project.timeSignatureNum || 4
      // ⚠️ WHOLE BARS. The record, 23:39: "Pad intro part isn't 1 full bar
      // long. It's slightly shorter." The chord's notes were a hair under four
      // beats, so the clip was too, and repeating it drifted off the grid. A
      // part is rounded up to the bar it sits in.
      const clipLen = Math.max(bar, Math.ceil(spanBeats / bar - 1e-6) * bar)
      const actions = Array.from({ length: times }, (_, n) => ({
        type: 'ADD_CLIP',
        clip: {
          id: newId(), trackId: src.trackId, kind: 'midi', name: times > 1 ? `${src.name} · ${n + 1}` : `${src.name} · part`,
          startBeat: at + clipLen * n, durationBeats: clipLen, loopEnabled: false,
          isDrumClip: (src as MidiClip).isDrumClip ?? false,
          ...((src as MidiClip).presetId ? { presetId: (src as MidiClip).presetId } : {}),
          notes: picked.map(nt => ({ ...nt, id: newId() })),
        } as unknown as MidiClip,
      }))
      return {
        actions,
        say: `Copied ${partLabel} of "${src.name}" to ${describeBeat(at, maps)}${times > 1 ? `, ${times} times back to back` : ''}.`,
      }
    }

    // AUTOMATION — "an ascending low pass filter from 80% to 0% over the first 8 seconds"
    case 'automate_parameter': {
      const found = resolveClip(target, project)
      if (!found) return fail(`I couldn't find "${target || 'that'}" to automate.`)
      const clip = found.clip
      const track = project.tracks.find(x => x.id === clip.trackId)
      if (!track) return fail('That clip is not on a track any more.')

      let from = spokenFraction(i.from as string)
      let to = spokenFraction(i.to as string)
      // (A missing end is filled from the lane that already drives this
      // parameter, once that lane is known — see below. Only when there is no
      // such lane is a missing end a question.)

      // Unstated means the clip itself; stated-but-unreadable is a question.
      // See placeOf — a sweep drawn from bar 1 because "the chorus" did not
      // parse would be perfectly shaped and in the wrong place.
      const start = placeOf(i.start ?? i.at, maps, project)
      if (start.problem) return fail(start.problem)
      const startBeat = start.beat ?? clip.startBeat
      // "until bar 6" is an endpoint, and the tool used to have no field for
      // one — the model had to turn it into a length by arithmetic it could
      // get wrong. Given as a place, it is read as a place.
      const end = placeOf(i.end ?? i.until, maps, project)
      if (end.problem) return fail(end.problem)
      const span = end.beat != null ? { beats: end.beat - startBeat } : spanOf(i.length, startBeat, maps)
      if (span.problem) return fail(span.problem)
      const lengthBeats = span.beats ?? clip.durationBeats
      if (lengthBeats <= 0) {
        return fail(end.beat != null
          ? `${describeBeat(end.beat, maps)} is not after ${describeBeat(startBeat, maps)}, so there is nothing to sweep across.`
          : 'That sweep has no length.')
      }

      // ⚠️ NO DEFAULT, AND NO SILENT FALLBACK. Brae: "It didn't change the
      // reverb, named 'VERB Wet' but instead created a lowpass cutoff that did
      // the shape that I wanted."
      //
      // This read `str(i.parameter || 'lowpass')`, and the branch below turned
      // anything it did not recognise into a low-pass too — so a parameter
      // named in words the enum did not list ("reverb wet", "VERB Wet", "wet")
      // came out as a filter, drawn perfectly, on the wrong thing. The shape
      // was right, which is what made it convincing.
      //
      // A parameter nobody can name is a question, not a filter.
      const param = automatableName(str(i.parameter))
      if (!param) {
        return fail(str(i.parameter)
          ? `I don't know how to automate "${str(i.parameter)}". I can do volume, pan, reverb, delay, drive, chorus, or a low-pass or high-pass filter.`
          : 'Say which one to automate — volume, pan, reverb, delay, drive, chorus, or a low-pass or high-pass filter.')
      }
      // ── A LEVEL, NOT A SHAPE ──────────────────────────────────────────
      //
      // The record, 22:02–22:04: "Add a low pass cutoff to Stab so it stays at
      // about 80%" → a flat lane 80→80 over the first clip; "Bring the low
      // pass cutoff on Stab down to 50%" → another flat lane 50→50 over 32
      // beats; "…of the entire Stab track" → a third, to bar 63. Nobody asked
      // for a shape. One value with no span is a SETTING: the effect's own
      // control is set, and if a lane already drives it the lane goes flat at
      // that value so the two cannot disagree.
      const gaveSpan = i.start != null || i.at != null || i.end != null || i.until != null || i.length != null
      if (from != null && to != null && Math.abs(from - to) < 1e-9 && !gaveSpan) {
        const level = to
        const setActions: unknown[] = []
        let what = ''
        let shown = ''
        if (param === 'volume') {
          setActions.push({ type: 'UPDATE_TRACK', trackId: track.id, patch: { volume: level } })
          what = 'Volume'; shown = `${Math.round(level * 100)}%`
        } else if (param === 'pan') {
          setActions.push({ type: 'UPDATE_TRACK', trackId: track.id, patch: { pan: level * 2 - 1 } })
          what = 'Pan'; shown = `${Math.round(level * 100)}%`
        } else if (FX_AUTOMATABLE[param]) {
          const spec = FX_AUTOMATABLE[param]
          const have = (track.effects ?? []).find(e => e.type === spec.type)
          const fxId = have?.id ?? newId()
          if (!have) setActions.push({ type: 'ADD_EFFECT', trackId: track.id, effect: { id: fxId, type: spec.type, params: { ...makeDefaultParams(spec.type), [spec.key]: level } } })
          else setActions.push({ type: 'UPDATE_EFFECT', trackId: track.id, effectId: fxId, patch: { params: { ...(have.params as object), [spec.key]: level } } })
          what = spec.label; shown = `${Math.round(level * 100)}%`
        } else {
          const kind = param === 'highpass' ? 'highpass' : 'lowpass'
          const have = (track.effects ?? []).find(e => e.type === 'filter' && (e.params as { type?: string } | undefined)?.type === kind)
          const hzv = FILTER_HZ[kind].fromNorm(level)
          const fxId = have?.id ?? newId()
          if (!have) setActions.push({ type: 'ADD_EFFECT', trackId: track.id, effect: { id: fxId, type: 'filter', params: { enabled: true, type: kind, frequency: hzv, q: 1 } } })
          else setActions.push({ type: 'UPDATE_EFFECT', trackId: track.id, effectId: fxId, patch: { params: { ...(have.params as object), frequency: hzv } } })
          what = kind === 'lowpass' ? 'Low-pass cutoff' : 'High-pass cutoff'; shown = fmtHz(hzv)
        }
        // A lane that already drives this goes flat at the new level, or it
        // would keep pulling the control back to the old shape.
        const key = param === 'volume' || param === 'pan' ? param
          : FX_AUTOMATABLE[param] ? `:${FX_AUTOMATABLE[param].key}` : ':frequency'
        const lanes = (project.automationLanes ?? []).filter(l => l.trackId === track.id && (l.parameter === key || (key.startsWith(':') && l.parameter.endsWith(key))))
        for (const l of lanes) for (const pt of l.points ?? []) setActions.push({ type: 'UPDATE_AUTOMATION_POINT', laneId: l.id, pointId: pt.id, patch: { value: level } })
        return {
          actions: setActions,
          say: `${what} on "${track.name}" set to ${shown}${lanes.length ? ' — its automation is flat at that now too' : ''}.`,
        }
      }
      const actions: unknown[] = []
      let laneId = newId()
      let parameter: string
      let label: string
      /** Set for the filter sweeps, whose values are Hertz rather than 0–1. */
      let hz: { min: number; max: number; fromNorm: (n: number) => number } | null = null

      if (param === 'volume' || param === 'pan') {
        // The track's own parameter — no effect needed.
        parameter = param
        label = param === 'volume' ? 'Volume' : 'Pan'
      } else if (FX_AUTOMATABLE[param]) {
        // ── AN EFFECT'S OWN AMOUNT, OVER TIME ────────────────────────────
        //
        // Brae: "I told the AI to make reverb on pad 100% then 20% at a
        // different spot and it just moved my playhead again... I think that
        // when I bring up bars it thinks I'm moving the playhead."
        //
        // ⚠️ THE PLAYHEAD WAS THE SYMPTOM. This tool could automate a filter,
        // the volume and the pan, and NOTHING ELSE — so "reverb 100% here and
        // 20% there" had no way to be said at all. Faced with a request it
        // could not express, the model reached for the one part of the sentence
        // it COULD act on: a bar number. Refusing the move would have left him
        // with a studio that did nothing instead of the wrong thing.
        //
        // The lane type has always taken `fx:{effectId}:{paramKey}` — the
        // hand-drawn lanes under a track use exactly that — so this is a
        // mapping, not a mechanism.
        const spec = FX_AUTOMATABLE[param]
        // ⚠️ AN APOLLO REVERB IS STILL THE REVERB ON THIS TRACK. Brae: "it
        // created the right thing but as a different reverb instead of changing
        // the existing one."
        //
        // Every Apollo device is stored as type 'helios' and says what it
        // really is in `params.unit.type` — this file already knows that, three
        // hundred lines up, where set_effect matches them. Looking only at
        // `e.type` here meant a track whose reverb came from Apollo looked like
        // a track with no reverb, so a second one was added and automated while
        // the first sat underneath, audible and unexplained.
        const isThis = (e: { type: string; params?: unknown }) =>
          e.type === spec.type
          || (e.type === 'helios'
            && (e.params as { unit?: { type?: string } })?.unit?.type === spec.type)
        const existing = (track.effects ?? []).find(isThis)
        // ⚠️ And an Apollo unit's amount is its MIX, not the plain effect's own
        // parameter name. Automating `fx:<id>:wet` on a helios device would
        // write to a parameter it does not have — a lane that draws and does
        // nothing, which is the quietest failure available here.
        const key = existing?.type === 'helios' ? 'mix' : spec.key
        let effectId = existing?.id
        if (!effectId) {
          effectId = newId()
          actions.push({
            type: 'ADD_EFFECT', trackId: track.id,
            effect: { id: effectId, type: spec.type, params: makeDefaultParams(spec.type) },
          })
        }
        parameter = `fx:${effectId}:${key}`
        label = spec.label
      } else {
        const kind = param === 'highpass' ? 'highpass' : 'lowpass'
        // ⚠️ THE FILTER THAT IS ALREADY THERE. This made a new filter effect on
        // every sweep, so "change the low pass so it goes to 50% instead of
        // 20" could never find the lane it was asked to change — the lane is
        // keyed by the effect's id, and the id was always fresh. Two sweeps
        // meant two low-passes in series, each with its own lane.
        const have = (track.effects ?? []).find(e =>
          e.type === 'filter' && (e.params as { type?: string } | undefined)?.type === kind)
        const effectId = have?.id ?? newId()
        if (!have) {
          actions.push({
            type: 'ADD_EFFECT', trackId: track.id,
            effect: { id: effectId, type: 'filter', params: { enabled: true, type: kind, frequency: FILTER_HZ[kind].max, q: 1 } },
          })
        }
        parameter = `fx:${effectId}:frequency`
        label = kind === 'lowpass' ? 'Low-pass cutoff' : 'High-pass cutoff'
        hz = FILTER_HZ[kind]
      }

      // ── A POINT IS A POSITION, NOT A VALUE ───────────────────────────────
      //
      // Brae, first: "the lowpass cutoff made the pad stop playing audio."
      // Brae, after the first fix: "it's consistent through the track item
      // instead of being the graph that I need it to be."
      //
      // ⚠️ THE FIRST FIX WAS WRONG AND THIS IS THE CORRECTION. The original
      // lane was declared min 0 / max 1 with fractional points, so the engine
      // mapped it onto 0–1 Hz and the track vanished. That much was right. But
      // the fix then wrote HERTZ into the points, and a point value is not the
      // parameter's value — the lane editor stores what the mouse drew
      // (`// value is 0..1` in AutomationLaneView) and the engine maps it
      // through min/max. So a point of 12 000 became 200 + 12000 × 17800, tens
      // of millions of Hertz, clamped wide open at both ends of the sweep. The
      // filter then sat fully open for the whole clip: a constant, not a curve.
      //
      // The lane's RANGE is what carries the units; only that needed changing.
      // Points go back to the 0–1 the rest of the app draws, and the lane says
      // it is spaced logarithmically so a descent is heard across its whole
      // travel rather than only in the last tenth — Brae: "The descending part
      // is as important as the filter."
      // ── ONE LANE PER PARAMETER, HOWEVER MANY TIMES IT IS ASKED ABOUT ─────
      //
      // Brae: "Instead of changing the reverb it created two new reverbs within
      // the same automation lane."
      //
      // ⚠️ "100% here and 20% there" arrives as TWO calls, and each one built its
      // own lane — and, not seeing the other's, its own reverb to hang it on.
      // A lane that already drives this parameter on this track is THE lane for
      // it: the new points join it, and nothing is added beside it. That is
      // also what makes the command idempotent, which a shape drawn by voice
      // has to be — people ask for the same move twice while refining it.
      const had = (project.automationLanes ?? []).find(l => l.trackId === track.id && l.parameter === parameter)
      // ── An edit to a sweep that is already there ─────────────────────
      //
      // The record, 05:24: "Change the low pass cutoff so that the low on the
      // descend goes to 50% instead of 20" → "Say what it should sweep from
      // and to." He said where it should END; where it starts was already
      // drawn on the lane. A missing end is read off the existing lane at the
      // span's edges, so changing one end of a sweep is one sentence.
      if (had && (from == null || to == null)) {
        const pts = [...had.points].sort((a, b) => a.beat - b.beat)
        const valueAt = (beat: number): number | null => {
          if (!pts.length) return null
          if (beat <= pts[0].beat) return pts[0].value
          if (beat >= pts[pts.length - 1].beat) return pts[pts.length - 1].value
          for (let k = 0; k + 1 < pts.length; k++) {
            const a = pts[k], b = pts[k + 1]
            if (beat >= a.beat && beat <= b.beat) {
              const t = b.beat === a.beat ? 0 : (beat - a.beat) / (b.beat - a.beat)
              return a.value + (b.value - a.value) * t
            }
          }
          return null
        }
        if (from == null) from = valueAt(startBeat)
        if (to == null) to = valueAt(startBeat + lengthBeats)
      }
      if (from == null || to == null) return fail('Say what it should sweep from and to.')
      if (had) laneId = had.id
      else {
        actions.push({
          type: 'ADD_AUTOMATION_LANE',
          lane: {
            id: laneId, trackId: track.id, parameter, label,
            min: hz ? hz.min : 0,
            max: hz ? hz.max : 1,
            curve: hz ? 'log' : undefined,
            defaultValue: hz ? hz.fromNorm(from) : from,
            points: [], expanded: true,
          },
        })
      }
      actions.push({ type: 'ADD_AUTOMATION_POINT', laneId, point: { id: newId(), beat: startBeat, value: from } })
      actions.push({ type: 'ADD_AUTOMATION_POINT', laneId, point: { id: newId(), beat: startBeat + lengthBeats, value: to } })

      const spoken = span.said
      return {
        actions,
        // Read back in the unit the thing is actually in. "From 100% to 20%"
        // sounded reasonable and was the same sentence whether the sweep ended
        // at 1.9 kHz or at a fifth of a Hertz — so the read-back could not have
        // caught the bug it was describing. "Down to 570 Hz" can be wrong out
        // loud.
        say: `${label} from ${hz ? `${fmtHz(hz.fromNorm(from))} to ${fmtHz(hz.fromNorm(to))}` : `${Math.round(from * 100)}% to ${Math.round(to * 100)}%`} ${end.beat != null ? `until ${describeBeat(end.beat, maps)}` : `over ${spoken ? describeDuration(spoken, lengthBeats) : `${+lengthBeats.toFixed(2)} beats`}`}, starting ${describeBeat(startBeat, maps)}, on ${found.how}.`,
      }
    }

    // MOVE — "move everything over by one bar"
    case 'set_delay_compensation': {
      const on = i.on === true || i.on === 'true'
      const isOn = project.delayCompensation !== false
      if (on === isOn) return { actions: [], say: `Delay compensation is already ${on ? 'on' : 'off'}.` }
      return {
        actions: [{ type: 'SET_DELAY_COMPENSATION', on }],
        say: on ? 'Delay compensation on — every track is delayed to match the slowest one, so they all arrive together.'
          : 'Delay compensation off — each track plays as its devices deliver it.',
      }
    }

    case 'modulate_parameter': {
      const found = resolveClip(target, project)
      const trackByName = !found ? project.tracks.find(t => foldName(t.name) === foldName(target)) : null
      const track = found ? project.tracks.find(x => x.id === found.clip.trackId) : trackByName
      if (!track) return fail(`I couldn't find "${target || 'that'}" to modulate.`)
      const mods = (project.modulators ?? []).filter(m => m.trackId === track.id)
      const param = str(i.parameter) ? automatableName(str(i.parameter)) : null
      if (str(i.parameter) && !param) {
        return fail(`I don't know how to modulate "${str(i.parameter)}". I can wobble a low-pass or high-pass filter, tremolo the volume, auto-pan, or move reverb, delay, drive or chorus.`)
      }

      // ── OFF ──────────────────────────────────────────────────────────────
      if (i.off === true || i.off === 'true') {
        const gone = param
          ? mods.filter(m => m.routes.some(r => routeIsParam(r.parameter, param, track)))
          : mods
        // Nothing to take off is an answer, not a failure — the track is
        // already still.
        if (!gone.length) return { actions: [], say: param ? `Nothing is modulating the ${param} on "${track.name}" — it sits still already.` : `"${track.name}" has no LFOs on it — nothing to take off.` }
        return {
          actions: gone.map(m => ({ type: 'REMOVE_MODULATOR', modulatorId: m.id })),
          say: gone.length === 1 ? `Took the LFO off "${track.name}" — the ${labelOfParam(gone[0].routes[0]?.parameter, track)} sits still now.` : `Took ${gone.length} LFOs off "${track.name}".`,
        }
      }

      if (!param) return fail('Say what should move — the filter, the volume, the pan, or an effect like reverb.')
      const rate = i.rate != null ? parseModRate(str(i.rate)) : { kind: 'sync' as const, division: '1/4' }
      if (!rate) return fail(`I couldn't read "${str(i.rate)}" as a rate — say "1/8", "every beat", "once a bar" or "2 Hz".`)
      const depthPct = i.depth != null ? Number(i.depth) : 50
      if (!Number.isFinite(depthPct) || depthPct <= 0 || depthPct > 100) return fail('Depth is a percentage from 1 to 100.')
      const shape = ['sine', 'triangle', 'saw', 'square', 'random'].includes(str(i.shape)) ? str(i.shape) as 'sine' : 'sine'

      // The parameter key, adding the effect when the track has none — the
      // same mapping automate_parameter uses, so the two never disagree.
      const actions: unknown[] = []
      let parameter: string
      let label: string
      let unipolar = false
      if (param === 'volume' || param === 'pan') {
        parameter = param
        label = param === 'volume' ? 'volume' : 'pan'
        // A tremolo dips below the fader; it never pushes above it.
        unipolar = param === 'volume'
      } else if (FX_AUTOMATABLE[param]) {
        const spec = FX_AUTOMATABLE[param]
        const isThis = (e: { type: string; params?: unknown }) =>
          e.type === spec.type || (e.type === 'helios' && (e.params as { unit?: { type?: string } })?.unit?.type === spec.type)
        const existing = (track.effects ?? []).find(isThis)
        const key = existing?.type === 'helios' ? 'mix' : spec.key
        let effectId = existing?.id
        if (!effectId) {
          effectId = newId()
          actions.push({ type: 'ADD_EFFECT', trackId: track.id, effect: { id: effectId, type: spec.type, params: makeDefaultParams(spec.type) } })
        }
        parameter = `fx:${effectId}:${key}`
        label = spec.label.toLowerCase()
      } else {
        const kind = param === 'highpass' ? 'highpass' : 'lowpass'
        const have = (track.effects ?? []).find(e => e.type === 'filter' && (e.params as { type?: string } | undefined)?.type === kind)
        const effectId = have?.id ?? newId()
        if (!have) {
          // A wobble wants room on both sides: the new filter sits in the
          // middle of its range (by ratio), not fully open.
          const hz = FILTER_HZ[kind]
          const middle = Math.round(Math.sqrt(hz.min * hz.max))
          actions.push({ type: 'ADD_EFFECT', trackId: track.id, effect: { id: effectId, type: 'filter', params: { enabled: true, type: kind, frequency: middle, q: 1 } } })
        }
        parameter = `fx:${effectId}:frequency`
        label = kind === 'lowpass' ? 'low-pass cutoff' : 'high-pass cutoff'
      }

      // One LFO per parameter per track: asking again re-tunes it.
      const already = mods.find(m => m.routes.some(r => r.parameter === parameter))
      const route = { id: already?.routes.find(r => r.parameter === parameter)?.id ?? newId(), parameter, amount: (unipolar ? -1 : 1) * depthPct / 100, unipolar }
      if (already) {
        actions.push({ type: 'UPDATE_MODULATOR', modulatorId: already.id, patch: { shape, rate, depth: 1, enabled: true, routes: already.routes.map(r => r.parameter === parameter ? route : r) } })
      } else {
        actions.push({ type: 'ADD_MODULATOR', modulator: { id: newId(), trackId: track.id, name: `LFO ${mods.length + 1}`, shape, rate, depth: 1, phase: 0, enabled: true, routes: [route] } })
      }
      const verb = param === 'volume' ? 'Tremolo on' : param === 'pan' ? 'Auto-panning' : 'Wobbling'
      return {
        actions,
        say: `${verb} the ${label} on "${track.name}" — ${shape === 'sine' ? '' : shape + ' wave, '}${describeModRate(rate)}, ${Math.round(depthPct)}% deep.${already ? ' (Re-tuned the one that was there.)' : ''}`,
      }
    }

    case 'move_clips': {
      // A set — "all the pad intro parts", "the pad clips after bar 9" — moves
      // together; a track name means everything on it; a plain clip name, one.
      const moveAddr = clipAddressOf(i, target, maps, project, heard)
      const chosen = moveAddr
        ? addressClips(project, moveAddr)
        : target
          ? (() => {
            const track = resolveTrack(target, project)
            if (track) return allClips(project).filter(c => c.trackId === track.id)
            const one = resolveClip(target, project)
            return one ? [one.clip] : []
          })()
          : allClips(project)

      // ── EXCEPT ───────────────────────────────────────────────────────────
      //
      // The record, 20:36: "Move everything forward by 8 bars. So move it all
      // right by 8 bars except for pad intro." → move_clips(by: 8 bars) →
      // "Moved all 35 clips" — the one clip he asked to leave went with them.
      // The tool had no way to say "except", so the model dropped it and did
      // the nearest thing, confidently. Same shape as the reverb that became a
      // low-pass: a request the tool cannot express becomes the wrong action,
      // not a question.
      //
      // ⚠️ AN EXCEPTION THAT NAMES NOTHING IS A REFUSAL. If "pad intro" resolves
      // to no track and no clip, moving everything anyway is precisely the
      // outcome the sentence forbade.
      const exceptions = Array.isArray(i.except) ? (i.except as unknown[]).map(x => String(x ?? '').trim()).filter(Boolean) : []
      const spared = new Set<string>()
      for (const name of exceptions) {
        const track = resolveTrack(name, project)
        if (track) { for (const c of allClips(project)) if (c.trackId === track.id) spared.add(c.id); continue }
        const one = resolveClip(name, project)
        if (one) { spared.add(one.clip.id); continue }
        return fail(`I couldn't find "${name}" to leave in place — say the track or clip name as it appears.`)
      }
      const clips = chosen.filter(c => !spared.has(c.id))
      if (!clips.length) {
        return fail(target ? `I couldn't find "${target}" to move.`
          : exceptions.length ? 'Everything you named to leave alone is everything there is — nothing left to move.'
            : 'There is nothing in the arrangement to move.')
      }
      const first = Math.min(...clips.map(c => c.startBeat))
      // ── "back to the first bar" is a DESTINATION, not a distance ─────────
      //
      // The record, 21:59: "Move everything back to the left, to the 1st bar"
      // → move_clips(by: -4 bars), which happened to be right because the last
      // move had been 4. A place to land is read as a place: the earliest of
      // the clips goes there and the rest keep their spacing.
      const dest = placeOf(i.to, maps, project)
      if (dest.problem) return fail(dest.problem)
      let by: number | null
      let spoken: MusicDuration | undefined
      if (dest.beat != null) {
        by = dest.beat - first
        spoken = undefined
      } else {
        const span = spanOf(i.by, first, maps)
        if (span.problem) return fail(span.problem)
        by = span.beats
        spoken = span.said
      }
      if (by == null) return fail('Say how far to move it, or where it should start.')
      if (Math.abs(by) < 1e-6) return { actions: [], say: `${target ? `"${target}"` : 'Everything'} already starts at ${describeBeat(first, maps)}.` }
      // Moving later is applied from the END so two clips never briefly share a
      // beat if this is ever applied optimistically.
      const ordered = [...clips].sort((a, b) => (by > 0 ? b.startBeat - a.startBeat : a.startBeat - b.startBeat))

      // ── What is written on the timeline moves with it ────────────────────
      //
      // Brae: "When I asked the voice control to move everything over, it
      // forgot to move the graphs for effects over."
      //
      // Clips are not the only thing with a position. An automation point and a
      // clip-effect bar each carry their own absolute beat, and moving the
      // music without them leaves a filter sweep sitting over whatever happens
      // to be there afterwards — which is worse than not moving at all, because
      // the arrangement still plays and simply sounds wrong somewhere else.
      //
      // Scoped to the tracks actually being moved. "Move the bass over" must not
      // drag the pad's automation with it, and a whole-arrangement move has
      // every track in the set anyway.
      const movedTracks = new Set(ordered.map(c => c.trackId))
      const shift = (b: number) => Math.max(0, b + by)

      const laneActions = (project.automationLanes ?? [])
        .filter(l => movedTracks.has(l.trackId))
        .flatMap(l => (l.points ?? []).map(pt => ({
          type: 'UPDATE_AUTOMATION_POINT',
          laneId: l.id,
          pointId: pt.id,
          patch: { beat: shift(pt.beat) },
        })))

      // The FX bars drawn over a clip — same argument, same fix.
      const fxActions = (project.clipEffects ?? [])
        .filter(fx => movedTracks.has(fx.trackId))
        .map(fx => ({
          type: 'UPDATE_CLIP_EFFECT',
          effectId: fx.id,
          patch: { startBeat: shift(fx.startBeat) },
        }))

      const carried = laneActions.length + fxActions.length
      return {
        actions: [
          ...ordered.map(c => ({ type: 'MOVE_CLIP', clipId: c.id, startBeat: Math.max(0, c.startBeat + by) })),
          ...laneActions,
          ...fxActions,
        ],
        // The automation is mentioned because its absence was the bug. "Moved
        // all 6 clips one bar later" was true and complete-sounding while the
        // filter sweeps stayed where they were.
        // Says what was LEFT as well as what moved: "except" is only believable
        // if the read-back proves it was heard.
        say: `Moved ${target ? (target.startsWith('#') ? `${clips.length} selected clip${clips.length === 1 ? '' : 's'}` : `${clips.length} clip${clips.length === 1 ? '' : 's'} on ${target}`) : `${spared.size ? clips.length : 'all ' + clips.length} clips`}${carried ? ' and their automation' : ''} ${spoken ? describeDuration(spoken, Math.abs(by)) : `${Math.abs(by)} beats`} ${by > 0 ? 'later' : 'earlier'}${spared.size ? `, leaving ${exceptions.join(' and ')} where ${spared.size === 1 ? 'it was' : 'they were'}` : ''}.`,
      }
    }

    // INSERT — "a 1 bar long crash at the beginning"
    case 'insert_clip': {
      // ⚠️ No default sound and no default place. This read `i.sound ||
      // 'crash'` and `?? 0`, so a call with a sound the model left blank, or a
      // position it wrote as "the chorus", put a crash at bar 1 and said so —
      // true, and not what anybody asked for.
      const sound = str(i.sound).trim()
      if (!sound) return fail('Say what to put in — a crash, a kick, a snare, a hat.')
      const place = placeOf(i.at, maps, project)
      if (place.problem) return fail(place.problem)
      if (place.beat == null) return fail(`Say where to put the ${sound} — a bar number, or "the beginning".`)
      const atBeat = place.beat
      const span = spanOf(i.length, atBeat, maps)
      if (span.problem) return fail(span.problem)
      const lengthBeats = span.beats ?? durationToBeats({ bars: 1 }, atBeat, maps) ?? 4
      const existing = resolveTrack(sound, project)
      // ⚠️ THIS PUTS ONE HIT DOWN — a crash, a kick, a snare. The record,
      // 18:09: "use the 1st chord in pad intro and recreate that on the 1st
      // bar, then loop that 4 times" → insert_clip(sound: "Pad") → a one-note
      // clip at pitch 49 on the Pad track, read back as "Added a 1 bar Pad".
      // A single percussive hit on a melodic track is never the chord that
      // was asked for, and saying it was added is the worst kind of true.
      const inst = existing?.instrument?.type
      if (existing && inst && inst !== 'drum' && inst !== 'none') {
        const kindOf = inst === 'plugin' ? 'plugin' : inst === 'sampler' ? 'sampler' : 'synth'
        return fail(`"${existing.name}" is a ${kindOf} track, and this puts down a single drum hit. To reuse part of a clip, say "duplicate the ${existing.name} clip" or "copy the first bar of ${existing.name} to bar 1".`)
      }
      const trackId = existing?.id ?? newId()
      const actions: unknown[] = []
      if (!existing) actions.push({ type: 'ADD_TRACK', id: trackId, name: sound.replace(/\b\w/g, c => c.toUpperCase()) })
      actions.push({
        type: 'ADD_CLIP',
        clip: {
          id: newId(), trackId, kind: 'midi', name: sound,
          startBeat: atBeat, durationBeats: lengthBeats, loopEnabled: false,
          notes: [{ id: newId(), pitch: 49, startBeat: 0, durationBeats: Math.min(1, lengthBeats), velocity: 110 }],
        } as unknown as MidiClip,
      })
      const spoken = span.said
      return {
        actions,
        say: `Added a ${spoken ? describeDuration(spoken, lengthBeats) : `${lengthBeats}-beat`} ${sound} at ${describeBeat(atBeat, maps)}${existing ? ` on ${existing.name}` : ' on a new track'}.`,
      }
    }

    case 'set_tempo': {
      const bpm = spokenNumber(i.bpm as string)
      if (bpm == null || bpm < 20 || bpm > 300) return fail('Say a tempo between 20 and 300.')
      // ⚠️ A place that did not parse used to fall through to the WHOLE-SONG
      // tempo: "128 from the chorus" became 128 everywhere, read back as
      // "Tempo set to 128 bpm" — true, and the wrong thing.
      const place = placeOf(i.at, maps, project)
      if (place.problem) return fail(place.problem)
      const at = place.beat
      if (at == null) {
        // ⚠️ With tempo markers, "set the tempo to 100" means the section the
        // playhead is IN — the transport box does the same. The whole-song
        // SET_TEMPO would retempo only the opening section (the reducer keeps
        // the global number and the beat-0 marker in step) and read back
        // "Tempo set to 100" while the bars being heard stayed at 90.
        const markers = project.tempoMarkers ?? []
        const here = heard?.atBeat ?? 0
        const seg = [...markers].filter(m => m.beat <= here + 1e-3).sort((a, b) => b.beat - a.beat)[0]
        if (seg && seg.beat > 0.01) {
          return {
            actions: [{ type: 'UPDATE_TEMPO_MARKER', markerId: seg.id, tempo: bpm }],
            say: `Tempo set to ${bpm} bpm from ${describeBeat(seg.beat, maps)}.`,
          }
        }
        return { actions: [{ type: 'SET_TEMPO', tempo: bpm }], say: `Tempo set to ${bpm} bpm.` }
      }
      return {
        actions: [{ type: 'ADD_TEMPO_MARKER', marker: { id: newId(), beat: at, tempo: bpm } }],
        say: `Tempo changes to ${bpm} bpm at ${describeBeat(at, maps)}.`,
      }
    }

    case 'set_time_signature': {
      const num = spokenNumber(i.numerator as string)
      const den = spokenNumber(i.denominator as string)
      if (num == null || den == null || num < 1 || den < 1) return fail('Say a time signature, like 3/4.')
      const place = placeOf(i.at, maps, project)
      if (place.problem) return fail(place.problem)
      const at = place.beat
      if (at == null) {
        return { actions: [{ type: 'SET_TIME_SIG', num, den }], say: `Time signature set to ${num}/${den}.` }
      }
      return {
        actions: [{ type: 'ADD_METER_MARKER', marker: { id: newId(), beat: at, num, den } }],
        say: `Time signature changes to ${num}/${den} at ${describeBeat(at, maps)}.`,
      }
    }

    case 'set_loop_region': {
      if (i.start == null && i.end == null && i.length == null && i.enabled != null) {
        return { actions: [{ type: 'SET_LOOP_ENABLED', enabled: !!i.enabled }], say: `Loop ${i.enabled ? 'on' : 'off'}.` }
      }
      const from = placeOf(i.start, maps, project)
      if (from.problem) return fail(from.problem)
      const start = from.beat
      if (start == null) return fail('Say where the loop should start.')
      const till = placeOf(i.end, maps, project)
      if (till.problem) return fail(till.problem)
      const span = spanOf(i.length, start, maps)
      if (span.problem) return fail(span.problem)
      const end = till.beat ?? (span.beats != null ? start + span.beats : null)
      if (end == null || end <= start) return fail('Say where the loop should end.')
      return {
        actions: [
          { type: 'SET_LOOP', start, end },
          { type: 'SET_LOOP_ENABLED', enabled: i.enabled == null ? true : !!i.enabled },
        ],
        say: `Looping ${describeBeat(start, maps)} to ${describeBeat(end, maps)}.`,
      }
    }

    case 'set_track': {
      const patch: Record<string, unknown> = {}
      const said: string[] = []
      if (i.muted != null) { patch.mute = !!i.muted; said.push(i.muted ? 'muted' : 'unmuted') }
      if (i.solo != null) { patch.solo = !!i.solo; said.push(i.solo ? 'soloed' : 'unsoloed') }
      const vol = spokenFraction(i.volume as string)
      if (vol != null) { patch.volume = Math.max(0, Math.min(1, vol)); said.push(`volume ${Math.round(vol * 100)}%`) }
      const pan = spokenNumber(i.pan as string)
      if (pan != null) { patch.pan = Math.max(-1, Math.min(1, pan / 100)); said.push(`pan ${pan > 0 ? 'right' : 'left'} ${Math.abs(pan)}%`) }
      // A move rather than a level — "turn the drum tracks down a bit" —
      // because each track in a set starts from its own fader.
      const by = spokenNumber(i.volumeBy as string)
      const db = spokenNumber(i.volumeDb as string)
      const relative = by != null || db != null
      if (relative) said.push(db != null ? `volume ${db > 0 ? 'up' : 'down'} ${Math.abs(db)} dB` : `volume ${(by ?? 0) > 0 ? 'up' : 'down'} ${Math.abs(by ?? 0)} points`)
      const patchFor = (t: DawTrack): Record<string, unknown> => {
        if (!relative) return patch
        const now = typeof t.volume === 'number' ? t.volume : 0.8
        const next = db != null ? now * Math.pow(10, db / 20) : now + (by ?? 0) / 100
        return { ...patch, volume: Math.max(0, Math.min(1, next)) }
      }
      if (!said.length) return fail('Say what to change about that track.')
      // ── A set of tracks ──────────────────────────────────────────────
      // "mute all the drum tracks", "unmute every muted track", "turn down
      // the tracks with reverb", "mute these" with several clips selected.
      const taddr = trackAddressOf(i, target, project, heard)
      if (taddr) {
        const tracks = addressTracks(project, taddr)
        if (!tracks.length) return fail(`I couldn't find any tracks ${describeTrackAddress(taddr)}.`)
        return {
          actions: tracks.map(t => ({ type: 'UPDATE_TRACK', trackId: t.id, patch: patchFor(t) })),
          say: `${tracks.length} track${tracks.length === 1 ? '' : 's'} ${said.join(', ')}: ${describeTracks(tracks)}.`,
        }
      }
      const track = resolveTrack(target, project)
      if (!track) return fail(`I couldn't find a track called "${target || 'that'}".`)
      return { actions: [{ type: 'UPDATE_TRACK', trackId: track.id, patch: patchFor(track) }], say: `${track.name}: ${said.join(', ')}.` }
    }

    case 'transpose': {
      // By scale degree when asked (lib/pitch-time.ts) — the notes stay in key.
      const degrees = i.degrees != null ? spokenNumber(i.degrees as string) : null
      const scale = degrees ? projectScale(project) : null
      const semis = degrees ? null : spokenNumber(i.semitones as string)
      if (degrees && !scale) return fail('The song\'s scale is chromatic — every note is in it, so a degree is a semitone. Say how many semitones.')
      if (!degrees && (semis == null || semis === 0)) return fail('Say how many semitones to move it.')
      const step = (degrees ?? semis)!
      const got = clipsForEdit(i, target, maps, project, heard, 'transpose', degrees ? { degrees } : { semitones: semis })
      if (got.ask) return { actions: [], say: '', ask: got.ask }
      if (!got.clips.length) return fail(`I couldn't find "${target || 'that'}" to transpose.`)
      const midi = got.clips.filter((c): c is MidiClip => 'notes' in c)
      if (!midi.length) {
        // An AUDIO clip transposes by its pitch shift (the Sample Editor's Pitch, lib/sample-editor.ts) — in semitones only.
        const audio = got.clips.filter((c): c is AudioClip => c.kind === 'audio')
        if (!audio.length || scale) return fail(scale ? 'An audio clip moves in semitones, not scale degrees — say how many semitones.' : `I couldn't find "${target || 'that'}" to transpose.`)
        return {
          actions: audio.map(c => ({ type: 'UPDATE_CLIP', clipId: c.id, patch: { pitchSemitones: clamp(Math.round((c.pitchSemitones ?? 0) + step), -24, 24) } })),
          say: `Pitched ${got.how} ${Math.abs(step)} semitone${Math.abs(step) === 1 ? '' : 's'} ${step > 0 ? 'up' : 'down'}.`,
        }
      }
      const actions: unknown[] = []
      let label = ''
      for (const clip of midi) {
        const pick = pickNotes(clip, i, maps, project)
        if ('problem' in pick) return fail(pick.problem)
        if (!pick.whole && !pick.notes.length) return fail(`I couldn't find ${pick.label} in "${clip.name}".`)
        if (!pick.whole) label = pick.label
        actions.push(...perNote(clip.id, scale ? transposeDegrees(pick.notes, step, scale) : transposeNotes(pick.notes, step)))
      }
      if (!actions.length) return fail('That clip has no notes.')
      const unit = scale ? `scale degree${Math.abs(step) === 1 ? '' : 's'}` : `semitone${Math.abs(step) === 1 ? '' : 's'}`
      return {
        actions,
        say: `Transposed ${label ? `${label} of ` : ''}${got.how} ${Math.abs(step)} ${unit} ${step > 0 ? 'up' : 'down'}.`,
      }
    }

    case 'set_chance': {
      const pct = spokenNumber(i.chance as string)
      if (pct == null) return fail('Say how often — a percentage, "half the time", "always".')
      const chance = Math.max(0, Math.min(100, pct))
      const got = clipsForEdit(i, target, maps, project, heard, 'set_chance', { chance })
      if (got.ask) return { actions: [], say: '', ask: got.ask }
      if (!got.clips.length) return fail(`I couldn't find "${target || 'that'}".`)
      const midi = got.clips.filter((c): c is MidiClip => 'notes' in c)
      if (!midi.length) return fail('That is an audio clip — chance is for notes.')
      const actions: unknown[] = []
      let label = ''
      let count = 0
      for (const clip of midi) {
        const pick = pickNotes(clip, i, maps, project)
        if ('problem' in pick) return fail(pick.problem)
        if (!pick.whole && !pick.notes.length) return fail(`I couldn't find ${pick.label} in "${clip.name}".`)
        if (!pick.whole) label = pick.label
        if (!pick.notes.length) continue
        count += pick.notes.length
        actions.push({ type: 'UPDATE_MIDI_NOTES', clipId: clip.id, notes: pick.notes.map(n => ({ id: n.id, patch: { chance: chance >= 100 ? undefined : chance / 100 } })) })
      }
      if (!actions.length) return fail('That clip has no notes.')
      const how = chance >= 100 ? 'always' : chance <= 0 ? 'never' : chance === 50 ? 'half the time' : `${Math.round(chance)}% of the time`
      return { actions, say: `${label ? `${label[0].toUpperCase()}${label.slice(1)} of ` : ''}${got.how} play${count === 1 ? 's' : ''} ${how} now — ${count} note${count === 1 ? '' : 's'}.` }
    }

    // ── INVERT — upside down, by degree when the song has a key (lib/pitch-time.ts)
    case 'invert_notes': {
      const got = clipsForEdit(i, target, maps, project, heard, 'invert', {})
      if (got.ask) return { actions: [], say: '', ask: got.ask }
      if (!got.clips.length) return fail(`I couldn't find "${target || 'that'}" to invert.`)
      const midi = got.clips.filter((c): c is MidiClip => 'notes' in c)
      if (!midi.length) return fail('That is an audio clip — there are no notes to invert.')
      const scale = projectScale(project)
      const actions: unknown[] = []
      let label = ''
      for (const clip of midi) {
        const pick = pickNotes(clip, i, maps, project)
        if ('problem' in pick) return fail(pick.problem)
        if (!pick.whole && !pick.notes.length) return fail(`I couldn't find ${pick.label} in "${clip.name}".`)
        if (!pick.whole) label = pick.label
        if (pick.notes.length < 2) continue
        actions.push({ type: 'UPDATE_MIDI_NOTES', clipId: clip.id, notes: invertNotes(pick.notes, scale) })
      }
      if (!actions.length) return fail('That needs at least two notes to flip around.')
      return { actions, say: `${label ? `${label[0].toUpperCase()}${label.slice(1)} of ` : ''}${got.how} ${label ? 'is' : 'is'} upside down now${scale ? ', in key' : ''}.` }
    }

    // ── STRETCH — positions and lengths by a factor, from the first note
    case 'stretch_notes': {
      const factor = spokenNumber(i.factor as string)
      if (factor == null || !(factor > 0)) return fail('Say the factor — "twice as long", "half", "by 1.5".')
      if (Math.abs(factor - 1) < 1e-9) return fail('A factor of one changes nothing.')
      const got = clipsForEdit(i, target, maps, project, heard, 'stretch', { factor })
      if (got.ask) return { actions: [], say: '', ask: got.ask }
      if (!got.clips.length) return fail(`I couldn't find "${target || 'that'}" to stretch.`)
      const midi = got.clips.filter((c): c is MidiClip => 'notes' in c)
      if (!midi.length) return fail('That is an audio clip — stretching audio is warping, which is not here yet.')
      const actions: unknown[] = []
      let label = ''
      for (const clip of midi) {
        const pick = pickNotes(clip, i, maps, project)
        if ('problem' in pick) return fail(pick.problem)
        if (!pick.whole && !pick.notes.length) return fail(`I couldn't find ${pick.label} in "${clip.name}".`)
        if (!pick.whole) label = pick.label
        const patches = stretchNotes(pick.notes, factor)
        if (!patches.length) continue
        actions.push({ type: 'UPDATE_MIDI_NOTES', clipId: clip.id, notes: patches })
        // The whole clip stretched grows (or shrinks) with its notes, so half
        // speed is not silently cut in two — the reducer only ever grows.
        if (pick.whole && factor > 1) {
          const end = Math.max(...pick.notes.map(n => n.startBeat + n.durationBeats))
          const lo = Math.min(...pick.notes.map(n => n.startBeat))
          const need = lo + (end - lo) * factor
          if (need > clip.durationBeats) actions.push({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { durationBeats: Math.ceil(need / 4) * 4 } })
        }
      }
      if (!actions.length) return fail('That clip has no notes.')
      const how = factor === 2 ? 'twice as long' : factor === 0.5 ? 'half as long' : `stretched by ${+factor.toFixed(2)}`
      return { actions, say: `${label ? `${label[0].toUpperCase()}${label.slice(1)} of ` : ''}${got.how} is ${how} now.` }
    }

    // ── NOTE SURGERY — split, chop, join, fit, deactivate (lib/note-ops.ts)
    case 'edit_notes': {
      const op = str(i.op).toLowerCase()
      if (!['split', 'chop', 'join', 'fit', 'deactivate', 'activate'].includes(op)) return fail('Say what to do with the notes — split, chop, join, fit, deactivate or activate.')
      const got = clipsForEdit(i, target, maps, project, heard, op, {})
      if (got.ask) return { actions: [], say: '', ask: got.ask }
      if (!got.clips.length) return fail(`I couldn't find "${target || 'that'}".`)
      const midi = got.clips.filter((c): c is MidiClip => 'notes' in c)
      if (!midi.length) return fail(op === 'split' ? 'That is an audio clip — splitting a clip is its own command; say "split the clip at bar 2".' : 'That is an audio clip — these are note edits.')
      const parts = i.parts != null ? spokenNumber(i.parts as string) : null
      const place = i.splitAt != null ? placeOf(i.splitAt, maps, project) : null
      if (place?.problem) return fail(place.problem)
      const actions: unknown[] = []
      let label = ''
      let touched = 0, made = 0
      for (const clip of midi) {
        const pick = pickNotes(clip, i, maps, project)
        if ('problem' in pick) return fail(pick.problem)
        if (!pick.whole && !pick.notes.length) return fail(`I couldn't find ${pick.label} in "${clip.name}".`)
        if (!pick.whole) label = pick.label
        const notes = pick.notes
        if (!notes.length) continue
        if (op === 'split' || op === 'chop') {
          const s = place?.beat != null ? splitAt(notes, place.beat - clip.startBeat, newId) : chopNotes(notes, parts ?? 2, newId)
          if (!s.add.length) continue
          actions.push({ type: 'SPLICE_MIDI_NOTES', clipId: clip.id, remove: s.remove, add: s.add })
          touched += s.remove.length; made += s.add.length
        } else if (op === 'join') {
          const s = joinNotes(notes)
          if (!s.add.length) continue
          actions.push({ type: 'SPLICE_MIDI_NOTES', clipId: clip.id, remove: s.remove, add: s.add })
          touched += s.remove.length; made += s.add.length
        } else if (op === 'fit') {
          const end = str(i.range) === 'loop' && clip.loopEnabled && clip.loopLengthBeats ? clip.loopLengthBeats : clip.durationBeats
          const patches = fitToRange(notes, 0, end)
          if (!patches.length) continue
          actions.push({ type: 'UPDATE_MIDI_NOTES', clipId: clip.id, notes: patches })
          touched += patches.length
        } else {
          const patches = setActive(notes, op === 'activate')
          if (!patches.length) continue
          actions.push({ type: 'UPDATE_MIDI_NOTES', clipId: clip.id, notes: patches })
          touched += patches.length
        }
      }
      if (!actions.length) {
        return fail(op === 'join' ? 'Nothing to join — each key has one note.'
          : op === 'activate' ? 'Those notes are already active.'
            : op === 'deactivate' ? 'Those notes are already deactivated.'
              : op === 'fit' ? 'Those notes already fill it.' : 'Nothing there to cut.')
      }
      const of = `${label ? `${label} of ` : ''}${got.how}`
      const n = (k: number) => `${k} note${k === 1 ? '' : 's'}`
      const say = op === 'join' ? `Joined ${n(touched)} into ${made} in ${of}.`
        : op === 'fit' ? `Fitted ${of} to ${str(i.range) === 'loop' ? 'the loop' : 'the clip'}.`
          : op === 'deactivate' ? `Deactivated ${n(touched)} in ${of} — kept, silent.`
            : op === 'activate' ? `${n(touched)} in ${of} back on.`
              : place?.beat != null ? `Split ${n(touched)} in ${of} at ${describeBeat(place.beat, maps)}.`
                : `${op === 'chop' ? 'Chopped' : 'Split'} ${n(touched)} in ${of} into ${made}.`
      return { actions, say }
    }

    // ── The studio around the song ───────────────────────────────────────
    case 'set_master_volume': {
      const pct = spokenNumber(i.volume as string)
      if (pct == null) return fail('Say what to set the master to, as a percentage.')
      const v = Math.max(0, Math.min(1, pct / 100))
      return {
        actions: [{ type: 'SET_MASTER_VOLUME', volume: v }],
        say: `Master volume ${Math.round(v * 100)}%.`,
      }
    }

    case 'set_swing': {
      const pct = spokenNumber(i.amount as string)
      if (pct == null) return fail('Say how much swing, as a percentage.')
      const v = Math.max(0, Math.min(1, pct / 100))
      return {
        actions: [{ type: 'SET_SWING', swing: v }],
        say: v === 0 ? 'Straightened out.' : `Swing ${Math.round(v * 100)}%.`,
      }
    }

    case 'add_track': {
      const name = str(i.name).trim()
      return {
        actions: [{ type: 'ADD_TRACK', id: newId(), ...(name ? { name } : {}) }],
        say: name ? `Added a track called "${name}".` : 'Added a track.',
      }
    }

    case 'rename_track': {
      const track = resolveTrack(target, project)
      if (!track) return fail(`I couldn't find a track called "${target || 'that'}".`)
      const name = str(i.name).trim()
      if (!name) return fail('Say what to call it.')
      // Renaming onto an existing name makes every later "mute the bass"
      // ambiguous, and the ambiguity would show up much later as a command that
      // mysteriously stopped working.
      if (project.tracks.some(t => t.id !== track.id && foldName(t.name) === foldName(name))) {
        return fail(`There is already a track called "${name}".`)
      }
      return {
        actions: [{ type: 'UPDATE_TRACK', trackId: track.id, patch: { name } }],
        say: `"${track.name}" is now "${name}".`,
      }
    }

    case 'duplicate_track': {
      const track = resolveTrack(target, project)
      if (!track) return fail(`I couldn't find a track called "${target || 'that'}".`)
      return {
        actions: [{ type: 'DUPLICATE_TRACK', trackId: track.id, seed: newId() }],
        say: `Duplicated "${track.name}".`,
      }
    }

    case 'remove_track': {
      // "delete the empty tracks", "remove every muted track" — a set.
      const taddr = trackAddressOf(i, target, project, heard)
      if (taddr) {
        const tracks = addressTracks(project, taddr)
        if (!tracks.length) return fail(`I couldn't find any tracks ${describeTrackAddress(taddr)}.`)
        const clipCount = allClips(project).filter(c => tracks.some(t => t.id === c.trackId)).length
        return {
          actions: tracks.map(t => ({ type: 'REMOVE_TRACK', trackId: t.id })),
          say: `Deleted ${tracks.length} track${tracks.length === 1 ? '' : 's'}${clipCount ? ` and ${clipCount} clip${clipCount === 1 ? '' : 's'}` : ''}: ${describeTracks(tracks)}.`,
        }
      }
      const track = resolveTrack(target, project)
      if (!track) return fail(`I couldn't find a track called "${target || 'that'}".`)
      const clips = allClips(project).filter(c => c.trackId === track.id).length
      return {
        actions: [{ type: 'REMOVE_TRACK', trackId: track.id }],
        say: clips
          ? `Deleted "${track.name}" and its ${clips} clip${clips === 1 ? '' : 's'}.`
          : `Deleted "${track.name}".`,
      }
    }

    // ── Answering, rather than doing ─────────────────────────────────────
    //
    // A query changes nothing and replies in words. The category barely existed
    // before there was a voice to reply with, and it is the best argument for
    // one: the tempo is on screen somewhere, and reading it means stopping what
    // you are doing, looking away, and losing the thought.
    //
    // Every answer is computed from the project. None costs anything, none
    // needs the assistant, and none can be wrong in an interesting way.
    case 'describe': {
      const topic = str(i.topic).toLowerCase()
      const tracks = project.tracks ?? []
      const clips = allClips(project)

      switch (topic) {
        // ⚠️ 'help' was in the schema's enum and had no case, so a model asking
        // "what can you do" got "I don't know how to answer that" — the worst
        // possible answer to that particular question.
        // ── WHAT IS IN THE LIBRARY ──────────────────────────────────
        //
        // ⚠️ The tag vocabulary and the matching were already built and shared
        // between samples and presets — nothing could SAY them. The audit
        // called this the shortest distance between something built and
        // something usable, and it was right: this reads what already exists.
        case 'library': {
          const lib = heard?.library ?? []
          if (!lib.length) return { actions: [], say: 'I cannot see your library from here.' }
          const words = characterWordsIn(target || '')
          const saidLower = (target || '').toLowerCase()
          const namedInstrument = ['piano', 'organ', 'guitar', 'strings', 'brass', 'mallets',
            'woodwind', 'synth', 'drum', 'bass', 'keys', 'pad', 'lead']
            .some(g => new RegExp(`\\b${g}s?\\b`).test(saidLower))
          // ⚠️ The overview is what you get when nothing was asked for. It was
          // checked before the instrument words, so "what pianos do I have"
          // fell into it — no tag word in the sentence, therefore treated as
          // no question at all.
          if (!words.length && !namedInstrument) {
            const groups = new Map<string, number>()
            for (const p of lib) for (const t of presetTags(p)) groups.set(t, (groups.get(t) ?? 0) + 1)
            const top = [...groups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
            return {
              actions: [],
              say: `${lib.length} sounds. Mostly ${top.map(([t, n]) => `${t.toLowerCase()} (${n})`).join(', ')}. `
                + 'Ask for a kind — "what dark pads do I have".',
            }
          }
          const wanted = words.map(x => x.toLowerCase())
          // ⚠️ People name INSTRUMENTS, not tags. "What pianos do I have" is the
          // obvious question and "piano" is not a tag — the tag is Keys. So a
          // word that is not a tag is matched against the group and the name
          // instead, which is how somebody would look for it by eye.
          const said = (target || '').toLowerCase()
          const instrument = ['piano', 'organ', 'guitar', 'strings', 'brass', 'mallets',
            'woodwind', 'synth', 'drum', 'bass', 'keys', 'pad', 'lead']
            .find(g => new RegExp(`\\b${g}s?\\b`).test(said) && !wanted.includes(g))
          const hits = lib.filter(p => {
            const mine = new Set(presetTags(p).map(t => t.toLowerCase()))
            if (!wanted.every(x => mine.has(x))) return false
            if (!instrument) return true
            return (p.group ?? '').toLowerCase().includes(instrument)
              || p.name.toLowerCase().includes(instrument)
          })
          const asked = [...words, ...(instrument ? [instrument] : [])]
          if (!hits.length) {
            return { actions: [], say: `Nothing in your library is ${asked.join(' and ')}.` }
          }
          // ⚠️ Names, not a count. "You have 14" is not an answer anybody can
          // act on; the point of asking is to pick one.
          const names = hits.slice(0, 6).map(p => p.name)
          return {
            actions: [],
            say: `${hits.length} ${asked.join(' ')}: ${names.join(', ')}`
              + `${hits.length > names.length ? `, and ${hits.length - names.length} more` : ''}.`,
          }
        }

        // ── IS IT READY YET ─────────────────────────────────────────────
        //
        // Studio state rather than document state — the project cannot say
        // whether it has finished rendering itself, so the studio tells us.
        case 'loading': {
          const l = heard?.loading
          if (!l) return { actions: [], say: 'Everything is ready.' }
          if (l.error) return { actions: [], say: `Loading had trouble: ${l.error}` }
          if (!l.total || l.done >= l.total) return { actions: [], say: 'Everything is ready.' }
          const pct = Math.round((l.done / l.total) * 100)
          return {
            actions: [],
            say: `${l.done} of ${l.total} parts ready, about ${pct}%. `
              + 'The rest play live until they are — you can keep working.',
          }
        }

        case 'help': {
          const groups = commandHelp()
          const total = groups.reduce((n, g) => n + g.items.length, 0)
          return {
            actions: [],
            say: `${total} things, in ${groups.length} groups: ${groups.map(g => `${g.group.toLowerCase()} (${g.items.length})`).join(', ')}. `
              + 'Ask for any of them in your own words, or open the book icon in the voice window to read the whole list.',
          }
        }

        case 'tempo':
          return {
            actions: [],
            say: `${Math.round(project.tempo)} BPM, in ${project.timeSignatureNum}/${project.timeSignatureDen}.`,
          }

        case 'tracks': {
          if (!tracks.length) return { actions: [], say: 'There are no tracks yet.' }
          const names = tracks.map(t => t.name).filter(Boolean)
          return {
            actions: [],
            say: `${tracks.length} track${tracks.length === 1 ? '' : 's'}: ${names.join(', ')}.`,
          }
        }

        case 'muted': {
          const muted = tracks.filter(t => t.mute).map(t => t.name)
          const soloed = tracks.filter(t => t.solo).map(t => t.name)
          const parts: string[] = []
          if (muted.length) parts.push(`${muted.join(' and ')} ${muted.length === 1 ? 'is' : 'are'} muted`)
          // Solo is reported even when the question was about muting. A
          // forgotten solo is the more common way to lose a track and it looks
          // nothing like a mute from across the room, so the honest answer to
          // "is anything muted" mentions it.
          if (soloed.length) parts.push(`${soloed.join(' and ')} ${soloed.length === 1 ? 'is' : 'are'} soloed`)
          return { actions: [], say: parts.length ? `${parts.join(', and ')}.` : 'Nothing is muted or soloed.' }
        }

        case 'length': {
          if (!clips.length) return { actions: [], say: 'The song is empty.' }
          const end = Math.max(...clips.map(c => c.startBeat + c.durationBeats))
          const seconds = beatToSeconds(end, maps.tempo)
          const mins = Math.floor(seconds / 60)
          const secs = Math.round(seconds % 60)
          const howLong = mins
            ? `${mins} minute${mins === 1 ? '' : 's'} ${secs} second${secs === 1 ? '' : 's'}`
            : `${secs} second${secs === 1 ? '' : 's'}`
          return { actions: [], say: `The song runs to ${describeBeat(end, maps)} — about ${howLong}.` }
        }

        case 'clips': {
          const named = str(i.target).trim()
          if (named) {
            const track = resolveTrack(named, project)
            if (!track) return fail(`I couldn't find a track called "${named}".`)
            const on = clips.filter(c => c.trackId === track.id).sort((a, b) => a.startBeat - b.startBeat)
            if (!on.length) return { actions: [], say: `"${track.name}" has no clips.` }
            return {
              actions: [],
              say: `"${track.name}" has ${on.length} clip${on.length === 1 ? '' : 's'}, at ${on.map(c => describeBeat(c.startBeat, maps)).join(', ')}.`,
            }
          }
          return { actions: [], say: `${clips.length} clip${clips.length === 1 ? '' : 's'} in the arrangement.` }
        }

        // ── What is it playing? ──────────────────────────────────────────
        //
        // Brae: "What note is pad a playing in?" and "What are the filters on
        // bass 1?"
        //
        // Both were already answerable and neither was being asked. The
        // executor is handed the whole project — every note with its pitch and
        // timing, every effect with its parameters — so these are arithmetic on
        // data already in the room, not a new capability.
        case 'notes': {
          const named = str(i.target).trim()
          if (!named) return fail('Say which track or clip you mean.')
          const found = resolveClip(named, project)
          if (!found) return fail(`I couldn't find "${named}".`)
          const clip = found.clip
          if (!('notes' in clip)) return { actions: [], say: `${found.how} is audio, not notes.` }
          const notes = (clip as MidiClip).notes
          if (!notes.length) return { actions: [], say: `${found.how} has no notes.` }

          const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
          const pitches = notes.map(n => n.pitch)
          const low = Math.min(...pitches)
          const high = Math.max(...pitches)
          const spell = (p: number) => `${NAMES[((p % 12) + 12) % 12]}${Math.floor(p / 12) - 1}`

          // One pitch class throughout is a part on one note, and saying "C2 to
          // C2" would be a strange way to put that.
          const classes = [...new Set(pitches.map(p => ((p % 12) + 12) % 12))]
          if (classes.length === 1) {
            return {
              actions: [],
              say: `${found.how} plays ${NAMES[classes[0]]} — ${notes.length} note${notes.length === 1 ? '' : 's'}${low === high ? ` at ${spell(low)}` : `, ${spell(low)} to ${spell(high)}`}.`,
            }
          }

          // Chords where there are chords: notes that start together are a
          // chord, and naming them is far more use than listing pitches.
          const chords = groupIntoChords(notes).filter(c => c.pitches.length > 1)
          if (chords.length) {
            const names = [...new Set(chords.map(c => nameChord(c.pitches)))].filter(Boolean)
            return {
              actions: [],
              say: `${found.how}: ${names.slice(0, 6).join(', ')}${names.length > 6 ? `, and ${names.length - 6} more` : ''} — ${spell(low)} to ${spell(high)}.`,
            }
          }

          const heard = [...new Set(classes.map(c => NAMES[c]))]
          return {
            actions: [],
            say: `${found.how} plays ${heard.join(', ')} — ${notes.length} notes from ${spell(low)} to ${spell(high)}.`,
          }
        }

        case 'effects': {
          const named = str(i.target).trim()
          if (!named) return fail('Say which track you mean.')
          const track = resolveTrack(named, project)
          if (!track) return fail(`I couldn't find a track called "${named}".`)
          const fx = track.effects ?? []
          if (!fx.length) return { actions: [], say: `"${track.name}" has no effects on it.` }

          // The parameter that actually matters, per effect. A list of names
          // answers "is there a filter"; the setting answers "what is it
          // doing", which is the question people mean.
          const describeOne = (e: TrackEffect): string => {
            const px = e.params as unknown as Record<string, unknown>
            const num = (k: string) => (typeof px[k] === 'number' ? px[k] as number : null)
            switch (e.type) {
              case 'filter': {
                const hz = num('frequency')
                const kind = typeof px.type === 'string' ? px.type : 'lowpass'
                return `a ${kind} at ${hz != null ? (hz >= 1000 ? `${(hz / 1000).toFixed(1)}k` : Math.round(hz)) : '?'} hertz`
              }
              case 'reverb': case 'delay': {
                const wet = num('wet')
                return `${e.type} at ${wet != null ? Math.round(wet * 100) : '?'}%`
              }
              case 'compressor': case 'limiter': {
                const th = num('threshold')
                return `a ${e.type} at ${th != null ? Math.round(th) : '?'} dB`
              }
              case 'saturator': {
                const d = num('drive')
                return `saturation at ${d != null ? Math.round(d * 100) : '?'}%`
              }
              case 'eq3': return 'a three-band EQ'
              default: return e.type
            }
          }
          const disabled = fx.filter(e => (e.params as { enabled?: boolean })?.enabled === false).length
          return {
            actions: [],
            say: `"${track.name}" has ${fx.map(describeOne).join(', ')}.${disabled ? ` ${disabled} bypassed.` : ''}`,
          }
        }

        case 'instrument': {
          const named = str(i.target).trim()
          if (!named) return fail('Say which track you mean.')
          const track = resolveTrack(named, project)
          if (!track) return fail(`I couldn't find a track called "${named}".`)
          const clips = allClips(project).filter(c => c.trackId === track.id)
          const presets = [...new Set(clips.map(c => (c as { presetId?: string }).presetId).filter(Boolean))]
          const kind = track.instrument?.type ?? 'none'
          const what = presets.length ? presets.join(', ')
            : kind === 'none' ? 'no instrument of its own' : kind
          return {
            actions: [],
            say: `"${track.name}" is ${what}, with ${clips.length} clip${clips.length === 1 ? '' : 's'}.`,
          }
        }

        case 'automation': {
          const named = str(i.target).trim()
          const lanes = project.automationLanes ?? []
          if (named) {
            const track = resolveTrack(named, project)
            if (!track) return fail(`I couldn't find a track called "${named}".`)
            const mine = lanes.filter(l => l.trackId === track.id && l.points?.length)
            if (!mine.length) return { actions: [], say: `Nothing is automated on "${track.name}".` }
            return {
              actions: [],
              say: `"${track.name}" has ${mine.map(l => `${l.label || l.parameter} with ${l.points.length} points`).join(', ')}.`,
            }
          }
          const active = lanes.filter(l => l.points?.length)
          if (!active.length) return { actions: [], say: 'Nothing is automated yet.' }
          const byTrack = new Map<string, number>()
          for (const l of active) byTrack.set(l.trackId, (byTrack.get(l.trackId) ?? 0) + 1)
          const named2 = [...byTrack.entries()].map(([id, n]) => {
            const t = project.tracks.find(x => x.id === id)
            return `${t?.name ?? 'a track'} (${n})`
          })
          return { actions: [], say: `Automation on ${named2.join(', ')}.` }
        }

        case 'key': {
          const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
          const key = (project as { key?: number }).key ?? 0
          const scale = (project as { scale?: string }).scale ?? 'major'
          return { actions: [], say: `${NAMES[key % 12]} ${scale}.` }
        }

        case 'volume': {
          const named = str(i.target).trim()
          if (!named) {
            return { actions: [], say: `The master is at ${Math.round((project.masterVolume ?? 1) * 100)}%.` }
          }
          const track = resolveTrack(named, project)
          if (!track) return fail(`I couldn't find a track called "${named}".`)
          const bits = [`${Math.round((track.volume ?? 0) * 100)}%`]
          if (track.mute) bits.push('muted')
          if (track.solo) bits.push('soloed')
          const pan = Math.round((track.pan ?? 0) * 100)
          if (pan !== 0) bits.push(`panned ${Math.abs(pan)}% ${pan < 0 ? 'left' : 'right'}`)
          return { actions: [], say: `"${track.name}" is at ${bits.join(', ')}.` }
        }

        case 'position': {
          // ⚠️ The record, 17:55: "Where is the playhead right now?" → "The
          // loop is set from bar 1 to bar 71, but looping is off." The
          // playhead is not in the project, so this answered about the loop
          // instead — a true sentence about the wrong thing. The studio DOES
          // tell the planner where the playhead is (heard.atBeat); it just
          // was not read here.
          const from = describeBeat(project.loopStart ?? 0, maps)
          const to = describeBeat(project.loopEnd ?? 0, maps)
          const loop = project.loopEnabled ? ` Looping ${from} to ${to}.` : ''
          if (heard?.atBeat != null && Number.isFinite(heard.atBeat)) {
            return { actions: [], say: `The playhead is at ${describeBeat(heard.atBeat, maps)}.${loop}` }
          }
          return {
            actions: [],
            say: project.loopEnabled
              ? `Looping ${from} to ${to}.`
              : `The loop is set from ${from} to ${to}, but looping is off.`,
          }
        }

        default:
          return fail('I don\'t know how to answer that.')
      }
    }

    case 'set_key_scale': {
      // ⚠️ A NAME or a number. The schema asks for a semitone because that is
      // what the action carries, but a model asked for "F minor" has to convert
      // it first, and that is a step it can silently get wrong. Accepting both
      // removes the conversion rather than hoping it goes well.
      const NOTE_PC: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }
      const named = /^\s*([a-g])\s*(sharp|#|flat|b|♭)?\s*$/i.exec(str(i.key))
      let key = spokenNumber(i.key as string)
      if (named) {
        const base = NOTE_PC[named[1].toLowerCase()]
        const acc = named[2]?.toLowerCase()
        key = base + (acc === 'sharp' || acc === '#' ? 1 : acc ? -1 : 0)
        key = ((key % 12) + 12) % 12
      }
      const scale = str(i.scale).toLowerCase() || 'major'
      if (key == null || key < 0 || key > 11) return fail('Say a key, like F minor.')
      const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
      return {
        actions: [{ type: 'SET_KEY_SCALE', key, scale }],
        say: `Key set to ${NAMES[key]} ${scale}.`,
      }
    }

    case 'remove_clip': {
      // ── Many at once ───────────────────────────────────────────────────
      //
      // The record, 23:43: "Delete all pad intro part" → one clip, five times
      // over, one command each. "All", a number, a place or a length names a
      // SET, and the set is deleted together — as one undo step.
      const addr = clipAddressOf(i, target, maps, project, heard)
      if (addr) {
        const set = addressClips(project, addr)
        if (!set.length) return fail(`I couldn't find any clips ${describeAddress(addr, maps)}.`)
        const tracks = [...new Set(set.map(c => project.tracks.find(t => t.id === c.trackId)?.name).filter(Boolean))]
        return {
          actions: set.map(c => ({ type: 'REMOVE_CLIP', clipId: c.id })),
          say: set.length === 1
            ? `Deleted ${clipLabel(project, set[0])} at ${describeBeat(set[0].startBeat, maps)}.`
            : `Deleted ${set.length} clips ${describeAddress(addr, maps)} on ${tracks.join(' and ')}.`,
        }
      }
      const found = resolveClip(target, project)
      if (!found) return fail(`I couldn't find "${target || 'that'}" to delete.`)
      const track = project.tracks.find(t => t.id === found.clip.trackId)
      return {
        actions: [{ type: 'REMOVE_CLIP', clipId: found.clip.id }],
        say: `Deleted ${clipLabel(project, found.clip)} at ${describeBeat(found.clip.startBeat, maps)}${track ? ` on "${track.name}"` : ''}.`,
      }
    }

    case 'set_all_tracks': {
      const tracks = project.tracks ?? []
      if (!tracks.length) return fail('There are no tracks.')
      if (i.solo === false) {
        const soloed = tracks.filter(t => t.solo)
        if (!soloed.length) return { actions: [], say: 'Nothing was soloed.' }
        return {
          actions: soloed.map(t => ({ type: 'UPDATE_TRACK', trackId: t.id, patch: { solo: false } })),
          say: `Cleared the solo on ${soloed.map(t => t.name).join(' and ')}.`,
        }
      }
      if (i.muted == null) return fail('Say what to change about every track.')
      const wanted = !!i.muted
      const changing = tracks.filter(t => t.mute !== wanted)
      if (!changing.length) {
        return { actions: [], say: wanted ? 'Everything is already muted.' : 'Nothing was muted.' }
      }
      return {
        actions: changing.map(t => ({ type: 'UPDATE_TRACK', trackId: t.id, patch: { mute: wanted } })),
        say: wanted
          ? `Muted all ${changing.length} track${changing.length === 1 ? '' : 's'}.`
          : `Unmuted ${changing.length} track${changing.length === 1 ? '' : 's'}.`,
      }
    }

    // ── The performance, not the arrangement ─────────────────────────────
    case 'quantize': {
      const found = resolveClip(target, project)
      if (!found) return fail(`I couldn't find "${target || 'that'}" to quantize.`)
      const clip = found.clip
      if (!('notes' in clip)) {
        // An AUDIO clip quantizes its transients onto the grid — warp markers
        // (lib/warp.ts), found by the studio from the decoded audio.
        const said = `${str(i.division)} ${str(i.feel)}`.toLowerCase()
        const g = parseGridSaid(said)?.grid ?? spokenNumber(i.division as string) ?? 0.25
        return { actions: [{ type: 'WARP_QUANTIZE', clipId: clip.id, grid: g }], say: `Quantizing ${found.how}'s transients to ${g === 0.25 ? 'sixteenths' : g === 0.5 ? 'eighths' : g === 1 ? 'the beat' : `${g} beats`}.` }
      }
      const notes = (clip as MidiClip).notes
      if (!notes.length) return fail('That clip has no notes.')

      // A quarter note by default: the grid people mean when they do not say.
      //
      // ⚠️ Triplets and dotted values are a MULTIPLIER on the division, not a
      // division of their own — a triplet eighth is TWO THIRDS of an eighth
      // (lib/quantize.ts does the arithmetic; this used to multiply by 3/2 and
      // put swung parts onto a grid that does not exist), and a dotted eighth
      // is one and a half of one.
      const said = `${str(i.division)} ${str(i.feel)}`.toLowerCase()
      const parsed = parseGridSaid(said)
      const triplet = !!parsed?.triplet || /triplet|trip/.test(said)
      const dotted = /dotted|dot\b/.test(said)
      const base = parsed?.grid ?? spokenNumber(i.division as string) ?? 1
      const grid = dotted ? base * 1.5 : base
      if (!(grid > 0)) return fail('That is not a grid I can quantize to.')
      const pct = spokenNumber(i.strength as string)
      const adjustSaid = str(i.adjust).toLowerCase()
      const adjust = /end/.test(adjustSaid) ? 'end' as const : /both/.test(adjustSaid) ? 'both' as const : 'start' as const

      // Partial strength moves notes PART of the way, which is the difference
      // between tightening a performance and flattening it. At 100 it is a
      // snap; below, the feel survives.
      const patches = quantizeWithSettings(notes, { grid, triplet, target: adjust, amount: pct == null ? 100 : clamp(pct, 0, 100) }, 1)
      if (!patches.length) return { actions: [], say: `${found.how} is already on the grid.` }
      return {
        actions: perNote(clip.id, patches),
        say: `Quantized ${patches.length} note${patches.length === 1 ? '' : 's'}${adjust === 'end' ? "' ends" : adjust === 'both' ? "' starts and ends" : ''} on ${found.how}${triplet ? ' to triplets' : ''}${pct != null && pct < 100 ? ` ${Math.round(pct)}% of the way` : ''}.`,
      }
    }

    case 'set_velocity': {
      const got = clipsForEdit(i, target, maps, project, heard, 'set_velocity', {})
      if (got.ask) return { actions: [], say: '', ask: got.ask }
      if (!got.clips.length) return fail(`I couldn't find "${target || 'that'}".`)
      const midi = got.clips.filter((c): c is MidiClip => 'notes' in c)
      if (!midi.length) return fail('That is an audio clip — velocity is a note thing.')

      const absolute = spokenNumber(i.velocity as string)
      const pct = spokenNumber(i.scale as string)
      if (absolute == null && pct == null) return fail('Say how hard, or by how much.')

      const next = (v: number) => {
        const raw = absolute != null ? absolute : v * ((pct ?? 100) / 100)
        // Never to zero: a note at velocity 0 is a note that does not sound,
        // which is a deletion wearing a dynamics command's clothes.
        return Math.max(1, Math.min(127, Math.round(raw)))
      }
      const actions: unknown[] = []
      let label = ''
      let any = 0
      for (const clip of midi) {
        const pick = pickNotes(clip, i, maps, project)
        if ('problem' in pick) return fail(pick.problem)
        if (!pick.whole && !pick.notes.length) return fail(`I couldn't find ${pick.label} in "${clip.name}".`)
        if (!pick.whole) label = pick.label
        any += pick.notes.length
        for (const n of pick.notes) {
          if (next(n.velocity) === n.velocity) continue
          actions.push({ type: 'UPDATE_MIDI_NOTE', clipId: clip.id, noteId: n.id, patch: { velocity: next(n.velocity) } })
        }
      }
      if (!any) return fail('That clip has no notes.')
      if (!actions.length) return { actions: [], say: 'Those notes are already there.' }
      const what = `${label ? `${label} of ` : ''}${got.how}`
      return {
        actions,
        say: absolute != null ? `${what}: velocity ${absolute}.` : `${what}: ${pct}% of the velocity.`,
      }
    }

    case 'split_clip': {
      const found = resolveClip(target, project)
      if (!found) return fail(`I couldn't find "${target || 'that'}" to split.`)
      const clip = found.clip
      const place = placeOf(i.at, maps, project)
      if (place.problem) return fail(place.problem)
      const beat = place.beat
      if (beat == null) return fail('Say where to split it.')
      const offset = beat - clip.startBeat
      if (offset <= 0 || offset >= clip.durationBeats) {
        return fail(`${describeBeat(beat, maps)} is not inside ${found.how}.`)
      }

      // Rebuilt as two rather than trimmed and added, so both halves are
      // ordinary clips with ordinary ids and nothing downstream has to know one
      // of them used to be the other.
      const left = { ...clip, id: newId(), durationBeats: offset }
      const right = { ...clip, id: newId(), startBeat: beat, durationBeats: clip.durationBeats - offset }
      if ('notes' in clip) {
        const notes = (clip as MidiClip).notes
        ;(left as MidiClip).notes = notes
          .filter(n => n.startBeat < offset)
          .map(n => ({ ...n, id: newId() }))
        ;(right as MidiClip).notes = notes
          .filter(n => n.startBeat >= offset)
          .map(n => ({ ...n, id: newId(), startBeat: n.startBeat - offset }))
      }
      return {
        actions: [
          { type: 'REMOVE_CLIP', clipId: clip.id },
          { type: 'ADD_CLIP', clip: left },
          { type: 'ADD_CLIP', clip: right },
        ],
        say: `Split ${found.how} at ${describeBeat(beat, maps)}.`,
      }
    }

    case 'resize_clip': {
      const found = resolveClip(target, project)
      if (!found) return fail(`I couldn't find "${target || 'that'}".`)
      const clip = found.clip
      const span = spanOf(i.length, clip.startBeat, maps)
      if (span.problem) return fail(span.problem)
      const beats = span.beats
      if (beats == null || beats <= 0) return fail('Say how long it should be.')
      return {
        actions: [{ type: 'UPDATE_CLIP', clipId: clip.id, patch: { durationBeats: beats } }],
        say: `${found.how} is now ${describeDuration(span.said!, beats)} long.`,
      }
    }

    case 'remove_effect': {
      const track = resolveTrack(target, project)
      if (!track) return fail(`I couldn't find a track called "${target || 'that'}".`)
      const kind = str(i.effect).toLowerCase()
      const existing = (track.effects ?? []).find(e => e.type === kind)
      if (!existing) return fail(`There is no ${kind || 'effect'} on "${track.name}".`)
      return {
        actions: [{ type: 'REMOVE_EFFECT', trackId: track.id, effectId: existing.id }],
        say: `Took the ${kind} off "${track.name}".`,
      }
    }

    case 'remove_marker': {
      const wanted = foldName(str(i.name))
      const markers = project.cueMarkers ?? []
      if (!wanted) return fail('Say which marker.')
      const hit = markers.find(m => foldName(m.name) === wanted)
        ?? markers.find(m => foldName(m.name).includes(wanted))
      if (!hit) return fail(`I couldn't find a marker called "${str(i.name)}".`)
      return {
        actions: [{ type: 'REMOVE_CUE_MARKER', markerId: hit.id }],
        say: `Removed the "${hit.name}" marker.`,
      }
    }

    // ── The library ──────────────────────────────────────────────────────
    case 'set_instrument': {
      const track = resolveTrack(target, project)
      if (!track) return fail(`I couldn't find a track called "${target || 'that'}".`)
      // An id the caller resolved is taken as given. Without one — or with one
      // the library does not know — what was SAID is resolved here: a name, a
      // kind ("a hihat"), or a folder. See lib/voice/library-match.ts.
      const lib = heard?.library ?? []
      const spoken = str(i.presetName) || str(i.instrument)
      let presetId = str(i.presetId)
      let name = spoken || 'that sound'
      if ((!presetId || !lib.some(p => p.id === presetId)) && spoken && lib.length) {
        const found = findLibrarySound(foldName(spoken).split(' ').filter(Boolean), lib)
        if (found) { presetId = found.sound.id; name = found.sound.name }
      }
      if (!presetId) {
        return fail(spoken && lib.length
          ? `I don't see "${spoken}" in the library. ${describeLibraryKinds(lib)}`.trim()
          : 'I could not find that sound in the library.')
      }

      // A sampled instrument lives on the CLIPS, not on the track: a preset is
      // what a clip plays through, and the track's own instrument is the
      // fallback for clips that name none. Setting it clip by clip is therefore
      // the honest edit — and it means a track whose clips deliberately differ
      // is not flattened by a command about the track.
      const clips = allClips(project).filter(c => c.trackId === track.id)
      if (!clips.length) return fail(`"${track.name}" has no clips to put ${name} on.`)
      // A library SAMPLE rather than a preset: the studio makes the preset
      // (one recording, pitched across the keys — lib/sample-preset.ts) and
      // puts it on the clips. The planner cannot, because the library lives
      // on the machine.
      if (isSampleRef(presetId)) {
        return {
          actions: [{ type: 'USE_SAMPLE', sampleId: sampleRefId(presetId), clipIds: clips.map(c => c.id), name }],
          say: `"${track.name}" is ${name} now, pitched across the keys — ${clips.length} clip${clips.length === 1 ? '' : 's'}.`,
        }
      }
      return {
        actions: clips.map(c => ({ type: 'UPDATE_CLIP', clipId: c.id, patch: { presetId } })),
        say: `"${track.name}" is ${name} now — ${clips.length} clip${clips.length === 1 ? '' : 's'}.`,
      }
    }

    // ── The note stream, before it reaches the instrument ────────────────
    case 'add_midi_effect': {
      const track = resolveTrack(target, project)
      if (!track) return fail(`I couldn't find a track called "${target || 'that'}".`)
      const kind = str(i.effect).toLowerCase()
      const make: Record<string, () => unknown> = {
        arp: defaultArpMidi, chord: defaultChordMidi,
        scale: defaultScaleMidi, velocity: defaultVelocityMidi,
      }
      if (!make[kind]) return fail(`I don't know a MIDI effect called "${str(i.effect) || 'that'}".`)
      if ((track.midiEffects ?? []).some(e => e.type === kind)) {
        return fail(`"${track.name}" already has ${kind === 'arp' ? 'an arpeggiator' : `a ${kind} effect`}.`)
      }
      const params = make[kind]() as Record<string, unknown>
      if (kind === 'arp') {
        const rate = spokenNumber(i.rate as string)
        if (rate != null && rate > 0) params.rate = rate
        const style = str(i.style)
        if (style) params.style = style
      }
      return {
        actions: [{
          type: 'ADD_MIDI_EFFECT', trackId: track.id,
          effect: { id: newId(), type: kind, params },
        }],
        say: kind === 'arp'
          ? `Arpeggiating "${track.name}".`
          : `Added a ${kind} effect to "${track.name}".`,
      }
    }

    case 'remove_midi_effect': {
      const track = resolveTrack(target, project)
      if (!track) return fail(`I couldn't find a track called "${target || 'that'}".`)
      const kind = str(i.effect).toLowerCase()
      const existing = (track.midiEffects ?? []).find(e => e.type === kind)
      if (!existing) return fail(`There is no ${kind} on "${track.name}".`)
      return {
        actions: [{ type: 'REMOVE_MIDI_EFFECT', trackId: track.id, effectId: existing.id }],
        say: `Stopped ${kind === 'arp' ? 'arpeggiating' : `the ${kind} effect on`} "${track.name}".`,
      }
    }

    // ── A stretch of the timeline with a parameter dialled in ────────────
    case 'add_clip_effect': {
      const track = resolveTrack(target, project)
      if (!track) return fail(`I couldn't find a track called "${target || 'that'}".`)
      const said = str(i.parameter)
      const field = CLIP_FX_FIELDS[said] ? said : (CLIP_FX_ALIASES[said.toLowerCase().trim()] ?? said)
      const spec = CLIP_FX_FIELDS[field]
      if (!spec) {
        return fail(`I don't know how to shape "${said || 'that'}". Try low-pass, high-pass, drive, reverb, delay, bitcrush or level.`)
      }

      const pct = spokenNumber(i.amount as string)
      const amount = pct == null ? 1 : Math.max(0, Math.min(1, pct / 100))
      const place = placeOf(i.at, maps, project)
      if (place.problem) return fail(place.problem)
      const startBeat = place.beat ?? 0
      const span = spanOf(i.length, startBeat, maps)
      if (span.problem) return fail(span.problem)
      const beats = span.beats
        // A bar with no stated length covers the track's clips, which is what
        // "over the chorus" means when the chorus is what is on the track.
        ?? (() => {
          const mine = allClips(project).filter(c => c.trackId === track.id)
          if (!mine.length) return 8
          const end = Math.max(...mine.map(c => c.startBeat + c.durationBeats))
          return Math.max(1, end - startBeat)
        })()
      if (beats <= 0) return fail('That bar has no length.')

      return {
        actions: [{
          type: 'ADD_CLIP_EFFECT',
          effect: {
            id: newId(), trackId: track.id, startBeat, durationBeats: beats,
            fx: { [spec.key]: spec.at(amount) },
            // In and back out across the region, which is what makes it a bar
            // rather than a setting — a flat graph would be an effect that
            // simply turns on, and the track rack already does that.
            graph: [
              { beat: 0, value: 0 },
              { beat: 0.5, value: 1 },
              { beat: 1, value: 0 },
            ],
          },
        }],
        // ⚠️ Was `describeDuration({ bars: 0 }, beats)` — hardcoded, so this
        // reported "0 bars" no matter how long the bar actually was. The
        // ACTION was right and the read-back was wrong, which is the worse
        // way round: it teaches somebody to distrust a correct answer.
        say: `${spec.label} bar on "${track.name}" from ${describeBeat(startBeat, maps)}, ${describeDuration(span.said ?? { beats }, beats)}.`,
      }
    }

    // ── Folders in the mixer ─────────────────────────────────────────────
    case 'group_tracks': {
      const names = Array.isArray(i.targets) ? (i.targets as unknown[]).map(str) : []
      if (names.length < 2) return fail('Say at least two tracks to group.')
      const found: DawTrack[] = []
      for (const n of names) {
        const t = resolveTrack(n, project)
        if (!t) return fail(`I couldn't find a track called "${n}".`)
        if (t.kind === 'group') return fail(`"${t.name}" is already a group.`)
        if (!found.some(x => x.id === t.id)) found.push(t)
      }
      if (found.length < 2) return fail('That is one track, not a group.')
      return {
        actions: [{
          type: 'GROUP_TRACKS',
          trackIds: found.map(t => t.id),
          groupId: newId(),
          ...(str(i.name) ? { name: str(i.name) } : {}),
        }],
        say: `Grouped ${found.map(t => `"${t.name}"`).join(' and ')}${str(i.name) ? ` as "${str(i.name)}"` : ''}.`,
      }
    }

    case 'rename_clip': {
      const found = resolveClip(target, project)
      if (!found) return fail(`I couldn't find "${target || 'that'}" to rename.`)
      const name = str(i.name).trim()
      if (!name) return fail('Say what to call it.')
      return {
        actions: [{ type: 'UPDATE_CLIP', clipId: found.clip.id, patch: { name } }],
        say: `That clip is now "${name}".`,
      }
    }

    case 'add_marker': {
      const name = str(i.name).trim()
      if (!name) return fail('Say what to call the marker.')
      // No position means the start, not "wherever" — a marker that lands
      // somewhere unstated is worse than one the speaker has to place.
      const place = placeOf(i.at, maps, project)
      if (place.problem) return fail(place.problem)
      const beat = place.beat ?? 0
      return {
        actions: [{ type: 'ADD_CUE_MARKER', marker: { id: newId(), beat, name } }],
        say: `Marked ${describeBeat(beat, maps)} as "${name}".`,
      }
    }

    case 'add_effect':
    case 'set_effect': {
      const track = resolveTrack(target, project)
      if (!track) return fail(`I couldn't find a track called "${target || 'that'}".`)
      const spokenName = str(i.effect).toLowerCase()
      const built = buildSpokenEffect(spokenName)
      if (!built) return fail(`I don't know an effect called "${str(i.effect) || 'that'}".`)
      const kind = built.type

      const pct = spokenNumber(i.amount as string)
      // ⚠️ `?? []` because a THROW here takes the whole command down with an
      // unhandled error instead of a sentence the user can read. A track
      // without an effects array should produce "I can't do that", not a
      // stack trace — found when a sweep crashed mid-run on exactly this.
      const existing = (track.effects ?? []).find(e => e.type === kind && (
        // Every Apollo device shares the type 'helios', so matching on type
        // alone would call a phaser "the octaver you already have".
        kind !== 'helios' ||
        (e.params as { unit?: { type?: string } })?.unit?.type === spokenName))

      if (!existing) {
        if (call.name === 'set_effect' && pct === 0) {
          return fail(`There is no ${kind} on "${track.name}" to turn down.`)
        }
        const params = built.params as unknown as Record<string, unknown>
        if (pct != null) applyAmount(params, kind, pct)
        return {
          actions: [{ type: 'ADD_EFFECT', trackId: track.id, effect: { id: newId(), type: kind, params } }],
          say: pct != null
            ? `Added ${kind} to "${track.name}" at ${Math.round(pct)}%.`
            : `Added ${kind} to "${track.name}".`,
        }
      }

      if (pct == null) return fail(`"${track.name}" already has ${kind}. Say how much you want.`)
      const params = { ...(existing.params as unknown as Record<string, unknown>) }

      // ⚠️ SAY WHEN NOTHING CHANGED, instead of reporting the value back as
      // though it had been set. Asking for something that is already true is
      // almost always a sign the request was about something else — a span, a
      // different track, a shape over time — and answering "reverb at 100%"
      // sends somebody away believing it was done.
      const wanted = Math.round(pct)

      // ⚠️ A SWITCHED-OFF EFFECT STILL STORES ITS AMOUNT, and both engines gate
      // on the switch rather than the number: buildReverb sets the wet gain to
      // `params.enabled ? params.wet : 0`, and the Helios translation passes
      // `enabled !== false` through as the unit's on flag. So a bypassed reverb
      // sits there holding wet: 1 while the track is completely dry.
      //
      // Reading that stored 1 and answering "already at 100%" is the very
      // failure the no-op guard below exists to prevent, one level down: it
      // reports a number that reaches no audio. Brae heard no reverb and was
      // told it was at 100%, and both statements were true of different things.
      //
      // Asking for an amount on an effect that is off means "I want to hear
      // this", so turn it on. Which of the two happened has to be said out
      // loud — from the outside, "it was already right" and "it was switched
      // off" sound identical, and that gap is the whole bug.
      const bypassed = params.enabled === false
      const before = bypassed ? null : readAmount(params, kind)
      if (before !== null && before === wanted) {
        return fail(`${kind} on "${track.name}" is already at ${wanted}%, so nothing changed. `
          + `If you meant it to STAY there over part of the song, that is an automation — say the span, like "until bar 6".`)
      }

      if (bypassed) params.enabled = true
      applyAmount(params, kind, pct)
      return {
        actions: [{
          type: 'UPDATE_EFFECT', trackId: track.id, effectId: existing.id,
          patch: { params: params as unknown as TrackEffect['params'] },
        }],
        say: bypassed
          ? `${kind} on "${track.name}" was switched off — turned it on at ${wanted}%.`
          : `${kind} on "${track.name}" at ${wanted}%.`,
      }
    }

    // ── THE WORKSPACE ────────────────────────────────────────────────────
    //
    // Brae: "Give Light control over changing visuals, like changing
    // customization options, opening lanes and piano rolls and sequencers."
    //
    // ⚠️ THE PIANO ROLL AND SEQUENCER ARE NOT HERE. open_editor has opened both
    // since it was written, and a second tool answering the same sentence is
    // two chances to pick the wrong one — the "too many rules" problem in
    // miniature. This covers only what had no spoken route at all: the effect
    // rack, an automation lane, and the pads.
    //
    // These change what is on screen and nothing about the song, which makes
    // them the safest thing the assistant can do. Nothing here is undoable
    // because nothing here is a change to the document.
    // ── THE WORKSPACE ─────────────────────────────────────────────────
    //
    // Brae: "look at more navigation options that could be wired into voice
    // control." The view, the overlay, zoom, scroll, snap, the clip Sound
    // panel, a track brought into view — and any command the editor's own
    // palette offers, by name (the studio resolves that one; the planner
    // cannot see the palette). Screen only; the song is untouched.
    case 'workspace': {
      const out: Record<string, unknown> = { type: 'WORKSPACE' }
      const said: string[] = []
      if (str(i.view)) {
        const view = viewOf(str(i.view))
        if (!view) return fail(`I don't know a view called "${str(i.view)}" — arrangement, session or mixer.`)
        out.view = view
        said.push(`${view[0].toUpperCase()}${view.slice(1)} view`)
      }
      const zoom = str(i.zoom).toLowerCase()
      if (zoom) {
        if (!['in', 'out', 'fit'].includes(zoom)) return fail('Say zoom in, zoom out, or fit.')
        out.zoom = zoom
        said.push(zoom === 'fit' ? 'fitted the song to the screen' : `zoomed ${zoom}`)
      }
      if (i.scrollTo != null) {
        const place = placeOf(i.scrollTo, maps, project)
        if (place.problem) return fail(place.problem)
        if (place.beat == null) return fail('Say where to scroll to — "bar 17", "the chorus".')
        out.scrollToBeat = place.beat
        said.push(`showing ${describeBeat(place.beat, maps)}`)
      }
      if (i.snap != null && str(i.snap)) {
        const snap = snapOf(str(i.snap))
        if (!snap) return fail('Say what to snap to — bars, beats, eighths, sixteenths, or off.')
        out.snap = snap
        said.push(snap === 'off' ? 'snap off' : `snapping to ${snapLabel(snap)}`)
      }
      if (i.overlay != null && str(i.overlay)) {
        const kind = overlayOf(str(i.overlay))
        if (!kind) return fail(`I don't have an overlay called "${str(i.overlay)}".`)
        out.overlay = kind
        said.push(kind === 'none' ? 'overlay off' : `${OVERLAY_LABEL[kind]} overlay`)
      }
      if (i.soundPanel === true) {
        const found = target ? resolveClip(target, project) : null
        if (target && !found) return fail(`I couldn't find "${target}".`)
        out.soundPanelClipId = found?.clip.id ?? null
        said.push(`sound panel${found ? ` for ${clipLabel(project, found.clip)}` : ''}`)
      }
      if (str(i.focus)) {
        const track = resolveTrack(str(i.focus), project)
        if (!track) return fail(`I couldn't find a track called "${str(i.focus)}".`)
        out.focusTrackId = track.id
        said.push(`showing "${track.name}"`)
      }
      if (str(i.command)) {
        // The studio runs it and says its name; if it has no such command,
        // the studio says that instead.
        out.command = str(i.command).trim()
        said.push(out.command as string)
      }
      if (!said.length) return fail('Say what to show — a view, an overlay, zoom, a bar, snap, or one of the studio\'s commands.')
      const line = said.join(', ')
      return { actions: [out], say: line ? `${line[0].toUpperCase()}${line.slice(1)}.` : '' }
    }

    case 'show_view': {
      const view = str(i.view).toLowerCase().replace(/[^a-z]/g, '')
      const open = i.open !== false
      const want = (target || '').toLowerCase().trim()
      const track = want ? resolveTrack(want, project) : null
      // A clip by that name, then any clip on a track by that name — "open the
      // piano roll on the bass" names a track and means its clip.

      if (view === 'pads') {
        return { actions: [{ type: 'VIEW_ACTION', view: 'pads', open }], say: open ? 'Pads open.' : 'Pads closed.' }
      }
      // ── The voice card's own bars ────────────────────────────────────
      //
      // The record, 17:52: "Open the list of commands that I can" was answered
      // with a spoken summary of eight groups. Asking to OPEN a list is a view
      // request; the list opens beside the card, and the read-back is short
      // because the thing itself is now on screen.
      if (view === 'help' || view === 'commands' || view === 'library') {
        return { actions: [{ type: 'VIEW_ACTION', view: 'help', open }], say: open ? 'Here is everything I can do.' : 'Closed the list.' }
      }
      if (view === 'transcript' || view === 'log' || view === 'history') {
        return { actions: [{ type: 'VIEW_ACTION', view: 'transcript', open }], say: open ? 'Here is the transcript.' : 'Closed the transcript.' }
      }
      if (view === 'settings' || view === 'usage' || view === 'macros' || view === 'costs' || view === 'shapes') {
        const which = view === 'costs' ? 'usage' : view === 'shapes' ? 'macros' : view
        const label = which === 'settings' ? 'Voice settings' : which === 'usage' ? 'Usage and costs' : 'Named shapes'
        return { actions: [{ type: 'VIEW_ACTION', view: which, open }], say: open ? `${label} open.` : `${label} closed.` }
      }
      if (view === 'colours' || view === 'colors' || view === 'appearance' || view === 'theme') {
        return {
          actions: [{ type: 'VIEW_ACTION', view: 'colours', open }],
          say: open
            ? 'Studio colours open — what would you like to change?'
            : 'Studio colours closed.',
        }
      }
      if (view === 'devices') {
        if (!open) return { actions: [{ type: 'VIEW_ACTION', view: 'devices', open: false }], say: 'Devices closed.' }
        if (!track) return fail(want ? `I can't find a track named "${target}".` : 'Say which track — "open the devices on the pad".')
        return {
          actions: [{ type: 'VIEW_ACTION', view: 'devices', trackId: track.id, open: true }],
          say: `Devices open for "${track.name}".`,
        }
      }
      if (view === 'automation') {
        if (!track) return fail(want ? `I can't find a track named "${target}".` : 'Say which track — "show automation on the drums".')
        const already = (project.automationLanes ?? []).some(l => l.trackId === track.id)
        if (already) return { actions: [], say: `"${track.name}" already has its automation showing.` }
        return {
          actions: [{
            type: 'ADD_AUTOMATION_LANE',
            lane: {
              id: newId(), trackId: track.id, parameter: 'volume', label: 'Volume',
              min: 0, max: 1, defaultValue: track.volume ?? 0.8, points: [], expanded: true,
            },
          }],
          say: `Volume automation open on "${track.name}".`,
        }
      }
      return fail(`I don't know a view called "${str(i.view)}".`)
    }

    // ── BROWSING THE SHELF ───────────────────────────────────────────────
    //
    // Brae: "Is there a way that I can have the program play existing recipes
    // and samples under a tag?... this should help users find recipes and
    // samples."
    //
    // The library lives behind async storage, so the planner cannot read it and
    // does not try — it hands over an intent, exactly as the project commands
    // do, and the studio does the fetching. What it CAN do is refuse to start a
    // browse with nothing to browse for, which would otherwise play the entire
    // library at somebody.
    case 'browse_sounds': {
      const tag = str(i.tag).trim()
      const category = str(i.category).trim()
      const query = str(i.query).trim()
      const kindSaid = str(i.kind).toLowerCase()
      const kind = kindSaid === 'sounds' || kindSaid === 'recipes' || kindSaid === 'beats' ? kindSaid : 'both'
      // ⚠️ Brae: "I asked to see recipes and it said that it can't do that for
      // me." Asking for "the recipes" is a complete request on its own — there
      // are dozens, not thousands, so a browse with no filter is a reasonable
      // thing to want. Sounds are not: an unfiltered library is hours long.
      // Beats are like recipes: a few dozen drum patterns, all worth hearing.
      //
      // (This branch was written once before and never landed: the patch that
      // carried it aborted on an earlier file, and the feature was reported as
      // shipped on the strength of the pieces that had. Hence the test that
      // now plans "show me the recipes" and requires an action.)
      if (!tag && !category && !query && kind !== 'recipes' && kind !== 'beats') {
        return fail('Say what to play — "the recipes", "the beats", "the sounds tagged dark", "the drum samples", "anything with vinyl in the name".')
      }
      const asked = [
        tag && `tagged ${tag}`,
        category && category,
        query && `matching "${query}"`,
      ].filter(Boolean).join(' ')
      return {
        actions: [{ type: 'BROWSE', tag, category, query, asked, kind, preset: str(i.preset).trim() }],
        say: `Finding ${kind === 'recipes' ? 'recipes' : kind === 'beats' ? 'beats' : 'sounds'}${asked ? ` ${asked}` : ''}…`,
      }
    }

    // ── NAMED SHAPES ─────────────────────────────────────────────────────
    //
    // Brae: "at one point I want bass to have descending reverb, ascending low
    // pass, and descending volume to keep steady volume over the clip, and
    // later I ask to do the same thing over a longer clip so the descend and
    // ascend are longer."
    //
    // ⚠️ THE SPAN IS AN ARGUMENT, WHICH IS WHY THE SAME MACRO COVERS BOTH. A
    // macro is (fx, shape) and mentions no clip and no bar, so running it over
    // four bars and over thirty-two is one command with a different argument —
    // not a second macro, and not an edit afterwards. Length applied afterwards
    // is exactly what would break the relationship between the three curves,
    // which is the whole point of "descending volume to keep steady volume".
    case 'define_macro': {
      const raw = (i.fx ?? {}) as Record<string, unknown>
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Object.keys(raw).length) {
        return fail('Say what should move — something like "descending reverb and an opening low-pass".')
      }
      // ⚠️ Only parameters that exist. An invented key would be stored, listed,
      // and silently do nothing every time it ran — the exact shape of failure
      // this file keeps being fixed for.
      const fx: RollFx = {}
      const unknown: string[] = []
      for (const [k, v] of Object.entries(raw)) {
        if (!FX_FIELD_BY_KEY[k]) { unknown.push(k); continue }
        const n = Number(v)
        if (!Number.isFinite(n)) { unknown.push(k); continue }
        ;(fx as Record<string, number>)[k] = n
      }
      if (!Object.keys(fx).length) {
        return fail(`I don't know how to move ${unknown.map(u => `"${u}"`).join(', ') || 'that'}.`)
      }
      const shape = str(i.shape).toLowerCase() as MacroShape
      if (!['fall', 'rise', 'arc', 'dip', 'hold'].includes(shape)) {
        return fail(`I don't know a shape called "${str(i.shape)}" — try fall, rise, arc, dip or hold.`)
      }
      // Applied here rather than emitted as an action, exactly like the spoken
      // shorthand below: a macro is not part of the song, so there is nothing
      // for the reducer to do with it and nothing to undo.
      const m = defineMacro({ name: str(i.name), what: str(i.what), fx, shape })
      const extra = unknown.length ? ` I left out ${unknown.map(u => `"${u}"`).join(', ')}.` : ''
      return {
        actions: [],
        // ⚠️ SAYS THE NAME BACK, and that is not politeness. "Do the same thing"
        // can never be answered for free — it points at the selection, so it is
        // refused by the cache by design. A NAME can, forever. Handing the name
        // over is what turns a paid pronoun into a free noun.
        say: `Saved as "${m.label}" — ${m.what}.${extra} Say "${m.label} on the bass" to use it again.`,
      }
    }

    case 'run_macro': {
      const m = findMacro(str(i.name))
      if (!m) {
        const known = macroNames()
        return fail(known.length
          ? `I don't know a shape called "${str(i.name)}". I have ${known.map(n => `"${n}"`).join(', ')}.`
          : 'I have not been taught any shapes yet — describe one and I will save it.')
      }
      const fromB = placeOf(i.from, maps, project).beat
      const toB = placeOf(i.to, maps, project).beat

      // ⚠️ A STRETCH THAT DID NOT PARSE IS A QUESTION, NOT A CLIP. Asking for
      // bars and silently getting the shape on a clip instead is the worst
      // outcome available here: the read-back would be perfectly true about
      // something nobody asked for. Found by a test that passed the positions
      // as plain strings, which is exactly what a model does sometimes.
      if ((i.from != null || i.to != null) && (fromB == null || toB == null || toB <= fromB)) {
        return fail('I could not work out that stretch — say it like "from bar 9 to bar 25".')
      }

      const want = (target || '').toLowerCase().trim()
      const clips = allClips(project)
      const track = want ? resolveTrack(want, project) : null
      // ⚠️ AN EXACT CLIP NAME WINS; A LOOSE ONE ONLY IF IT IS NOT ALSO A TRACK.
      // "Pad" is a track here and "Pad 1" is a clip on it, so a contains-match
      // would quietly put the shape on the first clip of a track that has four
      // — when naming the track should be asking about the track.
      const namedClip = want
        ? clips.find(c => (c.name ?? '').toLowerCase() === want)
          ?? (track ? null : clips.find(c => (c.name ?? '').toLowerCase().includes(want)))
        : null

      // ── A stretch of bars: an effect bar over the region ────────────────
      if (fromB != null && toB != null && toB > fromB) {
        const onTrack = track ?? (namedClip ? (project.tracks ?? []).find(t => t.id === namedClip.trackId) : null)
        if (!onTrack) return fail('Say which track the shape goes on — "the swell on the bass from bar 9 to 25".')
        useMacro(m.name)
        const durationBeats = toB - fromB
        return {
          actions: [{
            type: 'ADD_CLIP_EFFECT',
            effect: {
              id: newId(), trackId: onTrack.id,
              startBeat: fromB, durationBeats,
              fx: m.fx,
              // ⚠️ In BEATS here — an effect bar reads AutoPoint.t as beats from
              // its own start, while clip motion reads the same field as a
              // fraction. See toPoints.
              graph: toPoints(m.shape, durationBeats),
            },
          }],
          say: `"${m.label}" across ${describeBeat(fromB, maps)} to ${describeBeat(toB, maps)} on "${onTrack.name}" — ${m.what}.`,
        }
      }

      // ── A clip: motion that stretches when the clip does ────────────────
      const clip = namedClip
        ?? (track ? clips.filter(c => c.trackId === track.id) : []).find((_, idx, arr) => arr.length === 1)
      if (!clip) {
        if (track) {
          const n = clips.filter(c => c.trackId === track.id).length
          return fail(n
            ? `"${track.name}" has ${n} clips — say which one, or give me a stretch like "from bar 9 to 25".`
            : `"${track.name}" has nothing on it to put a shape across.`)
        }
        return fail(want
          ? `I can't find "${target}" to put "${m.label}" on.`
          : `Say where — "${m.label} on the bass", or "${m.label} from bar 9 to 25".`)
      }
      useMacro(m.name)
      return {
        actions: [{
          type: 'UPDATE_CLIP', clipId: clip.id,
          // Normalised, so it stretches with the clip rather than ending early
          // when the clip grows — which is what makes "the same over a longer
          // clip" need no second command.
          patch: { fxMotion: { fx: m.fx, graph: toPoints(m.shape) } } as never,
        }],
        say: `"${m.label}" across "${clip.name || track?.name || 'that clip'}" — ${m.what}.`,
      }
    }

    // BEAT FROM VOICE - "make a beat like boom ka boom boom ka"
    case 'make_beat': {
      const pattern = str(i.pattern)
      // Prefer what the MICROPHONE heard over what the model relayed. The model
      // can only pass words; the rhythm lives in their timings, and those exist
      // only on the transcript. Falling back to the relayed syllables still
      // makes a beat - an evenly spaced one - which is the right answer for a
      // typed command and for the browser recogniser, neither of which times
      // anything.
      const fromMic = (heard?.words ?? []).map(w => ({ word: w.word, s: w.s, e: w.e }))
      const spoken = fromMic.length ? fromMic : pattern.split(/\s+/).filter(Boolean).map(word => ({ word }))
      if (!spoken.length) return fail('Say the beat out loud - something like "boom ka boom boom ka".')

      const beat = parseSpokenBeat(spoken, { bpm: project.tempo || 120 })
      if (!beat.hits.length) {
        // Do not invent a beat nobody asked for. Say what was missing.
        return fail('I did not catch any drum sounds in that - try "boom ka boom boom ka".')
      }

      const place = placeOf(i.at, maps, project)
      if (place.problem) return fail(place.problem)
      const at = place.beat ?? 0
      const wanted = str(i.track)
      // The track they named, an existing drum track, or a new one.
      const existing = wanted
        ? resolveTrack(wanted, project)
        : (project.tracks ?? []).find(t => t.instrument?.type === 'drum')
      const trackId = existing?.id ?? newId()
      const actions: unknown[] = []
      if (!existing) {
        actions.push({ type: 'ADD_TRACK', id: trackId, name: 'Drums' })
        // Without this the notes are pitches on a synth, not drums.
        actions.push({ type: 'SET_INSTRUMENT', trackId, instrument: defaultDrumInstrument() })
      }
      actions.push({
        type: 'ADD_CLIP',
        clip: {
          id: newId(), trackId, kind: 'midi', name: 'Spoken beat',
          startBeat: at, durationBeats: beat.bars * 4, loopEnabled: false,
          notes: beatToNotes(beat, newId),
        } as unknown as MidiClip,
      })
      // Say WHICH timing was used. An evenly spaced beat is not the rhythm they
      // said, and letting that pass as success is how a feature earns distrust:
      // they will hear the difference and have no idea why.
      const how = beat.timing === 'heard'
        ? 'in the rhythm you said it'
        : 'evenly spaced - I heard the words but not their timing'
      return {
        actions,
        say: `Made a ${beat.bars === 1 ? 'one-bar' : `${beat.bars}-bar`} beat ${how}: ${describeSpokenBeat(beat)}${existing ? ` on ${existing.name}` : ' on a new Drums track'}.`,
      }
    }

    // ── APOLLO'S OWN LAYERS ─────────────────────────────────────────────
    //
    // Brae: "I told it to 'add sub to pad in Apollo' and it just changed the
    // tempo."
    //
    // ⚠️ There was no tool for this at all, which is the actual fault. A model
    // with nothing right to reach for reaches for something wrong far more
    // readily than it refuses — and the tempo is the worst possible neighbour,
    // because it is loud, immediate and changes everything at once.
    case 'set_apollo_layer': {
      const track = resolveTrack(target, project) ?? (target ? null : null)
      if (!track) return fail(`Say which track — "add sub to the pad".`)
      const inst = track.instrument
      if (inst?.type !== 'apollo') {
        // Honest about WHY, and about what would fix it. "I can't" with no
        // reason is the answer that sends somebody looking for a bug.
        return fail(notApollo(track.name, inst?.type))
      }

      const said = str(i.layer).toLowerCase().trim()
      const oscMatch = /(?:osc|oscillator)\s*([123])/.exec(said)
      const which = oscMatch ? `osc${oscMatch[1]}` : /noise/.test(said) ? 'noise' : /sub|low|bottom/.test(said) ? 'sub' : null
      if (!which) return fail(`I don't know a layer called "${str(i.layer)}". There is the sub, the noise, and oscillators 1 to 3.`)

      const patch = JSON.parse(JSON.stringify(inst.params ?? {})) as Record<string, unknown>
      const node = (oscMatch
        ? (patch.oscs as Record<string, unknown>[] | undefined)?.[Number(oscMatch[1]) - 1]
        : patch[which] as Record<string, unknown> | undefined)
      if (!node) return fail(`That patch has no ${which === 'sub' ? 'sub' : which} to bring in.`)

      const pct = spokenNumber(i.level as string)
      // Asking for it at all means switching it on. "Add sub" with `on` unsaid
      // is the commonest phrasing there is, and reading it as "leave it off but
      // set its level" would be a command that does nothing audible.
      const on = i.on === false ? false : true
      // ⚠️ Before the switch flips: a sub coming on with no reference note set
      // renders one per voice, and a chord in a piano roll then buries the low
      // end until the master limiter clamps the whole mix. See pinSubReference.
      if (which === 'sub' && on) pinSubReference(patch as unknown as ApolloPatch, node.enabled === true)
      node.enabled = on
      if (pct != null) node.level = clamp(pct / 100, 0, 1)
      else if (on && ((node.level as number) ?? 0) <= 0) node.level = 0.5

      const oct = spokenNumber(i.octave as string)
      if (oct != null && which === 'sub') node.octave = clamp(Math.round(oct), -3, 0)

      const label = which === 'sub' ? 'sub' : which === 'noise' ? 'noise' : `oscillator ${oscMatch![1]}`
      return {
        actions: [{ type: 'SET_INSTRUMENT', trackId: track.id, instrument: { ...inst, params: patch } }],
        say: on
          ? `${label} on ${track.name} at ${Math.round(((node.level as number) ?? 0.5) * 100)}%.`
          : `Took the ${label} off ${track.name}.`,
      }
    }

    // ── ONE NOTE ────────────────────────────────────────────────────────
    //
    // ⚠️ Light could transpose, quantise, harmonise, lengthen and reverse notes
    // in bulk — and could not add or delete a single one, because ADD_MIDI_NOTE
    // and REMOVE_MIDI_NOTE were never emitted. That is the gap somebody hits
    // the moment they have the piano roll open and want one more note in it.
    case 'edit_note': {
      const chosen = resolveClipOrAsk(target, project, maps, 'edit_note', i)
      if (chosen.ask) return { actions: [], say: '', ask: chosen.ask }
      const clip = chosen.clip
      if (!clip || clip.kind !== 'midi') return fail(`I couldn't find a part called "${target || 'that'}".`)
      const notes = (clip as MidiClip).notes ?? []
      const doing = str(i.action).toLowerCase() || 'add'

      if (doing === 'remove') {
        if (!notes.length) return fail(`"${clip.name}" has no notes in it.`)
        const which = str(i.which).toLowerCase()
        // ── Notes by address ────────────────────────────────────────────
        // "the third note", "the notes above C5", "every C", "the last
        // chord": one or many, named. See lib/note-address.ts.
        const notesSaid = str(i.notes).trim()
          || (which && !['first', 'last', 'highest', 'lowest'].includes(which) ? `the ${which} note` : '')
        if (notesSaid) {
          const pick = pickNotes(clip as MidiClip, { notes: notesSaid }, maps, project)
          if ('problem' in pick) return fail(pick.problem)
          if (!pick.notes.length) return fail(`I couldn't find ${pick.label} in "${clip.name}".`)
          return {
            actions: pick.notes.map(n => ({ type: 'REMOVE_MIDI_NOTE', clipId: clip.id, noteId: n.id })),
            say: pick.notes.length === 1
              ? `Took the ${pitchName(pick.notes[0].pitch)} (${pick.label}) out of "${clip.name}".`
              : `Took ${pick.notes.length} notes (${pick.label}) out of "${clip.name}".`,
          }
        }
        const said = spokenPitch(str(i.note))
        const pick = said != null
          ? [...notes].reverse().find(n => n.pitch === said)
          : which === 'first' ? [...notes].sort((a, b) => a.startBeat - b.startBeat)[0]
            : which === 'highest' ? [...notes].sort((a, b) => b.pitch - a.pitch)[0]
              : which === 'lowest' ? [...notes].sort((a, b) => a.pitch - b.pitch)[0]
                // "The last note" is the one that starts last, which is what
                // anybody means — not the last one in the array.
                : [...notes].sort((a, b) => b.startBeat - a.startBeat)[0]
        if (!pick) return fail(said != null ? `There is no ${pitchName(said)} in "${clip.name}".` : 'I could not tell which note.')
        return {
          actions: [{ type: 'REMOVE_MIDI_NOTE', clipId: clip.id, noteId: pick.id }],
          say: `Took the ${pitchName(pick.pitch)} out of "${clip.name}".`,
        }
      }

      const pitch = spokenPitch(str(i.note))
      if (pitch == null) return fail('Say which note — "put a C on beat three".')
      // ⚠️ Placed relative to the CLIP, not the song: a note "on beat three"
      // means the third beat of the part being edited, and a position measured
      // from the song's start would land it somewhere nobody asked for.
      const place = placeOf(i.at, maps, project)
      if (place.problem) return fail(place.problem)
      const at = place.beat
      const startBeat = Math.max(0, (at ?? clip.startBeat) - clip.startBeat)
      const span = spanOf(i.length, clip.startBeat + startBeat, maps)
      if (span.problem) return fail(span.problem)
      const length = span.beats
      // Sits in the same octave as the rest of the part unless an octave was
      // said — a bare "C" in a bass part means a low C.
      const octaveless = !/\d/.test(str(i.note))
      const near = notes.length ? Math.round(notes.reduce((n, x) => n + x.pitch, 0) / notes.length) : 60
      const placed = octaveless
        ? pitch + 12 * Math.round((near - pitch) / 12)
        : pitch
      return {
        actions: [{
          type: 'ADD_MIDI_NOTE',
          clipId: clip.id,
          note: { id: newId(), pitch: placed, startBeat, durationBeats: length ?? 1, velocity: 90 },
        }],
        say: `Put a ${pitchName(placed)} in "${clip.name}" at ${describeBeat(clip.startBeat + startBeat, maps)}.`,
      }
    }

    // ── THE PROJECT AS A DOCUMENT ───────────────────────────────────────
    //
    // Opening, versioning and renaming — the things you do to the file rather
    // than to the music. Every one of them was on the audit's unreachable list,
    // and two of them (LOAD_PROJECT, SET_PROJECT_NAME) are reducer actions the
    // voice control simply never emitted.
    //
    // ⚠️ Most of these need the NETWORK, and this planner is pure by design —
    // no fetch, no dispatch, no clock, so that every command can be tested by
    // reading the actions it produces. So it emits an intent and the studio
    // carries it out, the same way NAVIGATE and RECORD_TAKE already work.
    // Renaming is the exception: it is a reducer action and stays one.
    case 'project_action': {
      const what = str(i.action).toLowerCase().trim()
      const name = str(i.name).trim()

      if (what === 'rename') {
        if (!name) return fail('Say what to call it.')
        return {
          actions: [{ type: 'SET_PROJECT_NAME', name }],
          say: `Renamed the project to "${name}".`,
        }
      }
      if ((what === 'open' || what === 'restore_version') && !name) {
        return fail(what === 'open' ? 'Say which project to open.' : 'Say which version to go back to.')
      }
      if (what === 'save_version' && !name) {
        // ⚠️ An unnamed version is a row nobody can identify later, which is
        // the same as not having saved one.
        return fail('Give the version a name — "save a version called before the drop".')
      }
      const SAY: Record<string, string> = {
        open: `Opening "${name}".`,
        new: name ? `Starting a new project called "${name}".` : 'Starting a new project.',
        save_version: `Saved a version called "${name}".`,
        restore_version: `Going back to "${name}".`,
        list_versions: 'Looking at the versions…',
      }
      if (!SAY[what]) return fail(`I don't know how to "${what}" a project.`)
      return { actions: [{ type: 'PROJECT_ACTION', action: what, name }], say: SAY[what] }
    }

    // ── WRITE A PART, WITH A SOUND CHOSEN BY CHARACTER ──────────────────
    //
    // Brae: "Put in a baseline preset that uses low notes of 1 of the darker /
    // melancolic and sad piano presets... It needs to take commands that
    // require multiple steps."
    //
    // ⚠️ That sentence is THREE edits — make a track, choose a sound, write
    // notes — and it could not be done as three commands either, because
    // set_instrument refuses a track with no clips ("has no clips to put that
    // on"). Split into steps it fails in the middle; the steps have to arrive
    // together, which is what one call emitting several actions is for. The id
    // is minted here and referenced by the actions that follow it, the same way
    // effectOn already works in this file.
    case 'write_part': {
      const lib = heard?.library ?? []
      if (!lib.length) return fail('I cannot see your sound library from here.')

      const said = `${str(i.character)} ${str(i.instrument)}`.trim()
      const words = characterWordsIn(said || str(i.character))
      const wantGroup = str(i.instrument).trim() || null
      const match = matchPresetByCharacter(lib, { words, instrument: wantGroup })
      if (!match) {
        return fail(words.length
          ? `I could not find ${words.join(' and ')} ${wantGroup || 'sound'} in your library.`
          : `I could not find a ${wantGroup || 'sound'} in your library.`)
      }
      const preset = match.preset

      // ── the notes ──────────────────────────────────────────────────────
      const bars = Math.max(1, Math.min(32, Math.round(spokenNumber(i.bars as string) ?? 8)))
      const beatsPerBar = project.timeSignatureNum || 4
      const place = placeOf(i.at, maps, project)
      if (place.problem) return fail(place.problem)
      const startBeat = place.beat ?? 0

      // ⚠️ project.key is a NUMBER, 0-11 with C=0 — not a note name. Reading it
      // as a name gave C for every key in the project.
      const rootIdx = ((Math.round(project.key ?? 0) % 12) + 12) % 12
      const scale = ((project.scale ?? 'minor') as ScaleType)
      const steps = SCALE_INTERVALS[scale] ?? SCALE_INTERVALS.minor

      // ⚠️ INSIDE THE SAMPLED RANGE. A preset is samples per note, and notes
      // outside loNote..hiNote are repitched — which is the "plays a bit off"
      // problem. "Low notes" therefore means low FOR THIS PRESET: a fourth
      // above its bottom, which is low without being at the edge where the
      // samples are thinnest.
      const lo = preset.loNote ?? 36
      const hi = preset.hiNote ?? 84
      let root = lo + 5
      while (root + 12 <= Math.min(hi, lo + 24) && root < 48) root += 12
      root = Math.max(lo, Math.min(hi, root - ((root - rootIdx) % 12 + 12) % 12))
      if (root < lo) root += 12

      // A bass movement, not a tune. Scale degrees 1 - 6 - 3 - 7, which is the
      // shape most minor-key songs walk, and it is deliberately NOT a melody:
      // Brae's standing rule is that lead lines get written by hand.
      const DEGREES = [0, 5, 2, 6]
      // Fixed, not random. An unseeded velocity would make the same command
      // produce a different part every time, and this project has already been
      // bitten once by unseeded randomness in a render.
      const VELS = [92, 84, 88, 80]

      const notes = Array.from({ length: bars }, (_, b) => {
        const degree = DEGREES[b % DEGREES.length]
        const pitch = Math.max(lo, Math.min(hi, root + (steps[degree % steps.length] ?? 0)))
        return {
          id: newId(),
          pitch,
          startBeat: b * beatsPerBar,
          // ⚠️ Short of the bar line on purpose. A note held the FULL bar is
          // still sounding when the next one starts, which stacks voices and
          // costs polyphony for something nobody can hear.
          durationBeats: beatsPerBar - 0.2,
          velocity: VELS[b % VELS.length],
        }
      })

      const trackId = newId()
      const clipId = newId()
      const name = str(i.name).trim() || 'Bass'
      // A sample chosen by character ("a dark 808"): the clip is made without
      // a preset and the studio puts the sample on it — see USE_SAMPLE.
      const fromSample = isSampleRef(preset.id)
      return {
        actions: [
          { type: 'ADD_TRACK', id: trackId, name },
          {
            type: 'ADD_CLIP',
            clip: {
              kind: 'midi', id: clipId, trackId, name: `${name} 1`,
              startBeat, durationBeats: bars * beatsPerBar,
              // The preset lives on the CLIP — a sampled instrument is what a
              // clip plays through, not a property of the track.
              ...(fromSample ? {} : { presetId: preset.id }),
              notes,
            },
          },
          ...(fromSample ? [{ type: 'USE_SAMPLE', sampleId: sampleRefId(preset.id), clipIds: [clipId], name: preset.name }] : []),
        ],
        say: `Added "${name}" playing ${match.why}, ${bars} bars from ${describeBeat(startBeat, maps)}, `
          + `low ${pitchName(notes[0].pitch)}.`,
      }
    }

    // ── ANY DIAL IN APOLLO, BY NAME ─────────────────────────────────────
    //
    // Apollo has 166 registered parameters. This is one command for all of
    // them, because the registry already knows every one's path, range, curve
    // and unit — PARAMS is what the mod matrix and the panels read, so a voice
    // command that reads it too cannot drift away from the synth. A tool per
    // dial would have been 166 chances to disagree.
    //
    // See lib/apollo/spoken-params.ts for the half a registry cannot hold:
    // what people actually call these things out loud.
    case 'set_apollo_param': {
      const track = resolveTrack(target, project) ?? (target ? null : null)
      if (!track) return fail(`Say which track — "open the filter on the pad".`)
      const inst = track.instrument
      if (inst?.type !== 'apollo') return fail(notApollo(track.name, inst?.type))

      const said = str(i.parameter)
      const match = matchApolloParam(said)
      if (!match.ok) {
        // ⚠️ Two different refusals, because they are two different problems.
        // "Which level?" is answerable in one word; "I don't know that dial"
        // is not, and running them together helps nobody.
        return match.reason === 'needs-module'
          ? fail(`There are several: ${match.options.join(', ')}. Say which — "the sub level".`)
          : fail(`I don't know a dial called "${said}" in Apollo.`)
      }
      const param = match.param
      const patch = JSON.parse(JSON.stringify(inst.params ?? {})) as ApolloPatch
      const now = readParam(patch, param)
      const dir = /more|up|open|brighter|longer|slower|higher|increase/i.test(str(i.direction)) ? 'more'
        : /less|down|close|darker|shorter|faster|lower|decrease/i.test(str(i.direction)) ? 'less' : null
      const next = resolveValue(param, now, {
        value: spokenNumber(i.value as string),
        percent: spokenNumber(i.percent as string),
        direction: dir,
      })
      if (next == null) return fail(`Say what to set the ${param.def.label} to, or say more or less.`)
      const silent = makeAudible(patch, param)
      if (silent) return fail(silent)
      writeParam(patch, param, next)
      return {
        actions: [{ type: 'SET_INSTRUMENT', trackId: track.id, instrument: { ...inst, params: patch } }],
        // The module is named even when it was assumed, so a default that was
        // wrong is visible immediately rather than a week later.
        say: `${track.name} ${param.moduleLabel} ${param.dial}: ${describeValue(param, next)}.`,
      }
    }

    // ── APOLLO'S SWITCHES ───────────────────────────────────────────────
    //
    // The audit's last Apollo gap: every one of the 166 dials was reachable and
    // none of the CHOICES were. The engine switch matters most — it gates 66 of
    // those dials, so the granular, sample and spectral controls were reachable
    // in name only, on an oscillator that could never be running them.
    case 'set_apollo_switch': {
      const track = resolveTrack(target, project) ?? (target ? null : null)
      if (!track) return fail('Say which track.')
      const inst = track.instrument
      if (inst?.type !== 'apollo') return fail(notApollo(track.name, inst?.type))

      const patch = JSON.parse(JSON.stringify(inst.params ?? {})) as ApolloPatch
      const which = moduleHint(str(i.module) || str(i.target) || 'osc 1') ?? 'osc1'
      const oscIdx = /^osc([123])$/.exec(which) ? Number(which.slice(3)) - 1 : 0
      const osc = patch.oscs?.[oscIdx]
      const setting = str(i.setting).toLowerCase().trim()
      const said = str(i.value).toLowerCase().trim()

      if (setting === 'engine') {
        if (!osc) return fail(`That patch has no oscillator ${oscIdx + 1}.`)
        const ENGINES = ['wavetable', 'sample', 'multisample', 'granular', 'spectral']
        const engine = ENGINES.find(e => said.includes(e) || e.startsWith(said))
        if (!engine) return fail(`I don't know an engine called "${said}". There is ${ENGINES.join(', ')}.`)
        osc.enabled = true
        const before = osc.engine
        osc.engine = engine as typeof osc.engine
        // ⚠️ SAYS WHEN IT WILL BE SILENT. Sample, granular and spectral all
        // play a LOADED SAMPLE — switching to one with an empty slot is an
        // oscillator that makes no sound, and reporting "done" there is the
        // exact failure this file keeps guarding against.
        const needsSample = engine === 'sample' || engine === 'granular' || engine === 'spectral'
        const slot = engine === 'sample' ? osc.smp?.sampleId
          : engine === 'granular' ? osc.gran?.sampleId : osc.spec?.sampleId
        return {
          actions: [{ type: 'SET_INSTRUMENT', trackId: track.id, instrument: { ...inst, params: patch } }],
          say: `Oscillator ${oscIdx + 1} on ${track.name}: ${before} → ${engine}.`
            + (needsSample && !slot ? ' It needs a sample before it makes a sound — pick one from your library.' : ''),
        }
      }

      if (setting === 'warp') {
        if (!osc?.wt) return fail(`That patch has no oscillator ${oscIdx + 1}.`)
        const MODES: Record<string, string> = {
          off: 'off', sync: 'sync', bend: 'bendPlus', pwm: 'pwm', asym: 'asym', flip: 'flip',
          mirror: 'mirror', quantize: 'quantize', squeeze: 'squeeze', fm: 'fm', am: 'am',
          rm: 'rm', saturate: 'saturate', shift: 'shift',
        }
        const mode = MODES[said] ?? Object.entries(MODES).find(([k]) => said.includes(k))?.[1]
        if (!mode) return fail(`I don't know a warp called "${said}". There is ${Object.keys(MODES).join(', ')}.`)
        osc.wt.warp1 = { ...osc.wt.warp1, mode: mode as typeof osc.wt.warp1.mode }
        // A warp at zero amount is a mode nobody can hear — the same trap the
        // dials have, so choosing one gives it something to work with.
        if (mode !== 'off' && (osc.wt.warp1.amount ?? 0) <= 0) osc.wt.warp1.amount = 0.35
        osc.enabled = true
        return {
          actions: [{ type: 'SET_INSTRUMENT', trackId: track.id, instrument: { ...inst, params: patch } }],
          say: `Oscillator ${oscIdx + 1} warp: ${said}${mode !== 'off' ? ` at ${Math.round((osc.wt.warp1.amount ?? 0) * 100)}%` : ''}.`,
        }
      }

      if (setting === 'unison') {
        if (!osc) return fail(`That patch has no oscillator ${oscIdx + 1}.`)
        const n = spokenNumber(said)
        if (n == null) return fail('Say how many voices — 1 to 16.')
        osc.unison = Math.max(1, Math.min(16, Math.round(n)))
        osc.enabled = true
        // ⚠️ Unison multiplies what one note costs. It does not consume
        // allocator slots — poly counts NOTES — but it does multiply the summed
        // level, which is what makes dense chords duck.
        return {
          actions: [{ type: 'SET_INSTRUMENT', trackId: track.id, instrument: { ...inst, params: patch } }],
          say: `Oscillator ${oscIdx + 1}: ${osc.unison} voice${osc.unison === 1 ? '' : 's'}.`
            + (osc.unison > 6 ? ' That is a lot per note — chords will get loud.' : ''),
        }
      }

      if (setting === 'octave') {
        const n = spokenNumber(said)
        if (n == null) return fail('Say which octave — up one, down one.')
        if (which === 'sub') {
          if (!patch.sub) return fail('That patch has no sub.')
          patch.sub.octave = Math.max(-2, Math.min(0, Math.round(n)))
          patch.sub.enabled = true
          pinSubReference(patch, patch.sub.enabled)
          return {
            actions: [{ type: 'SET_INSTRUMENT', trackId: track.id, instrument: { ...inst, params: patch } }],
            say: `Sub octave ${patch.sub.octave}.`,
          }
        }
        if (!osc) return fail(`That patch has no oscillator ${oscIdx + 1}.`)
        osc.octave = Math.max(-4, Math.min(4, Math.round(n)))
        return {
          actions: [{ type: 'SET_INSTRUMENT', trackId: track.id, instrument: { ...inst, params: patch } }],
          say: `Oscillator ${oscIdx + 1} octave ${osc.octave > 0 ? '+' : ''}${osc.octave}.`,
        }
      }
      return fail(`I don't know a switch called "${setting}".`)
    }

    // ── WHICH FILTER APOLLO IS USING ────────────────────────────────────
    //
    // The single biggest change to a sound Apollo can make. A ladder and a comb
    // at the same cutoff are not the same instrument, which is why this is a
    // command and not a dial — and why it is not in PARAMS, where everything is
    // a number the mod matrix can sweep.
    case 'set_apollo_filter': {
      const track = resolveTrack(target, project) ?? (target ? null : null)
      if (!track) return fail(`Say which track — "give the pad a ladder filter".`)
      const inst = track.instrument
      if (inst?.type !== 'apollo') return fail(notApollo(track.name, inst?.type))

      const said = str(i.type)
      const found = matchFilterType(said)
      if (!found) return fail(`I don't know a filter called "${said}". There is ${FILTER_NAMES.slice(0, 8).join(', ')}, and more.`)
      const which = Math.round(spokenNumber(i.filter as string) ?? 1) === 2 ? 1 : 0

      const patch = JSON.parse(JSON.stringify(inst.params ?? {})) as ApolloPatch
      const f = patch.filters?.[which]
      if (!f) return fail(`That patch has no filter ${which + 1}.`)
      f.type = found.id
      // ⚠️ Choosing a filter and hearing one are different things. A patch whose
      // filter is switched off answers "make it a ladder" with silence and a
      // success message, which is the worst pairing there is.
      f.enabled = true
      return {
        actions: [{ type: 'SET_INSTRUMENT', trackId: track.id, instrument: { ...inst, params: patch } }],
        say: `${track.name} filter ${which + 1}: ${found.label}.`,
      }
    }

    // ── A DIAL INSIDE A DEVICE ──────────────────────────────────────────
    //
    // ⚠️ Reads the SAME registry the automation lanes and the device UI read
    // (automatableParams), so a parameter's range here cannot drift from the
    // one the knob uses. Twenty hand-written parameter tables is how "set the
    // ratio to 4" ends up meaning something different in two places.
    case 'set_device_param': {
      const track = resolveTrack(target, project) ?? (target ? null : (project.tracks ?? [])[0])
      if (!track) return fail(`I couldn't find "${target || 'that track'}".`)
      const deviceWord = str(i.device).toLowerCase().trim()
      const wantType = DEVICE_ALIASES[deviceWord] ?? deviceWord

      // The device they named, or — if they only named a dial — whichever
      // device on the track actually has it. "More feedback" is unambiguous
      // when only the delay has feedback.
      const said = str(i.parameter).toLowerCase().trim()
      const PARAM_WORDS: Record<string, string[]> = {
        decay: ['decay', 'size', 'length', 'tail'],
        time: ['time', 'delay'],
        feedback: ['feedback', 'repeats', 'regen'],
        threshold: ['threshold'],
        ratio: ['ratio'],
        attack: ['attack'],
        release: ['release'],
        ceilingDb: ['ceiling', 'limit'],
        frequency: ['frequency', 'freq', 'cutoff', 'hz'],
        rate: ['rate', 'speed'],
        depth: ['depth', 'amount'],
        mix: ['mix', 'wet'],
        q: ['q', 'resonance', 'width'],
      }
      const candidates = (track.effects ?? []).filter(e => !wantType || e.type === wantType)
      let hit: { effect: TrackEffect; param: AutomatableParam } | null = null
      for (const e of candidates) {
        for (const p of automatableParams(e)) {
          const words = PARAM_WORDS[p.key] ?? [p.key.toLowerCase()]
          if (words.some(w => said === w || said.includes(w))) { hit = { effect: e, param: p }; break }
        }
        if (hit) break
      }

      const actions: unknown[] = []
      if (!hit) {
        // Nothing to set: add the device they named, then aim at it. Refusing
        // instead would mean "put a compressor on and set its ratio" needs two
        // sentences, which is exactly the friction this is meant to remove.
        if (!wantType) return fail(`I couldn't find a "${said}" dial on ${track.name}.`)
        const built = buildSpokenEffect(wantType)
        if (!built) return fail(`I don't know a device called "${str(i.device)}".`)
        const id = newId()
        const effect = { id, type: built.type, params: built.params } as TrackEffect
        actions.push({ type: 'ADD_EFFECT', trackId: track.id, effect })
        const param = automatableParams(effect).find(p => {
          const words = PARAM_WORDS[p.key] ?? [p.key.toLowerCase()]
          return words.some(w => said === w || said.includes(w))
        })
        if (!param) return fail(`A ${str(i.device)} has no "${said}" to set.`)
        hit = { effect, param }
      }

      const pct = spokenNumber(i.percent as string)
      const raw = spokenNumber(i.value as string)
      const { param, effect } = hit
      const value = raw != null
        ? clamp(raw, param.min, param.max)
        : pct != null
          ? (param.curve === 'log'
            ? param.min * Math.pow(param.max / param.min, clamp(pct / 100, 0, 1))
            : param.min + clamp(pct / 100, 0, 1) * (param.max - param.min))
          : null
      if (value == null) return fail(`Say what to set the ${param.label.toLowerCase()} to.`)

      actions.push({
        type: 'UPDATE_EFFECT', trackId: track.id, effectId: effect.id,
        patch: {
          params: {
            ...(effect.params as object),
            [param.key]: value,
          } as unknown as TrackEffect['params'],
        },
      })
      return {
        actions,
        say: `${shortNameOf(effect)} ${param.label.toLowerCase()} on ${track.name}: ${+value.toFixed(2)}${param.unit ?? ''}.`,
      }
    }

    // ── THE INSTRUMENT'S OWN SHAPE ──────────────────────────────────────
    case 'set_sound': {
      const track = resolveTrack(target, project) ?? (target ? null : (project.tracks ?? [])[0])
      if (!track) return fail(`I couldn't find "${target || 'that track'}".`)
      const inst = track.instrument
      // ⚠️ Only the synth has an envelope to shape. A drum kit and a sampler
      // have their own ideas of attack, and pretending otherwise would write a
      // field nothing reads — a command that reports success and does nothing.
      // ⚠️ Apollo first. This tool used to refuse it — the one command named
      // for the instrument itself turned away the instrument this app is built
      // around, and "open the filter on the pad" failed on every Apollo track
      // in the project. Its nine names are all real Apollo dials; they just sit
      // at registry paths rather than in a flat params object.
      if (inst?.type === 'apollo') {
        const APOLLO_EQUIV: Record<string, string> = {
          attack: 'envelope 1 attack', decay: 'envelope 1 decay',
          sustain: 'envelope 1 sustain', release: 'envelope 1 release',
          cutoff: 'filter 1 cutoff', resonance: 'filter 1 resonance',
          detune: 'oscillator 1 detune', 'lfo rate': 'lfo 1 rate',
        }
        const askedFor = str(i.parameter).toLowerCase().trim()
        const equiv = APOLLO_EQUIV[askedFor] ?? Object.entries(APOLLO_EQUIV).find(([k]) => askedFor.includes(k))?.[1]
        // ⚠️ LFO DEPTH is the one that has no equivalent: in Apollo how far an
        // LFO reaches is the amount on its matrix route, not a dial on the LFO.
        // Writing it somewhere plausible would be a command that reports
        // success and changes nothing.
        if (!equiv) {
          return fail(askedFor.includes('depth')
            ? `In Apollo an LFO's depth is the amount on its modulation route, not a dial on the LFO. Say "modulate the cutoff with LFO 1 by 30 percent".`
            : `I don't shape "${askedFor || 'that'}" on an Apollo patch.`)
        }
        return planVoiceCall(
          { ...call, name: 'set_apollo_param', input: { target: i.target, parameter: equiv, value: i.value, direction: i.direction } },
          project, heard,
        )
      }
      if (!inst || (inst.type !== 'poly' && inst.type !== 'wavetable' && inst.type !== 'fm')) {
        return fail(`${track.name} is ${inst?.type === 'drum' ? 'a drum kit' : 'not a synth'}, so it has no envelope to shape.`)
      }
      const SOUND_PARAMS: Record<string, { key: string; label: string; min: number; max: number; unit: string; step: number }> = {
        attack: { key: 'attack', label: 'attack', min: 0, max: 4, unit: 's', step: 0.08 },
        decay: { key: 'decay', label: 'decay', min: 0, max: 4, unit: 's', step: 0.1 },
        sustain: { key: 'sustain', label: 'sustain', min: 0, max: 1, unit: '', step: 0.12 },
        release: { key: 'release', label: 'release', min: 0, max: 6, unit: 's', step: 0.15 },
        cutoff: { key: 'filterCutoff', label: 'cutoff', min: 40, max: 18000, unit: 'Hz', step: 0 },
        resonance: { key: 'filterResonance', label: 'resonance', min: 0.1, max: 18, unit: '', step: 1.2 },
        detune: { key: 'detune', label: 'detune', min: -100, max: 100, unit: '¢', step: 6 },
        'lfo rate': { key: 'lfoRate', label: 'LFO rate', min: 0.1, max: 20, unit: 'Hz', step: 1 },
        'lfo depth': { key: 'lfoDepth', label: 'LFO depth', min: 0, max: 1, unit: '', step: 0.15 },
      }
      const said = str(i.parameter).toLowerCase().trim()
      const spec = SOUND_PARAMS[said]
        ?? Object.entries(SOUND_PARAMS).find(([k]) => said.includes(k))?.[1]
      if (!spec) return fail(`I don't shape "${said || 'that'}" on an instrument.`)

      const params = (inst.params ?? {}) as Record<string, number>
      const now = params[spec.key] ?? (spec.key === 'filterCutoff' ? 8000 : spec.min)
      const raw = spokenNumber(i.value as string)
      const dir = str(i.direction).toLowerCase()
      const next = raw != null
        ? clamp(raw, spec.min, spec.max)
        : spec.key === 'filterCutoff'
          // A cutoff moves by ratio: 2 kHz up from 200 Hz is a different move
          // from 2 kHz up from 10 kHz, and only one of them is audible.
          ? clamp(now * (dir === 'less' ? 0.5 : 2), spec.min, spec.max)
          : clamp(now + (dir === 'less' ? -spec.step : spec.step), spec.min, spec.max)
      if (raw == null && !dir) return fail(`Say what to set the ${spec.label} to, or say more or less.`)

      return {
        actions: [{
          type: 'SET_INSTRUMENT', trackId: track.id,
          instrument: { ...inst, params: { ...params, [spec.key]: next } },
        }],
        say: `${track.name} ${spec.label}: ${+next.toFixed(2)}${spec.unit}.`,
      }
    }

    // ── CUT OR BOOST AT A FREQUENCY ─────────────────────────────────────
    case 'eq_band': {
      const track = resolveTrack(target, project) ?? (target ? null : (project.tracks ?? [])[0])
      if (!track) return fail(`I couldn't find "${target || 'that track'}".`)
      const hz = spokenNumber(i.frequency as string)
      if (hz == null || hz < 20 || hz > 20000) return fail('Say a frequency between 20 hertz and 20k.')
      const gainSaid = spokenNumber(i.gain as string)
      const cutting = /cut|reduce|less|remove|take/i.test(str(i.action)) || (gainSaid ?? 0) < 0
      const gain = gainSaid != null ? gainSaid : (cutting ? -3 : 3)

      const fx = effectOn(track, 'eq3', () => ({ ...defaultEq3() } as never))
      // Three bands, so the frequency picks one and moves ITS crossover to sit
      // where they asked. An EQ that boosted "5k" by moving the low band would
      // be worse than refusing.
      const band = hz < 400 ? 'low' : hz < 3000 ? 'mid' : 'high'
      const gainKey = `${band}Gain`
      const freqKey = `${band}Freq`
      const now = (fx.params[gainKey] as number) ?? 0
      return {
        actions: [
          ...fx.actions,
          {
            type: 'UPDATE_EFFECT', trackId: track.id, effectId: fx.id,
            patch: {
              params: {
                ...fx.params,
                [gainKey]: clamp(now + gain, -18, 18),
                [freqKey]: Math.round(hz),
              } as unknown as TrackEffect['params'],
            },
          },
        ],
        say: `${gain < 0 ? 'Cut' : 'Boosted'} ${Math.abs(gain)} dB at ${hz >= 1000 ? `${+(hz / 1000).toFixed(1)}k` : `${Math.round(hz)} Hz`} on ${track.name}.`,
      }
    }

    // ── SEND TO A RETURN ────────────────────────────────────────────────
    case 'send_to': {
      const track = resolveTrack(target, project) ?? (target ? null : null)
      if (!track) return fail(`Say which track to send to the ${str(i.to) || 'return'}.`)
      const returns = project.returnTracks ?? []
      if (!returns.length) return fail('There are no return tracks yet — add one with the +Ret button first.')
      const want = foldName(str(i.to))
      const ret = returns.find(r => foldName(r.name ?? '').includes(want) || want.includes(foldName(r.name ?? '')))
      if (!ret) return fail(`I couldn't find a return called "${str(i.to)}". There is ${returns.map(r => r.name).join(', ')}.`)
      const pct = spokenNumber(i.amount as string)
      const amount = pct == null ? 0.35 : clamp(pct / 100, 0, 1)
      return {
        actions: [{
          type: 'UPDATE_TRACK', trackId: track.id,
          patch: { sendAmounts: { ...(track.sendAmounts ?? {}), [ret.id]: amount } },
        }],
        say: amount === 0
          ? `${track.name} is out of the ${ret.name} send.`
          : `${track.name} → ${ret.name} at ${Math.round(amount * 100)}%.`,
      }
    }

    // ── NUDGE ───────────────────────────────────────────────────────────
    case 'nudge': {
      const found = resolveClip(target, project)
      if (!found) return fail(`I couldn't find "${target || 'that'}" to nudge.`)
      const later = !/earl|forward|back|ahead|before/i.test(str(i.direction)) || /later|back/i.test(str(i.direction))
      const ms = spokenNumber(i.milliseconds as string) ?? 25
      // Milliseconds into beats at THIS tempo — a nudge is a fixed amount of
      // time, not a fraction of a beat, which is the whole reason it is not
      // move_clips.
      const beats = (ms / 1000) * ((project.tempo || 120) / 60)
      const delta = /earl|forward|ahead|before/i.test(str(i.direction)) ? -beats : beats
      const next = Math.max(0, found.clip.startBeat + delta)
      return {
        actions: [{ type: 'MOVE_CLIP', clipId: found.clip.id, startBeat: next }],
        say: `Nudged ${found.how} ${Math.round(ms)}ms ${delta < 0 ? 'earlier' : 'later'}.`,
      }
    }

    // ── RITARDANDO / ACCELERANDO ────────────────────────────────────────
    case 'tempo_ramp': {
      const fromPlace = placeOf(i.at ?? i.from, maps, project)
      if (fromPlace.problem) return fail(fromPlace.problem)
      const from = fromPlace.beat ?? 0
      const toPlace = placeOf(i.to, maps, project)
      if (toPlace.problem) return fail(toPlace.problem)
      const toBeat = toPlace.beat
      const now = project.tempo || 120
      const asked = spokenNumber(i.bpm as string)
      const dir = str(i.direction).toLowerCase()
      const end = asked != null ? asked : dir === 'faster' ? now * 1.15 : now * 0.85
      if (end < 20 || end > 300) return fail('Say a tempo between 20 and 300.')
      const last = toBeat ?? Math.max(from + 16, ...(project.arrangementClips ?? []).map(c => c.startBeat + c.durationBeats))
      if (last <= from) return fail('The ramp has to end after it starts.')

      // ⚠️ Stepped, not a curve. The tempo map holds markers, so a ramp is a
      // handful of them — few enough to see and move by hand afterwards, close
      // enough together that it is heard as a slide rather than as steps.
      const STEPS = 6
      const markers = Array.from({ length: STEPS }, (_, n) => {
        const t = (n + 1) / STEPS
        return {
          type: 'ADD_TEMPO_MARKER',
          marker: {
            id: newId(),
            beat: +(from + (last - from) * t).toFixed(3),
            tempo: Math.round(now + (end - now) * t),
          },
        }
      })
      return {
        actions: markers,
        say: `${end < now ? 'Slowing' : 'Speeding up'} from ${Math.round(now)} to ${Math.round(end)} bpm between ${describeBeat(from, maps)} and ${describeBeat(last, maps)}.`,
      }
    }

    // ── SELECT ──────────────────────────────────────────────────────────
    case 'select': {
      const what = str(i.what).toLowerCase() || 'all'
      const clips = allClips(project)
      if (what === 'none') return { actions: [{ type: 'SELECT', clipIds: [] }], say: 'Nothing selected.' }
      // ── Notes inside a clip — Find & Select by voice (lib/find-notes.ts) ──
      // "select every C in the pad", "select the quiet notes in the lead".
      // The clip is selected too, so the roll opens on it and takes the notes.
      if (what === 'notes' || what === 'note') {
        const found = resolveClip(target, project)
        if (!found || !('notes' in found.clip)) return fail(`I couldn't find a MIDI clip called "${target || 'that'}".`)
        const clip = found.clip as MidiClip
        let pool = clip.notes
        let label = ''
        if (i.notes != null) {
          const pick = pickNotes(clip, i, maps, project)
          if ('problem' in pick) return fail(pick.problem)
          pool = pick.notes
          label = pick.label
        }
        const filterSaid = str(i.filter)
        const f = filterSaid ? parseFilter(filterSaid, s => pitchOf(s)?.pitch ?? null) : null
        if (filterSaid && !f && i.notes == null && !/\bnotes?\b|\ball\b|\beverything\b/.test(filterSaid)) {
          return fail(`I don't know how to pick "${filterSaid}" — try "every C", "the quiet notes", "the short notes", "every other note", "the notes off the scale".`)
        }
        const notes = f ? findNotes(pool, f, { scale: projectScale(project) }) : pool
        if (!notes.length) return fail(`No notes in "${clip.name}" match${f ? ` — ${describeFilter(f)}` : ''}.`)
        return {
          actions: [
            { type: 'SELECT', clipIds: [clip.id], trackId: clip.trackId },
            { type: 'SELECT_NOTES', clipId: clip.id, noteIds: notes.map(n => n.id) },
          ],
          say: `Selected ${notes.length} note${notes.length === 1 ? '' : 's'} in ${clipLabel(project, clip)}${f ? ` — ${describeFilter(f)}` : label ? ` — ${label}` : ''}.`,
        }
      }
      // ── Clips by address: one, several, or all with a name ────────────
      //
      // Brae: "give the voice control control over the multiselect function…
      // so that one can be selected or many with the same name can be
      // selected by name or by place on the track."
      if (what === 'clips' || what === 'clip') {
        const addr = clipAddressOf(i, target, maps, project, heard) ?? { name: parseClipAddress(target).name, which: 'all' as const, track: typeof i.track === 'string' ? i.track : undefined }
        const set = addressClips(project, addr)
        if (!set.length) return fail(`I couldn't find any clips ${describeAddress(addr, maps)}.`)
        const labels = set.slice(0, 4).map(c => clipLabel(project, c))
        return {
          actions: [{ type: 'SELECT', clipIds: set.map(c => c.id), ...(set.length === 1 ? { trackId: set[0].trackId } : {}) }],
          say: set.length === 1
            ? `Selected ${labels[0]} at ${describeBeat(set[0].startBeat, maps)}.`
            : `Selected ${set.length} clips: ${labels.join(', ')}${set.length > 4 ? ', …' : ''}.`,
        }
      }
      if (what === 'track') {
        const track = resolveTrack(target, project)
        if (!track) return fail(`I couldn't find "${target || 'that track'}".`)
        const ids = clips.filter(c => c.trackId === track.id).map(c => c.id)
        return {
          actions: [{ type: 'SELECT', clipIds: ids, trackId: track.id }],
          say: `Focusing on "${track.name}" — what would you like to do?`,
        }
      }
      if (what === 'loop') {
        const a = project.loopStart ?? 0
        const b = project.loopEnd ?? 0
        if (b <= a) return fail('There is no loop set.')
        const ids = clips.filter(c => c.startBeat < b && c.startBeat + c.durationBeats > a).map(c => c.id)
        return {
          actions: [{ type: 'SELECT', clipIds: ids }],
          say: `Selected ${ids.length} clip${ids.length === 1 ? '' : 's'} in the loop.`,
        }
      }
      return {
        actions: [{ type: 'SELECT', clipIds: clips.map(c => c.id) }],
        say: `Selected all ${clips.length} clips.`,
      }
    }

    // ── STRIP BACK ──────────────────────────────────────────────────────
    // ── COLOUR ──────────────────────────────────────────────────────────
    // "colour the pad clips blue", "make the drums track red". A clip name
    // colours the clips it addresses (all of them, if several); a track name
    // with no such clip colours the track.
    case 'set_colour': {
      const col = colourOf(str(i.colour) || str(i.color) || str(i.said))
      if (!col) return fail('Say a colour — red, orange, yellow, green, teal, blue, purple, pink, grey.')
      const wantTrack = str(i.of).toLowerCase() === 'track'
      // "colour all the drum tracks red", "make the muted tracks grey".
      const taddr = (wantTrack || /\btracks\b/.test(target.toLowerCase()) || i.only != null || i.withEffect != null || i.all === true) ? trackAddressOf(i, target, project, heard) : null
      if (taddr) {
        const tracks = addressTracks(project, taddr)
        if (!tracks.length) return fail(`I couldn't find any tracks ${describeTrackAddress(taddr)}.`)
        return {
          actions: tracks.map(t => ({ type: 'UPDATE_TRACK', trackId: t.id, patch: { color: col.hex } })),
          say: tracks.length === 1 ? `"${tracks[0].name}" is ${col.name} now.` : `${tracks.length} tracks are ${col.name} now: ${describeTracks(tracks)}.`,
        }
      }
      const track = resolveTrack(target, project)
      const addr = clipAddressOf(i, target, maps, project, heard) ?? { name: parseClipAddress(target).name, which: 'all' as const }
      const set = wantTrack ? [] : addressClips(project, addr)
      if (set.length && (!track || str(i.of).toLowerCase() === 'clip' || set.some(c => foldName(c.name ?? '') === foldName(parseClipAddress(target).name)))) {
        return {
          actions: set.map(c => ({ type: 'UPDATE_CLIP', clipId: c.id, patch: { color: col.hex } })),
          say: set.length === 1 ? `${clipLabel(project, set[0])} is ${col.name} now.` : `${set.length} clips are ${col.name} now.`,
        }
      }
      if (track) return { actions: [{ type: 'UPDATE_TRACK', trackId: track.id, patch: { color: col.hex } }], say: `"${track.name}" is ${col.name} now.` }
      return fail(`I couldn't find "${target || 'that'}" to colour.`)
    }

    // ── AN AUDIO CLIP'S OWN SHAPE ───────────────────────────────────────
    // Fades, gain, reverse, loop — the things in the clip's own settings that
    // had no way to be said.
    case 'set_clip_audio': {
      const addr = clipAddressOf(i, target, maps, project, heard)
      const set = addr ? addressClips(project, addr) : (() => { const f = resolveClip(target, project); return f ? [f.clip] : [] })()
      if (!set.length) return fail(`I couldn't find "${target || 'that'}".`)
      const patch: Record<string, unknown> = {}
      const said: string[] = []
      if (i.fadeIn != null) { const s = spanOf(i.fadeIn, set[0].startBeat, maps); if (s.problem || s.beats == null) return fail('Say how long the fade in should be — "over one bar".'); patch.fadeIn = s.beats; said.push(`fade in over ${s.said ? describeDuration(s.said, s.beats) : `${s.beats} beats`}`) }
      if (i.fadeOut != null) { const s = spanOf(i.fadeOut, set[0].startBeat, maps); if (s.problem || s.beats == null) return fail('Say how long the fade out should be — "over two beats".'); patch.fadeOut = s.beats; said.push(`fade out over ${s.said ? describeDuration(s.said, s.beats) : `${s.beats} beats`}`) }
      if (i.gain != null) { const g = spokenFraction(i.gain as string); if (g == null) return fail('Say the clip level as a percentage.'); patch.gain = Math.max(0, Math.min(2, g)); said.push(`level ${Math.round(g * 100)}%`) }
      if (typeof i.reverse === 'boolean') { patch.reverse = i.reverse; said.push(i.reverse ? 'reversed' : 'playing forwards') }
      if (typeof i.loop === 'boolean') { patch.loopEnabled = i.loop; said.push(i.loop ? 'looping' : 'not looping') }
      // Tempo leader (lib/tempo-leader.ts): its own reducer action, not a clip patch — only one clip leads.
      const leader = typeof i.tempoLeader === 'boolean' ? i.tempoLeader : null
      if (leader != null) said.push(leader ? 'the tempo leader — the song follows its tempo' : 'no longer the tempo leader')
      // The Sample Editor's settings (lib/sample-editor.ts): warp, its mode, pitch, Seg BPM, the edge fade.
      if (typeof i.warp === 'boolean') { patch.warpEnabled = i.warp; said.push(i.warp ? 'warped to the song tempo' : 'playing at its own tempo') }
      if (i.warpMode != null) {
        const w = str(i.warpMode).toLowerCase()
        const m = /complex|stretch/.test(w) ? 'stretch' : /beat/.test(w) ? 'beats' : /tone/.test(w) ? 'tones' : /texture|grain/.test(w) ? 'texture' : 'repitch'
        patch.warpMode = m; patch.warpEnabled = true
        said.push(`${m === 'stretch' ? 'Complex' : m === 'repitch' ? 'Re-Pitch' : m[0].toUpperCase() + m.slice(1)} mode`)
      }
      if (i.transpose != null) { const st = spokenNumber(i.transpose as string); if (st == null) return fail('Say how many semitones.'); patch.pitchSemitones = clamp(Math.round(st), -24, 24); said.push(`pitch ${st > 0 ? '+' : ''}${Math.round(st)} st`) }
      if (i.detune != null) { const ct = spokenNumber(i.detune as string); if (ct == null) return fail('Say how many cents.'); patch.pitchCents = clamp(Math.round(ct), -100, 100); said.push(`detune ${ct > 0 ? '+' : ''}${Math.round(ct)} ct`) }
      if (typeof i.fade === 'boolean') { patch.clipFade = i.fade; said.push(i.fade ? 'edge fades on' : 'edge fades off') }
      // Slip: the audio slides under the clip, which keeps its place and its
      // length. Per clip, since the room depends on that clip's own trims.
      let slip: { seconds: number; said: string } | null = null
      if (i.slip != null) {
        const s = spanOf(i.slip, set[0].startBeat, maps)
        if (s.problem || s.beats == null) return fail('Say how far to slip it — "20 milliseconds", "half a beat".')
        const back = /\bback|\bearlier|\bleft/.test(str(i.slipDirection).toLowerCase() || 'later')
        const seconds = (s.beats * 60) / (project.tempo || 120) * (back ? -1 : 1)
        slip = { seconds, said: `slipped ${s.said ? describeDuration(s.said, s.beats) : `${s.beats} beats`} ${back ? 'earlier' : 'later'}` }
        said.push(slip.said)
      }
      const segBpm = i.segBpm != null ? spokenNumber(i.segBpm as string) : null
      if (i.segBpm != null && (segBpm == null || segBpm < 20 || segBpm > 999)) return fail('Say the sample\'s tempo in BPM, between 20 and 999.')
      if (segBpm != null) said.push(`Seg BPM ${segBpm}`)
      if (!said.length) return fail('Say what to change — a fade in, a fade out, the level, reverse, loop, warp, pitch, or the sample\'s tempo.')
      const audioOnly = 'fadeIn' in patch || 'fadeOut' in patch || 'gain' in patch || 'reverse' in patch
        || 'warpEnabled' in patch || 'warpMode' in patch || 'pitchSemitones' in patch || 'pitchCents' in patch || 'clipFade' in patch || segBpm != null || leader != null || slip != null
      const targets = audioOnly ? set.filter(c => c.kind === 'audio') : set
      if (!targets.length) return fail(`${clipLabel(project, set[0])} is a MIDI clip — fades, level, reverse, warp, pitch and the tempo leader are for audio clips. Its notes have a Sound panel instead.`)
      // A MIDI clip loops every loopLengthBeats; switching the loop on without
      // one did nothing audible. A bar, or the clip if shorter (lib/clip-time.ts).
      const bar = project.timeSignatureNum || 4
      const patchFor = (c: DawClip) => {
        if (c.kind === 'midi') {
          if (patch.loopEnabled === true && !(c as MidiClip).loopLengthBeats) return { ...patch, loopLengthBeats: Math.max(1, Math.min(c.durationBeats, bar)) }
          if (patch.loopEnabled === false) return { ...patch, loopLengthBeats: undefined }
          return patch
        }
        // Seg BPM: the clip's length follows the sample at that tempo (lib/sample-editor.ts).
        if (segBpm != null) return { ...patch, ...(setSegBpm(c as AudioClip, segBpm) ?? { segBpm }) }
        if (slip) return { ...patch, ...(slipByDrag(c as AudioClip, slip.seconds) ?? {}) }
        return patch
      }
      // ⚠️ An empty patch is not an update. Slip and Seg BPM write nothing into
      // `patch` — they are worked out per clip below — so a sentence that only
      // slipped used to report success and dispatch nothing at all.
      const updates = targets
        .map(c => ({ type: 'UPDATE_CLIP', clipId: c.id, patch: patchFor(c) as Record<string, unknown> }))
        .filter(u => Object.keys(u.patch).length > 0)
      if (slip && !updates.length) {
        const one = clipLabel(project, targets[0])
        return fail(targets[0].kind === 'audio' && (targets[0] as AudioClip).bufferDuration == null
          ? `${one} is still loading — try again in a moment.`
          : `${one} has no room to slip: nothing is trimmed off either end, so there is no audio to slide in from.`)
      }
      // The leader is one clip: the first of the set. Releasing needs no clip.
      const lead = leader == null ? [] : [{ type: 'SET_TEMPO_LEADER', clipId: leader ? targets[0].id : null }]
      return {
        actions: [...updates, ...lead],
        say: `${targets.length === 1 ? clipLabel(project, targets[0]) : `${targets.length} clips`}: ${said.join(', ')}.`,
      }
    }

    // ── A SOUND ASKED FOR BY FEEL (lib/voice/plain-words.ts) ────────────
    //
    // "I want it to sound fuzzier" names no control and no number. The word is
    // looked up, and if it carries two sounds this studio can tell apart, the
    // studio asks WHICH SOUND rather than guessing — one question, with each
    // answer described for somebody who does not know the word. Then it makes
    // the change for real and plays it back, and what it made stays on the
    // table so "a little bit less of it" has something to mean.
    case 'sound_like': {
      const said = str(i.like) || str(i.said)
      const word = plainWordIn(said) ?? plainWordIn(str(heard?.said ?? ''))
      if (!word) return fail(`I don't know what "${said || 'that'}" should sound like. Try brighter, darker, warmer, punchier — or tell me a control and a number.`)

      // Nobody working on one track keeps saying its name — "I want it to
      // sound fuzzier" is about whatever is selected.
      const selected = heard?.selectedTrackId ? project.tracks.find(t => t.id === heard.selectedTrackId)?.name : undefined
      const found = target ? resolveTrackOrClipName(target, project) : null
      const name = found ?? target ?? selected ?? ''
      if (!name) return fail('Say what should sound that way — a track or a clip.')

      const chosen = str(i.sense) ? word.senses.find(s => s.id === str(i.sense)) ?? senseFromAnswer(word, str(i.sense)) : null
      if (!chosen && needsAsking(word)) {
        return {
          actions: [], say: '',
          ask: {
            speak: askText(word),
            options: word.senses.map(s => ({
              label: `${s.label} — ${s.says}`,
              keywords: [s.id, ...s.keywords],
              calls: [{ name: 'sound_like', input: { target: name, like: word.word, sense: s.id, ...(i.amount != null ? { amount: i.amount } : {}) } }],
            })),
          },
        }
      }
      const sense = chosen ?? defaultSense(word)
      const amountSaid = i.amount != null ? spokenNumber(i.amount as string) : null
      const amount = clampAmount(amountSaid ?? sense.amount)
      const inner = planVoiceCall(sense.call(name, amount), project, heard)
      if (inner.problem) return inner

      const span = spanOfTargetFor(name, project)
      const bar = project.timeSignatureNum || 4
      // In the words it was asked in, not the effect rack's. Someone who said
      // "fuzzier" is not helped by "Added saturator to Pad at 40%".
      return {
        ...inner,
        say: `Here's ${describeSense(sense, amount, name)} on ${name}. How does that sound?`,
        actions: [...inner.actions, { type: 'PLAY_SPAN', ...playbackSpan(span, bar, songEndBeat(project)) }],
        proposal: { word: word.word, sense, target: name, span, amount, at: Date.now() },
      }
    }

    // ── BENDING WHAT IS ON THE TABLE (lib/voice/proposal.ts) ────────────
    case 'adjust_it': {
      const p = getProposal()
      if (!p) return fail('There is nothing on the table to change — tell me what to work on.')
      const how = str(i.how).toLowerCase()
      const size = (['little', 'normal', 'lot'].includes(str(i.size)) ? str(i.size) : 'normal') as StepSize
      const bar = project.timeSignatureNum || 4

      if (how === 'keep') return { actions: [], say: 'Nice one.', proposal: null }
      if (how === 'undo') return { actions: [{ type: 'UNDO' }], say: `Took the ${p.word} back off.`, proposal: null }

      if (how === 'ramp_down' || how === 'ramp_up') {
        const parameter = rampParameter(p.sense)
        if (!parameter) return fail(`I can't spread ${describeSense(p.sense, p.amount)} across the bars — that one is either on or off. I can make it stronger or weaker instead.`)
        if (!p.span) return fail('I am not sure how far it should run — say which bars.')
        const ends = rampEnds(p, how, size)
        const inner = planVoiceCall({ name: 'automate_parameter', input: { target: p.target, parameter, from: ends.from, to: ends.to, start: { beat: p.span.start }, end: { beat: p.span.end } } }, project, heard)
        if (inner.problem) return inner
        // ⚠️ Said in the words it was asked in. The automation planner's own
        // sentence is exact and unreadable to a beginner — "low-pass cutoff
        // from 1.1 kHz to 200 Hz until bar 8 beat 4" — and this whole path
        // exists for somebody who does not know what a low-pass is.
        return {
          ...inner,
          say: `${describeSense(p.sense, ends.from, p.target)}, ${how === 'ramp_down' ? 'easing down' : 'building up'} to ${ends.to}% across ${describeSpan(p.span, bar)}. How does that sound?`,
          actions: [...inner.actions, { type: 'PLAY_SPAN', ...playbackSpan(p.span, bar, songEndBeat(project)) }],
          proposal: { ...p, amount: ends.to, ramped: ends, at: Date.now() },
        }
      }

      const amount = stepAmount(p.amount, how === 'less' ? 'less' : 'more', size)
      const inner = planVoiceCall(p.sense.call(p.target, amount), project, heard)
      if (inner.problem) return inner
      return {
        ...inner,
        say: `${describeSense(p.sense, amount, p.target)}. How does that sound?`,
        actions: [...inner.actions, { type: 'PLAY_SPAN', ...playbackSpan(p.span, bar, songEndBeat(project)) }],
        proposal: { ...p, amount, at: Date.now() },
      }
    }

    // ── A SESSION SLOT'S LAUNCH SETTINGS (lib/launch.ts) ────────────────
    // ⚠️ Session slots live in project.sessionGrid, not arrangementClips, so
    // the ordinary clip lookup cannot see them and UPDATE_CLIP cannot change
    // them. This resolves against the grid and writes with SET_SESSION_SLOT.
    case 'set_launch': {
      const want = foldName(target)
      let found: { trackId: string; sceneIndex: number; clip: DawClip } | null = null
      for (const [trackId, row] of Object.entries(project.sessionGrid ?? {})) {
        ;(row ?? []).forEach((c, sceneIndex) => {
          if (!c || found) return
          const name = foldName(c.name ?? '')
          if (want && (name === want || name.includes(want))) found = { trackId, sceneIndex, clip: c }
        })
      }
      if (!found) return fail(`I couldn't find a session slot called "${target || 'that'}".`)
      const slot = found as { trackId: string; sceneIndex: number; clip: DawClip }
      const patch: Record<string, unknown> = {}
      const said: string[] = []
      const mode = str(i.mode).toLowerCase()
      if (mode) {
        const m = /gate|hold/.test(mode) ? 'gate' : /repeat|stutter/.test(mode) ? 'repeat' : /trigger|fire/.test(mode) ? 'trigger' : /toggle/.test(mode) ? 'toggle' : null
        if (!m) return fail('Say trigger, gate, toggle or repeat.')
        patch.launchMode = m
        said.push(`${LAUNCH_MODE_LABEL[m]} — ${LAUNCH_MODE_HELP[m].replace(/\.$/, '').toLowerCase()}`)
      }
      if (typeof i.legato === 'boolean') { patch.legatoLaunch = i.legato; said.push(i.legato ? 'launching legato' : 'starting from the top') }
      if (i.velocity != null) {
        const v = spokenFraction(str(i.velocity))
        if (v == null) return fail('Say the velocity amount as a percentage.')
        patch.velocityAmount = clamp(v, 0, 1)
        said.push(`velocity amount ${Math.round(clamp(v, 0, 1) * 100)}%`)
      }
      const q = str(i.quantize).toLowerCase()
      if (q) {
        const lq = /none|off|instant/.test(q) ? 'none' : /4/.test(q) ? '4bar' : /2/.test(q) ? '2bar' : /bar/.test(q) ? 'bar' : /beat/.test(q) ? 'beat' : null
        if (!lq) return fail('Say none, a beat, a bar, two bars or four bars.')
        patch.launchQuantization = lq
        said.push(`launching on ${lq === 'none' ? 'the press' : lq === 'beat' ? 'the beat' : lq === 'bar' ? 'the bar' : `${lq[0]} bars`}`)
      }
      if (!said.length) return fail('Say what to change — the launch mode, legato, the velocity amount, or when it launches.')
      return {
        actions: [{ type: 'SET_SESSION_SLOT', trackId: slot.trackId, sceneIndex: slot.sceneIndex, clip: { ...slot.clip, ...patch } }],
        say: `${slot.clip.name ?? 'That slot'}: ${said.join(', ')}.`,
      }
    }

    // ── AUDIO → MIDI on a new track (lib/audio-to-track.ts) ─────────────
    // The decoded audio is the studio's: the planner names the clip and the
    // way, VoiceControl slices or hears it (AUDIO_TO_MIDI).
    case 'audio_to_midi': {
      const op = str(i.op).toLowerCase()
      const found = resolveClip(target, project)
      if (!found || found.clip.kind !== 'audio') return fail(`I couldn't find an audio clip called "${target || 'that'}" — only audio converts to MIDI.`)
      const how = clipLabel(project, found.clip)
      const bar = project.timeSignatureNum || 4
      if (op === 'slice') {
        const per = str(i.per).toLowerCase()
        const by = /marker/.test(per) ? 'markers' : /bar/.test(per) ? bar : /32/.test(per) ? 0.125 : /16|sixteen/.test(per) ? 0.25 : /8|eigh/.test(per) ? 0.5
          : /quarter|beat|1\/4/.test(per) ? 1 : /half|1\/2/.test(per) ? 2 : 'transients'
        const max = i.max != null ? spokenNumber(i.max as string) : null
        const perSaid = by === 'transients' ? 'transient' : by === 'markers' ? 'warp marker' : by === bar ? 'bar' : `${by} beats`
        return { actions: [{ type: 'AUDIO_TO_MIDI', clipId: found.clip.id, op: 'slice', per: by, ...(max ? { max: clamp(Math.round(max), 1, 64) } : {}) }], say: `Slicing ${how} to a new MIDI track, one slice per ${perSaid}.` }
      }
      const kind = /harm|chord/.test(op) ? 'harmony' : /drum|beat/.test(op) ? 'drums' : /mel|line|tune|note/.test(op) ? 'melody' : null
      if (!kind) return fail('Say what to convert — the harmony, the melody, or the drums.')
      return { actions: [{ type: 'AUDIO_TO_MIDI', clipId: found.clip.id, op: kind }], say: `Converting ${how}'s ${kind} to MIDI on a new track.` }
    }

    // ── HOW SAMPLES LAND when dropped (lib/import-settings.ts) — a studio setting ──
    case 'import_settings': {
      const out: Record<string, unknown> = { type: 'IMPORT_SETTINGS' }
      const said: string[] = []
      const short = str(i.shortSamples).toLowerCase()
      if (short) {
        const m: ShortSampleMode | null = /one|shot|unwarp/.test(short) ? 'oneshot' : /loop|warp/.test(short) ? 'loop' : /auto|decide/.test(short) ? 'auto' : null
        if (!m) return fail('Say how short samples should land — as one-shots, as loops, or auto.')
        out.shortSamples = m
        said.push(`short samples land as ${SHORT_SAMPLE_LABEL[m].toLowerCase()}${m === 'auto' ? ' (a loop when the length says so, else a one-shot)' : ''}`)
      }
      if (typeof i.autoWarpLong === 'boolean') { out.autoWarpLong = i.autoWarpLong; said.push(i.autoWarpLong ? 'long samples are auto-warped to the song tempo' : 'long samples are left as they are') }
      if (!said.length) return fail('Say what to change — how short samples land (one-shot, loop, auto), or whether long samples are auto-warped.')
      return { actions: [out], say: `From now on, ${said.join('; ')}. Clips already in the song are unchanged.` }
    }

    // ── WARP MARKERS on an audio clip (lib/warp.ts) ──────────────────────
    case 'warp_markers': {
      const op = str(i.op).toLowerCase()
      const found = resolveClip(target, project)
      if (!found || found.clip.kind !== 'audio') return fail(`I couldn't find an audio clip called "${target || 'that'}" — MIDI clips have no warp markers.`)
      const clip = found.clip as AudioClip
      const how = clipLabel(project, clip)
      const bar = project.timeSignatureNum || 4
      const start = clip.trimStart ?? 0
      // The sample's length once it has loaded; until then the clip's own
      // seconds at the song's tempo — what an unwarped clip spans.
      const end = clip.bufferDuration != null
        ? clip.bufferDuration - (clip.trimEnd ?? 0)
        : start + clip.durationBeats * (60 / (project.tempo || 120))
      if (op === 'clear') {
        const had = clip.warpMarkers?.length ?? 0
        return { actions: [{ type: 'UPDATE_CLIP', clipId: clip.id, patch: { warpMarkers: undefined } }], say: had ? `Cleared ${how}'s warp markers.` : `${how} had no warp markers — it plays straight.` }
      }
      if (op === 'quantize_transients') {
        // The attacks live in the decoded audio, which the planner cannot see:
        // the studio finds them and writes the markers (VoiceControl).
        const grid = spokenNumber(i.grid as string) ?? 0.25
        return { actions: [{ type: 'WARP_QUANTIZE', clipId: clip.id, grid }], say: `Quantizing ${how}'s transients to ${grid === 0.25 ? 'sixteenths' : grid === 0.5 ? 'eighths' : grid === 1 ? 'the beat' : `${grid} beats`}.` }
      }
      if (!(end > start)) return fail(`${how} has no length to warp yet.`)
      if (op === 'as_loop') {
        const bars = spokenNumber(i.bars as string)
        if (bars == null || !(bars > 0)) return fail('Say how many bars the sample is — "as a 2 bar loop".')
        const ms = warpAsLoop(start, end, bars, bar)
        return { actions: [{ type: 'UPDATE_CLIP', clipId: clip.id, patch: { warpMarkers: ms, warpEnabled: true, durationBeats: bars * bar, segBpm: Math.round(((bars * bar) / (end - start)) * 60 * 100) / 100 } }], say: `Warped ${how} as a ${bars}-bar loop.` }
      }
      if (op === 'at_bpm') {
        const bpm = spokenNumber(i.bpm as string)
        if (bpm == null || bpm < 20 || bpm > 999) return fail('Say the sample\'s tempo — "at 90 bpm".')
        const ms = warpAtBpm(start, end, bpm)
        return { actions: [{ type: 'UPDATE_CLIP', clipId: clip.id, patch: { warpMarkers: ms, warpEnabled: true, segBpm: bpm, durationBeats: ms[1].beat } }], say: `Warped ${how} straight at ${bpm} BPM.` }
      }
      if (op === 'straight') {
        const ms = warpStraight(start, end, clip.durationBeats)
        return { actions: [{ type: 'UPDATE_CLIP', clipId: clip.id, patch: { warpMarkers: ms, warpEnabled: true } }], say: `Warped ${how} straight across its ${+(clip.durationBeats / bar).toFixed(2)} bars.` }
      }
      return fail('Say how to warp it — as a loop of so many bars, straight, at a tempo, quantize its transients, or clear the markers.')
    }

    // ── A MIDI CLIP'S LOOP AND TIME (lib/clip-time.ts) ───────────────────
    case 'clip_time': {
      const op = str(i.op).toLowerCase()
      const found = resolveClip(target, project)
      // Crop is the one of these an AUDIO clip understands: the sample loses
      // the audio the clip never plays (lib/sample-editor.ts).
      if (found && found.clip.kind === 'audio' && op === 'crop') {
        const a = found.clip as AudioClip
        const how = clipLabel(project, a)
        const p = cropSample(a, project.tempo)
        if (!p) return fail(a.bufferDuration == null ? `${how} is still loading.` : `${how} has nothing outside the clip to crop — it plays all of its sample.`)
        return { actions: [{ type: 'UPDATE_CLIP', clipId: a.id, patch: p }], say: `Cropped ${how} to what it plays.` }
      }
      if (!found || !('notes' in found.clip)) return fail(`I couldn't find a MIDI clip called "${target || 'that'}".`)
      const clip = found.clip as MidiClip
      const bar = project.timeSignatureNum || 4
      const range = workingRange(clip)
      const how = clipLabel(project, clip)
      const span = range.end - range.start
      const lengthBeats = (): { beats: number; said: string } | { problem: string } => {
        if (i.length == null) return { problem: 'Say how long — "two bars", "eight beats".' }
        const s = spanOf(i.length, clip.startBeat, maps)
        if (s.problem || s.beats == null || !(s.beats > 0)) return { problem: s.problem ?? 'Say how long — "two bars".' }
        return { beats: s.beats, said: s.said ? describeDuration(s.said, s.beats) : `${s.beats} beats` }
      }
      switch (op) {
        case 'set_loop_length': {
          const l = lengthBeats()
          if ('problem' in l) return fail(l.problem)
          return { actions: [{ type: 'UPDATE_CLIP', clipId: clip.id, patch: { loopEnabled: true, loopLengthBeats: l.beats } }], say: `${how} loops every ${l.said}.` }
        }
        case 'duplicate_loop': {
          // A clip that is not looping yet: the whole clip is its loop, so the
          // request still means something — the clip doubles.
          const looping = !!loopRange(clip)
          const src = looping ? clip : { ...clip, loopEnabled: true, loopLengthBeats: clip.durationBeats }
          const r = duplicateLoop(src, newId, bar)
          if (!r) return fail(`${how} has nothing to duplicate.`)
          return {
            actions: [{ type: 'UPDATE_CLIP', clipId: clip.id, patch: looping ? r : { ...r, loopEnabled: true } }],
            say: looping ? `Doubled ${how}'s loop to ${+(r.loopLengthBeats / bar).toFixed(2)} bars and copied its notes.` : `${how} was not looping, so the whole clip is the loop now — doubled to ${+(r.loopLengthBeats / bar).toFixed(2)} bars with its notes copied.`,
          }
        }
        case 'crop': {
          if (!loopRange(clip)) return fail(`${how} has no loop to crop to.`)
          if (range.end >= clip.durationBeats - 1e-6) return fail(`${how} is already exactly its loop.`)
          const r = cropToRange(clip, range.start, range.end)
          if (!r) return fail('Nothing to crop.')
          return { actions: [{ type: 'UPDATE_CLIP', clipId: clip.id, patch: r }], say: `Cropped ${how} to its loop — ${+(r.durationBeats / bar).toFixed(2)} bars.` }
        }
        case 'select_in_loop': {
          const ns = notesInRange(clip.notes, range.start, range.end)
          if (!ns.length) return fail(`No notes inside ${how}'s loop.`)
          return {
            actions: [{ type: 'SELECT', clipIds: [clip.id], trackId: clip.trackId }, { type: 'SELECT_NOTES', clipId: clip.id, noteIds: ns.map(n => n.id) }],
            say: `Selected the ${ns.length} note${ns.length === 1 ? '' : 's'} inside ${how}'s loop.`,
          }
        }
        case 'insert_time': {
          const l = i.length != null ? lengthBeats() : { beats: span, said: `${+(span / bar).toFixed(2)} bars` }
          if ('problem' in l) return fail(l.problem)
          return {
            actions: [{ type: 'UPDATE_CLIP', clipId: clip.id, patch: { notes: insertTime(clip.notes, range.end, l.beats), durationBeats: clip.durationBeats + l.beats } }],
            say: `Inserted ${l.said} of silence after ${loopRange(clip) ? `${how}'s loop` : how}.`,
          }
        }
        case 'delete_time': {
          const newDur = Math.max(bar, clip.durationBeats - span)
          return {
            actions: [{ type: 'UPDATE_CLIP', clipId: clip.id, patch: { notes: deleteTime(clip.notes, range.start, range.end), durationBeats: newDur, ...(clip.loopLengthBeats ? { loopLengthBeats: Math.min(clip.loopLengthBeats, newDur) } : {}) } }],
            say: `Deleted ${+(span / bar).toFixed(2)} bars from ${how}${loopRange(clip) ? ' — its loop\'s span' : ''}.`,
          }
        }
        case 'duplicate_time': {
          return {
            actions: [{ type: 'UPDATE_CLIP', clipId: clip.id, patch: { notes: duplicateTime(clip.notes, range.start, range.end, newId), durationBeats: clip.durationBeats + span } }],
            say: `Duplicated ${+(span / bar).toFixed(2)} bars of ${how}.`,
          }
        }
        default: return fail('Say what to do with the loop — set its length, duplicate it, crop to it, or select the notes in it.')
      }
    }

    // ── TRACK ORDER ─────────────────────────────────────────────────────
    // "move the drums to the top", "put the pad below the bass".
    case 'move_track': {
      const track = resolveTrack(target, project)
      if (!track) return fail(`I couldn't find a track called "${target || 'that'}".`)
      const order = (project.tracks ?? []).filter(t => !t.groupId || t.kind === 'group')
      const idx = order.findIndex(t => t.id === track.id)
      const to = str(i.to).toLowerCase()
      let beforeId: string | null | undefined
      let where = ''
      if (i.before != null || i.after != null) {
        const other = resolveTrack(str(i.before ?? i.after), project)
        if (!other) return fail(`I couldn't find a track called "${str(i.before ?? i.after)}".`)
        if (other.id === track.id) return { actions: [], say: `"${track.name}" is already there.` }
        const oi = order.findIndex(t => t.id === other.id)
        if (i.before != null) { beforeId = other.id; where = `above "${other.name}"` }
        else { beforeId = order[oi + 1]?.id ?? null; where = `below "${other.name}"` }
      } else if (to === 'top' || to === 'first') { beforeId = order[0]?.id ?? null; where = 'at the top' }
      else if (to === 'bottom' || to === 'last' || to === 'end') { beforeId = null; where = 'at the bottom' }
      else if (to === 'up') { if (idx <= 0) return { actions: [], say: `"${track.name}" is already at the top.` }; beforeId = order[idx - 1].id; where = 'up one' }
      else if (to === 'down') { if (idx < 0 || idx >= order.length - 1) return { actions: [], say: `"${track.name}" is already at the bottom.` }; beforeId = order[idx + 2]?.id ?? null; where = 'down one' }
      else return fail('Say where — "to the top", "to the bottom", "up", "down", "above the bass".')
      if (beforeId === track.id) return { actions: [], say: `"${track.name}" is already ${where}.` }
      return {
        actions: [{ type: 'MOVE_TRACK', trackId: track.id, beforeId: beforeId ?? null }],
        say: `Moved "${track.name}" ${where}.`,
      }
    }

    case 'strip_back': {
      const tracks = (project.tracks ?? []).filter(t => t.kind !== 'group')
      if (i.restore === true) {
        return {
          actions: tracks.map(t => ({ type: 'UPDATE_TRACK', trackId: t.id, patch: { mute: false } })),
          say: 'Everything is back in.',
        }
      }
      const names = Array.isArray(i.keep) ? (i.keep as unknown[]).map(str) : []
      if (!names.length) return fail('Say which tracks to keep — "just the drums and the bass".')
      const keep: string[] = []
      for (const n of names) {
        const t = resolveTrack(n, project)
        if (!t) return fail(`I couldn't find a track called "${n}".`)
        keep.push(t.id)
      }
      return {
        actions: tracks.map(t => ({
          type: 'UPDATE_TRACK', trackId: t.id, patch: { mute: !keep.includes(t.id) },
        })),
        say: `Just ${keep.map(id => tracks.find(t => t.id === id)?.name).join(' and ')} — everything else is muted.`,
      }
    }

    // ── INVERSION ───────────────────────────────────────────────────────
    case 'chord_inversion': {
      const got = midiClipFor(target, project, 'invert')
      if ('problem' in got) return fail(got.problem)
      const { clip, how } = got
      const up = !/down|lower|drop/i.test(str(i.direction))
      const times = Math.max(1, Math.min(3, spokenNumber(i.times as string) ?? 1))

      // A chord is the notes sharing a start. Inverting each one separately is
      // what keeps a progression a progression — inverting the whole clip by
      // pitch would move notes between chords.
      const byStart = new Map<number, typeof clip.notes>()
      for (const n of clip.notes) {
        const k = +n.startBeat.toFixed(4)
        byStart.set(k, [...(byStart.get(k) ?? []), n])
      }
      const patches: unknown[] = []
      for (const group of byStart.values()) {
        if (group.length < 2) continue
        const sorted = [...group].sort((a, b) => a.pitch - b.pitch)
        for (let t = 0; t < times; t++) {
          if (up) {
            const bottom = sorted.shift()!
            sorted.push({ ...bottom, pitch: bottom.pitch + 12 })
          } else {
            const top = sorted.pop()!
            sorted.unshift({ ...top, pitch: top.pitch - 12 })
          }
        }
        for (const n of sorted) {
          patches.push({
            type: 'UPDATE_MIDI_NOTE', clipId: clip.id, noteId: n.id,
            patch: { pitch: Math.max(0, Math.min(127, n.pitch)) },
          })
        }
      }
      if (!patches.length) return fail('There are no chords in that — inverting needs notes stacked together.')
      return {
        actions: patches,
        say: `Inverted ${how} ${times === 1 ? 'once' : `${times} times`} ${up ? 'up' : 'down'}.`,
      }
    }

    // ── KEY CHANGE ──────────────────────────────────────────────────────
    case 'modulate': {
      const NOTE_PC: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }
      let semis = spokenNumber(i.semitones as string)
      let newKey: number | null = null
      const keyWords = str(i.key).trim()
      if (keyWords) {
        const m = /^\s*([a-g])\s*(sharp|#|flat|b|♭)?\s*(major|minor|maj|min)?\s*$/i.exec(keyWords)
        if (!m) return fail(`I couldn't read "${keyWords}" as a key.`)
        const acc = m[2]?.toLowerCase()
        newKey = (((NOTE_PC[m[1].toLowerCase()] + (acc === 'sharp' || acc === '#' ? 1 : acc ? -1 : 0)) % 12) + 12) % 12
        // The distance from the key it is in now, so the notes end up in the
        // key they asked for rather than merely moving by some interval.
        if (semis == null) semis = ((newKey - (project.key ?? 0) + 12) % 12)
      }
      if (semis == null || semis === 0) return fail('Say how far to modulate, or which key to move to.')

      // "From the chorus" that did not parse used to modulate EVERYTHING.
      const place = placeOf(i.at, maps, project)
      if (place.problem) return fail(place.problem)
      const at = place.beat
      const clips = allClips(project).filter(
        (c): c is MidiClip => (c as MidiClip).kind === 'midi' && !!(c as MidiClip).notes?.length,
      ).filter(c => at == null || c.startBeat >= at)
      if (!clips.length) return fail(at == null ? 'There are no notes to modulate.' : `There is nothing after ${describeBeat(at, maps)}.`)

      const actions: unknown[] = clips.flatMap(c => c.notes.map(n => ({
        type: 'UPDATE_MIDI_NOTE', clipId: c.id, noteId: n.id,
        patch: { pitch: Math.max(0, Math.min(127, n.pitch + semis!)) },
      })))
      // The key setting moves with the notes, or the scale highlighting now
      // disagrees with the song — which is the whole difference between a key
      // change and a transpose.
      const key = newKey ?? ((((project.key ?? 0) + semis) % 12) + 12) % 12
      actions.push({ type: 'SET_KEY_SCALE', key, scale: project.scale ?? 'major' })
      const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
      return {
        actions,
        say: `Modulated ${semis > 0 ? 'up' : 'down'} ${Math.abs(semis)} semitone${Math.abs(semis) === 1 ? '' : 's'} to ${NAMES[key]}${at == null ? '' : ` from ${describeBeat(at, maps)}`}.`,
      }
    }

    // ── BALANCE / LEVEL MATCH ───────────────────────────────────────────
    //
    // ⚠️ The planner cannot do this one. Measuring a track means RENDERING it,
    // which is asynchronous and needs an audio context — neither of which a
    // pure function that returns actions has. So it hands the studio a job, the
    // same way a spoken take does, and the studio reports back when it knows.
    case 'balance_levels': {
      const tracks = project.tracks ?? []
      const wanted = Array.isArray(i.targets)
        ? (i.targets as string[]).map(n => resolveTrack(n, project)).filter(Boolean)
        : []
      if (Array.isArray(i.targets) && wanted.length !== (i.targets as string[]).length) {
        return fail(`I couldn't find all of those tracks.`)
      }
      const ref = str(i.reference) ? resolveTrack(str(i.reference), project) : null
      if (str(i.reference) && !ref) return fail(`I couldn't find "${str(i.reference)}" to match to.`)

      const ids = (wanted.length ? wanted : tracks.filter(t => !t.mute && t.kind !== 'group'))
        .map(t => t!.id)
      if (ids.length < 2 && !ref) return fail('There is only one track to balance.')

      return {
        actions: [{ type: 'BALANCE_LEVELS', trackIds: ids, referenceId: ref?.id ?? null }],
        say: ref
          ? `Measuring, then matching everything to ${ref.name}. This takes a few seconds.`
          : `Measuring ${ids.length} tracks and evening them out. This takes a few seconds.`,
      }
    }

    // ── GROOVE ──────────────────────────────────────────────────────────
    case 'apply_groove': {
      const groove = grooveNamed(str(i.groove))
      if (!groove) {
        return fail(`I don't know a feel called "${str(i.groove)}". Try shuffle, swing, laid back, pushed, off-grid or straight.`)
      }
      const got = midiClipFor(target, project, 'groove')
      if ('problem' in got) return fail(got.problem)
      const { clip, how } = got
      const pct = spokenNumber(i.amount as string)
      const amount = pct == null ? 1 : Math.max(0, Math.min(2, pct / 100))
      const moved = applyGroove(clip.notes, groove, {
        amount,
        beatsPerBar: project.timeSignatureNum || 4,
      })
      return {
        actions: moved.map(m => ({
          type: 'UPDATE_MIDI_NOTE', clipId: clip.id, noteId: m.id,
          patch: { startBeat: m.startBeat, velocity: m.velocity },
        })),
        say: `${how} — ${groove.label.toLowerCase()}. ${groove.note}`,
      }
    }

    // ── CROSSFADE ───────────────────────────────────────────────────────
    case 'crossfade': {
      const clips = [...(project.arrangementClips ?? [])].sort((a, b) => a.startBeat - b.startBeat)
      if (clips.length < 2) return fail('There are not two clips to cross between.')

      let first = str(i.first) ? resolveClip(str(i.first), project)?.clip ?? null : null
      let second = str(i.second) ? resolveClip(str(i.second), project)?.clip ?? null : null

      if (!first || !second) {
        // Nothing named: find the pair that actually meet. Overlapping first,
        // because an overlap is somebody having already lined them up.
        const onSameTrack = (a: typeof clips[0], b: typeof clips[0]) => a.trackId === b.trackId
        let best: [typeof clips[0], typeof clips[0]] | null = null
        for (let n = 0; n < clips.length - 1; n++) {
          const a = clips[n], b = clips[n + 1]
          if (!onSameTrack(a, b)) continue
          const gap = b.startBeat - (a.startBeat + a.durationBeats)
          if (gap <= 0.001) { best = [a, b]; break }
          if (!best && gap < 1) best = [a, b]
        }
        if (!best) return fail('I could not find two clips next to each other to cross between.')
        first = best[0]; second = best[1]
      }
      if (first.id === second.id) return fail('That is one clip — a crossfade needs two.')
      if (first.startBeat > second.startBeat) { const t = first; first = second; second = t }

      const overlap = (first.startBeat + first.durationBeats) - second.startBeat
      const askedSpan = spanOf(i.length, second.startBeat, maps)
      if (askedSpan.problem) return fail(askedSpan.problem)
      const asked = askedSpan.beats
      // The overlap they already have, or the length they asked for, or half a
      // bar — in that order, because an existing overlap is a decision somebody
      // already made and this should honour it rather than overrule it.
      const length = Math.max(0.05, asked ?? (overlap > 0.01 ? overlap : 2))

      const actions: unknown[] = []
      let moved = false
      if (overlap < length - 0.001) {
        // No overlap to fade across, so make one by pulling the second clip
        // back. Nothing else can create the crossing.
        actions.push({
          type: 'MOVE_CLIP', clipId: second.id,
          startBeat: Math.max(0, (first.startBeat + first.durationBeats) - length),
        })
        moved = true
      }
      actions.push({ type: 'UPDATE_CLIP', clipId: first.id, patch: { fadeOut: length } })
      actions.push({ type: 'UPDATE_CLIP', clipId: second.id, patch: { fadeIn: length } })
      return {
        actions,
        say: `Crossfaded "${first.name ?? 'the first'}" into "${second.name ?? 'the next'}" over ${length === 1 ? 'a beat' : `${+length.toFixed(2)} beats`}${moved ? ', pulling the second one back to meet it' : ''}.`,
      }
    }

    // ── STUTTER / RETRIGGER ─────────────────────────────────────────────
    case 'stutter': {
      const got = midiClipFor(target, project, 'stutter')
      if ('problem' in got) return fail(got.problem)
      const { clip, how } = got
      const style = str(i.style).toLowerCase()
      // A flam is a grace note a hair before the beat; a ghost note is a quiet
      // one between the hits. Neither is a repeat, so neither goes through the
      // roll arithmetic below.
      if (/flam|grace/.test(style)) return flamOrGhost(clip, how, 'flam')
      if (/ghost|quiet/.test(style)) return flamOrGhost(clip, how, 'ghost')

      const div = spokenNumber(i.division as string) ?? 16
      if (![4, 8, 16, 32].includes(div)) return fail('Say 8, 16 or 32 for how fast the repeats are.')
      const step = 4 / div                       // a 16th is 0.25 beats
      const all = /all|every|whole/i.test(str(i.scope))

      const notes = clip.notes
      const lastStart = Math.max(...notes.map(n => n.startBeat))
      // A chord is several notes at one moment, so "the last note" is every
      // note at the last START — stuttering one voice of a chord and leaving
      // the others held is not what anybody means.
      const chosen = all ? notes : notes.filter(n => Math.abs(n.startBeat - lastStart) < 1e-6)
      if (!chosen.length) return fail('There is nothing there to stutter.')

      const kept = notes.filter(n => !chosen.includes(n))
      const repeats: typeof notes = []
      for (const n of chosen) {
        const count = Math.max(2, Math.min(16, Math.round(n.durationBeats / step)))
        for (let r = 0; r < count; r++) {
          repeats.push({
            ...n,
            id: newId(),
            startBeat: n.startBeat + r * step,
            durationBeats: step * 0.9,
            // Fading across the repeats is what makes it read as a roll rather
            // than as a stuck note.
            velocity: Math.max(20, Math.round(n.velocity * (1 - 0.5 * (r / Math.max(1, count - 1))))),
          })
        }
      }
      return {
        actions: [{ type: 'UPDATE_CLIP', clipId: clip.id, patch: { notes: [...kept, ...repeats] } }],
        say: `Stuttered ${all ? 'every note in' : 'the end of'} ${how} at ${div}ths.`,
      }
    }

    // ── TONE IN ONE WORD ────────────────────────────────────────────────
    case 'shape_tone': {
      const quality = str(i.quality).toLowerCase()
      const track = resolveTrack(target, project)
        ?? (target ? null : (project.tracks ?? [])[0])
      if (!track) return fail(`I couldn't find "${target || 'that track'}".`)
      const pct = spokenNumber(i.amount as string)
      // A "normal" move is deliberately modest. These are meant to be said
      // repeatedly until it sounds right, which only works if one of them is
      // never drastic.
      const k = pct == null ? 1 : clamp(pct / 50, 0.2, 2.4)

      const actions: unknown[] = []
      let said = ''
      if (quality === 'punchier' || quality === 'softer') {
        const dir = quality === 'punchier' ? 1 : -1
        const fx = effectOn(track, 'transientshaper', () => ({ ...defaultTransientShaper() } as never))
        actions.push(...fx.actions)
        const attack = clamp((fx.params.attack as number ?? 0) + dir * 4 * k, -12, 12)
        const sustain = clamp((fx.params.sustain as number ?? 0) - dir * 2 * k, -12, 12)
        actions.push({
          type: 'UPDATE_EFFECT', trackId: track.id, effectId: fx.id,
          // ⚠️ `patch`, not `params`: the reducer spreads action.patch onto the
          // effect, so sending `params` at the top level is a silent no-op —
          // the command reports success and changes nothing.
          patch: { params: { ...fx.params, attack, sustain } as unknown as TrackEffect['params'] },
        })
        said = quality === 'punchier' ? 'more punch' : 'softer attack'
      } else {
        const fx = effectOn(track, 'eq3', () => ({ ...defaultEq3() } as never))
        actions.push(...fx.actions)
        const low = fx.params.lowGain as number ?? 0
        const mid = fx.params.midGain as number ?? 0
        const high = fx.params.highGain as number ?? 0
        // Each quality is a SHAPE, not a single band. "Warmer" that only
        // boosted the low end is a muddier track, not a warmer one — the top
        // has to come down with it or the balance is unchanged.
        const move: Record<string, [number, number, number]> = {
          brighter: [0, 0, 3],
          darker: [0, 0, -3],
          warmer: [2.5, 0, -1.5],
          cleaner: [-3, 0, 0.5],
          fuller: [2, 1.5, 0],
          thinner: [-2.5, -1, 0],
        }
        const d = move[quality]
        if (!d) return fail(`I don't know how to make something "${quality}".`)
        actions.push({
          type: 'UPDATE_EFFECT', trackId: track.id, effectId: fx.id,
          patch: {
            params: {
              ...fx.params,
              lowGain: clamp(low + d[0] * k, -18, 18),
              midGain: clamp(mid + d[1] * k, -18, 18),
              highGain: clamp(high + d[2] * k, -18, 18),
            } as unknown as TrackEffect['params'],
          },
        })
        said = quality
      }
      return { actions, say: `${track.name} — ${said}.` }
    }

    // ── STEREO WIDTH ────────────────────────────────────────────────────
    case 'set_width': {
      const want = str(i.width).toLowerCase()
      const track = resolveTrack(target, project) ?? (target ? null : (project.tracks ?? [])[0])
      if (!track) return fail(`I couldn't find "${target || 'that track'}".`)
      const fx = effectOn(track, 'utility', () => ({ ...defaultUtility() } as never))
      const now = (fx.params.width as number) ?? 1
      const width = want === 'mono' ? 0
        : want === 'normal' ? 1
          : want === 'wider' ? clamp(now + 0.4, 0, 2)
            : clamp(now - 0.4, 0, 2)
      return {
        actions: [
          ...fx.actions,
          {
            type: 'UPDATE_EFFECT', trackId: track.id, effectId: fx.id,
            patch: { params: { ...fx.params, width, mono: want === 'mono' } as unknown as TrackEffect['params'] },
          },
        ],
        say: want === 'mono' ? `${track.name} is mono.` : `${track.name} — ${want}.`,
      }
    }

    // ── DUCKING ─────────────────────────────────────────────────────────
    case 'duck_under': {
      const key = resolveTrack(str(i.under), project)
      if (!key) return fail(`I couldn't find "${str(i.under) || 'that'}" to duck under.`)
      const track = resolveTrack(target, project) ?? (target ? null : null)
      if (!track) return fail(`Say which track should duck under ${key.name}.`)
      if (track.id === key.id) return fail('A track cannot duck under itself.')
      const pct = spokenNumber(i.amount as string)
      const amount = pct == null ? 0.6 : clamp(pct / 100, 0, 1)
      const fx = effectOn(track, 'unmask', () => ({ ...defaultUnmask() } as never))
      return {
        actions: [
          ...fx.actions,
          {
            type: 'UPDATE_EFFECT', trackId: track.id, effectId: fx.id,
            patch: { params: { ...fx.params, keyTrackId: key.id, amount } as unknown as TrackEffect['params'] },
          },
        ],
        say: `${track.name} now ducks under ${key.name}.`,
      }
    }

    // ── FEEL ────────────────────────────────────────────────────────────
    case 'time_feel': {
      const feel = str(i.feel).toLowerCase()
      const got = midiClipFor(target, project, 'change the feel of')
      if ('problem' in got) return fail(got.problem)
      const { clip, how } = got
      const notes = clip.notes
      const pct = spokenNumber(i.amount as string)

      if (feel === 'half' || feel === 'double') {
        const f = feel === 'half' ? 2 : 0.5
        return {
          actions: [
            ...notes.map(n => ({
              type: 'UPDATE_MIDI_NOTE', clipId: clip.id, noteId: n.id,
              patch: { startBeat: n.startBeat * f, durationBeats: Math.max(0.05, n.durationBeats * f) },
            })),
            // The clip has to grow or shrink with its notes, or half time runs
            // off the end and is silently cut in two.
            { type: 'UPDATE_CLIP', clipId: clip.id, patch: { durationBeats: Math.max(1, clip.durationBeats * f) } },
          ],
          say: `${how} is now ${feel === 'half' ? 'half' : 'double'} time.`,
        }
      }

      if (feel === 'straight') {
        return {
          actions: notes.map(n => ({
            type: 'UPDATE_MIDI_NOTE', clipId: clip.id, noteId: n.id,
            patch: { startBeat: Math.round(n.startBeat * 4) / 4 },
          })),
          say: `Straightened ${how}.`,
        }
      }

      // ⚠️ Humanize is seeded from the NOTE, not from Math.random. The same
      // clip humanized twice must give the same feel, or undo-and-redo quietly
      // becomes a different performance and nobody can tell what changed.
      // The amount is the roll's (lib/pitch-time.ts): a share of half a
      // sixteenth, 50 % by default — up to a 64th either way.
      if (feel === 'humanize') {
        const amount = pct == null ? 50 : clamp(pct, 0, 100)
        const patches = humanizeNotes(notes, amount, 0.25, clip.id)
        if (!patches.length) return fail('An amount of zero leaves it as it is.')
        return { actions: perNote(clip.id, patches), say: `Humanized ${how}${pct == null ? '' : ` by ${amount}%`}.` }
      }
      const depth = (pct == null ? 1 : clamp(pct / 50, 0, 3)) * 0.02
      const shift = feel === 'ahead' ? -depth * 1.5 : depth * 1.5
      return {
        actions: notes.map(n => ({
          type: 'UPDATE_MIDI_NOTE', clipId: clip.id, noteId: n.id,
          patch: { startBeat: Math.max(0, n.startBeat + shift) },
        })),
        say: `${how} now sits ${feel === 'ahead' ? 'ahead of' : 'behind'} the beat.`,
      }
    }

    // ── ARTICULATION ────────────────────────────────────────────────────
    case 'note_length': {
      const style = str(i.style).toLowerCase()
      const got = midiClipFor(target, project, 'change the note lengths of')
      if ('problem' in got) return fail(got.problem)
      const { clip, how } = got
      const pct = spokenNumber(i.amount as string)
      const notes = [...clip.notes].sort((a, b) => a.startBeat - b.startBeat)

      if (style === 'slide' || style === 'portamento' || style === 'glissando') {
        // ⚠️ Not a note length at all — it is an articulation the engine reads
        // off the clip's rollFx bag. It lives in this command because "legato"
        // is right next to it in anybody's head, and a separate tool claiming
        // the same words would be one command with a coin flip.
        const amount = pct == null ? 0.5 : clamp(pct / 100, 0, 1)
        return {
          actions: [{
            type: 'UPDATE_CLIP', clipId: clip.id,
            patch: { rollFx: { ...((clip as { rollFx?: object }).rollFx ?? {}), slide: amount } },
          }],
          say: amount === 0 ? `${how} no longer slides.` : `${how} slides between notes.`,
        }
      }

      // One length for every note — Set Length (lib/pitch-time.ts).
      if (style === 'set' || i.length != null) {
        const beats = parseDuration(str(i.length))
        if (beats == null) return fail('Say the length — "eighth notes", "sixteenths", "a quarter note", "two beats".')
        return {
          actions: perNote(clip.id, setLength(notes, beats)),
          say: `Every note in ${how} is ${durationLabel(beats)} long now.`,
        }
      }

      if (style === 'legato') {
        // Each note runs to the next one that starts later. Notes stacked in a
        // chord share a start, so "the next note" is the next START, not the
        // next entry — otherwise a chord's notes cut each other to nothing.
        const starts = [...new Set(notes.map(n => n.startBeat))].sort((a, b) => a - b)
        return {
          actions: notes.map(n => {
            const next = starts.find(sBeat => sBeat > n.startBeat)
            const end = next ?? (clip.durationBeats)
            return {
              type: 'UPDATE_MIDI_NOTE', clipId: clip.id, noteId: n.id,
              patch: { durationBeats: Math.max(0.05, end - n.startBeat) },
            }
          }),
          say: `${how} is legato.`,
        }
      }
      const f = style === 'staccato' ? 0.35
        : style === 'shorter' ? (pct == null ? 0.7 : clamp(pct / 100, 0.05, 1))
          : (pct == null ? 1.4 : clamp(1 + pct / 100, 1, 4))
      return {
        actions: notes.map(n => ({
          type: 'UPDATE_MIDI_NOTE', clipId: clip.id, noteId: n.id,
          patch: { durationBeats: Math.max(0.05, n.durationBeats * f) },
        })),
        say: `${how} — ${style}.`,
      }
    }

    // ── CRESCENDO ───────────────────────────────────────────────────────
    case 'dynamics_ramp': {
      const dir = /dim|down|quiet|soft|decres/i.test(str(i.direction)) ? -1 : 1
      const got = midiClipFor(target, project, 'shape the dynamics of')
      if ('problem' in got) return fail(got.problem)
      const { clip, how } = got
      const notes = clip.notes
      const span = Math.max(...notes.map(n => n.startBeat)) || 1
      return {
        actions: notes.map(n => {
          const t = span > 0 ? n.startBeat / span : 0
          // 45 to 115 across the part: quiet enough to be a real swell, loud
          // enough at the top to still be the same instrument.
          const v = dir > 0 ? 45 + t * 70 : 115 - t * 70
          return {
            type: 'UPDATE_MIDI_NOTE', clipId: clip.id, noteId: n.id,
            patch: { velocity: Math.round(clamp(v, 1, 127)) },
          }
        }),
        say: `${how} ${dir > 0 ? 'builds' : 'falls away'} across the part.`,
      }
    }

    // ── HARMONISE ───────────────────────────────────────────────────────
    case 'harmonize': {
      const words = str(i.interval).toLowerCase()
      const SEMIS: Record<string, number> = {
        second: 2, third: 4, fourth: 5, fifth: 7, sixth: 9, seventh: 11, octave: 12,
      }
      const name = Object.keys(SEMIS).find(k => words.includes(k))
      const semis = name ? SEMIS[name] : spokenNumber(words)
      if (semis == null || !semis) return fail('Say an interval — a third, a fifth, an octave.')
      const below = /below|down|under/i.test(str(i.direction) || words)
      const got = midiClipFor(target, project, 'harmonize')
      if ('problem' in got) return fail(got.problem)
      const { clip, how } = got
      // In a song with a key a NAMED interval is diatonic — "a third above" is
      // the third the scale has at each note, major or minor, so the harmony
      // stays in key. A count of semitones stays chromatic, and so does a song
      // that carries no scale at all. lib/pitch-time.ts.
      const scale = name ? projectScale(project, true) : null
      const DEGREES: Record<string, number> = { second: 1, third: 2, fourth: 3, fifth: 4, sixth: 5, seventh: 6, octave: 7 }
      const size = scale ? DEGREES[name!] : Math.abs(semis)
      const step = below ? -size : size
      // ADDED, not replaced: harmonising is a second voice, and a command
      // that silently removed the first would be a transpose wearing the
      // wrong name.
      const added = addInterval(clip.notes, step, scale, newId)
      if (!added.length) return fail('Every one of those notes already has that harmony.')
      return {
        actions: [{ type: 'UPDATE_CLIP', clipId: clip.id, patch: { notes: [...clip.notes, ...added] } }],
        say: `Harmonized ${how} a ${name ?? `${Math.abs(step)} semitone`} ${below ? 'below' : 'above'}${scale ? ', in key' : ''}.`,
      }
    }

    // ── REVERSE ─────────────────────────────────────────────────────────
    case 'reverse_notes': {
      const got = midiClipFor(target, project, 'reverse')
      if ('problem' in got) return fail(got.problem)
      const { clip, how } = got
      const notes = clip.notes
      // Mirror within the clip, using each note's END so a long note reversed
      // still finishes where it used to start (lib/pitch-time.ts).
      const end = Math.max(clip.durationBeats, ...notes.map(n => n.startBeat + n.durationBeats))
      return {
        actions: perNote(clip.id, reverseNotes(notes, { start: 0, end })),
        say: `${how} plays backwards.`,
      }
    }

    // ── SECTIONS ────────────────────────────────────────────────────────
    case 'section': {
      const want = foldName(str(i.name))
      const markers = [...(project.cueMarkers ?? [])].sort((a, b) => a.beat - b.beat)
      if (!markers.length) return fail('There are no named sections yet — say "call this the chorus" at a spot first.')
      const idx = markers.findIndex(m => foldName(m.name ?? '').includes(want) || want.includes(foldName(m.name ?? '')))
      if (idx < 0) {
        return fail(`I couldn't find a section called "${str(i.name)}". There is ${markers.map(m => m.name).join(', ')}.`)
      }
      const from = markers[idx].beat
      // A section runs to the NEXT marker, or to the end of the song. That is
      // what a marker means, and it is the only reading that needs no extra
      // bookkeeping to stay true when markers move.
      const to = markers[idx + 1]?.beat
        ?? Math.max(from + 4, ...(project.arrangementClips ?? []).map(c => c.startBeat + c.durationBeats))
      const action = str(i.action || 'go').toLowerCase()
      const label = markers[idx].name ?? 'that section'

      if (action === 'loop') {
        return {
          actions: [
            // ⚠️ start/end, and enabling is its own action — SET_LOOP alone
            // moves the loop without switching it on.
            { type: 'SET_LOOP', start: from, end: to },
            { type: 'SET_LOOP_ENABLED', enabled: true },
          ],
          say: `Looping ${label} — ${describeBeat(from, maps)} to ${describeBeat(to, maps)}.`,
        }
      }
      if (action === 'delete' || action === 'remove') {
        const inside = (project.arrangementClips ?? []).filter(c => c.startBeat >= from && c.startBeat < to)
        if (!inside.length) return fail(`There is nothing in ${label} to delete.`)
        return {
          actions: inside.map(c => ({ type: 'REMOVE_CLIP', clipId: c.id })),
          say: `Deleted ${inside.length} clip${inside.length === 1 ? '' : 's'} in ${label}.`,
        }
      }
      if (action === 'move') {
        const place = placeOf(i.at, maps, project)
        if (place.problem) return fail(place.problem)
        const dest = place.beat
        if (dest == null) return fail(`Say where to move ${label} to.`)
        const inside = (project.arrangementClips ?? []).filter(c => c.startBeat >= from && c.startBeat < to)
        if (!inside.length) return fail(`There is nothing in ${label} to move.`)
        const shift = dest - from
        return {
          // Every clip keeps its position RELATIVE to the section, so the
          // section arrives intact rather than collapsed onto one beat.
          actions: inside.map(c => ({
            type: 'MOVE_CLIP', clipId: c.id, startBeat: Math.max(0, c.startBeat + shift),
          })),
          say: `Moved ${label} to ${describeBeat(dest, maps)}.`,
        }
      }
      if (action === 'duplicate') {
        const inside = (project.arrangementClips ?? []).filter(c => c.startBeat >= from && c.startBeat < to)
        if (!inside.length) return fail(`There is nothing in ${label} to double.`)
        const span = to - from
        return {
          actions: inside.map(c => ({
            type: 'ADD_CLIP',
            clip: { ...c, id: newId(), startBeat: c.startBeat + span } as unknown as MidiClip,
          })),
          say: `Doubled ${label} — ${inside.length} clip${inside.length === 1 ? '' : 's'} repeated.`,
        }
      }
      return {
        actions: [{ type: 'TRANSPORT', action: 'locate', beat: from }],
        say: `${label}, ${describeBeat(from, maps)}.`,
      }
    }

    // OPEN AN EDITOR - the sequencer or the piano roll, on something.
    case 'open_editor': {
      // ── Opening a PLACE, not an editor ────────────────────────────────
      //
      // Brae: "moving to the video module while keeping light alive".
      //
      // The same verb, widened, rather than a second command beside it: "open
      // the piano roll" and "open the video module" are one request in
      // anybody's head, and splitting them across two tools would mean two
      // chances for a sentence to pick the wrong one.
      //
      // ⚠️ Only possible at all because Light now lives in the layout. Mounted
      // in the transport bar, a command to leave the studio destroyed the thing
      // carrying it out, halfway through carrying it out.
      const PLACES: Record<string, { to: string; said: string }> = {
        video:     { to: '/create?modules=video', said: 'the video module' },
        audio:     { to: '/create?modules=audio&audioMode=music', said: 'the studio' },
        studio:    { to: '/create?modules=audio&audioMode=music', said: 'the studio' },
        projects:  { to: '/projects', said: 'your projects' },
        library:   { to: '/library', said: 'your library' },
        community: { to: '/community', said: 'the community' },
        dashboard: { to: '/dashboard', said: 'the dashboard' },
        settings:  { to: '/settings', said: 'settings' },
        apps:      { to: '/apps', said: 'the apps' },
        learn:     { to: '/learn', said: 'Learn' },
      }
      const asked = str(i.editor).toLowerCase().trim()
      const place = PLACES[asked]
        ?? Object.entries(PLACES).find(([k]) => asked.includes(k))?.[1]
      if (place) {
        return {
          actions: [{ type: 'NAVIGATE', to: place.to }],
          // Says where it is going BEFORE it goes. Navigation is the one action
          // whose result is a different screen, so a read-back that arrives
          // after the trip arrives somewhere nobody was looking.
          say: `Opening ${place.said}.`,
        }
      }

      const editor = /piano|roll|note/i.test(str(i.editor)) ? 'pianoroll' : 'sequencer'
      const found = editorTarget(project, target, editor, i.create === true, maps)
      if (found.problem) return fail(found.problem)
      return {
        actions: [...found.actions, { type: 'OPEN_EDITOR', editor, clipId: found.clipId }],
        say: `${found.made ? 'Made and opened' : 'Opened'} the ${editor === 'pianoroll' ? 'piano roll' : 'sequencer'} on ${found.name}.`,
      }
    }

    // RECORD BY VOICE - the studio asks about the click, counts in, and listens.
    case 'record_take': {
      const editor = /piano|roll|note|chord/i.test(str(i.editor)) ? 'pianoroll' : 'sequencer'
      const found = editorTarget(project, target, editor, false, maps)
      if (found.problem) return fail(found.problem)
      const drum = str(i.drum)
      const lane = drum ? laneFromName(drum) : null
      if (drum && !lane) return fail(`I do not know a drum called "${drum}".`)
      const bars = Math.max(1, Math.min(8, spokenNumber(i.bars as string) ?? 1))
      return {
        actions: [
          ...found.actions,
          { type: 'OPEN_EDITOR', editor, clipId: found.clipId },
          // The UI owns the rest: it has the microphone, the count-in and the
          // transport clock, none of which are in the project.
          { type: 'RECORD_TAKE', editor, clipId: found.clipId, lane, bars },
        ],
        say: '',   // the studio speaks when it asks about the click
      }
    }

    // SHORTHAND - "ta means closed hi hat, and cha means snare"
    case 'define_word': {
      if (i.clear === true) {
        clearVocab()
        return { actions: [{ type: 'VOCAB', cleared: true }], say: 'Forgot every shorthand.' }
      }
      // The person's own sentence, parsed here rather than by the model: the
      // model relays words and this needs the exact ones, and the local rules
      // hand the raw sentence straight through.
      const said = applyDefinitions(parseDefinitions(str(i.phrase)))
      if (!said) {
        return fail('Say it like "ta means closed hi hat" - a single word, then what it means.')
      }
      const n = definitions().length
      // A studio-level action, like METRONOME: the shorthand is not part of the
      // song and has no business in the project, but something did change and
      // saying so is what tells the difference between "noted" and "ignored".
      return {
        actions: [{ type: 'VOCAB', defined: definitions().map(d => d.word) }],
        say: `${said}. ${n} shorthand${n === 1 ? '' : 's'} in this session.`,
      }
    }

    // METRONOME - the click. UI state, like transport, not the reducer.
    case 'metronome': {
      const on = i.on === true || /^(true|on|yes)$/i.test(String(i.on ?? ''))
      return { actions: [{ type: 'METRONOME', on }], say: on ? 'Click on.' : 'Click off.' }
    }

    // WHAT NOTES - name what is sounding.
    case 'name_notes': {
      // A question, not an edit: it changes nothing and answers out loud.
      return { actions: [], say: namePlayingNotes(project, target, maps, heard?.atBeat, str(i.notes) || str(i.part)) }
    }

    // ── UNDO / REDO ─────────────────────────────────────────────────────
    //
    // ⚠️ These are TOOLS the assistant can call, and until now the executor had
    // no case for them — so "undo that" in AI mode came back "I don't know how
    // to undo yet". The local path intercepted them before planning and the
    // assistant path never reached that interception, which is exactly the kind
    // of gap that only exists on one of two routes to the same command.
    //
    // The history belongs to the editor and cannot be a reducer action, so this
    // hands over a studio-level action like TRANSPORT does. `say` is empty on
    // purpose: the studio reports what actually happened, because "Undone."
    // over an empty stack is the small lie that teaches somebody to stop
    // trusting the read-back.
    case 'undo':
    case 'redo':
      return { actions: [{ type: call.name === 'undo' ? 'UNDO' : 'REDO' }], say: '' }

    // ⚠️ A BAR MENTIONED INSIDE AN EDIT IS NOT A PLACE TO GO.
    //
    // Brae: "it just moved my playhead again... I think that when I bring up
    // bars it thinks I'm moving the playhead." He is right, and the tool
    // description has warned against it for months without helping — a warning
    // in a prompt is advice, and this is a rule.
    //
    // The test is what ELSE the sentence contains. "Go to bar 9" is a move and
    // nothing else; "make the reverb 100% then 20% at bar 9" is an edit that
    // mentions a bar, and moving the playhead is the one thing in it nobody
    // asked for. Refusing OUT LOUD rather than silently is what makes it
    // recoverable: the model is told why, and gets to answer properly in the
    // same command instead of being quietly ignored.
    case 'transport': {
      // No default: a transport call with nothing in it is a call that lost
      // its argument, not a request to play.
      const action = str(i.action).toLowerCase().trim()
      if (!action) return fail('Say what to do — play, stop, pause, or restart.')
      if (!['play', 'stop', 'pause', 'restart', 'toggle', 'locate'].includes(action)) {
        return fail(`I don't know how to "${action}".`)
      }
      if (action === 'locate') {
        const place = placeOf(i.at, maps, project)
        if (place.problem) return fail(place.problem)
        const at = place.beat
        if (at == null) return fail('Say where to move the playhead.')
        // ⚠️ Refused when the sentence was about something else — see above.
        const why = notAMove(heard?.said)
        if (why) return fail(why)
        return { actions: [{ type: 'TRANSPORT', action: 'locate', beat: at }], say: `Moved to ${describeBeat(at, maps)}.` }
      }
      return {
        actions: [{ type: 'TRANSPORT', action }],
        // ⚠️ NOT THE COMMAND WORD. The record, 22:03–22:05: "Restart." ×3,
        // "Pause." ×5, "Play." ×3 in a minute — Light said "Pause." out loud,
        // the microphone heard "Pause.", and the rules ran it again. Every
        // read-back here is a form no transport rule matches: "Paused" is not
        // "pause" to the exact matcher, "Playing" does not bend to "play", and
        // "Restarting" is neither "restart" nor "from the top".
        say: action === 'restart' ? 'Restarting.'
          : action === 'play' ? 'Playing.'
            : action === 'pause' ? 'Paused.'
              : action === 'stop' ? 'Stopped.'
                : `${action[0].toUpperCase()}${action.slice(1)}.`,
      }
    }

    default:
      return fail(`I don't know how to "${call.name}" yet.`)
  }
}

/**
 * Plan a whole spoken sentence — several calls, in order.
 *
 * All or nothing: if any call cannot be resolved, none are applied. "Loop bass 2
 * and add a filter" leaving the loop without the filter is worse than doing
 * nothing and saying why.
 */
/**
 * A view of the project that INCLUDES what earlier calls in this same sentence
 * have just created.
 *
 * Brae: "It needs to take commands that require multiple steps, so it needs to
 * look for more than one command type sometimes."
 *
 * ⚠️ Every call in a sentence was planned against the ORIGINAL project, so a
 * step could never see what the step before it made. "Add a track called Keys
 * and mute it" failed outright — the mute looked for Keys in a project that did
 * not have it yet — and it failed at the FIRST step's expense too, because a
 * problem in any call abandons the whole sentence. Two correct commands, one
 * refusal.
 *
 * Only ADDITIONS are replayed, and only the two that later steps actually look
 * things up by. This is deliberately not a second reducer: it is the smallest
 * thing that lets a name resolve, the ids are the ones the real actions carry,
 * and anything it does not model simply behaves as it did before. Mirrors the
 * ADD_TRACK case in daw-state.ts for the fields resolution reads.
 */
function withCreated(project: DawProject, actions: unknown[]): DawProject {
  let tracks = project.tracks
  let clips = project.arrangementClips ?? []
  let lanes = project.automationLanes ?? []
  for (const raw of actions) {
    const a = raw as {
      type?: string; id?: string; name?: string; kind?: string; clip?: DawClip
      trackId?: string; effect?: TrackEffect; lane?: AutomationLane
    }
    // ⚠️ EFFECTS AND LANES TOO, not only tracks and clips. Brae: "it created two
    // new reverbs." Two automate_parameter calls in one batch — "100% here" and
    // "20% there" — each looked for a reverb on the track, and the second could
    // not see the one the first had just added, so it added its own. Anything a
    // later call in the same batch might look FOR has to be visible here.
    if (a.type === 'ADD_EFFECT' && a.trackId && a.effect) {
      tracks = tracks.map(t => t.id !== a.trackId || t.effects.some(e => e.id === a.effect!.id)
        ? t
        : { ...t, effects: [...t.effects, a.effect!] })
    } else if (a.type === 'ADD_AUTOMATION_LANE' && a.lane) {
      if (!lanes.some(l => l.id === a.lane!.id)) lanes = [...lanes, a.lane]
    } else if (a.type === 'ADD_TRACK' && a.id) {
      if (tracks.some(t => t.id === a.id)) continue
      tracks = [...tracks, {
        id: a.id,
        name: a.name ?? (a.kind === 'group' ? 'Group' : `Track ${tracks.length + 1}`),
        type: 'audio', volume: 0.8, pan: 0, mute: false, solo: false, armed: false,
        // The real reducer gives it the default instrument; nothing that
        // resolves a NAME looks at the instrument, so a null here is honest
        // rather than a guess at what the reducer will choose.
        height: 64, effects: [], instrument: null,
      } as unknown as DawTrack]
    } else if (a.type === 'ADD_CLIP' && a.clip) {
      if (!clips.some(c => c.id === a.clip!.id)) clips = [...clips, a.clip]
    }
  }
  return tracks === project.tracks && clips === (project.arrangementClips ?? []) && lanes === (project.automationLanes ?? [])
    ? project
    : { ...project, tracks, arrangementClips: clips, automationLanes: lanes }
}

/**
 * One plan per call, each planned against what the calls before it created.
 *
 * ⚠️ For the assistant loop, which needs a verdict PER CALL (one tool_result
 * each) and so could not use planVoiceCalls — and instead planned every call
 * against the original project. The local path had already been fixed to
 * thread withCreated; the assistant path had not, so "add a track called Lead
 * and put a clip on it" refused its second half with "I couldn't find Lead"
 * when the model batched it the way the prompt tells it to. Same rule now on
 * both paths: a later call sees what an earlier one made.
 *
 * Planning continues past a problem so every call gets its own verdict; the
 * caller decides that a batch with any problem runs nothing.
 */
export function planVoiceCallsEach(calls: VoiceCall[], project: DawProject, heard?: VoiceContext): VoicePlan[] {
  const made: unknown[] = []
  return calls.map(c => {
    const plan = planVoiceCall(c, withCreated(project, made), heard)
    made.push(...plan.actions)
    return plan
  })
}

export function planVoiceCalls(calls: VoiceCall[], project: DawProject, heard?: VoiceContext): VoicePlan {
  const actions: unknown[] = []
  const said: string[] = []
  // ⚠️ The change left on the table has to survive being merged. It did not:
  // this function built a fresh plan out of the actions and the sentences and
  // dropped everything else, so a proposal never reached the studio and "a
  // little bit less of that" — the whole point of holding one — was read as a
  // volume command instead.
  let proposal: Proposal | null | undefined
  for (const c of calls) {
    const plan = planVoiceCall(c, withCreated(project, actions), heard)
    if (plan.problem) return { actions: [], say: '', problem: plan.problem }
    // A question stops the whole sentence. Running the first half of "loop the
    // bass and play it" while asking which bass would leave the project half
    // changed by a command nobody has finished giving.
    if (plan.ask) return { actions: [], say: '', ask: plan.ask }
    actions.push(...plan.actions)
    if (plan.say) said.push(plan.say)
    if (plan.proposal !== undefined) proposal = plan.proposal
  }
  // A plan with no actions is not necessarily empty — a query answers in words
  // and changes nothing, which is a complete and successful command.
  if (!actions.length && !said.length) return fail('I didn\'t catch anything to do.')
  return { actions, say: said.join(' '), ...(proposal !== undefined ? { proposal } : {}) }
}
