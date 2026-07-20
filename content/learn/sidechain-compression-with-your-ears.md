---
title: Sidechain Compression, Explained With Your Ears
description: Before you learn what sidechain compression is, you're going to hear it — in a song you already know, doing something you never noticed.
date: 2026-07-20
tags: mixing, compression, technique
draft: true
---

# Sidechain Compression, Explained With Your Ears

Put on Daft Punk's "One More Time." Not in the background. Properly, with the volume up, and don't read ahead until it's playing.

Listen to the bass and the chords underneath the vocal. Don't listen to the kick drum. Listen to everything *except* the kick drum.

Something is happening to it.

@ear Play the first thirty seconds and follow the chord stabs only. Every time the kick lands, the chords get quieter for an instant, then swell back up before the next kick arrives. Down, up, down, up, four times a bar. Once you hear it you will not be able to stop hearing it. Give it three or four passes.

You probably described that as "the groove." Most people do. It feels like rhythm — like the track is breathing, or pushing forward, or leaning. It doesn't feel like a volume change, because nobody is turning anything down by hand.

Something is, though. Automatically. Four times a bar, on schedule, for the entire song.

## Now check the songs you thought were clean

Before I name it, gather more evidence. This effect is not a dance music thing, whatever you've been told.

@ear Play something with no obvious electronic production — a podcast with background music underneath the host, or any radio ad. Listen to the music, not the voice. Every time the speaker starts a sentence, the music sinks. Every time they pause, it rises. Nobody is riding a fader in real time. The same machine is doing it.

@ear Now something harder. Put on a modern pop record with a big low end — Billie Eilish's "bad guy" works, so does most of Dua Lipa's "Future Nostalgia." Solo your attention on the sub bass. Under each kick it thins out, then refills. The gap is short, maybe a tenth of a second. It's the reason you can hear both the kick and the bass at once, which should not physically be possible given they occupy nearly the same frequency range.

Two low-frequency sounds in the same place at the same time don't blend. They fight — which is the same collision [you solve everywhere else in the mix with faders, panning and a high-pass filter](/learn/mixing-101-volume-pan-eq) — and the loser is usually clarity — you get a thick low-end smear where you can't tell the pitch of the bass or feel the punch of the kick. Except in these records, you can hear both. Perfectly.

They're taking turns. Somebody arranged for them to take turns, several times per second, and you have been listening to it your entire life without once wondering how.

## The reveal

The kick is turning the bass down.

That's the whole mechanism. A compressor sits on the bass channel, but instead of reacting to how loud the *bass* is — which is what compressors normally do — it's been rewired to react to how loud the *kick* is. Kick hits, compressor clamps the bass down. Kick decays, compressor lets the bass back up. It happens in milliseconds, over and over, with a machine's consistency.

The rewiring is the only unusual part, and it has a name: the sidechain. A side input. The signal the compressor listens to, as opposed to the signal it processes.

That's it. That's the entire idea. Every explanation you've bounced off before was making a simple thing sound complicated: one channel is watching another channel and ducking out of its way.

@theory Your ear reads this as groove rather than as volume automation, and there's a reason. Rhythm is perceived not just from the attacks of sounds but from the shape of what happens between them — the rise and fall of energy across the bar. When the bass swells back up after each kick, it creates a movement toward the next beat, and your brain files "energy increasing toward a point in time" as anticipation. Anticipation is what makes you move. So a purely technical fix for two instruments colliding turns out to generate a feeling of forward motion, entirely by accident, which is why producers stopped using it as a fix and started using it as an instrument.

That accident is the reason a genre exists. Pump the pads hard enough and the ducking stops being invisible — it becomes the hook. French house did that on purpose in 1997 and everyone has been copying it since.

@video Side-by-side playback of a four-bar loop with the bass ducking under the kick versus the same loop flat, switching every two bars

## The version you can build right now

You don't need a sidechain input to get most of this, and I'd argue you shouldn't start with one anyway, because the routing hides what's actually happening.

Start in the piano roll. Open your bass part and look at where the notes fall relative to the kick. If a bass note starts on the exact same tick as a kick, shorten it — end it before the kick, or start it a sixteenth late. Write the gap in by hand. Do that for every kick in the bar and play it back.

That's a sidechain. A manual one, with infinite precision and no processor. Half the basslines you love were written this way before the plugin existed, by bass players who simply didn't play through the kick.

@ear Loop one bar. Version A: bass note held straight through the kick. Version B: same note, cut to end a sixteenth before each kick and restart after. Listen for the kick's low end — in B it has room, and it thumps rather than thuds. Nothing was compressed. You just moved out of the way.

Once you can hear it, the mixer version is easy to reach for. Put a compressor on the bass channel from the effect chain, set it hard and fast, and you get the automatic version of the same idea — the machine does the ducking that you were writing by hand, on every kick, forever. There's a third option in between, and it's the one I reach for most: [draw the dips yourself on a volume lane](/learn/automation-loop-into-song), where you decide each move instead of a detector.

@math If you want the arithmetic: a starting point for a clean, functional duck is a ratio around 4:1, threshold set so the meter shows 4–6 dB of gain reduction on each kick, the fastest attack available, and release timed to the tempo. At 120 BPM a quarter note is 500 ms, so a release of roughly 150–250 ms lets the bass recover just before the next beat. Shorten the release and it snaps; lengthen it past the beat and the bass never fully returns, which sounds gutless. For the audible French house pump, push the ratio higher and the gain reduction toward 10 dB and stop pretending it's a fix.

Ignore all of that if it's noise to you. Set it by ear: increase the effect until you can clearly hear the pumping, then back it off until you can only feel it. That's the setting. Everyone arrives at the same place eventually, the numbers just get you there on a bad day.

## What you actually learned

Not a technique. A listening habit — and one you can keep building with [blind drills where you have to commit to an answer before you look](/learn/can-you-hear-the-difference).

The reason this took so long to explain is that sidechain compression is genuinely trivial once you've heard it, and completely opaque until then — which is why every tutorial that opens with "sidechain compression is a technique where a compressor's detection circuit receives an external input" loses people in eleven words. You had to hear it first. You did. Now the words are just labels for something you already know.

Go back to "One More Time" one more time. It's not subtle anymore, is it.

Both versions — writing the gaps by hand in the piano roll, and the compressor in the mixer's effect chain — run free in the browser at [100Lights](https://100lights.com), no downloads. Build the two-bar A/B from the last exercise; it takes about five minutes and it will stay with you.

And when you find a record doing something you can't explain, take it to the [community](https://100lights.com/community) and make somebody else listen for it. Half of learning to produce is just being told where to point your ears.
