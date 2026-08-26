# Making music in 100Lights

How songs get written here, what the tools are for, and the things that are true
whether or not anyone remembers them.

**North star:** music someone would choose to listen to. The bar Brae set is
ElevenLabs — not "good for a generator", actually good — with the difference that
every note here stays editable in the program, and it costs nothing per song.

**The one rule that shapes everything else:** I cannot hear. Every judgement in
this document is a measurement, every measurement has a tool, and every tool has
a test that proves it against a signal whose answer is known before it is allowed
to say anything about a song. Where something is still a matter of taste it says
so. Where a number came from a reference recording rather than an opinion, it
says that too.

---

## The loop

```
write a song script  →  node scripts/listen.mjs <song.cfproj> --target=general
                            renders offline, measures, and tells you what is wrong
```

**Fifteen seconds for a two-minute song**, with every stem written out. It needs
no dev server, no browser and nothing running.

That number is the point. It used to be 2m20s through a real-time browser bounce,
and checking a single track alone cost another full render — seventeen minutes to
verify seven tracks, so in practice it never happened and songs shipped judged on
one number computed over their whole length. At fifteen seconds you can afford to
be wrong twenty times, which is what writing music actually requires.

### The tools

| | |
|---|---|
| `scripts/listen.mjs` | **Start here.** Render + measure + ranked verdict, one command. |
| `scripts/song-render.mjs` | Whole `.cfproj` → mix and stems, offline, ~9x real time. |
| `scripts/voice-audit.mjs` | What each voice sounds like, what the palette cannot reach, and whether anything is out of tune. |
| `scripts/voice-calibrate.mjs` | Level-match the palette so a fader means the same thing on every instrument. |
| `scripts/build-targets.mjs` | Measure reference music and write out what "normal" is. |
| `scripts/check-notes.mjs` | Note validity, key fit and polyphony, from the notes alone. |
| `scripts/check-tuning.mjs` | Per-track pitch of a finished song, in cents. |
| `scripts/craft.test.mjs`, `audio-features.test.mjs` | Prove the rules and the measurements. Run them after touching either. |

### Where the parts come from

- `scripts/song-kit.mjs` — assembly: one clip per track per section, FX bars, the
  `.cfproj` envelope.
- `scripts/lib/craft.mjs` — the musical rules: groove, voicing, register slots,
  arrangement staggering, motif development.
- `scripts/apollo-voices.mjs` — the instruments, built entirely inside Apollo.

A song script is then mostly harmony and form, which is the part that should be
different every time.

---

## What actually separates our music from the reference

Measured, not guessed: `build-targets.mjs` ran the ElevenLabs corpus through the
same code that measures our songs. The medians:

| | ElevenLabs | ours, before | "Coriander", after |
|---|---|---|---|
| sub (20–60 Hz) | 21.4% | 62.9% | 19.3% |
| bass | 27.4% | 12.8% | 29.2% |
| 900 Hz – 5 kHz | 5.4% | **0.7%** | 8.6% |
| centroid | 381 Hz | 237 Hz | 408 Hz |
| stereo correlation | 0.84 | 0.90 | 0.86 |
| findings from `listen` | — | 8 warnings | 3 |

Two things worth reading twice:

**The midrange was empty and the bottom was enormous.** Not a mixing problem —
`voice-audit` showed eight of eighteen voices putting most of their energy in
120–400 Hz and *not one pitched voice* reaching above 900 Hz. Everything up there
was hi-hats. A mix cannot be given a midrange that was never played, and no EQ
reaches it.

**Stereo width was never the problem.** Our mixes are near-mono at 0.85, and so
is ElevenLabs at 0.84. Considerable effort was aimed at width on the assumption
that it mattered; the reference says it does not. That is what a target set is
for — it deletes false alarms as well as confirming real ones.

### Two targets that are NOT trustworthy yet, and why

Both of these nearly produced confident, wrong advice, so they are written down
rather than quietly fixed.

**Dynamic range.** Measured whole, the reference set appeared to move 26 dB
against our 13, which reads as "our arrangements are flat". Trim two seconds off
each end and it collapses — the one reference track of comparable length to ours
went from 22.6 dB to **6.9**. The corpus is mostly 30–40 second clips and what
was being measured was their fade-ins. `loudness()` now drops leading and
trailing near-silence (40 dB down, not 25 — at 25 it also ate a genuinely quiet
intro, which is real dynamics). The target is still built from clips shorter than
our songs, so treat it as directional until there is a length-matched set.

**Crest and loudness are post-master measurements.** The references are released
records: levelled and limited, so their crest is lower by construction. A correct
unmastered bounce will always read peakier, and comparing the two is
apples-to-oranges. `listen` downgrades that warning when the bounce is clearly
unmastered. Band balance and centroid are level-independent and stay full
warnings.

### On "cheaper than ElevenLabs"

Worth being straight about: at ElevenLabs' published $0.15/min, a 2-minute track
with 4 stems is about **$0.60**. Authoring one here costs roughly a dollar to
two in model tokens. **The first generation is not cheaper.** What is nearly free
is everything after it — every re-render, every edit, every variant — where each
ElevenLabs revision is a fresh charge and each result is a fixed audio file. The
case is editability and marginal cost, not sticker price.

---

## The instruments

Every voice is Apollo: oscillators, filters, envelopes, modulation. Drums
included — a kick is a sine with a fast pitch envelope.

**Reach for brightness deliberately.** `tine`, `pluck`, `picked` and `glass` are
the voices that live above 900 Hz; `pad`, `strings`, `warmep`, `organ` and `keys`
all sit in the low mids and will pile up if you use more than one of them. What
puts an instrument in the midrange is mostly its ATTACK — the pick, the hammer,
the stick — which is why `transient()` exists and why opening every filter is the
wrong fix. It trades a dark palette for a thin one.

**Two rules that are not matters of taste:**

- **Unison ≥ 3, or detune ≤ 0.05.** Apollo's `detune` is a WIDTH across the
  unison voices. At unison 2 there is no middle voice: both copies sit at the
  extremes, the lower one dominates, and the instrument is dragged flat by about
  detune × 60 cents. Measured at F4: unison 2 / detune 0.38 lands −22.5¢, unison 3
  at the same detune lands −7.5¢. This was diagnosed once, fixed in one song file,
  and left in the library — so Winter Drift's strings render a quarter-semitone
  flat. `voice-audit` now fails on anything past ±8¢.
- **Watch the voice cost.** Unison multiplies per held note and Apollo allows 16.
  A pad on unison 4 + 3 is 7 voices per note, so a four-note chord is 28 and past
  the limit the allocator steals notes that are still sounding. That is what "it
  stutters at the beginning" was.

**The palette is level-matched.** `voice-calibrate.mjs` trims every voice to the
same perceived loudness — sustained voices to −23 LUFS, hits to −9 dBTP, because
BS.1770 cannot measure a 40 ms hi-hat at all. Before it, voices differed by 12 dB
and every song hand-compensated blind; in "Coriander" that had the kick 9 dB under
the electric piano with the faders already pushed the wrong way. Re-run it with
`--write` after adding or changing a voice.

### Real recorded instruments

Apollo's `multisample` engine works headless, with no change to `apollo-render.mjs`
— see `scripts/apollo-multisample.mjs`. A zone map is plain JSON on the patch and
audio loads through the same `--sample id=path.wav` channel. Verified against
Splendid Grand Piano (public domain, 226 samples, 4 velocity layers): a rendered
zone matches its source WAV to 0.0 percentage points in all eight bands.

What real samples uniquely give is **air above 5 kHz** and **velocity that
changes timbre rather than just level** — the same note played FF against Mp
carries about 20 dB more 5–10 kHz energy, which no single-layer synth voice can
imitate. They are not automatically brighter: that piano is darker than our synth
`tine`.

**The blocker before this can ship inside a song:** zone JSON travels in the
`.cfproj` but the audio does not, so sample ids have to resolve through the Sound
Library. A sampled instrument needs its samples seeded the way the AI instruments
were, not just referenced by a patch.

---

## Writing the music

### Groove

The fault this replaces: every part in every song sat within 1.5 ms of the grid,
with a spread of 1–3 ms and swing exactly zero. That is symmetric jitter around
zero — motion without feel. It measures loose and still sounds like a machine,
because no part *leans*.

A groove is the difference in DIRECTION between parts. `craft.groove()` gives each
role a consistent lean: snare and clap behind the beat (+11, +12 ms), bass ahead
of it (−6 ms), kick as the anchor, hats loosest. Swing applies to hats, arps and
comping — never to the kick and snare, which turns a shuffle into a tempo change.

Three findings from the literature are built in, and are worth knowing because
they contradict the obvious approach:

- **The size of it.** The Groove MIDI Dataset baseline puts a quantised
  rendering **22.6 ms mean absolute error** away from the human performances, and
  the best learned humaniser only reaches 18.5 ms. If you are nudging by ±5 ms
  you are not doing it.
- **On-beat notes are played LATE, off-beat notes EARLY** (same source). It is a
  structured deviation, not noise, and it is most of what separates a played part
  from a jittered one.
- **Do not use plain random jitter.** Roger Linn, who invented the swing control,
  says so outright. What reads as human is white noise per onset PLUS a slow 1/f
  drift across the phrase; per-note randomness alone reads as sloppiness.

Swing is tempo-aware: measured jazz swing runs about 3.5:1 slow and collapses
toward 1:1 fast, because the short off-note holds a roughly constant ~100 ms. A
fixed percentage is wrong at speed, so the delay is capped to leave the off-note
audible. Linn's own scale, for reference: 54% loosens without sounding swung, 62%
was his preference at 90 BPM, 66% is a perfect triplet.

### Harmony

`craft.voice()` realises a chord symbol as pitches. Prefer **rootless** voicings:
the bass has the root, and doubling it in the keys is exactly what fills a mix at
the bottom while leaving the middle empty. Pass the previous voicing as `near` and
it voice-leads — inner voices move as little as possible, which is most of what
separates chords that progress from chords that jump.

**The low interval limit is enforced**, because it is one of the few genuinely
hard rules in arranging: two notes close together low down do not sound like a
chord, they sound like mud. Below E2 keep to octaves; thirds do not work below
about C3. `deMud()` drops the offender.

### Register

`craft.SLOTS` — sub, bass, lowChord, chord, upper, air. Assign every part a slot
and fold its notes in with `intoSlot()`. Two parts in one octave mask each other
whatever the faders do; the fix is arrangement, not EQ. `checkSlots()` refuses the
collision while you are writing rather than after you have mixed around it.

### Arrangement

- **Layers ARRIVE one or two at a time.** Several arriving together is the sound
  of a loop being switched on. `craft.stagger()` moves an entrance a section
  earlier rather than dropping it.
- **Layers may LEAVE all at once.** A drop-out is one of the strongest gestures
  an arrangement has, and it is not the same event as an entrance. The first
  version of `stagger` counted them together and "fixed" a strip-back section by
  putting the kick back into it, which destroyed the one thing that section was
  for. The band returning together after a drop is the payoff, not a fault, and
  both `stagger` and the verdicts exempt it.
- **The quiet sections have to be genuinely quiet.** A ratio under about 1.8
  between the sparsest and densest section reads as constant. `densityArc()` plus
  `thin()` make a section sparser rather than merely quieter — long notes, fewer
  parts. Quieter is the same loop; sparser is a different place.
- **Dynamics live as bars in the FX lane**, not hidden in clip graphs — Brae needs
  to see and edit the gestures. `dipInto()` before an arrival, `lift()` across a
  peak.

---

## Standing rules

These come from Brae and they are not up for re-litigation in a session.

1. **No lead lines.** Program-wide, until the whole idea is redesigned from
   scratch. Arps and repeated figures are texture and are fine; do not sneak a
   melody back in as a "counter" or a high keys part.
2. **Effects go on the trackhead FX lane, never on returns.** `returnTracks` stays
   empty. Returns clutter the mixer for users.
3. **Fix the music in the DAW first, then do video.** Never patch a musical
   problem at the video layer.
4. **Vary the genre.** The house habit is minor keys and four-chord loops. Vary
   key, mode, progression, tempo, kit and register. Nine songs with swing exactly
   zero is what happens when nobody checks.
5. **Everything stays editable in the program.** Clip presets or Apollo patches,
   never baked audio; one clip per section, not one frozen blob.
6. **Never commit Brae's content.** `content/Audio/*.cfproj` and the renders
   folder are his to push.

---

## Things that have gone wrong, so they do not go wrong again

**A silent track measures as an improvement.** This has been hit more than once: a
part fails to sound, the mix gets more dynamic and less muddy, and every meter
says the song got better. `song-render.mjs` reports every track's peak and RMS,
calls silence a failure, and refuses loudly rather than skipping quietly when it
cannot render something.

**Analyzers that disagree are worse than no analyzer.** On the same file,
`analyze-mix.py` said "dull, 1% over 2 kHz" while `song-sections.mjs` reported
24–46% air. Both were right about their own band edges. Every measurement now
lives in `scripts/lib/audio-features.mjs` and nothing defines its own.

**Detectors need testing before they accuse anything.** Plain autocorrelation
reported a perfectly in-tune sub bass as 1200 cents flat, because a sub is a
fundamental plus a deliberate octave-down oscillator. The band maths double-counted
every boundary bin and invented 15% of sub that was not there. Both were caught by
a signal with a known answer, and by nothing else.

**The offline renderer is not the product's renderer.** The instrument DSP is the
real Apollo worklet, and the biquads, distortion curve and reverb impulse are
daw-engine's own, transcribed. Two things are approximations and say so where they
are defined: the master compressor and waveshaping without oversampling. Against a
browser bounce of Iced it lands every band within 0.5%, crest within 0.6 dB and
correlation within 0.004, sitting 1.8 dB low overall. Trust it for musical
decisions; take a browser bounce before delivering.

**`__dawRenderOffline` in the app silently drops layers.** Measured on the same
project: sub and bass entirely absent, 11.6 dB quieter than the real-time path.
Do not use `hear-ai --offline` for verification. (Worth fixing in the app — its
automation freezes at the render-start value because `renderOffline` ticks once.)

**Existing `.cfproj` files embed their own copy of each patch.** Fixing a voice in
the library does not fix songs already written; their scripts have to be re-run.

---

## Open

- **Seed real multisamples into the Sound Library** so a sampled instrument can
  travel in a shared song. Biggest remaining sonic lever.
- **Per-genre targets.** `targets/general.json` is nine ElevenLabs tracks. A
  reference set per genre would stop a lo-fi track being told it is too dark.
- **Fix `width` in the engine.** It is a no-op that also drops 6 dB on dual-mono
  sources, and hard-pans a true-mono one. Not urgent — width is not the gap —
  but it is a real bug.
- **The lead problem.** Melodies have disappointed every time they have been
  tried. When it is reopened, it starts from scratch.
