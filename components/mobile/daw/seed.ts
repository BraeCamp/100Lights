// Build the initial mobile-DAW project: a real DawProject with a Drums + Bass
// track, each carrying one MIDI clip, assembled through the reducer so it's a
// normal arrangement that opens on desktop too.

import { reducer, makeMidiClip } from '@/lib/daw-state'
import { defaultProject, defaultPolyInstrument, type DawProject, type MidiNote, type TrackInstrument } from '@/lib/daw-types'
import { DRUM_KITS, DRUM_LANES } from '@/lib/drum-presets'

const uid = () => crypto.randomUUID()
export const STEP = 0.25   // a 16th note, in beats

export function drumInstrument(kitId: string): TrackInstrument {
  const kit = DRUM_KITS.find(k => k.id === kitId) ?? DRUM_KITS[0]
  return structuredClone(kit.instrument) as TrackInstrument
}

export function polyInstrument(over: Record<string, unknown> = {}): TrackInstrument {
  const base = defaultPolyInstrument()
  return { type: 'poly', params: { ...(base.params as Record<string, unknown>), ...over } } as unknown as TrackInstrument
}

export const lanePitch = (key: string) => DRUM_LANES.find(l => l.key === key)?.pitch ?? 36

const note = (pitch: number, step: number, velocity = 110, lenSteps = 1): MidiNote =>
  ({ id: uid(), pitch, startBeat: step * STEP, durationBeats: lenSteps * STEP, velocity })

function seededDrums(): MidiNote[] {
  const n: MidiNote[] = []
  ;[0, 4, 8, 12].forEach(s => n.push(note(lanePitch('kick'), s)))
  ;[4, 12].forEach(s => n.push(note(lanePitch('snare'), s)))
  ;[0, 2, 4, 6, 8, 10, 12, 14].forEach(s => n.push(note(lanePitch('closedHat'), s, 78)))
  return n
}

function seededBass(): MidiNote[] {
  return [0, 6, 8, 14].map(s => note(45, s, 105, 2)) // A2 root pulse
}

export function seedProject(): DawProject {
  let p = defaultProject()
  p = reducer(p, { type: 'SET_PROJECT_NAME', name: 'Mobile Song' })
  p = reducer(p, { type: 'SET_TEMPO', tempo: 90 })

  p = reducer(p, { type: 'ADD_TRACK', name: 'Drums', instrument: drumInstrument('boombap') })
  const drumId = p.tracks[p.tracks.length - 1].id
  p = reducer(p, { type: 'ADD_CLIP', clip: makeMidiClip(drumId, 'Beat', 0, 4, { isDrumClip: true, notes: seededDrums() }) })

  p = reducer(p, { type: 'ADD_TRACK', name: 'Bass', instrument: polyInstrument({ waveform: 'sawtooth', filterCutoff: 700, filterResonance: 4, attack: 0.005, decay: 0.16, sustain: 0.6, release: 0.18 }) })
  const bassId = p.tracks[p.tracks.length - 1].id
  p = reducer(p, { type: 'ADD_CLIP', clip: makeMidiClip(bassId, 'Bassline', 0, 4, { notes: seededBass() }) })

  return p
}
