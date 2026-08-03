// Calibration + logic tests for the listen analyzer. Run: node scripts/test-listen-analyzer.mjs
import { spectrum, roleOf, analyzeMix } from './listen-analyzer.mjs'

const sr = 48000, N = sr
const sine = (f, a = 0.5) => { const s = new Float32Array(N); for (let i = 0; i < N; i++) s[i] = a * Math.sin(2 * Math.PI * f * i / sr); return s }
const mix = (...sigs) => { const s = new Float32Array(N); for (const g of sigs) for (let i = 0; i < N; i++) s[i] += g[i]; return s }
const noiseHP = () => { let x = 99; const s = new Float32Array(N); let prev = 0; for (let i = 0; i < N; i++) { x = (x * 1664525 + 1013904223) >>> 0; const w = (x / 0xffffffff * 2 - 1); s[i] = (w - prev) * 0.3; prev = w } return s }  // differenced noise = HF-heavy (hat-like)

let pass = 0, fail = 0
const ok = (cond, label, got) => { if (cond) { pass++; console.log('  ✓', label) } else { fail++; console.log('  ✗', label, '→ got', got) } }

console.log('centroid calibration:')
ok(Math.abs(spectrum(sine(60), sr).centroid - 60) < 5, '60Hz → ~60', spectrum(sine(60), sr).centroid)
ok(Math.abs(spectrum(sine(3000), sr).centroid - 3000) < 20, '3kHz → ~3000', spectrum(sine(3000), sr).centroid)
ok(spectrum(sine(3000), sr).bandPct.presence > 0.95, '3kHz → presence band', spectrum(sine(3000), sr).bandPct.presence)

console.log('roleOf:')
ok(roleOf('Sub Drone') === 'bass', 'Sub Drone → bass', roleOf('Sub Drone'))
ok(roleOf('Drums') === 'drums', 'Drums → drums', roleOf('Drums'))
ok(roleOf('Stab') === 'stab', 'Stab → stab', roleOf('Stab'))
ok(roleOf('Pad') === 'pad', 'Pad → pad', roleOf('Pad'))
ok(roleOf('Lead') === 'lead', 'Lead → lead', roleOf('Lead'))

console.log('melodic centroid excludes drum HF (the core lesson):')
// Bass+pad dark (low sines) + a bright "drums" hat-noise stem. Mix centroid should
// be dragged UP by drums, but melodicCentroid should stay LOW.
const r1 = analyzeMix({ sampleRate: sr, master: mix(sine(80), sine(300), noiseHP()), stems: { Bass: sine(80), Pad: sine(300), Drums: noiseHP() } }, { genre: 'dark-pop' })
ok(r1.mix.centroid > 2000, 'full-mix centroid pulled UP by drums', r1.mix.centroid)
ok(r1.melodicCentroid < 500, 'melodic centroid stays LOW (drums excluded)', r1.melodicCentroid)
ok(r1.verdicts.some(v => v.tag === 'dull'), 'flags DULL on melodic content despite bright mix', r1.verdicts.map(v => v.tag))

console.log('scoop / presence-hole detection:')
// lots of low + some air, empty 2-6kHz → scooped
const r2 = analyzeMix({ sampleRate: sr, master: mix(sine(70, 0.6), sine(12000, 0.15)), stems: { Bass: sine(70, 0.6), Air: sine(12000, 0.15) } }, { genre: 'dark-pop' })
ok(r2.verdicts.some(v => v.tag === 'scooped' || v.tag === 'no-presence'), 'flags scooped/no-presence', r2.verdicts.map(v => v.tag))

console.log('a present stab passes presence check:')
const r3 = analyzeMix({ sampleRate: sr, master: mix(sine(80, 0.5), sine(2500, 0.4)), stems: { Bass: sine(80, 0.5), Stab: sine(2500, 0.4) } }, { genre: 'dark-pop' })
ok(!r3.verdicts.some(v => v.tag === 'part-dull'), 'bright stab not flagged dull', r3.verdicts.map(v => v.tag))

console.log('rhythm — onset detection:')
const held = (f, dur, a = 0.5) => { const n = Math.floor(sr * dur), s = new Float32Array(n); for (let i = 0; i < n; i++) s[i] = a * Math.sin(2 * Math.PI * f * i / sr); return s }
const gap = n => new Float32Array(Math.floor(sr * n))
const concat = (...xs) => { const n = xs.reduce((a, b) => a + b.length, 0), s = new Float32Array(n); let o = 0; for (const x of xs) { s.set(x, o); o += x.length } return s }
import { detectOnsets, analyzeStem } from './listen-analyzer.mjs'
ok(detectOnsets(held(50, 2), sr).count === 1, 'one held 2s note → 1 onset', detectOnsets(held(50, 2), sr).count)
const four = concat(held(50, 0.4), gap(0.1), held(50, 0.4), gap(0.1), held(50, 0.4), gap(0.1), held(50, 0.4))
ok(detectOnsets(four, sr).count === 4, 'four re-triggered notes → 4 onsets', detectOnsets(four, sr).count)

console.log('sustain — hold flat vs decay, and the drone check:')
const rs1 = analyzeStem(held(46, 2), sr, { f0: 46, expectHeldSec: 1.5, expectPureSub: true })
ok(rs1.medHeldSec >= 1.6, 'held sine sustains ~2s', rs1.medHeldSec)
ok(rs1.notes[0].sustainCV < 0.1, 'held sine is FLAT (low CV)', rs1.notes[0]?.sustainCV)
ok(rs1.harmonics.purity > 0.9, 'pure sine → high sub purity', rs1.harmonics.purity)
ok(rs1.verdicts.length === 0, 'clean 2s sub drone → no verdicts', rs1.verdicts)
// decaying note: should NOT read as a flat 2s hold
const dec = (() => { const n = Math.floor(sr * 2), s = new Float32Array(n); for (let i = 0; i < n; i++) s[i] = 0.6 * Math.exp(-3 * i / sr) * Math.sin(2 * Math.PI * 46 * i / sr); return s })()
const rs2 = analyzeStem(dec, sr, { f0: 46, expectHeldSec: 1.5 })
ok(rs2.medHeldSec < 1.5 || rs2.verdicts.some(v => /short|hold/.test(v)), 'decaying note flagged as not sustaining', { held: rs2.medHeldSec, v: rs2.verdicts })
// harmonically rich → not a pure sub
const rich = (() => { const n = Math.floor(sr * 2), s = new Float32Array(n); for (let i = 0; i < n; i++) { const p = 2 * Math.PI * 46 * i / sr; s[i] = 0.4 * (Math.sin(p) + 0.8 * Math.sin(2 * p) + 0.6 * Math.sin(3 * p)) } return s })()
ok(analyzeStem(rich, sr, { f0: 46, expectPureSub: true }).verdicts.some(v => /pure sub/.test(v)), 'rich tone flagged not-pure-sub', analyzeStem(rich, sr, { f0: 46, expectPureSub: true }).harmonics.purity)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
