'use client'
// Light's view of the studio — which may not be there.
//
// Brae: "The primary thing is to help light survive the trip with the switch to
// layout."
//
// Light used to be rendered inside the DAW's transport bar. That made it a
// child of the editor, so leaving the editor destroyed it: the conversation,
// the pending question, the history, everything. "Open the video module" could
// never work, because the thing being asked would stop existing on the way.
//
// Moving it up to the layout fixes that and creates a new problem: `useDaw()`
// THROWS outside the editor, and the layout renders on every page. So Light
// asks for the studio and is told honestly whether there is one.
//
// ⚠️ AN EMPTY STUDIO, NOT NULL. Fifteen places read `project.tracks` and
// friends; null-guarding each is fifteen chances to miss one and crash the
// voice control on the dashboard. An empty project makes every one of them
// answer "there is nothing here", which is true.
//
// ⚠️ AND THE DISPATCH IS NOT A NO-OP. A silent dispatch would let a command
// report success while changing nothing, which is the failure this project has
// chased more than any other. `inStudio` is the flag callers must check, and
// out of the studio the dispatch throws rather than pretending.

import { useMemo } from 'react'
import { useOptionalDaw } from '@/lib/daw-state'
import { useActiveStudio } from '@/lib/voice/studio-registry'
import type { DawContextValue } from '@/lib/daw-state'
import type { DawProject } from '@/lib/daw-types'

/** A project-shaped nothing, so readers can read and find nothing. */
const NO_PROJECT = {
  id: '', name: '', tempo: 120, timeSignatureNum: 4, timeSignatureDen: 4,
  masterVolume: 0.8, key: 0, scale: 'major',
  tracks: [], arrangementClips: [], returnTracks: [], automationLanes: [],
  clipEffects: [], sessionGrid: {}, scenes: [], takeLanes: [], presets: [],
  loopStart: 0, loopEnd: 0, loopEnabled: false,
} as unknown as DawProject

/**
 * Spelled out rather than derived from DawContextValue with Partial, so the
 * compiler can tell the difference between "there is no studio" (dispatch
 * throws, setters absent) and "this field happens to be optional".
 */
export interface LightStudio {
  /** Is there actually a studio on screen? Check this before any song command. */
  inStudio: boolean
  /** The open project, or an empty one that answers "nothing here". */
  project: DawProject
  dispatch: DawContextValue['dispatch']
  /** Absent outside the studio — there is no audio engine on the dashboard. */
  engine: DawContextValue['engine'] | null
  undo?: () => boolean | void
  redo?: () => boolean | void
  selectedTrackId: string | null
  selectedClipId: string | null
  metronome: boolean
  setMetronome?: (on: boolean) => void
  setExpandedStepSeqClipId?: (id: string | null) => void
  setExpandedPianoRollClipId?: (id: string | null) => void
  setSelectedClipIds?: DawContextValue['setSelectedClipIds']
  setSelectedClipId?: DawContextValue['setSelectedClipId']
  setSelectedTrackId?: DawContextValue['setSelectedTrackId']
}

export function useLight(): LightStudio {
  // ⚠️ THE REGISTRY FIRST, and the context only as a fallback.
  //
  // Light is mounted in the layout, BESIDE the page rather than inside it, so
  // it is not a descendant of the DAW's provider and context cannot reach it —
  // it returned null in the studio as reliably as it did on the dashboard. The
  // editor publishes itself to the registry instead. The context read stays for
  // anything that IS rendered inside the provider.
  const registered = useActiveStudio()
  const fromContext = useOptionalDaw()
  const daw = registered ?? fromContext
  return useMemo(() => {
    if (daw) return { ...daw, inStudio: true }
    return {
      inStudio: false,
      project: NO_PROJECT,
      // Loud on purpose. Nothing should reach this — `inStudio` is checked
      // before any command runs — and if something does, a thrown error in the
      // console is far easier to find than an edit that quietly went nowhere.
      dispatch: () => { throw new Error('Light: no studio is open — nothing to dispatch to') },
      engine: null,
      undo: undefined,
      redo: undefined,
      selectedTrackId: null,
      selectedClipId: null,
      metronome: false,
      setMetronome: undefined,
      setExpandedStepSeqClipId: undefined,
      setExpandedPianoRollClipId: undefined,
      setSelectedClipIds: undefined,
      setSelectedClipId: undefined,
      setSelectedTrackId: undefined,
    }
  }, [daw])
}
