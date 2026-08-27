#!/usr/bin/env node --experimental-strip-types
// Render a whole .cfproj to audio in plain Node — no browser, no dev server, no
// real time.
//
// WHY THIS EXISTS
// The only way to hear a song used to be a Playwright browser bouncing it in
// real time: about 2m20s for a two-minute track, plus a dev server on whichever
// port it happened to be on that day, plus the sample-seeding race that has
// silently dropped an instrument more than once. Verifying seven tracks one at a
// time took seventeen minutes, so in practice it was never done, and mixes were
// judged from a single number computed over the whole song.
//
// Every note in these songs is an Apollo patch, and Apollo's real worklet
// already runs in Node (scripts/apollo-render.mjs). What was missing was the
// rest of the path: the effect bars, the track gain and pan, the master bus.
// scripts/lib/offline-dsp.mjs is that path, written against the same formulas
// daw-engine builds in Web Audio. The result is the same song in ~10 seconds,
// with every stem written out, on a machine with nothing running.
//
// WHAT IT IS NOT
// It is not the product's renderer, and it must never be treated as the final
// word on how something sounds. Two things are approximations rather than
// transcriptions — the master compressor, and waveshaping without oversampling
// — and `scripts/render-parity.mjs` measures the gap against a real browser
// bounce so the size of the lie is a known number rather than a hope.
//
// IT REFUSES TO LIE ABOUT SILENCE
// The recurring bug in this project's history is a track that silently fails to
// sound, and then measures as *better* because the mix got more dynamic. So
// every track's peak and RMS is reported, anything that came back silent is
// called out as a FAILURE, and any track this renderer cannot handle (a sampled
// preset, an audio clip) is refused loudly rather than skipped quietly.
//
// Usage:
//   node --experimental-strip-types scripts/song-render.mjs <song.cfproj>
//     --out=<dir>        output directory (default: alongside the cfproj)
//     --stems            also write one wav per track
//     --bars=8:24        render only these bars (fast iteration on one section)
//     --seconds=N        cap the length
//     --no-master        skip the master compressor (raw sum)
//     --json             print the stats as JSON only
//     --jobs=N           parallel track renders (default: cores - 1)

import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join, dirname, basename, resolve } from 'node:path'
import { tmpdir, cpus } from 'node:os'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import {
  Biquad, Compressor, Delay, clamp, panStereo, distCurve, crushCurve, shape,
  reverbIR, normalizeIR, convolve, readWav, writeWav24,
} from './lib/offline-dsp.mjs'
import { importTs } from './lib/ts-import.mjs'

const run = promisify(execFile)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SR = 48000            // Apollo renders at 48k; the whole path stays there
const CONTROL = 64          // samples between coefficient updates

const { FX_FIELDS } = await importTs('lib/roll-fx.ts')
const { barParamValue, activeBarFields } = await importTs('lib/effect-bar.ts')
const { sampleAutomation } = await importTs('lib/clip-effect-utils.ts')
const FIELD = Object.fromEntries(FX_FIELDS.map(f => [f.key, f]))

// ── Arguments ───────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const file = argv.find(a => !a.startsWith('--'))
const flag = (n, d = null) => {
  const a = argv.find(x => x === `--${n}` || x.startsWith(`--${n}=`))
  if (!a) return d
  return a.includes('=') ? a.split('=').slice(1).join('=') : true
}
if (!file) {
  console.error('usage: song-render.mjs <song.cfproj> [--out=dir] [--stems] [--bars=A:B] [--seconds=N] [--no-master] [--json]')
  process.exit(2)
}
const asJson = !!flag('json')
const log = (...a) => { if (!asJson) console.log(...a) }

// ── The project ─────────────────────────────────────────────────────────────
const cf = JSON.parse(readFileSync(file, 'utf8'))
const dp = cf.dawProject ?? cf
if (!dp?.tracks) { console.error(`${file}: no dawProject.tracks — is this a .cfproj?`); process.exit(2) }

const bpm = dp.tempo || 120
const bpb = dp.timeSignatureNum || 4
const spb = 60 / bpm                                   // seconds per beat
const clipsOf = id => (dp.arrangementClips ?? []).filter(c => c.trackId === id)

let beat0 = 0
let beat1 = Math.max(0, ...(dp.arrangementClips ?? []).map(c => c.startBeat + c.durationBeats))
const barsArg = flag('bars')
if (typeof barsArg === 'string') {
  const [a, b] = barsArg.split(':').map(Number)
  beat0 = (a - 1) * bpb                                // bars are 1-based, as in the app
  beat1 = b * bpb
}
const tailSec = 2.5                                    // let reverb and releases ring out
let seconds = (beat1 - beat0) * spb + tailSec
const secArg = flag('seconds')
if (secArg) seconds = Math.min(seconds, Number(secArg))
const frames = Math.ceil(seconds * SR)

// ── What can actually be rendered ───────────────────────────────────────────
// Nothing here is allowed to be skipped in silence. A track this renderer cannot
// handle is a REFUSAL, not an omission, because a missing layer reads as a
// cleaner mix on every meter we have.
const soloed = dp.tracks.filter(t => t.solo)
const audible = (soloed.length ? soloed : dp.tracks).filter(t => !t.mute)
const problems = []
const renderable = []
for (const t of audible) {
  const clips = clipsOf(t.id).filter(c => c.startBeat < beat1 && c.startBeat + c.durationBeats > beat0)
  if (!clips.length) continue
  const audioClips = clips.filter(c => c.kind && c.kind !== 'midi')
  if (audioClips.length) problems.push(`${t.name}: ${audioClips.length} audio clip(s) — offline render is MIDI/Apollo only`)
  const sampled = clips.filter(c => c.presetId)
  if (sampled.length) { problems.push(`${t.name}: uses sampled preset ${sampled[0].presetId} — needs the browser renderer`); continue }
  const isDrum = t.instrument?.type === 'drum'
  if (!isDrum && t.instrument?.type !== 'apollo') { problems.push(`${t.name}: instrument type "${t.instrument?.type}" — offline render handles 'apollo' and 'drum'`); continue }
  const withFx = clips.filter(c => c.rollFx && Object.keys(c.rollFx).length)
  if (withFx.length) problems.push(`${t.name}: ${withFx.length} clip(s) carry rollFx — not applied offline`)
  if (t.effects?.length) problems.push(`${t.name}: ${t.effects.length} track effect(s) — not applied offline`)

  const notes = []
  const bends = []
  for (const c of clips.filter(c => !c.kind || c.kind === 'midi')) {
    // A drawn pitch curve (clip.pitchGraph) travels ONE note between pitches
    // instead of playing a note per pitch. It is normalised 0..1 over each
    // note's own length, v 0.5 = in tune, full height = +/-12 semitones - the
    // same contract the sampled path uses, so a curve drawn by hand in the
    // studio and one written by craft.glideLine behave identically.
    const pg = c.pitchGraph
    if (pg && pg.length >= 2) {
      const ns = (c.notes ?? [])
      if (ns.length > 1) {
        problems.push(`${t.name}: pitch curve on a clip with ${ns.length} notes - Apollo bends the whole ` +
          `track at once, so a per-note curve needs one note per clip (the curve is applied from the first note)`)
      }
      const n0 = ns[0]
      if (n0) {
        const at = c.startBeat + n0.startBeat
        const durSec = n0.durationBeats * spb
        // Dense enough that the biggest step in a fast move stays under a cent,
        // then thinned: a hold emits nothing, so a mostly-still line is cheap.
        const steps = Math.max(8, Math.min(20000, Math.ceil(durSec * 200)))
        const lut = sampleAutomation(pg, 1, steps)
        let last = null
        for (let i = 0; i < steps; i++) {
          const semis = +((lut[i] - 0.5) * 24).toFixed(4)
          if (last !== null && Math.abs(semis - last) < 0.005 && i < steps - 1) continue
          last = semis
          bends.push({ t: +((at - beat0) * spb + (i / (steps - 1)) * durSec).toFixed(5), semis })
        }
      }
    }
    for (const n of c.notes ?? []) {
      const at = c.startBeat + n.startBeat
      if (at >= beat1 || at + n.durationBeats <= beat0) continue
      notes.push({
        note: n.pitch,
        t: +((at - beat0) * spb).toFixed(5),
        dur: +(n.durationBeats * spb).toFixed(5),
        vel: +clamp((n.velocity ?? 90) / 127, 0.01, 1).toFixed(4),
      })
    }
  }
  if (!notes.length) continue
  notes.sort((a, b) => a.t - b.t)
  // A note starting before the window still needs to be heard from the window's
  // start — a two-bar pad chord is otherwise missing from every partial render.
  for (const n of notes) if (n.t < 0) { n.dur += n.t; n.t = 0 }
  renderable.push({ track: t, isDrum, notes: notes.filter(n => n.dur > 0.01), bends: bends.filter(b => b.t >= 0) })
}
if (!renderable.length) {
  console.error('Nothing to render.' + (problems.length ? '\n  ' + problems.join('\n  ') : ''))
  process.exit(1)
}

// ── Render every track through the real Apollo engine ───────────────────────
const tmp = mkdtempSync(join(tmpdir(), 'songrender-'))
const jobs = Number(flag('jobs')) || Math.max(1, cpus().length - 1)
log(`${dp.name ?? basename(file)} — ${bpm} BPM, ${renderable.length} track(s), ${seconds.toFixed(1)}s, ${jobs} jobs`)

// ── Sampled drums ───────────────────────────────────────────────────────────
// A drum track plays one-shot WAVs off disk (public/drum-kits/...), which is
// what the app does too — `sample.data` on a pad is a URL path, so a project
// referencing a kit stays small and both the app and this renderer resolve the
// same file.
//
// Worth doing rather than synthesising: our synthesised hi-hat measured a 2.9 kHz
// spectral centroid, where every real hat sample in the repo sits between 5.4 and
// 12.7 kHz. It was a midrange noise burst wearing a hat's rhythm.

const HAT_CHOKE_GROUP = 900
const GM_HAT = new Set([42, 44, 46])
const drumCache = new Map()

/** Windowed-sinc resample + pitch shift, cached per (file, semitones).
 *  Linear interpolation is tempting and wrong here: a hat keeps ALL of its
 *  energy between 8 and 16 kHz, which is exactly where cheap interpolation
 *  rolls off and aliases. */
function drumSample(urlPath, semis) {
  const key = `${urlPath}|${semis}`
  const hit = drumCache.get(key)
  if (hit) return hit
  const file = join(ROOT, 'public', urlPath.replace(/^\//, ''))
  if (!existsSync(file)) return null
  const w = readWav(readFileSync(file))
  const rate = Math.pow(2, (semis || 0) / 12)
  const step = (w.sr / SR) * rate
  const outLen = Math.max(1, Math.floor(w.frames / step))
  const A = 8
  const widen = Math.max(1, step)          // downsampling needs a wider kernel
  const out = [new Float32Array(outLen), new Float32Array(outLen)]
  const src = [w.l, w.r]
  for (let c = 0; c < 2; c++) {
    for (let i = 0; i < outLen; i++) {
      const pos = i * step
      const lo = Math.ceil(pos - A * widen), hi = Math.floor(pos + A * widen)
      let acc = 0, wsum = 0
      for (let k = lo; k <= hi; k++) {
        if (k < 0 || k >= w.frames) continue
        const x = (k - pos) / widen
        if (x === 0) { acc += src[c][k]; wsum += 1; continue }
        if (Math.abs(x) >= A) continue
        const px = Math.PI * x
        const wgt = (Math.sin(px) / px) * (Math.sin(px / A) / (px / A))
        acc += src[c][k] * wgt
        wsum += wgt
      }
      out[c][i] = wsum ? acc / wsum : 0
    }
  }
  drumCache.set(key, out)
  return out
}

function renderDrumTrack(entry) {
  const params = entry.track.instrument.params ?? {}
  const L = new Float32Array(frames), R = new Float32Array(frames)
  // Closed hat cuts open hat: work out each hit's cut point BEFORE writing any
  // of them, so a choked tail is never in the buffer to begin with.
  const byGroup = new Map()
  for (const n of entry.notes) {
    const pad = params.pads?.[n.note]
    const g = pad?.chokeGroup ?? (GM_HAT.has(n.note) ? HAT_CHOKE_GROUP : 0)
    if (!g) continue
    if (!byGroup.has(g)) byGroup.set(g, [])
    byGroup.get(g).push(n)
  }
  const cutAt = new Map()
  for (const list of byGroup.values()) {
    list.sort((a, b) => a.t - b.t)
    for (let i = 0; i < list.length - 1; i++) cutAt.set(list[i], list[i + 1].t)
  }

  let placed = 0
  for (const n of entry.notes) {
    const pad = params.pads?.[n.note]
    if (!pad) { problems.push(`${entry.track.name}: no pad for note ${n.note} — that hit is silent`); continue }
    if (pad.mute) continue
    if (!pad.sample?.data) { problems.push(`${entry.track.name}: pad ${n.note} has no sample (synth drum voices are not rendered offline)`); continue }
    const buf = drumSample(pad.sample.data, pad.pitch)
    if (!buf) { problems.push(`${entry.track.name}: sample missing on disk: ${pad.sample.data}`); continue }

    // The app only builds the pad gain/pan node when a pad differs from neutral,
    // so a pad sitting exactly at the 0.8 default plays at unity. Matched here
    // deliberately — parity with playback matters more than tidiness.
    const neutral = pad.volume === 0.8 && !pad.pan && !pad.pitch
    const padGain = neutral ? 1 : (pad.volume ?? 0.8)
    const gain = (n.vel ?? 0.7) * padGain
    const pan = pad.pan ?? 0
    const gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4)

    const start = Math.round(n.t * SR)
    let len = buf[0].length
    const cut = cutAt.get(n)
    if (cut != null) len = Math.min(len, Math.max(1, Math.round((cut - n.t) * SR)))
    const fade = Math.min(Math.round(0.005 * SR), Math.max(1, len >> 2))
    for (let i = 0; i < len; i++) {
      const o = start + i
      if (o < 0) continue
      if (o >= frames) break
      // only a CHOKED voice gets the fade; a hit ending naturally already has one
      const env = (cut != null && i > len - fade) ? (len - i) / fade : 1
      L[o] += buf[0][i] * gain * gl * env
      R[o] += buf[1][i] * gain * gr * env
    }
    placed++
  }
  if (!placed) problems.push(`${entry.track.name}: no drum hits were placed — the track is silent`)
  return { ...entry, l: L, r: R }
}

async function renderTrack(entry, i) {
  if (entry.isDrum) return renderDrumTrack(entry)
  const pf = join(tmp, `p${i}.json`), nf = join(tmp, `n${i}.json`), wf = join(tmp, `t${i}.wav`)
  writeFileSync(pf, JSON.stringify(entry.track.instrument.params))
  writeFileSync(nf, JSON.stringify(entry.notes))
  const args = ['--experimental-strip-types', join(ROOT, 'scripts/apollo-render.mjs'),
    '--patch', pf, '--notes-json', nf, '--seconds', String(seconds), '--bpm', String(bpm),
    '--out', wf, '--json']
  if (entry.bends?.length) {
    const bf = join(tmp, `b${i}.json`)
    writeFileSync(bf, JSON.stringify(entry.bends))
    args.push('--bend-json', bf)
  }
  await run('node', args, { cwd: ROOT, maxBuffer: 1 << 26 })
  const wav = readWav(readFileSync(wf))
  return { ...entry, l: wav.l, r: wav.r }
}

const t0 = Date.now()
const rendered = []
{
  let next = 0
  const workers = Array.from({ length: Math.min(jobs, renderable.length) }, async () => {
    for (;;) {
      const i = next++
      if (i >= renderable.length) return
      rendered[i] = await renderTrack(renderable[i], i)
    }
  })
  await Promise.all(workers)
}
const renderMs = Date.now() - t0

// ── Effect bars ─────────────────────────────────────────────────────────────
// Each ROW on a track is one chain running the whole length of the song. Inside
// a bar the parameter follows that bar's graph; outside every bar it sits at the
// field's neutral value. Building it this way (rather than one chain per bar)
// keeps filter state continuous, so a bar does not begin with a cold filter and
// a click, and it is how overlapping bars on separate rows compose.
function automationFor(bars, key) {
  const field = FIELD[key]
  const a = new Float32Array(frames).fill(field.neutral)
  for (const b of bars) {
    if (b.fx?.[key] === undefined) continue
    const s = Math.round((b.startBeat - beat0) * spb * SR)
    const e = Math.round((b.startBeat + b.durationBeats - beat0) * spb * SR)
    if (e <= 0 || s >= frames) continue
    const n = Math.max(4, Math.ceil((b.durationBeats * spb) * 60))   // same rate the DAW samples curves at
    const g = sampleAutomation(b.graph ?? [], b.durationBeats, n)
    for (let i = Math.max(0, s); i < Math.min(frames, e); i++) {
      const p = (i - s) / Math.max(1, e - s) * (n - 1)
      const k = Math.floor(p), f = p - k
      const gv = k >= n - 1 ? g[n - 1] : g[k] * (1 - f) + g[k + 1] * f
      a[i] = barParamValue(field, b.fx[key], gv)
    }
  }
  return a
}

/** Apply one row's chain, in the order daw-engine builds the nodes. */
function applyRow(L, R, bars) {
  const keys = new Set()
  for (const b of bars) for (const f of activeBarFields(b.fx)) keys.add(f.key)
  if (!keys.size) return
  const has = k => keys.has(k)
  const auto = {}
  for (const k of keys) if (FIELD[k]?.graph) auto[k] = automationFor(bars, k)
  const qFixed = bars.find(b => b.fx?.filterQ !== undefined)?.fx.filterQ ?? 0.8

  const unsupported = [...keys].filter(k => !['highpassHz', 'filterHz', 'filterQ', 'drive', 'distortion', 'bitcrush',
    'sub', 'bass', 'mid', 'treble', 'chorusDepth', 'tremoloDepth', 'autopanDepth',
    'width', 'gain', 'pan', 'reverbWet', 'reverbSize', 'delayWet', 'delayTime', 'delayFeedback'].includes(k))
  if (unsupported.length) problems.push(`effect bar field(s) not modelled offline: ${unsupported.join(', ')}`)

  // Filters, drive, EQ — sample by sample, coefficients on a control block.
  const hp = [new Biquad(), new Biquad()], lp = [new Biquad(), new Biquad()]
  const eq = { sub: [new Biquad(), new Biquad()], bass: [new Biquad(), new Biquad()], mid: [new Biquad(), new Biquad()], treble: [new Biquad(), new Biquad()] }
  const EQ_SPEC = { sub: ['lowshelf', 70], bass: ['lowshelf', 200], mid: ['peaking', 1000], treble: ['highshelf', 8000] }
  const driveCurves = new Map()
  const curveFor = (cache, v, make) => { const k = Math.round(v * 100); let c = cache.get(k); if (!c) { c = make(v); cache.set(k, c) } return c }
  // The full-on target each shaper's curve is built from (the loudest bar wins
  // when several set the same field on one row).
  const shaperTarget = {}
  for (const k of ['drive', 'distortion', 'bitcrush']) {
    shaperTarget[k] = Math.max(0, ...bars.map(b => b.fx?.[k] ?? 0))
  }

  for (let i = 0; i < frames; i++) {
    if (i % CONTROL === 0) {
      if (has('highpassHz')) for (const f of hp) f.set('highpass', auto.highpassHz[i], SR, qFixed)
      if (has('filterHz')) for (const f of lp) f.set('lowpass', auto.filterHz[i], SR, qFixed)
      for (const k of ['sub', 'bass', 'mid', 'treble']) {
        if (!has(k)) continue
        const [type, hz] = EQ_SPEC[k]
        for (const f of eq[k]) f.set(type, hz, SR, 1, auto[k][i])
      }
    }
    let l = L[i], r = R[i]
    if (has('highpassHz')) { l = hp[0].process(l); r = hp[1].process(r) }
    if (has('filterHz')) { l = lp[0].process(l); r = lp[1].process(r) }
    // drive/distortion/bitcrush crossfade clean↔shaped by the GRAPH, not by the
    // parameter value: the app builds one curve from the bar's full-on target
    // and fades between dry and that curve. Since these fields are linear from a
    // neutral of 0, the graph position is recoverable as value/target.
    for (const [key, mk, scale] of [['drive', distCurve, 0.5], ['distortion', distCurve, 1], ['bitcrush', crushCurve, 1]]) {
      if (!has(key)) continue
      const target = shaperTarget[key]
      const g = clamp(auto[key][i] / Math.max(1e-6, target), 0, 1)
      if (g <= 1e-4) continue
      const c = curveFor(driveCurves, target * scale, mk)
      l = l * (1 - g) + shape(c, l) * g
      r = r * (1 - g) + shape(c, r) * g
    }
    for (const k of ['sub', 'bass', 'mid', 'treble']) {
      if (!has(k)) continue
      l = eq[k][0].process(l); r = eq[k][1].process(r)
    }
    L[i] = l; R[i] = r
  }

  // Chorus — one modulated delay, wet faded in by the graph (daw-engine's shape).
  if (has('chorusDepth')) {
    const dl = [new Delay(0.06, SR), new Delay(0.06, SR)]
    for (let i = 0; i < frames; i++) {
      const lfo = Math.sin(2 * Math.PI * 0.8 * i / SR)
      const d = 0.02 + 0.006 * lfo
      const w = auto.chorusDepth[i] * 0.6
      L[i] += dl[0].tick(L[i], d) * w
      R[i] += dl[1].tick(R[i], d) * w
    }
  }
  if (has('tremoloDepth')) {
    const rate = bars.find(b => b.fx?.tremoloRate !== undefined)?.fx.tremoloRate ?? 5
    for (let i = 0; i < frames; i++) {
      const d = auto.tremoloDepth[i] * 0.5
      const g = 1 - d + d * Math.sin(2 * Math.PI * rate * i / SR)
      L[i] *= g; R[i] *= g
    }
  }
  if (has('autopanDepth')) {
    const rate = bars.find(b => b.fx?.autopanRate !== undefined)?.fx.autopanRate ?? 2
    for (let i = 0; i < frames; i++) {
      const p = Math.min(1, auto.autopanDepth[i]) * Math.sin(2 * Math.PI * rate * i / SR)
      const [l, r] = panStereo(L[i], R[i], p); L[i] = l; R[i] = r
    }
  }
  if (has('width')) {
    for (let i = 0; i < frames; i++) {
      const w = auto.width[i]
      const mid = (L[i] + R[i]) * 0.5, side = (L[i] - R[i]) * 0.5 * w
      L[i] = mid + side; R[i] = mid - side
    }
  }
  if (has('gain')) for (let i = 0; i < frames; i++) { L[i] *= auto.gain[i]; R[i] *= auto.gain[i] }
  if (has('pan')) for (let i = 0; i < frames; i++) { const [l, r] = panStereo(L[i], R[i], auto.pan[i]); L[i] = l; R[i] = r }

  // Reverb: dry stays at unity and the wet convolution is faded in — the same
  // wiring as the app, where only the wet gain is automated.
  if (has('reverbWet')) {
    const size = bars.find(b => b.fx?.reverbSize !== undefined)?.fx.reverbSize ?? 0.4
    const ir = normalizeIR(reverbIR(0.6 + size * 3.4, SR), SR)
    const wl = convolve(L, ir.l), wr = convolve(R, ir.r)
    for (let i = 0; i < frames; i++) { const w = auto.reverbWet[i]; L[i] += wl[i] * w; R[i] += wr[i] * w }
  }
  if (has('delayWet')) {
    const time = bars.find(b => b.fx?.delayTime !== undefined)?.fx.delayTime ?? 0.25
    const fb = Math.min(0.9, bars.find(b => b.fx?.delayFeedback !== undefined)?.fx.delayFeedback ?? 0.3)
    const dl = [new Delay(1.2, SR), new Delay(1.2, SR)]
    let fl = 0, fr = 0
    for (let i = 0; i < frames; i++) {
      const el = dl[0].tick(L[i] + fl * fb, time)
      const er = dl[1].tick(R[i] + fr * fb, time)
      fl = el; fr = er
      const w = auto.delayWet[i]
      L[i] += el * w; R[i] += er * w
    }
  }
}

// ── Mix ─────────────────────────────────────────────────────────────────────
const mixL = new Float32Array(frames), mixR = new Float32Array(frames)
const stats = []
for (const entry of rendered) {
  const t = entry.track
  const L = new Float32Array(frames), R = new Float32Array(frames)
  L.set(entry.l.subarray(0, frames)); R.set(entry.r.subarray(0, frames))

  const bars = (dp.clipEffects ?? []).filter(b => b.trackId === t.id)
  const rows = [...new Set(bars.map(b => b.row ?? 0))].sort((a, b) => a - b)
  for (const row of rows) applyRow(L, R, bars.filter(b => (b.row ?? 0) === row))

  const vol = t.volume ?? 0.8
  let peak = 0, sum = 0
  for (let i = 0; i < frames; i++) {
    const [l, r] = panStereo(L[i] * vol, R[i] * vol, t.pan ?? 0)
    L[i] = l; R[i] = r
    mixL[i] += l; mixR[i] += r
    const a = Math.max(Math.abs(l), Math.abs(r))
    if (a > peak) peak = a
    sum += l * l + r * r
  }
  const rms = Math.sqrt(sum / (frames * 2))
  stats.push({
    track: t.name, notes: entry.notes.length, bars: bars.length,
    peak: +peak.toFixed(4),
    rmsDb: +(20 * Math.log10(Math.max(1e-9, rms))).toFixed(1),
    silent: peak < 0.0005,
    L, R,
  })
}

// ── Master bus ──────────────────────────────────────────────────────────────
const masterVol = dp.masterVolume ?? 0.85
const comp = new Compressor({ sr: SR })
const useComp = !flag('no-master')
let mPeak = 0, mSum = 0, clipped = 0
for (let i = 0; i < frames; i++) {
  let l = mixL[i] * masterVol, r = mixR[i] * masterVol
  if (useComp) [l, r] = comp.process(l, r)
  mixL[i] = l; mixR[i] = r
  const a = Math.max(Math.abs(l), Math.abs(r))
  if (a > mPeak) mPeak = a
  if (a >= 1) clipped++
  mSum += l * l + r * r
}
const mRms = Math.sqrt(mSum / (frames * 2))

// ── Write ───────────────────────────────────────────────────────────────────
const outDir = (typeof flag('out') === 'string' ? flag('out') : null) ?? dirname(resolve(file))
mkdirSync(outDir, { recursive: true })
const stem = basename(file).replace(/\.cfproj$/i, '')
const mixPath = join(outDir, `${stem}.offline.wav`)
writeFileSync(mixPath, writeWav24(mixL, mixR, SR))
const stemPaths = {}
if (flag('stems')) {
  const dir = join(outDir, `${stem}.stems`)
  mkdirSync(dir, { recursive: true })
  for (const s of stats) {
    const p = join(dir, `${s.track.replace(/[^\w -]/g, '_')}.wav`)
    writeFileSync(p, writeWav24(s.L, s.R, SR))
    stemPaths[s.track] = p
  }
}
rmSync(tmp, { recursive: true, force: true })

const silent = stats.filter(s => s.silent)
const report = {
  song: dp.name ?? stem, bpm, seconds: +seconds.toFixed(2), sampleRate: SR,
  renderMs, wallMs: Date.now() - t0,
  realtimeFactor: +(seconds * 1000 / (Date.now() - t0)).toFixed(1),
  masterVolume: masterVol, masterCompressor: useComp,
  peak: +mPeak.toFixed(4),
  peakDb: +(20 * Math.log10(Math.max(1e-9, mPeak))).toFixed(2),
  rmsDb: +(20 * Math.log10(Math.max(1e-9, mRms))).toFixed(1),
  crestDb: +(20 * Math.log10(Math.max(1e-9, mPeak / Math.max(1e-9, mRms)))).toFixed(1),
  clippedSamples: clipped,
  mix: mixPath,
  stems: stemPaths,
  tracks: stats.map(({ L, R, ...s }) => s),
  refused: problems,
  ok: silent.length === 0 && problems.length === 0,
}
if (asJson) { console.log(JSON.stringify(report, null, 2)); process.exit(report.ok ? 0 : 1) }

log('')
log('track            notes  bars     peak      rms')
log('─'.repeat(50))
for (const s of report.tracks) {
  log(`${s.track.padEnd(16)}${String(s.notes).padStart(5)}${String(s.bars).padStart(6)}` +
      `${String(s.peak).padStart(9)}${String(s.rmsDb).padStart(9)}dB${s.silent ? '   ** SILENT **' : ''}`)
}
log('─'.repeat(50))
log(`mix              peak ${report.peakDb} dBFS   rms ${report.rmsDb} dB   crest ${report.crestDb} dB` +
    (clipped ? `   ${clipped} clipped samples` : ''))
log(`${report.seconds}s of audio in ${(report.wallMs / 1000).toFixed(1)}s  (${report.realtimeFactor}x real time)`)
log(`→ ${mixPath}`)
if (Object.keys(stemPaths).length) log(`→ ${Object.keys(stemPaths).length} stems in ${stem}.stems/`)
if (silent.length) log(`\n** ${silent.length} track(s) came back SILENT: ${silent.map(s => s.track).join(', ')}`)
if (problems.length) { log('\nNOT rendered (needs the browser path):'); for (const p of problems) log(`  · ${p}`) }
process.exit(report.ok ? 0 : 1)
