#!/usr/bin/env node
// Author a backing that is genuinely BUILT AROUND a public-domain sheet melody: piano plays the melody,
// and pad + bass (+ optional drums) play the SHEET'S OWN chord progression, in the sheet's key, locked
// to the melody's bar grid. No autonomous song-generator pasted underneath — every backing note comes
// from the tune's real harmony, so notes/chords agree and everything lands on the beat.
//
//   node scripts/sheet-accompany.mjs --song=ode          (or greensleeves, or --all)
// Outputs "<Song> (accompaniment).cfproj" + ".mp3" to ~/Desktop/100lights-ai-renders/.

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir, homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { MELODIES, RANDOM_KEYS } from './pd-melodies.mjs'
import { ORIGINALS } from './claude-originals.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(homedir(), 'Desktop', '100lights-ai-renders')
const uid = () => randomUUID()
const argv = process.argv.slice(2)
const flag = (n, d) => { const a = argv.find(x => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : d }
const has = n => argv.includes(`--${n}`)
const safe = s => s.replace(/[^\w.\- ]+/g, '').replace(/\s+/g, ' ').trim()

// ── preset ids (index-based builtin-N; see lib/midi-presets.ts) ──────────────
const PIANO = 'builtin-0', STRINGS = 'builtin-9', PAD = 'builtin-12', ABASS = 'builtin-19'

// ── chord → triad pitches ────────────────────────────────────────────────────
const PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 }
function triad(name, octave) {
  const m = name.match(/^([A-G][b#]?)(m|dim|aug)?/)
  const pc = PC[m[1]]; const minor = m[2] === 'm'
  const root = 12 * (octave + 1) + pc
  return { root, notes: [root, root + (minor ? 3 : 4), root + 7] }
}

// ── melodies (transcribed from PD sheet music), [pitch, startBeat, durBeats] ──
const ODE = [
  [64,0,1],[64,1,1],[65,2,1],[67,3,1], [67,4,1],[65,5,1],[64,6,1],[62,7,1],
  [60,8,1],[60,9,1],[62,10,1],[64,11,1], [64,12,1.5],[62,13.5,0.5],[62,14,2],
  [64,16,1],[64,17,1],[65,18,1],[67,19,1], [67,20,1],[65,21,1],[64,22,1],[62,23,1],
  [60,24,1],[60,25,1],[62,26,1],[64,27,1], [62,28,1.5],[60,29.5,0.5],[60,30,2],
]
const GREEN = [
  [67,0,1],
  [70,1,2],[72,3,1],[74,4,1.5],[76,5.5,0.5],[74,6,1],
  [72,7,2],[69,9,1],[65,10,1.5],[67,11.5,0.5],[69,12,1],
  [70,13,2],[69,15,1],[67,16,1.5],[66,17.5,0.5],[67,18,1],
  [69,19,2],[66,21,1],[62,22,2],[67,24,1],
  [70,25,2],[72,27,1],[74,28,1.5],[76,29.5,0.5],[74,30,1],
  [72,31,2],[69,33,1],[65,34,1.5],[67,35.5,0.5],[69,36,1],
  [70,37,1.5],[69,38.5,0.5],[67,39,1],[66,40,1.5],[64,41.5,0.5],[65,42,1],
  [67,43,3],[67,46,2],
  [77,49,3],[77,52,1.5],[76,53.5,0.5],[74,54,1],
  [72,55,2],[69,57,1],[65,58,1.5],[67,59.5,0.5],[69,60,1],
  [70,61,2],[67,63,1],[67,64,1.5],[66,65.5,0.5],[67,66,1],
  [69,67,2],[66,69,1],[62,70,2],
  [77,73,3],[77,76,1.5],[76,77.5,0.5],[74,78,1],
  [72,79,2],[69,81,1],[65,82,1.5],[67,83.5,0.5],[69,84,1],
  [70,85,1.5],[69,86.5,0.5],[67,87,1],[66,88,1.5],[64,89.5,0.5],[65,90,1],
  [67,91,3],[67,94,2],
]

const SONGS = {
  ode: {
    title: 'Ode to Joy', tempo: 100, beatsPerBar: 4, melody: ODE, repeats: 2, drums: false,
    padPreset: STRINGS, padOct: 3, pickup: 0,   // starts on the downbeat, no anacrusis
    // standard I–V harmonisation, one chord per bar (matches the 8 melody bars)
    chords: ['C','G','C','G','C','G','C','C'],
  },
  greensleeves: {
    title: 'Greensleeves', tempo: 90, beatsPerBar: 6, melody: GREEN, repeats: 2, drums: false,
    padPreset: STRINGS, padOct: 3, pickup: 1,   // 1-beat pickup (the lone G accent) — backing lands on the real downbeat after it
    // the sheet's OWN chords (from the musicaviva Gdor ABC annotations), one per bar (16 bars)
    chords: ['Gm','F','Gm','Dm','Gm','F','D','Gm','Bb','F','Gm','Dm','Bb','F','D','G'],
  },
}

const N = (pitch, startBeat, durationBeats, velocity = 92) => ({ id: uid(), pitch, startBeat: +startBeat.toFixed(4), durationBeats: +durationBeats.toFixed(4), velocity })
const KICK = 36, SNARE = 38, HAT = 42

function build(song) {
  const { beatsPerBar: BPB, chords, tempo } = song
  const pickup = song.pickup || 0                 // anacrusis: melody enters `pickup` beats before bar 1's downbeat
  const barsPerPass = chords.length
  const passBeats = pickup + barsPerPass * BPB     // the pickup pushes the whole metrical frame later
  const melodyNotes = [], padNotes = [], bassNotes = [], drumNotes = []

  for (let r = 0; r < song.repeats; r++) {
    const off = r * passBeats
    for (const [p, s, d] of song.melody) melodyNotes.push(N(p, off + s, d, 100))   // melody already carries its pickup at beat 0
    chords.forEach((cname, bar) => {
      const barStart = off + pickup + bar * BPB    // backing lands on the true downbeat, after the pickup
      const ch = triad(cname, song.padOct)
      // pad: full triad held for the bar
      for (const n of ch.notes) padNotes.push(N(n, barStart, BPB, 62))
      // bass: root an octave down, on the bar's pulses (2 in 4/4, 2 in 6/4 at 0 and half)
      const half = BPB / 2
      bassNotes.push(N(ch.root - 12, barStart, half, 88))
      bassNotes.push(N(ch.root - 12, barStart + half, BPB - half, 84))
      // drums (4/4 only): kick 1&3, snare 2&4, hats on the beat
      if (song.drums && BPB === 4) {
        drumNotes.push(N(KICK, barStart, 0.5, 100), N(KICK, barStart + 2, 0.5, 96))
        drumNotes.push(N(SNARE, barStart + 1, 0.5, 84), N(SNARE, barStart + 3, 0.5, 84))
        for (let b = 0; b < 4; b++) drumNotes.push(N(HAT, barStart + b + 0.5, 0.4, 60))
      }
    })
  }

  const songBeats = passBeats * song.repeats
  const track = (id, name, instrument) => ({ id, name, type: 'audio', color: '#a78bfa', volume: 0.8, pan: 0, mute: false, solo: false, armed: false, height: 64, effects: [], instrument })
  const clip = (trackId, name, notes, presetId, isDrum = false) => ({ kind: 'midi', id: uid(), trackId, name, startBeat: 0, durationBeats: songBeats, notes, isDrumClip: isDrum, presetId, rollFx: {} })

  // Pad + bass are SYNTHESIZED (poly) — generated per note, so no multisample seams (the sampled
  // Strings preset had notes that sounded like different instruments). Piano melody stays sampled.
  // Pad opened brighter (was 1900 → 3600) so the mix isn't dark; ears.mjs flagged "no air over 2kHz".
  const PAD_SYNTH = { waveform: 'sawtooth', attack: 0.5, decay: 0.5, sustain: 0.55, release: 1.0, detune: 9, filterType: 'lowpass', filterCutoff: 6000, filterResonance: 1.0, lfoEnabled: false, lfoRate: 0.3, lfoDepth: 0, lfoTarget: 'filter', lfoWaveform: 'sine' }
  const BASS_SYNTH = { waveform: 'triangle', attack: 0.005, decay: 0.25, sustain: 0.45, release: 0.2, detune: 0, filterType: 'lowpass', filterCutoff: 750, filterResonance: 0.7, lfoEnabled: false, lfoRate: 4, lfoDepth: 0, lfoTarget: 'filter', lfoWaveform: 'sine' }

  // fx helpers — ears.mjs read: boxy (120–400Hz pile-up), no air (>2kHz), and mono (corr 1.0).
  const eq3 = (low, mid, high, lowFreq = 200, midFreq = 300, highFreq = 6000) => ({ id: uid(), type: 'eq3', params: { enabled: true, lowGain: low, midGain: mid, highGain: high, lowFreq, midFreq, highFreq } })
  const chorus = (mix = 0.35) => ({ id: uid(), type: 'chorus', params: { enabled: true, type: 'chorus', rate: 0.5, depth: 0.4, feedback: 0.2, mix, stages: 3 } })   // stereo → adds width to a mono synth
  const comp = (makeup = 2) => ({ id: uid(), type: 'compressor', params: { enabled: true, threshold: -20, ratio: 3, attack: 0.005, release: 0.2, knee: 6, makeupGain: makeup } })

  const tMel = uid(), tPad = uid(), tBass = uid(), tDrum = uid()
  const tracks = [
    { ...track(tMel, 'Piano (melody)', { type: 'none', params: {} }), volume: 1.0,   // the star — sits on top
      effects: [eq3(0, -1.5, 2.5, 200, 350, 4500), { id: uid(), type: 'reverb', params: { enabled: true, wet: 0.16, decay: 1.8, preDelay: 0.01 } }] },   // gentle de-box + slight lift, no comp
    { ...track(tPad, 'Warm Pad (chords)', { type: 'poly', params: PAD_SYNTH }), volume: 0.26,   // quieter → less low-mid pile-up
      effects: [eq3(-4, -6, 3, 240, 300, 7000), chorus(0.4)] },   // hard low-mid scoop (the boxy zone) + open highs + widen
    { ...track(tBass, 'Bass', { type: 'poly', params: BASS_SYNTH }), volume: 0.38, pan: 0,
      effects: [eq3(1, -5, 0, 90, 300, 6000)] },   // keep the deep root, scoop the 300Hz mud
  ]
  const clips = [
    clip(tMel, 'Melody', melodyNotes, PIANO),          // sampled grand piano
    { ...clip(tPad, 'Chords', padNotes, null), rollFx: {} },   // poly pad — no preset, plays the track synth
    clip(tBass, 'Bass', bassNotes, null),              // poly synth bass
  ]
  if (song.drums && drumNotes.length) {
    tracks.push({ ...track(tDrum, 'Drums', { type: 'drum', params: { pack: 'synth' } }), volume: 0.55 })
    clips.push(clip(tDrum, 'Drums', drumNotes, null, true))
  }

  const dawProject = {
    id: uid(), name: `${song.title} (accompaniment)`, tempo, timeSignatureNum: BPB, timeSignatureDen: 4,
    swing: 0, key: song.title === 'Ode to Joy' ? 'C' : 'G', scale: song.title === 'Ode to Joy' ? 'major' : 'minor',
    masterVolume: 1.35, tracks, arrangementClips: clips, sessionGrid: [], scenes: [], automationLanes: [], clipEffects: [],
    returnTracks: [], takeLanes: [], loopStart: 0, loopEnd: songBeats, loopEnabled: false,
  }
  return { _type: '100lights-project', version: 1, id: uid(), name: dawProject.name, savedAt: new Date(0).toISOString(),
    tracks: [], clips: [], adjustments: {}, zoomLevel: 1, captions: [], outputs: [], media: [], modules: ['audio'], audioMode: true, dawProject }
}

function render(cf, label, tmp) {
  const cfPath = join(tmp, `${safe(label)}.cfproj`)
  writeFileSync(cfPath, JSON.stringify(cf))
  writeFileSync(join(OUT_DIR, `${safe(label)}.cfproj`), JSON.stringify(cf))
  if (has('no-audio')) { console.log(`  ✓ ${join(OUT_DIR, safe(label) + '.cfproj')} (cfproj only — --no-audio)`); return }
  console.log(`▸ rendering "${label}"…`)
  execFileSync('node', ['scripts/hear-ai.mjs', `--project=${cfPath}`, `--out=${join(OUT_DIR, safe(label) + '.mp3')}`], { cwd: ROOT, stdio: 'inherit' })
  console.log(`  ✓ ${join(OUT_DIR, safe(label) + '.mp3')} (+ .cfproj)`)
}

// Pool = the original two + the public-domain melody library. Default is now RANDOM (fixes the old
// "always Ode to Joy" default). --song=<slug> picks one; --count=N picks N distinct random; --all = all.
const POOL = { ...SONGS, ...MELODIES, ...ORIGINALS }
const norm = (o) => ({ padPreset: STRINGS, padOct: 3, pickup: 0, drums: false, repeats: 2, ...o })
let picks
if (has('all')) picks = Object.keys(POOL)
else if (flag('song', null)) picks = [flag('song')]
else {
  // Random default draws only from the APPLICABLE set (no kids/holiday tunes). --song=<slug> still
  // reaches any melody in the library, and --all does the whole thing.
  const n = Math.max(1, Number(flag('count', '1')))
  const bag = [...RANDOM_KEYS]
  picks = []
  for (let i = 0; i < n && bag.length; i++) picks.push(bag.splice(Math.floor(Math.random() * bag.length), 1)[0])
}
console.log(`▸ ${picks.length} song(s) from a ${Object.keys(POOL).length}-melody library: ${picks.join(', ')}`)
for (const s of picks) {
  const song = POOL[s]
  if (!song) { console.error(`unknown song "${s}" — options: ${Object.keys(POOL).join(', ')}`); continue }
  const tmp = mkdtempSync(join(tmpdir(), 'accompany-'))
  try { render(build(norm(song)), `${song.title} (accompaniment)`, tmp) }
  finally { rmSync(tmp, { recursive: true, force: true }) }
}
console.log('\n✓ done')
