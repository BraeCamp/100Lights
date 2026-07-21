---
title: Build a Reese Bass From Scratch
description: The growl in every jungle and drum-and-bass record is two sawtooth waves cancelling each other out. Here is how to build one in a browser synth.
date: 2026-07-20
tags: sound-design, bass, synthesis
draft: true
---

# Build a Reese Bass From Scratch

Nobody who makes drum and bass for a living will tell you this, because it sounds like an insult to the craft: the Reese bass is two sawtooth waves slightly out of tune with each other. That's it. That's the whole patch. Everything else — the filter, the distortion, the eight layers, the mid-range screaming — is decoration bolted onto a two-oscillator idea that took about four minutes to discover in 1988.

You have heard this sound thousands of times. Every jungle record from 1993 onward. The low churning thing under Photek. The bass in "Pulp Fiction" by Alex Reece. That restless, seasick growl that never quite sits still. What you probably never noticed is *why* it moves. Most people assume it's an LFO — something wobbling the filter on a timer. It isn't. There's no modulation in a real Reese at all. The movement is the two oscillators drifting in and out of phase with each other, forever, and never repeating in a way your ear can predict.

That's the trade secret. The growl is a bug. It's phase cancellation, and someone decided not to fix it.

Here's where you start and where you're going. Same notes, same riff — the only thing that changes is going from one sawtooth to two slightly out of tune.

@audio(/learn-audio/reese-before.mp3) Before: one plain sawtooth. A bass note, and not much else. This is the raw material.

@audio(/learn-audio/reese-after.mp3) After: two sawtooths nine cents apart through a dark filter. Nothing is modulating — that restless growl is the second oscillator alone.

## Where the name comes from

Kevin Saunderson — one third of the Belleville Three, the Detroit producers who invented techno — released a track called "Just Want Another Chance" in 1988 under the alias Reese. The bass on it was two detuned saws on a Casio CZ-5000, played low and left alone. Detroit heard a bassline. British producers, five years later, heard raw material.

Jungle took that sound, pitched it down, ran it through everything they had, and made it the *lead instrument*. That's the part people miss. In drum and bass the Reese is not the bass — the sub is the bass. The Reese is the melody, the texture, the thing carrying the emotional weight of the track, living in the mid-range where a guitar would sit. Once you know that, you stop trying to make it deep and start trying to make it *mean* something.

## Building it in the poly synth

Everything below works in the free browser studio at [100Lights](https://100lights.com) — no plugin, no download. Open a project, add a track, and pull up the **Reese Bass** sound recipe from the library if you want the finished patch in front of you while you read. Then wreck it and rebuild it. That's the only way any of this sticks.

But you don't have to leave this page to build it. Here's the whole patch, live. Hit **Guide me** and it'll walk you through it one control at a time, highlighting each knob as you go — or hit **Hold a note** and drag the controls yourself as you read the sections below.

@synth(%7B%22note%22%3A28%2C%22detune%22%3A9%2C%22cutoff%22%3A620%2C%22resonance%22%3A6%2C%22voices%22%3A2%7D) The stock Reese, running in your browser. One saw is a plain bass note; add the second and detune it, and the growl appears with nothing modulating it.

**Waveform: sawtooth.** Not square, not sine. A saw contains every harmonic above its root, which means there's material at every frequency for the filter to chew on later. A square wave skips half of them and always sounds slightly hollow — great for an arp, wrong for this.

**Detune: small.** The stock Reese patch sits at 9 cents. That's a deliberately conservative number and I'd argue it's the right starting point, because detune is the one control here where people immediately overdo it. Nine cents is barely audible as pitch and completely audible as motion. Push it to 30 and you get something thicker but blurrier. Push it past 50 and you don't have a Reese anymore, you have a chorus effect with a headache.

@theory Two notes at the same pitch add up to one louder note. Two notes almost at the same pitch can't agree on where they are, so they take turns reinforcing and erasing each other — loud, thin, loud, thin — and that slow pulsing is what your ear reads as movement. The further apart they are, the faster the pulse, until it stops sounding like motion and starts sounding like two separate instruments playing badly together. The Reese lives in the narrow band right before that happens.

@math The beat rate is just the difference between the two frequencies. One cent is a hundredth of a semitone, so nine cents on a note near 92 Hz puts the second oscillator roughly half a hertz away — one full swell every two seconds. Notice that the beat rate scales with pitch: play the same patch two octaves up and the swelling doubles twice, which is exactly why a Reese sounds sluggish and menacing down low and jittery up high.

**Filter: low-pass at 620 Hz, resonance 6.** This is the number that surprises people. Six hundred and twenty hertz is *dark* — you're throwing away most of the saw's harmonics. The resonance at Q 6 is high enough to put an audible bump right at the cutoff, which is what gives the patch its vowel-like quality, that "ooooo" that sits under the drums. Turn resonance to 1 and the patch goes polite immediately. Turn it to 12 and it starts whistling on its own.

**Envelope: fast attack, high sustain.** The stock patch uses a 6 ms attack, short decay, sustain around three-quarters, and a 200 ms release. Fast in, hold, small tail. Reese basses are played, not plucked — if the note dies before the phase cancellation gets a full cycle in, you've built a bass stab instead.

@ear Hold one note for four full bars with the LFO off. Just sit there. Somewhere around the second bar you should hear the tone hollow out and come back — nothing is moving it, no modulation is running, and it still won't stay still. That is the entire sound. Everything else in this article is trim.

## Playing it

The stock pattern is a straight run of eighth notes — sixteen per bar, all the same length, all short enough to leave a sliver of gap. Root, root, up a fifth, back to root, then an octave jump on the "and" of three. Repeat.

That shape is worth stealing directly. Reese lines are almost always mostly-one-note. The tension comes from rhythm and from the timbre refusing to settle, not from melody, and beginners consistently write far too many notes because the patch alone sounds boring when you're auditioning it on a single held C. It isn't boring. It's patient.

Two things to do the moment you have it looping:

- **Lock it to the kick.** Reese lines and kick drums share territory. If they're fighting, shorten the bass notes rather than turning them down — a gap is more effective than an EQ cut.
- **Layer a clean sine underneath.** The classic setup is a Reese carrying the mid-range and a plain sine sub carrying the actual low end, playing the same root. The **808 Sub Bass** recipe is already a pure sine with a long tail; put it on a second track, play only the roots, and let the Reese do the talking above it.

## What to do next

Add a delay and a touch of distortion on the track's effect chain. Distortion in particular is the step most tutorials skip and every real record includes — driving a Reese generates new harmonics above the cutoff you just spent so much effort removing, which sounds contradictory and is exactly why it works.

Then automate the cutoff by hand across sixteen bars. Not with an LFO. Draw it. A Reese that opens up by four hundred hertz over a chorus does more arrangement work than any riser you could paste on top.

When you land on one you like, save it as a preset and put it on the [community](https://100lights.com/community) page. Reese patches are folk knowledge — they've been passed hand to hand for thirty-five years, and every producer's version is slightly wrong in a way that turns out to be the good part.
