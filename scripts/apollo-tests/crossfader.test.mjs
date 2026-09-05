// The crossfader's arithmetic (lib/crossfader.ts): equal-power between A and
// B, a track on neither side ignores it, and the position reads back the way
// a person says it. The engine's gain is checked by ear in .claude/arr-mixer-check.mjs.
import assert from 'node:assert/strict'
import { importTs } from '../lib/ts-import.mjs'

const { crossfadeGain, describeCrossfader, CROSSFADER_CURVES, CURVE_LABEL, CURVE_HELP } = await importTs('lib/crossfader.ts')

let failures = 0
const check = (label, fn) => {
  try { fn(); console.log(`PASS ${label}`) }
  catch (e) { failures++; console.log(`FAIL ${label}\n   ${e.message}`) }
}
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`)

check('A is full at 0 and silent at 1; B the other way round', () => {
  near(crossfadeGain('A', 0), 1); near(crossfadeGain('A', 1), 0)
  near(crossfadeGain('B', 0), 0); near(crossfadeGain('B', 1), 1)
})
check('equal power at the centre: both sides at −3 dB, summing to one', () => {
  const a = crossfadeGain('A', 0.5), b = crossfadeGain('B', 0.5)
  near(a, Math.SQRT1_2, 1e-9); near(b, Math.SQRT1_2, 1e-9)
  near(a * a + b * b, 1, 1e-9)
})
check('a track on neither side ignores the fader', () => {
  near(crossfadeGain('none', 0), 1); near(crossfadeGain(undefined, 1), 1)
})
check('a bad position reads as the centre; out of range clamps', () => {
  near(crossfadeGain('A', NaN), Math.SQRT1_2, 1e-9)
  near(crossfadeGain('B', 7), 1)
})
check('the position, said back', () => {
  assert.equal(describeCrossfader(0.5), 'centre')
  assert.equal(describeCrossfader(0), 'A')
  assert.equal(describeCrossfader(1), 'B')
  assert.equal(describeCrossfader(0.75), '50% B')
  assert.equal(describeCrossfader(0.3), '40% A')
})


// ── The shape of the fade ────────────────────────────────────────────────────
// Five curves, named for what they do rather than after another program's list.
{
  const near = (a, b, eps = 0.02) => Math.abs(a - b) < eps

  check('every curve is silent at the far end and full at its own', () => {
    for (const c of CROSSFADER_CURVES) {
      assert.ok(near(crossfadeGain('A', 0, c), 1), `${c} A at 0`)
      assert.ok(near(crossfadeGain('A', 1, c), 0), `${c} A at 1`)
      assert.ok(near(crossfadeGain('B', 1, c), 1), `${c} B at 1`)
      assert.ok(near(crossfadeGain('B', 0, c), 0), `${c} B at 0`)
    }
  })

  check('and none of them ever goes above unity', () => {
    for (const c of CROSSFADER_CURVES) {
      for (let v = 0; v <= 1.0001; v += 0.05) {
        assert.ok(crossfadeGain('A', v, c) <= 1.0001 && crossfadeGain('B', v, c) <= 1.0001, `${c} at ${v.toFixed(2)}`)
      }
    }
  })

  check('the middle is what tells them apart', () => {
    // Equal power holds both at ~0.71 so the sum is as loud as one end.
    assert.ok(near(crossfadeGain('A', 0.5, 'equal-power'), Math.SQRT1_2))
    // Linear holds both at 0.5 — the levels add, so a mono source is louder.
    assert.ok(near(crossfadeGain('A', 0.5, 'linear'), 0.5))
    // Slow fade keeps more of both; fast cut keeps less.
    assert.ok(crossfadeGain('A', 0.5, 'slow-fade') > crossfadeGain('A', 0.5, 'equal-power'))
    assert.ok(crossfadeGain('A', 0.5, 'fast-cut') < crossfadeGain('A', 0.5, 'equal-power'))
  })

  check('hard cut is a switch, not a fade', () => {
    assert.equal(crossfadeGain('A', 0.49, 'hard-cut'), 1)
    assert.equal(crossfadeGain('A', 0.51, 'hard-cut'), 0)
    assert.equal(crossfadeGain('B', 0.51, 'hard-cut'), 1)
  })

  check('a track on neither side ignores the curve entirely', () => {
    for (const c of CROSSFADER_CURVES) assert.equal(crossfadeGain('none', 0.2, c), 1)
    assert.equal(crossfadeGain(undefined, 0.2, 'hard-cut'), 1)
  })

  check('each one is named and explained', () => {
    for (const c of CROSSFADER_CURVES) {
      assert.ok(CURVE_LABEL[c]?.length > 3, c)
      assert.ok(CURVE_HELP[c]?.length > 20, c)
    }
    assert.equal(CROSSFADER_CURVES.length, 5)
  })
}

console.log(failures ? `\n${failures} failing` : '\nboth sides add up')
process.exit(failures ? 1 : 0)
