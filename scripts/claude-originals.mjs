// Original songs composed directly by Claude (not the compose engine, not public-domain sheets).
// Same [pitch,beat,dur] + per-bar chords shape sheet-accompany builds from — but every note here is
// original: crafted hook motifs over intentional minor-key progressions, chord tones on strong beats
// with passing tones between, a two-phrase shape (statement + a higher answer that resolves home).
// Middle C = 60.

export const ORIGINALS = {
  // "Nightfall" — lo-fi / downtempo in F minor. Loop: i – VI – III – VII (Fm–Db–Ab–Eb), warm + jazzy.
  nightfall: {
    title: 'Nightfall (original)', tempo: 78, beatsPerBar: 4, pickup: 0, drums: true, padOct: 3, repeats: 2,
    chords: ['Fm', 'Db', 'Ab', 'Eb', 'Fm', 'Db', 'Ab', 'Eb'],
    melody: [
      // phrase A — a laid-back statement
      [72,0,1],[68,1.5,0.5],[65,2,1],[67,3,1],          // C  Ab  F  G   (over Fm)
      [65,4,1],[68,5,1],[70,6,2],                        // F  Ab  Bb  (over Db — Bb is its 6th)
      [72,8,1],[70,9,0.5],[68,9.5,0.5],[75,10,2],        // C  Bb  Ab  Eb (over Ab — Eb is its 5th)
      [67,12,1],[65,13,1],[63,14,2],                     // G  F  Eb (over Eb — resolves)
      // phrase B — a higher answer that climbs then settles home
      [68,16,1],[72,17,1],[77,18,2],                     // Ab  C  F5  (over Fm — the peak)
      [75,20,1],[73,21,1],[72,22,2],                     // Eb  Db  C  (over Db)
      [72,24,1],[70,25,1],[68,26,2],                     // C  Bb  Ab (over Ab)
      [67,28,2],[65,30,2],                               // G  F   (over Eb — hangs on the 9th, loops back)
    ],
  },

  // "Neon Highway" — synthwave in A minor. Loop: i – VI – III – VII (Am–F–C–G), anthemic + driving.
  neon_highway: {
    title: 'Neon Highway (original)', tempo: 102, beatsPerBar: 4, pickup: 0, drums: true, padOct: 3, repeats: 2,
    chords: ['Am', 'F', 'C', 'G', 'Am', 'F', 'C', 'G'],
    melody: [
      // phrase A
      [76,0,1.5],[74,1.5,0.5],[72,2,2],                  // E  D  C   (over Am)
      [69,4,1],[72,5,1],[77,6,2],                        // A  C  F5  (over F — its root, soaring)
      [79,8,1],[76,9,1],[72,10,2],                       // G  E  C   (over C — resolves to its root)
      [74,12,1],[71,13,1],[74,14,2],                     // D  B  D   (over G — its 5th)
      // phrase B — lift to the octave, then walk back down home
      [76,16,1],[81,17,3],                               // E  A5    (over Am — the big hold)
      [79,20,1],[77,21,1],[76,22,2],                     // G  F  E   (over F)
      [76,24,1],[74,25,1],[72,26,2],                     // E  D  C   (over C)
      [71,28,1],[74,29,1],[76,30,2],                     // B  D  E   (over G — leads back into Am)
    ],
  },

  // ── Dark minimal set ──────────────────────────────────────────────────────
  // Written against MEASURED targets, not an impression of a style: 83
  // commercially-licensed Jamendo references in this genre space came out at a
  // folded tempo median of 116 (q25 85 / q75 123 — the space is bimodal, a
  // half-time cluster and a driving one), 0.82 of energy below 200Hz, and a
  // spectral centroid of 458Hz. So: bass-forward, dark, and written to loop
  // rather than travel. Pads sit low (padOct 2) to hold that bass ratio.
  //
  // Every note is original. The harmony is deliberately restrained — two chords
  // held for most of a phrase — because space is the point in this idiom; the
  // motifs are short and syncopated so the bass carries the movement.

  // "Undertow" — G minor at 122bpm, the driving cluster. Garage-leaning:
  // off-grid sixteenths, a riff that answers itself an octave up.
  undertow: {
    title: 'Undertow (original)', tempo: 122, beatsPerBar: 4, pickup: 0, drums: true, padOct: 2, repeats: 2,
    chords: ['Gm', 'Gm', 'Eb', 'Eb', 'Gm', 'Gm', 'Bb', 'F'],
    melody: [
      // phrase A — the riff, low and clipped, most of the bar left empty
      [70,0,0.5],[74,0.75,0.25],[70,1.5,0.5],[67,2.5,1.5],   // Bb D Bb G   (over Gm)
      [67,4.5,0.5],[70,5.5,0.5],[74,6,1.5],                  // G  Bb D     (over Gm)
      [75,8,1],[70,9.5,0.5],[67,10.5,1.5],                   // Eb Bb G     (over Eb — all chord tones)
      [70,12.5,0.5],[75,13,1],[74,14.5,1.5],                 // Bb Eb D     (D leans back into Gm)
      // phrase B — the same shape answered higher, then walked home
      [74,16,0.5],[79,17,1],[74,18.5,0.5],[70,19,1],         // D  G5 D  Bb (over Gm)
      [70,20.5,0.5],[74,21.5,0.5],[79,22,2],                 // Bb D  G5    (the hold)
      [77,24,1],[74,25.5,0.5],[70,26.5,1.5],                 // F  D  Bb    (over Bb — root, 3rd, 5th)
      [72,28,1],[69,29,1],[65,30,2],                         // C  A  F     (over F — settles on its root)
    ],
  },

  // "Low Ceiling" — C# minor at 86bpm, the half-time cluster. Long notes, wide
  // gaps; the darkest of the three. No major chord anywhere in the loop.
  low_ceiling: {
    title: 'Low Ceiling (original)', tempo: 86, beatsPerBar: 4, pickup: 0, drums: true, padOct: 2, repeats: 2,
    chords: ['C#m', 'C#m', 'A', 'A', 'F#m', 'F#m', 'G#m', 'G#m'],
    melody: [
      // phrase A — held tones, almost no movement
      [68,0,2],[64,2.5,1.5],                                 // G# E        (over C#m)
      [61,4,3],[64,7,1],                                     // C#(held) E  (over C#m)
      [69,8,2],[73,10.5,1.5],                                // A  C#       (over A)
      [76,12,2],[73,14.5,1.5],                               // E  C#       (over A)
      // phrase B — steps down through the relative minor and settles
      [73,16,1.5],[69,18,2],                                 // C# A        (over F#m)
      [66,20,3],[69,23,1],                                   // F#(held) A  (over F#m)
      [71,24,2],[75,26.5,1.5],                               // B  D#       (over G#m)
      [68,28,3],[64,31,1],                                   // G#(held) E  (E turns it back to C#m)
    ],
  },

  // "Glass Floor" — A minor at 124bpm, four-on-floor. Pulsing and repetitive by
  // design: the same three-note cell moved through the chords, lifted an octave
  // for the second half.
  glass_floor: {
    title: 'Glass Floor (original)', tempo: 124, beatsPerBar: 4, pickup: 0, drums: true, padOct: 2, repeats: 2,
    // Two bars per chord, like the other two. Changing every bar made this the
    // busiest of the set and measured 0.65 bass ratio against a 0.755 floor —
    // harmonic churn fills the mids in an idiom that is supposed to loop and
    // leave the low end exposed.
    chords: ['Am', 'Am', 'F', 'F', 'Dm', 'Dm', 'Em', 'Em'],
    melody: [
      // phrase A — one falling cell, transposed to each chord's own tones
      [76,0,0.5],[72,1,0.5],[69,2,1.5],                      // E  C  A     (over Am)
      [72,4,0.5],[69,5,0.5],[65,6,1.5],                      // C  A  F     (over F)
      [69,8,0.5],[65,9,0.5],[62,10,1.5],                     // A  F  D     (over Dm)
      [69,12,1],[72,13.5,0.5],[76,14,1.5],                   // A  C  E     (over Am — the cell inverted)
      // phrase B — the cell restated on each chord's ROOT rather than lifted an
      // octave. The octave version measured a 0.649 bass ratio against a 0.755
      // floor for this genre: the lift pulled energy up out of the low end the
      // whole idiom is built on. The contrast is now the descending root motion
      // (A - F - D - E) instead of register.
      [69,16,1],[76,17.5,0.5],[72,18,1.5],                   // A  E  C     (over Am)
      [65,20,1],[72,21.5,0.5],[69,22,1.5],                   // F  C  A     (over F)
      [62,24,1],[69,25.5,0.5],[65,26,1.5],                   // D  A  F     (over Dm)
      [71,28,1],[67,29.5,0.5],[64,30,2],                     // B  G  E     (over Em — leads back to Am)
    ],
  },
}
