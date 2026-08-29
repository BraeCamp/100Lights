// What a spoken command actually DOES to the project.
//
// Brae: "Hey Light, could you loop 'bass 2' 3 more times and add an ascending
// low pass filter from 80% to 0% over the first 8 seconds of it" — one sentence
// that is two edits, on a named clip, in two different units.
//
// This turns one validated tool call into the DAW actions that perform it. It
// is a PURE function of (call, project): no dispatch, no engine, no clock — so
// every command in this file can be tested by reading the actions it produces,
// which is the only way to know a voice system does what it says before letting
// it loose on someone's song.
//
// Three rules:
//
//   Say what you did. Every plan carries `say`, the sentence the UI reads back.
//   A voice edit the user cannot see is one they cannot catch.
//
//   Refuse rather than guess. If "bass" matches two tracks, the plan is empty
//   and `problem` explains why. Editing the wrong track silently is the worst
//   thing this file could do.
//
//   Never invent an id. Everything the actions reference is either resolved
//   from the project or freshly minted here.

import type { DawProject, DawTrack, MidiClip, AudioClip, DawClip } from '../daw-types'
import { findByName, spokenNumber, spokenFraction, durationToBeats, type Timing } from './resolve'

/** One tool call from the assistant. Names are a contract with lib/voice/music-tools. */
export interface VoiceCall { name: string; input: Record<string, unknown> }

export interface VoicePlan {
  /** DAW actions to dispatch, in order. Empty when the command could not run. */
  actions: unknown[]
  /** What to tell the user, in their own terms: "Looped Bass 2 three more times." */
  say: string
  /** Why nothing happened, when nothing did. */
  problem?: string
}

const newId = () => (globalThis.crypto?.randomUUID?.() ?? `v${Math.random().toString(36).slice(2)}`)
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const fail = (problem: string): VoicePlan => ({ actions: [], say: '', problem })

function timingOf(p: DawProject): Timing {
  return { tempo: p.tempo || 120, beatsPerBar: p.timeSignatureNum || 4 }
}

const midiClips = (p: DawProject): MidiClip[] =>
  (p.arrangementClips ?? []).filter((c): c is MidiClip => (c as MidiClip).kind === 'midi')

/** Every clip, whatever kind — "move everything" means everything. */
const allClips = (p: DawProject): DawClip[] => p.arrangementClips ?? []

/**
 * Find the clip someone named.
 *
 * A clip can be named directly ("Bass Drone") or by its TRACK ("bass 2"), and
 * people say the track far more often — so a track match falls through to that
 * track's clips. With several, the earliest is the one they mean, because that
 * is the one they are looking at when they say "loop it".
 */
function resolveClip(spoken: string, p: DawProject): { clip: DawClip; how: string } | null {
  const byClip = findByName(spoken, allClips(p) as unknown as { id: string; name?: string }[])
  if (byClip) {
    const clip = allClips(p).find(c => c.id === byClip.item.id)
    if (clip) return { clip, how: `clip "${clip.name ?? clip.id}" (${byClip.how})` }
  }
  const byTrack = findByName(spoken, p.tracks as unknown as { id: string; name?: string }[])
  if (byTrack) {
    const onTrack = allClips(p)
      .filter(c => c.trackId === byTrack.item.id)
      .sort((a, b) => a.startBeat - b.startBeat)
    if (onTrack.length) {
      const t = p.tracks.find(x => x.id === byTrack.item.id)
      return { clip: onTrack[0], how: `the first clip on "${t?.name ?? ''}"` }
    }
  }
  return null
}

function resolveTrack(spoken: string, p: DawProject): DawTrack | null {
  const m = findByName(spoken, p.tracks as unknown as { id: string; name?: string }[])
  return m ? (p.tracks.find(t => t.id === m.item.id) ?? null) : null
}

// ── The commands ────────────────────────────────────────────────────────────

/** Turn one tool call into actions. Unknown names are reported, never ignored. */
export function planVoiceCall(call: VoiceCall, project: DawProject): VoicePlan {
  const t = timingOf(project)
  const i = call.input ?? {}

  switch (call.name) {
    // "loop bass 2 three more times"
    case 'loop_clip': {
      const target = str(i.clip || i.track)
      const found = resolveClip(target, project)
      if (!found) return fail(`I couldn't find "${target || 'that'}" — say the track or clip name.`)
      const times = spokenNumber(i.times as string) ?? 1
      if (times < 1) return fail(`"${times}" is not a number of repeats.`)
      const { clip } = found
      const actions = []
      for (let n = 1; n <= times; n++) {
        actions.push({
          type: 'ADD_CLIP',
          clip: {
            ...clip,
            id: newId(),
            // Copies follow on, back to back, which is what "loop it N more
            // times" means to a person looking at the arrangement.
            startBeat: clip.startBeat + clip.durationBeats * n,
            ...(('notes' in clip) ? { notes: (clip as MidiClip).notes.map(nt => ({ ...nt, id: newId() })) } : {}),
          },
        })
      }
      return { actions, say: `Looped ${found.how} ${times} more time${times === 1 ? '' : 's'}.` }
    }

    // "an ascending low pass filter from 80% to 0% over the first 8 seconds of it"
    case 'filter_sweep': {
      const target = str(i.clip || i.track)
      const found = resolveClip(target, project)
      if (!found) return fail(`I couldn't find "${target || 'that'}" to put a filter on.`)
      const clip = found.clip
      const track = project.tracks.find(x => x.id === clip.trackId)
      if (!track) return fail('That clip is not on a track any more.')

      const from = spokenFraction(i.from as string)
      const to = spokenFraction(i.to as string)
      if (from == null || to == null) return fail('Say what the filter should sweep from and to.')

      const startBeat = clip.startBeat + (durationToBeats(
        { seconds: i.startSeconds as number, bars: i.startBars as number, beats: i.startBeats as number }, t) ?? 0)
      const lengthBeats = durationToBeats(
        { seconds: i.seconds as number, bars: i.bars as number, beats: i.beats as number }, t)
        ?? clip.durationBeats

      const kind = str(i.type || 'lowpass') as 'lowpass' | 'highpass'
      const effectId = newId()
      const laneId = newId()
      // The filter itself, then a lane on its cutoff, then the two ends of the
      // sweep. Automation values are normalised 0..1, which is exactly the
      // "80% to 0%" the user said — no Hz conversion, no guessing a curve.
      return {
        actions: [
          {
            type: 'ADD_EFFECT', trackId: track.id,
            effect: { id: effectId, type: 'filter', params: { enabled: true, type: kind, frequency: 8000, q: 1 } },
          },
          {
            type: 'ADD_AUTOMATION_LANE',
            lane: {
              id: laneId, trackId: track.id,
              parameter: `fx:${effectId}:frequency`,
              label: `${kind === 'lowpass' ? 'Low-pass' : 'High-pass'} cutoff`,
              min: 0, max: 1, defaultValue: from, points: [], expanded: true,
            },
          },
          { type: 'ADD_AUTOMATION_POINT', laneId, point: { id: newId(), beat: startBeat, value: from } },
          { type: 'ADD_AUTOMATION_POINT', laneId, point: { id: newId(), beat: startBeat + lengthBeats, value: to } },
        ],
        say: `Added a ${kind === 'lowpass' ? 'low-pass' : 'high-pass'} sweep from ${Math.round(from * 100)}% to ${Math.round(to * 100)}% over ${(+(lengthBeats * 60 / t.tempo).toFixed(1))}s of ${found.how}.`,
      }
    }

    // "move everything over by one bar"
    case 'shift_all': {
      const bars = spokenNumber(i.bars as string)
      const beats = bars != null ? bars * t.beatsPerBar : spokenNumber(i.beats as string)
      if (beats == null || !Number.isFinite(beats)) return fail('Say how far to move everything.')
      const clips = allClips(project)
      if (!clips.length) return fail('There is nothing in the arrangement to move.')
      // Moving right is applied FROM THE END so two clips never occupy the same
      // beat mid-way through; the reducer sees each clip once either way, but
      // the order keeps the arrangement sane if it is ever applied optimistically.
      const ordered = [...clips].sort((a, b) => (beats > 0 ? b.startBeat - a.startBeat : a.startBeat - b.startBeat))
      return {
        actions: ordered.map(c => ({
          type: 'MOVE_CLIP', clipId: c.id, startBeat: Math.max(0, c.startBeat + beats),
        })),
        say: `Moved ${clips.length} clip${clips.length === 1 ? '' : 's'} ${Math.abs(beats / t.beatsPerBar)} bar${Math.abs(beats / t.beatsPerBar) === 1 ? '' : 's'} ${beats > 0 ? 'later' : 'earlier'}.`,
      }
    }

    // "have a 1 bar long crash at the beginning"
    case 'add_drum_hit': {
      const sound = str(i.sound || 'crash')
      // Bars are counted from ONE by every musician and every ruler in the
      // app, so "at bar 1" is beat 0. Written as `?? 1 - 1` this parsed as
      // `?? 0` and only subtracted when the bar was NOT given — so an explicit
      // "at the beginning" landed a whole bar late.
      const atBar = spokenNumber(i.atBar as string) ?? 1
      const atBeat = (atBar - 1) * t.beatsPerBar
      const lengthBeats = durationToBeats(
        { bars: i.bars as number, beats: i.beats as number, seconds: i.seconds as number }, t) ?? t.beatsPerBar
      // Put it on a track whose name matches the sound if there is one, so a
      // "crash" lands on the Crash track rather than making a second one.
      const existing = resolveTrack(sound, project)
      const trackId = existing?.id ?? newId()
      const actions: unknown[] = []
      if (!existing) actions.push({ type: 'ADD_TRACK', id: trackId, name: sound.replace(/\b\w/g, c => c.toUpperCase()) })
      actions.push({
        type: 'ADD_CLIP',
        clip: {
          id: newId(), trackId, kind: 'midi', name: sound,
          startBeat: Math.max(0, atBeat), durationBeats: lengthBeats,
          notes: [{ id: newId(), pitch: 49, startBeat: 0, durationBeats: Math.min(1, lengthBeats), velocity: 110 }],
        } as unknown as MidiClip,
      })
      return {
        actions,
        say: `Added a ${lengthBeats / t.beatsPerBar} bar ${sound}${existing ? ` on ${existing.name}` : ' on a new track'}.`,
      }
    }

    case 'set_tempo': {
      const bpm = spokenNumber(i.bpm as string)
      if (bpm == null || bpm < 20 || bpm > 300) return fail('Say a tempo between 20 and 300.')
      return { actions: [{ type: 'SET_TEMPO', tempo: bpm }], say: `Tempo set to ${bpm}.` }
    }

    case 'set_track': {
      const target = str(i.track)
      const track = resolveTrack(target, project)
      if (!track) return fail(`I couldn't find a track called "${target || 'that'}".`)
      const patch: Record<string, unknown> = {}
      const said: string[] = []
      if (i.muted != null) { patch.mute = !!i.muted; said.push(i.muted ? 'muted' : 'unmuted') }
      if (i.solo != null) { patch.solo = !!i.solo; said.push(i.solo ? 'soloed' : 'unsoloed') }
      const vol = spokenFraction(i.volume as string)
      if (vol != null) { patch.volume = Math.max(0, Math.min(1, vol)); said.push(`volume ${Math.round(vol * 100)}%`) }
      if (!said.length) return fail('Say what to change about that track.')
      return {
        actions: [{ type: 'UPDATE_TRACK', trackId: track.id, patch }],
        say: `${track.name}: ${said.join(', ')}.`,
      }
    }

    // "then restart" — transport is handled by the caller, which owns the engine.
    case 'transport': {
      const action = str(i.action || 'play').toLowerCase()
      if (!['play', 'stop', 'pause', 'restart', 'toggle'].includes(action)) {
        return fail(`I don't know how to "${action}".`)
      }
      return { actions: [{ type: 'TRANSPORT', action }], say: action === 'restart' ? 'Restarted.' : `${action[0].toUpperCase()}${action.slice(1)}.` }
    }

    default:
      return fail(`I don't know how to "${call.name}" yet.`)
  }
}

/**
 * Plan a whole spoken sentence — several tool calls, in order.
 *
 * One command that half-works is worse than one that does not: if any call
 * cannot be resolved, nothing is applied and the problem is reported. "Loop
 * bass 2 and add a filter" should not leave the loop without the filter.
 */
export function planVoiceCalls(calls: VoiceCall[], project: DawProject): VoicePlan {
  const actions: unknown[] = []
  const said: string[] = []
  for (const c of calls) {
    const plan = planVoiceCall(c, project)
    if (plan.problem) return { actions: [], say: '', problem: plan.problem }
    actions.push(...plan.actions)
    if (plan.say) said.push(plan.say)
  }
  if (!actions.length) return fail('I didn\'t catch anything to do.')
  return { actions, say: said.join(' ') }
}
