#!/usr/bin/env node
// Does rendering WITHOUT an AudioContext produce the same audio as rendering
// with one?
//
// lib/apollo/render-core.ts drives engine.js block by block so a combine can run
// in a Worker instead of freezing the main thread. That is only worth anything
// if the audio is identical, and "identical" is checkable here without a
// browser: apollo-render.mjs already drives the same engine the same way and is
// what every voice audit in this repo trusts.
//
// It does NOT compare sample by sample, and that is not a compromise — Apollo
// renders are deliberately not deterministic. Oscillator start phase is seeded
// from a global voice serial, so the same patch rendered twice in one session
// differs in phase; freeze-cache says as much ("the same project rendered three
// times gave peaks of 0.202, 0 and 0.0657"). Demanding bit-equality would be
// testing the seed, not the renderer.
//
// So it compares what a listener would notice: level, loudness, spectrum, and
// where the sound starts. A render that matches on all four is the same sound.
//
//   node --experimental-strip-types scripts/apollo-tests/render-core.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const T = mkdtempSync(join(tmpdir(), 'render-core-'))
const SR = 48000
let pass = 0, fail = 0
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ok   ${n}${d ? '  ' + d : ''}`) } else { fail++; console.log(`  FAIL ${n}${d ? '  ' + d : ''}`) } }

// engine.js registers itself against these globals, exactly as a worklet scope
// (or a Worker) provides them.
globalThis.sampleRate = SR
globalThis.currentTime = 0
globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage: () => {}, onmessage: null } } }
globalThis.registerProcessor = (_name, cls) => { globalThis.__cls = cls }
await import(new URL('../../public/apollo/engine.js', import.meta.url).href)
const Engine = globalThis.__cls

const { importTs } = await import(join(ROOT, 'scripts/lib/ts-import.mjs'))
const { renderJobs } = await importTs('lib/apollo/render-core.ts')
const { initPatch, PARAMS } = await importTs('lib/apollo/patch.ts')
const { generateFactoryTable } = await importTs('lib/apollo/tables.ts')
/** Minimal WAV reader, deliberately strict.
 *  A reader that guesses is worse than none: three hand-rolled ones in this repo
 *  assumed 16-bit against 24-bit stems and produced confident garbage that read
 *  as broken synthesis. This asserts the format it was given. */
function readWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAV')
  let pos = 12, fmt = null, data = null
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4)
    const size = buf.readUInt32LE(pos + 4)
    if (id === 'fmt ') fmt = { format: buf.readUInt16LE(pos + 8), channels: buf.readUInt16LE(pos + 10), sr: buf.readUInt32LE(pos + 12), bits: buf.readUInt16LE(pos + 22) }
    if (id === 'data') data = buf.subarray(pos + 8, pos + 8 + size)
    pos += 8 + size + (size & 1)
  }
  if (!fmt || !data) throw new Error('WAV missing fmt/data')
  if (fmt.channels !== 2) throw new Error(`expected stereo, got ${fmt.channels} channels`)
  if (fmt.bits !== 16 && fmt.bits !== 24) throw new Error(`unsupported WAV depth: ${fmt.bits}-bit`)
  const bytes = fmt.bits / 8, stride = bytes * 2
  const frames = Math.floor(data.length / stride)
  const l = new Float32Array(frames), r = new Float32Array(frames)
  const read = o => fmt.bits === 16
    ? data.readInt16LE(o) / 32768
    : (((data[o] | (data[o + 1] << 8) | (data[o + 2] << 16)) << 8) >> 8) / 8388608
  for (let f = 0; f < frames; f++) { l[f] = read(f * stride); r[f] = read(f * stride + bytes) }
  return { sr: fmt.sr, bits: fmt.bits, l, r }
}

/** The same setup messages engine-client sends before a render. */
function messagesFor(patch, notes) {
  const msgs = []
  const ranges = {}
  for (const p of PARAMS) ranges[p.path] = [p.min, p.max]
  msgs.push({ type: 'ranges', ranges })
  for (const id of new Set(patch.oscs.map(o => o.wt.tableId))) {
    const t = generateFactoryTable(id)
    if (t) msgs.push({ type: 'table', id, frames: t.frames, data: t.data, mips: t.mips })
  }
  msgs.push({ type: 'patch', patch })
  const events = []
  for (const n of notes) {
    events.push({ t: n.t, type: 'noteOn', note: n.note, vel: n.vel })
    events.push({ t: n.t + n.dur, type: 'noteOff', note: n.note })
  }
  msgs.push({ type: 'schedule', events })
  return msgs
}

function viaApolloRender(patch, notes, seconds) {
  const pf = join(T, 'p.json'), nf = join(T, 'n.json'), wf = join(T, 'a.wav')
  writeFileSync(pf, JSON.stringify(patch))
  writeFileSync(nf, JSON.stringify(notes))
  execFileSync('node', ['--experimental-strip-types', join(ROOT, 'scripts/apollo-render.mjs'),
    '--patch', pf, '--notes-json', nf, '--seconds', String(seconds), '--out', wf, '--json'],
    { cwd: ROOT, stdio: 'pipe' })
  const w = readWav(readFileSync(wf))
  return [w.l, w.r]
}

function viaRenderCore(patch, notes, seconds) {
  const frames = Math.ceil(seconds * SR)
  return renderJobs(Engine, [{ messages: messagesFor(patch, notes) }], frames, SR,
    t => { globalThis.currentTime = t })
}

/** Peak, RMS, spectral centroid and onset — the things a listener notices. */
function describe(ch) {
  const n = ch[0].length
  let peak = 0, sum = 0, onset = -1
  for (let c = 0; c < 2; c++) {
    for (let i = 0; i < n; i++) {
      const v = Math.abs(ch[c][i])
      if (v > peak) peak = v
      sum += ch[c][i] * ch[c][i]
    }
  }
  for (let i = 0; i < n; i++) if (Math.abs(ch[0][i]) > peak * 0.02) { onset = i; break }
  // Centroid from a plain DFT over a window inside the sound. Coarse on purpose:
  // this is asking "is it the same colour", not measuring a hat.
  const start = Math.max(0, onset), N = Math.min(8192, n - start)
  let num = 0, den = 0
  for (let k = 1; k < 200; k++) {
    const f = k * (SR / 8192)
    const w = 2 * Math.PI * f / SR
    let re = 0, im = 0
    for (let i = 0; i < N; i++) { re += ch[0][start + i] * Math.cos(w * i); im += ch[0][start + i] * Math.sin(w * i) }
    const mag = Math.hypot(re, im)
    num += f * mag; den += mag
  }
  return { peak, rms: Math.sqrt(sum / (2 * n)), onset: onset / SR, centroid: den > 0 ? num / den : 0 }
}

function compare(name, a, b) {
  const A = describe(a), B = describe(b)
  const dPeak = Math.abs(A.peak - B.peak) / Math.max(1e-9, A.peak)
  const dRms = Math.abs(20 * Math.log10((B.rms + 1e-12) / (A.rms + 1e-12)))
  const dCent = Math.abs(A.centroid - B.centroid) / Math.max(1, A.centroid)
  const dOnset = Math.abs(A.onset - B.onset)
  // One block is 2.7 ms and the scheduled path fires a note a block before the
  // hand-driven one, so onset is allowed two blocks, not zero.
  const good = A.peak > 0.001 && dPeak < 0.05 && dRms < 0.5 && dCent < 0.10 && dOnset < 0.006
  ok(name, good,
    `peak ${(dPeak * 100).toFixed(1)}%, loudness ${dRms.toFixed(2)}dB, ` +
    `centroid ${(dCent * 100).toFixed(1)}%, onset ${(dOnset * 1000).toFixed(1)}ms`)
}

console.log('\nrendering the same thing with and without an AudioContext')
{
  const p = initPatch()
  p.oscs[0].enabled = true; p.oscs[0].level = 0.9
  p.oscs[1].enabled = false; p.oscs[2].enabled = false
  Object.assign(p.envs[0], { attack: 0.005, decay: 0.4, sustain: 0.6, release: 0.4 })
  Object.assign(p.filters[0], { enabled: true, type: 'lp12', cutoff: 0.7, res: 0.2, drive: 0.2 })
  const notes = [{ note: 48, t: 0.02, dur: 0.9, vel: 0.9 }, { note: 55, t: 0.5, dur: 0.9, vel: 0.8 }]
  compare('a filtered two-note patch matches', viaApolloRender(p, notes, 2.0), viaRenderCore(p, notes, 2.0))
}
{
  // Two oscillators, a sub and a glide — everything except unison, which is
  // deliberately excluded here and measured on its own below.
  const p = initPatch()
  p.global.mode = 'legato'; p.global.glide = 0.2
  p.oscs[0].enabled = true; p.oscs[0].level = 0.8
  p.oscs[1].enabled = true; p.oscs[1].semi = 7; p.oscs[1].level = 0.5
  p.oscs[2].enabled = false
  p.sub.enabled = true
  const notes = [{ note: 40, t: 0.02, dur: 1.2, vel: 0.95 }, { note: 47, t: 1.0, dur: 1.2, vel: 0.9 }]
  compare('two oscillators, sub and glide match', viaApolloRender(p, notes, 2.6), viaRenderCore(p, notes, 2.6))
}

// ── What a combine cannot promise ───────────────────────────────────────────
//
// A UNISON patch does not render the same way twice, and this is not a fault in
// any renderer — Apollo randomises each unison voice's start phase from a global
// voice serial, so five detuned voices sum differently every time. Measured over
// five renders of one job in one process: peaks 0.809, 0.602, 0.884, 0.716,
// 0.588. A 50% spread in peak, 33% in RMS.
//
// It matters because a COMBINE REPLACES LIVE PLAYBACK. The cached buffer can sit
// 3 dB away from what the same notes sound like played live, so a clip can
// audibly change level the moment its render lands. freeze-cache attributes
// variance like this to resource exhaustion and message races; at least this
// much of it is the seed.
//
// That was true until the seed was fixed — the phase rng now takes the note and
// nothing else, so the SAME clip renders the SAME way every time while unison
// voices still differ from each other. This asserts the property we now have,
// because it is the thing the combine cache depends on.
console.log('\nrenders are reproducible (this is what the cache depends on)')
{
  const p = initPatch()
  p.oscs[0].enabled = true; p.oscs[0].unison = 5; p.oscs[0].detune = 0.06; p.oscs[0].level = 0.8
  p.oscs[1].enabled = false; p.oscs[2].enabled = false
  const notes = [{ note: 40, t: 0.02, dur: 1.2, vel: 0.95 }]
  const peaks = []
  for (let i = 0; i < 4; i++) {
    const ch = viaRenderCore(p, notes, 2.0)
    let peak = 0
    for (const v of ch[0]) peak = Math.max(peak, Math.abs(v))
    peaks.push(peak)
  }
  const spread = (Math.max(...peaks) - Math.min(...peaks)) / Math.min(...peaks)
  ok('a unison patch renders identically every time', spread < 1e-6,
    `peaks ${peaks.map(x => x.toFixed(3)).join(' ')} (${(spread * 100).toFixed(1)}% spread)`)
  ok('a patch WITHOUT unison is reproducible', (() => {
    const q = initPatch()
    q.oscs[0].enabled = true; q.oscs[0].level = 0.8
    q.oscs[1].enabled = false; q.oscs[2].enabled = false
    const a = viaRenderCore(q, notes, 1.5), b = viaRenderCore(q, notes, 1.5)
    let worst = 0
    for (let i = 0; i < a[0].length; i++) worst = Math.max(worst, Math.abs(a[0][i] - b[0][i]))
    return worst < 1e-9
  })())
}

console.log('\nrendering several jobs at once (what a combine actually does)')
{
  const mk = (semi, note) => {
    const p = initPatch()
    p.oscs[0].enabled = true; p.oscs[0].semi = semi; p.oscs[0].level = 0.8
    p.oscs[1].enabled = false; p.oscs[2].enabled = false
    return { patch: p, notes: [{ note, t: 0.02, dur: 0.8, vel: 0.9 }] }
  }
  const items = [mk(0, 48), mk(3, 52), mk(7, 55)]
  const frames = Math.ceil(1.5 * SR)
  const chans = renderJobs(Engine, items.map(i => ({ messages: messagesFor(i.patch, i.notes) })),
    frames, SR, t => { globalThis.currentTime = t })
  ok('one pair of channels per job', chans.length === items.length * 2, `${chans.length} channels`)
  let allSound = true
  for (let j = 0; j < items.length; j++) {
    let peak = 0
    for (const v of chans[j * 2]) peak = Math.max(peak, Math.abs(v))
    if (peak < 0.001) allSound = false
  }
  ok('every job produced sound', allSound)
  // Rendered together, each job must still be the SOUND it is alone. Not the
  // same samples — phase seeding moves with the voice serial, so a job rendered
  // second is legitimately a different phase — but the same level and colour.
  // Bleed between jobs would show up here as a level that does not match.
  for (let j = 0; j < items.length; j++) {
    const solo = viaRenderCore(items[j].patch, items[j].notes, 1.5)
    compare(`job ${j + 1} sounds the same alone as in the batch`,
      solo, [chans[j * 2], chans[j * 2 + 1]])
  }
}

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
