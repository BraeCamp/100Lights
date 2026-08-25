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

/**
 * Hand the main thread back for a moment.
 *
 * `scheduler.yield()` resumes this work at the FRONT of the queue once the
 * browser has done a frame, so breaking a long job into pieces doesn't push it
 * to the back behind everything else. setTimeout is the fallback; it yields just
 * as well, it is only less fair about resuming.
 */
type Scheduler = { yield?: () => Promise<void> }
function breathe(): Promise<void> {
  const s = (globalThis as { scheduler?: Scheduler }).scheduler
  if (typeof s?.yield === 'function') return s.yield()
  return new Promise<void>(r => setTimeout(r, 0))
}

/** Cheap stable hash — enough to notice a roll or a patch changing. */
function hash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return (h >>> 0).toString(36)
}

// Hashing a stamp is not cheap, and the scheduler asks for one CONSTANTLY.
//
// combinedStamp runs on every scheduler pass for every Apollo clip — it is how
// playback finds the buffer to play. Each call was walking every note in the
// clip to build a string, hashing it, then running JSON.stringify over the
// ENTIRE Apollo patch (a fat patch is ~9.4KB) and hashing that too. Profiled on
// Iced, that came to 35% of all main-thread work during playback of an
// ALREADY-COMBINED song: 348ms in hash and 280ms in freezeStamp out of 1,966ms.
// The song was finished; the work was pure overhead, repeated forever.
//
// Both halves are memoised on object identity. The reducer never mutates a notes
// array or a patch in place — it maps to new ones — so a change always produces
// a new object and therefore a new hash. WeakMaps mean nothing is retained after
// an edit drops the old object.
const notesHashCache = new WeakMap<object, string>()
const patchHashCache = new WeakMap<object, string>()

function notesHash(notes: MidiClip['notes']): string {
  const cached = notesHashCache.get(notes as unknown as object)
  if (cached !== undefined) return cached
  const h = hash(notes.map(x => `${x.pitch}:${x.startBeat}:${x.durationBeats}:${x.velocity}`).join(','))
  notesHashCache.set(notes as unknown as object, h)
  return h
}

function patchHash(patch: ApolloPatch): string {
  const cached = patchHashCache.get(patch as unknown as object)
  if (cached !== undefined) return cached
  const h = hash(JSON.stringify(patch))
  patchHashCache.set(patch as unknown as object, h)
  return h
}

/** The identity of a render: change the notes, the patch or the tempo and this
 *  changes, which is what tells a cached freeze it is stale. */
export function freezeStamp(notes: MidiClip['notes'], patch: ApolloPatch, bpm: number): string {
  return `${notesHash(notes)}-${patchHash(patch)}-${bpm}`
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

/** One Apollo track's worth of work: its patch and the clips to render. */
export interface TrackRenderGroup { trackId: string; patch: ApolloPatch; clips: MidiClip[] }

/**
 * Render EVERY Apollo track of a project in ONE offline pass and cut the result
 * into per-clip buffers.
 *
 * This has to be one pass. A browser only keeps a couple of audio contexts
 * alive, so rendering a context per clip — or even per track — means the first
 * one or two produce audio and the rest come back silent. Measured on a
 * seven-track project: exactly two tracks ever rendered, whichever got there
 * first, however far apart the calls were spaced. renderManyToBuffer puts every
 * patch in a single context on its own channel pair instead.
 */
export async function renderApolloProject(
  groups: TrackRenderGroup[],
  bpm: number,
  { tailSec = 2, only, tracksWith }: { tailSec?: number; only?: Set<string>; tracksWith?: Set<string> } = {},
): Promise<Map<string, AudioBuffer>> {
  const out = new Map<string, AudioBuffer>()
  // Two ways to render less than everything.
  //
  // `only` renders a SUBSET OF CLIPS — for the opening, where the point is to
  // get the first seconds playable without synthesising the whole song.
  //
  // `tracksWith` renders WHOLE TRACKS, chosen by which ones still owe a clip.
  // That is what the main pass wants: on a warm load five missing clips used to
  // cost a full render of all seven tracks — 905 seconds of synthesis for a
  // 129-second song — because the pass was unscoped. Keeping each chosen track
  // WHOLE (rather than filtering to the missing clips) means tails and clip
  // neighbours are exactly as they'd be in a full render, so this is a pure
  // saving with nothing traded for it.
  const scoped = tracksWith
    ? groups.filter(g => g.clips.some(c => tracksWith.has(c.id)))
    : only
      ? groups.map(g => ({ ...g, clips: g.clips.filter(c => only.has(c.id)) }))
      : groups
  const live = scoped.filter(g => g.clips.some(c => c.notes.length > 0))
  if (!live.length) return out

  // Where each clip's neighbour REALLY is, from the unscoped project.
  //
  // The tail below stops at the next clip so a slice can't carry the following
  // clip's audio. Under `only` the scoped group holds just the wanted clips, so
  // "next" was the next WANTED clip — and in a real song the opening clips are
  // butt-joined to their successors (measured: gap 0.00s on all four of Iced's
  // opening clips). Every one of them was getting a 2-second tail full of the
  // next clip's audio, and both played. That is the overlap static, on exactly
  // the clips a listener hears first.
  const realNext = new Map<string, number>()
  for (const g of groups) {
    const ordered = g.clips.filter(c => c.notes.length > 0).sort((a, b) => a.startBeat - b.startBeat)
    ordered.forEach((c, i) => {
      const n = ordered[i + 1]
      if (n) realNext.set(c.id, n.startBeat)
    })
  }

  const spb = 60 / bpm
  // A shared origin keeps every track on the same timeline, so a clip slice
  // lands in the same place whichever track it came from. For a BATCH the
  // origin moves to the batch's own start — otherwise rendering the last eight
  // bars would still render the whole song up to them and save nothing.
  const firstBeat = Math.min(...live.flatMap(g => g.clips.map(c => c.startBeat)))
  const lastBeat = Math.max(...live.flatMap(g => g.clips.map(c => c.startBeat + c.durationBeats)))
  const seconds = (lastBeat - firstBeat) * spb + tailSec

  const items = live.map(g => ({
    patch: g.patch,
    notes: g.clips.flatMap(c => c.notes.map(n => ({
      t: (c.startBeat - firstBeat + n.startBeat) * spb,
      dur: Math.max(0.02, n.durationBeats * spb),
      note: n.pitch,
      vel: Math.max(0.05, (n.velocity ?? 100) / 127),
    }))),
  }))

  const engine = new ApolloEngine()
  // One merged buffer, track i on channels i*2 and i*2+1. Slices are cut
  // straight out of it — see renderManyToBuffer for why it isn't split first.
  const merged = await engine.renderManyToBuffer(items, seconds)
  if (!merged) return out

  const sr = merged.sampleRate
  const cutter = new OfflineAudioContext(2, 1, sr)
  // Cutting is a lot of memcpy — every track's full render copied out again,
  // clip by clip, which for a seven-track two-minute song is tens of millions of
  // samples. Done in one synchronous pass it froze the UI for 723ms while the
  // song was playing: the audio thread never missed a beat, but the playhead and
  // the whole interface stopped dead. Yield between TRACKS so the longest
  // uninterrupted block is one track's worth of copying, not the entire song's.
  for (let i = 0; i < live.length; i++) {
    const g = live[i]
    if (i > 0) await breathe()
    // This track's two channels within the merged render.
    const chL = merged.getChannelData(i * 2)
    const chR = merged.numberOfChannels > i * 2 + 1 ? merged.getChannelData(i * 2 + 1) : chL
    // Clips in playback order, so each one knows where the next begins.
    const ordered = g.clips.filter(c => c.notes.length > 0).sort((a, b) => a.startBeat - b.startBeat)
    ordered.forEach((c, ci) => {
      // The tail exists to catch releases and FX ringing past the last note. But
      // this is a slice of a CONTINUOUS render, so a tail that runs into the
      // next clip contains that clip's audio too — and both get played, summing
      // the overlap on every clip boundary. Back-to-back clips (an eight-bar
      // section followed by the next) made that every boundary in the song,
      // which is what the static was. Stop at the next clip: its own slice
      // already carries the ring-out from this one.
      // The next clip on this track in the REAL project, not just within this
      // render's scope — see realNext above.
      const nextStart = realNext.get(c.id) ?? (ordered[ci + 1]?.startBeat)
      const tailBeats = nextStart !== undefined
        ? Math.max(0, nextStart - (c.startBeat + c.durationBeats))
        : tailSec / spb
      const from = Math.max(0, Math.floor((c.startBeat - firstBeat) * spb * sr))
      const len = Math.min(
        merged.length - from,
        Math.ceil((c.durationBeats + Math.min(tailBeats, tailSec / spb)) * spb * sr),
      )
      if (len <= 0) return
      const slice = cutter.createBuffer(2, len, sr)
      slice.getChannelData(0).set(chL.subarray(from, from + len))
      slice.getChannelData(1).set(chR.subarray(from, from + len))
      out.set(c.id, slice)
    })
  }
  return out
}

/**
 * Render EVERY clip of one track in a single offline pass, then cut the result
 * into per-clip buffers.
 *
 * Rendering clip-by-clip builds one OfflineAudioContext per clip and registers
 * the worklet module again each time. Twenty-three of those in quick succession
 * mostly came back silent — and how many survived varied run to run (1, then 7,
 * then 3), which is resource exhaustion rather than anything about the patches.
 * One context per track is seven instead of twenty-three, and the slices cost no
 * more memory than the per-clip renders did.
 */
export async function renderApolloTrack(
  clips: MidiClip[],
  patch: ApolloPatch,
  bpm: number,
  { tailSec = 2 }: { tailSec?: number } = {},
): Promise<Map<string, AudioBuffer>> {
  const out = new Map<string, AudioBuffer>()
  const withNotes = clips.filter(c => c.notes.length > 0)
  if (!withNotes.length) return out

  const spb = 60 / bpm
  const firstBeat = Math.min(...withNotes.map(c => c.startBeat))
  const lastBeat = Math.max(...withNotes.map(c => c.startBeat + c.durationBeats))

  // Every note of every clip, placed on the track's own timeline.
  const notes: { t: number; dur: number; note: number; vel: number }[] = []
  for (const c of withNotes) {
    for (const n of c.notes) {
      notes.push({
        t: (c.startBeat + n.startBeat - firstBeat) * spb,
        dur: Math.max(0.02, n.durationBeats * spb),
        note: n.pitch,
        vel: Math.max(0.05, (n.velocity ?? 100) / 127),
      })
    }
  }
  const seconds = (lastBeat - firstBeat) * spb + tailSec
  const engine = new ApolloEngine()
  const full = await engine.renderToBuffer(patch, notes, seconds)

  // Cut each clip out, keeping a tail so releases and FX are not clipped off.
  const sr = full.sampleRate
  const ctx = new OfflineAudioContext(full.numberOfChannels, 1, sr)
  for (const c of withNotes) {
    const startSec = (c.startBeat - firstBeat) * spb
    const lenSec = c.durationBeats * spb + tailSec
    const from = Math.max(0, Math.floor(startSec * sr))
    const len = Math.min(full.length - from, Math.ceil(lenSec * sr))
    if (len <= 0) continue
    const slice = ctx.createBuffer(full.numberOfChannels, len, sr)
    for (let ch = 0; ch < full.numberOfChannels; ch++) {
      slice.getChannelData(ch).set(full.getChannelData(ch).subarray(from, from + len))
    }
    out.set(c.id, slice)
  }
  return out
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
