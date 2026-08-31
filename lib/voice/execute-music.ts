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
import {
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
import { LOWPASS_HZ, HIGHPASS_HZ } from '../daw-effect-params'
import { ADD_OPTIONS, APOLLO_ADD_OPTIONS, makeDefaultParams } from '../daw-effect-catalog'
import { nameChord, groupIntoChords } from '../chord-analysis'

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
function buildSpokenEffect(name: string): { type: EffectType; params: TrackEffect['params'] } | null {
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
      const key = spokenNumber(i.key as string)
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
      const division = spokenNumber(i.division as string) ?? 1
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
      const field = str(i.parameter)
      const spec = CLIP_FX_FIELDS[field]
      if (!spec) return fail(`I don't know how to shape "${field || 'that'}".`)

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
        say: `${spec.label} bar on "${track.name}" from ${describeBeat(startBeat, maps)}, ${describeDuration({ bars: 0 }, beats)}.`,
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
