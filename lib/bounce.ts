/**
 * Bounce: a track's sound printed as audio.
 *
 * The reason to bounce rather than freeze is that the result is a normal audio
 * clip you can cut, warp, reverse and drag about, while a freeze is a cache
 * that thaws back. Freezing is about CPU; bouncing is about committing to a
 * sound so the next decision is made on top of it rather than beside it.
 *
 * Two shapes, both Live's:
 *   • To New Track — the bounce lands on a new track beside the source, and the
 *     source's clips are parked (not deleted) so you can hear the difference and
 *     bring them back.
 *   • In Place — the bounce replaces the source's own clips on the same track.
 *
 * ⚠️ THE RENDER IS PRE-MIXER: the track plays at unity, centre, with its sends
 * off, so what is printed is the sound of its devices and nothing else. Live
 * does the same and then leaves the new track at default, which means a bounce
 * of a track you had pulled down comes back twice as loud. That is a trap, so
 * the level, the pan and the sends are COPIED onto the new track instead. The
 * bounce then sounds identical to the source, and the level is still in the
 * fader where you can move it, rather than baked into the samples where you
 * cannot.
 *
 * Pure decisions live here; the render itself needs a browser
 * (lib/bounce-render.ts).
 */

import type { DawProject, DawTrack, DawClip } from './daw-types'

export type BounceWhat = 'newTrack' | 'inPlace'

export interface BounceSpan { startBeat: number; endBeat: number }

/**
 * What to print: the selected clips if any are on this track, otherwise
 * everything the track plays. Null when there is nothing to bounce, which is a
 * real answer rather than an empty render — a silent clip is indistinguishable
 * from a broken one once it is on the timeline.
 */
export function bounceSpan(project: DawProject, trackId: string, selected?: Iterable<string>): BounceSpan | null {
  const sel = new Set(selected ?? [])
  const own = (project.arrangementClips ?? []).filter(c => c.trackId === trackId && c.active !== false)
  // ⚠️ A selection that names none of THIS track's clips means the person is
  // pointing somewhere else entirely, and narrowing to nothing would refuse a
  // bounce for a reason they cannot see. The whole track prints instead.
  const picked = own.filter(c => sel.has(c.id))
  const clips = picked.length ? picked : own
  if (!clips.length) return null
  const startBeat = Math.min(...clips.map(c => c.startBeat))
  const endBeat = Math.max(...clips.map(c => c.startBeat + c.durationBeats))
  if (!(endBeat > startBeat)) return null
  return { startBeat, endBeat }
}

/** The clips a bounce covers — the ones that get parked afterwards. */
export function clipsInSpan(project: DawProject, trackId: string, span: BounceSpan, selected?: Iterable<string>): DawClip[] {
  const sel = new Set(selected ?? [])
  const own = (project.arrangementClips ?? []).filter(c =>
    c.trackId === trackId
    && c.startBeat < span.endBeat - 1e-6
    && c.startBeat + c.durationBeats > span.startBeat + 1e-6)
  // Same rule as bounceSpan: a selection that names none of this track's clips
  // is not about this track.
  const picked = own.filter(c => sel.has(c.id))
  return picked.length ? picked : own
}

/** "Pad" → "Pad (bounced)", and never "Pad (bounced) (bounced)". */
export function bounceName(name: string): string {
  const base = (name || 'Track').replace(/\s*\(bounced\)\s*$/i, '')
  return `${base} (bounced)`
}

/**
 * The project as the bounce RENDERS it: this track alone, at unity and centre
 * with its sends off, so what is printed is its devices and nothing else.
 *
 * The other tracks are left in place rather than deleted — the renderer solos
 * by id, and a track removed here would take its group bus with it.
 */
export function preMixerProject(project: DawProject, trackId: string): DawProject {
  return {
    ...project,
    tracks: project.tracks.map(t => t.id === trackId
      ? { ...t, volume: 1, pan: 0, mute: false, solo: false, sendAmounts: {}, crossfader: undefined }
      : t),
  }
}

/**
 * The new track a bounce lands on: the source's mixer position and colour, none
 * of its devices (they are in the audio now), and no instrument to play.
 */
export function bouncedTrack(source: DawTrack, id: string, name = bounceName(source.name)): DawTrack {
  return {
    id,
    name,
    type: 'audio',
    color: source.color,
    volume: source.volume,
    pan: source.pan,
    mute: false,
    solo: false,
    armed: false,
    height: source.height,
    effects: [],
    instrument: { type: 'poly', params: {} } as DawTrack['instrument'],
    ...(source.groupId ? { groupId: source.groupId } : {}),
    ...(source.sendAmounts ? { sendAmounts: { ...source.sendAmounts } } : {}),
    ...(source.sendModes ? { sendModes: { ...source.sendModes } } : {}),
    ...(source.crossfader ? { crossfader: source.crossfader } : {}),
  }
}

/** What a bounce did, in words. */
export function describeBounce(what: BounceWhat, trackName: string, span: BounceSpan, beatsPerBar: number, parked: number): string {
  const bar = beatsPerBar > 0 ? beatsPerBar : 4
  const from = Math.floor(span.startBeat / bar) + 1
  const to = Math.ceil(span.endBeat / bar)
  const where = what === 'newTrack' ? `to a new track beside "${trackName}"` : `onto "${trackName}" itself`
  const bars = to > from ? `bars ${from} to ${to}` : `bar ${from}`
  return what === 'newTrack'
    ? `Bounced ${bars} ${where}. The original ${parked === 1 ? 'clip is' : `${parked} clips are`} parked — activate ${parked === 1 ? 'it' : 'them'} again to get the live version back.`
    : `Bounced ${bars} ${where}, replacing ${parked === 1 ? 'the clip' : `${parked} clips`} that were there.`
}
