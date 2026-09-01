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

import type { DawProject, DawTrack, MidiClip, DawClip, EffectType, TrackEffect } from '../daw-types'
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
import type { VoiceAsk, AskOption } from './ask'
import {
  musicMaps, positionToBeat, durationToBeats, describeBeat, describeDuration,
  type MusicMaps, type MusicPosition, type MusicDuration,
} from './position'
import { beatToSeconds } from '../tempo-map'
import { LOWPASS_HZ, HIGHPASS_HZ, automatableParams, shortNameOf, type AutomatableParam } from '../daw-effect-params'
import { ADD_OPTIONS, APOLLO_ADD_OPTIONS, makeDefaultParams } from '../daw-effect-catalog'
import { nameChord, groupIntoChords } from '../chord-analysis'
import { rngFor } from '../seeded-random'

export interface VoiceCall { name: string; input: Record<string, unknown> }

export interface VoicePlan {
  actions: unknown[]
  say: string
  problem?: string
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
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const fail = (problem: string): VoicePlan => ({ actions: [], say: '', problem })
const pos = (v: unknown): MusicPosition | null => (v && typeof v === 'object' ? v as MusicPosition : null)
const len = (v: unknown): MusicDuration | null => (v && typeof v === 'object' ? v as MusicDuration : null)

const allClips = (p: DawProject): DawClip[] => p.arrangementClips ?? []

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

function resolveClip(spoken: string, p: DawProject): { clip: DawClip; how: string } | null {
  // An id, handed back when a question is answered: the choice was made against
  // a specific clip and must not be re-resolved by name, or answering the
  // question would land in the same ambiguity that prompted it.
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
  /** Where the playhead is, in beats. Not in the project - the project is a
   *  document and this is a moment - so anything that answers "what is playing
   *  RIGHT NOW" has to be told. */
  atBeat?: number
}

const PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

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
): string {
  const clips = (project.arrangementClips ?? []).filter(
    (c): c is MidiClip => (c as MidiClip).kind === 'midi' && !!(c as MidiClip).notes?.length,
  )
  const drumTrack = new Set(
    (project.tracks ?? []).filter(t => t.instrument?.type === 'drum').map(t => t.id),
  )

  let sounding: { pitch: number; track: string }[] = []
  let where = ''

  if (target) {
    const chosen = resolveClipOrAsk(target, project, maps, 'name_notes', {})
    const clip = chosen.clip as MidiClip | null
    const track = resolveTrack(target, project)
    const wanted = clip
      ? [clip]
      : track ? clips.filter(c => c.trackId === track.id) : []
    if (!wanted.length) return `I couldn't find "${target}".`
    where = `in ${clip?.name || track?.name || target}`
    sounding = wanted.flatMap(c => c.notes.map(n => ({
      pitch: n.pitch,
      track: (project.tracks ?? []).find(t => t.id === c.trackId)?.name ?? '',
    })))
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
  return `${names} ${where}${chord ? ` - that's ${chord}` : ''}.`
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

    // AUTOMATION — "an ascending low pass filter from 80% to 0% over the first 8 seconds"
    case 'automate_parameter': {
      const found = resolveClip(target, project)
      if (!found) return fail(`I couldn't find "${target || 'that'}" to automate.`)
      const clip = found.clip
      const track = project.tracks.find(x => x.id === clip.trackId)
      if (!track) return fail('That clip is not on a track any more.')

      const from = spokenFraction(i.from as string)
      const to = spokenFraction(i.to as string)
      if (from == null || to == null) return fail('Say what it should sweep from and to.')

      const startBeat = positionToBeat(pos(i.start), maps) ?? clip.startBeat
      const lengthBeats = durationToBeats(len(i.length), startBeat, maps) ?? clip.durationBeats
      if (lengthBeats <= 0) return fail('That sweep has no length.')

      const param = str(i.parameter || 'lowpass')
      const actions: unknown[] = []
      const laneId = newId()
      let parameter: string
      let label: string
      /** Set for the filter sweeps, whose values are Hertz rather than 0–1. */
      let hz: { min: number; max: number; fromNorm: (n: number) => number } | null = null

      if (param === 'volume' || param === 'pan') {
        // The track's own parameter — no effect needed.
        parameter = param
        label = param === 'volume' ? 'Volume' : 'Pan'
      } else {
        const kind = param === 'highpass' ? 'highpass' : 'lowpass'
        const effectId = newId()
        actions.push({
          type: 'ADD_EFFECT', trackId: track.id,
          effect: { id: effectId, type: 'filter', params: { enabled: true, type: kind, frequency: FILTER_HZ[kind].max, q: 1 } },
        })
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
      actions.push({ type: 'ADD_AUTOMATION_POINT', laneId, point: { id: newId(), beat: startBeat, value: from } })
      actions.push({ type: 'ADD_AUTOMATION_POINT', laneId, point: { id: newId(), beat: startBeat + lengthBeats, value: to } })

      const spoken = len(i.length)
      return {
        actions,
        // Read back in the unit the thing is actually in. "From 100% to 20%"
        // sounded reasonable and was the same sentence whether the sweep ended
        // at 1.9 kHz or at a fifth of a Hertz — so the read-back could not have
        // caught the bug it was describing. "Down to 570 Hz" can be wrong out
        // loud.
        say: `${label} from ${hz ? `${fmtHz(hz.fromNorm(from))} to ${fmtHz(hz.fromNorm(to))}` : `${Math.round(from * 100)}% to ${Math.round(to * 100)}%`} over ${spoken ? describeDuration(spoken, lengthBeats) : `${+lengthBeats.toFixed(2)} beats`}, starting ${describeBeat(startBeat, maps)}, on ${found.how}.`,
      }
    }

    // MOVE — "move everything over by one bar"
    case 'move_clips': {
      const clips = target
        ? (() => {
          const track = resolveTrack(target, project)
          if (track) return allClips(project).filter(c => c.trackId === track.id)
          const one = resolveClip(target, project)
          return one ? [one.clip] : []
        })()
        : allClips(project)
      if (!clips.length) {
        return fail(target ? `I couldn't find "${target}" to move.` : 'There is nothing in the arrangement to move.')
      }
      const first = Math.min(...clips.map(c => c.startBeat))
      const by = durationToBeats(len(i.by), first, maps)
      if (by == null) return fail('Say how far to move it.')
      // Moving later is applied from the END so two clips never briefly share a
      // beat if this is ever applied optimistically.
      const ordered = [...clips].sort((a, b) => (by > 0 ? b.startBeat - a.startBeat : a.startBeat - b.startBeat))
      const spoken = len(i.by)

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
        say: `Moved ${target ? `${clips.length} clip${clips.length === 1 ? '' : 's'} on ${target}` : `all ${clips.length} clips`}${carried ? ' and their automation' : ''} ${spoken ? describeDuration(spoken, Math.abs(by)) : `${Math.abs(by)} beats`} ${by > 0 ? 'later' : 'earlier'}.`,
      }
    }

    // INSERT — "a 1 bar long crash at the beginning"
    case 'insert_clip': {
      const sound = str(i.sound || 'crash')
      const atBeat = positionToBeat(pos(i.at), maps) ?? 0
      const lengthBeats = durationToBeats(len(i.length), atBeat, maps)
        ?? durationToBeats({ bars: 1 }, atBeat, maps) ?? 4
      const existing = resolveTrack(sound, project)
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
      const spoken = len(i.length)
      return {
        actions,
        say: `Added a ${spoken ? describeDuration(spoken, lengthBeats) : `${lengthBeats}-beat`} ${sound} at ${describeBeat(atBeat, maps)}${existing ? ` on ${existing.name}` : ' on a new track'}.`,
      }
    }

    case 'set_tempo': {
      const bpm = spokenNumber(i.bpm as string)
      if (bpm == null || bpm < 20 || bpm > 300) return fail('Say a tempo between 20 and 300.')
      const at = positionToBeat(pos(i.at), maps)
      if (at == null) return { actions: [{ type: 'SET_TEMPO', tempo: bpm }], say: `Tempo set to ${bpm} bpm.` }
      return {
        actions: [{ type: 'ADD_TEMPO_MARKER', marker: { id: newId(), beat: at, tempo: bpm } }],
        say: `Tempo changes to ${bpm} bpm at ${describeBeat(at, maps)}.`,
      }
    }

    case 'set_time_signature': {
      const num = spokenNumber(i.numerator as string)
      const den = spokenNumber(i.denominator as string)
      if (num == null || den == null || num < 1 || den < 1) return fail('Say a time signature, like 3/4.')
      const at = positionToBeat(pos(i.at), maps)
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
      const start = positionToBeat(pos(i.start), maps)
      if (start == null) return fail('Say where the loop should start.')
      const end = positionToBeat(pos(i.end), maps)
        ?? (durationToBeats(len(i.length), start, maps) != null
          ? start + (durationToBeats(len(i.length), start, maps) as number)
          : null)
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
      const track = resolveTrack(target, project)
      if (!track) return fail(`I couldn't find a track called "${target || 'that'}".`)
      const patch: Record<string, unknown> = {}
      const said: string[] = []
      if (i.muted != null) { patch.mute = !!i.muted; said.push(i.muted ? 'muted' : 'unmuted') }
      if (i.solo != null) { patch.solo = !!i.solo; said.push(i.solo ? 'soloed' : 'unsoloed') }
      const vol = spokenFraction(i.volume as string)
      if (vol != null) { patch.volume = Math.max(0, Math.min(1, vol)); said.push(`volume ${Math.round(vol * 100)}%`) }
      const pan = spokenNumber(i.pan as string)
      if (pan != null) { patch.pan = Math.max(-1, Math.min(1, pan / 100)); said.push(`pan ${pan > 0 ? 'right' : 'left'} ${Math.abs(pan)}%`) }
      if (!said.length) return fail('Say what to change about that track.')
      return { actions: [{ type: 'UPDATE_TRACK', trackId: track.id, patch }], say: `${track.name}: ${said.join(', ')}.` }
    }

    case 'transpose': {
      const semis = spokenNumber(i.semitones as string)
      if (semis == null || semis === 0) return fail('Say how many semitones to move it.')
      const chosen = resolveClipOrAsk(target, project, maps, 'transpose', { semitones: semis })
      if (chosen.ask) return { actions: [], say: '', ask: chosen.ask }
      const found = chosen.clip ? { clip: chosen.clip, how: chosen.how ?? '' } : null
      if (!found) return fail(`I couldn't find "${target || 'that'}" to transpose.`)
      const clip = found.clip
      if (!('notes' in clip)) return fail('That is an audio clip — transposing audio is not supported yet.')
      const notes = (clip as MidiClip).notes
      if (!notes.length) return fail('That clip has no notes.')
      return {
        actions: notes.map(n => ({
          type: 'UPDATE_MIDI_NOTE', clipId: clip.id, noteId: n.id,
          patch: { pitch: Math.max(0, Math.min(127, n.pitch + semis)) },
        })),
        say: `Transposed ${found.how} ${Math.abs(semis)} semitone${Math.abs(semis) === 1 ? '' : 's'} ${semis > 0 ? 'up' : 'down'}.`,
      }
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
          // Where the loop is, since the playhead is not in the project — it
          // lives in the engine, and a pure planner cannot see it. Saying so is
          // better than guessing at it.
          const from = describeBeat(project.loopStart ?? 0, maps)
          const to = describeBeat(project.loopEnd ?? 0, maps)
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
      const found = resolveClip(target, project)
      if (!found) return fail(`I couldn't find "${target || 'that'}" to delete.`)
      const track = project.tracks.find(t => t.id === found.clip.trackId)
      return {
        actions: [{ type: 'REMOVE_CLIP', clipId: found.clip.id }],
        say: `Deleted the clip at ${describeBeat(found.clip.startBeat, maps)}${track ? ` on "${track.name}"` : ''}.`,
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
      if (!('notes' in clip)) return fail('That is an audio clip — there are no notes to move.')
      const notes = (clip as MidiClip).notes
      if (!notes.length) return fail('That clip has no notes.')

      // A quarter note by default: the grid people mean when they do not say.
      //
      // ⚠️ Triplets and dotted values are a MULTIPLIER on the division, not a
      // division of their own — a triplet eighth is two thirds of an eighth,
      // and a dotted eighth is one and a half of one. Treating "triplet" as a
      // separate grid is how a swung part gets quantised onto straight
      // sixteenths and loses the thing that made it swing.
      const said = str(i.division).toLowerCase() + ' ' + str(i.feel).toLowerCase()
      const triplet = /triplet|trip|third/.test(said)
      const dotted = /dotted|dot/.test(said)
      const base = spokenNumber(i.division as string) ?? 1
      const division = triplet ? base * (3 / 2) : dotted ? base / 1.5 : base
      if (!(division > 0)) return fail('That is not a grid I can quantize to.')
      const pct = spokenNumber(i.strength as string)
      const strength = pct == null ? 1 : Math.max(0, Math.min(1, pct / 100))

      // Partial strength moves notes PART of the way, which is the difference
      // between tightening a performance and flattening it. At 100 it is a
      // snap; below, the feel survives.
      const moved = notes
        .map(n => {
          const grid = Math.round(n.startBeat / division) * division
          const to = n.startBeat + (grid - n.startBeat) * strength
          return { n, to }
        })
        .filter(({ n, to }) => Math.abs(to - n.startBeat) > 1e-6)
      if (!moved.length) return { actions: [], say: `${found.how} is already on the grid.` }
      return {
        actions: moved.map(({ n, to }) => ({
          type: 'UPDATE_MIDI_NOTE', clipId: clip.id, noteId: n.id,
          patch: { startBeat: Math.max(0, +to.toFixed(4)) },
        })),
        say: `Quantized ${moved.length} note${moved.length === 1 ? '' : 's'} on ${found.how}${strength < 1 ? ` ${Math.round(strength * 100)}% of the way` : ''}.`,
      }
    }

    case 'set_velocity': {
      const found = resolveClip(target, project)
      if (!found) return fail(`I couldn't find "${target || 'that'}".`)
      const clip = found.clip
      if (!('notes' in clip)) return fail('That is an audio clip — velocity is a note thing.')
      const notes = (clip as MidiClip).notes
      if (!notes.length) return fail('That clip has no notes.')

      const absolute = spokenNumber(i.velocity as string)
      const pct = spokenNumber(i.scale as string)
      if (absolute == null && pct == null) return fail('Say how hard, or by how much.')

      const next = (v: number) => {
        const raw = absolute != null ? absolute : v * ((pct ?? 100) / 100)
        // Never to zero: a note at velocity 0 is a note that does not sound,
        // which is a deletion wearing a dynamics command's clothes.
        return Math.max(1, Math.min(127, Math.round(raw)))
      }
      const changed = notes.filter(n => next(n.velocity) !== n.velocity)
      if (!changed.length) return { actions: [], say: 'Those notes are already there.' }
      return {
        actions: changed.map(n => ({
          type: 'UPDATE_MIDI_NOTE', clipId: clip.id, noteId: n.id,
          patch: { velocity: next(n.velocity) },
        })),
        say: absolute != null
          ? `${found.how}: velocity ${absolute}.`
          : `${found.how}: ${pct}% of the velocity.`,
      }
    }

    case 'split_clip': {
      const found = resolveClip(target, project)
      if (!found) return fail(`I couldn't find "${target || 'that'}" to split.`)
      const clip = found.clip
      const at = pos(i.at)
      const beat = at ? positionToBeat(at, maps) : null
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
      const beats = durationToBeats(len(i.length), clip.startBeat, maps)
      if (beats == null || beats <= 0) return fail('Say how long it should be.')
      return {
        actions: [{ type: 'UPDATE_CLIP', clipId: clip.id, patch: { durationBeats: beats } }],
        say: `${found.how} is now ${describeDuration(len(i.length)!, beats)} long.`,
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
      const presetId = str(i.presetId)
      if (!presetId) return fail('I could not find that sound in the library.')
      const name = str(i.presetName) || 'that sound'

      // A sampled instrument lives on the CLIPS, not on the track: a preset is
      // what a clip plays through, and the track's own instrument is the
      // fallback for clips that name none. Setting it clip by clip is therefore
      // the honest edit — and it means a track whose clips deliberately differ
      // is not flattened by a command about the track.
      const clips = allClips(project).filter(c => c.trackId === track.id)
      if (!clips.length) return fail(`"${track.name}" has no clips to put ${name} on.`)
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
      const at = pos(i.at)
      const startBeat = at ? positionToBeat(at, maps) ?? 0 : 0
      const beats = durationToBeats(len(i.length), startBeat, maps)
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
        say: `${spec.label} bar on "${track.name}" from ${describeBeat(startBeat, maps)}, ${describeDuration(len(i.length) ?? { beats }, beats)}.`,
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
      const at = pos(i.at)
      const beat = at ? positionToBeat(at, maps) : 0
      if (beat == null) return fail('I could not work out where to put that marker.')
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
      applyAmount(params, kind, pct)
      return {
        actions: [{
          type: 'UPDATE_EFFECT', trackId: track.id, effectId: existing.id,
          patch: { params: params as unknown as TrackEffect['params'] },
        }],
        say: `${kind} on "${track.name}" at ${Math.round(pct)}%.`,
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

      const at = positionToBeat(pos(i.at), maps) ?? 0
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
        return fail(
          `${track.name} is ${inst?.type === 'drum' ? 'a drum kit' : `a ${inst?.type ?? 'plain'} instrument`}, `
          + 'and the sub and noise layers belong to Apollo. Put an Apollo instrument on it first.',
        )
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
      const from = positionToBeat(pos(i.at ?? i.from), maps) ?? 0
      const toBeat = positionToBeat(pos(i.to), maps)
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
      if (what === 'track') {
        const track = resolveTrack(target, project)
        if (!track) return fail(`I couldn't find "${target || 'that track'}".`)
        const ids = clips.filter(c => c.trackId === track.id).map(c => c.id)
        return {
          actions: [{ type: 'SELECT', clipIds: ids, trackId: track.id }],
          say: `Selected ${ids.length} clip${ids.length === 1 ? '' : 's'} on ${track.name}.`,
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

      const at = positionToBeat(pos(i.at), maps)
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
      const asked = durationToBeats(len(i.length), second.startBeat, maps)
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
      const depth = (pct == null ? 1 : clamp(pct / 50, 0, 3)) * 0.02
      const shift = feel === 'ahead' ? -depth * 1.5 : feel === 'behind' ? depth * 1.5 : 0
      return {
        actions: notes.map((n, idx) => {
          const jitter = feel === 'humanize'
            ? (rngFor(`humanize:${clip.id}:${n.id ?? idx}`)() - 0.5) * depth * 2
            : 0
          return {
            type: 'UPDATE_MIDI_NOTE', clipId: clip.id, noteId: n.id,
            patch: { startBeat: Math.max(0, n.startBeat + shift + jitter) },
          }
        }),
        say: feel === 'humanize' ? `Humanized ${how}.`
          : `${how} now sits ${feel === 'ahead' ? 'ahead of' : 'behind'} the beat.`,
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
      const step = below ? -Math.abs(semis) : Math.abs(semis)
      const got = midiClipFor(target, project, 'harmonize')
      if ('problem' in got) return fail(got.problem)
      const { clip, how } = got
      return {
        actions: [{
          type: 'UPDATE_CLIP', clipId: clip.id,
          patch: {
            notes: [
              ...clip.notes,
              // ADDED, not replaced: harmonising is a second voice, and a
              // command that silently removed the first would be a transpose
              // wearing the wrong name.
              ...clip.notes
                .map(n => ({ ...n, id: newId(), pitch: n.pitch + step }))
                .filter(n => n.pitch >= 0 && n.pitch <= 127),
            ],
          },
        }],
        say: `Harmonized ${how} a ${name ?? `${Math.abs(step)} semitone`} ${below ? 'below' : 'above'}.`,
      }
    }

    // ── REVERSE ─────────────────────────────────────────────────────────
    case 'reverse_notes': {
      const got = midiClipFor(target, project, 'reverse')
      if ('problem' in got) return fail(got.problem)
      const { clip, how } = got
      const notes = clip.notes
      // Mirror around the clip, using each note's END so a long note reversed
      // still finishes where it used to start.
      const end = Math.max(clip.durationBeats, ...notes.map(n => n.startBeat + n.durationBeats))
      return {
        actions: notes.map(n => ({
          type: 'UPDATE_MIDI_NOTE', clipId: clip.id, noteId: n.id,
          patch: { startBeat: Math.max(0, end - (n.startBeat + n.durationBeats)) },
        })),
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
        const dest = positionToBeat(pos(i.at), maps)
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
      return { actions: [], say: namePlayingNotes(project, target, maps, heard?.atBeat) }
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

    case 'transport': {
      const action = str(i.action || 'play').toLowerCase()
      if (!['play', 'stop', 'pause', 'restart', 'toggle', 'locate'].includes(action)) {
        return fail(`I don't know how to "${action}".`)
      }
      if (action === 'locate') {
        const at = positionToBeat(pos(i.at), maps)
        if (at == null) return fail('Say where to move the playhead.')
        return { actions: [{ type: 'TRANSPORT', action: 'locate', beat: at }], say: `Moved to ${describeBeat(at, maps)}.` }
      }
      return {
        actions: [{ type: 'TRANSPORT', action }],
        say: action === 'restart' ? 'Restarted from the top.' : `${action[0].toUpperCase()}${action.slice(1)}.`,
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
export function planVoiceCalls(calls: VoiceCall[], project: DawProject, heard?: VoiceContext): VoicePlan {
  const actions: unknown[] = []
  const said: string[] = []
  for (const c of calls) {
    const plan = planVoiceCall(c, project, heard)
    if (plan.problem) return { actions: [], say: '', problem: plan.problem }
    // A question stops the whole sentence. Running the first half of "loop the
    // bass and play it" while asking which bass would leave the project half
    // changed by a command nobody has finished giving.
    if (plan.ask) return { actions: [], say: '', ask: plan.ask }
    actions.push(...plan.actions)
    if (plan.say) said.push(plan.say)
  }
  // A plan with no actions is not necessarily empty — a query answers in words
  // and changes nothing, which is a complete and successful command.
  if (!actions.length && !said.length) return fail('I didn\'t catch anything to do.')
  return { actions, say: said.join(' ') }
}
