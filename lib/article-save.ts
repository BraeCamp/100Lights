// Save what a reader built in an article to their library. Recipes go to
// localStorage (no sign-in needed — they appear in the library's Recipe tab and
// sync to the account later if the reader signs in). Kept dependency-light so the
// article widgets don't pull in the editor bundle.

import { importRecipe } from './practice-recipes'
import type { MidiNote } from './daw-types'

const RECIPES_CHANGED = '100lights-recipes-changed'

/** Save notes as a library recipe (a MIDI phrase others can drop on a track). */
export function saveRecipe(notes: MidiNote[], opts: { title: string; tagline?: string; isDrum?: boolean; durationBeats?: number }) {
  const contentEnd = notes.length ? Math.max(...notes.map(n => n.startBeat + n.durationBeats)) : 4
  const dur = opts.durationBeats ?? Math.max(4, Math.ceil(contentEnd / 4) * 4)
  importRecipe({
    id: `user-${crypto.randomUUID()}`,
    title: opts.title,
    tagline: opts.tagline || 'Made in a lesson',
    annotation: [],
    spec: {
      trackName: opts.title,
      instrument: { type: 'none', params: {} },
      isDrumClip: !!opts.isDrum,
      durationBeats: dur,
      usePreset: !opts.isDrum,
      notes: notes.map(n => ({ pitch: n.pitch, startBeat: n.startBeat, durationBeats: n.durationBeats, velocity: n.velocity })),
    },
  })
  try { window.dispatchEvent(new Event(RECIPES_CHANGED)) } catch { /* SSR */ }
}
