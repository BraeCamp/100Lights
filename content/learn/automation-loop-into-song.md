---
title: Automation Is the Difference Between a Loop and a Song
description: Your track isn't static because it's missing an instrument. It's static because nothing moves. Volume, filter and send automation, and where to draw them.
date: 2026-07-20
tags: automation, arrangement, mixing
draft: true
---

# Automation Is the Difference Between a Loop and a Song

Every tutorial answers a boring loop the same way: add something. A riser. A vocal chop. A second percussion layer, a counter-melody, a pad underneath the pad. This advice has ruined more tracks than bad sound selection ever will, because it treats staticness as an absence when staticness is actually a *behavior*.

Your loop isn't missing an instrument. Nothing in it is changing. Those are completely different problems, and only one of them is fixed by adding — the other is fixed by [letting something leave](/learn/why-your-loop-gets-boring), or, as here, by making something move.

Here's the test. Play bar 1 of your loop against bar 7. Identical? Then it doesn't matter whether there are four instruments or fourteen — attention tracks change, not density, and it will leave at the same moment either way.

## Movement beats addition, and it isn't close

A low-pass filter opening slowly across sixteen bars will hold a listener better than any instrument you could add in that space. I'll go further: it'll hold them better than *three* instruments you could add, because the three instruments arrive and then sit there, whereas the filter is still arriving.

Listen to what a good producer does with sixteen bars and one chord. The chord doesn't change. The filter opens, the reverb send creeps up, and the whole thing walks toward you. Same notes throughout.

@theory Your ears are change detectors before they're anything else. Sustained, unchanging sound gets pushed into the background by your own perception within a few seconds — it becomes the room rather than the event. A slowly opening filter defeats this by never letting the sound settle into a fixed identity: each moment it's slightly brighter than the last, so the ear keeps re-noticing it. Adding a new instrument buys you one moment of attention. Movement buys you a continuous one.

@audio(/learn-audio/automation-filter-sweep.mp3) Sixteen bars, one chord progression, nothing else in the project. The only thing happening is a filter opening and a reverb send creeping up.

## The three that do 90% of the work

**Volume.** The most underrated, because it's the least glamorous. Not mixing — I don't mean setting your levels. I mean drawing the hi-hats down four decibels for the eight bars before the chorus so the chorus is louder without touching the chorus. I mean fading a pad in over two full bars instead of having it appear. I mean pulling the bass down one and a half decibels under the vocal, then back up in the gaps.

That last one does by hand what [a compressor listening to the kick does automatically](/learn/sidechain-compression-with-your-ears), except you're deciding each move, and it sounds better every time. It's also tedious — a proper volume ride is forty little moves and half an hour.

**Filter.** The workhorse. Cutoff automation is how sections get introduced and how energy gets built without changing a single note. The pattern that works nearly always: close the filter hard at the top of a section so the part is a muffled suggestion, then open it across the whole section so it arrives fully at the last possible moment. Not over two bars. Over sixteen. Slow enough that nobody consciously notices, which is exactly the point.

The failure mode is doing it fast and doing it everywhere. A filter sweep that resolves in one bar is a sound effect. Everyone can hear it, it reads as a transition, and after the third one your track sounds like a preset.

**Sends.** The subtle one, and the one that separates records that feel like spaces from records that feel like files. Automate the reverb send, not the reverb. Push a snare's send up for the final hit of a phrase so the tail blooms into the next bar. Drop a vocal's delay send to zero during the dense parts and crank it in the gaps — that's how a delay stays audible without turning the mix to soup.

@ear Take any loop you've got. Delete nothing, add nothing. Close a low-pass on your main harmonic element to around 400 Hz at bar 1 and draw it open to fully bright by bar 16, in one straight line. Play sixteen bars. Then play the un-automated version right after. The second one will sound like it's standing still, and you'll hear it in about four seconds. That's the whole article.

## Where to actually draw them

Long. Longer than you think. This is the single most common error and it's not close.

The instinct is to automate over one or two bars, because that's the timescale you're zoomed in at. Zoom out. Most automation that makes a track feel like a track spans sixteen to thirty-two bars — [two or four of the eight-bar blocks everything else is already built from](/learn/song-structure-and-why-eight-bars) — and at that length the listener experiences it as *the song developing* rather than as *an effect happening*.

A starting point rather than gospel: filter opens across a whole section, volume rides across a phrase, send moves across two or four bars. Anything under one bar is a transition effect, not automation.

@math At 128 BPM, one bar of 4/4 is 1.875 seconds — so a 16-bar filter sweep runs 30 seconds and a 32-bar one runs a full minute. Bar length in seconds is 240 divided by BPM for 4/4. Worth calculating once so you know what you're actually asking a listener to sit through: a "slow" sweep you drew across four bars is over in seven and a half seconds.

## The counter-argument

Some genres want stasis. A lot of good techno is deliberately a loop for eleven minutes, and the craft is in how little changes. Fair — but go listen closely to one. The filter is moving. The reverb send is moving. The stasis is compositional, not literal, and underneath it the automation works harder than in almost any other genre precisely *because* nothing else may change.

So the exception proves it. Even the music built on repetition isn't actually repeating.

## Hear it done to the same loop

Here's the argument as audio. Two renders of one loop — same notes, same drums, loudness-matched. The only difference is whether anything moves.

@audio(/learn-audio/automation-before.mp3) Before: nothing automated. Every fader parked, filter parked, send parked. It is not a bad loop.

@audio(/learn-audio/automation-after.mp3) After: same loop, three automation lanes. Filter opening across all sixteen bars, pad rising a couple of decibels, reverb send swelling toward the end.

Play the first and notice the moment you stop listening. For most people it's bar six — the loop hasn't got worse, you've just finished learning it. Now play the second. Nothing new arrives, but it keeps arriving *somewhere*.

@ear Play them back to back, then play the "before" one last time. On the second pass it sounds worse than it did the first time — not because it changed, but because you now know what it was missing.

## Do this to the loop you already have

Open the project you've been stuck on. Don't add a track.

Pick your busiest element and automate its volume down across the eight bars before your biggest moment. Pick your main chord or pad and draw a filter opening across the entire section. Pick one element and automate a reverb send upward toward the end of a phrase, then back down.

Three moves. No new sounds. Play it back and see whether the thing you thought was missing an instrument was actually just missing motion.

All of it runs in the free browser studio — [100Lights](https://100lights.com) has per-track effect chains and a mixer with sends and returns, so the filter and the send you need are already there. If you want to hear how other people are using it, the [community](https://100lights.com/community) has published songs you can open and inspect — automation is one of the few things that's genuinely easier to learn by looking at somebody else's project than by reading about it.

It took me an embarrassingly long time to believe this, mostly because automation is dull work and adding a new instrument is fun. But the tracks that sounded finished were never the crowded ones. They were the ones where something, somewhere, was always quietly on its way somewhere else.
