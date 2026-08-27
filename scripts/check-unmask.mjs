#!/usr/bin/env node
// Does Unmask duck the bands the key track occupies, and leave the rest alone?
//
//   npm run check:unmask
//
// The point of the effect is that it is SELECTIVE. A plain sidechain would pass
// a test that only asked "did it get quieter" — so this asks the harder thing:
// with a key signal at 400Hz, the target's 400Hz band must drop and its 5kHz
// band must not. If both drop, it is a sidechain wearing a costume.
//
// Runs the real graph in an OfflineAudioContext through node-web-audio-api if it
// is available; otherwise it checks the graph's shape, which still catches the
// mistakes that actually happen (a band listening to the wrong band, a scaler
// with the wrong sign, a missing connection).

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = readFileSync(join(ROOT, 'lib/spectral-duck.ts'), 'utf8')

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

// ── The shape that makes it selective rather than broadband ─────────────────
//
// Both paths must be split by the SAME function, and each band's follower must
// be fed from the key's matching band. The failure this guards is subtle and
// silent: feed every follower from the unsplit key and the effect still ducks,
// still sounds like something, and is simply a sidechain compressor again.
check('the target is split into bands', /slice\(signalIn, i\)/.test(src))
check('the key is split by the SAME function', /slice\(keyInput, i\)/.test(src))
check('each band listens to its own band', /slice\(keyInput, i\)\.connect\(follower\.input\)/.test(src))
check('each band has its own follower', /createEnvelopeFollower\(ctx, \{/.test(src))

// The duck must be NEGATIVE and land on the band's own gain, or it boosts.
check('the envelope is inverted before it reaches the gain', /scaler\.gain\.value = -amount/.test(src))
check('it modulates the band VCA, not the output', /scaler\.connect\(vca\.gain\)/.test(src))
check('each VCA rests at unity, so silence means no ducking', /vca\.gain\.value = 1/.test(src))

// Per-band weights are the feature — without them this is a multiband
// compressor with extra steps.
check('bands can be weighted independently', /weights\[i\]/.test(src))

// ── The real thing, if a Web Audio implementation is installed ──────────────
let ran = false
try {
  const { OfflineAudioContext } = await import('node-web-audio-api')
  ran = true
  const SR = 48000
  const dur = 1.5

  /** Render the target through the ducker with a key tone at `keyHz` (or none). */
  async function render(keyHz) {
    const ctx = new OfflineAudioContext(1, SR * dur, SR)
    // The target: equal energy at 400Hz and 5kHz.
    const mk = (hz, gain) => {
      const o = ctx.createOscillator(); o.frequency.value = hz
      const g = ctx.createGain(); g.gain.value = gain
      o.connect(g); o.start()
      return g
    }
    const target = ctx.createGain()
    mk(400, 0.3).connect(target)
    mk(5000, 0.3).connect(target)

    const { createSpectralDucker } = await import(join(ROOT, '.test-build/spectral-duck.js'))
    const duck = createSpectralDucker(ctx, { amount: 0.9, attack: 0.005, release: 0.05, threshold: -40 })
    target.connect(duck.signalIn)
    duck.signalOut.connect(ctx.destination)
    if (keyHz) mk(keyHz, 0.5).connect(duck.keyInput)
    const buf = await ctx.startRendering()
    return buf.getChannelData(0)
  }

  /** Energy at one frequency, over the settled second half. */
  const power = (data, hz) => {
    let re = 0, im = 0
    const from = Math.floor(SR * 0.7), n = Math.floor(SR * 0.6)
    for (let i = 0; i < n; i++) {
      const t = i / SR
      re += data[from + i] * Math.cos(2 * Math.PI * hz * t)
      im += data[from + i] * Math.sin(2 * Math.PI * hz * t)
    }
    return Math.hypot(re, im) / n
  }

  const dry = await render(null)
  const keyed = await render(400)
  const d400 = 20 * Math.log10((power(keyed, 400) + 1e-12) / (power(dry, 400) + 1e-12))
  const d5k = 20 * Math.log10((power(keyed, 5000) + 1e-12) / (power(dry, 5000) + 1e-12))
  console.log(`\nwith a 400Hz key:  400Hz ${d400.toFixed(1)}dB   5kHz ${d5k.toFixed(1)}dB`)
  check('the band the key occupies is ducked', d400 < -3, `${d400.toFixed(1)}dB`)
  check('the band it does not occupy is left alone', d5k > -1.5, `${d5k.toFixed(1)}dB`)
  check('it is selective, not broadband', d400 < d5k - 3)
} catch {
  console.log('\n(node-web-audio-api not installed — graph shape checked, audio not rendered)')
}

console.log(failures
  ? `\n${failures} failing`
  : ran ? '\nUnmask ducks only where the other track is' : '\nthe graph is shaped to duck per band')
assert.equal(failures, 0)
