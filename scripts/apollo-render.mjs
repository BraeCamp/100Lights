#!/usr/bin/env node --experimental-strip-types
// Apollo headless render CLI — the AI's (and any script's) direct line into the
// synth. Runs the REAL worklet engine (public/apollo/engine.js) in plain Node:
// no browser, no AudioContext. Design a patch as JSON, render notes through it,
// get a WAV + listening stats back. This is how songs can use Apollo sounds
// programmatically: iterate a patch here, then either ship the WAV as a sample
// or put the patch JSON on a DAW track (instrument type 'apollo').
//
// Usage:
//   node --experimental-strip-types scripts/apollo-render.mjs [options]
//     --list-presets                     list factory preset names
//     --preset "Warm Keys"               start from a factory preset
//     --patch file.json                  merge a (partial) ApolloPatch over Init
//     --set osc0.wt.pos=0.4 [...]        set patch fields (dot paths, repeatable)
//     --notes "60:0:2:0.9,64:0.5:2"      note:start:dur[:vel] (seconds); default C3 2s
//     --notes-json file.json             [{note,t,dur,vel}] alternative
//     --seconds 6                        render length (default: last note end + 2)
//     --bpm 120                          tempo for synced LFOs/delays/arp
//     --clip                             render the patch's active clip instead of notes
//     --sample id=path.wav [...]         load a WAV for sample/granular/spectral engines
//                                        (use the id in patch fields, e.g. osc0.smp.sampleId)
//     --out out.wav                      write the render (16-bit stereo 48 kHz)
//     --json                             print analysis JSON (peak/rms/centroid/silence)
//
// Examples:
//   node --experimental-strip-types scripts/apollo-render.mjs --preset "Init" \
//     --notes "48:0:2,55:0:2,60:0:2" --out chord.wav --json
//   node --experimental-strip-types scripts/apollo-render.mjs --patch mypatch.json \
//     --sample gtr=take.wav --set osc0.engine=sample --set osc0.smp.sampleId=gtr --out take-mangled.wav

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// ── Worklet shims + engine load ─────────────────────────────────────────────
const SR = 48000
globalThis.sampleRate = SR
globalThis.currentTime = 0
globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage: () => {}, onmessage: null } } }
globalThis.registerProcessor = (_name, cls) => { globalThis.__cls = cls }
await import(new URL('../public/apollo/engine.js', import.meta.url).href)

// The app's '@/' path alias is opaque to Node, so any module using it has to be
// loaded from a temp copy with the alias rewritten to an absolute file URL.
// This used to special-case presets.ts only, and broke the day patch.ts itself
// grew an alias import ('@/lib/scale-constants'): the CLI died before parsing a
// single argument. Rewrite generically instead, and keep ONE instance of
// patch.ts so presets.ts shares its initPatch/uid rather than getting a second.
const tmpModules = []
let tmpDir = null
async function loadAliased(rel, { header = '', substitutions = [] } = {}) {
  const os = await import('node:os')
  const { mkdtempSync } = await import('node:fs')
  if (!tmpDir) {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'apollo-cli-'))
    // Marks the temp dir as ESM. Without it Node prints a
    // MODULE_TYPELESS_PACKAGE_JSON warning for every .ts it reparses, which is
    // several lines of noise in front of every render's actual output.
    writeFileSync(path.join(tmpDir, 'package.json'), '{"type":"module"}')
  }
  let src = readFileSync(path.join(ROOT, rel), 'utf8')
  for (const [pattern, replacement] of substitutions) src = src.replace(pattern, replacement)
  // Copy aliased dependencies in beside this module so they share the temp
  // package.json instead of being pulled from the repo by absolute path.
  src = src.replace(/from '@\/([^']+)'/g, (_m, p) => {
    const base = p.split('/').pop()
    writeFileSync(path.join(tmpDir, base + '.ts'), readFileSync(path.join(ROOT, p + '.ts'), 'utf8'))
    return `from './${base}.ts'`
  })
  const tmp = path.join(tmpDir, `${path.basename(rel, '.ts')}.ts`)
  writeFileSync(tmp, header ? `${header}\n${src}` : src)
  tmpModules.push(tmp)
  return import(new URL(`file://${tmp}`).href)
}

const patchMod = await loadAliased('lib/apollo/patch.ts')
const { initPatch, PARAMS, FX_DEFS } = patchMod
const patchUrl = new URL(`file://${tmpModules[0]}`).href
const { generateFactoryTable, buildTableMips } = await loadAliased('lib/apollo/tables.ts')
const { FACTORY_PRESETS } = await loadAliased('lib/apollo/presets.ts', {
  // Types are erased, so stub the type-only names the file imports alongside them.
  header: 'type ApolloPatch = any\ntype ModSource = any',
  substitutions: [[/import \{[^}]+\} from '@\/lib\/apollo\/patch'/,
    `import { initPatch, defaultFx, uid } from ${JSON.stringify(patchUrl)}`]],
})
process.on('exit', async () => {
  const { unlinkSync } = await import('node:fs')
  for (const f of tmpModules) { try { unlinkSync(f) } catch { /* leave it */ } }
})

// ── Args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const flags = { set: [], sample: [] }
const KNOWN = ['--list-presets', '--json', '--clip', '--preset', '--patch', '--set', '--notes',
  '--notes-json', '--seconds', '--bpm', '--sample', '--out']
for (let i = 0; i < argv.length; i++) {
  // Accept BOTH `--flag value` and `--flag=value`. Every other script in this
  // repo takes the `=` form, so only accepting spaces here meant a perfectly
  // reasonable invocation died on "Unknown arg" with the value glued to the
  // name — easy to stare straight past.
  let a = argv[i]
  let inline = null
  const eq = a.indexOf('=')
  if (a.startsWith('--') && eq > 0) { inline = a.slice(eq + 1); a = a.slice(0, eq) }
  const value = () => (inline !== null ? inline : argv[++i])

  if (a === '--list-presets') flags.listPresets = true
  else if (a === '--json') flags.json = true
  else if (a === '--clip') flags.clip = true
  else if (a === '--preset') flags.preset = value()
  else if (a === '--patch') flags.patch = value()
  else if (a === '--set') flags.set.push(value())
  else if (a === '--notes') flags.notes = value()
  else if (a === '--notes-json') flags.notesJson = value()
  else if (a === '--seconds') flags.seconds = parseFloat(value())
  else if (a === '--bpm') flags.bpm = parseFloat(value())
  else if (a === '--sample') flags.sample.push(value())
  else if (a === '--out') flags.out = value()
  else {
    console.error(`Unknown arg: ${a}\nKnown flags: ${KNOWN.join(' ')}`)
    process.exit(2)
  }
}

if (flags.listPresets) {
  for (const p of FACTORY_PRESETS) console.log(p.name)
  process.exit(0)
}

// ── Patch assembly ──────────────────────────────────────────────────────────
let patch = initPatch()
if (flags.preset) {
  const fp = FACTORY_PRESETS.find(p => p.name.toLowerCase() === flags.preset.toLowerCase())
  if (!fp && flags.preset.toLowerCase() !== 'init') {
    console.error(`Unknown preset "${flags.preset}". --list-presets shows the options.`)
    process.exit(2)
  }
  if (fp) patch = { ...initPatch(), ...structuredClone(fp.patch) }
}
if (flags.patch) patch = { ...patch, ...JSON.parse(readFileSync(flags.patch, 'utf8')) }
for (const s of flags.set) {
  const eq = s.indexOf('=')
  if (eq < 0) { console.error('--set expects path=value:', s); process.exit(2) }
  const keys = s.slice(0, eq).split('.')
  const rawV = s.slice(eq + 1)
  let v
  try { v = JSON.parse(rawV) } catch { v = rawV }
  let o = patch
  for (let k = 0; k < keys.length - 1; k++) {
    const key = /^\d+$/.test(keys[k]) ? Number(keys[k]) : keys[k]
    if (o[key] == null) o[key] = {}
    o = o[key]
  }
  o[keys[keys.length - 1]] = v
}
// convenience: osc0/osc1/osc2 → oscs[i] (matches the mod-dest path style)
// (applied above transparently because users write oscs.0.… OR osc0.…)
function fixOscPaths() { /* handled in --set below */ }
// support osc0.x=… style in --set by rewriting before use:
for (const s of flags.set) {
  const m = s.match(/^osc([0-2])\.(.+?)=(.*)$/)
  if (m) {
    const keys = m[2].split('.')
    let v; try { v = JSON.parse(m[3]) } catch { v = m[3] }
    let o = patch.oscs[Number(m[1])]
    for (let k = 0; k < keys.length - 1; k++) o = o[keys[k]]
    o[keys[keys.length - 1]] = v
  }
}
if (flags.bpm) patch.global.bpm = flags.bpm
patch.clipMode = !!flags.clip

// ── Notes ───────────────────────────────────────────────────────────────────
let notes = [{ note: 48, t: 0.03, dur: 2, vel: 0.9 }]
if (flags.notes) {
  notes = flags.notes.split(',').map(tok => {
    const [note, t, dur, vel] = tok.trim().split(':').map(Number)
    return { note, t: t || 0, dur: dur || 1, vel: vel || 0.9 }
  })
}
if (flags.notesJson) notes = JSON.parse(readFileSync(flags.notesJson, 'utf8'))
const lastEnd = notes.reduce((m, n) => Math.max(m, n.t + n.dur), 0)
const seconds = flags.seconds ?? (flags.clip ? 8 : lastEnd + 2)

// ── Engine boot (mirrors ApolloEngine.renderToBuffer) ───────────────────────
const proc = new globalThis.__cls()
const post = m => proc.onMessage(m)

const ranges = {}
for (const pd of PARAMS) ranges[pd.path] = [pd.min, pd.max]
const collectFx = units => {
  for (const u of units || []) {
    ranges[`fx.${u.id}.mix`] = [0, 1]
    for (const pp of (FX_DEFS[u.type]?.params || [])) ranges[`fx.${u.id}.${pp.key}`] = [pp.min, pp.max]
    if (u.chains) u.chains.forEach(collectFx)
  }
}
collectFx(patch.fxMain); collectFx(patch.fxBus1); collectFx(patch.fxBus2)
post({ type: 'ranges', ranges })

// wavetables (factory or user)
for (const id of new Set(patch.oscs.map(o => o.wt.tableId))) {
  const user = patch.userTables?.[id]
  if (user) {
    const raw = Buffer.from(user.data, 'base64')
    const d = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)
    post({ type: 'table', id, frames: user.frames, data: new Float32Array(d), mips: buildTableMips(new Float32Array(d), user.frames) })
  } else {
    const t = generateFactoryTable(id)
    if (t) post({ type: 'table', id, frames: t.frames, data: t.data, mips: buildTableMips(t.data, t.frames) })
  }
}

// LFO + remap LUTs (replicates engine-client's lfoLutFromPoints)
function lutFromPoints(points, size = 257) {
  const lut = new Float32Array(size)
  const pts = points?.length ? [...points].sort((a, b) => a.x - b.x) : [{ x: 0, y: 0, curve: 0 }, { x: 1, y: 1, curve: 0 }]
  if (pts[0].x > 0) pts.unshift({ x: 0, y: pts[0].y, curve: 0 })
  if (pts[pts.length - 1].x < 1) pts.push({ x: 1, y: pts[pts.length - 1].y, curve: 0 })
  let seg = 0
  for (let i = 0; i < size; i++) {
    const x = i / (size - 1)
    while (seg < pts.length - 2 && x > pts[seg + 1].x) seg++
    const p0 = pts[seg], p1 = pts[seg + 1]
    const span = p1.x - p0.x
    let t = span > 1e-6 ? (x - p0.x) / span : 1
    const c = p0.curve || 0
    if (c !== 0) { const k = Math.pow(4, Math.abs(c) * 2); t = c > 0 ? Math.pow(t, k) : 1 - Math.pow(1 - t, k) }
    lut[i] = p0.y + (p1.y - p0.y) * t
  }
  return lut
}
patch.lfos.forEach((lfo, i) => post({ type: 'lfoLut', index: i, main: lutFromPoints(lfo.points), y: lfo.mode === 'path' ? lutFromPoints(lfo.pathPoints) : null }))
patch.oscs.forEach((osc, i) => { if (osc.wt.remapCurve?.length) post({ type: 'remapLut', key: `osc${i}`, lut: lutFromPoints(osc.wt.remapCurve) }) })
for (const row of patch.matrix) if (row.curve?.length) post({ type: 'remapLut', rowId: row.id, lut: lutFromPoints(row.curve) })

// ── Samples from disk (sample / granular / spectral / noise engines) ────────
function decodeWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAV')
  let pos = 12, fmt = null, data = null
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4)
    const size = buf.readUInt32LE(pos + 4)
    if (id === 'fmt ') fmt = { format: buf.readUInt16LE(pos + 8), channels: buf.readUInt16LE(pos + 10), sr: buf.readUInt32LE(pos + 12), bits: buf.readUInt16LE(pos + 22) }
    if (id === 'data') data = buf.subarray(pos + 8, pos + 8 + size)
    pos += 8 + size + (size & 1)
  }
  if (!fmt || !data) throw new Error('missing fmt/data chunk')
  const { channels, bits, sr, format } = fmt
  const bytesPer = bits / 8
  const frames = Math.floor(data.length / (bytesPer * channels))
  const chans = Array.from({ length: channels }, () => new Float32Array(frames))
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < channels; c++) {
      const o = (f * channels + c) * bytesPer
      let v
      if (format === 3 && bits === 32) v = data.readFloatLE(o)
      else if (bits === 16) v = data.readInt16LE(o) / 32768
      else if (bits === 24) v = ((data[o] | (data[o + 1] << 8) | (data[o + 2] << 16)) << 8 >> 8) / 8388608
      else if (bits === 32) v = data.readInt32LE(o) / 2147483648
      else throw new Error(`unsupported WAV: fmt ${format} / ${bits}-bit`)
      chans[c][f] = v
    }
  }
  return { sr, l: chans[0], r: chans[1] ?? null, len: frames }
}

const loadedSamples = new Set()
for (const spec of flags.sample) {
  const eq = spec.indexOf('=')
  if (eq < 0) { console.error('--sample expects id=path.wav:', spec); process.exit(2) }
  const id = spec.slice(0, eq), file = spec.slice(eq + 1)
  const wav = decodeWav(readFileSync(path.resolve(file)))
  post({ type: 'sample', id, sr: wav.sr, len: wav.len, l: wav.l, r: wav.r })
  loadedSamples.add(id)
  // spectral analysis when any osc uses this sample in the spectral engine
  if (patch.oscs.some(o => o.engine === 'spectral' && o.spec.sampleId === id)) {
    const { analyzeSpectral } = await import(new URL('../lib/apollo/spectral.ts', import.meta.url).href)
    const an = analyzeSpectral(wav.l, wav.sr)
    post({ type: 'spectral', id, frames: an.frames, bins: an.bins, hop: an.hop, sr: an.sr, mags: an.mags, phases: an.phases, onsets: an.onsets })
  }
}
// warn about referenced-but-missing samples (patch will render those oscs silent)
for (const o of patch.oscs) {
  for (const sid of [o.smp?.sampleId, o.gran?.sampleId, o.spec?.sampleId]) {
    if (sid && !loadedSamples.has(sid)) console.error(`⚠︎ sample "${sid}" referenced but not provided (--sample ${sid}=file.wav) — that oscillator will be silent`)
  }
}

post({ type: 'patch', patch })
if (flags.bpm || flags.clip) post({ type: 'transport', playing: !!flags.clip, bpm: patch.global.bpm })

// ── Render ──────────────────────────────────────────────────────────────────
const BLOCK = 128
const totalBlocks = Math.ceil(seconds * SR / BLOCK)
const events = flags.clip ? [] : notes.flatMap(n => [
  { t: n.t, type: 'on', note: n.note, vel: n.vel ?? 0.9 },
  { t: n.t + n.dur, type: 'off', note: n.note },
]).sort((a, b) => a.t - b.t)

const outL = new Float32Array(totalBlocks * BLOCK)
const outR = new Float32Array(totalBlocks * BLOCK)
let evIdx = 0
for (let b = 0; b < totalBlocks; b++) {
  const tNow = b * BLOCK / SR
  while (evIdx < events.length && events[evIdx].t <= tNow) {
    const ev = events[evIdx++]
    if (ev.type === 'on') proc.noteOn(ev.note, ev.vel, false)
    else proc.noteOff(ev.note, false)
  }
  const L = new Float32Array(BLOCK), R = new Float32Array(BLOCK)
  globalThis.currentTime = tNow
  proc.process([], [[L, R]])
  outL.set(L, b * BLOCK); outR.set(R, b * BLOCK)
}

// ── Analysis ("how does it sound" numbers) ──────────────────────────────────
let peak = 0, sumSq = 0, firstSound = -1, lastSound = -1
for (let i = 0; i < outL.length; i++) {
  const a = Math.max(Math.abs(outL[i]), Math.abs(outR[i]))
  if (a > peak) peak = a
  sumSq += outL[i] * outL[i]
  if (a > 0.002) { if (firstSound < 0) firstSound = i; lastSound = i }
}
const rms = Math.sqrt(sumSq / outL.length)
// spectral centroid over the loudest 8192-sample window (cheap DFT on 64 bands)
let centroid = 0
if (lastSound > 0) {
  const N = 8192
  const start = Math.max(0, Math.min(firstSound + 2048, outL.length - N))
  let num = 0, den = 0
  for (let band = 1; band <= 48; band++) {
    // log-spaced bands 40 Hz → 16 kHz, full-rate Goertzel (no decimation aliasing)
    const f = 40 * Math.pow(16000 / 40, (band - 1) / 47)
    const w = 2 * Math.PI * f / SR
    const coeff = 2 * Math.cos(w)
    let s0 = 0, s1 = 0, s2 = 0
    for (let i = 0; i < N; i++) { s0 = outL[start + i] + coeff * s1 - s2; s2 = s1; s1 = s0 }
    const mag = Math.sqrt(s1 * s1 + s2 * s2 - coeff * s1 * s2)
    num += f * mag; den += mag
  }
  centroid = den > 0 ? num / den : 0
}
const analysis = {
  seconds, notes: flags.clip ? 'clip' : notes.length,
  peak: +peak.toFixed(4), rmsDb: +(20 * Math.log10(rms || 1e-9)).toFixed(1),
  centroidHz: Math.round(centroid),
  soundStart: firstSound < 0 ? null : +(firstSound / SR).toFixed(3),
  soundEnd: lastSound < 0 ? null : +(lastSound / SR).toFixed(3),
  silent: firstSound < 0,
}

// ── WAV out ─────────────────────────────────────────────────────────────────
if (flags.out) {
  const frames = outL.length
  const buf = Buffer.alloc(44 + frames * 4)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + frames * 4, 4); buf.write('WAVE', 8)
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22)
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(frames * 4, 40)
  for (let i = 0; i < frames; i++) {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(outL[i] * 32767))), 44 + i * 4)
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(outR[i] * 32767))), 46 + i * 4)
  }
  writeFileSync(path.resolve(flags.out), buf)
  if (!flags.json) console.log(`wrote ${flags.out} (${seconds.toFixed(2)}s, peak ${analysis.peak}, rms ${analysis.rmsDb} dB)`)
}

if (flags.json || !flags.out) console.log(JSON.stringify(analysis, null, flags.json ? 0 : 2))
if (analysis.silent) process.exit(1)
