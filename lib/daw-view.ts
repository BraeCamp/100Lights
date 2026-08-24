'use client'
// Transport → arrangement: "put this beat in the middle of the view".
//
// On a phone the scrub bar is how the playhead is moved (dragging the timeline
// scrolls instead, so scrolling never nudges the playhead by accident). But
// seeking without moving the view leaves the playhead somewhere off-screen, so
// the bar appears to do nothing: you drag it, and the part of the song you are
// looking at does not change. Scrubbing should bring the song with it.
//
// The transport does not own the arrangement's scroll position, and threading a
// ref through the tree for one gesture is worse than a two-function bridge.

type Listener = (beat: number) => void
const listeners = new Set<Listener>()

/** Ask whatever is showing the timeline to centre this beat. */
export function centerOnBeat(beat: number): void {
  for (const fn of listeners) {
    try { fn(beat) } catch { /* one bad listener must not block the rest */ }
  }
}

/** Subscribe a timeline view. Returns an unsubscribe. */
export function onCenterOnBeat(fn: Listener): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
