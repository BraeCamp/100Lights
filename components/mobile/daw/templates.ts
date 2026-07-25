// Genre "start from a beat" templates for the mobile studio. Each builds a real
// DawProject (drums + bass, sometimes keys) from the existing kits/patterns so a
// brand-new project makes music the instant you press Play — no blank timeline.

import { reducer, makeMidiClip } from '@/lib/daw-state'
import { defaultProject, type DawProject, type MidiNote } from '@/lib/daw-types'
import { DRUM_PATTERNS, patternToNotes } from '@/lib/drum-presets'
import { drumInstrument, polyInstrument, STEP } from './seed'

const uid = () => crypto.randomUUID()
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

const n = (pitch: number, step: number, velocity = 105, lenSteps = 2): MidiNote =>
  ({ id: uid(), pitch, startBeat: step * STEP, durationBeats: lenSteps * STEP, velocity })

// Simple root/fifth bass groove from a rhythm of step indices.
function bass(root: number, steps: number[], fifthOn: number[] = []): MidiNote[] {
  const out = steps.map(s => n(root, s, 108, 2))
  fifthOn.forEach(s => out.push(n(root + 7, s, 96, 2)))
  return out
}

// A held triad (root/third/fifth) for a keys pad.
function chord(root: number, third: number, steps: number[], lenSteps = 4): MidiNote[] {
  const out: MidiNote[] = []
  steps.forEach(s => { [root, root + third, root + 7].forEach(p => out.push(n(p, s, 70, lenSteps))) })
  return out
}

export interface MobileTemplate {
  id: string
  name: string
  emoji: string
  blurb: string
  tempo: number
  key: number            // 0=C … 11=B
  scale: string
  kitId: string
  patternId: string
  bassInst: Record<string, unknown>
  bass: () => MidiNote[]
  keys?: { inst: Record<string, unknown>; notes: () => MidiNote[] }
}

// Roots chosen to sit low; third=3 (minor) or 4 (major).
export const MOBILE_TEMPLATES: MobileTemplate[] = [
  {
    id: 'hiphop', name: 'Hip-Hop', emoji: '🎤', blurb: 'Boom-bap kit, dusty swing',
    tempo: 88, key: 9, scale: 'minor', kitId: 'boombap', patternId: 'boombap',
    bassInst: { waveform: 'sawtooth', filterCutoff: 650, filterResonance: 4, attack: 0.005, decay: 0.18, sustain: 0.5, release: 0.2 },
    bass: () => bass(45, [0, 6, 8, 14], [4]),        // A
  },
  {
    id: 'trap', name: 'Trap', emoji: '🔥', blurb: '808 sub + rolling hats',
    tempo: 140, key: 5, scale: 'minor', kitId: 'trap808', patternId: 'trap',
    bassInst: { waveform: 'sine', filterCutoff: 500, filterResonance: 2, attack: 0.004, decay: 0.5, sustain: 0.7, release: 0.4 },
    bass: () => bass(41, [0, 6, 10], []),            // F 808
  },
  {
    id: 'lofi', name: 'Lo-Fi', emoji: '🌙', blurb: 'Soft kit, mellow keys',
    tempo: 74, key: 0, scale: 'major', kitId: 'lofi', patternId: 'boombap',
    bassInst: { waveform: 'triangle', filterCutoff: 600, filterResonance: 2, attack: 0.01, decay: 0.3, sustain: 0.5, release: 0.3 },
    bass: () => bass(36, [0, 8], [4, 12]),           // C
    keys: { inst: { waveform: 'triangle', filterCutoff: 1800, attack: 0.02, decay: 0.5, sustain: 0.6, release: 0.6 }, notes: () => chord(60, 4, [0, 8]) }, // C major pad
  },
  {
    id: 'pop', name: 'Pop', emoji: '✨', blurb: 'Punchy kit, bright chords',
    tempo: 118, key: 0, scale: 'major', kitId: 'pop', patternId: 'rock',
    bassInst: { waveform: 'sawtooth', filterCutoff: 900, filterResonance: 3, attack: 0.005, decay: 0.16, sustain: 0.6, release: 0.18 },
    bass: () => bass(36, [0, 4, 8, 12], []),         // C pulse
    keys: { inst: { waveform: 'square', filterCutoff: 2400, attack: 0.005, decay: 0.4, sustain: 0.5, release: 0.4 }, notes: () => chord(60, 4, [0, 8]) },
  },
  {
    id: 'house', name: 'House', emoji: '🪩', blurb: 'Four-on-the-floor + claps',
    tempo: 124, key: 9, scale: 'minor', kitId: 'house', patternId: 'houseclap',
    bassInst: { waveform: 'sawtooth', filterCutoff: 800, filterResonance: 5, attack: 0.005, decay: 0.14, sustain: 0.4, release: 0.14 },
    bass: () => bass(45, [2, 6, 10, 14], []),        // A offbeat
  },
  {
    id: 'edm', name: 'EDM', emoji: '⚡', blurb: 'Driving kick, big saw',
    tempo: 128, key: 5, scale: 'minor', kitId: 'techno', patternId: 'four',
    bassInst: { waveform: 'sawtooth', filterCutoff: 1000, filterResonance: 6, attack: 0.004, decay: 0.12, sustain: 0.35, release: 0.12 },
    bass: () => bass(41, [0, 2, 4, 6, 8, 10, 12, 14], []), // F 8ths
  },
]

export function templateLabel(t: MobileTemplate): string {
  return `${t.name} · ${NOTE_NAMES[t.key]} ${t.scale} · ${t.tempo} BPM`
}

export function buildTemplate(t: MobileTemplate): DawProject {
  const pattern = DRUM_PATTERNS.find(p => p.id === t.patternId) ?? DRUM_PATTERNS[0]
  let p = defaultProject()
  p = reducer(p, { type: 'SET_PROJECT_NAME', name: `${t.name} Song` })
  p = reducer(p, { type: 'SET_TEMPO', tempo: t.tempo })
  p = reducer(p, { type: 'SET_KEY_SCALE', key: t.key, scale: t.scale })

  p = reducer(p, { type: 'ADD_TRACK', name: 'Drums', instrument: drumInstrument(t.kitId) })
  const drumId = p.tracks[p.tracks.length - 1].id
  p = reducer(p, { type: 'ADD_CLIP', clip: makeMidiClip(drumId, 'Beat', 0, 4, { isDrumClip: true, notes: patternToNotes(pattern) }) })

  p = reducer(p, { type: 'ADD_TRACK', name: 'Bass', instrument: polyInstrument(t.bassInst) })
  const bassId = p.tracks[p.tracks.length - 1].id
  p = reducer(p, { type: 'ADD_CLIP', clip: makeMidiClip(bassId, 'Bassline', 0, 4, { notes: t.bass() }) })

  if (t.keys) {
    p = reducer(p, { type: 'ADD_TRACK', name: 'Keys', instrument: polyInstrument(t.keys.inst) })
    const keysId = p.tracks[p.tracks.length - 1].id
    p = reducer(p, { type: 'ADD_CLIP', clip: makeMidiClip(keysId, 'Chords', 0, 4, { notes: t.keys.notes() }) })
  }

  return p
}
