/**
 * Undo History: the list of what you have done, and a way back to any of it.
 *
 * ⌘Z is a door you can only walk through one step at a time, in the dark. You
 * press it, look, press it again, look. The history is the same stack with the
 * lights on: you can see that the thing you want to undo was four edits ago,
 * and go there in one click instead of four guesses.
 *
 * ⚠️ ONE ROW PER REQUEST, NOT PER ACTION. A spoken command that adds a filter,
 * automates it and moves the playhead is three entries on the stack and one
 * thing that happened; a history that listed all three would be a worse
 * version of pressing ⌘Z three times. The grouping already exists on the stack
 * (lib/daw-undo.ts) — this reads it.
 *
 * Pure, and knows nothing about how an action is described: the caller passes
 * that in (the studio uses `describeAction` from lib/voice/transcript.ts, so
 * the history and the voice transcript say the same words about the same edit).
 */

import type { UndoEntry } from './daw-undo'

export interface HistoryRow {
  /** Stable within one render — the group id, or the index of a lone entry. */
  key: string
  /** What happened, in words. */
  label: string
  /** How many stack entries this row covers. */
  count: number
  /**
   * How many groups sit above this one, so undoing that many + 1 lands just
   * BEFORE this row happened, and undoing that many lands just after it.
   */
  groupsAbove: number
}

type Describe = (action: unknown) => string

/**
 * The stack as rows, NEWEST FIRST — the order a history panel reads in, and the
 * order the groups come off in.
 */
export function historyRows<P>(stack: ReadonlyArray<UndoEntry<P>>, describe: Describe): HistoryRow[] {
  const rows: HistoryRow[] = []
  let i = stack.length - 1
  while (i >= 0) {
    const entry = stack[i]
    let count = 1
    if (entry.group) {
      while (i - count >= 0 && stack[i - count].group === entry.group) count++
    }
    rows.push({
      key: entry.group ?? `e${i}`,
      // A group's own label wins: it is what somebody ASKED for, which is
      // always a better description than what the last action of it did.
      label: entry.label ?? describe(entry.action) ?? 'Changed something',
      count,
      groupsAbove: rows.length,
    })
    i -= count
  }
  return rows
}

/**
 * How many times to call undo to get back to the state just BEFORE the row at
 * `index` (0 = the newest row) happened.
 *
 * Undo takes one GROUP at a time, so this is a count of rows, not of entries —
 * getting that wrong is how a history panel undoes half of somebody's chord.
 */
export function undosToReach(index: number): number {
  return Math.max(0, index) + 1
}

/** The same for redo: how many redos to bring back the row at `index`. */
export function redosToReach(index: number, redoRowCount: number): number {
  // The redo stack's newest is what ⌘⇧Z brings back first, and a redo panel
  // lists oldest-first (the order they will come back), so a row `index` down
  // the list needs the ones above it first.
  return Math.max(0, Math.min(redoRowCount, index + 1))
}

/** "3 edits" / "1 edit" — what a row covers, when it covers more than one. */
export function countLabel(count: number): string {
  return count === 1 ? '' : `${count} edits`
}
