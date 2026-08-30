'use client'
// ── Mentioning the thing you would want mentioned ───────────────────────────
//
// Brae: "We'll have a lot more uses besides clarification, like giving tips."
//
// A command's read-back says what happened. A notice says what it MEANS, and
// only when that is not obvious from having asked for it. "Bass 2: muted" is the
// read-back; "that was the last one playing" is the notice.
//
// The whole value is in restraint. An assistant that remarks on everything is
// one people stop listening to, and by the time it says something that matters
// they have stopped hearing it. So the bar is deliberately high — a notice has
// to be something that
//
//   is TRUE of the project after the command and was not before it,
//   the person plausibly did not intend, and
//   is genuinely hard to see on screen.
//
// The last clause is what rules out most candidates. A muted track is obvious:
// the button is lit. A forgotten SOLO is not, because the track that vanished is
// somewhere else on screen entirely and looks completely normal.
//
// Two of these exist specifically to head off the confusion that made this
// feature necessary — duplicate names. Answering a clarifying question fixes one
// command; being told at the moment the collision is created stops the question
// being asked at all.

import type { DawProject, DawTrack, DawClip } from '../daw-types'
import { foldName } from './resolve'

const tracksOf = (p: DawProject): DawTrack[] => p.tracks ?? []
const clipsOf = (p: DawProject): DawClip[] => p.arrangementClips ?? []

/** Tracks that can actually be heard right now. */
function audible(p: DawProject): DawTrack[] {
  const tracks = tracksOf(p)
  const soloed = tracks.filter(t => t.solo)
  const pool = soloed.length ? soloed : tracks
  return pool.filter(t => !t.mute && (t.volume ?? 1) > 0.0001)
}

/** Names shared by more than one track. */
function duplicateTrackNames(p: DawProject): string[] {
  const seen = new Map<string, string[]>()
  for (const t of tracksOf(p)) {
    const key = foldName(t.name ?? '')
    if (!key) continue
    seen.set(key, [...(seen.get(key) ?? []), t.name])
  }
  return [...seen.values()].filter(names => names.length > 1).map(names => names[0])
}

/** Clips whose name matches their own track's — the collision that makes "the
 *  bass" mean two things. */
function clipsNamedLikeTheirTrack(p: DawProject): { clip: DawClip; track: DawTrack }[] {
  const out: { clip: DawClip; track: DawTrack }[] = []
  for (const clip of clipsOf(p)) {
    const track = tracksOf(p).find(t => t.id === clip.trackId)
    if (!track) continue
    const clipName = foldName(clip.name ?? '')
    if (!clipName) continue
    if (clipName === foldName(track.name ?? '')) out.push({ clip, track })
  }
  return out
}

/**
 * Anything worth saying about what just changed.
 *
 * Pure, and takes both states, because every rule here is about a TRANSITION.
 * "Everything is muted" said on every command after the first would be noise;
 * said at the moment it becomes true, it is the explanation for the silence
 * somebody is about to be confused by.
 *
 * Returns at most one. Two remarks about a single command is a lecture.
 */
export function noticeFor(before: DawProject, after: DawProject): string | null {
  const wasAudible = audible(before)
  const nowAudible = audible(after)

  // ── Nothing will play ────────────────────────────────────────────────────
  if (tracksOf(after).length && !nowAudible.length && wasAudible.length) {
    return 'That was the last one — nothing will play now.'
  }

  // ── A solo that will be forgotten ────────────────────────────────────────
  //
  // The most useful of these by a distance. A soloed track looks normal; the
  // ones that went quiet are elsewhere on screen and look normal too, so the
  // usual way this ends is ten minutes of wondering where the drums went.
  const soloedBefore = tracksOf(before).filter(t => t.solo).length
  const soloedAfter = tracksOf(after).filter(t => t.solo)
  if (soloedAfter.length && !soloedBefore) {
    const names = soloedAfter.map(t => t.name).join(' and ')
    return `Only ${names} will play until you clear the solo.`
  }

  // ── Silent, but not muted ────────────────────────────────────────────────
  //
  // A track at zero is indistinguishable from a muted one by ear and completely
  // different on screen, so somebody hunting for the mute button will not find
  // one.
  for (const track of tracksOf(after)) {
    const was = tracksOf(before).find(t => t.id === track.id)
    if (!was) continue
    if ((track.volume ?? 1) <= 0.0001 && (was.volume ?? 1) > 0.0001 && !track.mute) {
      return `${track.name} is at zero now — silent, though it is not muted.`
    }
  }

  // ── A name collision, at the moment it is created ────────────────────────
  //
  // Said here rather than discovered later as a clarifying question, which is
  // the whole point: the cheapest time to fix an ambiguity is before anything
  // has had to ask about it.
  const dupesBefore = new Set(duplicateTrackNames(before))
  for (const name of duplicateTrackNames(after)) {
    if (!dupesBefore.has(name)) {
      return `There are two tracks called ${name} now — saying that name will mean asking which.`
    }
  }

  const collidedBefore = new Set(clipsNamedLikeTheirTrack(before).map(c => c.clip.id))
  for (const { clip, track } of clipsNamedLikeTheirTrack(after)) {
    if (!collidedBefore.has(clip.id)) {
      return `That clip has the same name as its track — "${track.name}" will now mean asking which.`
    }
  }

  return null
}
