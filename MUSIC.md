# Music Creator — making good music in 100Lights

A living guide for authoring music **through the program** (fully editable, no raw
synth patches). Written after building Petrichor, Rainy Window, Neon Skyline, and
the Måneskin tracks. Add to it as we learn more.

**North star:** make music someone would actually *listen to* — on a walk, on a
rainy day — not grid-locked "video game" loops. Two things separate the two:
**real, warm, sustaining sounds** and **composition that breathes** (space, long
notes, tension → release). Everything below serves those two.

---

## 0. The loop (build → hear → fix)

I can't literally listen, so every track goes through a measurable feedback loop:

1. **Compose deterministically** — a small Python generator emits a build-spec
   (tracks + clips + notes + `presetId` + `rollFx`). Music theory lives here.
2. **Build it in the program** — drive `window.__dawDispatch` (dev-only hook):
   `SET_TEMPO`, `SET_SWING`, `SET_TIME_SIG {num,den}` (e.g. 3/4 waltz),
   `ADD_TRACK`, `SET_INSTRUMENT {type:'none'}` (so the *clip preset* drives the
   sound), `ADD_EFFECT` (bus fx only), `SET_MASTER_VOLUME`.
   - **Build clips GRANULARLY so the History replay animates the construction.**
     For each clip dispatch an **empty** `ADD_CLIP` (`{...clip, notes: []}`,
     `kind:'midi'`, final `durationBeats` + `presetId` + `rollFx`), then one
     `ADD_MIDI_NOTE {clipId, note}` per note **in `startBeat` order**. Do it
     **track by track in composer order** (core/melody → foundation → layers →
     accents). This records one history entry per note (never coalesced), so the
     "History" panel (Transport → Capture → History) replays notes appearing one
     by one instead of a whole clip popping in. Keep total actions under ~5000
     (the buildLog cap). A single `ADD_CLIP` carrying all notes = a flat replay —
     don't do that.
3. **Hear it** — `window.__dawRenderWav({startBeat, endBeat, stems, mono})`
   bounces a slice to WAV; `python3 scripts/analyze-mix.py <render.json>` prints
   LUFS / peak / clipping / spectral balance / per-stem levels + hints. Render the
   **busiest section** (all instruments) for the truest read.
4. **Fix** through the program (`UPDATE_TRACK` volume, `UPDATE_CLIP` rollFx,
   `UPDATE_EFFECT`, `SET_MASTER_VOLUME`), re-render, repeat.
5. **Save** — snapshot via `__dawSnapshot()`, wrap in a `.cfproj` scaffold, write
   to `Content/Audio/` (+ Desktop backup). **Round-trip verify** by loading it
   back through `LOAD_PROJECT` and confirming 0 play errors.
6. **Push** when Brae asks.

> Render is real-time (a 16 s slice takes ~16 s). Keep analysis slices short.
> Real (soundfont) instruments fetch from a CDN on first play — do a throwaway
> "warm" render before the real one so notes aren't skipped mid-bounce.

Details of the render/analysis tooling: see `scripts/analyze-mix.py` header and
the mix-analysis notes in agent memory.

---

## 1. The palette — pick sounds that aren't shallow

Most built-in library presets are **procedurally synthesized at playtime** —
that's the thin, "video game" timbre, and their samples are short so they can't
hold long notes. For listenable music, reach for the **real sampled** ones first.

**Real sampled (FluidR3 soundfont — warm, organic, sustain long notes):**

| Preset | id | Good for |
|---|---|---|
| Grand Piano | `builtin-26` | the emotional core — melodies, chords |
| Warm Electric Piano | `builtin-27` | lo-fi / soul / jazzy comping |
| String Ensemble | `builtin-28` | sustained warmth, swells, pads of chords |
| Choir Aahs | `builtin-29` | atmosphere, emotional lift |
| Warm Pad | `builtin-30` | ambient bed under everything |
| Music Box | `builtin-31` | delicate high accents (rainy-day twinkle) |
| Orchestral Harp | `builtin-32` | glissandos, arpeggios, neoclassical shimmer |
| Nylon / Steel / Clean-Electric Guitar | `builtin-33/34/35` | fingerstyle, folk, clean comping |
| Vibraphone | `builtin-36` | jazzy mellow mallet |
| Marimba | `builtin-37` | warm wooden mallet |
| Glockenspiel | `builtin-38` | bright bell twinkle |
| Kalimba | `builtin-39` | organic thumb-piano pluck |
| Solo Violin | `builtin-40` | expressive bowed lead / countermelody |
| Pizzicato Strings | `builtin-41` | plucked-string rhythm & arrangement color |
| Oboe | `builtin-42` | plaintive wind lead |
| Pan Flute | `builtin-43` | airy, breathy melody |
| Church Organ | `builtin-44` | cathedral swell, sustained pads |
| Harpsichord | `builtin-45` | baroque plucked keys |
| Electric / Acoustic Bass, Cello, Flute, Clarinet, Trumpet… | `builtin-17..25` | real bass/strings/wind |

**Synth-rendered (bright, immediate — fine for electronic/lo-fi flavor, but read
"video game" if used for everything):** Rhodes `2`, Synth Lead `3`, Synth Bass
`4`, Synth Pad `12`, etc. Great as *color*, not as the whole track.

**Drums:** the `drum` instrument, `pack: 'synth' | '808'`. Often *omit drums
entirely* for ambient/neoclassical — that alone stops it sounding like a "beat."

> ~120 more General MIDI instruments live on the same soundfont CDN and can be
> added the same way (see `lib/default-samples.ts` `SOUNDFONT_PACKS` +
> `lib/midi-presets.ts` `BUILT_IN`, append only). Candidates worth adding: nylon
> guitar, harp, glockenspiel, vibraphone, ocarina/pan flute, cello section.
>
> Soundfont renders are peak-normalized (`renderSoundfont`) so they're not ~15 dB
> quieter than the synth ones — but they still read a touch quiet, so **ride the
> lead up** (`rollFx.gain` up to 2.0) and let the mix loop confirm.

---

## 2. Composition — what actually makes it *music*

This is the hard part and where "a beat" becomes a song. Following a chord
progression on a grid is not enough.

- **Space & silence.** Don't fill every beat. Rests create tension; let notes
  ring into the reverb. Sparse beats *listenable*. (Petrichor = 275 notes over
  2:00; the busy tracks were ~1,000.)
- **Long notes.** Use sustaining instruments (piano/strings/choir/pad) and write
  whole-/multi-bar notes. This is exactly what short one-shot samples can't do.
- **Tension → release.** The core of feeling:
  - Suspensions that resolve (`sus4 → 3`, `sus2 → 3`).
  - A **held dominant** (V or Vsus) before resolving to the tonic.
  - A **pedal tone** held under moving chords (clashes, then releases).
  - A dissonant/high note held over a bar, then resolved downward.
- **Dynamics.** Swell in with a slow `attack` + rising velocities; build sections
  and then strip back; bring instruments **in and out** rather than all at once.
- **Arrangement shape.** intro (sparse) → build → peak → resolve/outro with a
  reverb tail. Change instrumentation per section so it goes somewhere.
- **Humanize.** Vary velocities (downbeats a little louder), avoid robotic
  uniformity, add swing for lo-fi, consider being drumless.
- **Fit palette to vibe.** lo-fi = Rhodes + warm bass + soft swing; ambient /
  neoclassical = piano + strings + choir, drumless; synth-pop = synth presets +
  drums; rock = driven guitar tones.

---

## 3. Sound shaping (per-clip `rollFx`)

The clip's `rollFx` bag *is* its sound, and it's fully editable in the Sound
panel afterward. Useful keys: `gain`, `sustain` (release ring), `reverbWet` /
`reverbSize`, `attack` / `decay` / `sustainLevel`, `filterHz` (low-pass),
`highpassHz`, `drive` / `distortion` / `bitcrush`, `delayWet` / `delayTime` /
`delayFeedback`, `chorusDepth`, EQ (`sub`/`bass`/`mid`/`treble`), `pan` / `width`,
`vibratoDepth`. There are also curated **Tone presets** per instrument in the
Sound panel (Guitar → Rock/Metal/Punk, etc.).

Atmospheric starting points that worked in Petrichor:
- Piano: `{reverbWet:0.32, reverbSize:0.7, sustain:1.2, gain:1.8}`
- Strings/Choir: big reverb + slow `attack` (0.4–0.7) so they swell in.
- Pad: `{reverbWet:0.5, filterHz:3500}` — subliminal bed.
- Music Box: reverb + a slap `delay`.

---

## 4. Mixing (read the meters, trust your eyes)

Render the busiest section with `stems:true`, then in the report watch:
- **Clipping** — master `peak ≥ -0.1 dBFS` or any `clip%`. Fix by trimming the
  loud parts (usually bass/drums) or the master, not by ear-guessing.
- **Buried parts** — a stem's LUFS far below the master. The **lead should be the
  most prominent** melodic element; bass felt, not booming.
- **Spectral balance** — muddy (`>45%` under 120 Hz), boxy (`>48%` 120–400 Hz),
  harsh (`>40%` over 2 kHz), dark (`<4%` over 2 kHz).
- **Absolute level doesn't matter much** — a project can sit at ~-18 to -22 LUFS;
  export normalizes to target. Chase *relative balance* and *no clipping*.
- **Genre caveat:** the "boxy/dark" hints are tuned for pop. Warm/dark/mid-forward
  is *correct* for lo-fi and ambient — don't EQ the soul out of it. (And EQ can't
  add highs the source doesn't have; pick a brighter instrument instead.)

---

## 5. Reference tracks (`Content/Audio/`)

- **`petrichor.cfproj`** — rainy-day neoclassical: real piano + strings + choir +
  pad + music box, drumless, real tension/release. **The template for
  "listenable."**
- **`rainy-window.cfproj`** — lo-fi / chillhop: Rhodes, warm bass, swing.
- **`neon-skyline.cfproj`** — synth-pop: synth presets + drums, uplifting.
- **`maneskin-rock*.cfproj`** — rock: driven guitar tones + drums.

---

## 6. Ideas to build on (open backlog)

- Add still more real GM instruments (ocarina, shakuhachi, dulcimer, banjo,
  sitar, tremolo/bowed-pad strings, timpani, drawbar/rock organ) — same
  soundfont pipeline. (20 real instruments wired so far: `builtin-26..45`.)
- Foley / atmosphere layers (rain, vinyl crackle, room tone) — needs CC0 samples.
- Micro-timing + velocity humanization (a "feel" pass) so it's less quantized.
- Tempo/rubato and key changes; motif development across a longer form.
- A song-spec loader (`__dawLoadSpec`) so composition happens at the musical
  level (chords/sections/named tones) instead of raw MIDI in a Python script.
- Deliberate stereo width / panning for depth (renders are mono-analyzed today).
- An offline (non-real-time) render path so full-song analysis is instant.

---

*Keep this current: when a technique works (or doesn't), add a line. The goal is
that the next session can pick up and make something better than the last.*
