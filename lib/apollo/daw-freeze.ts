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
import { RENDER_SAMPLE_RATE } from '@/lib/render-rate'
import type { ApolloPatch } from '@/lib/apollo/patch'
import { ApolloEngine } from '@/lib/apollo/engine-client'
import { restorePatchSamples, saveBounceToLibrary } from '@/lib/apollo/sample-store'

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

// Both memos fall back to hashing directly when handed something a WeakMap
// cannot key on. A stamp is on the scheduling path, and a thrown TypeError there
// stops playback finding ANY buffer — a missing patch should degrade to a slower
// stamp, not to silence.
function notesHash(notes: MidiClip['notes']): string {
  if (!notes || typeof notes !== 'object') return hash(String(notes))
  const cached = notesHashCache.get(notes as unknown as object)
  if (cached !== undefined) return cached
  const h = hash(notes.map(x => `${x.pitch}:${x.startBeat}:${x.durationBeats}:${x.velocity}`).join(','))
  notesHashCache.set(notes as unknown as object, h)
  return h
}

function patchHash(patch: ApolloPatch): string {
  if (!patch || typeof patch !== 'object') return hash(String(patch))
  const cached = patchHashCache.get(patch as unknown as object)
  if (cached !== undefined) return cached
  const h = hash(JSON.stringify(patch))
  patchHashCache.set(patch as unknown as object, h)
  return h
}

/** The identity of a render: change the notes, the patch or the tempo and this
 *  changes, which is what tells a cached freeze it is stale. */
export function freezeStamp(notes: MidiClip['notes'], patch: ApolloPatch, bpm: number): string {
  // ⚠️ The RATE is part of what a render is. It was not in here, so a render
  // made at 44.1 kHz and one made at 48 kHz were indistinguishable — which was
  // survivable while renders never left the machine that made them, and is not
  // survivable now that they are cached, shared and served from the backend.
  //
  // Everything renders at RENDER_SAMPLE_RATE today, so in practice this is a
  // constant; it is in the stamp so that if it ever changes, or a render
  // arrives from somewhere that used a different one, the two can never be
  // mistaken for each other. Existing cached renders simply re-render once.
  return `${notesHash(notes)}-${patchHash(patch)}-${bpm}-${RENDER_SAMPLE_RATE}`
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
  // this never touches the live audio graph. Its sample map starts empty, and
  // renderToBuffer sends the node whatever is in it — so without this a sampled
  // instrument renders silence. Same fix, same reason as renderApolloProject.
  const engine = new ApolloEngine()
  await restorePatchSamples(patch, engine, { requireReady: false }).catch(() => [])
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
  //
  // The span is taken from the NOTES, not the clip boundaries, because silence
  // is not free. A synth with nothing sounding still runs its process loop and
  // its whole FX chain every block, so rendering an empty bar costs nearly what
  // rendering a busy one does. Measured on Undertow: the Rim track has notes
  // sounding for 7% of its clips and still took 5,283ms of a 33s render — almost
  // all of it reverb ticking over behind silence. Hats are 12% occupied, Kick
  // 13%. Trimming to where the music actually is skips that.
  //
  // Clips still start where they start: a clip whose notes begin late keeps its
  // leading silence, it just isn't synthesised. The slice loop below pads it
  // instead, which costs one memset rather than seconds of DSP.
  const clipFirst = Math.min(...live.flatMap(g => g.clips.map(c => c.startBeat)))
  const clipLast = Math.max(...live.flatMap(g => g.clips.map(c => c.startBeat + c.durationBeats)))
  const noteStarts = live.flatMap(g => g.clips.flatMap(c => c.notes.map(n => c.startBeat + n.startBeat)))
  const noteEnds = live.flatMap(g => g.clips.flatMap(c => c.notes.map(n => c.startBeat + n.startBeat + n.durationBeats)))
  // A small pre-roll so the first note never sits exactly at sample zero, and
  // clamped so trimming can never widen the span it was given.
  const PREROLL_BEATS = 0.125
  const firstBeat = noteStarts.length
    ? Math.max(clipFirst, Math.min(...noteStarts) - PREROLL_BEATS)
    : clipFirst
  // Only the START is trimmed. Trimming the END too looked equally free and was
  // not: a clip's slice is as long as the CLIP, so shortening the render below
  // that leaves the tail of the slice unfilled, and the cut lands mid-decay. The
  // combined-vs-live check caught it immediately — the Kick lost 15 points of low
  // end and grew 8.6% of energy above 2kHz out of nowhere, which is the spectrum
  // of a click, not of a kick drum.
  const lastBeat = clipLast
  void noteEnds
  const seconds = Math.max(0.05, (lastBeat - firstBeat) * spb + tailSec)

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
  // ── Give the render its samples ─────────────────────────────────────────
  //
  // This engine is brand new, so its `samples` map is empty — and
  // renderManyToBuffer sends each node the samples it finds THERE. Nothing ever
  // filled it, so every render of a sampled instrument was silent. A silent
  // render is discarded as a failure (a combined buffer replaces live playback,
  // and an empty one is worse than slow), so those clips never baked: they
  // played live for the whole session, on every session, and the loader
  // reported them as clips that "would not render".
  //
  // It went unnoticed because the synth patches everything was tested with have
  // no samples at all, so the map being empty was correct for them.
  //
  // Affordable now: the decode is global and deduplicated (sample-store), so
  // the audio a live track already loaded is handed over without touching the
  // disk or decoding anything twice.
  await Promise.all(
    [...new Set(live.map(g => g.patch))].map(p =>
      restorePatchSamples(p, engine, { requireReady: false }).catch(() => [])),
  )
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
      // `from` can now be NEGATIVE: the render starts at the first note, and a
      // clip may begin before that. Those beats are silence by definition, so
      // the slice keeps its full length and the rendered audio is written at the
      // matching offset inside it — the head stays zeroed. Without this the clip
      // would keep its length but have its audio slide earlier, which is the
      // kind of bug that sounds like "the timing drifted".
      const from = Math.floor((c.startBeat - firstBeat) * spb * sr)
      const len = Math.ceil((c.durationBeats + Math.min(tailBeats, tailSec / spb)) * spb * sr)
      if (len <= 0) return
      const srcStart = Math.max(0, from)
      const dstStart = Math.max(0, -from)
      const n = Math.min(len - dstStart, merged.length - srcStart)
      if (n <= 0) return
      const slice = cutter.createBuffer(2, len, sr)
      slice.getChannelData(0).set(chL.subarray(srcStart, srcStart + n), dstStart)
      slice.getChannelData(1).set(chR.subarray(srcStart, srcStart + n), dstStart)
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
  // Third of three: a fresh engine has no samples, and a render sends the node
  // only what its map holds. See renderApolloProject.
  await restorePatchSamples(patch, engine, { requireReady: false }).catch(() => [])
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

  // Render everything through the SAME path the combine cache uses, in small
  // batches, rather than one OfflineAudioContext per clip.
  //
  // Per-clip contexts are what made renders come back silent — a browser keeps
  // only a couple alive, and this loop would ask for one per clip, 39 times for
  // Undertow. That mattered less when a silent render just meant a clip played
  // live; here it would BAKE the silence into the project permanently, which is
  // the worst possible way for this to fail. renderApolloProject waits for each
  // worklet to acknowledge its patch before rendering a sample.
  const groups: TrackRenderGroup[] = [...apolloTracks.entries()].map(([trackId, patch]) => ({
    trackId, patch, clips: targets.filter(c => c.trackId === trackId),
  })).filter(g => g.clips.length)

  // Where the time goes, kept because "freezing is slow" is not actionable and
  // "the library writes took 9 of the 11 seconds" is. Baking runs while someone
  // is trying to work, so the number that matters is not how long it takes but
  // how long it holds the main thread at a stretch.
  const timing = { renderMs: 0, saveMs: 0, worstBlockMs: 0 }
  const block = async <T>(phase: 'renderMs' | 'saveMs', fn: () => Promise<T>): Promise<T> => {
    const t = performance.now()
    try { return await fn() } finally {
      const d = performance.now() - t
      timing[phase] += d
      if (d > timing.worstBlockMs) timing.worstBlockMs = d
    }
  }

  // Four clips per render call. One was tried and is worse on both counts.
  //
  // Measured on Undertow, freezing all 39 clips:
  //
  //                        total render   worst single block   worst frame stall
  //     4 clips per call         66.0s              11.3s               10.3s
  //     1 clip  per call        123.1s              13.3s                5.6s
  //
  // Chrome renders an OfflineAudioContext carrying JS worklets on the MAIN
  // THREAD, so the stall is not scheduling around the render — the stall IS the
  // render, and nothing yields inside it. Going to one clip per call nearly
  // doubled the total work (each context pays its own setup and worklet
  // handshake) and did not bound the block either: a single long pad clip on a
  // heavy patch took 13.3s by itself. Smaller batches cannot fix this; the
  // render has to leave the main thread. Four is the efficient setting.
  const BATCH = 4
  const ordered = [...targets].sort((a, b) => a.startBeat - b.startBeat)
  const rendered = new Map<string, AudioBuffer>()
  for (let i = 0; i < ordered.length; i += BATCH) {
    const batch = ordered.slice(i, i + BATCH)
    onProgress?.(done, targets.length, batch[0]?.name || 'rendering')
    try {
      const out = await block('renderMs', () => renderApolloProject(groups, project.tempo, {
        tailSec, only: new Set(batch.map(c => c.id)),
      }))
      for (const [id, buf] of out) if (!rendered.has(id)) rendered.set(id, buf)
    } catch { /* this batch stays unfrozen; the clips keep playing live */ }
    done += batch.length
    await breathe()
  }

  done = 0
  for (const clip of targets) {
    const patch = apolloTracks.get(clip.trackId)!
    onProgress?.(done, targets.length, clip.name || clip.id)
    try {
      const buffer = rendered.get(clip.id)
      // Never bake silence. A clip that came back empty stays a synth clip —
      // worse for CPU, but recoverable, and the user can freeze again. A silent
      // audio clip in a saved project is not recoverable by anyone.
      if (!buffer) throw new Error('no render')
      let peak = 0
      const d = buffer.getChannelData(0)
      for (let s = 0; s < d.length; s += 256) { const v = Math.abs(d[s]); if (v > peak) peak = v }
      if (peak < 1e-4) throw new Error('silent render')
      // Into the Sound Library, so it survives a reload and shows up as a real
      // sound the user owns — not a blob URL that dies with the session.
      const libraryId = await block('saveMs', () => saveBounceToLibrary(`${clip.name || 'Apollo clip'} (frozen)`, buffer))
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
    // Encoding a bounce and writing it to the library is a long synchronous
    // stretch, and thirty-nine of them back to back is thirty-nine of those with
    // nothing in between. Yielding here is what lets the studio paint a frame
    // between clips — measured, this is the difference between baking in the
    // background and the tab appearing to hang.
    await breathe()
  }
  onProgress?.(done, targets.length, 'done')
  ;(globalThis as unknown as { __freezeTiming?: unknown }).__freezeTiming = {
    ...timing,
    renderMs: Math.round(timing.renderMs),
    saveMs: Math.round(timing.saveMs),
    worstBlockMs: Math.round(timing.worstBlockMs),
    clips: targets.length,
  }
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
