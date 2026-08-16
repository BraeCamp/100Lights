// Author a FILTER-FORWARD deep-house track as an editable .cfproj — the whole arc is a
// low-pass filter opening across the build into the drop and closing in the breakdown
// (track-level FX bars = the "fx button under the track", the most visible, song-shaping
// use of filters). Showcases the new sampled presets on pad/keys/pluck/bass. Render with:
//   node scripts/hear-ai.mjs --project="<this .cfproj>"
import { writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { randomUUID as uid } from 'node:crypto'

const NOW = '2026-08-15T00:00:00.000Z'
const N = (pitch, startBeat, durationBeats, velocity = 90) => ({ id: uid(), pitch, startBeat, durationBeats, velocity })

// ── Embedded presets (self-contained; reuse existing sampled folders + light shaping;
//    the FILTER is done by clipEffects, not here, so it stays visible on the track) ──
const PRESETS = [
  { id: 'v-pad',   name: 'House Pad',    folder: 'Warm Pad – All Notes',       loNote: 36, hiNote: 96, category: 'synth-pad',    group: 'Synth', builtIn: false, createdAt: NOW, sound: { fx: { reverbWet: 0.32, chorusDepth: 0.22, width: 1.3 } } },
  { id: 'v-keys',  name: 'Dream Rhodes', folder: 'Rhodes – All Notes',         loNote: 36, hiNote: 84, category: 'piano-rhodes', group: 'Piano', builtIn: false, createdAt: NOW, sound: { fx: { chorusDepth: 0.4, reverbWet: 0.28, delayWet: 0.16, delayFeedback: 0.35 } } },
  { id: 'v-pluck', name: 'Echo Pluck',   folder: 'Metallic Pluck – All Notes', loNote: 36, hiNote: 96, category: 'synth-pluck', group: 'Synth', builtIn: false, createdAt: NOW, sound: { fx: { delayWet: 0.34, delayFeedback: 0.42, delayPingpong: 0.4, reverbWet: 0.22 } } },
  { id: 'v-bass',  name: 'Sub Bass',     folder: 'Synth Bass – All Notes',     loNote: 24, hiNote: 60, category: 'synth-bass',   group: 'Bass',  builtIn: false, createdAt: NOW, sound: { fx: { sub: 5, bass: 3, filterHz: 2600 } } },
]

// ── Harmony: Am – F – C – G (deep-house i–VI–III–VII), 1 chord/bar, 32 bars ──
const CHORDS = [
  { tri: [57, 60, 64], root: 45 }, // Am
  { tri: [53, 57, 60], root: 41 }, // F
  { tri: [55, 60, 64], root: 48 }, // C
  { tri: [55, 59, 62], root: 43 }, // G
]
const BARS = 32, BPB = 4
const section = bar => bar < 8 ? 'intro' : bar < 16 ? 'build' : bar < 24 ? 'drop' : bar < 28 ? 'break' : 'drop2'
const KICK = 36, SNARE = 38, HAT = 42, CLAP = 39, OHAT = 46
const PLUCK_RIFF = [0, 3, 4, 7, 4, 3, 5, 4] // scale-degree offsets into the bar's triad+octave, 8th notes

const pad = [], bass = [], keys = [], pluck = [], drums = []
for (let bar = 0; bar < BARS; bar++) {
  const b0 = bar * BPB, ch = CHORDS[bar % 4], sec = section(bar)
  // PAD — held triad, every bar (the constant bed the filter reveals). Softer early.
  const padVel = sec === 'intro' ? 52 : sec === 'break' ? 58 : 66
  for (const p of ch.tri) pad.push(N(p, b0, BPB, padVel))
  // BASS — off-beat house 8ths on the root (energy sections only)
  if (sec === 'build' || sec === 'drop' || sec === 'drop2') {
    for (const off of [0.5, 1.5, 2.5, 3.5]) bass.push(N(ch.root, b0 + off, 0.42, 92))
    bass.push(N(ch.root - 12, b0, 1.0, 74)) // sub weight on the downbeat
  }
  // KEYS — Rhodes stabs on the & of 2 and & of 4, in the drops
  if (sec === 'drop' || sec === 'drop2') {
    for (const off of [1.5, 3.5]) for (const p of ch.tri) keys.push(N(p + 12, b0 + off, 0.4, 74))
  }
  // PLUCK — pentatonic riff: sparse in build, full in drops
  if (sec === 'build' || sec === 'drop' || sec === 'drop2') {
    const tones = [ch.tri[0], ch.tri[1], ch.tri[2], ch.tri[0] + 12]
    const play = sec === 'build' ? [0, 4] : [0, 1, 2, 3, 4, 5, 6, 7]
    for (const i of play) pluck.push(N(tones[PLUCK_RIFF[i] % 4] + 12, b0 + i * 0.5, 0.45, sec === 'build' ? 66 : 84))
  }
  // DRUMS — none in intro/breakdown (let the filtered pad breathe); build = kick+hats; drops = full
  if (sec === 'build') {
    for (let b = 0; b < 4; b++) { drums.push(N(KICK, b0 + b, 0.5, 104)); drums.push(N(HAT, b0 + b + 0.5, 0.3, 62)) }
  } else if (sec === 'drop' || sec === 'drop2') {
    for (let b = 0; b < 4; b++) { drums.push(N(KICK, b0 + b, 0.5, 112)); drums.push(N(HAT, b0 + b + 0.5, 0.32, 70)) }
    drums.push(N(CLAP, b0 + 1, 0.5, 92), N(CLAP, b0 + 3, 0.5, 92))
    drums.push(N(OHAT, b0 + 3.5, 0.4, 66))
  }
}

const SONGBEATS = BARS * BPB
const COLORS = { drum: '#ef4444', bass: '#a78bfa', pad: '#14b8a6', keys: '#3b82f6', pluck: '#f59e0b' }
const track = (id, name, instrument, color, volume, pan = 0) => ({ id, name, type: 'audio', color, volume, pan, mute: false, solo: false, armed: false, height: 64, effects: [], instrument })
const clip = (trackId, name, notes, presetId, isDrum = false, rollFx = {}) => ({ kind: 'midi', id: uid(), trackId, name, startBeat: 0, durationBeats: SONGBEATS, notes, isDrumClip: isDrum, ...(presetId ? { presetId } : {}), rollFx })

const tDrum = uid(), tBass = uid(), tPad = uid(), tKeys = uid(), tPluck = uid()
const tracks = [
  track(tDrum,  'Drums',       { type: 'drum', params: { pack: 'synth' } }, COLORS.drum, 0.55),
  track(tBass,  'Sub Bass',    { type: 'poly', params: {} },                COLORS.bass, 0.5),
  track(tPad,   'House Pad',   { type: 'poly', params: {} },                COLORS.pad,  0.34),
  track(tKeys,  'Dream Rhodes',{ type: 'poly', params: {} },                COLORS.keys, 0.4),
  track(tPluck, 'Echo Pluck',  { type: 'poly', params: {} },                COLORS.pluck, 0.42, 0.15),
]
const clips = [
  clip(tDrum,  'Drums',  drums, null, true),
  clip(tBass,  'Bass',   bass,  'v-bass'),
  clip(tPad,   'Chords', pad,   'v-pad'),
  clip(tKeys,  'Stabs',  keys,  'v-keys'),
  clip(tPluck, 'Riff',   pluck, 'v-pluck'),
]

// ── THE FILTER: track-level FX bars sweeping the low-pass across the whole arc ──
// v = amount of filtering (0 = wide open 18k, 1 = clamped to fx.filterHz). The shape:
// dark intro → opens through the build → wide-open drop → slams shut for the breakdown → opens again.
const AP = (t, v) => ({ id: uid(), t, v, smooth: true, h1: [-1, 0], h2: [1, 0] })
const SWEEP = [ AP(0, 0.92), AP(32, 0.8), AP(64, 0.05), AP(96, 0.05), AP(100, 0.9), AP(112, 0.55), AP(116, 0.05), AP(128, 0.05) ]
const fxBar = (trackId, filterHz, filterQ, graph) => ({ id: uid(), trackId, startBeat: 0, durationBeats: SONGBEATS, row: 0, fx: { filterHz, filterQ }, graph })
const clipEffects = [
  fxBar(tPad,   360, 4.0, SWEEP.map(p => ({ ...p, id: uid() }))),   // pad: the star sweep, resonant
  fxBar(tPluck, 420, 3.2, SWEEP.map(p => ({ ...p, id: uid() }))),   // pluck follows the sweep
  fxBar(tKeys,  520, 2.4, SWEEP.map(p => ({ ...p, id: uid() }))),   // rhodes stabs open with it
  fxBar(tBass,  900, 1.3, SWEEP.map(p => ({ ...p, id: uid() }))),   // bass: gentler low-pass movement
]

const dp = {
  id: uid(), name: 'Filtered House',
  tempo: 122, timeSignatureNum: 4, timeSignatureDen: 4,
  tracks, arrangementClips: clips, presets: PRESETS,
  scenes: Array.from({ length: 4 }, (_, i) => ({ id: uid(), name: `Scene ${i + 1}` })),
  sessionGrid: {}, loopStart: 0, loopEnd: SONGBEATS, loopEnabled: false,
  masterVolume: 0.85, automationLanes: [], clipEffects, returnTracks: [], takeLanes: [],
  crossfaderValue: 0.5, waveformZoom: 1, swing: 0, cueMarkers: [], sections: [],
  key: 9, scale: 'minor',
}
const cfproj = { _type: '100lights-project', version: 1, id: dp.id, name: dp.name, savedAt: NOW,
  tracks: [], clips: [], adjustments: {}, zoomLevel: 1, captions: [], outputs: [], media: [],
  modules: ['audio'], audioMode: 'music', presets: PRESETS, dawProject: dp }

const out = `${homedir()}/Desktop/100lights-ai-renders/Filtered House.cfproj`
writeFileSync(out, JSON.stringify(cfproj, null, 1))
const nNotes = clips.reduce((a, c) => a + c.notes.length, 0)
console.log(`Filtered House · ${tracks.length} trk · ${nNotes} notes · ${clipEffects.length} filter-sweep FX bars · 32 bars @122bpm`)
console.log(`→ ${out}`)
