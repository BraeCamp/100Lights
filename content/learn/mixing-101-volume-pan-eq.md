---
title: Mixing 101: Volume, Pan, and EQ Before Anything Else
description: Your mix isn't muddy because you need better plugins. It's muddy because you reached for reverb before you got the faders right.
date: 2026-07-20
tags: mixing, eq, beginner
draft: true
---

# Mixing 101: Volume, Pan, and EQ Before Anything Else

Your mix is not muddy because you're missing a plugin. It's muddy because you put reverb on it before the faders were right, and now you're trying to fix a balance problem with an effect, which has never once worked for anybody.

Every mixing tutorial on the internet is structured as a tour of processors. Here's compression. Here's saturation. Here's a multiband thing with fourteen knobs. The video is nine minutes long and roughly eight of them are about equipment, because equipment is what you can film. Nobody makes a nine-minute video about dragging a fader down four decibels, even though that is the single most powerful move in mixing and it is free and it comes with every studio ever made.

I'll go further. Volume balance is about eighty percent of a finished mix. Panning is another ten. Subtractive EQ is most of what's left. Everything you've been sold — the compressors, the reverbs, the tape emulations — is fighting over the last few percent, and it cannot save a mix where the snare is too loud.

## The order of operations, and why it's not negotiable

Balance. Pan. Cut. Then, maybe, everything else.

That order isn't a preference. It's causal. Each step changes the answer to the next one, so doing them backwards means solving problems that only exist because you're out of order.

Put reverb on a vocal that's 5 dB too loud and you'll hear the vocal as harsh, so you'll reach for EQ to tame the top end, which makes it dull, so you'll add an exciter to bring the air back, and now you have three processors on a channel whose only actual problem was a fader. I've watched people do this for hours. I did it for about two years, and the plugin folder I built during that period is genuinely embarrassing.

@ear Take any project you've mixed. Bypass every effect on every channel — all of it, reverb included. Pull every fader to the bottom. Now bring up the kick until it's comfortable, then the snare until it sits with the kick, then bass, then everything else, one at a time, never touching one you've already set. Ten minutes. Then unbypass your effects. Most of the time the effects now sound like they're in the way, and that's your answer about what they were doing.

## Step one: balance, with your eyes shut

Faders down. Kick up first, to a level where you could listen for an hour.

Then bring each remaining element up until you can *just* hear it doing its job — and stop there. Not until it sounds good on its own. Until it sounds like part of the thing. The most common beginner error is soloing a track, making it sound enormous, and un-soloing it, at which point it is 6 dB too loud and everything else has to be pushed up to compete. Do that for twelve tracks and you have a mix where everything is loud and nothing is audible.

Two rules I'd defend in an argument:

- If you can't hear an element, the fix is usually turning something *else* down. Turning it up is the move that starts the arms race.
- If a track sounds great soloed, it's probably too big for the mix. Solo is a diagnostic tool, not a mixing environment.

Go quiet, too. Your ears lie about balance at high volume — bass and treble read louder as the level goes up, so a mix built loud falls apart quiet. Set the balance at conversation volume. If it works at a whisper, it works anywhere.

@theory Loudness and frequency aren't independent to the human ear. At low listening levels your hearing is markedly less sensitive to lows and highs than to the midrange, and it flattens out as things get louder. That's why a mix that sounded huge at midnight sounds thin in the car: you balanced it at a volume where your ears were flattering the bass, then listened back at one where they weren't.

## Step two: pan, and be brave about it

Stereo is a room. Two things at the same spot in that room fight; two things in different spots don't. Panning is free separation and beginners use almost none of it, because we all learned on tutorials where everything hovers timidly around center.

Kick, bass, snare, lead vocal: center. That's near-universal and mostly about low-end energy and focus.

Everything else: move it. Hard. If you have two guitars or two synth layers doing similar things, put one at the far left and one at the far right — full width, not 30% — and listen to the middle of your mix open up. Doubled parts panned wide is the oldest trick in rock production and it still works because it's physics, not fashion.

@ab(%7B%22plainSrc%22%3A%22%2Flearn-audio%2Fmix-pan-center.mp3%22%2C%22treatedSrc%22%3A%22%2Flearn-audio%2Fmix-pan-wide.mp3%22%2C%22question%22%3A%22Two%20synth%20layers%20%E2%80%94%20one%20version%20stacks%20them%20in%20the%20centre%2C%20one%20pans%20them%20hard%20left%20and%20right.%20Which%20opens%20up%20the%20middle%3F%22%2C%22explanation%22%3A%22Two%20things%20at%20the%20same%20spot%20in%20the%20stereo%20field%20fight%3B%20full-width%20panning%20is%20free%20separation%2C%20and%20it%20is%20physics%2C%20not%20taste.%22%7D)

Hi-hats slightly off-center. Percussion off to one side with its answer on the other. Two background vocal stacks pinned to the edges. The moment you spread things out, the EQ problems you were about to fix stop being problems, which is the point of doing this before you touch an EQ.

## Step three: cut, don't boost

Now EQ — and only subtractive EQ. You're removing what's in the way, not adding what's missing.

Almost every muddy mix has the same disease: six different instruments all producing energy in the low mids, that region where pianos, guitars, vocals, snares and synth pads all live. Individually they're fine. Stacked, they're a fog.

The move is to decide what owns each region and get everything else out of its way. Bass owns the bottom. So take a high-pass filter — a shelf that removes everything below a chosen point — and put one on almost every other track, pulling out low end those tracks weren't using anyway. Guitars, pads, vocals, hats, all of them. You will not hear anything disappear. You will hear the bass and kick suddenly become clear, because they finally have the basement to themselves.

@ab(%7B%22plainSrc%22%3A%22%2Flearn-audio%2Fmix-mud.mp3%22%2C%22treatedSrc%22%3A%22%2Flearn-audio%2Fmix-hp.mp3%22%2C%22question%22%3A%22One%20mix%20high-passes%20everything%20except%20the%20kick%20and%20bass.%20Which%20one%2C%20and%20does%20anything%20sound%20missing%3F%22%2C%22explanation%22%3A%22Nothing%20disappears%20%E2%80%94%20you%20gave%20the%20kick%20and%20bass%20the%20basement%20to%20themselves%2C%20which%20is%20why%20subtractive%20EQ%20reads%20as%20clarity%20rather%20than%20change.%22%7D)

Then hunt. Sweep a narrow boost across a track until you find the frequency that sounds worst — boxy, honky, harsh — and instead of leaving the boost, invert it into a cut of a few decibels. That's the whole technique. It's unglamorous and it works.

@math Rough starting points, all adjustable by ear: high-pass hats and cymbals around 400 Hz, most synths and guitars around 100–150 Hz, and a lead vocal around 80–100 Hz. Boxiness usually hides between 200 and 500 Hz; harshness between 2 and 4 kHz. Cuts of 3–6 dB with a moderately narrow bandwidth do more than most people expect. None of these are laws — they're where to point the flashlight first.

Every one of those numbers can be ignored. Find the ugly frequency by ear, turn it down until it stops being ugly, move on.

## Then, and only then

Once the faders are right, the panning is wide and the mud is gone, put on your compressor and your reverb. Two things will happen. You'll use far less of both than you used to, and they'll do something you can actually hear — because they'll be shaping a mix instead of hiding one.

All of this — the mixer, the sends and returns, EQ, compression, reverb, delay — runs in the browser for free at [100Lights](https://100lights.com), which means the excuse about gear is gone. The faders were always the point.

Mix something this way, then publish the stems to the [community](https://100lights.com/community) and let somebody else mix it their way. Comparing two balances of the same song will teach you more in an afternoon than a year of plugin videos.
