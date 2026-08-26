#!/usr/bin/env node
// The craft rules have to be provably right, because every one of them is a
// claim about music that gets applied to every song afterwards. A voicing
// function that quietly drops the seventh, or a groove that leans the wrong way,
// would be invisible in a mix and wrong in all of them at once.
//
//   node scripts/craft.test.mjs

import {
  parseChord, voice, lowIntervalOk, deMud, groove, play, ROLE_LEAN,
  SLOTS, intoSlot, checkSlots, stagger, densityArc, thin, motif,
} from './lib/craft.mjs'

let pass = 0, fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? '   ' + detail : ''}`) }
}
const pcs = ps => [...new Set(ps.map(p => ((p % 12) + 12) % 12))].sort((a, b) => a - b)
const has = (ps, ...want) => want.every(w => pcs(ps).includes(w))

console.log('\nchord parsing')
{
  ok('C major', parseChord('C').tones.join() === '0,4,7')
  ok('Am', parseChord('Am').tones.join() === '0,3,7')
  ok('Cmaj7 has a major seventh', parseChord('Cmaj7').tones.includes(11))
  ok('C7 has a minor seventh', parseChord('C7').tones.includes(10) && !parseChord('C7').tones.includes(11))
  ok('Dm9 has the ninth', parseChord('Dm9').tones.includes(14))
  ok('F#m7 root is F#', parseChord('F#m7').root === 6)
  ok('Bbmaj7 root is Bb', parseChord('Bbmaj7').root === 10)
  ok('Esus4 has a fourth and no third', parseChord('Esus4').tones.includes(5) && !parseChord('Esus4').tones.includes(4))
  ok('G9sus is a suspended dominant', (() => { const t = parseChord('G9sus').tones; return t.includes(5) && t.includes(10) && !t.includes(4) })())
  ok('Cmaj7#11 carries the sharp eleven', parseChord('Cmaj7#11').tones.includes(18))
  ok('an unparseable symbol throws', (() => { try { parseChord('H7'); return false } catch { return true } })())
}

console.log('\nlow interval limit')
{
  ok('a major third at C4 is fine', lowIntervalOk(60, 64))
  ok('a major third at C2 is not', !lowIntervalOk(36, 40))
  ok('a fifth at E2 is fine', lowIntervalOk(40, 47))
  ok('a minor second at C2 is not', !lowIntervalOk(36, 37))
  ok('an octave is always fine', lowIntervalOk(28, 40))
  ok('deMud removes the offender', (() => { const r = deMud([36, 40, 55, 60]); return !r.includes(40) })(), JSON.stringify(deMud([36, 40, 55, 60])))
  ok('deMud keeps a clean voicing whole', deMud([60, 64, 67, 71]).length === 4)
}

console.log('\nvoicing')
{
  const v = voice('Dm9', { style: 'rootless', centre: 62 })
  ok('rootless Dm9 drops the root', !pcs(v).includes(2), JSON.stringify(pcs(v)))
  ok('rootless Dm9 keeps third and seventh', has(v, 5, 0), JSON.stringify(pcs(v)))
  ok('voicing sits near the centre', v.every(p => Math.abs(p - 62) <= 22), JSON.stringify(v))
  ok('shell voicing is three notes', voice('G7', { style: 'shell' }).length <= 3)
  const tri = voice('C', { style: 'triad', centre: 60 })
  ok('a triad has all three tones', has(tri, 0, 4, 7), JSON.stringify(pcs(tri)))
  ok('quartal stacks fourths', (() => {
    const q = voice('D', { style: 'quartal', centre: 62 }).sort((a, b) => a - b)
    return q.length >= 3 && q.every((p, i) => i === 0 || p - q[i - 1] >= 4)
  })())
  ok('nothing breaks the low interval limit', (() => {
    for (const s of ['C', 'Am7', 'Fmaj9', 'G9sus', 'Bbmaj7']) {
      const p = voice(s, { centre: 44, spread: 12 })
      for (let i = 1; i < p.length; i++) if (!lowIntervalOk(p[i - 1], p[i])) return false
    }
    return true
  })())

  // Voice leading: the whole point is that the next chord moves LESS than it
  // would have without it.
  const a = voice('Cmaj7', { centre: 64 })
  const led = voice('Am7', { centre: 64, near: a })
  const cold = voice('Am7', { centre: 64 })
  const motion = (x, y) => x.reduce((s, p) => s + Math.min(...y.map(q => Math.abs(p - q))), 0)
  ok('voice leading moves less than not voice leading', motion(led, a) <= motion(cold, a),
    `led=${motion(led, a)} cold=${motion(cold, a)}`)
}

console.log('\ngroove')
{
  const g = groove({ bpm: 120, feel: 'straight', seed: 3 })
  const beats = Array.from({ length: 64 }, (_, i) => i * 0.5)
  const meanMs = role => {
    const offs = beats.map(b => g.offset(role, b) * (60 / 120) * 1000)
    return offs.reduce((a, b) => a + b, 0) / offs.length
  }
  const snare = meanMs('snare'), bass = meanMs('bass'), kick = meanMs('kick')
  ok('the snare lands behind the beat', snare > 5, `${snare.toFixed(1)}ms`)
  ok('the bass pushes ahead of it', bass < -2, `${bass.toFixed(1)}ms`)
  ok('the kick stays the anchor', Math.abs(kick) < 2, `${kick.toFixed(1)}ms`)
  ok('snare and bass lean in opposite directions', snare > 0 && bass < 0)
  ok('the hats are the loosest part', ROLE_LEAN.hats.jitter > ROLE_LEAN.kick.jitter)

  const sw = groove({ bpm: 90, feel: 'laidback', seed: 3 })
  const off = sw.offset('hats', 0.25) - sw.offset('hats', 0)
  ok('swing pushes the off-sixteenth later', off > 0.005, `${off.toFixed(4)} beats`)
  const straightKick = groove({ bpm: 90, swing: 0.6, seed: 3 })
  const kickSwing = Math.abs(straightKick.offset('kick', 0.25) - straightKick.offset('kick', 0))
  ok('swing does not touch the kick', kickSwing < 0.02, `${kickSwing.toFixed(4)}`)

  ok('downbeats are played harder than offbeats', (() => {
    const gg = groove({ bpm: 120, seed: 9 })
    const down = [], up = []
    for (let i = 0; i < 40; i++) { down.push(gg.velocity('keys', i * 4, 90)); up.push(gg.velocity('keys', i * 4 + 0.5, 90)) }
    return down.reduce((a, b) => a + b) / down.length > up.reduce((a, b) => a + b) / up.length
  })())
  ok('velocities stay in MIDI range', (() => {
    const gg = groove({ bpm: 120, seed: 2 })
    for (let i = 0; i < 500; i++) { const v = gg.velocity('hats', i * 0.25, 126); if (v < 1 || v > 127) return false }
    return true
  })())
  ok('the same seed gives the same groove', (() => {
    const x = groove({ bpm: 120, seed: 42 }).offset('hats', 1)
    const y = groove({ bpm: 120, seed: 42 }).offset('hats', 1)
    return x === y
  })())

  const notes = [{ pitch: 60, beat: 0, durationBeats: 1, velocity: 90 }, { pitch: 62, beat: 1, durationBeats: 1, velocity: 90 }]
  const played = play(notes, 'snare', groove({ bpm: 100, seed: 1 }))
  ok('play() never produces a negative beat', played.every(n => n.beat >= 0))
  ok('play() moves notes off the grid', played.some(n => Math.abs(n.beat - Math.round(n.beat)) > 1e-6))
}

console.log('\nregister')
{
  ok('intoSlot folds a low note up', intoSlot(24, 'chord') >= SLOTS.chord[0])
  ok('intoSlot folds a high note down', intoSlot(100, 'bass') <= SLOTS.bass[1])
  ok('intoSlot keeps pitch class', ((intoSlot(24, 'chord') - 24) % 12 + 12) % 12 === 0)
  ok('bass and chord slots do not collide', checkSlots({ b: 'bass', c: 'chord' }).length === 0)
  ok('two parts in one slot are flagged', checkSlots({ keys: 'chord', pad: 'chord' }).length === 1)
}

console.log('\narrangement')
{
  const plan = [
    { name: 'intro', bars: 8, want: ['bass'] },
    { name: 'build', bars: 8, want: ['bass', 'keys', 'kick', 'sub'] },   // 3 at once
    { name: 'peak', bars: 8, want: ['bass', 'keys', 'kick', 'sub', 'pad'] },
  ]
  const { sections, unresolved } = stagger(plan, { maxChurn: 2 })
  const churn = (a, b) => {
    const pa = new Set(a.layers)
    return b.layers.filter(x => !pa.has(x)).length + [...pa].filter(x => !b.layers.includes(x)).length
  }
  ok('no seam changes more than two layers', sections.every((s, i) => i === 0 || churn(sections[i - 1], s) <= 2),
    sections.map(s => s.layers.length).join('→'))
  ok('nothing was dropped to achieve it', sections[2].layers.length === 5)
  ok('it says so when it cannot comply', Array.isArray(unresolved))

  const d = densityArc([0.2, 0.5, 1.0, 0.3])
  ok('the sparsest section is genuinely sparse', Math.max(...d) / Math.min(...d) >= 1.8, d.join())
  ok('density stays a fraction', d.every(x => x > 0 && x <= 1))

  const notes = Array.from({ length: 16 }, (_, i) => ({ pitch: 60, beat: i * 0.25, durationBeats: 0.25, velocity: 80 }))
  const t = thin(notes, 0.25)
  ok('thin() keeps the requested share', t.length === 4, `${t.length}`)
  ok('thin() keeps the downbeat', t.some(n => n.beat === 0))
  ok('thin() returns notes in time order', t.every((n, i) => i === 0 || n.beat >= t[i - 1].beat))
}

console.log('\nmotif')
{
  const m = [{ pitch: 60, beat: 0, durationBeats: 1 }, { pitch: 64, beat: 1, durationBeats: 1 }]
  ok('transpose moves every note', motif.transpose(m, 5).every((n, i) => n.pitch === m[i].pitch + 5))
  ok('inversion mirrors around the axis', motif.invert(m, 60).map(n => n.pitch).join() === '60,56')
  ok('retrograde reverses the order', motif.retrograde(m)[0].pitch === 64)
  ok('augmentation stretches time', motif.augment(m, 2)[1].beat === 2)
  ok('an answer lands on chord tones', (() => {
    const tones = [2, 5, 9]       // D minor
    return motif.answer(m, tones).every(n => tones.map(t => t % 12).includes(((n.pitch % 12) + 12) % 12))
  })())
}

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
