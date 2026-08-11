// Shared music-generation for the social formats: a constant hook authored in a genre KIT → real audio
// via the studio engine (scripts/hear-ai.mjs). Used by same-melody-shorts.mjs and scored-clip.mjs.
import { writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const uid = () => randomUUID()
const N = (pitch, startBeat, durationBeats, velocity = 100) => ({ id: uid(), pitch, startBeat, durationBeats, velocity })

export const MELODIES = {
  penta: { name: 'penta', melody: [[76, 0, 1], [74, 1, 1], [72, 2, 1], [69, 3, 1], [72, 4, 2], [69, 6, 2], [77, 8, 1], [76, 9, 1], [74, 10, 1], [72, 11, 1], [74, 12, 2], [69, 14, 2]], chords: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]] },
  epic:  { name: 'epic', melody: [[69, 0, 2], [71, 2, 1], [72, 3, 1], [76, 4, 2], [74, 6, 1], [72, 7, 1], [71, 8, 2], [69, 10, 1], [68, 11, 1], [69, 12, 4]], chords: [[57, 60, 64], [55, 59, 62], [53, 57, 60], [52, 56, 59]] },
  pop:   { name: 'pop', melody: [[72, 0, 1], [74, 1, 1], [76, 2, 2], [74, 4, 1], [72, 5, 1], [71, 6, 2], [69, 8, 1], [71, 9, 1], [72, 10, 2], [76, 12, 1], [74, 13, 1], [72, 14, 2]], chords: [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]] },
  dark:  { name: 'dark', melody: [[74, 0, 1], [77, 1, 1], [76, 2, 2], [74, 4, 1], [72, 5, 1], [69, 6, 2], [70, 8, 1], [72, 9, 1], [74, 10, 2], [69, 12, 4]], chords: [[50, 53, 57], [46, 50, 53], [53, 57, 60], [48, 52, 55]] },
}
const KICK = 36, SNARE = 38, HAT = 42, OPEN = 46, CLAP = 39
const DRUMS = {
  none: [], soft: [[KICK, 0, 90]],
  lofi: [[KICK, 0], [KICK, 2.5], [SNARE, 1], [SNARE, 3], [HAT, 0.5, 70], [HAT, 1.5, 70], [HAT, 2.5, 70], [HAT, 3.5, 70]],
  four: [[KICK, 0], [KICK, 1], [KICK, 2], [KICK, 3], [CLAP, 1], [CLAP, 3], [OPEN, 0.5, 70], [OPEN, 1.5, 70], [OPEN, 2.5, 70], [OPEN, 3.5, 70]],
}
const POLY = (o) => ({ waveform: 'sawtooth', attack: 0.01, decay: 0.3, sustain: 0.6, release: 0.4, detune: 8, filterType: 'lowpass', filterCutoff: 2200, filterResonance: 1, lfoEnabled: false, lfoRate: 3, lfoDepth: 0, lfoTarget: 'filter', lfoWaveform: 'sine', ...o })

export const KITS = {
  lofi:       { name: 'LO-FI', bpm: 78, accent: '0x6d5bd0', lead: 'builtin-2', pad: POLY({ waveform: 'triangle', filterCutoff: 1400, attack: 0.4, release: 1.2 }), bass: POLY({ waveform: 'sine', filterCutoff: 600, sustain: 0.85 }), drum: 'lofi' },
  orchestral: { name: 'ORCHESTRAL', bpm: 92, accent: '0xb8862b', lead: 'builtin-10', pad: POLY({ waveform: 'sawtooth', filterCutoff: 2600, attack: 0.6, release: 1.4, detune: 11 }), bass: POLY({ waveform: 'triangle', filterCutoff: 700 }), drum: 'soft' },
  edm:        { name: 'EDM', bpm: 124, accent: '0x1fa971', lead: 'builtin-8', pad: POLY({ waveform: 'sawtooth', filterCutoff: 4200, detune: 14, attack: 0.02 }), bass: POLY({ waveform: 'sawtooth', filterCutoff: 620, filterResonance: 5, detune: 9 }), drum: 'four' },
  trap:       { name: 'TRAP', bpm: 140, accent: '0xc0392b', lead: 'builtin-8', pad: POLY({ waveform: 'square', filterCutoff: 2400 }), bass: POLY({ waveform: 'sine', filterCutoff: 300, sustain: 0.9 }), drum: 'four' },
  synthwave:  { name: 'SYNTHWAVE', bpm: 100, accent: '0xd6398f', lead: 'builtin-8', pad: POLY({ waveform: 'sawtooth', filterCutoff: 3000, detune: 10, attack: 0.3 }), bass: POLY({ waveform: 'sawtooth', filterCutoff: 800, detune: 6 }), drum: 'lofi' },
  cinematic:  { name: 'CINEMATIC', bpm: 84, accent: '0x334155', lead: 'builtin-10', pad: POLY({ waveform: 'sawtooth', filterCutoff: 2200, attack: 1.0, release: 1.8, detune: 12 }), bass: POLY({ waveform: 'triangle', filterCutoff: 500 }), drum: 'soft' },
}

const track = (id, name, instrument) => ({ id, name, type: 'audio', color: '#a78bfa', volume: 0.8, pan: 0, mute: false, solo: false, armed: false, height: 64, effects: [], instrument })
const clip = (trackId, notes, presetId, isDrum, dur) => ({ kind: 'midi', id: uid(), trackId, name: 'c', startBeat: 0, durationBeats: dur, notes, isDrumClip: isDrum, presetId, rollFx: {} })

export function buildGenreCfproj(kit, bars, hook) {
  const tMel = uid(), tPad = uid(), tBass = uid(), tDrum = uid()
  const mel = [], pad = [], bass = [], drum = []
  for (let b = 0; b < bars; b++) {
    const off = b * 16
    for (const [p, s, d] of hook.melody) mel.push(N(p, off + s, d, 105))
    hook.chords.forEach((ch, bar) => {
      const bs = off + bar * 4
      for (const n of ch) pad.push(N(n, bs, 4, 60))
      bass.push(N(ch[0] - 12, bs, 2, 92), N(ch[0] - 12, bs + 2, 2, 84))
      for (const [pit, beat, vel = 100] of DRUMS[kit.drum]) drum.push(N(pit, bs + beat, 0.4, vel))
    })
  }
  const beats = bars * 16
  const tracks = [
    { ...track(tMel, 'Lead', { type: 'none', params: {} }), volume: 0.95, effects: [{ id: uid(), type: 'reverb', params: { enabled: true, wet: 0.18, decay: 1.6, preDelay: 0.01 } }] },
    { ...track(tPad, 'Pad', { type: 'poly', params: kit.pad }), volume: 0.3 },
    { ...track(tBass, 'Bass', { type: 'poly', params: kit.bass }), volume: 0.5 },
  ]
  const clips = [clip(tMel, mel, kit.lead, false, beats), clip(tPad, pad, null, false, beats), clip(tBass, bass, null, false, beats)]
  if (drum.length) { tracks.push({ ...track(tDrum, 'Drums', { type: 'drum', params: { pack: 'synth' } }), volume: 0.6 }); clips.push(clip(tDrum, drum, null, true, beats)) }
  const dawProject = { id: uid(), name: kit.name, tempo: kit.bpm, timeSignatureNum: 4, timeSignatureDen: 4, swing: kit.drum === 'lofi' ? 0.12 : 0, key: 'A', scale: 'minor', masterVolume: 1.15, tracks, arrangementClips: clips, sessionGrid: [], scenes: [], automationLanes: [], clipEffects: [], returnTracks: [], takeLanes: [], loopStart: 0, loopEnd: beats, loopEnabled: false }
  return { _type: '100lights-project', version: 1, id: uid(), name: kit.name, savedAt: new Date(0).toISOString(), tracks: [], clips: [], adjustments: {}, zoomLevel: 1, captions: [], outputs: [], media: [], modules: ['audio'], audioMode: true, dawProject }
}

/** Render `secs` of a genre score for `hook` → a wav at `outWav`. Retries once (headless renders flake). */
export function renderScore(kit, hook, secs, tmpDir, outBase) {
  const bars = Math.max(4, Math.round((secs / (16 * 60 / kit.bpm)) * 4))
  const cf = join(tmpDir, `${outBase}.cfproj`); writeFileSync(cf, JSON.stringify(buildGenreCfproj(kit, bars, hook)))
  const mp3 = join(tmpDir, `${outBase}.mp3`), wav = join(tmpDir, `${outBase}.wav`)
  for (let a = 1; a <= 2; a++) {
    try { execFileSync('node', ['scripts/hear-ai.mjs', `--project=${cf}`, `--seconds=${secs + 1}`, '--keep', `--out=${mp3}`], { cwd: ROOT, stdio: ['ignore', 'ignore', 'ignore'] }); return wav }
    catch { if (a === 2) throw new Error(`score render failed for ${kit.name}`) }
  }
}
