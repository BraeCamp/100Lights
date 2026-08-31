// Deterministic randomness for anything that ends up in the audio.
//
// Brae: "Let's see what we can do to make sure that the song never sounds
// different on another machine."
//
// Random numbers in a render are a determinism bug wearing a feature's clothes.
// `Math.random()` in the audio path means the same song produces different
// audio every time it is rendered — on another machine, and on the same one two
// seconds later. That breaks three things at once: a cached render no longer
// matches a fresh one, a render made on the server no longer matches the
// listener's own, and a mix you measured is not the mix you measured.
//
// The fix is not to remove the randomness — noise IRs and humanized velocities
// need it and it is what makes them sound right. It is to make it a FUNCTION OF
// THE SONG rather than of the moment: same input, same numbers, forever. The
// reverb still has a random-noise tail; it is just the SAME random-noise tail
// everywhere.
//
// Apollo's Helios worklet already worked this way (`makeRng` + the `reseed`
// message, public/apollo/engine.js) — which is exactly why the render
// determinism check passes bit-for-bit on an Apollo patch and why the drift was
// only ever on the DAW side. This is the same xorshift, so the two halves of
// the app share one notion of "random".

/** xorshift32 — deterministic per seed, and fast enough for filling buffers. */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0 || 1
  return function () {
    s ^= s << 13; s >>>= 0
    s ^= s >> 17
    s ^= s << 5; s >>>= 0
    return s / 4294967296
  }
}

/**
 * A stable 32-bit seed from any string (FNV-1a).
 *
 * Use it to derive a seed from what the sound IS — a reverb's decay and
 * channel, a note's id — so the same musical thing always draws the same
 * numbers. Never seed from a clock, a counter, or an object identity: those
 * are properties of the run, not of the song.
 */
export function seedFrom(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/** `makeRng(seedFrom(key))` — the common case, in one call. */
export const rngFor = (key: string): (() => number) => makeRng(seedFrom(key))
