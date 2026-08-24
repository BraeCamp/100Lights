'use client'
// Freezing Apollo tracks: render a synth clip once, play it back as audio.
//
// Every Apollo track in a project is its own worklet instance running a full
// synth, and voice cost multiplies with unison and with how many notes are held
// at once. A seven-track piece is seven synths in parallel, which is enough to
// stop the audio thread keeping up at all — the project opens and you cannot
// hear it. Brae's read was the right one: bounce the track item to a plain
// sound and play THAT, keeping the patch so it stays editable.
//
// So a freeze:
//   • renders the clip's notes through the real engine OFFLINE (fast, and it
//     cannot glitch, because it is not racing a realtime audio callback)
//   • saves the result into the Sound Library, so it survives a reload — an
//     audio clip's blob: URL does not, which is what `libraryId` exists for
//   • replaces the MIDI clip with an audio clip pointing at it
//   • keeps the notes AND the patch on the clip, so unfreezing is exact
//
// A whole piano roll becomes one sound, which is the cheapest thing the engine
// can play: one buffer, no voices, no per-note scheduling.
//
// NOTE on re-rendering when a roll changes: this re-renders the clip. It does
// NOT try to subtract a single note by mixing in an inverted copy. That trick
// only works if the render is perfectly linear and deterministic, and Apollo is
// neither — a filter with resonance, any drive, the compressor, and the voice
// allocator all make the whole greater than the sum of its notes, so the
// "inverse" would leave audible residue. Re-rendering one clip is cheap and
// always correct, so it is what happens.

import type { DawProject, DawClip, MidiClip, AudioClip, ApolloInstrumentParams } from '@/lib/daw-types'
import type { ApolloPatch } from '@/lib/apollo/patch'
import { ApolloEngine } from '@/lib/apollo/engine-client'
import { saveBounceToLibrary } from '@/lib/apollo/sample-store'

/** What a frozen clip remembers so it can be thawed back exactly. */
export interface FrozenSource {
  notes: MidiClip['notes']
  patch: ApolloPatch
  /** Tempo the render was made at — a tempo change invalidates it. */
  bpm: number
  /** Identifies the render: notes + patch + tempo. */
  stamp: string
}

/** An audio clip that used to be a synth clip. */
export type FrozenClip = AudioClip & { frozenFrom?: FrozenSource }

const isMidi = (c: DawClip): c is MidiClip => c.kind === 'midi'

/** Cheap stable hash — enough to notice a roll or a patch changing. */
function hash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return (h >>> 0).toString(36)
}

/** The identity of a render: change the notes, the patch or the tempo and this
 *  changes, which is what tells a cached freeze it is stale. */
export function freezeStamp(notes: MidiClip['notes'], patch: ApolloPatch, bpm: number): string {
  const n = notes.map(x => `${x.pitch}:${x.startBeat}:${x.durationBeats}:${x.velocity}`).join(',')
  return `${hash(n)}-${hash(JSON.stringify(patch))}-${bpm}`
}

/** True when this clip's frozen audio no longer matches its source. */
export function isFreezeStale(clip: FrozenClip, patch: ApolloPatch, bpm: number): boolean {
  const src = clip.frozenFrom
  if (!src) return false
  return src.stamp !== freezeStamp(src.notes, patch, bpm)
}

/**
 * Render one MIDI clip through Apollo and hand back the audio.
 * `tailSec` leaves room for releases and FX tails past the last note.
 */
export async function renderApolloClip(
  clip: MidiClip,
  patch: ApolloPatch,
  bpm: number,
  { tailSec = 2 }: { tailSec?: number } = {},
): Promise<AudioBuffer> {
  const secPerBeat = 60 / bpm
  const notes = clip.notes.map(n => ({
    t: n.startBeat * secPerBeat,
    dur: Math.max(0.02, n.durationBeats * secPerBeat),
    note: n.pitch,
    vel: Math.max(0.05, (n.velocity ?? 100) / 127),
  }))
  const lastEnd = notes.reduce((m, n) => Math.max(m, n.t + n.dur), 0)
  const seconds = Math.max(clip.durationBeats * secPerBeat, lastEnd) + tailSec
  // A throwaway engine: renderToBuffer builds its own OfflineAudioContext, so
  // this never touches the live audio graph.
  const engine = new ApolloEngine()
  return engine.renderToBuffer(patch, notes, seconds)
}

/**
 * Freeze every Apollo MIDI clip in a project.
 *
 * Returns a NEW project; the original is untouched. `onProgress` is called per
 * clip so a caller can show something during what is otherwise a long silence.
 */
export async function freezeApolloProject(
  project: DawProject,
  { onProgress, tailSec = 2 }: {
    onProgress?: (done: number, total: number, name: string) => void
    tailSec?: number
  } = {},
): Promise<DawProject> {
  const apolloTracks = new Map<string, ApolloPatch>()
  for (const t of project.tracks) {
    if (t.instrument?.type === 'apollo') {
      apolloTracks.set(t.id, (t.instrument.params as ApolloInstrumentParams) as unknown as ApolloPatch)
    }
  }
  if (!apolloTracks.size) return project

  const targets = project.arrangementClips.filter(
    (c): c is MidiClip => isMidi(c) && apolloTracks.has(c.trackId) && c.notes.length > 0)

  const clips: DawClip[] = [...project.arrangementClips]
  let done = 0
  for (const clip of targets) {
    const patch = apolloTracks.get(clip.trackId)!
    onProgress?.(done, targets.length, clip.name || clip.id)
    try {
      const buffer = await renderApolloClip(clip, patch, project.tempo, { tailSec })
      // Into the Sound Library, so it survives a reload and shows up as a real
      // sound the user owns — not a blob URL that dies with the session.
      const libraryId = await saveBounceToLibrary(`${clip.name || 'Apollo clip'} (frozen)`, buffer)
      const frozen: FrozenClip = {
        kind: 'audio',
        id: clip.id,
        trackId: clip.trackId,
        name: clip.name,
        startBeat: clip.startBeat,
        durationBeats: clip.durationBeats,
        libraryId,
        trimStart: 0,
        trimEnd: 0,
        gain: 1,
        frozenFrom: {
          notes: clip.notes,
          patch,
          bpm: project.tempo,
          stamp: freezeStamp(clip.notes, patch, project.tempo),
        },
      } as FrozenClip
      const at = clips.findIndex(c => c.id === clip.id)
      if (at >= 0) clips[at] = frozen
    } catch {
      // A clip that will not render stays a synth clip — worse for CPU, but
      // never silent, which is the wrong way to fail.
    }
    done++
  }
  onProgress?.(done, targets.length, 'done')
  return { ...project, arrangementClips: clips }
}

/** Put a frozen clip back to being a synth clip. */
export function thawClip(clip: FrozenClip): MidiClip | null {
  const src = clip.frozenFrom
  if (!src) return null
  return {
    kind: 'midi',
    id: clip.id,
    trackId: clip.trackId,
    name: clip.name,
    startBeat: clip.startBeat,
    durationBeats: clip.durationBeats,
    notes: src.notes,
    isDrumClip: false,
    presetId: undefined,   // the Apollo patch on the track is the sound, not a preset
    rollFx: {},
  } as MidiClip
}

/** Thaw every frozen clip in a project. */
export function thawApolloProject(project: DawProject): DawProject {
  return {
    ...project,
    arrangementClips: project.arrangementClips.map(c => {
      const t = (c as FrozenClip).frozenFrom ? thawClip(c as FrozenClip) : null
      return t ?? c
    }),
  }
}
