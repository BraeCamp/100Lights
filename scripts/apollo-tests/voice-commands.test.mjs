#!/usr/bin/env node
// Does every command the studio advertises actually work?
//
//   node --experimental-strip-types scripts/apollo-tests/voice-commands.test.mjs
//
// Brae: "set up as much of the voice controls as possible as though it's a
// complete system."
//
// A voice system fails in a particular way: quietly. A rule that stops matching
// does not throw — the sentence simply falls through to the paid assistant,
// which looks from the outside like the system working. So "complete" has to
// mean something checkable, and this is the check.
//
// It drives every example phrasing in the registry all the way to the actions
// it would perform, and asserts three things at each stage:
//
//   IT RESOLVES, AND TO ITSELF. Every phrase in a command's `say` list must
//   come back as that command. Not merely "something matched" — the RIGHT
//   command, because a phrase quietly captured by an earlier rule is how "play
//   the bass louder" became a transport command.
//
//   IT PLANS INTO REAL ACTIONS. The resolved call goes through the executor
//   against a real project. This is the stage that was missing, and it was
//   hiding a live bug: the mixer rules emitted `target: { name }` where the
//   executor reads a string, so String({name:'Pad'}) became "[object Object]",
//   no track was ever found, and every mute/solo/volume command silently went
//   to the assistant instead. The old tests compared the interpreter's output
//   against itself and passed throughout.
//
//   NOTHING IS ADVERTISED THAT CANNOT RUN. The help panel, the transcriber's
//   vocabulary and this suite all read the same registry, so a command cannot
//   be documented without being tested or tested without being documented.

import assert from 'node:assert'
import { importTs } from '../lib/ts-import.mjs'

const { VOICE_COMMANDS, COMMAND_VOCABULARY, commandHelp, COMMANDS_BY_ID } =
  await importTs('lib/voice/commands.ts')
const { COMMAND_SUMMARIES } = await importTs('lib/voice/command-summaries.ts')
const { interpret } = await importTs('lib/voice/interpret.ts')
const { planVoiceCall } = await importTs('lib/voice/execute-music.ts')
const { MUSIC_TOOL_NAMES } = await importTs('lib/voice/music-tools.ts')

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

// ── A project with something in it ──────────────────────────────────────────
//
// Named tracks WITH clips and notes, because half the commands resolve a clip
// rather than a track and an empty project cannot tell a working transpose from
// a broken one. The fixture being too thin is its own classic failure: a suite
// that passes against a project with no clips proves nothing about a studio
// with clips in it.
// Shapes taken from lib/daw-types, not from memory. `kind: 'midi'` and
// `durationBeats` are what the reducer actually reads; a fixture using `type`
// and `duration` still plans actions here — the executor is pure and never
// looks — while the real studio silently ignores every one of them.
// Slightly OFF the grid, and deliberately: notes sitting exactly on integer
// beats are already quantized, so a fixture built from them cannot tell a
// working quantize from one that does nothing at all.
const notes = (n, pitch) => Array.from({ length: n }, (_, i) => ({
  id: `n${pitch}-${i}`, pitch, startBeat: i + (i % 2 ? 0.07 : -0.05),
  durationBeats: 1, velocity: 100,
}))

const track = (id, name, volume = 0.8, extra = {}) => ({
  id, name, type: 'midi', color: '#888', volume, pan: 0,
  mute: false, solo: false, armed: false, height: 80,
  effects: [], instrument: { type: 'poly', params: {} }, ...extra,
})

// Twenty-four beats — six bars — because the studio can now split a clip at a
// bar and resize it, and neither is testable against a clip that ends before
// the bar being named.
const clip = (id, trackId, name, startBeat, pitch) => ({
  kind: 'midi', id, trackId, name, startBeat, durationBeats: 24,
  isDrumClip: false, notes: notes(8, pitch),
})

const PROJECT = {
  id: 'p', name: 'Fixture', tempo: 120, timeSignatureNum: 4, timeSignatureDen: 4,
  // One soloed and one muted, because a fixture where nothing is soloed cannot
  // tell a working "clear the solo" from a broken one — it correctly does
  // nothing either way, and the suite would bless the broken version.
  tracks: [track('t1', 'Bass 2'), track('t2', 'Pad', 0.5), track('t3', 'Drums'),
    track('t4', 'Guitar', 0.8, { mute: true }), track('t5', 'Vocals'),
    track('t6', 'Lead', 0.8, { solo: true }), track('t7', 'Keys')].map(t =>
    // Effects on SOME tracks, not all. Both cases have to exist in one project:
    // "take the reverb off the drums" needs a reverb to take off, and "put
    // reverb on the vocals" needs a track that has not got one — a fixture
    // where every track has everything fails the second half as surely as an
    // empty one fails the first.
    // MIDI effects on the two tracks the examples take them OFF, for the same
    // reason the audio effects are only on some: both halves have to be
    // testable in one project.
    (['Bass 2'].includes(t.name)
      ? { ...t, midiEffects: [{ id: `${t.id}-arp`, type: 'arp', params: { enabled: true, style: 'up', rate: 0.25, octaves: 1, gate: 0.9 } }] }
      : t)).map(t =>
    (['Drums', 'Pad'].includes(t.name)
      ? {
        ...t,
        effects: [
          { id: `${t.id}-rv`, type: 'reverb', params: { enabled: true, wet: 0.25, decay: 2, preDelay: 0.02 } },
          { id: `${t.id}-dl`, type: 'delay', params: { enabled: true, wet: 0.2, time: 0.375, feedback: 0.4, syncToTempo: true, syncBeats: 0.5 } },
        ],
      }
      : t)),
  arrangementClips: [
    clip('c1', 't1', 'Bass 2 clip', 0, 40),
    clip('c2', 't2', 'Pad clip', 0, 60),
    clip('c3', 't3', 'Drums clip', 0, 36),
    clip('c4', 't4', 'Guitar clip', 4, 52),
    clip('c5', 't5', 'Vocals clip', 4, 64),
    clip('c6', 't6', 'Lead clip', 8, 72),
    // ⚠️ On its OWN track. Putting it on the Pad gave that track two clips,
    // which made "the pad" ambiguous and broke transpose and duplicate_clip —
    // a fixture addition that quietly changed what other examples mean.
    {
      kind: 'midi', id: 'c7', trackId: 't7', name: 'Chord stack', startBeat: 0, durationBeats: 8,
      isDrumClip: false,
      notes: [60, 64, 67].map((pitch, n) => ({
        id: `ch-${n}`, pitch, startBeat: 0, durationBeats: 2, velocity: 100,
      })),
    },
  ],
  scenes: [], sessionGrid: {}, loopStart: 0, loopEnd: 16, loopEnabled: false,
  masterVolume: 1, automationLanes: [], clipEffects: [], returnTracks: [],
  takeLanes: [], crossfaderValue: 0.5, waveformZoom: 1, swing: 0,
  // Markers, so removing one is testable.
  // Added for the commands that need them, and ADDED rather than changed: a
  // chord in an existing clip would move every note count in this file.
  returnTracks: [{ id: 'r1', name: 'Reverb', color: '#888', volume: 0.8, pan: 0, mute: false, effects: [] }],
  cueMarkers: [
    { id: 'm1', beat: 32, name: 'Chorus' },
    { id: 'm2', beat: 64, name: 'Drop' },
  ],
}

const CTX = {
  tracks: PROJECT.tracks,
  tempo: PROJECT.tempo,
  clips: PROJECT.arrangementClips.map(c => ({ id: c.id, name: c.name, trackId: c.trackId })),
  // The sound library. It is not part of the song — it lives on the machine —
  // so the rules resolve a name against it and hand the executor an id.
  library: [
    { id: 'p-violin', name: 'Violin', group: 'Strings' },
    { id: 'p-piano', name: 'Piano', group: 'Piano' },
    { id: 'p-cello', name: 'Cello', group: 'Strings' },
  ],
}

console.log(`${VOICE_COMMANDS.length} commands, ${VOICE_COMMANDS.reduce((n, c) => n + c.say.length, 0)} example phrasings\n`)

// ── Every example resolves to the command that claims it ───────────────────
let resolved = 0
let planned = 0
for (const command of VOICE_COMMANDS) {
  for (const phrase of command.say) {
    const got = interpret(phrase, CTX)
    if (got.matched !== command.id) {
      check(`${command.id} — "${phrase}"`, false,
        `resolved as ${got.matched}`)
      continue
    }
    resolved++

    // A UI-handled command deliberately does not reach the executor — undo
    // needs the editor's history stack, which is not in the project. The
    // exception is declared on the command, so it is checked rather than
    // assumed: anything else that fails to plan still fails here.
    if (command.handledBy === 'ui') { planned++; continue }

    // And the call it produced is one the executor can actually carry out.
    // `problem` is the executor's way of saying "I understood the shape but
    // could not act on it", which is precisely the failure that was invisible.
    //
    // "Carry out" means actions OR an answer. A question — "what's the tempo" —
    // changes nothing and replies in words, and that is a complete and
    // successful command, not an empty plan. Requiring actions of everything
    // would make the suite reject the one command family that cannot have any.
    const plan = planVoiceCall(got.calls[0], PROJECT)
    if (plan.problem || (!plan.actions.length && !plan.say)) {
      check(`${command.id} — "${phrase}" → does something`, false,
        plan.problem || 'neither actions nor an answer')
      continue
    }
    planned++
  }
}
check(`every example resolves to its own command`, resolved === VOICE_COMMANDS.reduce((n, c) => n + c.say.length, 0),
  `${resolved} of ${VOICE_COMMANDS.reduce((n, c) => n + c.say.length, 0)}`)
check(`every example plans into an action or an answer`, planned === resolved, `${planned} of ${resolved}`)

// ── The registry is internally sound ───────────────────────────────────────
const ids = VOICE_COMMANDS.map(c => c.id)
check('every command id is unique', new Set(ids).size === ids.length)
check('every command has at least one example', VOICE_COMMANDS.every(c => c.say.length > 0))
check('every command says what it does', VOICE_COMMANDS.every(c => c.what.length > 3))
check('every command names a real tool',
  VOICE_COMMANDS.every(c => MUSIC_TOOL_NAMES.includes(c.tool)),
  VOICE_COMMANDS.filter(c => !MUSIC_TOOL_NAMES.includes(c.tool)).map(c => c.tool).join(',') || 'all valid')

// The loophole above is only a loophole if nothing checks it. A question must
// answer AND change nothing; anything that is not a question must do something.
{
  let wrong = []
  for (const command of VOICE_COMMANDS) {
    if (command.handledBy === 'ui') continue
    const got = interpret(command.say[0], CTX)
    if (got.matched !== command.id) continue
    const plan = planVoiceCall(got.calls[0], PROJECT)
    const isQuestion = command.group === 'Questions'
    if (isQuestion && plan.actions.length) wrong.push(`${command.id} changed something`)
    if (!isQuestion && !plan.actions.length) wrong.push(`${command.id} changed nothing`)
  }
  check('questions answer without changing anything, and commands change something',
    wrong.length === 0, wrong.join('; '))
}

// Only the declared exceptions skip the executor.
check('every command that skips the executor says so',
  VOICE_COMMANDS.filter(c => c.handledBy === 'ui').every(c => ['undo', 'redo'].includes(c.tool)),
  VOICE_COMMANDS.filter(c => c.handledBy === 'ui').map(c => c.id).join(',') || 'none')

// ── Coverage: what can the studio be told to do, and what can it not? ──────
//
// The point of the registry is that this question has an answer. A tool with no
// spoken route to it is a function of the studio that voice cannot reach — that
// is allowed, but it should be a decision somebody made, not a thing nobody
// noticed.
const covered = new Set(VOICE_COMMANDS.map(c => c.tool))
const uncovered = MUSIC_TOOL_NAMES.filter(t => !covered.has(t))
console.log(`\ncoverage: ${covered.size}/${MUSIC_TOOL_NAMES.length} tools reachable by voice`)
if (uncovered.length) console.log(`  not yet spoken: ${uncovered.join(', ')}`)
check('every tool in the contract can be reached by voice', uncovered.length === 0,
  uncovered.join(',') || 'all reachable')

// ── What is derived from the registry stays in step with it ───────────────
check('the transcriber is primed with the command words', COMMAND_VOCABULARY.length > 30,
  `${COMMAND_VOCABULARY.length} terms`)
check('the vocabulary includes words a recogniser would otherwise miss',
  ['unsolo', 'semitones', 'tempo', 'transpose'].every(t => COMMAND_VOCABULARY.includes(t)),
  COMMAND_VOCABULARY.filter(t => ['unsolo', 'semitones', 'tempo', 'transpose'].includes(t)).join(','))
const help = commandHelp()
const helpCount = help.reduce((n, g) => n + g.items.length, 0)
check('the help panel lists every command', helpCount === VOICE_COMMANDS.length,
  `${helpCount} of ${VOICE_COMMANDS.length}`)

// ── The library people read ────────────────────────────────────────────────
//
// Brae: "create a library of functions that can be done through Light... When
// the user hovers over one, it shows a summary of that function."
//
// ⚠️ The summaries live in their own file, keyed by command id, so they can
// silently come unstuck from the commands they describe — a renamed command
// keeps working and quietly loses its explanation, and nothing anywhere would
// notice. This is the check that notices.
{
  const help = commandHelp()
  const listed = help.flatMap(g => g.items)
  check('the library lists every command', listed.length === VOICE_COMMANDS.length,
    `${listed.length} of ${VOICE_COMMANDS.length}`)

  const missing = listed.filter(i => i.summary === i.what).map(i => i.id)
  check('and every one has a written summary', missing.length === 0,
    missing.length ? `no summary for ${missing.join(', ')}` : '')

  const stale = Object.keys(COMMAND_SUMMARIES).filter(id => !COMMANDS_BY_ID[id])
  check('with no summary left behind by a rename', stale.length === 0, stale.join(', '))

  check('each carries its phrasings for search',
    listed.every(i => i.phrasings.length > 0 && i.phrasings.includes(i.say)))
  // A summary that just repeats the one-liner teaches nothing on hover.
  const thin = listed.filter(i => i.summary.length < i.what.length + 20).map(i => i.id)
  check('and the summaries say more than the titles do', thin.length === 0, thin.join(', '))
}

console.log(failures
  ? `\n${failures} failing`
  : `\nevery advertised command resolves, plans, and acts`)
assert.equal(failures, 0)
