/**
 * Renaming a run of tracks without touching the mouse.
 *
 * ⌘R opens the selected track's name for editing; Tab commits it and opens the
 * next one. That is the whole gesture, and it exists because naming eight
 * tracks is eight double-clicks, eight selects-all, eight types and eight
 * clicks-away — about forty actions for something that is really one.
 *
 * ⚠️ `#` IS THE AUTO-NUMBER. A name containing `#` becomes that name with the
 * hash replaced by the track's place in the run: type "Gtr #" and Tab four
 * times and you get Gtr 1, Gtr 2, Gtr 3, Gtr 4. Live does the same, and it is
 * the difference between naming a drum kit in six seconds and in a minute.
 *
 * Deliberately explicit rather than clever. An earlier idea was to notice a
 * trailing number and increment it, which reads well until somebody renames a
 * track "Take 2" and finds the next one called "Take 3" without asking for it.
 * A hash is a thing you typed on purpose.
 */

/** The name for position `n` (1-based) in a rename run. */
export function autoNumber(name: string, n: number): string {
  if (!name.includes('#')) return name
  // A run of hashes pads: "Gtr ##" gives 01, 02 — for a set that will be sorted
  // as text somewhere else.
  return name.replace(/#+/g, m => String(n).padStart(m.length, '0'))
}

/** Does this name number itself as the run goes on? */
export const isNumbered = (name: string) => name.includes('#')

/**
 * The next thing to open for renaming after `id`, or null at the end.
 *
 * Wraps deliberately NOT: Tab past the last track should stop, because the
 * alternative is a rename run that quietly starts overwriting the names you
 * just typed.
 */
export function nextToRename(ids: ReadonlyArray<string>, id: string): string | null {
  const at = ids.indexOf(id)
  if (at < 0 || at + 1 >= ids.length) return null
  return ids[at + 1]
}

/** What a numbered run will produce, for the hover text. */
export function previewRun(name: string, count: number): string {
  if (!isNumbered(name) || count < 2) return name
  const shown = [1, 2].map(n => autoNumber(name, n))
  return count > 2 ? `${shown.join(', ')}, … ${autoNumber(name, count)}` : shown.join(', ')
}
