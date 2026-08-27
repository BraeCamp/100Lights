#!/usr/bin/env node
// Changing note without restarting the sound.
//
// Legato already spared the ENVELOPE, but every note start still ran initNote(),
// which resets oscillator phase, grain/spectral state and — the one you hear —
// the sample's playback position. So a sampled instrument jumped back to its
// first frame on every note: the opposite of one sound moving.
//
// `global.glideContinuous` keeps the source running and moves only the pitch,
// with `glide` deciding whether that move is instant (0) or a slide, and
// glideAccel / glideDecel shaping the slide.
//
// Every claim here is measured rather than asserted-by-reading:
//   1. a SAMPLE keeps playing across a note change (its own level reports its
//      playback position, so a restart is directly visible)
//   2. the pitch actually moves, instantly or over the glide time
//   3. accel and decel bend the slide in opposite directions
//   4. ordinary ADJACENT piano-roll notes work — no overlap, nothing drawn
//
//   node --experimental-strip-types scripts/apollo-tests/glide-continuous.mjs

import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const { importTs } = await import(join(ROOT, 'scripts/lib/ts-import.mjs'))
const { readWav } = await import(join(ROOT, 'scripts/lib/offline-dsp.mjs'))
const { pitchAt } = await import(join(ROOT, 'scripts/lib/audio-features.mjs'))
const { initPatch } = await importTs('lib/apollo/patch.ts')

const T = mkdtempSync(join(tmpdir(), 'apollo-glide-'))
let pass = 0, fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}${detail ? '  ' + detail : ''}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? '  ' + detail : ''}`) }
}

function basePatch({ glide = 0, continuous = false, accel = 0, decel = 0 }) {
  const p = initPatch()
  p.global.mode = 'legato'
  p.global.glide = glide
  p.global.glideLegatoOnly = false
  p.global.glideContinuous = continuous
  p.global.glideAccel = accel
  p.global.glideDecel = decel
  p.oscs[0].enabled = true; p.oscs[0].level = 1
  p.oscs[1].enabled = false; p.oscs[2].enabled = false
  p.sub.enabled = false
  p.filters[0].enabled = false
  p.fxMain = []
  Object.assign(p.envs[0], { attack: 0.003, decay: 0.15, sustain: 1, release: 0.45, legato: true })
  return p
}

function render(name, patch, notes, seconds) {
  writeFileSync(join(T, name + '.patch.json'), JSON.stringify(patch))
  writeFileSync(join(T, name + '.notes.json'), JSON.stringify(notes))
  const args = ['--experimental-strip-types', join(ROOT, 'scripts/apollo-render.mjs'),
    '--patch', join(T, name + '.patch.json'), '--notes-json', join(T, name + '.notes.json'),
    '--seconds', String(seconds), '--out', join(T, name + '.wav'), '--json']
  if (name.startsWith('smp')) args.push('--sample', 'ramp=' + join(T, 'ramp.wav'))
  execFileSync('node', args, { cwd: ROOT, stdio: 'pipe' })
  const w = readWav(readFileSync(join(T, name + '.wav')))
  return { sr: w.sr, mono: Float32Array.from(w.l, (v, i) => (v + w.r[i]) * 0.5) }
}

const levelAt = (mono, sr, sec, win = 0.03) => {
  const a = Math.round(sec * sr), n = Math.round(win * sr)
  let m = 0
  for (let i = a; i < a + n && i < mono.length; i++) m = Math.max(m, Math.abs(mono[i]))
  return m
}
const midiAt = (mono, sr, sec, win = 0.12) => { const r = pitchAt(mono, sr, sec, win); return r ? r.midi : null }

// ── 1. a sample survives a note change ──────────────────────────────────────
// The sample's amplitude ramps 0 -> 1 over 3 s, so its LEVEL reports its
// playback position. Restart and the level collapses; keep playing and it climbs.
{
  const SR = 48000, n = SR * 3
  const b = Buffer.alloc(44 + n * 2)
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8)
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22)
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34)
  b.write('data', 36); b.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    b.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 220 * t) * (t / 3) * 0.9 * 32767), 44 + i * 2)
  }
  writeFileSync(join(T, 'ramp.wav'), b)
}
console.log('\na sample through a note change')
{
  const notes = [{ note: 60, t: 0.05, dur: 1.05, vel: 0.9 }, { note: 67, t: 1.0, dur: 1.4, vel: 0.9 }]
  const mk = opts => {
    const p = basePatch(opts)
    p.oscs[0].engine = 'sample'
    p.oscs[0].smp.sampleId = 'ramp'
    p.oscs[0].smp.rootKey = 60
    return p
  }
  const off = render('smpOff', mk({ glide: 0.15, continuous: false }), notes, 2.6)
  const on = render('smpOn', mk({ glide: 0.15, continuous: true }), notes, 2.6)
  const before = levelAt(off.mono, off.sr, 0.9)
  const offAfter = levelAt(off.mono, off.sr, 1.15)
  const onAfter = levelAt(on.mono, on.sr, 1.15)
  ok('OFF: the sample restarts', offAfter < before * 0.5,
    `${before.toFixed(3)} -> ${offAfter.toFixed(3)}`)
  ok('ON: the sample keeps playing', onAfter > before,
    `${before.toFixed(3)} -> ${onAfter.toFixed(3)}`)
  const inst = render('smpInst', mk({ glide: 0, continuous: true }), notes, 2.6)
  const b0 = midiAt(inst.mono, inst.sr, 0.8), b1 = midiAt(inst.mono, inst.sr, 1.3)
  ok('ON with glide 0: pitch changes instantly, sound does not stop',
    b0 !== null && b1 !== null && Math.abs((b1 - b0) - 7) < 0.2 && levelAt(inst.mono, inst.sr, 1.15) > before,
    `${b0?.toFixed(1)} -> ${b1?.toFixed(1)}`)
}

// ── 2 & 3. the slide, and its shape ─────────────────────────────────────────
console.log('\nthe slide and its shape (60 -> 72 over 2 s)')
{
  const notes = [{ note: 60, t: 0.05, dur: 1.05, vel: 0.9 }, { note: 72, t: 1.0, dur: 3.0, vel: 0.9 }]
  const at = (r, sec) => midiAt(r.mono, r.sr, sec) - midiAt(r.mono, r.sr, 0.7)
  const lin = render('gLin', basePatch({ glide: 2, continuous: true }), notes, 4.2)
  const acc = render('gAcc', basePatch({ glide: 2, continuous: true, accel: 1 }), notes, 4.2)
  const dec = render('gDec', basePatch({ glide: 2, continuous: true, decel: 1 }), notes, 4.2)
  const half = [at(lin, 2.0), at(acc, 2.0), at(dec, 2.0)]
  ok('linear is a straight line in pitch', Math.abs(half[0] - 6) < 0.4, `+${half[0].toFixed(2)} at the midpoint`)
  ok('accel holds the old note longer', half[1] < half[0] - 1, `+${half[1].toFixed(2)} vs +${half[0].toFixed(2)}`)
  ok('decel arrives early and settles', half[2] > half[0] + 1, `+${half[2].toFixed(2)} vs +${half[0].toFixed(2)}`)
  ok('every shape still arrives', [lin, acc, dec].every(r => Math.abs(at(r, 3.2) - 12) < 0.3))
  // the glide must survive the previous key lifting mid-slide (overlapping notes
  // are the normal case from a piano roll, and the mono back-step used to cancel it)
  ok('an overlapping note-off does not cancel the slide', Math.abs(at(lin, 1.5) - 3) < 0.6,
    `+${at(lin, 1.5).toFixed(2)} a quarter of the way in`)
}

// ── 4. ordinary adjacent piano-roll notes ───────────────────────────────────
console.log('\nfour ADJACENT piano-roll notes, nothing overlapped')
{
  const PITCHES = [60, 63, 67, 65]
  const notes = PITCHES.map((p, i) => ({ note: p, t: 0.05 + i * 1.0, dur: 1.0, vel: 0.9 }))
  const mk = opts => basePatch(opts)
  const on = render('rollOn', mk({ glide: 0, continuous: true }), notes, 4.4)
  const off = render('rollOff', mk({ glide: 0, continuous: false }), notes, 4.4)
  const heard = [0.9, 1.9, 2.9, 3.9].map((t, i) => {
    const m = midiAt(on.mono, on.sr, t)
    return m !== null && Math.abs(m - PITCHES[i]) < 0.3
  })
  ok('every note sounds', heard.every(Boolean), heard.map(h => h ? '✓' : '✗').join(''))

  // A constant-amplitude oscillator does not DIP when it restarts, it JUMPS —
  // and a higher note is genuinely steeper, so the floor is the pitch ratio.
  const step = (r, from, to) => {
    let m = 0
    for (let i = Math.round(from * r.sr); i < Math.round(to * r.sr) - 1; i++) {
      const d = Math.abs(r.mono[i + 1] - r.mono[i])
      if (d > m) m = d
    }
    return m
  }
  const jump = r => {
    const typical = step(r, 0.4, 0.9)
    let m = 0
    for (const b of [1.05, 2.05, 3.05]) m = Math.max(m, step(r, b - 0.005, b + 0.02) / (typical || 1e-9))
    return m
  }
  const ratio = Math.pow(2, (Math.max(...PITCHES) - PITCHES[0]) / 12)
  ok('OFF: the source restarts at every note', jump(off) > ratio * 3, `${jump(off).toFixed(2)}x`)
  ok('ON: no break beyond the pitch change itself', jump(on) < ratio * 1.1,
    `${jump(on).toFixed(2)}x (floor is ${ratio.toFixed(2)}x)`)
}

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
