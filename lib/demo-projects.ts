// Editable studio recreations of the learn-article demo clips. lib/demo-audio.ts
// renders those clips with a standalone DSP that can't be opened or edited; this
// rebuilds the SAME musical content (patterns, chords, bass, arp) as real tracks
// with instruments + the effect each clip demonstrates, so they can be opened in
// the studio and properly edited (and re-exported over the source).
//
// The reconstruction is musically faithful, not sample-identical — the DAW's
// instruments differ from the demo DSP, which is the point: now it's editable.

import {
  defaultProject, defaultPolyInstrument, defaultDrumInstrument, DEFAULT_TRACK_HEIGHT,
  defaultEq3, defaultCompressor, defaultReverb, defaultFilter,
  type DawProject, type DawTrack, type MidiClip, type MidiNote, type TrackEffect,
  type TrackInstrument, type PolyInstrumentParams, type AutomationLane,
} from './daw-types'
import { makeMidiClip } from './daw-state'

const BPM = 120
// Musical content — mirrors lib/demo-audio.ts. Steps are 16ths (0.25 beat).
const CHORDS = [[57, 60, 64], [53, 57, 60], [52, 55, 60], [50, 55, 59]]
const BASSROOT = [33, 29, 36, 31]
const KICK = [0, 4, 8, 12], SNARE = [4, 12], HATS = [0, 2, 4, 6, 8, 10, 12, 14]

// ── builders ────────────────────────────────────────────────────────────────
let _n = 0
const uid = () => `d${(_n++).toString(36)}-${Math.floor(performance?.now?.() ?? 0)}-${_n}`
const note = (pitch: number, startBeat: number, durationBeats: number, velocity = 90): MidiNote =>
  ({ id: uid(), pitch, startBeat, durationBeats, velocity })

function poly(over: Partial<PolyInstrumentParams>): TrackInstrument {
  const base = defaultPolyInstrument().params as PolyInstrumentParams
  return { type: 'poly', params: { ...base, ...over } }
}
const BASS = () => poly({ waveform: 'sawtooth', filterCutoff: 600, sustain: 0.9, release: 0.2 })
const PAD = () => poly({ waveform: 'sawtooth', filterCutoff: 1600, detune: 8, attack: 0.05, sustain: 0.85, release: 0.6 })
const LEAD = () => poly({ waveform: 'square', filterCutoff: 4200, attack: 0.004, decay: 0.1, sustain: 0.25, release: 0.1 })
const MELODY = () => poly({ waveform: 'triangle', filterCutoff: 3200, sustain: 0.5 })

const fx = (type: string, params: Record<string, unknown>): TrackEffect =>
  ({ id: uid(), type, params } as unknown as TrackEffect)
const eqMid = (gain: number, freq = 350): TrackEffect => fx('eq3', { ...defaultEq3(), midFreq: freq, midGain: gain })
const highpass = (freq = 420): TrackEffect => fx('filter', { ...defaultFilter(), type: 'highpass', frequency: freq })
const reverb = (wet: number, decay: number): TrackEffect => fx('reverb', { ...defaultReverb(), wet, decay, preDelay: 0.02 })
const comp = (threshold: number, ratio: number, makeupGain: number): TrackEffect =>
  fx('compressor', { ...defaultCompressor(), threshold, ratio, attack: 0.004, release: 0.12, makeupGain })

function mkTrack(name: string, instrument: TrackInstrument, opts: { pan?: number; color?: string; effects?: TrackEffect[] } = {}): DawTrack {
  return {
    id: uid(), name, type: 'audio', color: opts.color ?? '#3d8fef',
    volume: 0.8, pan: opts.pan ?? 0, mute: false, solo: false, armed: false,
    inputSource: null, height: DEFAULT_TRACK_HEIGHT, effects: opts.effects ?? [], instrument,
  }
}
type Stem = { track: DawTrack; clip: MidiClip }
function stem(name: string, instrument: TrackInstrument, notes: MidiNote[], bars: number, isDrum: boolean, opts: { pan?: number; color?: string; effects?: TrackEffect[] } = {}): Stem {
  const track = mkTrack(name, instrument, opts)
  const clip = makeMidiClip(track.id, name, 0, bars * 4, { isDrumClip: isDrum })
  clip.notes = notes
  return { track, clip }
}

// ── content ─────────────────────────────────────────────────────────────────
function drumNotes(bars: number, o: { dropBar?: number; hatVel?: number } = {}): MidiNote[] {
  const out: MidiNote[] = []
  for (let bar = 0; bar < bars; bar++) {
    if (bar === o.dropBar) continue
    const b0 = bar * 4
    for (const k of KICK) out.push(note(36, b0 + k * 0.25, 0.25, 112))
    for (const s of SNARE) out.push(note(38, b0 + s * 0.25, 0.25, 100))
    for (const h of HATS) out.push(note(42, b0 + h * 0.25, 0.2, o.hatVel ?? 78))
  }
  return out
}
const bassNotes = (bars: number): MidiNote[] =>
  Array.from({ length: bars }, (_, bar) => note(BASSROOT[bar % 4] + 12, bar * 4, 3.9, 100))
const padNotes = (bars: number): MidiNote[] => {
  const out: MidiNote[] = []
  for (let bar = 0; bar < bars; bar++) for (const p of CHORDS[bar % 4]) out.push(note(p + 12, bar * 4, 3.9, 66))
  return out
}
const leadNotes = (bars: number): MidiNote[] => {
  const out: MidiNote[] = []
  for (let bar = 0; bar < bars; bar++) { const ch = CHORDS[bar % 4]; for (let s = 0; s < 16; s++) out.push(note(ch[s % ch.length] + 24, bar * 4 + s * 0.25, 0.2, 68)) }
  return out
}
const melodyNotes = (midi: number[]): MidiNote[] => midi.map((m, i) => note(m, i, 0.9, 92))
const pedalChordNotes = (): MidiNote[] => {
  const prog = [[57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 56, 59]]
  const out: MidiNote[] = []
  for (let bar = 0; bar < 4; bar++) for (const p of prog[bar]) out.push(note(p, bar * 4, 3.9, 62))
  return out
}
const pedalBassNotes = (drone: boolean): MidiNote[] => drone
  ? [note(45, 0, 16, 80)]
  : [45, 41, 43, 40].map((r, bar) => note(r, bar * 4, 3.9, 80))
const snareLayerDrums = (layered: boolean): MidiNote[] => {
  const out: MidiNote[] = []
  for (let bar = 0; bar < 2; bar++) {
    const b0 = bar * 4
    for (const k of KICK) out.push(note(36, b0 + k * 0.25, 0.25, 110))
    for (const s of SNARE) { out.push(note(38, b0 + s * 0.25, 0.25, 105)); if (layered) out.push(note(39, b0 + s * 0.25 + 0.03, 0.2, 95)) }
  }
  return out
}

// An automation lane over a track parameter. pts are [beat, value(0..1)].
function autoLane(trackId: string, parameter: string, label: string, min: number, max: number, defaultValue: number, pts: [number, number][]): AutomationLane {
  return { id: uid(), trackId, parameter, label, min, max, defaultValue, expanded: true, points: pts.map(([beat, value]) => ({ id: uid(), beat, value })) }
}

function project(name: string, stems: Stem[], bars: number): DawProject {
  const base = defaultProject()
  return {
    ...base, id: uid(), name: `Article — ${name}`, tempo: BPM,
    tracks: stems.map(s => s.track), arrangementClips: stems.map(s => s.clip),
    loopEnabled: true, loopStart: 0, loopEnd: bars * 4,
  }
}

// The full mix — the shared body behind most A/B clips. Each flag matches a
// lib/demo-audio.ts MixOpts flag, applied here as an editable track/effect.
function mixStems(bars: number, o: { lead?: boolean; highpass?: boolean; eq?: number; reverb?: [number, number]; hatVel?: number; pan?: boolean; dropBar?: number; duck?: boolean } = {}): Stem[] {
  const s: Stem[] = []
  s.push(stem('Drums', defaultDrumInstrument(), drumNotes(bars, { hatVel: o.hatVel, dropBar: o.dropBar }), bars, true, { color: '#f472b6' }))
  s.push(stem('Bass', BASS(), bassNotes(bars), bars, false, { color: '#38bdf8', effects: o.duck ? [comp(-30, 6, 4)] : [] }))
  const padFx: TrackEffect[] = []
  if (o.highpass) padFx.push(highpass(420))
  if (o.eq !== undefined) padFx.push(eqMid(o.eq))
  if (o.reverb) padFx.push(reverb(o.reverb[0], o.reverb[1]))
  s.push(stem('Pad', PAD(), padNotes(bars), bars, false, { color: '#a78bfa', pan: o.pan ? -0.85 : 0, effects: padFx }))
  if (o.lead) s.push(stem('Lead', LEAD(), leadNotes(bars), bars, false, { color: '#fbbf24', pan: o.pan ? 0.85 : 0, effects: o.highpass ? [highpass(480)] : [] }))
  return s
}

// ── the map ─────────────────────────────────────────────────────────────────
export function buildDemoProject(id: string): DawProject | null {
  const B = 4
  switch (id) {
    case 'hear-comp-off': return project('Drum loop (no compression)', [stem('Drums', defaultDrumInstrument(), drumNotes(B), B, true, { color: '#f472b6' })], B)
    case 'hear-comp-on': return project('Drum loop (compressed)', [stem('Drums', defaultDrumInstrument(), drumNotes(B), B, true, { color: '#f472b6', effects: [comp(-28, 5, 6)] })], B)
    case 'hear-eq-cut': return project('EQ — low-mid cut', mixStems(B, { eq: -14 }), B)
    case 'hear-eq-boost': return project('EQ — low-mid boost', mixStems(B, { eq: 9 }), B)
    case 'hear-verb-08': return project('Short reverb', mixStems(B, { reverb: [0.3, 1] }), B)
    case 'hear-verb-14': return project('Long reverb', mixStems(B, { reverb: [0.3, 3.6] }), B)
    case 'hear-hats-0': return project('Hats at level', mixStems(B, {}), B)
    case 'hear-hats-plus1': return project('Hats +loud', mixStems(B, { hatVel: 115 }), B)
    case 'duck-off': return project('No sidechain', mixStems(B, {}), B)
    case 'duck-on': return project('Sidechain duck', mixStems(B, { duck: true }), B)
    case 'mix-mud': return project('Muddy mix', mixStems(B, { lead: true }), B)
    case 'mix-hp': return project('High-passed mix', mixStems(B, { lead: true, highpass: true }), B)
    case 'gear-competing': return project('Competing mix', mixStems(B, { lead: true }), B)
    case 'gear-rebalanced': return project('Rebalanced mix', mixStems(B, { lead: true, highpass: true }), B)
    case 'mix-pan-center': return project('Centred mix', mixStems(B, { lead: true }), B)
    case 'mix-pan-wide': return project('Panned wide', mixStems(B, { lead: true, pan: true }), B)
    case 'eight-static': return project('Static 16 bars', mixStems(16, { lead: true }), 16)
    case 'eight-developed': return project('Developed 16 bars', mixStems(16, { lead: true, dropBar: 6 }), 16)
    case 'daw-loop': return project('DAW loop', mixStems(8, {}), 8)
    case 'loop-clean': case 'loop-click': return project('Beat + bass loop', [
      stem('Drums', defaultDrumInstrument(), drumNotes(B), B, true, { color: '#f472b6' }),
      stem('Bass', BASS(), bassNotes(B), B, false, { color: '#38bdf8' }),
    ], B)
    case 'pedal-roots': return project('Roots under the chords', [
      stem('Chords', PAD(), pedalChordNotes(), B, false, { color: '#a78bfa' }),
      stem('Bass', BASS(), pedalBassNotes(false), B, false, { color: '#38bdf8' }),
    ], B)
    case 'pedal-drone': return project('Pedal drone', [
      stem('Chords', PAD(), pedalChordNotes(), B, false, { color: '#a78bfa' }),
      stem('Drone', BASS(), pedalBassNotes(true), B, false, { color: '#38bdf8' }),
    ], B)
    case 'hook-identical': return project('Hook — repeated', [stem('Melody', MELODY(), melodyNotes([60, 61, 63, 64, 60, 61, 63, 64]), 2, false, { color: '#fbbf24' })], 2)
    case 'hook-moved': return project('Hook — moved up', [stem('Melody', MELODY(), melodyNotes([60, 61, 63, 64, 62, 63, 65, 66]), 2, false, { color: '#fbbf24' })], 2)
    case 'snare-clean': return project('Snare (clean)', [stem('Drums', defaultDrumInstrument(), snareLayerDrums(false), 2, true, { color: '#f472b6' })], 2)
    case 'snare-layered': return project('Snare (layered clap)', [stem('Drums', defaultDrumInstrument(), snareLayerDrums(true), 2, true, { color: '#f472b6' })], 2)
    // Static-MP3 sounds with a known recipe.
    case 'reese-before': return project('Reese — one saw', [stem('Bass', poly({ waveform: 'sawtooth', filterCutoff: 620, filterResonance: 6, sustain: 1, release: 0.1 }), [note(28, 0, 8, 100), note(28, 8, 8, 100)], 4, false, { color: '#38bdf8' })], 4)
    case 'reese-after': return project('Reese — detuned', [stem('Bass', poly({ waveform: 'sawtooth', detune: 9, filterCutoff: 620, filterResonance: 6, sustain: 1, release: 0.1 }), [note(28, 0, 8, 100), note(28, 8, 8, 100)], 4, false, { color: '#38bdf8' })], 4)
    // Automation demos — the loop plus editable automation lanes under the tracks.
    case 'automation-before': return project('Loop — no automation', mixStems(8, { lead: true }), 8)
    case 'automation-after': {
      const filterFx = fx('filter', { ...defaultFilter(), type: 'lowpass', frequency: 500, q: 2 })
      const stems = mixStems(8, { lead: true })
      const pad = stems.find(s => s.track.name === 'Pad')!.track; pad.effects = [...pad.effects, filterFx]
      const lead = stems.find(s => s.track.name === 'Lead')!.track
      const p = project('Loop + automation', stems, 8)
      p.automationLanes = [
        autoLane(pad.id, `fx:${filterFx.id}:frequency`, 'Pad cutoff', 200, 8000, 500, [[0, 0.08], [16, 0.15], [28, 0.7], [32, 1]]),
        autoLane(lead.id, 'volume', 'Lead volume', 0, 1, 0.8, [[0, 0], [16, 0], [17, 0.8], [32, 0.8]]),   // lead enters halfway
      ]
      return p
    }
    case 'automation-filter-sweep': {
      const filterFx = fx('filter', { ...defaultFilter(), type: 'lowpass', frequency: 400, q: 4 })
      const stems: Stem[] = [
        stem('Drums', defaultDrumInstrument(), drumNotes(8), 8, true, { color: '#f472b6' }),
        stem('Bass', BASS(), bassNotes(8), 8, false, { color: '#38bdf8' }),
        stem('Pad', PAD(), padNotes(8), 8, false, { color: '#a78bfa', effects: [filterFx] }),
      ]
      const p = project('Filter sweep', stems, 8)
      p.automationLanes = [autoLane(stems[2].track.id, `fx:${filterFx.id}:frequency`, 'Filter cutoff', 200, 9000, 400, [[0, 0.03], [16, 0.12], [30, 0.9], [32, 1]])]
      return p
    }
    default: return null
  }
}

/** True when this src has an editable reconstruction (vs. only the flat audio). */
export function demoIdFor(src: string): string | null {
  const m = src.match(/\/api\/demo-audio\/([a-z0-9-]+)/) || src.match(/\/learn-audio\/([a-z0-9-]+)\.[a-z0-9]+/)
  const id = m?.[1] ?? null
  return id && buildDemoProject(id) ? id : null
}
