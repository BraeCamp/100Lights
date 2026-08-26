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

## 0. The one rule about the numbers

**A range is not a target. It is the space real records occupied.**

Five Artemas records span 95–152 BPM, 9.7%–60.8% sub, and 3–15.6 dB of travel.
Anything that collapsed that into an average and called it "dark pop" would
produce the average song, which is nobody's favourite record. Pick a point in the
range deliberately, and know which end you are at and why.

When a measurement disagrees with the music, the music wins — but find out *why*
it disagrees first, because half the time the measurement is asking the wrong
question. Three separate times here it was.

---

## 1. Decide these before writing a note

1. **What carries it?** One thing does. In all five references it is the bass —
   it is the loudest element in every single track (−2.4 to −6.5 dB under the
   summed stems, above both drums and voice). If the bass is not the hook, know
   what is and give it that space instead.
2. **Is a voice coming?** For our work the answer is usually yes — Brae sings
   over these. That single fact changes the arrangement more than anything else
   in this document. See §2.
3. **What is the one device?** A song needs one thing that is *this song*: a
   Neapolitan chord, a bass that talks, a drop-out, a rhythm that lands wrong on
   purpose. One. Two devices is a sketch of two songs.
4. **How much does it move?** 3 dB and 15.6 dB are both correct in this genre and
   they are completely different records. Decide, don't drift.
5. **What is left out?** In the sparsest reference the entire harmonic layer sits
   20 dB down — effectively absent. Restraint is a choice you make once, at the
   start, or never.

---

## 2. Leave the voice its space

**This is the most important thing measured here, and it inverts a conclusion I
had already acted on.**

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

---

## 4. Groove

**Straight. Every reference: swing 49.5–50.0%.** Dark pop does not shuffle. Swing
belongs to other idioms; putting it here is a genre error.

**Looseness, measured like-for-like** — audio onsets on an isolated drum bus:

| | spread |
|---|---|
| the five references | ±28.3 … ±44.5 ms |
| our "Cold Signal" | ±32.6 ms |

We are already inside the range. This matters because measuring our *note
positions* instead gives ±3 ms and looks alarmingly tight — those are different
quantities, and "fixing" the wrong one would have wrecked the timing. **Compare
the same measurement or don't compare.**

What produces that spread is not one loose part, it is different parts leaning in
different directions: kick as the anchor, snare/rim behind the beat, bass ahead
of it, hats loosest. `craft.groove()` does this by role. The Groove MIDI Dataset
puts a quantised part ~22.6 ms from a human one, and drummers play on-beat notes
late and off-beat notes early — both are built in.

---

## 5. Harmony

All five references are **minor**, in flat keys: B♭, G♭, A♭, E♭, C minor. That is
not a rule of the universe but it is what the idiom does, and a bright major key
is a different genre wearing the same clothes.

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

## 7. The shapes inside one genre

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

## 10. Where this is thin

- **One artist, five records.** It is a profile of Artemas, labelled dark-pop. It
  needs other artists before the name is honest.
- **Chord progressions are not extracted yet.** `study.mjs` reports key but not
  the progression; `music-learn.mjs` has the chord estimator and it is not wired
  in. That is the most obvious next addition.
- **No per-section analysis of the references.** We get whole-track numbers and
  boundary times, not "what the chorus does that the verse doesn't", which is
  where most arrangement craft actually lives.
- **Nothing here measures whether a song is any good.** It measures whether it
  sits where records of its kind sit. Those are not the same, and Brae's ear
  remains the only judge of the second one.
