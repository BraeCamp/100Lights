---
title: Can You Hear the Difference?
description: Four blind listening tests you run on yourself — compression, EQ, reverb, and one decibel — with the answers withheld until after you commit to a guess.
date: 2026-07-20
tags: ear-training, mixing, listening
draft: true
publishAt: 2026-08-01T16:00:00Z
---

# Can You Hear the Difference?

Load a drum loop. Any drum loop — one of your own, or something from the sound library. Play it once at a volume where you can hear the room around it. Don't touch anything yet.

@grid(%7B%22lanes%22%3A%5B%7B%22name%22%3A%22Kick%22%2C%22sound%22%3A%22kick%22%7D%2C%7B%22name%22%3A%22Snare%22%2C%22sound%22%3A%22snare%22%7D%2C%7B%22name%22%3A%22Hat%22%2C%22sound%22%3A%22hat%22%7D%2C%7B%22name%22%3A%22Clap%22%2C%22sound%22%3A%22clap%22%7D%5D%2C%22steps%22%3A16%2C%22bpm%22%3A120%2C%22pattern%22%3A%5B%5B0%2C4%2C8%2C12%5D%2C%5B4%2C12%5D%2C%5B0%2C2%2C4%2C6%2C8%2C10%2C12%2C14%5D%2C%5B%5D%5D%7D) A four-on-the-floor loop to run these tests on. Play it — then use the blind A/B players below and commit to an answer before you look.

Now I'm going to change one thing, and you're going to tell me what changed. You have to say it out loud, or write it down, before you look. That rule is the whole article. A guess you keep in your head isn't a guess, it's a memory you'll edit after the fact, and you will absolutely edit it.

Here's the part nobody says first: you will probably fail some of these. Not because you have bad ears. Because nobody has ever asked your ears to do this specific job before, and they've had no reason to get good at it. Hearing is the one part of your studio you cannot buy, and it's the only part that reliably improves.

## Test one: is the compressor on?

Take that drum loop. Put a compressor on the track. Set the threshold so the loudest hits are being caught — you'll see the meter move — and leave the ratio moderate. Now bypass it.

@ear Play four bars with the compressor bypassed, then four bars with it engaged, without touching the output volume. Loop that A/B six times. Then say which one is compressed before you look at the button.

@ab(%7B%22plainSrc%22%3A%22%2Fapi%2Fdemo-audio%2Fhear-comp-off%22%2C%22treatedSrc%22%3A%22%2Fapi%2Fdemo-audio%2Fhear-comp-on%22%2C%22question%22%3A%22One%20of%20these%20has%20a%20compressor%20on%20it%2C%20output%20gain%20matched%20so%20both%20hit%20the%20same%20loudness.%20Which%20is%20compressed%3F%22%2C%22explanation%22%3A%22Compression%20lifts%20the%20quiet%20material%2C%20not%20the%20hits%20%E2%80%94%20listen%20for%20the%20snare%20tail%20and%20the%20hats%20ticking%20under%20the%20kick%2C%20not%20the%20peaks.%22%7D)

Most people get this wrong the first time, and they get it wrong in a specific direction: they pick the *louder* one as the compressed one, which is backwards from what the compressor is doing to the peaks. If you got it right by picking "louder," you got it right for the wrong reason, and that reason will fail you the moment someone matches the levels.

Do it again with the output gain compensated so both versions hit the same apparent loudness. Harder now, isn't it.

@theory A compressor doesn't make things louder. It makes the loud parts quieter, which lets you turn everything up afterward — so what you actually hear is the *quiet* material rising. The tail of the snare. The room. The hi-hat ticking underneath the kick. Compression is not a volume effect, it's a contrast effect, and the thing to listen for is not the hits but the space between them.

Go back and listen for the space between them. It's a different test now.

## Test two: cut or boost?

Same loop. Put an EQ on it. Make one move around the low-mid region — the muddy zone where kick and bass argue — and make it a big move, six decibels or so. Sometimes cut, sometimes boost. Get someone else to do it, or set up two saved states and shuffle which one loads.

@ear Listen to the EQ'd version alone, with no reference, for eight bars. Decide: was that a cut or a boost? Then check.

@ab(%7B%22plainSrc%22%3A%22%2Fapi%2Fdemo-audio%2Fhear-eq-cut%22%2C%22treatedSrc%22%3A%22%2Fapi%2Fdemo-audio%2Fhear-eq-boost%22%2C%22question%22%3A%22One%20clip%20has%20the%20low-mids%20scooped%20out%3B%20the%20other%20has%20them%20pushed%20up%20loud.%20Which%20one%20is%20the%20cut%3F%22%2C%22explanation%22%3A%22Boosts%20announce%20themselves%20as%20a%20new%20thing%20arriving%3B%20cuts%20read%20as%20clarity%20%E2%80%94%20which%20is%20why%20cutting%20sounds%20like%20doing%20nothing%20and%20usually%20wins.%22%7D)

Nearly everyone can hear that *something* happened. Far fewer can name the direction blind, and that's the skill that actually matters, because in a real mix you don't get an A/B — you get a track that sounds slightly wrong and forty minutes to figure out why.

@theory Boosts and cuts are not mirror images to the ear, even at the same amount. A boost draws attention to itself; you hear the frequency arrive as a new thing in the mix. A cut mostly makes other things audible, so it registers as clarity rather than as a change — which is why engineers who cut sound like they're doing nothing and engineers who boost sound like they're doing a lot. Cutting is quieter work and it usually wins.

@math If you want the region by number: the mud people complain about lives roughly between 200 and 500 Hz, and the presence people reach for lives around 3 kHz. Ignore both numbers if they don't help — the frequency label is a filing system, not the thing you're listening to.

## Test three: how long is that reverb?

Send a snare — just the snare, soloed — to a reverb. Set a short decay. Under a second. Listen to eight hits. Now set a long decay, three seconds or more. Listen to eight hits.

That one's easy. Everyone hears it. So let's make it fair.

@ear Set two reverbs a little apart — say one at 0.8 seconds and one at 1.4 — and A/B them under a *full* loop, not a soloed snare. Kick, snare, hats, bass, all playing. Now tell me which is longer.

@ab(%7B%22plainSrc%22%3A%22%2Fapi%2Fdemo-audio%2Fhear-verb-08%22%2C%22treatedSrc%22%3A%22%2Fapi%2Fdemo-audio%2Fhear-verb-14%22%2C%22question%22%3A%22Both%20have%20snare%20reverb%20under%20a%20full%20loop.%20Which%20reverb%20is%20longer%3F%22%2C%22explanation%22%3A%22Reverb%20length%20lives%20in%20the%20gaps%3B%20under%20a%20busy%20loop%20a%20long%20tail%20gets%20buried%20under%20the%20next%20hit%2C%20which%20is%20why%20solo%20reverb%20judgments%20lie.%22%7D)

This is where a lot of people discover that their reverb judgments have been made in solo, and solo is a lie. In a busy mix the tail gets buried under the next hit, so a reverb that sounded gorgeous alone contributes nothing but a haze you'll later describe as "the mix sounds cloudy."

@theory Reverb length is heard almost entirely in the gaps. If the arrangement never leaves a gap, the reverb has nowhere to be audible, and all it does is smear the attack of whatever comes next. This is why sparse records can carry enormous reverbs and dense records usually can't — it isn't taste, it's arithmetic of silence.

## Test four: how small a move can you hear?

Here's the one that humbles people. Take any single element — the hi-hats will do — and push its fader up a few decibels. Enough that it's a real, deliberate move, not a nudge.

@ear A/B the mix with the hats at their original level and a few decibels higher. Four bars each. Six passes. Commit to an answer.

@ab(%7B%22plainSrc%22%3A%22%2Fapi%2Fdemo-audio%2Fhear-hats-0%22%2C%22treatedSrc%22%3A%22%2Fapi%2Fdemo-audio%2Fhear-hats-plus1%22%2C%22question%22%3A%22The%20hi-hats%20are%20a%20few%20decibels%20louder%20in%20one%20of%20these.%20Which%20one%3F%22%2C%22explanation%22%3A%22This%20one%20most%20people%20can%20get.%20Try%20the%20same%20test%20at%20one%20decibel%20and%20you%20almost%20certainly%20cannot%20%E2%80%94%20which%20is%20why%20the%20tiny%20fader%20nudges%20you%20call%20%E2%80%9Cbetter%E2%80%9D%20are%20mostly%20your%20hand%20moving%2C%20not%20your%20ears.%22%7D)

That one you can probably get. Now imagine it at a single decibel instead — the move you actually make when you nudge a fader and think "yes, better." At that size you're almost certainly hearing your own hand move, not the mix. A change big enough to hear is a change big enough to matter; anything smaller is a story you're telling yourself.

Now try three decibels. Most people hear three. The gap between "can't hear one" and "can hear three" is where mixing actually lives, and it narrows with practice — genuinely, measurably, over months. Not weeks. I spent a year unable to hear a one-decibel change on anything but a lead vocal.

@math Three decibels is roughly double the power, and ten is the rough point where most listeners say "twice as loud." Those two facts are unrelated and both true, which is why the numbers help less than you'd hope.

@studio(/tutorial/fx) Learn to blind-test effects — step by step →

## What to do with all this

Run these drills on records you already know inside out. Take something with an unmistakable mix — *Bad Guy*, or *Seven Nation Army*, or any Steely Dan — and try to describe what the snare's reverb is doing before you try it on your own track. Known material is a better teacher than your own work, because with your own work you can't tell the difference between "this sounds right" and "this sounds familiar."

All four drills run start to finish in the free studio at [100Lights](https://100lights.com) — you need a loop, a mixer, and the bypass button, and that's it. Sends and returns make the reverb test easier to set up: one reverb on a return, two saved decay settings, flip between them.

Then go argue with someone. Post a loop to the [community](https://100lights.com/community) with two versions and let people guess which is which — you'll learn more from the people who guess wrong than from the ones who guess right, because their wrong answers will name things you weren't listening for.

The gear is not the bottleneck. It hasn't been for twenty years.
