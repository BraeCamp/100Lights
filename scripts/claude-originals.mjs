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

  // The dark-minimal set — "Undertow", "Low Ceiling" and "Glass Floor" — used to
  // live here as chord arrays with a `melody` line, played twice. They were
  // rewritten from scratch as full arrangements and no longer fit this shape,
  // for two reasons: the `melody` field is a lead line, which the standing rule
  // rules out program-wide, and a song built as one clip per track can't carry
  // an arc or be edited section by section.
  //
  // They now live as their own authoring scripts, which emit real per-section
  // clips and FX-lane dynamics:
  //   scripts/song-undertow.mjs    · G minor, 122, two-step
  //   scripts/song-lowceiling.mjs  · C# minor, 86, half-time
  //   scripts/song-glassfloor.mjs  · A dorian, 124, four-on-the-floor
  // sharing scripts/song-kit.mjs, and verified with song-sections.mjs / song-solo.mjs.
}
