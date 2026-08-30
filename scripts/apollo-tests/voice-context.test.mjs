#!/usr/bin/env node
// Does a word ever get corrected into another word without a context check?
//
//   node --experimental-strip-types scripts/apollo-tests/voice-context.test.mjs
//
// Brae: "I see that words are correcting from other words, but why don't we
// have overlapping possible changes, a context check between different versions
// before correction... this way nothing will correct to another word without a
// context check."
//
// The failure he is describing is not hypothetical — it was live. "bass" is one
// edit from "bars", so a greedy reader bent it, deleted it as a unit of time,
// and then reported it could not find the track. The project had a track called
// Bass 2 sitting in it the whole time. Every fact needed to reject that
// correction was available and had already been discarded.
//
// So the parser now produces EVERY reading of a sentence and compares them
// before believing any one of them. The property under test is not "the parser
// gets these sentences right" — that is the other suite. It is stronger and
// stranger:
//
//   THE SAME SENTENCE MUST BE READ DIFFERENTLY IN DIFFERENT PROJECTS.
//
// A reading that ignores what the project contains cannot pass this file, no
// matter how many individual sentences it happens to get right. That is what
// makes it a context check rather than a longer list of special cases.

import assert from 'node:assert'
import { importTs } from '../lib/ts-import.mjs'

const { interpret } = await importTs('lib/voice/interpret.ts')
const { confidentEnough } = await importTs('lib/voice/local-resolve.ts')
const { VOICE_COMMANDS } = await importTs('lib/voice/commands.ts')

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const tracks = (...names) => ({
  tracks: names.map((name, i) => ({ id: `t${i}`, name, volume: 0.8, pan: 0 })),
  tempo: 120,
})

const WITH_BASS = tracks('Bass 2', 'Pad', 'Drums')
const NO_BASS = tracks('Keys', 'Pad', 'Drums')
const WITH_BARS = tracks('Bars', 'Pad', 'Drums')

const read = (s, ctx) => interpret(s, ctx)

// ── The bug itself, from both sides ─────────────────────────────────────────
//
// One sentence, two projects. The words are identical; the only thing that
// differs is whether a track called Bass exists. If the answer is the same in
// both, no context was consulted.
{
  const s = 'close the filter on the bass over 4 bars'
  const withIt = read(s, WITH_BASS)
  const without = read(s, NO_BASS)

  check('a project WITH a Bass track hears a filter on the bass',
    withIt.matched === 'automate_parameter.filter'
    && withIt.calls[0]?.input?.target === 'Bass 2',
    `${withIt.matched} → ${JSON.stringify(withIt.calls[0]?.input?.target)}`)

  check('a project WITHOUT one does not invent a target',
    without.calls.length === 0 || without.calls[0]?.input?.target !== 'Bass 2',
    `${without.matched} → ${JSON.stringify(without.calls[0]?.input?.target)}`)

  check('so the same words read differently in different projects',
    JSON.stringify(withIt.calls) !== JSON.stringify(without.calls),
    'identical readings would mean no context was consulted')
}

// ── A name is not silently rewritten into a command word ───────────────────
{
  // "bars" here is a real track. Bending it into the unit of time would be the
  // same mistake in the other direction.
  const r = read('mute the bars', WITH_BARS)
  check('a track really called Bars can be muted by name',
    r.calls[0]?.name === 'set_track' && r.calls[0]?.input?.target === 'Bars',
    `${r.matched} → ${JSON.stringify(r.calls[0]?.input)}`)
}
{
  // And the unit still works when it IS the unit, even in that project.
  const r = read('loop bars 9 to 17', WITH_BARS)
  check('and the same word still works as a unit of time',
    r.matched === 'set_loop_region.range'
    && JSON.stringify(r.calls[0]?.input) === '{"start":{"bar":9},"end":{"bar":17}}',
    `${r.matched} → ${JSON.stringify(r.calls[0]?.input)}`)
}

// ── Corrections are still allowed, when nothing truer is available ─────────
//
// "sole" for "solo" is a single substitution and a genuinely plausible
// mishearing, which is the case worth testing. ("moot" for "mute" is TWO edits
// and was never a candidate — a reminder that a test can be wrong about its own
// premise and pass for the wrong reason.)
{
  const r = read('sole the vocals', tracks('Vocals', 'Pad', 'Drums'))
  check('a misheard command word is still corrected',
    r.calls[0]?.name === 'set_track' && r.calls[0]?.input?.solo === true,
    `${r.matched} → ${JSON.stringify(r.calls[0]?.input)}`)
}
{
  // ...but not when the word it would be bent FROM names a real track. Here
  // "sole" is a track, so reading it as "solo" throws away a name.
  const r = read('sole the vocals', tracks('Sole', 'Vocals', 'Drums'))
  // It may still reach the right answer — "Sole" probably WAS a mispronounced
  // "solo". The requirement is that it does not do so SILENTLY while a track by
  // that name sits in the project, so the reading is offered rather than run.
  check('a word that names a real track is never bent silently',
    !confidentEnough(r, 1),
    `${r.matched} → ${JSON.stringify(r.calls[0]?.input)}, ${r.corrections} corrections`)
  check('and the cost of that bend is recorded', r.corrections >= 2, String(r.corrections))
}
{
  // The mirror case, and the one that made this necessary: a new track is
  // called "Track 2" by default, which makes the word "track" name something
  // real. Every "the X track" phrasing has to keep working anyway.
  const r = read('delete the drums track', tracks('Drums', 'Bass 2', 'Track 2'))
  check('"the X track" still works in a project with a track called Track 2',
    r.matched === 'remove_track' && r.calls[0]?.input?.target === 'Drums',
    `${r.matched} → ${JSON.stringify(r.calls[0]?.input)}`)
  check('and it runs without asking, because nothing was bent far',
    confidentEnough(r, 1), `${r.corrections} corrections`)
}

// ── Coverage decides between overlapping readings ──────────────────────────
{
  const r = read('play the bass louder', WITH_BASS)
  check('a sentence containing "play" that is not about the transport',
    r.matched !== 'transport.play', r.matched)
  check('and it is read as the mixer command it is',
    r.calls[0]?.name === 'set_track' && typeof r.calls[0]?.input?.volume === 'number',
    JSON.stringify(r.calls[0]?.input))

  // The mechanism, not just the outcome: the winning reading explains more of
  // the sentence than the transport reading it beat.
  const winner = r.candidates.find(c => c.id === r.matched)
  const transport = r.candidates.find(c => c.id === 'transport.play')
  check('because it explains more of the sentence',
    !transport || winner.coverage > transport.coverage,
    `${winner?.coverage?.toFixed(2)} vs ${transport?.coverage?.toFixed(2) ?? 'n/a'}`)
}

// ── An uncorrected reading beats a corrected one ───────────────────────────
{
  const r = read('mute the pad', WITH_BASS)
  const winner = r.candidates.find(c => c.id === r.matched)
  check('the winning reading of a clean sentence bends nothing',
    winner.corrections === 0, `${winner.corrections} corrections`)
}

// ── A number in a track's name is not an argument ─────────────────────────
//
// Bass 2, Take 3, Verse 1 — numbered names are the norm in a studio, not an
// edge case. Every rule that takes a number had the same bug: it read the first
// number in the sentence, which is the one in the name. "pan the bass 2 left"
// panned two percent left, "set bass 2 to 40 percent" set the volume to 2%, and
// each produced a confident, plausible read-back describing the wrong thing.
{
  const r = read('pan the bass 2 left', WITH_BASS)
  check('"pan the bass 2 left" pans hard, not 2%',
    r.calls[0]?.input?.pan === -60,
    `pan ${r.calls[0]?.input?.pan}`)
}
{
  const r = read('set the bass 2 to 40 percent', WITH_BASS)
  check('"set the bass 2 to 40 percent" is 40%, not 2%',
    r.calls[0]?.input?.volume === 40 && r.calls[0]?.input?.target === 'Bass 2',
    JSON.stringify(r.calls[0]?.input))
}
{
  const r = read('loop the bass 2 three more times', WITH_BASS)
  check('"loop the bass 2 three more times" repeats three times, not two',
    r.calls[0]?.input?.count === 3 && r.calls[0]?.input?.target === 'Bass 2',
    JSON.stringify(r.calls[0]?.input))
}
{
  const r = read('take the bass 2 up 3 semitones', WITH_BASS)
  check('"take the bass 2 up 3 semitones" moves 3, not 2',
    r.calls[0]?.input?.semitones === 3, JSON.stringify(r.calls[0]?.input))
}
{
  const r = read('move the bass 2 back one bar', WITH_BASS)
  check('"move the bass 2 back one bar" moves one bar, not two',
    JSON.stringify(r.calls[0]?.input?.by) === '{"bars":1}', JSON.stringify(r.calls[0]?.input))
}
{
  const r = read('fade the bass 2 in over 4 bars', WITH_BASS)
  check('"fade the bass 2 in over 4 bars" fades over 4, not 2',
    JSON.stringify(r.calls[0]?.input?.length) === '{"bars":4}', JSON.stringify(r.calls[0]?.input))
}
{
  // And a number that appears twice is not over-consumed.
  const r = read('set the bass 2 to 2 percent', WITH_BASS)
  check('a repeated number still leaves one for the argument',
    r.calls[0]?.input?.volume === 2 && r.calls[0]?.input?.target === 'Bass 2',
    JSON.stringify(r.calls[0]?.input))
}

// ── The studio commands, and the one that destroys work ───────────────────
{
  const r = read('delete the pad track', WITH_BASS)
  check('deleting a track is marked destructive',
    r.matched === 'remove_track' && r.destructive === true,
    `${r.matched}, destructive=${r.destructive}`)
  check('and nothing else is',
    read('mute the pad', WITH_BASS).destructive !== true)
}
{
  // "delete" and "duplicate" differ by a lot, but both name a track, and
  // getting them the wrong way round is the difference between a copy and a
  // loss.
  const r = read('duplicate the pad track', WITH_BASS)
  check('duplicating a track is not deleting one',
    r.matched === 'duplicate_track' && r.destructive !== true, r.matched)
}
{
  const r = read('rename the pad to strings', WITH_BASS)
  check('"rename the pad to strings" reads both halves',
    r.calls[0]?.input?.target === 'Pad' && r.calls[0]?.input?.name === 'Strings',
    JSON.stringify(r.calls[0]?.input))
}
{
  const r = read('put reverb on the drums', WITH_BASS)
  check('"put reverb on the drums" adds an effect',
    r.matched === 'add_effect' && r.calls[0]?.input?.effect === 'reverb'
    && r.calls[0]?.input?.target === 'Drums',
    JSON.stringify(r.calls[0]?.input))
}
{
  // The sentence has a number, a percent and a track name, so the plain volume
  // rule reads it perfectly and answers a different question. Naming an effect
  // is what settles it.
  const r = read('reverb on the drums 40 percent', WITH_BASS)
  check('naming an effect beats a plain volume reading',
    r.matched === 'set_effect' && r.calls[0]?.input?.amount === 40,
    `${r.matched} → ${JSON.stringify(r.calls[0]?.input)}`)
}
{
  const r = read('turn everything down', WITH_BASS)
  check('"turn everything down" is the master, not a track',
    r.matched === 'set_master_volume', r.matched)
}
{
  const r = read('mark bar 17 as the drop', WITH_BASS)
  check('"mark bar 17 as the drop" names a place',
    r.calls[0]?.input?.name === 'Drop' && r.calls[0]?.input?.at?.bar === 17,
    JSON.stringify(r.calls[0]?.input))
}

// ── A sentence that names nothing means the track in front of you ─────────
//
// The largest gap in the language. Nobody working on one track keeps saying its
// name — they say "louder", "mute this", "pan it left" — and every one of those
// resolved to nothing, because every rule demanded a name and the sentence
// offered a pronoun.
{
  const withSel = { ...WITH_BASS, selectedTrackName: 'Pad' }
  for (const [phrase, expect] of [
    ['mute this', { target: 'Pad', muted: true }],
    ['solo it', { target: 'Pad', solo: true }],
    ['louder', null],
    ['pan it left', null],
  ]) {
    const r = read(phrase, withSel)
    const ok = expect
      ? JSON.stringify(r.calls[0]?.input) === JSON.stringify(expect)
      : r.calls[0]?.input?.target === 'Pad'
    check(`"${phrase}" means the selected track`, ok,
      `${r.matched} → ${JSON.stringify(r.calls[0]?.input)}`)
  }
}
{
  // ...but only when the sentence names nothing. A named track always wins,
  // whatever is selected.
  const r = read('mute the drums', { ...WITH_BASS, selectedTrackName: 'Pad' })
  check('a named track beats the selection',
    r.calls[0]?.input?.target === 'Drums', JSON.stringify(r.calls[0]?.input))
}
{
  // And a name it could not find is NOT quietly turned into the selection —
  // that would act on the wrong track while appearing to understand.
  const r = read('mute the trombone', { ...WITH_BASS, selectedTrackName: 'Pad' })
  check('an unfound name does not fall back to the selection',
    r.calls.length === 0, `${r.matched} → ${JSON.stringify(r.calls[0]?.input)}`)
}
{
  // With nothing selected there is nothing to fall back to.
  const r = read('mute this', WITH_BASS)
  check('and with no selection it declines', r.calls.length === 0, r.matched)
}

// ── The commands that act on everything ───────────────────────────────────
{
  const r = read('mute everything', WITH_BASS)
  check('"mute everything" is not a track called everything',
    r.matched === 'set_all_tracks.mute' && r.calls[0]?.input?.muted === true,
    `${r.matched} → ${JSON.stringify(r.calls[0]?.input)}`)
}
{
  const r = read('clear the solo', WITH_BASS)
  check('"clear the solo" clears every solo',
    r.matched === 'set_all_tracks.solo_off', r.matched)
}
{
  // The key of half of popular music, whose note name is the indefinite
  // article and therefore gets deleted as filler by everything else here.
  const r = read('put it in a minor', WITH_BASS)
  check('"a minor" is a key, not an article',
    r.calls[0]?.input?.key === 9 && r.calls[0]?.input?.scale === 'minor',
    JSON.stringify(r.calls[0]?.input))
  const sharp = read('set the key to f sharp major', WITH_BASS)
  check('and "f sharp major" is read as one thing',
    sharp.calls[0]?.input?.key === 6 && sharp.calls[0]?.input?.scale === 'major',
    JSON.stringify(sharp.calls[0]?.input))
}

// ── Ambiguity is noticed rather than decided by a hair ─────────────────────
{
  // Every example in the registry is meant to be unmistakable. If any of them
  // is a close call, the scoring is too flat to be trusted on real speech.
  let ambiguous = 0
  const close = []
  for (const command of VOICE_COMMANDS) {
    for (const phrase of command.say) {
      const r = read(phrase, WITH_BASS)
      if (r.alternatives.length) { ambiguous++; close.push(`${phrase} (${r.matched} vs ${r.alternatives[0].id})`) }
    }
  }
  check('no advertised command is a close call', ambiguous === 0, close.slice(0, 3).join('; '))
}

// ── The same sentence twice is the same answer ─────────────────────────────
//
// The reading accounting is mutable state, and mutable state shared between
// attempts is exactly how a parser starts depending on what it was asked
// previously. Cheap to check, miserable to debug.
{
  const once = read('turn the bass up a bit', WITH_BASS)
  const twice = read('turn the bass up a bit', WITH_BASS)
  check('reading is deterministic',
    JSON.stringify(once.calls) === JSON.stringify(twice.calls)
    && once.matched === twice.matched)

  const all1 = VOICE_COMMANDS.flatMap(c => c.say).map(p => read(p, WITH_BASS).matched)
  const all2 = VOICE_COMMANDS.flatMap(c => c.say).map(p => read(p, WITH_BASS).matched)
  check('and no reading leaks into the next', JSON.stringify(all1) === JSON.stringify(all2))
}

// ── An unrelated track does not change an unrelated command ───────────────
{
  const before = read('set the tempo to 128', WITH_BASS)
  const after = read('set the tempo to 128', tracks('Bass 2', 'Pad', 'Drums', 'Tempo', 'Loop'))
  check('adding tracks does not disturb a command that names none',
    JSON.stringify(before.calls) === JSON.stringify(after.calls),
    `${JSON.stringify(before.calls[0]?.input)} vs ${JSON.stringify(after.calls[0]?.input)}`)
}

// ── An empty project declines rather than crashing ────────────────────────
{
  const empty = { tracks: [], tempo: 120 }
  let threw = null
  try {
    for (const command of VOICE_COMMANDS) for (const p of command.say) read(p, empty)
  } catch (e) { threw = e }
  check('every phrasing survives a project with no tracks', threw === null, String(threw ?? ''))
  check('and a command that needs a track declines there',
    read('mute the drums', empty).calls.length === 0)
}

// ── Nonsense is still declined ────────────────────────────────────────────
for (const s of ['what time is it', 'make it sound better', 'thanks that was great', '']) {
  const r = read(s, WITH_BASS)
  check(`declines: "${s || '(silence)'}"`, r.calls.length === 0, r.matched)
}

console.log(failures
  ? `\n${failures} failing — a correction can still win without being checked`
  : '\nno word is corrected into another without the project getting a say')
assert.equal(failures, 0)
