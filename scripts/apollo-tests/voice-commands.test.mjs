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

const { VOICE_COMMANDS, COMMAND_VOCABULARY, commandHelp } = await importTs('lib/voice/commands.ts')
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
const notes = (n, pitch) => Array.from({ length: n }, (_, i) => ({
  id: `n${pitch}-${i}`, pitch, startBeat: i, durationBeats: 1, velocity: 100,
}))

const track = (id, name, volume = 0.8) => ({
  id, name, type: 'midi', color: '#888', volume, pan: 0,
  mute: false, solo: false, armed: false, height: 80,
  effects: [], instrument: { type: 'poly', params: {} },
})

const clip = (id, trackId, name, startBeat, pitch) => ({
  kind: 'midi', id, trackId, name, startBeat, durationBeats: 4,
  isDrumClip: false, notes: notes(4, pitch),
})

const PROJECT = {
  id: 'p', name: 'Fixture', tempo: 120, timeSignatureNum: 4, timeSignatureDen: 4,
  tracks: [track('t1', 'Bass 2'), track('t2', 'Pad', 0.5), track('t3', 'Drums'),
    track('t4', 'Guitar'), track('t5', 'Vocals'), track('t6', 'Lead')],
  arrangementClips: [
    clip('c1', 't1', 'Bass 2 clip', 0, 40),
    clip('c2', 't2', 'Pad clip', 0, 60),
    clip('c3', 't3', 'Drums clip', 0, 36),
    clip('c4', 't4', 'Guitar clip', 4, 52),
    clip('c5', 't5', 'Vocals clip', 4, 64),
    clip('c6', 't6', 'Lead clip', 8, 72),
  ],
  scenes: [], sessionGrid: {}, loopStart: 0, loopEnd: 16, loopEnabled: false,
  masterVolume: 1, automationLanes: [], clipEffects: [], returnTracks: [],
  takeLanes: [], crossfaderValue: 0.5, waveformZoom: 1, swing: 0, cueMarkers: [],
}

const CTX = { tracks: PROJECT.tracks, tempo: PROJECT.tempo }

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

console.log(failures
  ? `\n${failures} failing`
  : `\nevery advertised command resolves, plans, and acts`)
assert.equal(failures, 0)
