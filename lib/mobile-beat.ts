// Turn the mobile studio's tracks into a real 100Lights project (opens + finishes
// on desktop). Two track kinds: 'drum' (a kit + step grid) and 'instrument' (a
// poly-synth sound + a scale-locked note grid). Both reuse the desktop
// DawProject model, so a phone sketch is a normal project.

import {
  defaultProject, defaultPolyInstrument, defaultOscLayer, defaultTrackInstrument,
  POLY_PRESETS as SYNTH_PATCHES,
  type DawProject, type TrackInstrument, type PolyInstrumentParams,
} from './daw-types'
import { DRUM_KITS, DRUM_LANES, STEP_BEATS, STEPS_PER_BAR } from './drum-presets'
import { DEFAULT_ADJUSTMENTS } from './editor-types'
import { CF_VERSION, type CfProjFile, type SerializedAudioMedia } from './project-serializer'

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
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-')

// Four easy starters + every named patch from the desktop poly library, so the
// mobile Sounds tab offers the same built-in instruments as the full studio.
export const POLY_PRESETS: PolyPreset[] = [
  { id: 'keys', name: 'Keys', params: { ...polyBase, waveform: 'triangle', filterCutoff: 3000, attack: 0.005, decay: 0.4, sustain: 0.5, release: 0.3 } },
  { id: 'bass', name: 'Bass', params: { ...polyBase, waveform: 'sawtooth', filterCutoff: 700, filterResonance: 4, attack: 0.005, decay: 0.15, sustain: 0.5, release: 0.15 } },
  { id: 'lead', name: 'Lead', params: { ...polyBase, waveform: 'square', filterCutoff: 3500, filterResonance: 3, attack: 0.005, decay: 0.2, sustain: 0.6, release: 0.25 } },
  { id: 'pad', name: 'Pad', params: { ...polyBase, waveform: 'sawtooth', filterCutoff: 1800, attack: 0.3, decay: 0.5, sustain: 0.7, release: 0.6 } },
  ...Object.entries(SYNTH_PATCHES).map(([name, params]) => ({ id: slug(name), name, params: params as unknown as Record<string, unknown> })),
]

// A synced library sound (a sample) as a playable instrument: a poly voice whose
// single oscillator is that sample, pitched to each note. `sampleId` is the
// LibraryEntry id — warm it with ensurePolySample() before playback.
export function libraryInstrument(sampleId: string, sampleName?: string): TrackInstrument {
  return {
    type: 'poly',
    params: {
      ...polyBase,
      attack: 0.002, decay: 0.25, sustain: 0.95, release: 0.25,
      filterType: 'lowpass', filterCutoff: 16000, filterResonance: 0.6,
      lfoEnabled: false,
      oscillators: [defaultOscLayer({ source: 'sample', sampleId, sampleName, sampleRoot: 60, level: 1 })],
    } as PolyInstrumentParams,
  } as unknown as TrackInstrument
}

/** true for a track whose instrument sound is a synced library sample. */
export function isLibrarySound(sound: string): boolean {
  return sound.startsWith('lib:')
}

export interface MobileTrack {
  id: string
  name: string
  kind: 'drum' | 'instrument' | 'audio'
  sound: string   // kit id (drum) or poly preset id (instrument); '' for audio
  grid: boolean[][]  // [row][step]; rows are rowsFor(kind); empty for audio
  volume: number
  muted: boolean
  /** Recorded-audio tracks only: the captured loop. */
  audio?: { blob: Blob; duration: number }
}

export function rowsFor(kind: MobileTrack['kind']): Row[] {
  if (kind === 'drum') return DRUM_ROWS
  if (kind === 'instrument') return SCALE_ROWS
  return []  // audio tracks have no step grid
}

export function instrumentFor(track: Pick<MobileTrack, 'kind' | 'sound'>): TrackInstrument {
  if (track.kind === 'drum') {
    const kit = DRUM_KITS.find(k => k.id === track.sound) ?? DRUM_KITS[0]
    return structuredClone(kit.instrument) as TrackInstrument
  }
  if (isLibrarySound(track.sound)) return libraryInstrument(track.sound.slice(4))
  const preset = POLY_PRESETS.find(p => p.id === track.sound) ?? POLY_PRESETS[0]
  return { type: 'poly', params: preset.params } as unknown as TrackInstrument
}

interface BeatNote { id: string; pitch: number; startBeat: number; durationBeats: number; velocity: number }

/** Uploaded recorded-audio, keyed by MobileTrack id — supplied by the save flow
 *  after the blobs are PUT to R2. */
export interface AudioUpload { r2Key: string; duration: number; contentType: string }

/** Every mobile track → one DawProject track. Drum/instrument tracks become a
 *  MIDI clip; recorded-audio tracks (with an uploaded r2Key) become a looping
 *  AudioClip. */
export function buildMultiTrackProject(tracks: MobileTrack[], bpm: number, audioMap?: Map<string, AudioUpload>): DawProject {
  const proj = defaultProject()
  proj.name = 'Mobile Track'
  proj.tempo = bpm
  const colors = ['#ef4444', '#3b82f6', '#22c55e', '#a855f7', '#f97316', '#14b8a6', '#eab308', '#ec4899']

  tracks.forEach((t, i) => {
    const trackId = uid()

    if (t.kind === 'audio') {
      const info = audioMap?.get(t.id)
      if (!info) return  // no uploaded audio (e.g. still recording, or guest) — skip
      proj.tracks.push({
        id: trackId, name: t.name, type: 'audio', color: colors[i % colors.length],
        volume: t.volume, pan: 0, mute: t.muted, solo: false, armed: false, inputSource: null,
        height: 64, effects: [], instrument: defaultTrackInstrument('audio'),
      })
      proj.sessionGrid[trackId] = Array(proj.scenes.length).fill(null)
      const durationBeats = Math.max(1, info.duration * (bpm / 60))
      proj.arrangementClips.push({
        kind: 'audio', id: uid(), trackId, name: t.name, startBeat: 0, durationBeats,
        r2Key: info.r2Key, gain: 1, loopEnabled: true, reverse: false,
        fadeIn: 0, fadeOut: 0, trimStart: 0, trimEnd: 0, bufferDuration: info.duration,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
      return
    }

    const rows = rowsFor(t.kind)
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
    // Clip length follows the grid width — a 2- or 4-bar loop becomes a longer clip.
    const steps = t.grid[0]?.length ?? STEPS_PER_BAR
    proj.arrangementClips.push({
      kind: 'midi', id: uid(), trackId, name: t.name, startBeat: 0,
      durationBeats: steps * STEP_BEATS, isDrumClip: t.kind === 'drum', notes,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
  })

  return proj
}

export function beatToCfProj(dawProject: DawProject, audioMedia: SerializedAudioMedia[] = []): CfProjFile {
  return {
    _type: '100lights-project',
    version: CF_VERSION,
    id: uid(),
    name: dawProject.name || 'Mobile Track',
    savedAt: new Date().toISOString(),
    tracks: [], clips: [], adjustments: DEFAULT_ADJUSTMENTS, zoomLevel: 1,
    captions: [], outputs: [], media: [], audioMedia,
    moduleSavedAt: {}, modules: ['audio'], audioMode: 'music',
    dawProject,
  }
}
