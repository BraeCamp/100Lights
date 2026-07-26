// Converts a learn-article demo clip (lib/demo-audio.ts, code-synthesised flat
// mixes) into a real multi-track DawProject — one track per part (drums / bass /
// pad / lead) — so it opens in the studio as separated, editable tracks instead
// of one bounced waveform. Mirrors the musical content of renderMix() and the
// specialised renderers; the mix-bus PROCESSING (comp / EQ / reverb / duck /
// pan) is intentionally NOT baked in — that's exactly what each article teaches
// and what the editor is for.
//
// Server-safe: builds the DawProject object directly (the reducer in
// lib/daw-state is 'use client' + pulls in the Web-Audio engine, so we can't
// import it here). Track/clip shapes match what ADD_TRACK / makeMidiClip produce
// (lib/daw-state.ts), and the editor's migrateProject() backfills anything else
// on load.

import {
  defaultProject, defaultPolyInstrument, TRACK_COLORS, DEFAULT_TRACK_HEIGHT,
  type DawProject, type DawTrack, type MidiNote, type MidiClip, type TrackInstrument,
} from './daw-types'
import { DRUM_KITS, DRUM_LANES } from './drum-presets'
import { DEFAULT_ADJUSTMENTS } from './editor-types'

const uid = () => crypto.randomUUID()

// ── musical content (mirrors lib/demo-audio.ts) ─────────────────────────────
const STEP = 0.25                       // a 16th note, in beats
const OCT = 12                          // demo-audio synthesises pad/bass an octave up
const CHORDS = [[57, 60, 64], [53, 57, 60], [52, 55, 60], [50, 55, 59]]
const BASSROOT = [33, 29, 36, 31]
const KICK = [0, 4, 8, 12], SNARE = [4, 12], HATS = [0, 2, 4, 6, 8, 10, 12, 14]
const lanePitch = (key: string) => DRUM_LANES.find(l => l.key === key)?.pitch ?? 36

const note = (pitch: number, startBeat: number, durationBeats: number, velocity = 105): MidiNote =>
  ({ id: uid(), pitch, startBeat, durationBeats, velocity })

// ── instruments ─────────────────────────────────────────────────────────────
function drumInstrument(kitId: string): TrackInstrument {
  const kit = DRUM_KITS.find(k => k.id === kitId) ?? DRUM_KITS[0]
  return structuredClone(kit.instrument)
}
function polyInstrument(over: Record<string, unknown> = {}): TrackInstrument {
  const base = defaultPolyInstrument()
  return { type: 'poly', params: { ...(base.params as Record<string, unknown>), ...over } } as unknown as TrackInstrument
}
// Filters chosen to echo demo-audio's band-limiting: bass lp~600, pad lp~1600.
const BASS_INST = () => polyInstrument({ waveform: 'sawtooth', filterCutoff: 600, filterResonance: 2, attack: 0.005, decay: 0.16, sustain: 0.7, release: 0.18 })
const PAD_INST = () => polyInstrument({ waveform: 'sawtooth', filterCutoff: 1600, filterResonance: 1, attack: 0.25, decay: 0.2, sustain: 0.85, release: 0.5 })
const LEAD_INST = () => polyInstrument({ waveform: 'square', filterCutoff: 2200, filterResonance: 1.5, attack: 0.005, decay: 0.08, sustain: 0.4, release: 0.12 })

// ── project assembly (direct object build, matching ADD_TRACK / makeMidiClip) ─
function newProject(name: string, bars: number): DawProject {
  const p = defaultProject()
  p.name = name
  p.tempo = 120
  p.timeSignatureNum = 4
  p.loopEnd = bars * 4
  p.loopEnabled = true
  return p
}

function addTrack(p: DawProject, name: string, instrument: TrackInstrument): string {
  const track: DawTrack = {
    id: uid(), name, type: 'audio',
    color: TRACK_COLORS[p.tracks.length % TRACK_COLORS.length],
    volume: 0.8, pan: 0, mute: false, solo: false, armed: false,
    inputSource: null, height: DEFAULT_TRACK_HEIGHT, effects: [], instrument,
  }
  p.tracks.push(track)
  p.sessionGrid[track.id] = Array(p.scenes.length).fill(null)
  return track.id
}

function addClip(p: DawProject, trackId: string, name: string, bars: number, notes: MidiNote[], isDrumClip = false) {
  const clip: MidiClip = {
    kind: 'midi', id: uid(), trackId, name,
    startBeat: 0, durationBeats: bars * 4, notes, isDrumClip,
  }
  p.arrangementClips.push(clip)
}

// ── note generators ─────────────────────────────────────────────────────────
function drumNotes(bars: number, dropBar = -1): MidiNote[] {
  const n: MidiNote[] = []
  for (let b = 0; b < bars; b++) {
    if (b === dropBar) continue   // the "developed" arrangement drops a bar
    const base = b * 4
    for (const s of KICK) n.push(note(lanePitch('kick'), base + s * STEP, STEP, 115))
    for (const s of SNARE) n.push(note(lanePitch('snare'), base + s * STEP, STEP, 110))
    for (const s of HATS) n.push(note(lanePitch('closedHat'), base + s * STEP, STEP, 80))
  }
  return n
}
function bassNotes(bars: number): MidiNote[] {
  const n: MidiNote[] = []
  for (let b = 0; b < bars; b++) n.push(note(BASSROOT[b % 4] + OCT, b * 4, 4, 108))
  return n
}
function padNotes(bars: number): MidiNote[] {
  const n: MidiNote[] = []
  for (let b = 0; b < bars; b++) for (const p of CHORDS[b % 4]) n.push(note(p + OCT, b * 4, 4, 90))
  return n
}
// A 16th-note arpeggio over each bar's chord — mirrors renderMix's lead.
function leadNotes(bars: number): MidiNote[] {
  const n: MidiNote[] = []
  for (let b = 0; b < bars; b++) {
    const ch = CHORDS[b % 4]
    for (let s = 0; s < 16; s++) n.push(note(ch[s % ch.length] + 24, b * 4 + s * STEP, STEP * 0.5, 88))
  }
  return n
}

interface MixParts { drums?: boolean; bass?: boolean; pad?: boolean; lead?: boolean; dropBar?: number }

// The generic full-mix arrangement (drums + bass + pad + lead per opts), the
// shape most demo clips are built from.
function mixProject(name: string, bars: number, parts: MixParts): DawProject {
  const { drums = true, bass = true, pad = false, lead = false, dropBar = -1 } = parts
  const p = newProject(name, bars)
  if (drums) addClip(p, addTrack(p, 'Drums', drumInstrument('studio')), 'Drums', bars, drumNotes(bars, dropBar), true)
  if (bass) addClip(p, addTrack(p, 'Bass', BASS_INST()), 'Bass', bars, bassNotes(bars))
  if (pad) addClip(p, addTrack(p, 'Pad', PAD_INST()), 'Pad', bars, padNotes(bars))
  if (lead) addClip(p, addTrack(p, 'Lead', LEAD_INST()), 'Lead', bars, leadNotes(bars))
  return p
}

// ── specialised arrangements (the non-mix renderers in demo-audio.ts) ─────────
const TRI_INST = () => polyInstrument({ waveform: 'triangle', filterCutoff: 1800, filterResonance: 0.8, attack: 0.02, decay: 0.2, sustain: 0.8, release: 0.3 })

// renderPedal: a triangle chord prog over either changing roots or a fixed drone.
const PEDAL_CHORDS = [[57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 56, 59]]
const PEDAL_ROOTS = [45, 41, 43, 40]
function pedalProject(name: string, withDrone: boolean): DawProject {
  const p = newProject(name, 4)
  const chords: MidiNote[] = []
  for (let b = 0; b < 4; b++) for (const pitch of PEDAL_CHORDS[b]) chords.push(note(pitch, b * 4, 4, 90))
  addClip(p, addTrack(p, 'Chords', TRI_INST()), 'Chords', 4, chords)
  const bass: MidiNote[] = []
  for (let b = 0; b < 4; b++) bass.push(note(withDrone ? 45 : PEDAL_ROOTS[b], b * 4, 4, 108))
  addClip(p, addTrack(p, withDrone ? 'Drone' : 'Bass', BASS_INST()), withDrone ? 'Drone' : 'Bass', 4, bass)
  return p
}

// renderMelody: a single line, one note per beat.
function melodyProject(name: string, midi: (number | null)[]): DawProject {
  const bars = Math.ceil(midi.length / 4)
  const p = newProject(name, bars)
  const notes: MidiNote[] = []
  midi.forEach((m, beat) => { if (m != null) notes.push(note(m, beat, 0.9, 100)) })
  addClip(p, addTrack(p, 'Melody', TRI_INST()), 'Melody', bars, notes)
  return p
}

// renderSnareLayer: 2 bars of kick+snare, plus a layered clap on the backbeat.
function snareProject(name: string, layered: boolean): DawProject {
  const p = newProject(name, 2)
  const n: MidiNote[] = []
  for (let b = 0; b < 2; b++) {
    const base = b * 4
    for (const s of KICK) n.push(note(lanePitch('kick'), base + s * STEP, STEP, 115))
    for (const s of SNARE) n.push(note(lanePitch('snare'), base + s * STEP, STEP, 112))
    if (layered) for (const s of SNARE) n.push(note(lanePitch('clap'), base + s * STEP, STEP, 95))
  }
  addClip(p, addTrack(p, 'Drums', drumInstrument('studio')), 'Drums', 2, n, true)
  return p
}

// renderLoopClick: a one-bar drum+bass loop repeated ×4 (the click is a seam
// artifact, not musical, so both clean/click map to the same clean loop).
function loopProject(name: string): DawProject {
  const p = newProject(name, 4)
  const drums: MidiNote[] = []
  const bass: MidiNote[] = []
  for (let b = 0; b < 4; b++) {
    const base = b * 4
    for (const s of KICK) drums.push(note(lanePitch('kick'), base + s * STEP, STEP, 115))
    for (const s of SNARE) drums.push(note(lanePitch('snare'), base + s * STEP, STEP, 110))
    for (const s of HATS) drums.push(note(lanePitch('closedHat'), base + s * STEP, STEP, 78))
    bass.push(note(45, base, 4, 108))   // A2 sawtooth, one per bar
  }
  addClip(p, addTrack(p, 'Drums', drumInstrument('studio')), 'Drums', 4, drums, true)
  addClip(p, addTrack(p, 'Bass', BASS_INST()), 'Bass', 4, bass)
  return p
}

// ── clip → project ──────────────────────────────────────────────────────────
// Every demo clip mapped to its faithful arrangement (mirrors renderClip in
// lib/demo-audio.ts). A/B pairs whose only difference is a mix-bus effect
// (compression, EQ, reverb, duck, pan, high-pass) produce the SAME dry
// arrangement on purpose — the effect is what you add in the editor, and it's
// what the article teaches. Pairs with a STRUCTURAL difference (melody, dropped
// bar, drone-vs-roots, clap layer) differ in their notes.
export function buildClipProject(clipId: string): DawProject {
  const name = `Article audio — ${clipId}`
  switch (clipId) {
    // drums-only compression demo
    case 'hear-comp-off': case 'hear-comp-on': return mixProject(name, 4, { bass: false })
    // pad-mix effect demos (EQ / reverb / hats) — same dry base for the pair
    case 'hear-eq-cut': case 'hear-eq-boost':
    case 'hear-verb-08': case 'hear-verb-14':
    case 'hear-hats-0': case 'hear-hats-plus1': return mixProject(name, 4, { pad: true })
    // sidechain duck demo — drums + bass
    case 'duck-off': case 'duck-on': return mixProject(name, 4, {})
    // full-mix demos (mud/high-pass, pan, gear balance) — drums+bass+pad+lead
    case 'mix-mud': case 'mix-hp':
    case 'mix-pan-center': case 'mix-pan-wide':
    case 'gear-competing': case 'gear-rebalanced': return mixProject(name, 4, { pad: true, lead: true })
    // eight-bar development — "developed" drops bar 8's drums
    case 'eight-static': return mixProject(name, 16, { pad: true, lead: true })
    case 'eight-developed': return mixProject(name, 16, { pad: true, lead: true, dropBar: 7 })
    // seamless-loop demo — same clean loop for both
    case 'loop-clean': case 'loop-click': return loopProject(name)
    // pedal-tone demo — changing roots vs a fixed drone
    case 'pedal-roots': return pedalProject(name, false)
    case 'pedal-drone': return pedalProject(name, true)
    // melodic hook — two different melodies
    case 'hook-identical': return melodyProject(name, [60, 61, 63, 64, 60, 61, 63, 64])
    case 'hook-moved': return melodyProject(name, [60, 61, 63, 64, 62, 63, 65, 66])
    // snare layering — clap added on the backbeat
    case 'snare-clean': return snareProject(name, false)
    case 'snare-layered': return snareProject(name, true)
    // the full studio loop
    case 'daw-loop': return mixProject(name, 8, { pad: true })
    default: return mixProject(name, 4, { pad: true })
  }
}

// The CfProjFile wrapper POST /api/projects requires (built inline to stay off
// the client-only project-serializer). Opens at /projects/<id>.
export function buildClipProjectFile(clipId: string) {
  const dawProject = buildClipProject(clipId)
  return {
    _type: '100lights-project' as const,
    version: 1 as const,
    id: uid(),
    name: dawProject.name,
    savedAt: new Date().toISOString(),
    tracks: [], clips: [], adjustments: DEFAULT_ADJUSTMENTS, zoomLevel: 1,
    captions: [], outputs: [], media: [], audioMedia: [],
    moduleSavedAt: {}, modules: ['audio' as const], audioMode: 'music' as const,
    dawProject,
  }
}
