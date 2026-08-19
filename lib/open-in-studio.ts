// Bridge from an article widget into the real studio: stash a ready-made project
// in sessionStorage, then navigate to the guest studio, which consumes it on
// mount (see AudioEditor's initialProject). Lets a reader carry what they built
// in an article straight onto the timeline.

import {
  defaultProject, defaultPolyInstrument, defaultDrumInstrument, DEFAULT_TRACK_HEIGHT,
  type DawProject, type DawTrack, type MidiNote, type TrackInstrument,
} from './daw-types'
import { makeMidiClip } from './daw-state'

const SEED_KEY = '100lights-studio-seed'

/** Read + clear a pending seed. Called once when the studio mounts. */
export function consumeStudioSeed(): DawProject | null {
  try {
    if (typeof sessionStorage === 'undefined') return null
    const s = sessionStorage.getItem(SEED_KEY)
    if (!s) return null
    sessionStorage.removeItem(SEED_KEY)
    return JSON.parse(s) as DawProject
  } catch { return null }
}

function makeTrack(name: string, instrument: TrackInstrument): DawTrack {
  return {
    id: crypto.randomUUID(), name, type: 'audio', color: '#3d8fef',
    volume: 0.8, pan: 0, mute: false, solo: false, armed: false,
    inputSource: null, height: DEFAULT_TRACK_HEIGHT, effects: [], instrument,
  }
}

/** Stash a project and jump to the studio. */
export function openProjectInStudio(project: DawProject) {
  try { sessionStorage.setItem(SEED_KEY, JSON.stringify(project)) } catch { /* private mode — just navigate */ }
  window.location.assign('/create?modules=audio&audioMode=music')
}

/** Open the studio with one track holding `notes` as a single clip. */
export function openMidiInStudio(notes: MidiNote[], opts: { tempo?: number; name?: string; isDrum?: boolean } = {}) {
  const base = defaultProject()
  const instrument = opts.isDrum ? defaultDrumInstrument() : defaultPolyInstrument()
  const track = makeTrack(opts.name ?? (opts.isDrum ? 'Beat' : 'Track'), instrument)
  const contentEnd = notes.length ? Math.max(...notes.map(n => n.startBeat + n.durationBeats)) : 4
  const len = Math.max(4, Math.ceil(contentEnd / 4) * 4)
  const clip = makeMidiClip(track.id, opts.name ?? (opts.isDrum ? 'Beat' : 'Clip'), 0, len, { isDrumClip: !!opts.isDrum })
  clip.notes = notes.map(n => ({ ...n, id: crypto.randomUUID() }))
  const project: DawProject = {
    ...base,
    id: crypto.randomUUID(),
    name: opts.name ?? 'From an article',
    tempo: Math.round(opts.tempo ?? base.tempo),
    tracks: [track],
    arrangementClips: [clip],
  }
  openProjectInStudio(project)
}

/** Per-track settings the Firefly editor controls. */
export interface SketchTrackOpts { volume?: number; mute?: boolean; instrument?: TrackInstrument }
export interface SketchOpts { tempo?: number; name?: string; voice?: SketchTrackOpts; beat?: SketchTrackOpts }

/**
 * Build the two-track Firefly sketch as a DawProject: a melodic (voice) track and a drum (beat)
 * track, notes beat-based. Either list may be empty (only non-empty tracks are added). Shared by
 * in-app playback (DawEngine), export, and append-to-existing-project. Per-track volume/mute +
 * the voice instrument come from `opts`. Returns a project with 0 tracks if both lists are empty.
 */
export function buildSketchProject(melody: MidiNote[], beat: MidiNote[], opts: SketchOpts = {}): DawProject {
  const base = defaultProject()
  const end = [...melody, ...beat].reduce((m, n) => Math.max(m, n.startBeat + n.durationBeats), 0)
  const len = Math.max(4, Math.ceil((end || 4) / 4) * 4)

  const tracks: DawTrack[] = []
  const clips: DawProject['arrangementClips'] = []
  const addTrack = (name: string, instrument: TrackInstrument, notes: MidiNote[], isDrum: boolean, ts?: SketchTrackOpts) => {
    if (!notes.length) return
    const track = makeTrack(name, instrument)
    if (typeof ts?.volume === 'number') track.volume = ts.volume
    if (typeof ts?.mute === 'boolean') track.mute = ts.mute
    const clip = makeMidiClip(track.id, name, 0, len, { isDrumClip: isDrum })
    clip.notes = notes.map(n => ({ ...n, id: crypto.randomUUID() }))
    tracks.push(track)
    clips.push(clip)
  }
  addTrack('Voice', opts.voice?.instrument ?? defaultPolyInstrument(), melody, false, opts.voice)
  addTrack('Beat', defaultDrumInstrument(), beat, true, opts.beat)

  return {
    ...base,
    id: crypto.randomUUID(),
    name: opts.name ?? 'Firefly sketch',
    tempo: Math.round(opts.tempo ?? base.tempo),
    tracks,
    arrangementClips: clips,
  }
}

/** Build the sketch project and open it in the studio as a NEW project. */
export function openSketchInStudio(melody: MidiNote[], beat: MidiNote[], opts: SketchOpts = {}) {
  const project = buildSketchProject(melody, beat, opts)
  if (project.tracks.length) openProjectInStudio(project)
}
