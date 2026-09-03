'use client'
// ── Playing your way through a shelf of sounds ───────────────────────────────
//
// Brae: "Is there a way that I can have the program play existing recipes and
// samples under a tag? It should work well with just the program because I
// might say next, back, restart, pause, speed up, repeat the last, slow down...
// this should help users find recipes and samples."
//
// ⚠️ EVERY CONTROL HERE IS A BUILT-IN RULE, NEVER THE ASSISTANT. Browsing is a
// burst of short words — next, back, again, faster — said quickly while
// listening. Those are the cheapest commands in the studio and they have to
// stay that way, or hunting for a sample becomes the most expensive thing
// anybody does. Starting a browse can cost a turn; moving through one must not.
//
// ⚠️ AND IT IS A MODE, WHICH THIS PROJECT OTHERWISE AVOIDS. "Pause" means the
// song everywhere else and means the audition here. That is only safe because
// the session is VISIBLE and deliberate: you asked for it, the panel shows what
// is playing, and "stop browsing" ends it. An invisible mode is the thing worth
// refusing; an announced one is just a room you walked into.

import type { LibraryEntry } from '@/lib/sound-library'
import type { TrackInstrument } from '@/lib/daw-types'
import { noteOf } from '@/lib/apollo/multisample-zones'
import { tagsOf } from '@/lib/sound-tags'

/**
 * Something you can hear.
 *
 * ⚠️ A SAMPLE IS AUDIO, A RECIPE IS NOTES. One is a blob to decode, the other a
 * handful of pitches to play through an instrument — so they are one union
 * rather than one shape with half its fields empty, and the player decides what
 * to do by looking at `kind`. Everything ABOVE the player treats them
 * identically: the same tags, the same queue, the same words steer both.
 */
export type AuditionItem =
  | {
    kind: 'sample'
    id: string; name: string; detail: string; tags: string[]
  }
  | {
    kind: 'recipe'
    id: string; name: string; detail: string; tags: string[]
    notes: { pitch: number; startBeat: number; durationBeats: number; velocity: number }[]
    durationBeats: number
    bpm: number
    /** What the recipe itself asks to be played on. */
    instrument: TrackInstrument
    /** True when the recipe is happy to be played on whatever you choose. */
    usePreset: boolean
  }

export interface AuditionState {
  items: AuditionItem[]
  index: number
  playing: boolean
  rate: number
  /** What was asked for, so the panel can say "dark pads" rather than "23 sounds". */
  asked: string
  /**
   * What recipes are played on.
   *
   * ⚠️ A DRUM RECIPE IGNORES THIS. Brae: "The recipes should play based on the
   * chosen preset, but default will be grand piano." A grand piano playing a
   * hi-hat pattern is not a preference, it is a bug — so a recipe that says it
   * is drums keeps its own kit, and `usePreset` is the recipe's own word for
   * whether it minds.
   */
  preset: TrackInstrument | null
  presetName: string
}

// ── Choosing what goes in the list ──────────────────────────────────────────

/** MIDI 60. Not an arbitrary middle — it is the note people audition on. */
const MIDDLE = 60

/**
 * One sound per instrument.
 *
 * ⚠️ Brae: "We will need to change the sample library so that it only plays one
 * note from each instrument so that the user doesn't just hear a bunch of notes
 * of the same instrument."
 *
 * A multisample instrument is ONE folder holding dozens of entries — every note,
 * often several velocity layers and round-robins of each. Browsing that plainly
 * is forty seconds of the same cello, and the shelf never gets past C.
 *
 * ⚠️ BUT A DRUM FOLDER IS NOT ONE INSTRUMENT. It holds a kick, a snare, eleven
 * hats — all different sounds that happen to live together, and collapsing it
 * would hide almost everything. So the test is not "is this a folder", it is
 * "do these entries claim to be NOTES": a folder whose samples carry pitches is
 * one instrument played across its range; a folder whose samples do not is a
 * collection.
 *
 * The one kept is the note nearest middle C, because that is what an instrument
 * sounds LIKE — the bottom of a piano tells you almost nothing about it.
 */
export function oneNotePerInstrument(entries: LibraryEntry[]): LibraryEntry[] {
  const byFolder = new Map<string, LibraryEntry[]>()
  const loose: LibraryEntry[] = []
  for (const e of entries) {
    const key = (e.folder ?? '').trim()
    if (!key) { loose.push(e); continue }
    const g = byFolder.get(key)
    if (g) g.push(e)
    else byFolder.set(key, [e])
  }

  const out: LibraryEntry[] = [...loose]
  for (const group of byFolder.values()) {
    if (group.length === 1) { out.push(group[0]); continue }
    // Pitched? Then this folder is one instrument, and one note represents it.
    const pitched = group.filter(e => noteOf(e) != null)
    if (pitched.length < Math.max(2, group.length * 0.6)) {
      // Mostly unpitched — a collection of different sounds. Keep them all.
      out.push(...group)
      continue
    }
    let best = pitched[0]
    let bestGap = Math.abs((noteOf(best) ?? 0) - MIDDLE)
    for (const e of pitched) {
      const gap = Math.abs((noteOf(e) ?? 0) - MIDDLE)
      if (gap < bestGap) { best = e; bestGap = gap }
    }
    out.push(best)
  }
  return out
}

const fold = (s: string) => s.toLowerCase().trim()

/** The shelf, filtered and thinned. Pure, so it can be tested without audio. */
export function buildQueue(
  entries: LibraryEntry[],
  want: { tag?: string; category?: string; query?: string },
): AuditionItem[] {
  const tag = fold(want.tag ?? '')
  const cat = fold(want.category ?? '')
  const q = fold(want.query ?? '')

  // ⚠️ THE SHARED DERIVATION, not the raw field. tagsOf folds in this user's own
  // tags, the ones the sound shipped with, and what it measurably sounds like —
  // so browsing "dark" finds a sound somebody labelled dark, one the catalog
  // labelled dark, AND one that simply is. Reading e.tags here would have made
  // this the fourth place in the codebase that disagreed about what a tag is.
  const matched = entries.filter(e => {
    if (tag && !tagsOf(e).some(t => fold(t).includes(tag))) return false
    if (cat && fold(String(e.category ?? '')) !== cat) return false
    if (q) {
      const hay = `${e.name} ${e.folder ?? ''} ${tagsOf(e).join(' ')}`
      if (!fold(hay).includes(q)) return false
    }
    return true
  })

  return oneNotePerInstrument(matched).map(e => ({
    kind: 'sample' as const,
    id: e.id,
    name: e.name,
    detail: e.folder || String(e.category ?? ''),
    tags: tagsOf(e),
  }))
}

/**
 * The same filter, over recipes.
 *
 * Brae: "Recipes and samples should be navigated through tags."
 *
 * ⚠️ A RECIPE'S GENRE IS A TAG, whether or not anybody wrote it in the tag
 * list. Recipes have carried a genre since before they had tags, and browsing
 * "the jazz ones" has to work today rather than after somebody re-labels a
 * hundred rows — so the genre is folded in and the explicit tags are added on
 * top of it.
 */
export function recipeTags(r: { genre?: string; tags?: string[] }): string[] {
  const out = new Set<string>()
  for (const t of r.tags ?? []) if (t.trim()) out.add(t.trim())
  if (r.genre?.trim()) out.add(r.genre.trim())
  return [...out]
}

export function matchesWant(
  item: { name: string; detail: string; tags: string[] },
  want: { tag?: string; category?: string; query?: string },
): boolean {
  const tag = fold(want.tag ?? '')
  const q = fold(want.query ?? '')
  if (tag && !item.tags.some(t => fold(t).includes(tag))) return false
  if (q && !fold(`${item.name} ${item.detail} ${item.tags.join(' ')}`).includes(q)) return false
  return true
}

/**
 * Build a playable instrument out of a sampled instrument in the library.
 *
 * Brae: "The recipes should play based on the chosen preset, but default will
 * be grand piano. Users can choose another preset for it, including saved
 * presets."
 *
 * ⚠️ A SAMPLED INSTRUMENT IS ALREADY A TRACK INSTRUMENT — a poly voice with one
 * layer whose source is a sample. That is what makes this small: nothing has to
 * teach the audition about the sampler, because the thing that plays notes
 * already knows how to play a sampled layer.
 *
 * ⚠️ AND THE NOTE IT PICKS IS THE ONE NEAREST MIDDLE C, reusing the same rule
 * that thins the shelf. It matters more here than there: `sampleRoot` is what
 * every other pitch is stretched FROM, so choosing the bottom note of a piano
 * would leave the top two octaves as a resampled smear.
 */
export function presetFromLibrary(
  entries: LibraryEntry[], want: string,
): { instrument: TrackInstrument; name: string } | null {
  const w = fold(want)
  if (!w) return null
  const hits = entries.filter(e => fold(e.folder ?? '').includes(w) || fold(e.name).includes(w))
  if (!hits.length) return null
  const one = oneNotePerInstrument(hits)[0]
  if (!one) return null
  return {
    name: one.folder || one.name,
    instrument: {
      type: 'poly',
      params: {
        waveform: 'sine', attack: 0.004, decay: 0.12, sustain: 0.85, release: 0.35, detune: 0,
        oscillators: [{
          source: 'sample', waveform: 'sine', octave: 0, detune: 0,
          unison: 1, spread: 0, level: 1,
          sampleId: one.id, sampleName: one.name, sampleRoot: noteOf(one) ?? 60,
        }],
      },
    } as TrackInstrument,
  }
}

// ── The player ──────────────────────────────────────────────────────────────

type Fulfil = (id: string) => Promise<Blob | null>

let state: AuditionState | null = null
let ctx: AudioContext | null = null
let source: AudioBufferSourceNode | null = null
let fulfil: Fulfil | null = null
let token = 0
let recipeTimer: number | null = null
const subs = new Set<() => void>()
const decoded = new Map<string, AudioBuffer>()

export function onAudition(f: () => void): () => void {
  subs.add(f)
  return () => { subs.delete(f) }
}
const changed = () => { for (const f of subs) f() }

export function auditionActive(): boolean { return state != null }
export function auditionState(): AuditionState | null { return state ? { ...state } : null }
export function currentItem(): AuditionItem | null {
  return state ? (state.items[state.index] ?? null) : null
}

function stopSource(): void {
  // A recipe's notes are already scheduled in the audio clock, so stopping one
  // means cancelling the timer that would advance past it. The notes themselves
  // are short and land where they were put.
  if (recipeTimer != null) { clearTimeout(recipeTimer); recipeTimer = null }
  if (!source) return
  try { source.onended = null; source.stop() } catch { /* already finished */ }
  source = null
}

/**
 * ⚠️ ONE CONTEXT FOR THE WHOLE SESSION. The library's own preview opens a fresh
 * AudioContext per sound, which is survivable for a single click and disastrous
 * for browsing: a browser caps how many can exist, and a queue of forty would
 * hit that cap and go silent partway through with nothing to explain it.
 */
function audio(): AudioContext {
  ctx ??= new AudioContext()
  return ctx
}

async function bufferFor(id: string): Promise<AudioBuffer | null> {
  const had = decoded.get(id)
  if (had) return had
  const blob = await fulfil?.(id)
  if (!blob) return null
  const buf = await audio().decodeAudioData(await blob.arrayBuffer())
  // A modest cache: enough that "back" and "again" are instant, not so much
  // that browsing a big shelf holds every sample in memory.
  if (decoded.size > 40) decoded.clear()
  decoded.set(id, buf)
  return buf
}

/**
 * Fetch and decode the one AFTER this, quietly.
 *
 * ⚠️ Brae: "It will load the one that it's playing and the next in the list so
 * that the navigation is instant."
 *
 * Which is the difference between browsing and waiting. A sample that has not
 * been fetched costs a network round trip and a decode at the moment somebody
 * says "next" — so by the time they say it, it is already here. Only one ahead:
 * two is barely faster and a whole shelf is a download nobody asked for.
 *
 * Failures are swallowed whole. This is speculative work for something that
 * might never be reached, and it must never be the reason a browse breaks.
 */
function preloadNext(): void {
  if (!state) return
  const nxt = state.items[state.index + 1]
  if (!nxt || nxt.kind !== 'sample' || decoded.has(nxt.id)) return
  void bufferFor(nxt.id).catch(() => { /* it will be fetched again when reached */ })
}

/**
 * Play a recipe: a few pitches, through an instrument.
 *
 * ⚠️ THE RECIPE DECIDES WHETHER IT MINDS. `usePreset` is its own word for "any
 * instrument will do" — a chord progression is happy on a piano or a pad, and a
 * hi-hat pattern is not. So a drum recipe keeps the kit it was written for
 * however the browse is set up, because a grand piano playing hats is not a
 * preference anybody expressed.
 */
async function playRecipe(item: Extract<AuditionItem, { kind: 'recipe' }>, mine: number): Promise<void> {
  const { playInstrumentNote } = await import('@/lib/daw-instruments')
  if (mine !== token || !state) return
  const ctxNow = audio()
  const instrument = (item.usePreset && state.preset) ? state.preset : item.instrument
  const secPerBeat = 60 / (item.bpm || 100) / state.rate
  const t0 = ctxNow.currentTime + 0.06     // a breath, so the first note is not clipped
  for (const n of item.notes) {
    try {
      playInstrumentNote(
        ctxNow, ctxNow.destination, instrument, n.pitch, n.velocity,
        t0 + n.startBeat * secPerBeat, Math.max(0.05, n.durationBeats * secPerBeat),
      )
    } catch { /* one note that will not sound is not a reason to stop */ }
  }
  // Notes are scheduled, not streamed, so the end is arithmetic rather than an
  // event — and a timer is what stands in for `onended` here.
  const total = (item.durationBeats || 4) * secPerBeat + 0.4
  recipeTimer = window.setTimeout(() => {
    if (mine !== token || !state || !state.playing) return
    if (state.index < state.items.length - 1) { state.index++; changed(); void play() }
    else { state.playing = false; changed() }
  }, total * 1000)
}

async function play(): Promise<void> {
  const item = currentItem()
  if (!state || !item) return
  const mine = ++token
  stopSource()
  try {
    await audio().resume()
    if (item.kind === 'recipe') {
      state.playing = true
      changed()
      preloadNext()
      await playRecipe(item, mine)
      return
    }
    // Fetch the NEXT one while this one plays, not after it — see preloadNext.
    const buf = await bufferFor(item.id)
    if (!buf || mine !== token || !state) return
    const src = audio().createBufferSource()
    src.buffer = buf
    src.playbackRate.value = state.rate
    src.connect(audio().destination)
    src.onended = () => {
      if (mine !== token || !state || !state.playing) return
      // Straight on to the next, because that is what browsing IS. Stopping
      // after each one would mean saying "next" forty times to hear a shelf.
      if (state.index < state.items.length - 1) { state.index++; changed(); void play() }
      else { state.playing = false; changed() }
    }
    src.start(0)
    source = src
    state.playing = true
    changed()
    preloadNext()
  } catch {
    // A sound that will not decode is skipped rather than ending the browse.
    if (state && mine === token && state.index < state.items.length - 1) {
      state.index++; changed(); void play()
    }
  }
}

export function startAudition(
  items: AuditionItem[], asked: string, f: Fulfil,
  preset?: { instrument: TrackInstrument; name: string } | null,
): void {
  fulfil = f
  token++
  stopSource()
  decoded.clear()
  state = {
    items, index: 0, playing: false, rate: 1, asked,
    preset: preset?.instrument ?? null,
    presetName: preset?.name ?? '',
  }
  changed()
  void play()
}

/** Change what recipes play on, mid-browse. */
export function setAuditionPreset(instrument: TrackInstrument | null, name: string): void {
  if (!state) return
  state.preset = instrument
  state.presetName = name
  changed()
  if (currentItem()?.kind === 'recipe') void play()
}

export function stopAudition(): void {
  token++
  stopSource()
  state = null
  changed()
}

/** Every one of these is reached by a built-in rule, and none costs anything. */
export const audition = {
  next(): AuditionItem | null {
    if (!state) return null
    if (state.index < state.items.length - 1) state.index++
    changed(); void play()
    return currentItem()
  },
  back(): AuditionItem | null {
    if (!state) return null
    if (state.index > 0) state.index--
    changed(); void play()
    return currentItem()
  },
  again(): AuditionItem | null {
    if (!state) return null
    changed(); void play()
    return currentItem()
  },
  restart(): AuditionItem | null {
    if (!state) return null
    state.index = 0
    changed(); void play()
    return currentItem()
  },
  pause(): void {
    if (!state) return
    token++
    stopSource()
    state.playing = false
    changed()
  },
  resume(): void {
    if (!state || state.playing) return
    void play()
  },
  /** Half speed to double, which is as far as either direction stays useful. */
  rate(mul: number): number {
    if (!state) return 1
    state.rate = Math.max(0.5, Math.min(2, +(state.rate * mul).toFixed(2)))
    if (source) source.playbackRate.value = state.rate
    changed()
    return state.rate
  },
}

// ── Reading the words said while browsing ───────────────────────────────────
//
// ⚠️ NOT IN THE COMMAND REGISTRY, DELIBERATELY. These words already mean
// something else in a studio — "pause", "faster" and "back" are transport and
// tempo — and registering a second meaning for them would make every one of
// those sentences ambiguous across the whole application, to serve a mode that
// is usually not running.
//
// So they are read HERE, and only consulted while an audition is open, the same
// way undo and redo are intercepted before the rules ever see them. Inside the
// mode the words are unambiguous; outside it they never existed. That is also
// what keeps this mode honest: it can only capture words while it is visibly
// running, and one of the words it captures ends it.

export type BrowseAction =
  | 'next' | 'back' | 'again' | 'restart' | 'pause' | 'resume'
  | 'faster' | 'slower' | 'pick' | 'stop'

export function readBrowseCommand(text: string): BrowseAction | null {
  const t = String(text ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
  // A sentence is not a browse word. Anything longer is a real request and
  // belongs to the rules and the assistant, browsing or not.
  if (!t || t.split(' ').length > 4) return null

  // Leaving comes first, so "stop browsing" is never read as a pause.
  if (/^(done|enough|exit|quit)$/.test(t)) return 'stop'
  if (/\b(stop|done|finished|exit|quit|close)\b/.test(t) && /\b(browsing|browse|listening|looking)\b/.test(t)) return 'stop'

  if (/^(next|next one|next sound|forward|skip|move on|go on)$/.test(t)) return 'next'
  if (/^(back|go back|previous|previous one|last one|back one|one before)$/.test(t)) return 'back'
  if (/^(again|repeat|repeat that|play it again|play that again|once more|repeat the last)$/.test(t)) return 'again'
  if (/^(restart|start over|from the top|start again)$/.test(t)) return 'restart'
  if (/^(pause|wait|hold on|hang on|stop)$/.test(t)) return 'pause'
  if (/^(resume|carry on|keep going|continue|unpause)$/.test(t)) return 'resume'
  if (/^(faster|speed up|quicker|speed it up)$/.test(t)) return 'faster'
  if (/^(slower|slow down|slow it down)$/.test(t)) return 'slower'
  if (/^(this one|that one|keep it|keep that|take that|use that)$/.test(t)) return 'pick'
  return null
}
