// Turn the mobile beat maker's local grid into a real 100Lights project, so a
// beat made on a phone opens (and finishes) in the desktop studio. Reuses the
// same DawProject model + drum kits the desktop editor uses.

import { defaultProject, type DawProject, type TrackInstrument } from './daw-types'
import { DRUM_KITS, STEP_BEATS, STEPS_PER_BAR } from './drum-presets'
import { DEFAULT_ADJUSTMENTS } from './editor-types'
import { CF_VERSION, type CfProjFile } from './project-serializer'

const uid = () => crypto.randomUUID()

interface BeatNote { id: string; pitch: number; startBeat: number; durationBeats: number; velocity: number }

/** grid[lane][step] → a one-track drum project at the given tempo. */
export function buildBeatProject(grid: boolean[][], lanePitches: number[], kitId: string, bpm: number): DawProject {
  const proj = defaultProject()
  proj.name = 'Mobile Beat'
  proj.tempo = bpm

  const kit = DRUM_KITS.find(k => k.id === kitId) ?? DRUM_KITS[0]
  const trackId = uid()
  proj.tracks.push({
    id: trackId, name: 'Drums', type: 'audio', color: '#ef4444',
    volume: 0.8, pan: 0, mute: false, solo: false, armed: false, inputSource: null,
    height: 64, effects: [], instrument: structuredClone(kit.instrument) as TrackInstrument,
  })
  proj.sessionGrid[trackId] = Array(proj.scenes.length).fill(null)

  const notes: BeatNote[] = []
  grid.forEach((row, l) => row.forEach((on, s) => {
    if (on) notes.push({ id: uid(), pitch: lanePitches[l], startBeat: s * STEP_BEATS, durationBeats: STEP_BEATS, velocity: 112 })
  }))
  proj.arrangementClips.push({
    kind: 'midi', id: uid(), trackId, name: 'Beat', startBeat: 0,
    durationBeats: STEPS_PER_BAR * STEP_BEATS, isDrumClip: true, notes,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)

  return proj
}

/** Wrap a DawProject in the project-file envelope the POST /api/projects route expects. */
export function beatToCfProj(dawProject: DawProject): CfProjFile {
  return {
    _type: '100lights-project',
    version: CF_VERSION,
    id: uid(),
    name: dawProject.name || 'Mobile Beat',
    savedAt: new Date().toISOString(),
    tracks: [], clips: [], adjustments: DEFAULT_ADJUSTMENTS, zoomLevel: 1,
    captions: [], outputs: [], media: [], audioMedia: [],
    moduleSavedAt: {}, modules: ['audio'], audioMode: 'music',
    dawProject,
  }
}
