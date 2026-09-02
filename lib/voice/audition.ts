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
import { noteOf } from '@/lib/apollo/multisample-zones'

export interface AuditionItem {
  id: string
  name: string
  /** Where it came from, for the read-back — a folder, or a category. */
  detail: string
}

export interface AuditionState {
  items: AuditionItem[]
  index: number
  playing: boolean
  rate: number
  /** What was asked for, so the panel can say "dark pads" rather than "23 sounds". */
  asked: string
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

  const matched = entries.filter(e => {
    if (tag && !(e.tags ?? []).some(t => fold(t).includes(tag))) return false
    if (cat && fold(String(e.category ?? '')) !== cat) return false
    if (q) {
      const hay = `${e.name} ${e.folder ?? ''} ${(e.tags ?? []).join(' ')}`
      if (!fold(hay).includes(q)) return false
    }
    return true
  })

  return oneNotePerInstrument(matched).map(e => ({
    id: e.id,
    name: e.name,
    detail: e.folder || String(e.category ?? ''),
  }))
}

// ── The player ──────────────────────────────────────────────────────────────

type Fulfil = (id: string) => Promise<Blob | null>

let state: AuditionState | null = null
let ctx: AudioContext | null = null
let source: AudioBufferSourceNode | null = null
let fulfil: Fulfil | null = null
let token = 0
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

async function play(): Promise<void> {
  const item = currentItem()
  if (!state || !item) return
  const mine = ++token
  stopSource()
  try {
    await audio().resume()
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
  } catch {
    // A sound that will not decode is skipped rather than ending the browse.
    if (state && mine === token && state.index < state.items.length - 1) {
      state.index++; changed(); void play()
    }
  }
}

export function startAudition(items: AuditionItem[], asked: string, f: Fulfil): void {
  fulfil = f
  token++
  stopSource()
  state = { items, index: 0, playing: false, rate: 1, asked }
  changed()
  void play()
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
