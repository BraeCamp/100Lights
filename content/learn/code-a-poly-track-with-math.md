---
title: "Code a poly track with math"
description: "Generate melodies, basslines, arps and chords in the 100Lights studio by writing a few lines of math. A friendly guide to the Code panel — scales, notes, chords and euclidean rhythms."
date: "2026-07-19"
draft: false
tags: ["synthesis", "midi", "coding", "poly"]
---

The **poly** instrument in 100Lights isn't a sample — it's a synthesizer built
from oscillators, a filter and an envelope, played live in your browser. That
means a poly track is really just two things: **a patch** (the synth settings)
and **notes** (the MIDI). And if it's just data, you can generate it with math.

The **Code** tab in the sound library (next to *Samples* and *Recipes*) lets you
do exactly that: write a short script, hit **Run**, and **Add track**. It runs
safely in a background worker, so a runaway loop can't freeze the studio.

## The idea

Your script returns an object describing a track:

```js
return {
  name: 'My Bass',
  patch: { waveform: 'sawtooth', cutoff: 700, resonance: 6 },
  length: 8,            // loop length in beats
  notes: [ /* ... */ ], // the MIDI
};
```

Notes are made with the `note()` helper — the same pitch/beat/velocity model the
piano roll uses:

```js
note(pitch, startBeat, durationBeats, velocity)
// pitch: MIDI number (60 = middle C)   velocity: 1–127 (default 100)
```

So a single kick-drum-simple bass note on beat 1 is `note(36, 0, 1, 120)`.

## Helpers you can use

| Helper | What it does |
|---|---|
| `pitch('A', 3)` | Note name + octave → MIDI number (A3 = 57) |
| `scale(root, name)` | A scale you can index by degree (see below) |
| `note(pitch, start, dur, vel)` | One note |
| `chord(start, dur, [p1,p2,p3], vel)` | Several notes at once |
| `euclid(steps, pulses)` | A boolean rhythm — `pulses` hits spread evenly over `steps` |
| `seq("0 2 4")` | A **pattern** of degrees (see combinators below) |
| `rhythm("x..x")` | A boolean rhythm from a string (`x`/`1` = hit) |
| `rand(seed)` | A seeded random function → reproducible tracks |
| `tempo`, `bars` | The project's tempo and loop length |
| `Math` | The full JavaScript `Math` object |

### Pattern combinators

`seq(...)` gives you a pattern you can transform, then turn into notes:

```js
seq("0 2 4 6")          // degrees (use _ or . for a rest)
  .repeat(2)            // play it twice
  .rev()               // reversed
  .add(7)              // transpose every degree up a scale-octave
  .euclid(5)           // keep only 5 evenly-spread hits
  .notes(scale(pitch('A',3),'minor'), { step: 0.5, dur: 0.4, vel: 90 });
```

`.notes()` takes a scale and `{ start, step, dur, vel }`; `vel` may be a function
of the step index. Everything returns a new pattern, so combinators chain.

Scales support `major`, `minor`, `dorian`, `phrygian`, `lydian`, `mixolydian`,
`locrian`, `harmonic`, `penta-min`, `penta-maj`, `blues`, `chromatic`.

`scale()` gives you a `.note(degree)` function. Degrees are 0-indexed and wrap
across octaves, so you never play a wrong note:

```js
const s = scale(pitch('A', 3), 'minor');
s.note(0);  // A3  (root)
s.note(2);  // C4  (third)
s.note(7);  // A4  (octave up)
s.note(-1); // G3  (below the root)
```

## Example 1 — an arpeggio

```js
const s = scale(pitch('A', 3), 'minor');
const degrees = [0, 2, 4, 6, 4, 2];  // degrees to cycle
const notes = [];
for (let step = 0; step < 32; step++) {
  const deg = degrees[step % degrees.length];
  notes.push(note(s.note(deg), step * 0.5, 0.45, 90));  // an 8th-note grid
}
return {
  name: 'Math Arp',
  patch: { waveform: 'square', cutoff: 2200, resonance: 4, decay: 0.2, sustain: 0.3 },
  length: 16,
  notes,
};
```

## Example 2 — a euclidean bassline

`euclid(16, 7)` spreads 7 hits evenly across 16 sixteenth-notes — an instant
groove:

```js
const root = pitch('E', 1);
const hits = euclid(16, 7);
const notes = [];
for (let i = 0; i < hits.length; i++) {
  if (hits[i]) notes.push(note(root, i * 0.5, 0.4, 112));
}
return {
  name: 'Euclid Bass',
  patch: { waveform: 'sawtooth', cutoff: 600, resonance: 6, detune: 8, release: 0.2 },
  length: 8,
  notes,
};
```

## Example 3 — a chord progression

`chord()` returns several notes at once; you can push whole chords into `notes`
and they get flattened for you:

```js
const s = scale(pitch('C', 3), 'minor');
const roots = [0, 5, 2, 6];          // i – VI – III – VII (as scale degrees)
const notes = [];
roots.forEach((r, bar) => {
  const triad = [s.note(r), s.note(r + 2), s.note(r + 4)];
  notes.push(chord(bar * 4, 3.8, triad, 70));
});
return {
  name: 'Chord Pad',
  patch: { waveform: 'sawtooth', cutoff: 1400, attack: 0.4, release: 0.9 },
  length: 16,
  notes,
};
```

## The patch

Anything you leave out of `patch` falls back to a sensible default. The knobs
map onto the poly synth:

| Field | Range | Meaning |
|---|---|---|
| `waveform` | `sine` / `square` / `sawtooth` / `triangle` | Oscillator shape |
| `attack` / `decay` / `release` | seconds | Envelope times |
| `sustain` | 0–1 | Held level |
| `detune` | cents | Fatten / drift |
| `cutoff` | 20–20000 Hz | Low-pass filter frequency |
| `resonance` | 0.1–20 | Filter emphasis (Q) |
| `filterType` | `lowpass` / `highpass` / `bandpass` / `notch` | Filter type |
| `lfoEnabled`, `lfoRate`, `lfoDepth`, `lfoTarget` | — | Movement (`pitch`/`filter`/`amp`) |

## Tips

- **Beats, not seconds.** Positions and durations are in beats; the tempo does
  the rest. Beat `0` is the start of the loop.
- **`length`** is your loop length in beats — a 4-bar loop in 4/4 is `16`.
- Everything is a plain array of numbers, so lean on `for` loops, `map`,
  `Math.sin`, `Math.random`, and `%` to make patterns.
- Once you **Add track**, it opens in the piano roll — tweak notes by hand from
  there, or change the patch on the track.

## Editing an existing sound

Select a poly track and press **Edit “…”** in the Code panel — it fills the
editor with that track's current `patch` (and notes) as code. Tweak the sound or
the pattern and press **Save to track** to apply the changes in place (instead of
adding a new track). Press **New** to go back to creating.

Because a poly track is pure synthesis, what you code is exactly what plays —
no samples to load. Have fun turning math into music.
