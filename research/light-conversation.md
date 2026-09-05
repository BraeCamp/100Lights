# Talking to Light like a person

How a beginner should be able to ask for a sound they can only describe by
feel — "I want it to sound fuzzier", "let's make it wiggle" — and get there in
a short back-and-forth with something to listen to, instead of being expected
to know the word "low-pass".

Brae, 2026-09-05:

> U: "I want it to sound fuzzier"
> L: "Do you mean more muffled or more like static?"
> U: "More muffled"
> L: "This is what it will sound like at 50%" *(audio plays)*
> U: "Let's do that, yeah. Maybe just a little bit less of it, or it could start that way then lower?"
> L: "I can do that. Setting descending lowpass filter on [blank] from 50% to 20% from bars 1–9" *(creates sound)*
> L: "How does this sound?" *(plays from 2 bars before the effect to 2 bars after)*
> U: "It sounds good, thanks."
> L: "No problem."

The point is not to script that exchange. It is to change the machinery until
that exchange is one of the ordinary things that can happen.

---

## 1. Why it cannot happen today

Three walls, each of them deliberate, each of them now in the way.

**Light does not know the words.** `shape_tone` covers eight qualities —
brighter, darker, warmer, cleaner, punchier, softer, fuller, thinner — and they
are an `enum`. "Fuzzier" is not in it, so the sentence falls past every rule.
Worse than declining: it lands on whatever else matches. Before this batch,
"turn the session take slot down to 60%" was read as a tempo change, because
"slot" was a word no rule knew either. An unknown word does not fail safely; it
fails **sideways**.

**Light cannot ask a small question.** `lib/voice/ask.ts` is good machinery —
questions are data, they survive being spoken, drawn as buttons and answered
minutes later — but it exists for one purpose: *which* thing did you mean, the
bass track or the bass clip. There is nothing for *what did you mean by that
word*, which is a different question with different answers: not "which
object", but "which of two sounds".

**The assistant is one-shot on purpose.** Its own instructions say so: "When
every call runs the exchange ends there — you will not see the results — so put
everything the sentence asks for in one reply." That is a good rule for cost,
and it makes a conversation impossible. A model that cannot see what happened
cannot say "how does that sound?"

And underneath all three: **nothing in the studio can offer a sound before
committing to it.** `audition.ts` plays library items so you can hunt for a
sample. Nothing plays *the change you are considering*.

---

## 2. The shape of the fix

Four pieces. Each is useful alone, which is how they should be built and
shipped.

### 2.1 A vocabulary of ordinary words

A table from the words people actually use to the things this studio can
actually do — and, where a word is genuinely ambiguous, the two or three senses
it might carry with a plain question that tells them apart.

```
fuzzy    → distorted  "like static, with grit on it"      → saturation
         → muffled    "like it is behind a door"          → low-pass down
wiggle   → vibrato    "the pitch wobbling"                → pitch LFO
         → wobble     "the volume pulsing, like a pump"   → tremolo / autopan
         → warble     "the tone moving under it"          → filter LFO
boomy    → one sense                                      → low shelf down
tinny    → one sense                                      → low-pass up, body out
```

Two rules keep this honest rather than a pile of opinions:

- **A sense is a real move, not a mood.** Each one names a tool call the studio
  already has, with an amount. If it cannot be expressed as an edit, it does
  not belong in the table.
- **Derive rather than list, wherever the studio can measure it.**
  `preset-character.ts` already earns this: it works out that a preset is
  "dark" from its low-pass sitting at 2.6 kHz, not from anybody tagging it.
  The same argument applies to the ones that are measurable. The table is for
  the words that name a *change*, which is not something you can read off a
  preset.

The vocabulary serves both paths at once. The rules use it to answer the common
words instantly, with no model turn. The assistant is given it so that when it
meets a word nobody listed — "swampy" — its question is still shaped like the
studio's real abilities instead of inventing a control that does not exist.

### 2.2 A question that is about a sound, not an object

`ask.ts` extended with a second kind of question: here are two ways to read
what you said, each described in words a beginner has, each with something to
hear.

The answer may be a fragment ("the muffled one", "more like static", "the
second"), which `ask.ts` already handles through `keywords`.

**One question, then act.** A coworker asks once and gets on with it. If the
answer is still unclear, Light picks the commoner sense, says which it picked,
and leaves it easy to change — because an edit you can hear and undo is a
better question than another question.

### 2.3 A proposal you can hear, keep, or bend

The centre of the thing. A **proposal** is a change that has been made for real
but is still under discussion:

- the calls that made it, so it can be re-run at a different strength
- a plain sentence: "a low-pass coming down from 50% to 20% across bars 1–9"
- the span it touches, so it can be played back in context
- how to scale it, reverse it, spread it over time, or undo it

"Apply it for real, then talk about it" beats building a parallel preview
engine, for one reason: **what you hear is what you have.** A preview path
would be a second implementation of playback, and the day it drifted from the
real one it would be lying at exactly the moment somebody trusted it.

The proposal is what makes the third and fourth lines of Brae's dialogue
possible. "A little bit less of it" and "it could start that way then lower"
are not new requests to be parsed from scratch — they are operations on the
thing already on the table:

```
less / more            → scale the amount
start there then lower → make the amount a ramp across the span
undo that / never mind → revert
that is good / yeah    → let it go, stop holding it
```

### 2.4 Playing it back where it lives

"How does this sound?" plays from two bars before the change to two bars after
it. In context, because a filter sweep means nothing heard alone, and starting
from the top of the song to reach bar 9 wastes everybody's time.

---

## 3. What has to stay exactly as fast as it is

The instant path is the studio's advantage and none of this may slow it down.

- A sentence a rule already understands runs the way it always did. "Make the
  pad brighter" is not a conversation.
- The conversation opens only when the request is about a *feeling* rather than
  a parameter, or when a proposal is already on the table and the user is
  clearly still talking about it.
- Browsing words — next, back, again, faster — stay rules, as `audition.ts`
  insists, and stay untouched.

## 4. What could go wrong, and what to do about it

- **Light becomes chatty.** The failure mode people hate. One question maximum,
  and only when the word genuinely carries two senses this studio can tell
  apart. Everything else acts and lets the result be the answer.
- **The demo costs more than the edit.** Playing four bars takes four bars.
  Play the shortest span that carries the point, and let a word interrupt it.
- **The table becomes opinions.** Every sense must name a real move with an
  amount. A word nobody can express as an edit is a word Light should admit it
  does not know.
- **The vague path swallows the precise one.** A sentence that names a
  parameter is never a feeling: "low-pass to 800" must never open a
  conversation about what kind of muffled you meant.

## 5. Order of work

1. The vocabulary, pure and tested, with the common words answering instantly.
2. The proposal: hold it, scale it, ramp it, describe it, undo it.
3. Playback in context.
4. The sound question in `ask.ts`, wired to the vocabulary.
5. The assistant told it may ask and may propose, with the vocabulary in hand
   for the words nobody listed.
6. A headless check that runs Brae's dialogue end to end, on the real studio,
   listening to what comes out.
