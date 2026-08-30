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
import {
  defaultReverb, defaultDelay, defaultFilter, defaultCompressor,
  defaultSaturator, defaultChorus, defaultEq3, defaultLimiter,
} from '../daw-types'
import { findByName, foldName, spokenNumber, spokenFraction } from './resolve'
import type { VoiceAsk, AskOption } from './ask'
import {
  musicMaps, positionToBeat, durationToBeats, describeBeat, describeDuration,
  type MusicMaps, type MusicPosition, type MusicDuration,
} from './position'
import { beatToSeconds } from '../tempo-map'

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
    // 20 Hz to 20 kHz, logarithmically, so "the filter at 50%" lands around
    // 600 Hz where a person hears half-closed rather than at 10 kHz where a
    // linear reading would put it and nothing would appear to have happened.
    case 'filter': params.frequency = Math.round(20 * Math.pow(1000, unit)); break
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

export function planVoiceCall(call: VoiceCall, project: DawProject): VoicePlan {
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

      if (param === 'volume' || param === 'pan') {
        // The track's own parameter — no effect needed.
        parameter = param
        label = param === 'volume' ? 'Volume' : 'Pan'
      } else {
        const kind = param === 'highpass' ? 'highpass' : 'lowpass'
        const effectId = newId()
        actions.push({
          type: 'ADD_EFFECT', trackId: track.id,
          effect: { id: effectId, type: 'filter', params: { enabled: true, type: kind, frequency: 8000, q: 1 } },
        })
        parameter = `fx:${effectId}:frequency`
        label = kind === 'lowpass' ? 'Low-pass cutoff' : 'High-pass cutoff'
      }

      actions.push({
        type: 'ADD_AUTOMATION_LANE',
        lane: { id: laneId, trackId: track.id, parameter, label, min: 0, max: 1, defaultValue: from, points: [], expanded: true },
      })
      actions.push({ type: 'ADD_AUTOMATION_POINT', laneId, point: { id: newId(), beat: startBeat, value: from } })
      actions.push({ type: 'ADD_AUTOMATION_POINT', laneId, point: { id: newId(), beat: startBeat + lengthBeats, value: to } })

      const spoken = len(i.length)
      return {
        actions,
        say: `${label} from ${Math.round(from * 100)}% to ${Math.round(to * 100)}% over ${spoken ? describeDuration(spoken, lengthBeats) : `${+lengthBeats.toFixed(2)} beats`}, starting ${describeBeat(startBeat, maps)}, on ${found.how}.`,
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
      return {
        actions: ordered.map(c => ({ type: 'MOVE_CLIP', clipId: c.id, startBeat: Math.max(0, c.startBeat + by) })),
        say: `Moved ${target ? `${clips.length} clip${clips.length === 1 ? '' : 's'} on ${target}` : `all ${clips.length} clips`} ${spoken ? describeDuration(spoken, Math.abs(by)) : `${Math.abs(by)} beats`} ${by > 0 ? 'later' : 'earlier'}.`,
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
      const kind = str(i.effect).toLowerCase() as EffectType
      const make = EFFECT_DEFAULTS[kind]
      if (!make) return fail(`I don't know an effect called "${str(i.effect) || 'that'}".`)

      const pct = spokenNumber(i.amount as string)
      const existing = track.effects.find(e => e.type === kind)

      if (!existing) {
        if (call.name === 'set_effect' && pct === 0) {
          return fail(`There is no ${kind} on "${track.name}" to turn down.`)
        }
        const params = make() as unknown as Record<string, unknown>
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
export function planVoiceCalls(calls: VoiceCall[], project: DawProject): VoicePlan {
  const actions: unknown[] = []
  const said: string[] = []
  for (const c of calls) {
    const plan = planVoiceCall(c, project)
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
