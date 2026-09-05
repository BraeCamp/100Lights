// Collab-safe undo: instead of restoring a whole-project snapshot (which
// would silently revert collaborators' concurrent work — and, unbroadcast,
// diverge from the room until self-heal stomped the undo), each history entry
// remembers the action that caused it. Undo computes a minimal PATCH_PROJECT
// from the pre-action snapshot covering ONLY what that action touched, merged
// against the CURRENT state so everyone else's edits survive. The patch is a
// normal broadcastable action, so the room converges.

import type { DawProject } from './daw-types'
import type { DawAction } from './daw-state'

type EntitySlice = 'tracks' | 'arrangementClips' | 'clipEffects' | 'automationLanes' | 'returnTracks' | 'takeLanes'
type WholeSlice = keyof DawProject

interface Touched {
  /** Slices reverted wholesale (scalars, marker arrays, rare structural ops). */
  whole: WholeSlice[]
  /** Entity arrays reverted per-id — concurrent edits to other ids survive. */
  entities?: Partial<Record<EntitySlice, string[]>>
}

/** Everything — fallback for unknown actions; equivalent to the old full restore. */
const ALL: Touched = {
  whole: [
    'name', 'tempo', 'timeSignatureNum', 'timeSignatureDen', 'tracks', 'arrangementClips',
    'scenes', 'sessionGrid', 'masterVolume', 'automationLanes', 'clipEffects', 'returnTracks',
    'takeLanes', 'crossfaderValue', 'waveformZoom', 'swing', 'cueMarkers', 'tempoMarkers',
    'sections', 'comments', 'key', 'scale',
    // Missing until 2026-09: an unknown action's undo left these as they were.
    'presets', 'loopStart', 'loopEnd', 'loopEnabled', 'meterMarkers',
  ],
}

export function touchedByAction(action: DawAction): Touched {
  switch (action.type) {
    // ── clips (highest frequency — always per-entity) ──
    case 'ADD_CLIP':          return { whole: [], entities: { arrangementClips: [action.clip.id] } }
    case 'REMOVE_CLIP':
    case 'UPDATE_CLIP':
    case 'MOVE_CLIP':
    case 'ADD_MIDI_NOTE':
    case 'ADD_MIDI_NOTES':
    case 'REMOVE_MIDI_NOTE':
    case 'UPDATE_MIDI_NOTE':
    case 'UPDATE_MIDI_NOTES':
    case 'SPLICE_MIDI_NOTES':
    case 'RESOLVE_NOTE_OVERLAPS':
    case 'SET_CHANCE_GROUP':  return { whole: [], entities: { arrangementClips: [action.clipId] } }

    // ── clip effects (FX bars) ──
    case 'ADD_CLIP_EFFECT':   return { whole: [], entities: { clipEffects: [action.effect.id] } }
    case 'REMOVE_CLIP_EFFECT':
    case 'UPDATE_CLIP_EFFECT': return { whole: [], entities: { clipEffects: [action.effectId] } }

    // ── per-track updates ──
    case 'UPDATE_TRACK':
    case 'SET_INSTRUMENT':
    case 'SET_TRACK_FROZEN':
    case 'ADD_EFFECT':
    case 'REMOVE_EFFECT':
    case 'UPDATE_EFFECT':
    case 'REORDER_EFFECTS':
    case 'ADD_MIDI_EFFECT':
    case 'REMOVE_MIDI_EFFECT':
    case 'UPDATE_MIDI_EFFECT': return { whole: [], entities: { tracks: [action.trackId] } }

    // ── automation ──
    case 'ADD_AUTOMATION_LANE': return { whole: [], entities: { automationLanes: [action.lane.id] } }
    case 'REMOVE_AUTOMATION_LANE':
    case 'UPDATE_AUTOMATION_LANE':
    case 'ADD_AUTOMATION_POINT':
    case 'REMOVE_AUTOMATION_POINT':
    case 'UPDATE_AUTOMATION_POINT':
    case 'CLEAR_AUTOMATION_LANE': return { whole: [], entities: { automationLanes: [action.laneId] } }

    // ── returns / takes ──
    case 'UPDATE_RETURN_TRACK': return { whole: [], entities: { returnTracks: [action.trackId] } }
    case 'ADD_RETURN_EFFECT':
    case 'REMOVE_RETURN_EFFECT':
    case 'UPDATE_RETURN_EFFECT': return { whole: [], entities: { returnTracks: [action.returnId] } }
    case 'ADD_TAKE_LANE':        return { whole: [], entities: { takeLanes: [action.lane.id] } }
    case 'REMOVE_TAKE_LANE':
    case 'UPDATE_TAKE_LANE':     return { whole: [], entities: { takeLanes: [action.laneId] } }

    // ── project scalars ──
    case 'SET_TEMPO':          return { whole: ['tempo', 'arrangementClips'] }  // rescales unwarped audio lengths
    case 'SET_TIME_SIG':       return { whole: ['timeSignatureNum', 'timeSignatureDen'] }
    case 'SET_MASTER_VOLUME':  return { whole: ['masterVolume'] }
    case 'SET_SWING':          return { whole: ['swing'] }
    case 'SET_KEY_SCALE':      return { whole: ['key', 'scale'] }
    case 'SET_PROJECT_NAME':   return { whole: ['name'] }
    case 'SET_CROSSFADER':     return { whole: ['crossfaderValue'] }
    case 'SET_WAVEFORM_ZOOM':  return { whole: ['waveformZoom'] }
    case 'SET_LOOP':           return { whole: ['loopStart', 'loopEnd'] }
    case 'SET_LOOP_ENABLED':   return { whole: ['loopEnabled'] }

    // ── marker/annotation arrays (small — whole-slice is fine) ──
    case 'ADD_TEMPO_MARKER':
    case 'REMOVE_TEMPO_MARKER': return { whole: ['tempoMarkers'] }
    case 'ADD_SECTION':
    case 'REMOVE_SECTION':      return { whole: ['sections'] }
    case 'ADD_CUE_MARKER':
    case 'REMOVE_CUE_MARKER':
    case 'UPDATE_CUE_MARKER':   return { whole: ['cueMarkers'] }
    case 'ADD_COMMENT':
    case 'UPDATE_COMMENT':
    case 'REMOVE_COMMENT':      return { whole: ['comments'] }

    // ── session view ──
    case 'SET_SESSION_SLOT':    return { whole: ['sessionGrid'] }
    case 'ADD_SCENE':
    case 'REMOVE_SCENE':
    case 'UPDATE_SCENE':        return { whole: ['scenes', 'sessionGrid'] }

    // ── structural track ops (rare; cascade across slices) ──
    case 'ADD_TRACK':
    case 'REMOVE_TRACK':
    case 'DUPLICATE_TRACK':
    case 'REORDER_TRACKS':
      return { whole: ['tracks', 'arrangementClips', 'sessionGrid', 'automationLanes', 'clipEffects', 'takeLanes'] }
    // ⚠️ These fell through to ALL — so undoing "save preset" restored every
    // other slice wholesale (stomping a collaborator's edits) and did not touch
    // the presets, which ALL did not list. Each names only what it moved.
    case 'MOVE_TRACK':
    case 'GROUP_TRACKS':          return { whole: ['tracks'] }
    case 'SET_TRACK_HELIOS_FX':
    case 'SET_TRACK_HELIOS_SYNTH':
    case 'SET_TRACK_EFFECTS':     return { whole: [], entities: { tracks: [action.trackId] } }
    case 'ADD_PRESET':
    case 'UPDATE_PRESET':
    case 'REMOVE_PRESET':         return { whole: ['presets'] }
    case 'SET_LANE_OVERRIDDEN':   return { whole: [], entities: { automationLanes: [action.laneId] } }
    case 'REENABLE_ALL_AUTOMATION': return { whole: ['automationLanes'] }
    case 'ADD_RETURN_TRACK':
    case 'REMOVE_RETURN_TRACK':
      return { whole: ['returnTracks', 'tracks'] }

    default:
      return ALL
  }
}

// ── One request, one undo ────────────────────────────────────────────────────
//
// Brae: "it needs to be able to undo an entire request. If I ask it to do 4
// things in one request, an undo request after that should undo the whole
// thing. Perhaps we should have in the history a grouping mechanism."
//
// ⚠️ THE STACK STAYS ONE ENTRY PER ACTION. Grouping is a label on the
// entries, not a different shape: every action still reverts through its own
// touchedByAction, so a grouped undo is exactly N precise reverts in reverse
// order — collaboration-safe in the same way a single one is. What changes is
// how many the caller takes at once: all the entries at the top that share a
// group id come off together. An ungrouped entry comes off alone.
export interface UndoEntry<P> {
  before: P
  action: DawAction
  /** Set on every entry made inside one request (a spoken command, a macro,
   *  later a drag). Entries with the same id undo and redo together. */
  group?: string
  /** What the group was, in words — "make the reverb fall to 20% at bar 9". */
  label?: string
}

/**
 * Take the top entry off the stack — and, when it belongs to a group, every
 * entry above the group's start. Returned newest first, which is the order
 * they must be reverted in.
 */
export function takeUndoGroup<P>(stack: UndoEntry<P>[]): UndoEntry<P>[] {
  const top = stack.pop()
  if (!top) return []
  const taken = [top]
  if (top.group) {
    while (stack.length && stack[stack.length - 1].group === top.group) taken.push(stack.pop()!)
  }
  return taken
}

/** Per-id merge: current array, with the touched ids restored to their
 *  `from` versions (replaced in place, re-added if missing, or removed if
 *  they didn't exist in `from`). Untouched entities pass through untouched. */
function mergeEntities<T extends { id: string }>(current: T[], from: T[], ids: string[]): T[] {
  const idSet = new Set(ids)
  const fromById = new Map(from.filter(e => idSet.has(e.id)).map(e => [e.id, e]))
  const out: T[] = []
  const restored = new Set<string>()
  for (const e of current) {
    if (!idSet.has(e.id)) { out.push(e); continue }
    const prev = fromById.get(e.id)
    if (prev) { out.push(prev); restored.add(e.id) }
    // else: the action created it — reverting removes it
  }
  for (const [id, prev] of fromById) {
    if (!restored.has(id)) out.push(prev)  // the action removed it — reverting re-adds it
  }
  return out
}

/** The PATCH_PROJECT payload that reverts `action`'s footprint from `current`
 *  back to how it looked in `from`, leaving everything else alone. */
export function computeRevertPatch(from: DawProject, current: DawProject, action: DawAction): Partial<DawProject> {
  const touched = touchedByAction(action)
  const patch: Record<string, unknown> = {}
  for (const key of touched.whole) patch[key] = from[key]
  for (const [slice, ids] of Object.entries(touched.entities ?? {})) {
    const k = slice as EntitySlice
    patch[k] = mergeEntities(
      (current[k] ?? []) as Array<{ id: string }>,
      (from[k] ?? []) as Array<{ id: string }>,
      ids,
    )
  }
  return patch as Partial<DawProject>
}
