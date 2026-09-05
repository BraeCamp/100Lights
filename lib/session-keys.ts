// ── Playing the grid from the keyboard ──────────────────────────────────────
//
// The session view could only be played with a mouse, which is the one input a
// performance does not have a spare hand for. This is the highlight — one cell
// of the grid — and what the keys do to it.
//
// Everything is pure: given where the highlight is and what the grid looks
// like, where does it go. The view holds the position and does the launching.

import type { DawClip } from './daw-types'

/** Where the keyboard is pointing. A scene with no track is the scene row itself. */
export interface Spot { track: number; scene: number }

export type GridMove = 'up' | 'down' | 'left' | 'right' | 'pageUp' | 'pageDown' | 'home' | 'end'

/** How far Page Up and Page Down jump. */
export const PAGE = 8

/**
 * The highlight after a move, clamped to the grid.
 *
 * ⚠️ Clamped rather than wrapped. Wrapping the scene axis would mean Down at
 * the bottom silently launching the first scene next time somebody pressed
 * Enter, which is a wrong clip fired during a performance — the one mistake
 * this view cannot make.
 */
export function moveSpot(at: Spot, move: GridMove, tracks: number, scenes: number): Spot {
  const t = Math.max(0, tracks - 1), s = Math.max(0, scenes - 1)
  const clamp = (n: number, hi: number) => Math.max(0, Math.min(hi, n))
  switch (move) {
    case 'up': return { ...at, scene: clamp(at.scene - 1, s) }
    case 'down': return { ...at, scene: clamp(at.scene + 1, s) }
    case 'left': return { ...at, track: clamp(at.track - 1, t) }
    case 'right': return { ...at, track: clamp(at.track + 1, t) }
    case 'pageUp': return { ...at, scene: clamp(at.scene - PAGE, s) }
    case 'pageDown': return { ...at, scene: clamp(at.scene + PAGE, s) }
    case 'home': return { ...at, scene: 0 }
    case 'end': return { ...at, scene: s }
  }
}

/** The clip under the highlight, if there is one. */
export function clipAt(grid: Record<string, (DawClip | null)[]>, trackIds: readonly string[], at: Spot): DawClip | null {
  const id = trackIds[at.track]
  return id ? (grid[id]?.[at.scene] ?? null) : null
}

/**
 * What is playing right now, as a scene: the clips to put in a captured row.
 *
 * `playing` is trackId → the clip id sounding on it. A track playing nothing
 * contributes nothing, so the captured scene leaves it alone rather than
 * silencing it — capturing what you have should not change what you hear.
 */
export function captureScene(
  grid: Record<string, (DawClip | null)[]>,
  playing: Record<string, string | null>,
  makeId: () => string,
): Record<string, DawClip | null> {
  const out: Record<string, DawClip | null> = {}
  for (const [trackId, clipId] of Object.entries(playing)) {
    if (!clipId) continue
    const found = (grid[trackId] ?? []).find(c => c?.id === clipId)
    // A copy, with its own id: the captured scene is a new row, and two rows
    // sharing one clip object would rename and recolour together.
    if (found) out[trackId] = { ...found, id: makeId() } as DawClip
  }
  return out
}

/** How many tracks and scenes a capture would fill, for saying what happened. */
export function describeCapture(clips: Record<string, DawClip | null>): string {
  const n = Object.values(clips).filter(Boolean).length
  return n ? `${n} clip${n === 1 ? '' : 's'}` : 'nothing playing'
}
