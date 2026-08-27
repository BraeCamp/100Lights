#!/usr/bin/env node --experimental-strip-types
// One command to hear a song.
//
//   node --experimental-strip-types scripts/listen.mjs <song.cfproj>
//
// Before this there were nine tools: check-notes, check-tuning, analyze-harmony,
// analyze-arrangement, song-sections, song-solo, ears, listen-analyzer and
// analyze-mix.py. Running them all meant nine invocations, several of which
// needed a browser and one of which needed a Python that is not the `python3` on
// this machine — so in practice one of them got run, usually the cheapest, and a
// song shipped on a single number computed over its whole length. Two of them
// disagreed about whether a mix was dark and there was no way to settle it.
//
// This renders the song offline, measures the mix and every stem with one set of
// definitions, reads the note data for the things audio cannot see (groove,
// register, arrangement shape), and prints ONE ranked list of what to fix. It
// takes about fifteen seconds for a two-minute song and needs nothing running.
//
//   --compare=<file>   also measure another file and print the differences.
//                      Use it two ways: against a browser bounce of the same
//                      song to check this renderer is still honest, or against a
//                      commercial reference to see where the mix actually sits.
//   --target=<name>    a genre target profile from targets/ (default: general)
//   --keep             keep the rendered wav and stems
//   --json             machine-readable
//   --no-render        <file> is already audio; skip rendering
//   --bars=A:B         only listen to these bars

import { readFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs'
import { join, dirname, basename, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readWav, analyze, db, pitchNear } from './lib/audio-features.mjs'
import { symbolic } from './lib/song-symbolic.mjs'
import { importTs } from './lib/ts-import.mjs'
import { judge, summarize, DEFAULT_TARGET } from './lib/verdicts.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const file = argv.find(a => !a.startsWith('--'))
const flag = (n, d = null) => {
  const a = argv.find(x => x === `--${n}` || x.startsWith(`--${n}=`))
  return a ? (a.includes('=') ? a.split('=').slice(1).join('=') : true) : d
}
if (!file) { console.error('usage: listen.mjs <song.cfproj|audio.wav> [--compare=f] [--target=name] [--json] [--keep]'); process.exit(2) }
const asJson = !!flag('json')
const out = []
const say = (...a) => { if (asJson) return; console.log(...a) }

// ── Target profile ──────────────────────────────────────────────────────────
let target = DEFAULT_TARGET
const targetName = flag('target')
if (typeof targetName === 'string') {
  const p = join(ROOT, 'targets', `${targetName}.json`)
  if (!existsSync(p)) { console.error(`no target profile at ${p} — run scripts/build-targets.mjs first`); process.exit(2) }
  target = JSON.parse(readFileSync(p, 'utf8'))
}

// A STYLE is measured from real records of a kind (see scripts/build-style.mjs)
// and is the better comparison when there is one, for a specific reason: it
// compares against the reference's INSTRUMENTAL, and our music is instrumental.
// Judging our tracks against a finished vocal record blames the arrangement for
// a missing singer — the voice occupies exactly the midrange we would otherwise
// be told to fill.
const styleName = flag('style')
if (typeof styleName === 'string') {
  const p = join(ROOT, 'styles', `${styleName}.json`)
  if (!existsSync(p)) { console.error(`no style at ${p} — run scripts/build-style.mjs first`); process.exit(2) }
  const s = JSON.parse(readFileSync(p, 'utf8'))
  const src = s.instrumental?.bands ?? s.fullMix?.bands
  if (!src) { console.error(`${styleName} has no band data`); process.exit(2) }
  // Widen each measured range a little: a style built from five records has seen
  // five points, not the whole space, and a hard edge would fail songs that are
  // simply somewhere those five did not happen to go.
  const pad = ([lo, hi]) => { const w = Math.max(0.02, (hi - lo) * 0.25); return [Math.max(0, lo - w), hi + w] }
  target = {
    ...DEFAULT_TARGET,
    name: `${s.name} (${s.tracks} records, instrumental)`,
    provisional: false,
    bands: Object.fromEntries(Object.entries(src).map(([b, r]) => [b, pad([r.lo, r.hi])])),
    centroidHz: s.instrumental?.centroidHz ? pad([s.instrumental.centroidHz.lo, s.instrumental.centroidHz.hi]) : DEFAULT_TARGET.centroidHz,
    // Travel and crest come from the FULL mix — they are arrangement and
    // mastering facts, not affected by the voice being removed.
    dynamicRangeDb: [Math.max(0, (s.arrangement?.travelsDb?.lo ?? 3) * 0.7), null],
    crestDb: DEFAULT_TARGET.crestDb,
    // Stereo width from the profile too. These references run 0.44 to 0.93
    // correlation — near-mono is normal here, and keeping the generic 0.85
    // ceiling invented a fault the reference set does not support.
    correlation: s.fullMix?.correlation ? [null, Math.min(0.98, s.fullMix.correlation.hi + 0.03)] : DEFAULT_TARGET.correlation,
    styleNotes: s,
  }
}

// ── Get audio ───────────────────────────────────────────────────────────────
const isProject = /\.cfproj$/i.test(file) && !flag('no-render')
const { sampleAutomation } = await importTs('lib/clip-effect-utils.ts')
let mixPath = file, stemFiles = {}, renderReport = null, tmp = null, dp = null

if (isProject) {
  dp = JSON.parse(readFileSync(file, 'utf8')).dawProject
  tmp = flag('keep') ? dirname(resolve(file)) : mkdtempSync(join(tmpdir(), 'listen-'))
  const args = ['--experimental-strip-types', join(ROOT, 'scripts/song-render.mjs'), file,
    `--out=${tmp}`, '--stems', '--json']
  if (flag('bars')) args.push(`--bars=${flag('bars')}`)
  let raw
  try {
    raw = execFileSync('node', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 })
  } catch (e) {
    // song-render exits non-zero when something was silent or refused; the
    // report on stdout is still the thing worth reading.
    raw = e.stdout || ''
    if (!raw.trim().startsWith('{')) { console.error(e.stderr || e.message); process.exit(1) }
  }
  renderReport = JSON.parse(raw)
  mixPath = renderReport.mix
  stemFiles = renderReport.stems ?? {}
}

// ── Measure ─────────────────────────────────────────────────────────────────
const wav = readWav(readFileSync(mixPath))
const mix = analyze(wav.l, wav.r, wav.sr, { withTruePeak: true, withBandStereo: true })

const stems = []
for (const [name, p] of Object.entries(stemFiles)) {
  const w = readWav(readFileSync(p))
  const a = analyze(w.l, w.r, w.sr, { withTruePeak: false, withBandStereo: false })
  const rt = renderReport?.tracks?.find(t => t.track === name)
  stems.push({ track: name, ...a, silent: rt?.silent ?? (a.rmsDb < -80), notes: rt?.notes ?? 0 })
}

const sym = dp ? symbolic(dp) : null

// Did the parts written as ONE continuous sound actually stay continuous?
//
// The envelope follower here uses a 60 ms window on purpose. At 30-60 Hz one
// cycle is 17-33 ms, so a short RMS window measures the waveform's own zero
// crossings rather than its amplitude — with a 5 ms window every sub on earth
// looks like it is gating, which is exactly the false alarm this check exists
// to avoid raising.
if (sym?.continuous?.length) {
  for (const c of sym.continuous) {
    const p = stemFiles[c.track]
    if (!p) continue
    const w = readWav(readFileSync(p))
    const mono = Float32Array.from(w.l, (v, i) => (v + w.r[i]) * 0.5)
    const win = Math.floor(0.06 * w.sr), step = Math.floor(0.02 * w.sr)
    const env = []
    for (let i = 0; i + win <= mono.length; i += step) {
      let m = 0
      for (let k = i; k < i + win; k++) { const a = Math.abs(mono[k]); if (a > m) m = a }
      env.push(m)
    }
    const peak = Math.max(...env, 1e-9)
    let first = env.findIndex(v => v > peak * 0.15)
    let last = env.length - 1
    while (last > first && env[last] < peak * 0.15) last--
    const body = first >= 0 ? env.slice(first, last + 1) : []
    c.gatedFrames = body.filter(v => v < peak * 0.2).length
    c.frames = body.length
    c.quietestPct = body.length ? +(Math.min(...body) / peak * 100).toFixed(1) : null
  }
}

// Did a glide line's PITCH actually follow its curve?
//
// This is the check that would catch the curve being ignored — which is exactly
// what happened before Apollo learned to read it: the note played, the stem was
// full, every level check passed, and the line simply never moved. Nothing else
// here looks at pitch, so nothing else could tell.
//
// It asks whether there is energy where the pitch was WRITTEN, rather than
// detecting the pitch blind. A sub is usually an oscillator plus a
// sub-oscillator an octave down, and a blind estimator picks between those two
// more or less arbitrarily — reporting an octave error that is a property of the
// sound, not a fault in the note.
if (sym?.glide?.length && dp) {
  const spb = 60 / (dp.tempo || 120)
  const hzOf = m => 440 * Math.pow(2, (m - 69) / 12)
  for (const gl of sym.glide) {
    const p = stemFiles[gl.track]
    const clip = (dp.arrangementClips ?? []).find(c =>
      c.pitchGraph?.length >= 2 && (dp.tracks.find(t => t.id === c.trackId)?.name ?? '') === gl.track)
    if (!p || !clip || !clip.notes?.length) continue
    const w = readWav(readFileSync(p))
    const mono = Float32Array.from(w.l, (v, i) => (v + w.r[i]) * 0.5)
    const note = clip.notes[0]
    const M = 2000
    const lut = sampleAutomation(clip.pitchGraph, 1, M)

    // Measure where the line is HOLDING, not mid-move: a moving pitch has no
    // single answer, and the curve is only claiming to arrive at the holds.
    const minHold = Math.max(8, Math.round(M * (1 / Math.max(1, note.durationBeats))))
    const holds = []
    let runStart = 0
    for (let i = 1; i <= M; i++) {
      const moved = i < M && Math.abs(lut[i] - lut[runStart]) > 0.5 / 24   // half a semitone
      if (moved || i === M) {
        if (i - runStart >= minHold) holds.push((runStart + i) >> 1)
        runStart = i
      }
    }
    const errs = []
    for (const i of holds) {
      const beat = clip.startBeat + note.startBeat + (i / (M - 1)) * note.durationBeats
      const want = note.pitch + (lut[i] - 0.5) * 24
      const r = pitchNear(mono, w.sr, beat * spb, hzOf(want))
      if (r) errs.push(Math.abs(r.cents))
    }
    gl.holdsChecked = errs.length
    gl.worstCents = errs.length ? +Math.max(...errs).toFixed(1) : null
    gl.distinctPitches = new Set(holds.map(i => Math.round((lut[i] - 0.5) * 24 * 2))).size
  }
}

// ── Judge ───────────────────────────────────────────────────────────────────
const findings = sym
  ? judge({ symbolic: sym, mix, stems, target, refused: renderReport?.refused ?? [] })
  : judge({ symbolic: { groove: [], dynamics: [], arrangement: [], registers: { clashes: [] } }, mix, stems, target })
const sum = summarize(findings)

// ── Compare ─────────────────────────────────────────────────────────────────
let comparison = null
const cmpPath = flag('compare')
if (typeof cmpPath === 'string') {
  let p = cmpPath
  if (/\.(mp3|m4a|flac|ogg)$/i.test(p)) {
    const t = join(tmpdir(), `cmp-${Date.now()}.wav`)
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', p, '-ar', String(wav.sr), t])
    p = t
  }
  const w = readWav(readFileSync(p))
  const other = analyze(w.l, w.r, w.sr, { withTruePeak: true, withBandStereo: false })
  const delta = {}
  for (const k of ['lufs', 'peakDb', 'truePeakDb', 'crestDb', 'dynamicRangeDb', 'centroidHz', 'rolloffHz', 'correlation'])
    delta[k] = { ours: mix[k], theirs: other[k], delta: +(mix[k] - other[k]).toFixed(2) }
  delta.bands = {}
  for (const b of Object.keys(mix.bands))
    delta.bands[b] = { ours: mix.bands[b], theirs: other.bands[b], delta: +(mix.bands[b] - other.bands[b]).toFixed(4) }
  comparison = { file: basename(cmpPath), delta }
}

// ── Report ──────────────────────────────────────────────────────────────────
if (asJson) {
  console.log(JSON.stringify({ file: basename(file), render: renderReport, mix, stems, symbolic: sym, findings, summary: sum, comparison }, null, 2))
} else {
  const title = dp?.name ?? basename(file)
  say(`\n${title}${dp ? `  —  ${dp.tempo} BPM, ${dp.key} ${dp.scale}` : ''}`)
  if (renderReport) say(`rendered ${renderReport.seconds}s in ${(renderReport.wallMs / 1000).toFixed(1)}s (${renderReport.realtimeFactor}x real time)`)

  say(`\nMIX   ${mix.lufs} LUFS   true peak ${mix.truePeakDb} dBTP   crest ${mix.crestDb} dB   ` +
      `range ${mix.dynamicRangeDb} dB   correlation ${mix.correlation}`)
  const bar = v => '█'.repeat(Math.max(0, Math.round(v * 40))) || '·'
  say('\nSPECTRUM  (share of audible energy)')
  for (const [b, v] of Object.entries(mix.bands)) say(`  ${b.padEnd(11)}${(v * 100).toFixed(1).padStart(5)}%  ${bar(v)}`)
  say(`  centroid ${mix.centroidHz} Hz · 85% rolloff ${mix.rolloffHz} Hz · mud ${(mix.diag.mud * 100).toFixed(1)}% · boxy ${(mix.diag.boxy * 100).toFixed(1)}%`)

  if (stems.length) {
    say('\nSTEMS')
    say('  track          notes    rms   centroid   dominant band')
    for (const s of stems.sort((a, b) => b.rmsDb - a.rmsDb)) {
      const dom = Object.entries(s.bands).sort((a, b) => b[1] - a[1])[0]
      say(`  ${s.track.padEnd(14)}${String(s.notes).padStart(5)}${String(s.rmsDb).padStart(8)}dB` +
          `${String(s.centroidHz).padStart(8)}Hz   ${dom[0]} ${(dom[1] * 100).toFixed(0)}%${s.silent ? '   ** SILENT **' : ''}`)
    }
  }

  if (sym) {
    say('\nARRANGEMENT')
    for (const r of sym.arrangement) {
      const moves = [...(r.entering ?? []).map(x => '+' + x), ...(r.leaving ?? []).map(x => '−' + x)].join(' ')
      say(`  ${String(r.name).slice(0, 12).padEnd(13)}bar ${String(r.startBar).padStart(3)}  ${String(r.bars).padStart(2)} bars  ` +
          `${String(r.layers.length)} layers  ${String(r.notesPerBar).padStart(6)} n/bar   ${moves}`)
    }
    say('\nFEEL   (offset from grid; − is ahead of the beat)')
    for (const g of sym.groove) {
      say(`  ${g.track.padEnd(12)}${String(g.meanOffsetMs).padStart(6)} ms  spread ±${String(g.spreadMs).padStart(4)}  ` +
          `on-grid ${String(g.onGridPct).padStart(5)}%  swing ${g.swingPct}%`)
    }
  }

  if (comparison) {
    say(`\nCOMPARED WITH  ${comparison.file}   (ours − theirs)`)
    for (const [k, v] of Object.entries(comparison.delta)) {
      if (k === 'bands') continue
      say(`  ${k.padEnd(16)}${String(v.ours).padStart(9)}${String(v.theirs).padStart(9)}${String(v.delta > 0 ? '+' + v.delta : v.delta).padStart(9)}`)
    }
    for (const [b, v] of Object.entries(comparison.delta.bands)) {
      const d = (v.delta * 100).toFixed(1)
      say(`  ${b.padEnd(16)}${(v.ours * 100).toFixed(1).padStart(8)}%${(v.theirs * 100).toFixed(1).padStart(8)}%${(v.delta > 0 ? '+' + d : d).padStart(9)}`)
    }
  }

  say(`\n${sum.verdict}   ${sum.fail} fail · ${sum.warn} warn · ${sum.note} note` +
      (target.provisional ? `   (balance targets provisional — marked ~)` : `   (target: ${target.name})`))
  const icon = { fail: '✗', warn: '!', note: '·' }
  for (const x of findings) {
    say(`\n  ${icon[x.severity]} [${x.area}] ${x.what}`)
    say(`      → ${x.fix}`)
  }
  say('')
}

if (tmp && !flag('keep') && isProject) rmSync(tmp, { recursive: true, force: true })
process.exit(sum.fail ? 1 : 0)
