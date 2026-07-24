// Turn the mobile studio's tracks into a real 100Lights project (opens + finishes
// on desktop). Two track kinds: 'drum' (a kit + step grid) and 'instrument' (a
// poly-synth sound + a scale-locked note grid). Both reuse the desktop
// DawProject model, so a phone sketch is a normal project.

import { defaultProject, defaultPolyInstrument, type DawProject, type TrackInstrument } from './daw-types'
import { DRUM_KITS, DRUM_LANES, STEP_BEATS, STEPS_PER_BAR } from './drum-presets'
import { DEFAULT_ADJUSTMENTS } from './editor-types'
import { CF_VERSION, type CfProjFile } from './project-serializer'

const uid = () => crypto.randomUUID()

export interface Row { label: string; pitch: number }

// Drum grid rows (mobile subset).
export const DRUM_ROWS: Row[] = (['kick', 'snare', 'clap', 'closedHat', 'openHat', 'rim', 'tomLo', 'crash']
  .map(k => DRUM_LANES.find(l => l.key === k)).filter(Boolean) as typeof DRUM_LANES)
  .map(l => ({ label: l.label, pitch: l.pitch }))

// Instrument grid rows: A-minor pentatonic across ~two octaves, high note on top —
// scale-locked so there are no wrong notes.
export const SCALE_ROWS: Row[] = [
  { label: 'G', pitch: 79 }, { label: 'E', pitch: 76 }, { label: 'D', pitch: 74 }, { label: 'C', pitch: 72 }, { label: 'A', pitch: 69 },
  { label: 'G', pitch: 67 }, { label: 'E', pitch: 64 }, { label: 'D', pitch: 62 }, { label: 'C', pitch: 60 }, { label: 'A', pitch: 57 },
]

export interface PolyPreset { id: string; name: string; params: Record<string, unknown> }
const polyBase = defaultPolyInstrument().params as unknown as Record<string, unknown>
export const POLY_PRESETS: PolyPreset[] = [
  { id: 'bass', name: 'Bass', params: { ...polyBase, waveform: 'sawtooth', filterCutoff: 700, filterResonance: 4, attack: 0.005, decay: 0.15, sustain: 0.5, release: 0.15 } },
  { id: 'keys', name: 'Keys', params: { ...polyBase, waveform: 'triangle', filterCutoff: 3000, attack: 0.005, decay: 0.4, sustain: 0.5, release: 0.3 } },
  { id: 'lead', name: 'Lead', params: { ...polyBase, waveform: 'square', filterCutoff: 3500, filterResonance: 3, attack: 0.005, decay: 0.2, sustain: 0.6, release: 0.25 } },
  { id: 'pad', name: 'Pad', params: { ...polyBase, waveform: 'sawtooth', filterCutoff: 1800, attack: 0.3, decay: 0.5, sustain: 0.7, release: 0.6 } },
]

export interface MobileTrack {
  id: string
  name: string
  kind: 'drum' | 'instrument'
  sound: string   // kit id (drum) or poly preset id (instrument)
  grid: boolean[][]  // [row][step]; rows are rowsFor(kind)
  volume: number
  muted: boolean
}

export function rowsFor(kind: 'drum' | 'instrument'): Row[] {
  return kind === 'drum' ? DRUM_ROWS : SCALE_ROWS
}

export function instrumentFor(track: Pick<MobileTrack, 'kind' | 'sound'>): TrackInstrument {
  if (track.kind === 'drum') {
    const kit = DRUM_KITS.find(k => k.id === track.sound) ?? DRUM_KITS[0]
    return structuredClone(kit.instrument) as TrackInstrument
  }
  const preset = POLY_PRESETS.find(p => p.id === track.sound) ?? POLY_PRESETS[0]
  return { type: 'poly', params: preset.params } as unknown as TrackInstrument
}

interface BeatNote { id: string; pitch: number; startBeat: number; durationBeats: number; velocity: number }

/** Every mobile track → one DawProject track (drum or poly) + a MIDI clip. */
export function buildMultiTrackProject(tracks: MobileTrack[], bpm: number): DawProject {
  const proj = defaultProject()
  proj.name = 'Mobile Track'
  proj.tempo = bpm
  const colors = ['#ef4444', '#3b82f6', '#22c55e', '#a855f7', '#f97316', '#14b8a6', '#eab308', '#ec4899']

  tracks.forEach((t, i) => {
    const rows = rowsFor(t.kind)
    const trackId = uid()
    proj.tracks.push({
      id: trackId, name: t.name, type: 'audio', color: colors[i % colors.length],
      volume: t.volume, pan: 0, mute: t.muted, solo: false, armed: false, inputSource: null,
      height: 64, effects: [], instrument: instrumentFor(t),
    })
    proj.sessionGrid[trackId] = Array(proj.scenes.length).fill(null)
    const notes: BeatNote[] = []
    t.grid.forEach((row, r) => row.forEach((on, s) => {
      if (on) notes.push({ id: uid(), pitch: rows[r].pitch, startBeat: s * STEP_BEATS, durationBeats: STEP_BEATS, velocity: 112 })
    }))
    proj.arrangementClips.push({
      kind: 'midi', id: uid(), trackId, name: t.name, startBeat: 0,
      durationBeats: STEPS_PER_BAR * STEP_BEATS, isDrumClip: t.kind === 'drum', notes,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
  })

  return proj
}

export function beatToCfProj(dawProject: DawProject): CfProjFile {
  return {
    _type: '100lights-project',
    version: CF_VERSION,
    id: uid(),
    name: dawProject.name || 'Mobile Track',
    savedAt: new Date().toISOString(),
    tracks: [], clips: [], adjustments: DEFAULT_ADJUSTMENTS, zoomLevel: 1,
    captions: [], outputs: [], media: [], audioMedia: [],
    moduleSavedAt: {}, modules: ['audio'], audioMode: 'music',
    dawProject,
  }
}
