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

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
