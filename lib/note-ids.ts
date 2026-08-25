// A note's id is runtime identity, not musical data — so it should not be
// stored, and it costs more than everything it sits next to.
//
// A stored note looks like this, 110 bytes:
//
//   {"id":"ac7eb94a-8f20-448c-8c3b-6157af90cc12","pitch":62,
//    "startBeat":0.0038,"durationBeats":3.85,"velocity":48}
//
// 43 of those bytes are the UUID. Winter Drift has 1,287 notes, so 55 KB of a
// 221 KB project is identifiers. Worse, they are RANDOM, so they don't
// compress: dropping them takes the project from 36.1 KB brotli to 11.3 KB —
// a 69% cut on the wire from deleting a field that carries no information.
//
// Nothing persists a reference to a note id. Per-note FX lives ON the note
// (UPDATE_MIDI_NOTE patches note.fx), and the engine's NoteKey is built fresh
// each session. Ids only have to be unique within their clip and stable for as
// long as the page is open.
//
// Restoration is by INDEX, not random, and that matters for collaboration: two
// clients opening the same project independently must arrive at the same ids,
// or one client's note edit addresses nothing on the other. Index-derived ids
// are identical everywhere and cost no crypto calls — 1,287 of them are a loop,
// not 1,287 randomUUID()s.

import type { DawProject, DawClip, MidiNote } from './daw-types'

// A note WITHOUT its id — the shape that actually goes to the database. It is
// not a MidiNote (MidiNote.id is required, and rightly so at runtime), so the
// two conversions below go through `unknown` on purpose: the stored form is
// deliberately lossy, and saying so in the types beats pretending otherwise.
type StoredNote = Omit<MidiNote, 'id'> & { id?: string }

const hasNotes = (c: DawClip | null): c is DawClip & { notes: StoredNote[] } =>
  !!c && Array.isArray((c as { notes?: unknown }).notes)

/** Map every clip in a project, wherever clips live. */
function mapClips(dp: DawProject, fn: (c: DawClip) => DawClip): DawProject {
  const grid: DawProject['sessionGrid'] = {}
  for (const [trackId, slots] of Object.entries(dp.sessionGrid ?? {})) {
    grid[trackId] = (slots ?? []).map(c => (c ? fn(c) : c))
  }
  return {
    ...dp,
    arrangementClips: (dp.arrangementClips ?? []).map(fn),
    sessionGrid: grid,
  }
}

/** Drop note ids for storage. Safe to call twice. */
export function stripNoteIds(dp: DawProject): DawProject {
  return mapClips(dp, c => {
    if (!hasNotes(c)) return c
    const notes = c.notes.map((n: StoredNote) => {
      const { id: _id, ...rest } = n
      return rest
    })
    return { ...c, notes } as unknown as DawClip
  })
}

/**
 * Put ids back on load. Only fills in what's missing, so a project saved before
 * this — with real UUIDs on every note — passes through untouched.
 */
export function restoreNoteIds(dp: DawProject): DawProject {
  return mapClips(dp, c => {
    if (!hasNotes(c)) return c
    const notes = c.notes
    if (notes.every(n => typeof n.id === 'string' && n.id)) return c
    const filled = notes.map((n, i) => (n.id ? n : { ...n, id: `n${i}` }))
    return { ...c, notes: filled } as unknown as DawClip
  })
}
