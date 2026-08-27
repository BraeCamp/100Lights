# The backbone

What to read before writing a song. It does not write anything and it must never
be turned into something that does — a document that produces music produces the
*same* music, and that is the failure this whole project keeps circling back to.

What it does is narrow the decisions and tell me what real records actually do,
in numbers, so that choosing differently is a choice rather than an accident.

**Every range here was measured**, not recalled. The tools are in the repo:

```
npm run study -- <record.wav> --stems=<demucs dir>   # learn from someone else's
npm run listen -- <song.cfproj> --style=artemas     # judge our own against it
npm run style -- --name=<x> --from=<study dir>       # turn studied records into a profile
```

---

## 0. Two rules about the numbers

**A range is not a target. It is the space real records occupied.**

Five Artemas records span 95–152 BPM, 9.7%–60.8% sub, and 3–15.6 dB of travel.
Anything that collapsed that into an average would produce the average song,
which is nobody's favourite record. Pick a point in the range deliberately, and
know which end you are at and why.

**Artist first, genre second.** A genre is a shelf label applied afterwards by
people who need somewhere to file a record. What exists is an artist making
particular decisions, and the genre is an observation about the result. So every
profile here is keyed by artist, and `genre` is a *finding* — see §7, where four
artists are measured against each other and three of the four labels turned out
to be things the numbers could actually settle.

When a measurement disagrees with the music, the music wins — but find out *why*
it disagrees first, because half the time the measurement is asking the wrong
question. Three separate times here it was.

---

## 1. Decide these before writing a note

1. **What carries it?** One thing does, and which one is a genre marker in
   itself. For Artemas, Two Feet and Montell Fish it is the **bass** — loudest
   element in the mix, above both drums and voice. For Tiësto it is the
   **drums**. Decide which, and give it the top of the stem table.
2. **Is a voice coming?** For our work the answer is usually yes — Brae sings
   over these. That single fact changes the arrangement more than anything else
   in this document. See §2.
3. **What is the one device?** A song needs one thing that is *this song*: a
   Neapolitan chord, a bass that talks, a drop-out, a rhythm that lands wrong on
   purpose. One. Two devices is a sketch of two songs.
4. **How much does it move?** Across the four artists, medians run 7.5 dB
   (Artemas) to 23.6 dB (Two Feet) — and inside Artemas alone, 3 to 15.6. Both
   ends are correct and they are completely different records. Decide, don't
   drift.
5. **What is left out?** In the sparsest reference the entire harmonic layer sits
   20 dB down — effectively absent. Restraint is a choice you make once, at the
   start, or never.

---

## 2. Leave the voice its space

*Holds for all four artists — the strongest general finding here.*

**This is the most important thing measured, and it inverts a conclusion I had
already acted on.**

Comparing our instrumentals against finished records said we had a hole in the
midrange. Separating the references and measuring the instrumental alone shows
where that midrange actually comes from:

| "how could u love somebody like me" | mid (400–900) | highMid (900–2.5k) | centroid |
|---|---|---|---|
| full record | 21.9% | 8.3% | 622 Hz |
| **instrumental only** | **4.3%** | **1.7%** | **375 Hz** |

The voice *is* the midrange. A real dark-pop instrumental is sub-dominant and
midrange-light — its centroid, 375 Hz, is almost exactly where our songs already
sit (Cold Signal 274 Hz, Coriander 408 Hz).

So: **an instrumental that will be sung over should leave 400 Hz – 2.5 kHz
comparatively empty.** Filling it is not an improvement, it is taking the
singer's chair. If a track is genuinely instrumental and final, fill it — but
then say so, because it is a different job.

Instrumental band ranges across the five (`styles/artemas.json`):

| band | range | median |
|---|---|---|
| sub 20–60 | 9.7 – 60.8% | 36.1% |
| bass 60–120 | 24.6 – 51.3% | 27.4% |
| lowMid 120–400 | 10.8 – 30.0% | 22.0% |
| mid 400–900 | 0.5 – 10.4% | 4.3% |
| highMid 900–2.5k | 0.2 – 5.9% | 4.3% |
| presence 2.5–5k | 0.1 – 2.8% | 0.7% |
| air 10k+ | 0.0 – 0.6% | 0.2% |

---

## 3. The low end is the song

*Holds for Artemas, Two Feet and Tiësto. NOT for Montell Fish, who sits at 45%
with almost no sub — see §7.*

Between sub and bass these records put **50–75% of all their instrumental
energy**. That is not a mix decision, it is what the music is made of.

The two are different jobs and the references split them differently:

- **Sub-led** ("cross my heart": 60.8% sub, 27.4% bass) — a deep fundamental
  carrying the weight, with everything above it thin and incidental.
- **Bass-led** ("if u think i'm pretty": 9.7% sub, 51.3% bass) — almost no sub
  at all; the *bass* is the low end and it has character, movement, notes.

Both are the same genre. Choosing between them is the single biggest tonal
decision in a dark-pop track and it happens before any note is written.

Practically: the sub holds one note per chord and never moves much; the bass is
where syncopation and octave pops live. Put them an octave apart — sharing a
register makes two parts fight for one job (`checkSlots` refuses it).

### One sound that moves, versus notes that arrive

A sub, a drone, a bowed line — anything meant to be heard as ONE sound changing
pitch rather than a series of separate ones — has to be built for it, and the
default gets it wrong. Measured, on three notes:

| | amplitude through the note change |
|---|---|
| notes with a gap between them | **0% of peak** — it stops dead |
| notes overlapping, normal poly mode | 52% — you hear the re-attack |
| **legato mode + legato envelope + overlap** | **88-97%** — it holds |

Three things are required and **none of them works alone**:

1. A `glideSub`-style patch: `global.mode = 'legato'`, a glide time, and
   `envs[0].legato = true`. The engine only treats a note as legato when a voice
   is *already sounding*, and only then does it skip the envelope retrigger.
2. `craft.legatoChain()` - every note stretched to overlap the next. **A gap of
   any size ends the voice and no glide setting recovers it.** This is the
   precondition, not a refinement.
3. `continuous: true` on the track, if it should cross section boundaries. A clip
   boundary ends a note and an ended note ends the chain, so the per-section
   clips that make everything else editable break this one thing.

And do not groove it. Micro-timing places an *attack*, and a held part has one
attack in the whole song; per-note velocity re-articulates the thing that is
meant to hold. Move its dynamics into the FX lane as gain bars instead.

`listen` checks this: any part written as a continuous chain is measured in the
render, and one that gates is reported.

---

### The bass: what it plays, and what it sounds like

Two rules from Brae's ear, both of which changed a design rather than a setting.

**Its tone must not move.** Give a bass a filter envelope or an oscillator-sync
sweep on every note and the timbre re-shapes constantly — which announces itself,
and the ear follows the change instead of settling into the groove. For music
that wants to sit still and be felt, the sound stays CONSISTENT and only the
VOLUME moves. `steadyBass` is built that way: no filter envelope, no sync,
velocity routed to level and nothing else. Keep filter keytrack around 0.35 —
at zero, a fixed cutoff makes low notes bright and high notes dull, which is a
tone change by another route.

It also solved a measurement problem nothing else could. A sync'd saw through a
resonant ladder has a weak fundamental, so it reads as low-mid energy with an
empty bass band; the steady voice measures 93% in the bass band at a 91 Hz
centroid.

**It stays or it falls. It never rises.** Brae, on a figure that went
root-root-root+5th: *"just like how people tone down for statements and up for
questions. The toning down or staying at the tone will be more powerful."* A bass
that answers itself by jumping up sounds uncertain; one that holds its ground or
drops below it sounds certain. When the line needs to move, move it DOWN — to the
seventh or the fifth beneath the root.

---

## 4. Groove

*Holds for all four artists.*

**Straight. All thirty-two records measure 48.8–52.8% swing, median 50.**
Not one of these artists shuffles. Swing belongs to other idioms, and reaching
for it here is a genre error — which is worth knowing, because `craft.groove()`
offers it and "Coriander" used 58%.

**Looseness, measured like-for-like** — audio onsets on an isolated drum bus:

| | spread |
|---|---|
| the five references | ±28.3 … ±44.5 ms |
| our "Cold Signal" | ±32.6 ms |

We are already inside the range. This matters because measuring our *note
positions* instead gives ±3 ms and looks alarmingly tight — those are different
quantities, and "fixing" the wrong one would have wrecked the timing. **Compare
the same measurement or don't compare.**

### Drums: fewer notes, and hats that are either there or gone

**Do not sprinkle.** Sixteen hat hits a bar at 148 BPM is a hiss, not a groove,
and a random sixteenth layer over steady eighths is the "so many drum notes close
to each other" clutter that reads as mush. Steady eighths — closed on the beat,
open off it — and the pattern does not vary.

**The hat is consistent, or it is absent.** From "cross my heart": the hat runs
through most of the record, and where it is not consistent it is *gone* — for the
four or eight bars before the first or last chorus. That absence is the build;
nothing else has to happen.

**Something else marks the bar where the hats were.** Brae's description of what
arrives instead: *"different sounds to accent the start of a bar or two — deep
and electronic and sometimes with a powerful quick tremolo"*. That is the `boom`
voice: a sub-octave sine and a detuned saw under a fast LFO on the oscillator
LEVELS. Apollo has no tremolo effect, and modulating the source rather than a
post-gain keeps it in front of the filter and the drive. It works because it
lands where the ear has just lost the hats and is listening for something.

**Kick and hat both need length.** A 0.34 s steeply-curved kick decay is a click
and a puff of air; a 55 ms hat under a downsampler is a tick. Give the kick a
longer, flatter decay plus a sub oscillator for body, and let the hat run ~100 ms
with the filter open — measured, that moved the hat from 1747 Hz to 2881 Hz and
into presence and air for the first time.

What produces that spread is not one loose part, it is different parts leaning in
different directions: kick as the anchor, snare/rim behind the beat, bass ahead
of it, hats loosest. `craft.groove()` does this by role. The Groove MIDI Dataset
puts a quantised part ~22.6 ms from a human one, and drummers play on-beat notes
late and off-beat notes early — both are built in.

---

## 5. Harmony

*ARTEMAS ONLY — and the comparison in §7 is what proves it.*

All five Artemas records are **minor**, in flat keys: B♭, G♭, A♭, E♭, C minor.
It would have been easy to write that down as a rule of the idiom. It is not:
Two Feet is 7 of 10 in MAJOR, Montell Fish 9 of 12, Tiësto 2 of 5. Minor keys are
an Artemas fact, not a dark-music fact, and this is exactly the mistake that
naming profiles after genres invites.

- Voice **rootless** — the bass owns the root, and doubling it in the keys is
  what fills a mix at the bottom while leaving the middle empty.
- Extensions (9ths, 11ths) keep a minor loop from sounding like a minor loop.
- Borrow one chord from outside. The Neapolitan (♭II, a major chord a semitone
  above the tonic) is the strongest single move available in a minor key: it
  wants to fall onto the tonic and never quite does.
- Obey the **low interval limit** — below E2, octaves and fifths only; thirds do
  not work below about C3. `deMud()` enforces it.

---

## 6. Arrangement, and how far a song travels

`travelsDb` across the five: **3.0, 5.2, 7.5, 9.3, 15.6 dB.** Median 7.5.

This corrected a target I had been chasing. An earlier profile built from short
generated clips said a song should move ≥16 dB; almost all of that was the
clips' own fade-ins. Real records in this genre move **3 to 15 dB**, and our own
songs (17.7 dB) move *more* than any of them. Not a deficiency — a difference,
and worth deciding on rather than maximising.

Section counts run 2 to 9. Two of the five essentially do not change at all and
work anyway, on the strength of one groove.

Rules that hold regardless:

- Layers **arrive** one or two at a time. Several arriving together is a loop
  being switched on.
- Layers may **leave** all at once — a drop-out is one of the strongest gestures
  available, and the band returning after it is the payoff, not a fault.
- A quiet section must be genuinely **sparser**, not just quieter: fewer parts
  AND softer playing. Quieter alone is the same loop with the fader down.

---

## 7. Four artists, measured against each other

`npm run artists` prints this. Thirty-two records: Artemas 5, Two Feet 10,
Montell Fish 12, Tiësto 5. It is the section to read when deciding what a song
is going to *be*, because it shows how far apart artists sit on the things that
actually matter.

| | Artemas | Two Feet | Montell Fish | Tiësto |
|---|---|---|---|---|
| tempo (median) | 98 | 105 | 120 | **120**, range only 120–137 |
| minor keys | **5/5** | 3/10 | 3/12 | 3/5 |
| drum onsets /sec | 7.4 | 3.5 | **0.8** | 5.3 |
| master LUFS | −6.5 | −7.5 | **−15.4** | −7.2 |
| crest dB | 8.5 | 10.0 | **17.1** | 8.6 |
| travels dB | **7.5** | **23.6** | 19.0 | 10.5 |
| sections | **3** | **9** | 8 | 6 |
| instr. centroid | 309 Hz | 319 Hz | **208 Hz** | 256 Hz |
| low end share | 64% | 59% | **45%** | **69%** |
| loudest element | bass −4.1 | bass −3.2 | bass −3.3 | **drums −3.9** |
| vocal vs bass | −2.5 dB | **−5.1 dB** | −1.9 dB | −0.2 dB |
| harmony vs bass | −4.7 dB | −3.0 dB | −3.0 dB | −3.9 dB |

**What the numbers settle:**

- **Tiësto — dance / electronic pop.** Brae's label, and the measurements agree
  without argument. The tightest tempo cluster of the four (120–137 against
  Two Feet's 78–179), the biggest low end (69%), heavily limited, and **the only
  one of the four where the drums are the loudest element in the mix.** In the
  other three the bass is on top. That single reversal is the clearest genre
  marker in the whole table.
- **Montell Fish — lo-fi alternative R&B / bedroom soul.** Not dark pop and not
  dance. **Drums are absent or near-absent in 8 of his 12 tracks** (0.8 onsets
  per second, drums 15.6 dB down — ten decibels further back than anyone else),
  and he is **barely mastered**: crest 17.1 and −15.4 LUFS, roughly twice the
  dynamic range of the other three and eight decibels quieter. Darkest
  instrumental of the four, low-mid dominant with almost no sub. This is
  intimate, arrangement-light, voice-first music.
- **Two Feet — guitar-led alternative / blues-electronic.** Often filed next to
  Artemas, and the numbers say they are not the same thing. **Seven of ten are in
  MAJOR keys** where Artemas is five of five minor; he has the most instrumental
  midrange (8.9%) and presence (1.1%) of the four, which is where an electric
  guitar lives; his vocals sit furthest back (−5.1 dB relative to the bass
  against Tiësto's −0.2); and he is the most sectional and most dynamic
  (9 sections, 23.6 dB) against Artemas's 3 and 7.5.
- **Artemas — dark pop with alt-R&B bones.** Every record minor, busy drums,
  heavily limited, harmony pushed furthest down of the four, and the *least*
  movement — 7.5 dB and three sections. Static and dense on purpose.

**The practical use.** These are four different instructions. Writing "a dance
track" means 120 BPM and drums on top. Writing "a Montell Fish kind of thing"
means taking the drums out and not mastering it loud — and if you master it to
−7 LUFS you have destroyed the thing that makes it what it is.

**What the numbers could NOT settle:** chord progressions. The estimator returns
roughly 0.36 confidence across all four artists, which is too low to build on.
Tempo and key are trustworthy (0.62–0.81); harmony is not, yet.

---

## 7b. The shapes inside one artist

The point of this section is that these are all the same artist and arguably the
same genre, and they are not the same kind of record at all.

| record | bpm | sub / bass | harmony level | sections | travels | shape |
|---|---|---|---|---|---|---|
| cross my heart | 132 | 61 / 27 | −20 dB | 9 | 15.6 dB | **sub-led and nearly empty** — the harmonic layer is barely there; the record is weight and space |
| how could u love… | 98 | 42 / 27 | −10.6 dB | 3 | 5.2 dB | **half-time, mid-density** — the default shape |
| i always kinda knew… | 98 | 24 / 25 | **−5.2 dB** | 2 | 3.0 dB | **harmony-forward and static** — chords are as loud as the drums, and it barely moves |
| i like the way you kiss me | 152 | 36 / 34 | −8.5 dB | 5 | 7.5 dB | **driving** — fast, balanced low end, most sectional of the four-on-floor family |
| if u think i'm pretty | 95 | **9.7** / **51** | −8.8 dB | 3 | 9.3 dB | **bass-led, no sub** — the bass IS the low end |

The widest variable is the **harmony layer: −5.2 to −20 dB**, a 15 dB spread.
Whether chords are a co-lead or nearly absent is the main thing separating these
records from each other, and it is a decision, not a consequence.

---

## 8. Mixing and mastering are different jobs

The references master at **−5.6 to −9.5 LUFS with a crest of 8.1–9.8 dB** — very
limited, which is simply what commercial pop is. Our bounces sit at −25 LUFS with
a crest near 19.

That is correct and should stay correct. Bounce with headroom, master afterwards
(`npm run master`, which verifies the finished MP3 rather than trusting ffmpeg's
request). Do not chase loudness in the mix; it only trades clipping for
quietness, and comparing an unmastered bounce's crest against a mastered record
is comparing two different things.

Element balance, dB under the summed stems — the numbers that reorder an
arrangement rather than EQ it:

| | range | median |
|---|---|---|
| bass | −6.5 … −2.4 | **−4.1** |
| drums | −7.0 … −5.3 | −5.7 |
| vocals | −9.0 … −5.5 | −6.6 |
| harmony / other | −20 … −5.2 | −8.8 |

Bass on top, in all five.

---

## 9. What the tools do

| | |
|---|---|
| `npm run study` | learn from a record; with `--stems` it reads the instrumental and the groove separately |
| `npm run artists` | put artist profiles side by side — how a genre gets decided rather than assumed |
| `npm run style` | turn studied records into a profile of ranges |
| `npm run listen -- … --style=artemas` | judge our song against those ranges rather than against an opinion |
| `npm run probe` | what Apollo can actually do headlessly (99 of 107 features) |
| `npm run voices:audit` / `voices:calibrate` | what each voice sounds like, whether it is in tune, and level-matching so a fader means something |
| `npm run size` | where a project file's bytes go |
| `npm run master` | master, then verify the finished file |

`scripts/lib/craft.mjs` holds the writing helpers — groove by role, rootless
voicing with voice-leading, register slots, arrangement staggering, the
sidechain pump, motif transforms. `npm run test:craft` proves them.

---

## 10. A worked example — how "i'd ruin it again" was decided

Included because a document like this is easy to agree with and hard to use, and
because two of the decisions below were wrong in a way that is worth seeing.

### Before a note was written

Every one of these came out of `styles/artemas.json` rather than out of taste:

| decision | from | chosen |
|---|---|---|
| which shape | five records, five shapes (§7) | **driving**, the 132–152 family — because the half-time shape is what "Cold Signal" already did, and the point of a range is to pick different points in it |
| tempo | 95–152 | **148** |
| key | all five minor, flat keys | **B♭ minor** |
| what carries it | bass is loudest in all five (−2.4…−6.5 dB) | bass gets the hook and the loudest fader |
| the midrange | instrumental mid 4.3%, highMid 4.3% | left open — harmony as short stabs, not pads |
| harmony level | −5.2…−20 dB; −8.5 on this shape | aimed ~10 dB under the bass |
| travel | 3–15.6 dB, median 7.5 | ~8 dB — so the dynamic scale is 0.72–1.0, not the 0.42–1.0 used before |
| swing | 49.5–50.0% | none |
| sections | 2–9, median 3 | 6 |

The progression (i–♭VII–♭VI–♭VII, rootless, three notes) and the one device — a
bass whose sync opens on every note — are the parts the profile did *not*
decide. That is the correct division of labour.

### Then eight measured passes

| pass | change | result |
|---|---|---|
| 1 | as written above | bass 5.5%, lowMid 37%, **mid 22%** |
| 2 | keys up an octave, pad down and darker, standing filters | mid 22% → 17% |
| 3 | swapped the formant pad for the plain dark one | mid → 10% |
| 4 | bass lowpass to 260 Hz | mid → 2.8%, but bass still 7% |
| 5 | **trimmed the bass's octave-down oscillator** | bass 7.4% → **3.8% — worse.** Reverted |
| 6 | **dropped the sub, pushed the bass up** | lowMid → **63% — much worse.** Reverted |
| 7 | bass osc 2 moved to unison with the fundamental | bass **5% → 18.7%** ✓ |
| 8 | trimmed the bass fader | one marginal warning; shipped |

**Pass 1 is the one to notice.** The song's whole premise was leaving the singer's
octave open, and the formant pad was sitting at a 487 Hz centroid with 70% of its
energy in the mid band. Intent does not survive contact with a patch you did not
measure.

**Passes 5 and 6 are the other one.** The bass band read almost empty while the
low mids filled up, and *no fader fixed it* — turning the bass up moved both
together, twice, in the wrong direction. The cause was sound design: a sync'd saw
through a resonant ladder has a weak fundamental, and `growlBass`'s second
oscillator is a sine an octave DOWN, doubling the sub instead of giving the note
a body. Moving it to unison with the fundamental fixed in one pass what two
mixing passes had made worse.

That is the argument for the loop. Not that it writes anything — it does not —
but that it catches the difference between a mixing problem and a synthesis
problem, which by ear takes far longer and by guessing takes forever.

---

## 11. Where this is thin

- **Sample sizes are small.** Artemas 5 records, Tiësto 5, Two Feet 10, Montell
  Fish 12. Enough to separate four artists from each other; not enough to speak
  for a genre.
- **Chord progressions are extracted but not trustworthy.** `study.mjs` now
  reads a roman-numeral loop off the harmonic stem, and it comes back at ~0.36
  confidence on all four artists. Tempo (0.62–0.81) and key (0.62–0.69) can be
  leaned on; harmony cannot, yet. Do not quote a progression from this as fact.
- **No per-section analysis of the references.** We get whole-track numbers and
  boundary times, not "what the chorus does that the verse doesn't", which is
  where most arrangement craft actually lives.
- **Low frequencies break short analysis windows, repeatedly.** At 30-60 Hz one
  cycle is 17-33 ms, so a 5 ms RMS window measures the waveform's own zero
  crossings rather than its envelope - the continuity probe reported every
  setting dipping an identical ~21% until the window went to 60 ms. The same trap
  had the tuning guard reporting cents it could not resolve. Any time a
  measurement of something low looks suspiciously uniform, check the window
  before believing it.
- **Two measurements have known blind spots.** The tuning guard sweeps a DFT over
  a 32768-sample window whose main lobe is ~1.5 Hz wide — 82 cents of smear at
  30 Hz — so it declines to answer below 50 Hz rather than guess. And the
  "bed is loudest" rule sits at 1 dB, because the references put harmony a median
  3.0 dB under the bass and a wider threshold flags correct mixes.
- **Nothing here measures whether a song is any good.** It measures whether it
  sits where records of its kind sit. Those are not the same, and Brae's ear
  remains the only judge of the second one.
