#!/usr/bin/env node
// The four the audit called "needs work".
//
//   node --experimental-strip-types scripts/apollo-tests/voice-needswork.test.mjs
//
// Brae: "Let's do the ones that are labeled 'Needs work'... Remember that we
// are doing it primarily to make it work with AI mode."
//
// So the tests lean on the ASSISTANT'S path: planVoiceCall with the arguments a
// model would actually produce, including the sloppy ones — a groove named in
// words rather than by id, a division said as a number, a crossfade with no
// clips named at all.

import assert from 'node:assert'
import { importTs } from '../lib/ts-import.mjs'

const { planVoiceCall } = await importTs('lib/voice/execute-music.ts')
const { interpret } = await importTs('lib/voice/interpret.ts')
const { GROOVES, grooveNamed, applyGroove } = await importTs('lib/voice/grooves.ts')
const { MUSIC_TOOLS } = await importTs('lib/voice/music-tools.ts')

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const notes = [
  { id: 'n1', pitch: 36, startBeat: 0, durationBeats: 0.25, velocity: 100 },
  { id: 'n2', pitch: 42, startBeat: 0.25, durationBeats: 0.25, velocity: 100 },
  { id: 'n3', pitch: 38, startBeat: 1, durationBeats: 0.25, velocity: 100 },
  { id: 'n4', pitch: 42, startBeat: 1.75, durationBeats: 1, velocity: 100 },
]
const project = {
  tempo: 120, timeSignatureNum: 4, timeSignatureDen: 4,
  tracks: [
    { id: 'td', name: 'Drums', instrument: { type: 'drum', params: {} }, effects: [], volume: 0.8 },
    { id: 'tv', name: 'Vocals', instrument: { type: 'poly', params: {} }, effects: [], volume: 0.5 },
    { id: 'tg', name: 'Guitar', instrument: { type: 'poly', params: {} }, effects: [], volume: 0.9, mute: true },
  ],
  arrangementClips: [
    { id: 'cd', trackId: 'td', kind: 'midi', name: 'Beat', startBeat: 0, durationBeats: 4, notes },
    { id: 'cv1', trackId: 'tv', kind: 'audio', name: 'Take one', startBeat: 0, durationBeats: 8, fadeIn: 0, fadeOut: 0 },
    { id: 'cv2', trackId: 'tv', kind: 'audio', name: 'Take two', startBeat: 8, durationBeats: 8, fadeIn: 0, fadeOut: 0 },
  ],
}
const plan = (name, input, p = project) => planVoiceCall({ name, input }, p)
const types = pl => pl.actions.map(a => a.type)

// ── 1. Balance / level match ───────────────────────────────────────────────
//
// ⚠️ The planner deliberately does NOT do the measuring — that needs a render
// and an audio context. It hands the studio a job, the way a spoken take does.
{
  const all = plan('balance_levels', {})
  check('balancing hands over a job rather than moving faders',
    types(all).join() === 'BALANCE_LEVELS', types(all).join())
  // The muted guitar is not part of the balance: you cannot hear it, so it has
  // no business setting the target everything else is matched to.
  check('and only over the tracks you can hear',
    all.actions[0].trackIds.join() === 'td,tv', all.actions[0].trackIds.join())
  check('it warns that this one takes a moment', /few seconds/.test(all.say), all.say)

  const ref = plan('balance_levels', { reference: 'vocals' })
  check('a reference track is resolved to its id',
    ref.actions[0].referenceId === 'tv', String(ref.actions[0].referenceId))
  check('and named in the read-back', /Vocals/.test(ref.say), ref.say)

  check('an unknown reference refuses', !!plan('balance_levels', { reference: 'kazoo' }).problem)
  const targeted = plan('balance_levels', { targets: ['drums', 'vocals'] })
  check('an explicit list is honoured', targeted.actions[0].trackIds.join() === 'td,tv',
    targeted.actions[0].trackIds.join())
  check('and a bad name in the list refuses rather than silently dropping it',
    !!plan('balance_levels', { targets: ['drums', 'kazoo'] }).problem)
}

// ── 2. Groove ──────────────────────────────────────────────────────────────
{
  // The model will say the feel in words, not as an id.
  check('a feel is found from words', grooveNamed('a bit of swing')?.id === 'swing-light',
    String(grooveNamed('a bit of swing')?.id))
  check('shuffle is its own feel, not more swing', grooveNamed('shuffle')?.id === 'shuffle')
  check('and "back on the grid" is straight', grooveNamed('back on the grid')?.id === 'straight',
    String(grooveNamed('back on the grid')?.id))
  check('an unknown feel is null', grooveNamed('spicy') === null)

  const sh = plan('apply_groove', { target: 'drums', groove: 'shuffle' })
  check('a groove moves the notes', types(sh).every(t => t === 'UPDATE_MIDI_NOTE') && sh.actions.length === 4,
    types(sh).join())
  const moved = Object.fromEntries(sh.actions.map(a => [a.noteId, a.patch.startBeat]))
  // ⚠️ Keyed to position in the BAR, not to the order notes are stored in.
  // n1 is on the downbeat and must not move; n2 is the offbeat sixteenth and
  // must move a long way, because that is what a shuffle IS.
  check('the downbeat stays put', moved.n1 === 0, String(moved.n1))
  check('and the offbeat sixteenth is pushed to the triplet',
    Math.abs(moved.n2 - (0.25 + 0.25 * 0.667)) < 1e-6, String(moved.n2))
  check('it says what the feel does', /triplet/i.test(sh.say), sh.say)

  const half = plan('apply_groove', { target: 'drums', groove: 'shuffle', amount: 50 })
  const halfMoved = Object.fromEntries(half.actions.map(a => [a.noteId, a.patch.startBeat]))
  check('half strength is half the move',
    Math.abs((halfMoved.n2 - 0.25) - (moved.n2 - 0.25) / 2) < 1e-6, String(halfMoved.n2))

  // Straight puts everything back, which is the undo people say out loud.
  const straight = plan('apply_groove', { target: 'drums', groove: 'straight' })
  check('straight returns everything to the grid',
    straight.actions.every(a => Math.abs(a.patch.startBeat * 4 - Math.round(a.patch.startBeat * 4)) < 1e-9))

  // Accents are half of what makes a groove recognisable.
  const acc = plan('apply_groove', { target: 'drums', groove: 'hard accents' })
  const vels = acc.actions.map(a => a.patch.velocity)
  check('an accent template changes the dynamics', new Set(vels).size > 1, vels.join())

  check('an unknown groove refuses and lists some', /shuffle/.test(
    plan('apply_groove', { target: 'drums', groove: 'spicy' }).problem ?? ''))

  // ⚠️ A pushed groove on the downbeat would put the first note before the
  // start of the clip, where it simply never plays.
  const pushed = applyGroove([{ id: 'x', pitch: 60, startBeat: 0, durationBeats: 1, velocity: 100 }],
    GROOVES.find(g => g.id === 'pushed'))
  check('nothing is pushed before the start of the clip', pushed[0].startBeat >= 0,
    String(pushed[0].startBeat))
}

// ── 3. Crossfade ───────────────────────────────────────────────────────────
{
  const auto = plan('crossfade', {})
  check('with nothing named it finds the two that meet',
    types(auto).includes('UPDATE_CLIP'), types(auto).join())
  const fades = auto.actions.filter(a => a.type === 'UPDATE_CLIP')
  check('the first fades out and the second fades in',
    fades[0].patch.fadeOut > 0 && fades[1].patch.fadeIn > 0,
    JSON.stringify(fades.map(f => f.patch)))
  // ⚠️ The clips are adjacent, not overlapping — there is nothing to fade
  // ACROSS until one is pulled back to meet the other.
  const move = auto.actions.find(a => a.type === 'MOVE_CLIP')
  check('and the second is pulled back to make the overlap', !!move && move.clipId === 'cv2',
    JSON.stringify(move))
  check('by exactly the fade length', move.startBeat === 8 - fades[0].patch.fadeOut,
    `${move.startBeat} vs ${8 - fades[0].patch.fadeOut}`)

  const named = plan('crossfade', { first: 'take one', second: 'take two', length: { beats: 1 } })
  check('a named length is honoured',
    named.actions.find(a => a.type === 'UPDATE_CLIP').patch.fadeOut === 1,
    String(named.actions.find(a => a.type === 'UPDATE_CLIP').patch.fadeOut))
  check('one clip is not a crossfade',
    !!plan('crossfade', { first: 'take one', second: 'take one' }).problem)
}

// ── 4. Stutter ─────────────────────────────────────────────────────────────
{
  const st = plan('stutter', { target: 'drums' })
  const out = st.actions[0].patch.notes
  check('stuttering rewrites the clip once', types(st).join() === 'UPDATE_CLIP', types(st).join())
  // n4 is the last note, a beat long: at 16ths that is four repeats.
  check('the last note becomes four sixteenths', out.length === 3 + 4, String(out.length))
  const reps = out.slice(3)
  check('spaced a sixteenth apart',
    reps.map(n => +(n.startBeat - 1.75).toFixed(3)).join() === '0,0.25,0.5,0.75',
    reps.map(n => +(n.startBeat - 1.75).toFixed(3)).join())
  // ⚠️ Fading across the repeats is what makes it a roll rather than a stuck
  // note.
  check('and getting quieter across the run', reps[0].velocity > reps[3].velocity,
    reps.map(n => n.velocity).join())

  const fast = plan('stutter', { target: 'drums', division: 32 })
  check('32nds give twice as many', fast.actions[0].patch.notes.length === 3 + 8,
    String(fast.actions[0].patch.notes.length))

  const all = plan('stutter', { target: 'drums', scope: 'all' })
  check('every note can be stuttered instead', all.actions[0].patch.notes.length > out.length,
    String(all.actions[0].patch.notes.length))
  check('a division nobody uses refuses',
    !!plan('stutter', { target: 'drums', division: 7 }).problem)
}

// ── AI mode: the tools have to be findable and unambiguous ────────────────
{
  const byName = Object.fromEntries(MUSIC_TOOLS.map(t => [t.name, t]))
  for (const n of ['balance_levels', 'apply_groove', 'crossfade', 'stutter']) {
    check(`${n} is in the tool contract`, !!byName[n])
  }
  // ⚠️ The failure mode with a model is not that it cannot find a tool — it is
  // that it uses the wrong one confidently. Each description says when NOT to
  // reach for it.
  check('balance says when to use set_track instead', /set_track/.test(byName.balance_levels.description))
  check('groove says it is not set_swing', /set_swing/.test(byName.apply_groove.description))
  check('crossfade says it is not a track fade', /automate_parameter/.test(byName.crossfade.description))
  check('stutter says it will not invent notes', /does not invent/.test(byName.stutter.description))
}

// ── And the same sentences without the assistant ───────────────────────────
{
  const ctx = { tracks: project.tracks, tempo: 120, clips: project.arrangementClips.map(c => ({ id: c.id, name: c.name, trackId: c.trackId })) }
  const say = t => interpret(t, ctx).calls[0]
  check('"balance the mix"', say('balance the mix')?.name === 'balance_levels')
  check('"give the drums a shuffle"', say('give the drums a shuffle')?.input?.groove === 'shuffle')
  check('"crossfade the take one clip into the take two clip"',
    say('crossfade the take one clip into the take two clip')?.name === 'crossfade',
    String(say('crossfade the take one clip into the take two clip')?.name))
  check('"stutter the end of the drums"', say('stutter the end of the drums')?.name === 'stutter')
  // ⚠️ "swing the drums" is a groove on a part; "swing 30 percent" is the
  // song's swing number. Both answer to the same word.
  check('a named part gets the groove', say('swing the drums')?.name === 'apply_groove',
    String(say('swing the drums')?.name))
  check('and a percentage gets the song swing', say('swing 30 percent')?.name === 'set_swing',
    String(say('swing 30 percent')?.name))
}

console.log(failures ? `\n${failures} failing` : '\nthe four that needed work, work')
assert.equal(failures, 0)
