#!/usr/bin/env node
// Author an ORIGINAL lofi/chillhop arrangement that sounds PRODUCED, not MIDI-demo — applies the
// research playbook ([[project-100lights-arrangement-rules]]): rootless 7/9/11 voicings, a laid-back
// swung groove with ghost notes, moving bass, a developed pentatonic motif, an intro→main→breakdown→
// variation→outro ARC (add/remove one layer per phrase), humanized velocity + micro-timing, and
// production (eq/saturation/reverb/dotted-8th delay/chorus). Renders via hear-ai + loudnorm to -14 LUFS.
//
//   node scripts/arrange-lofi.mjs                 # default: "Dusk" in C minor, ~90s
//   node scripts/arrange-lofi.mjs --name="Rainy"  --seed=7
// Outputs "<Name> (lofi).cfproj" + ".mp3" to ~/Desktop/100lights-ai-renders/.
import { writeFileSync, mkdtempSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir, homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(homedir(), 'Desktop', '100lights-ai-renders')
const uid = () => randomUUID()
const argv = process.argv.slice(2)
const flag = (n, d) => { const a = argv.find(x => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : d }
const NAME = flag('name', 'Dusk')
const safe = s => s.replace(/[^\w.\- ]+/g, '').replace(/\s+/g, ' ').trim()

// ── deterministic RNG (seeded) so renders are reproducible ────────────────────
let _seed = (Number(flag('seed', 3)) || 3) >>> 0
const rnd = () => { _seed = (_seed * 1664525 + 1013904223) >>> 0; return _seed / 4294967296 }
const jitter = (ms, bpm) => (rnd() * 2 - 1) * ms / 1000 * (bpm / 60)   // ±ms → beats
const vary = (base, spread) => Math.max(1, Math.min(127, Math.round(base + (rnd() * 2 - 1) * spread)))

const BPM = 82, BPB = 4
const N = (pitch, startBeat, durationBeats, velocity) => ({ id: uid(), pitch, startBeat: +startBeat.toFixed(4), durationBeats: +durationBeats.toFixed(4), velocity })

// ── Harmony: i – ♭VI – ♭III – ♭VII in C minor, ROOTLESS upper-structure voicings ──
// (bass supplies the root; guide-tones + 9ths clustered ~C4–D5; nothing but 5ths/octaves low)
const PROG = [
  { name: 'Cm9',    voicing: [63, 67, 70, 74], bass: 36 }, // Eb G Bb D  (3 5 ♭7 9)
  { name: 'Abmaj7', voicing: [60, 63, 67, 70], bass: 32 }, // C Eb G Bb  (3 5 7 9)
  { name: 'Ebmaj9', voicing: [67, 70, 74, 77], bass: 39 }, // G Bb D F   (3 5 7 9)
  { name: 'Bb9',    voicing: [62, 65, 68, 72], bass: 34 }, // D F Ab C   (3 5 ♭7 9)
]
const PENTA = [72, 75, 77, 79, 82] // C Eb F G Bb (C minor pentatonic, octave 5)

// ── Per-bar generators (return notes at bar-local beats 0..4) ──────────────────
function keysBar(ch) {                 // rhythmic comp: stabs on 1 and the "and of 2", plus a held 3
  const out = []
  const play = (beat, dur, velBase) => ch.voicing.forEach((p, i) =>
    out.push(N(p, beat + jitter(8, BPM) + i * 0.006, dur, vary(velBase - i * 2, 7))))   // slight roll + velocity taper
  play(0, 1.4, 82); play(2.5, 0.6, 70); play(3, 1.0, 74)
  return out
}
function padBar(ch) {                   // sustained bed — lower, softer, whole bar
  return ch.voicing.map((p, i) => N(p - 12, 0, BPB, vary(46, 5)))
}
function bassBar(ch, next) {             // root on 1, root up-oct on "and of 2", walk to next root on 4
  const r = ch.bass
  return [
    N(r, 0 + jitter(6, BPM), 1.4, vary(92, 6)),
    N(r, 1.5 + jitter(6, BPM), 0.5, vary(70, 8)),        // ghost/roll
    N(r + 12, 2.5 + jitter(6, BPM), 0.5, vary(80, 6)),
    N(next ? Math.round((r + next.bass) / 2) : r, 3.5 + jitter(6, BPM), 0.5, vary(74, 6)), // passing tone into next bar
  ]
}
function drumBar(fill) {                 // laid-back: kick 1 + "and of 2", snare 2&4 pushed LATE, swung hats + ghosts
  const K = 36, S = 38, H = 42
  const late = 12 / 1000 * (BPM / 60)    // ~12ms behind
  const out = [
    N(K, 0 + jitter(4, BPM), 0.5, vary(102, 6)),
    N(K, 2.5 + jitter(4, BPM), 0.5, vary(92, 8)),
    N(S, 1 + late + jitter(4, BPM), 0.5, vary(108, 5)),
    N(S, 3 + late + jitter(4, BPM), 0.5, vary(106, 5)),
  ]
  for (let e = 0; e < 8; e++) {          // 8th-note hats with swing (off-beats pushed) + velocity groove
    const swing = e % 2 ? 0.11 : 0        // delay the off-beats ≈ 58% swing
    const b = e * 0.5 + swing + jitter(6, BPM)
    out.push(N(H, b, 0.35, vary(e % 2 ? 62 : 78, 12)))
    if (rnd() < 0.35) out.push(N(H, b + 0.25 + jitter(6, BPM), 0.2, vary(30, 10)))  // ghost 16th
  }
  if (fill) { out.push(N(S, 3.5 + jitter(4, BPM), 0.25, vary(70, 10)), N(S, 3.75, 0.25, vary(88, 10))) }
  return out
}
function melodyPhrase(motif, transpose) {  // a short motif with rests; call/response via transpose
  return motif.map(([deg, s, d, v]) => N(PENTA[((deg % 5) + 5) % 5] + (deg >= 5 ? 12 : 0) + transpose, s + jitter(10, BPM), d, vary(v, 8)))
}

// Motif (degree in penta, start beat, dur, vel) — leaves space (rests), rhythmic interest
const MOTIF_A = [[0, 0.5, 0.5, 88], [1, 1, 0.75, 92], [2, 2.5, 1.0, 96], [1, 3.75, 0.25, 80]]
const MOTIF_B = [[2, 0, 0.75, 90], [3, 1, 0.5, 94], [4, 2, 1.5, 98], [2, 3.75, 0.25, 78]]

// ── Arrangement ARC: sections × 4 bars; each flags which layers play ───────────
const SECTIONS = [
  { bars: 2, keys: 1, pad: 1, bass: 0, drums: 0, mel: 0 },              // intro: keys + pad
  { bars: 4, keys: 1, pad: 1, bass: 1, drums: 1, mel: 0 },              // main A: full, no melody
  { bars: 4, keys: 1, pad: 1, bass: 1, drums: 1, mel: 'A' },            // main A2: motif A
  { bars: 2, keys: 1, pad: 1, bass: 1, drums: 0, mel: 0 },              // breakdown: drop drums
  { bars: 4, keys: 1, pad: 1, bass: 1, drums: 1, mel: 'B', fill: true },// main B: motif B + fills
  { bars: 2, keys: 1, pad: 1, bass: 0, drums: 0, mel: 0 },              // outro: strip back
]

function build() {
  const melN = [], keyN = [], padN = [], bassN = [], drumN = []
  let bar = 0
  for (const sec of SECTIONS) {
    for (let i = 0; i < sec.bars; i++, bar++) {
      const ch = PROG[bar % PROG.length]
      const next = PROG[(bar + 1) % PROG.length]
      const at = (notes) => notes.map(n => ({ ...n, startBeat: +Math.max(0, bar * BPB + n.startBeat).toFixed(4), durationBeats: Math.max(0.05, n.durationBeats) }))
      if (sec.keys)  keyN.push(...at(keysBar(ch)))
      if (sec.pad)   padN.push(...at(padBar(ch)))
      if (sec.bass)  bassN.push(...at(bassBar(ch, next)))
      if (sec.drums) drumN.push(...at(drumBar(sec.fill && i === sec.bars - 1)))
      if (sec.mel)   melN.push(...at(melodyPhrase(sec.mel === 'A' ? MOTIF_A : MOTIF_B, i % 2 ? 2 : 0)))
    }
  }
  const songBeats = bar * BPB

  const track = (id, name, instrument, volume, effects, pan = 0) => ({ id, name, type: 'audio', color: '#a78bfa', volume, pan, mute: false, solo: false, armed: false, height: 64, effects, instrument })
  const clip = (trackId, name, notes, presetId, isDrum = false) => ({ kind: 'midi', id: uid(), trackId, name, startBeat: 0, durationBeats: songBeats, notes, isDrumClip: isDrum, presetId, rollFx: {} })

  // instruments
  const PIANO = 'builtin-0'
  const KEYS_SYNTH = null // sampled piano preset
  const PAD_SYNTH  = { type: 'poly', params: { waveform: 'sawtooth', attack: 0.6, decay: 0.6, sustain: 0.5, release: 1.4, detune: 11, filterType: 'lowpass', filterCutoff: 3200, filterResonance: 0.8, lfoEnabled: false, lfoRate: 0.18, lfoDepth: 0, lfoTarget: 'filter', lfoWaveform: 'sine' } }
  const BASS_SYNTH = { type: 'poly', params: { waveform: 'triangle', attack: 0.006, decay: 0.3, sustain: 0.4, release: 0.22, detune: 0, filterType: 'lowpass', filterCutoff: 700, filterResonance: 0.6, lfoEnabled: false, lfoRate: 4, lfoDepth: 0, lfoTarget: 'filter', lfoWaveform: 'sine' } }

  // fx helpers
  const eq3   = (low, mid, high, lowFreq = 200, midFreq = 350, highFreq = 6000) => ({ id: uid(), type: 'eq3', params: { enabled: true, lowGain: low, midGain: mid, highGain: high, lowFreq, midFreq, highFreq } })
  const rev   = (wet, decay, pre = 0.02) => ({ id: uid(), type: 'reverb', params: { enabled: true, wet, decay, preDelay: pre } })
  const delay = (wet = 0.16) => ({ id: uid(), type: 'delay', params: { enabled: true, delayTime: 0.549, feedback: 0.34, delayWet: wet } }) // dotted-8th @82BPM ≈ 0.549s, filtered feel via low wet
  const chorus= (mix = 0.35) => ({ id: uid(), type: 'chorus', params: { enabled: true, type: 'chorus', rate: 0.5, depth: 0.4, feedback: 0.2, mix, stages: 3 } })
  const drive = (amt = 0.18) => ({ id: uid(), type: 'distortion', params: { enabled: true, distortion: amt } }) // gentle tape-ish saturation
  const comp  = (thr = -20, ratio = 3, makeup = 2) => ({ id: uid(), type: 'compressor', params: { enabled: true, threshold: thr, ratio, attack: 0.005, release: 0.22, knee: 6, makeupGain: makeup } })

  const tKeys = uid(), tPad = uid(), tBass = uid(), tDrum = uid()
  // Effect palette limited to the proven set (eq3/chorus/compressor/reverb) — the
  // engine's delay+distortion nodes injected a non-finite value at bounce time.
  // Tape saturation + dotted-8th delay are applied in post (ffmpeg) instead.
  void drive; void delay
  const tracks = [
    track(tKeys, 'Keys (comp)', { type: 'none', params: {} }, 0.92,
      [eq3(-1, -2, 2.5, 220, 350, 4500), rev(0.22, 1.9)]),
    track(tPad, 'Warm Pad', PAD_SYNTH, 0.24,
      [eq3(-4, -6, 3, 240, 320, 7000), chorus(0.42), rev(0.3, 2.6)]),
    track(tBass, 'Bass', BASS_SYNTH, 0.4,
      [eq3(2, -5, 0, 90, 300, 5000), comp(-22, 3, 2)]),
    track(tDrum, 'Drums', { type: 'drum', params: { pack: 'synth' } }, 0.6,
      [eq3(1, -2, 1.5, 120, 400, 8000), comp(-18, 4, 2), rev(0.1, 0.5)]),
  ]
  const clips = [
    clip(tKeys, 'Keys', keyN, PIANO),
    clip(tPad, 'Pad', padN, KEYS_SYNTH),
    clip(tBass, 'Bass', bassN, null),
    clip(tDrum, 'Drums', drumN, null, true),
  ]

  const dawProject = {
    id: uid(), name: `${NAME} (lofi)`, tempo: BPM, timeSignatureNum: BPB, timeSignatureDen: 4,
    swing: 0, key: 'C', scale: 'minor', masterVolume: 0.82, tracks, arrangementClips: clips,   // headroom — post-master brings it to -14 LUFS
    sessionGrid: [], scenes: [], automationLanes: [], clipEffects: [], returnTracks: [], takeLanes: [],
    loopStart: 0, loopEnd: songBeats, loopEnabled: false,
  }
  return { _type: '100lights-project', version: 1, id: uid(), name: dawProject.name, savedAt: new Date(0).toISOString(),
    tracks: [], clips: [], adjustments: {}, zoomLevel: 1, captions: [], outputs: [], media: [], modules: ['audio'], audioMode: true, dawProject }
}

const cf = build()
const label = `${NAME} (lofi)`
const tmp = mkdtempSync(join(tmpdir(), 'lofi-'))
const cfPath = join(tmp, `${safe(label)}.cfproj`)
writeFileSync(cfPath, JSON.stringify(cf))
writeFileSync(join(OUT_DIR, `${safe(label)}.cfproj`), JSON.stringify(cf))
console.log(`▸ authored "${label}" · ${BPM} BPM · C minor · ${cf.dawProject.arrangementClips.reduce((n, c) => n + c.notes.length, 0)} notes across ${cf.dawProject.tracks.length} tracks`)
if (argv.includes('--dry')) { console.log(`  (dry) wrote cfproj only`); process.exit(0) }
console.log('▸ rendering through the studio engine…')
execFileSync('node', ['scripts/hear-ai.mjs', `--project=${cfPath}`, `--out=${join(OUT_DIR, safe(label) + '.mp3')}`], { cwd: ROOT, stdio: 'inherit' })
console.log(`  ✓ ${join(OUT_DIR, safe(label) + '.mp3')}`)
