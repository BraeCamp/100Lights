---
title: How to Loop a Sample (and Make It Sound Intentional)
description: Loop points get chosen by transient, not by grid — the trade secret behind samples that sound produced instead of pasted.
date: 2026-07-20
tags: sampling, loops, technique
draft: true
---

# How to Loop a Sample (and Make It Sound Intentional)

Here's something nobody says out loud in a sampling tutorial: the loop point is almost never where the grid says it is.

You've been taught to trim a sample to the bar. Zoom in, snap to the line, cut. And when the loop clicks or stumbles you assume you got the tempo wrong, so you nudge the BPM by half a beat and try again, and it's still wrong, and eventually you cover the seam with a crash cymbal and move on.

Everyone covers the seam with a crash cymbal. That's the tell.

The people who do this for a living aren't finding the bar line. They're finding the transient — the physical attack of the sound — and cutting there, because the bar line is a mathematical fiction and the transient is where a human being actually hit something. Those two things are close. They are not the same. The gap between them is the entire difference between a loop that sounds like a record and a loop that sounds like a file.

## The drummer was late (or early)

A grid is perfect. A drummer is not, and hasn't been since the invention of the drummer.

When a session player hits a snare on beat 3, the stick lands somewhere in a window a few milliseconds wide, and where it lands inside that window is that player's feel. Push it forward and the track drags. Pull it back and it rushes. Producers pay serious money for a specific human's specific window.

So when you slice a bar out of that performance at exactly the grid line, you are cutting through the middle of someone's timing decision. Sometimes you clip the front off the kick and the loop starts limp. Sometimes you leave 8ms of silence in front of it and every repeat of your loop arrives fractionally late — not late enough to notice, exactly late enough to feel wrong.

@theory Your ear does not locate a drum hit at the moment the waveform starts. It locates it at the peak of the attack, a hair afterward. This is why a kick with a slow, soft attack has to be placed earlier than a clicky one to feel like it's in the same place. Grid position and perceived position are two different things, and only one of them is audible.

@ear Load any breakbeat from the sound library and set a one-bar loop by eye, snapped to the grid. Play it eight times. Now drag the loop's start point a few pixels earlier — into the silence before the kick — and play it eight more. One of those two versions makes you want to nod. That's not a measurement, that's the whole skill.

## Trim to the transient, not the line

The working method, in order:

Zoom in until the waveform stops looking like a shape and starts looking like a drawing. You want to see the individual attack — that near-vertical spike where the kick begins. Put your loop start a whisker *before* that spike, capturing a couple of milliseconds of the near-silence in front of it. Not on the spike. Before it.

Then find the same drum one bar later and do the same thing. Your loop is now one bar of that drummer's actual playing, including their actual timing, instead of one bar of the grid's opinion about it.

If the sample was played to a click and the transient sits basically on the line, congratulations — you've lost twenty seconds and learned that this particular sample is honest. Most aren't. Anything sampled off a record made before about 1985 definitely isn't.

## Why beginner loops click

The click is not a bug in your studio. It's arithmetic, and it happens for one reason: your loop starts and ends at different points on the waveform's vertical axis.

Picture the waveform as a line wobbling above and below a center rest position. If your loop ends while that line is high up and restarts while it's sitting at center, the speaker cone gets ordered to jump from one position to the other instantly. That instantaneous jump *is* a click. You've accidentally written a tiny, extremely fast percussion hit into your track, and it repeats every single bar, and it's the reason your loop sounds cheap in a way you can't name.

@ab(%7B%22plainSrc%22%3A%22%2Fapi%2Fdemo-audio%2Floop-clean%22%2C%22treatedSrc%22%3A%22%2Fapi%2Fdemo-audio%2Floop-click%22%2C%22question%22%3A%22One%20of%20these%20loops%20clicks%20on%20every%20repeat.%20Which%20%E2%80%94%20and%20can%20you%20tell%20it%20is%20a%20click%20rather%20than%20part%20of%20the%20beat%3F%22%2C%22explanation%22%3A%22The%20click%20is%20a%20discontinuity%3A%20the%20loop%20restarts%20at%20a%20different%20point%20on%20the%20waveform.%20Trim%20to%20a%20zero-crossing%20or%20add%20a%20short%20fade%20and%20it%20is%20gone.%22%7D)

@math The rest position is sample value zero, and the places where the waveform crosses it are zero-crossings. Trim both ends to a zero-crossing and the discontinuity is exactly zero, so there is nothing to click. A crossfade solves the same problem differently: overlap the end and start by 2–10 ms and ramp one down as the other comes up, and the jump gets smeared across roughly 100–400 samples at 44.1 kHz — far too slow to register as an attack.

You can delete that paragraph and still fix your loops. Trim into quiet parts, and add a short fade at both edges. That's it. The fade is doing something real even at two milliseconds — short enough that you cannot hear it as a fade, long enough that the speaker isn't asked to teleport.

## The tail is the point

Now the actual secret, the one that separates a loop that sounds intentional from a loop that sounds correct.

Cut a drum loop dead clean at the end of bar 4 and it will be technically flawless and sound like nothing. Because in the room where that was recorded, the cymbal from bar 4 was still ringing when bar 1 came around again. The reverb tail of the snare was still decaying. Rooms don't reset.

So you let it bleed. Take a slightly longer tail than you need — a few hundred milliseconds past your loop end — and lay it over the top of the loop's beginning, quiet, decaying. The listener hears the end of the phrase and the start of the phrase happening at once, which is exactly what happens in a real room, and their ear reads it as continuity rather than as repetition.

This is why sampled records feel warm and your programmed loop feels stapled together. Not the gear. The overlap.

Practically: duplicate your clip, trim the copy down to just that ringing tail, drop it on a second track at the top of the next repeat, and pull the fader down until you'd miss it if it vanished but can't quite point at it. A short reverb send from the mixer gets you partway there too, but the bleed is better, because it's the actual sound of the actual room rather than a guess at one.

## Where this leaves you

Four things worth arguing with, all doable start to finish in the free browser studio at [100Lights](https://100lights.com) with nothing installed:

Cut on transients. Trim into quiet. Fade both edges even when you don't think you need to. Let the last bar bleed into the first.

The tedious part is real — finding transients means zooming in further than feels reasonable, and the first ten loops you edit this way will take fifteen minutes each. After about thirty you'll do it in forty seconds and stop thinking about it. That's the whole apprenticeship.

When you get a loop that breathes, publish the chop to the [community](https://100lights.com/community) so somebody else can build on it. Everyone in this game is working from someone else's tail.
