// Test on the machine the software is actually used on, not the one it is
// written on.
//
// Brae's diagnose put his cost model at 23.18 ms per unit of audio against 8.88
// on this machine — roughly a third of the speed. Every timing bug in the
// loading path has been invisible here and obvious there, because the failures
// are all races between a render and a deadline: contexts not reclaimed in
// time, windows overrunning their budget, a backoff that never triggers, a
// cache that only fills on a machine slow enough to still be rendering when the
// next request arrives.
//
// `SLOW=3 node scripts/check-*.mjs` runs the check on a machine a third as
// fast, using Chrome's own CPU throttling rather than a sleep — sleeping would
// slow the TEST, this slows the code under test.

/**
 * Throttle the page's CPU. `rate` is a divisor: 3 means "a third of the speed".
 * Returns the rate actually applied, so a caller can report it honestly.
 */
export async function slowDown(page, rate = Number(process.env.SLOW || 1)) {
  const r = Number(rate) || 1
  if (r <= 1) return 1
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: r })
  return r
}

/** "on a machine 3x slower" — for a test's own output. */
export function slowLabel(rate = Number(process.env.SLOW || 1)) {
  const r = Number(rate) || 1
  return r > 1 ? `CPU throttled ${r}x (a ${r === 3 ? 'third' : `1/${r}`} of this machine)` : 'full speed'
}
