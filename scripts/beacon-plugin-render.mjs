#!/usr/bin/env node
// ============================================================================
//  Render a Beacon plugin to a WAV file without a browser.
//
//    node scripts/beacon-plugin-render.mjs <plugin-id-or-folder> [options]
//
//      --notes 60,64,67     notes to play (default a C major triad)
//      --seconds 3          length
//      --hold 1.5           how long the notes are held
//      --preset "Hard Lead" apply a named preset from the manifest
//      --set cutoff=800     override a parameter (repeatable)
//      --out file.wav       output path
//      --sr 48000           sample rate
//
//  It stubs the AudioWorkletGlobalScope, so it exercises the real processor
//  code path including absolute-time scheduling. If a plugin sounds wrong in
//  Beacon, render it here first: it is the same code with none of the browser.
// ============================================================================

import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const args = process.argv.slice(2)
if (args.length === 0) {
  console.error('usage: node scripts/beacon-plugin-render.mjs <plugin-id-or-folder> [options]')
  process.exit(1)
}

function flag(name, fallback) {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
function flags(name) {
  const out = []
  for (let i = 0; i < args.length; i++) if (args[i] === `--${name}` && args[i + 1]) out.push(args[i + 1])
  return out
}

const target = args[0]
const sampleRate = Number(flag('sr', 48000))
const seconds = Number(flag('seconds', 3))
const hold = Number(flag('hold', Math.max(0.2, seconds - 1.2)))
const notes = flag('notes', '60,64,67').split(',').map(s => Number(s.trim())).filter(Number.isFinite)
const presetName = flag('preset', null)
const outPath = flag('out', null)
const rawPath = flag('raw', null)   // interleaved float32, for parity checks

// ---------------------------------------------------------------- locate ---

const folder = existsSync(target)
  ? target
  : path.join(process.cwd(), 'public', 'plugins', target)

const manifestPath = path.join(folder, 'beacon-plugin.json')
if (!existsSync(manifestPath)) {
  console.error(`No beacon-plugin.json in ${folder}`)
  process.exit(1)
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const processorPath = path.join(folder, manifest.processor)

if (manifest.wasm) {
  console.error(
    'This plugin uses WASM. The renderer can load it, but the processor must accept\n' +
    'the bytes from the init message (it cannot fetch inside a worklet).',
  )
}

// ------------------------------------------------------- worklet sandbox ---

let registered = null
let blockTime = 0

const sandbox = {
  sampleRate,
  get currentTime() { return blockTime },
  get currentFrame() { return Math.round(blockTime * sampleRate) },
  registerProcessor(name, ctor) { registered = { name, ctor } },
  console,
  Math, Float32Array, Float64Array, Int32Array, Uint8Array, ArrayBuffer,
  WebAssembly, TextDecoder, TextEncoder, Date, JSON, Object, Array, Number, String,
  isFinite, isNaN, parseFloat, parseInt, Error, Map, Set, Promise, Symbol,
}
sandbox.globalThis = sandbox

// The minimum of the real base class: a port with two ends.
class MessagePortStub {
  constructor() { this.onmessage = null; this._peer = null }
  postMessage(data) {
    const peer = this._peer
    if (peer && typeof peer.onmessage === 'function') {
      queueMicrotask(() => peer.onmessage({ data }))
    }
  }
}
const hostPort = new MessagePortStub()
const workletPort = new MessagePortStub()
hostPort._peer = workletPort
workletPort._peer = hostPort

sandbox.AudioWorkletProcessor = class {
  constructor() { this.port = workletPort }
}

vm.createContext(sandbox)
vm.runInContext(await readFile(processorPath, 'utf8'), sandbox, { filename: processorPath })

if (!registered) {
  console.error(`${manifest.processor} never called registerProcessor().`)
  process.exit(1)
}
if (registered.name !== manifest.processorName) {
  console.error(
    `The manifest says processorName "${manifest.processorName}" but the code registered ` +
    `"${registered.name}". Beacon looks it up by the manifest name, so it would fail to load.`,
  )
  process.exit(1)
}

// ------------------------------------------------------------ parameters ---

const values = {}
for (const p of manifest.parameters) values[p.id] = p.default

if (presetName) {
  const preset = (manifest.presets ?? []).find(p => p.name.toLowerCase() === presetName.toLowerCase())
  if (!preset) {
    console.error(`No preset called "${presetName}". Available: ` +
      (manifest.presets ?? []).map(p => p.name).join(', '))
    process.exit(1)
  }
  Object.assign(values, preset.values)
}

for (const pair of flags('set')) {
  const [id, raw] = pair.split('=')
  if (!(id in values)) { console.error(`Unknown parameter "${id}"`); process.exit(1) }
  values[id] = raw === 'true' ? true : raw === 'false' ? false : Number(raw)
}

// --------------------------------------------------------------- render ---

const node = new registered.ctor()

let ready = false
hostPort.onmessage = ({ data }) => {
  if (data.type === 'ready') ready = true
  else if (data.type === 'error') console.error('plugin error:', data.message)
}

const wasmBinary = manifest.wasm
  ? (await readFile(path.join(folder, manifest.wasm))).buffer
  : undefined

hostPort.postMessage({ type: 'init', sampleRate, values, ...(wasmBinary ? { wasmBinary } : {}) })

// Let the init microtask and any wasm compilation settle.
for (let i = 0; i < 200 && !ready; i++) await new Promise(r => setTimeout(r, 10))
if (!ready) {
  console.error('The plugin never posted "ready". It would hang in Beacon too.')
  process.exit(1)
}

hostPort.postMessage({ type: 'transport', bpm: 120, playing: true })

for (const note of notes) {
  hostPort.postMessage({ type: 'note', on: true, pitch: note, velocity: 0.85, time: 0.25, duration: hold })
  hostPort.postMessage({ type: 'note', on: false, pitch: note, velocity: 0, time: 0.25 + hold })
}
await new Promise(r => setTimeout(r, 10))

const BLOCK = 128
const total = Math.ceil(seconds * sampleRate)
const outL = new Float32Array(total)
const outR = new Float32Array(total)
const channels = (manifest.outputs ?? 2) === 1 ? 1 : 2
const buf = [new Float32Array(BLOCK), new Float32Array(BLOCK)].slice(0, channels)

let written = 0
while (written < total) {
  blockTime = written / sampleRate
  for (const c of buf) c.fill(0)

  const keepGoing = node.process([], [buf], {})
  if (keepGoing === false) { console.error('process() returned false and the node would be destroyed.'); break }

  const n = Math.min(BLOCK, total - written)
  outL.set(buf[0].subarray(0, n), written)
  outR.set((channels > 1 ? buf[1] : buf[0]).subarray(0, n), written)
  written += n
}

// ----------------------------------------------------------------- stats ---

let peak = 0
let sumSq = 0
let nonZero = 0
for (let i = 0; i < total; i++) {
  const a = Math.abs(outL[i])
  if (a > peak) peak = a
  if (a > 1e-5) nonZero++
  sumSq += outL[i] * outL[i]
}
const rms = Math.sqrt(sumSq / total)

console.log(`\n  ${manifest.name} ${manifest.version}  (${manifest.vendor})`)
console.log(`  notes    ${notes.join(', ')}`)
if (presetName) console.log(`  preset   ${presetName}`)
console.log(`  peak     ${peak.toFixed(4)}  (${(20 * Math.log10(Math.max(1e-9, peak))).toFixed(1)} dBFS)`)
console.log(`  rms      ${rms.toFixed(4)}`)
console.log(`  audible  ${((nonZero / total) * 100).toFixed(1)}% of the render`)

if (peak === 0) {
  console.error('\n  SILENT. The plugin produced nothing.\n')
  process.exit(1)
}
if (!Number.isFinite(peak)) {
  console.error('\n  The output contains NaN or Infinity.\n')
  process.exit(1)
}

// ------------------------------------------------------------------ wav ---

if (outPath) {
  const bytes = total * 2 * 2
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + bytes, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(2, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 4, 28)
  header.writeUInt16LE(4, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(bytes, 40)

  const pcm = Buffer.alloc(bytes)
  for (let i = 0; i < total; i++) {
    const l = Math.max(-1, Math.min(1, outL[i]))
    const r = Math.max(-1, Math.min(1, outR[i]))
    pcm.writeInt16LE((l * 32767) | 0, i * 4)
    pcm.writeInt16LE((r * 32767) | 0, i * 4 + 2)
  }
  await writeFile(outPath, Buffer.concat([header, pcm]))
  console.log(`  wrote    ${outPath}`)
}

if (rawPath) {
  const inter = new Float32Array(total * 2)
  for (let i = 0; i < total; i++) { inter[i * 2] = outL[i]; inter[i * 2 + 1] = outR[i] }
  await writeFile(rawPath, Buffer.from(inter.buffer))
  console.log(`  raw      ${rawPath}`)
}

console.log()
