#!/usr/bin/env node
// Apollo multisample bridge — play a REAL recorded instrument through the
// Helios engine from plain Node.
//
// WHY
// Every pitched voice in our songs is a synth patch, and a palette audit showed
// almost no energy above 900 Hz for any of them. Real recorded instruments carry
// that energy natively. Apollo already HAS a `multisample` oscillator engine;
// nothing was feeding it from a script. This does.
//
// HOW IT WORKS (the whole finding, in three lines)
//   1. Multisample zones read their audio out of the SAME buffer registry the
//      `sample` engine uses: engine.samples.get(zone.sampleId). So the existing
//      `{type:'sample', id, sr, len, l, r}` port message — i.e. apollo-render's
//      `--sample id=file.wav` — is all the audio loading multisample needs.
//   2. The zone MAP lives in the patch: patch.oscs[i].ms.zones = MultisampleZone[].
//      That is plain JSON, so `--set osc0.ms.zones=[...]` delivers it.
//   3. Therefore scripts/apollo-render.mjs can already render a multisampled
//      instrument with NO changes. This script builds the WAVs + zone list and
//      shells out to it.
//
// Usage:
//   node scripts/apollo-multisample.mjs \
//     --lib /path/to/sfzinstruments-splendid-grand-piano \
//     --wav-dir /tmp/wav --layers PP,MP,FF --range 36-84 --trim 4 \
//     --notes "48:0:3,55:0:3,60:0:3,64:0:3" --out chord.wav --json
//
//   --lib DIR       library root: needs data/{PP,MP,MF,FF}.txt (SFZ region maps)
//                   and samples/<Layer> <Note>.ogg
//   --layers LIST   velocity layers to include, low→high (default PP,MP,MF,FF)
//   --range LO-HI   MIDI note range of zones to build (default 21-108)
//   --trim SEC      truncate each sample to SEC seconds w/ 120 ms fade (default 4)
//   --mono          downmix samples to mono (halves memory + WAV size)
//   --gain-db N     per-zone gain in dB (MultisampleZone.gain) — quiet libraries
//                   like the FluidR3 mirrors need about +22
//   --patch-out F   also write the standalone Apollo patch JSON (zones inline)
//   --zones-out F   write just the zone array
//   --no-render     build the sample set + zones only
//   ...anything else is forwarded verbatim to apollo-render.mjs

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// ── args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const opt = { layers: 'PP,MP,MF,FF', range: '21-108', trim: 4, mono: false }
const passthrough = []
for (let i = 0; i < argv.length; i++) {
  let a = argv[i], inline = null
  const eq = a.indexOf('=')
  if (a.startsWith('--') && eq > 0) { inline = a.slice(eq + 1); a = a.slice(0, eq) }
  const val = () => (inline !== null ? inline : argv[++i])
  switch (a) {
    case '--lib': opt.lib = val(); break
    case '--notes-dir': opt.notesDir = val(); break
    case '--octave-offset': opt.octaveOffset = parseInt(val(), 10); break
    case '--wav-dir': opt.wavDir = val(); break
    case '--layers': opt.layers = val(); break
    case '--range': opt.range = val(); break
    case '--trim': opt.trim = parseFloat(val()); break
    case '--mono': opt.mono = true; break
    case '--gain-db': opt.gainDb = parseFloat(val()); break
    case '--patch-out': opt.patchOut = val(); break
    case '--zones-out': opt.zonesOut = val(); break
    case '--no-render': opt.noRender = true; break
    default: passthrough.push(inline !== null ? `${a}=${inline}` : a); break
  }
}
if (!opt.lib && !opt.notesDir) { console.error('--lib <sfz library dir> or --notes-dir <note-named folder> is required'); process.exit(2) }
opt.wavDir = opt.wavDir || path.join(opt.lib || opt.notesDir, '_apollo-wav')

// ── SFZ velocity groups (from "Splendid Grand Piano.sfz") ───────────────────
// lovel/hivel per dynamic layer, and the filename prefix each layer uses.
const LAYERS = {
  PP: { lo: 1, hi: 67, prefix: 'PP', map: 'PP.txt' },
  MP: { lo: 68, hi: 84, prefix: 'Mp', map: 'MP.txt' },
  MF: { lo: 85, hi: 100, prefix: 'Mf', map: 'MF.txt' },
  FF: { lo: 101, hi: 127, prefix: 'FF', map: 'FF.txt' },
}

// ── parse an SFZ region map (data/FF.txt etc.) ──────────────────────────────
// line: <region> region_label=01 lokey=021 hikey=024 pitch_keycenter=023 \
//       ampeg_release=0.6 sample=FF B-1.$EXT   [offset=100]
function parseRegions(file) {
  const out = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.includes('<region>')) continue
    const num = k => { const m = line.match(new RegExp(`\\b${k}=(-?[\\d.]+)`)); return m ? Number(m[1]) : null }
    // `sample=` is supposed to be the LAST opcode on a region line, but this
    // library writes `sample=FF C3.$EXT offset=325` on a few of them. Greedy
    // "to end of line" silently produced a filename that matched nothing, and
    // those zones fell back to the nearest OTHER zone — a wrong-velocity-layer
    // render that still looked like it worked. Stop at the extension.
    const sm = line.match(/\bsample=(.+?)\.(?:\$EXT|flac|ogg|wav|m4a)(?:\s|$)/i)
    if (!sm) continue
    const lokey = num('lokey'), hikey = num('hikey'), root = num('pitch_keycenter')
    if (lokey == null || hikey == null || root == null) continue
    out.push({
      lokey, hikey, rootKey: root,
      release: num('ampeg_release'),
      offset: num('offset') || 0,
      name: sm[1],
    })
  }
  return out
}

// ── case-insensitive sample lookup (the repo ships both "Mf D5" and "MF D5") ─
const samplesDir = opt.notesDir || path.join(opt.lib, 'samples')
const index = new Map()
for (const f of readdirSync(samplesDir)) index.set(f.toLowerCase(), f)

// ── note names → MIDI ───────────────────────────────────────────────────────
// Both conventions show up: soundfont mirrors name middle C "C4" (=60), while
// this SFZ piano names it "C3". --octave-offset reconciles them; the SFZ path
// doesn't need it because those maps carry pitch_keycenter outright.
const PC = { C: 0, 'C#': 1, DB: 1, D: 2, 'D#': 3, EB: 3, E: 4, F: 5, 'F#': 6, GB: 6, G: 7, 'G#': 8, AB: 8, A: 9, 'A#': 10, BB: 10, B: 11 }
function noteToMidi(name, octaveOffset = 0) {
  const m = name.match(/^([A-Ga-g])([#b]?)(-?\d+)$/)
  if (!m) return null
  const pc = PC[(m[1] + m[2]).toUpperCase()]
  if (pc == null) return null
  return (Number(m[3]) + octaveOffset + 1) * 12 + pc
}
function findAudio(base) {
  for (const ext of ['.ogg', '.m4a', '.mp3', '.wav', '.flac']) {
    const hit = index.get((base + ext).toLowerCase())
    if (hit) return path.join(samplesDir, hit)
  }
  return null
}

// ── build ───────────────────────────────────────────────────────────────────
const [rLo, rHi] = opt.range.split('-').map(Number)
const chosen = opt.layers.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
for (const l of chosen) if (!LAYERS[l]) { console.error(`unknown layer ${l} (have ${Object.keys(LAYERS)})`); process.exit(2) }
chosen.sort((a, b) => LAYERS[a].lo - LAYERS[b].lo)
// stretch the selected layers so 1..127 is fully covered even with a subset
const velBands = opt.notesDir ? [{ layer: null, lo: 1, hi: 127 }] : chosen.map((l, i) => ({
  layer: l,
  lo: i === 0 ? 1 : LAYERS[chosen[i]].lo,
  hi: i === chosen.length - 1 ? 127 : LAYERS[chosen[i + 1]].lo - 1,
}))

/** Zone map for one velocity band: SFZ regions, or a folder of note-named files. */
function regionsFor(band) {
  if (!opt.notesDir) {
    const mapFile = path.join(opt.lib, 'data', LAYERS[band.layer].map)
    if (!existsSync(mapFile)) { console.error(`missing region map ${mapFile}`); process.exit(2) }
    return parseRegions(mapFile)
  }
  // One file per note, no explicit ranges: give each sample the keys that are
  // closer to it than to its neighbours (half-way splits), so the whole
  // keyboard sounds even when the library samples every third semitone.
  const found = []
  for (const f of readdirSync(opt.notesDir)) {
    const base = f.replace(/\.[^.]+$/, '')
    const midi = noteToMidi(base, opt.octaveOffset || 0)
    if (midi != null) found.push({ midi, name: base })
  }
  found.sort((a, b) => a.midi - b.midi)
  return found.map((f, i) => ({
    lokey: i === 0 ? 0 : Math.floor((found[i - 1].midi + f.midi) / 2) + 1,
    hikey: i === found.length - 1 ? 127 : Math.floor((f.midi + found[i + 1].midi) / 2),
    rootKey: f.midi, release: null, offset: 0, name: f.name,
  }))
}

mkdirSync(opt.wavDir, { recursive: true })
const zones = []
const samples = []   // {id, wav}
let missing = 0, bytes = 0
for (const band of velBands) {
  for (const r of regionsFor(band)) {
    if (r.hikey < rLo || r.lokey > rHi) continue
    const src = findAudio(r.name)
    if (!src) { missing++; continue }
    const id = r.name.replace(/[^A-Za-z0-9]+/g, '_')
    const wav = path.join(opt.wavDir, id + '.wav')
    if (!existsSync(wav)) {
      const fade = Math.max(0.05, Math.min(0.12, opt.trim * 0.05))
      const af = [`afade=t=out:st=${(opt.trim - fade).toFixed(3)}:d=${fade.toFixed(3)}`]
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', src,
        '-t', String(opt.trim), '-af', af.join(','),
        '-ac', opt.mono ? '1' : '2', '-ar', '48000', '-c:a', 'pcm_s16le', wav])
    }
    bytes += statSync(wav).size
    samples.push({ id, wav })
    zones.push({
      sampleId: id,
      loKey: Math.max(r.lokey, rLo), hiKey: Math.min(r.hikey, rHi),
      loVel: band.lo, hiVel: band.hi,
      rootKey: r.rootKey,
      tune: 0,
      // Zone gain is dB, applied by the engine per zone — the only place to
      // fix a library that was mastered quiet. The FluidR3 soundfont mirrors
      // peak around -24 dBFS, which renders at peak 0.07 and reads as a bug.
      gain: opt.gainDb || 0,
      loopMode: 'off', loopStart: 0, loopEnd: 1,
    })
  }
}
if (!zones.length) { console.error('no zones built — check --lib / --range'); process.exit(1) }
console.error(`built ${zones.length} zones from ${samples.length} samples (${(bytes / 1e6).toFixed(1)} MB WAV)` +
  (missing ? `, ${missing} regions had no audio file` : ''))

if (opt.zonesOut) writeFileSync(opt.zonesOut, JSON.stringify(zones, null, 2))
if (opt.patchOut) {
  // The zone map + the sample manifest that has to accompany it. Drop the
  // zones onto any ApolloPatch at patch.oscs[i].ms.zones and set that osc's
  // engine to 'multisample'; post each manifest entry as {type:'sample',…}.
  writeFileSync(opt.patchOut, JSON.stringify({
    name: `Multisample: ${path.basename(opt.lib || opt.notesDir)}`,
    ms: { name: path.basename(opt.lib || opt.notesDir), zones },
    samples: samples.map(s => ({ id: s.id, wav: s.wav })),
  }, null, 2))
}
if (opt.noRender) { console.log(JSON.stringify({ zones: zones.length, samples: samples.length, wavBytes: bytes })); process.exit(0) }

// ── render through the real engine, via the unmodified apollo-render CLI ────
const args = ['--experimental-strip-types', path.join(ROOT, 'scripts', 'apollo-render.mjs')]
for (const s of samples) args.push('--sample', `${s.id}=${s.wav}`)
args.push('--set', 'osc0.engine=multisample')
args.push('--set', 'osc0.keytrackPitch=true')
args.push('--set', `osc0.ms.zones=${JSON.stringify(zones)}`)
args.push('--set', 'osc0.ms.name=' + JSON.stringify(path.basename(opt.lib || opt.notesDir)))
// amp env: hold the sample at full so its OWN decay is what you hear.
// NOTE the path style: apollo-render's --set only rewrites osc0/1/2 onto
// patch.oscs[i]; everything else is a literal dot path, so it is `envs.0.…`
// and NOT the `env1.…` mod-destination alias.
args.push('--set', 'envs.0.sustain=1', '--set', 'envs.0.decay=8',
  '--set', 'envs.0.attack=0.001', '--set', 'envs.0.release=0.35')
args.push(...passthrough)

const res = spawnSync(process.execPath, args, { stdio: 'inherit' })
process.exit(res.status ?? 1)
