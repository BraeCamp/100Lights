#!/usr/bin/env node
// The transcript, the card beside it, and the record corrected.
//
//   node --experimental-strip-types scripts/apollo-tests/voice-transcript.test.mjs
//
// Brae: "Let's create a voice control transcript / log. It would say what the
// user said, what Light responded with, and what Light did. When this or any
// other of the buttons in the voice control window are selected, they will
// open in a bar next to voice control so that voice control stays on screen.
// Add a minimize button to the voice control card and make that make the
// button close the window. The x button will turn off voice controls as if
// the voice control button was pressed to toggle off. In the voice control
// window we will also separate the visuals for the user speaking and light
// responding."
//
// And: "Check the voice control attempts and see what went wrong. Correct
// based on commands and responses." — the local record, read back, and each
// wrong turn in it given a rule or a planner branch.

import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { importTs } from '../lib/ts-import.mjs'

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

// ── The transcript: said / replied / did ───────────────────────────────────
{
  const { describeAction } = await importTs('lib/voice/transcript.ts')
  const names = { track: id => (id === 't1' ? 'Pad' : 'the track'), clip: id => (id === 'c1' ? '"Pad intro"' : 'the clip'), beatsPerBar: 4 }
  check('a transport locate says where it went',
    describeAction({ type: 'TRANSPORT', action: 'locate', beat: 16 }, names) === 'Moved the playhead to bar 5')
  check('a volume change names the track and the level',
    describeAction({ type: 'UPDATE_TRACK', trackId: 't1', patch: { volume: 0.75 } }, names) === 'Pad: volume 75%')
  check('a mute says so', /muted/.test(describeAction({ type: 'UPDATE_TRACK', trackId: 't1', patch: { mute: true } }, names)))
  check('an added effect names the effect and the track',
    describeAction({ type: 'ADD_EFFECT', trackId: 't1', effect: { type: 'reverb' } }, names) === 'Added reverb to Pad')
  check('an automation point says where and how much',
    describeAction({ type: 'ADD_AUTOMATION_POINT', laneId: 'l', point: { beat: 24, value: 0.2 } }, names) === 'Set an automation point at bar 7 (20%)')
  check('an added clip says what, where, on which track',
    describeAction({ type: 'ADD_CLIP', clip: { name: 'Trap', startBeat: 0, isDrumClip: true, trackId: 't1' } }, names) === 'Added a beat "Trap" at bar 1 on Pad')
  // ⚠️ Unknown actions still get words — a blank reads as "did nothing".
  check('an action it has never heard of is still described',
    describeAction({ type: 'SOMETHING_NEW' }, names) === 'Something new')

  // The store, headless: no localStorage here, so it must not throw.
  const { recordExchange, transcript, clearTranscript } = await importTs('lib/voice/transcript.ts')
  clearTranscript()
  recordExchange({ said: 'mute the drums', source: 'spoken', reply: 'Drums muted.', problem: false, path: 'rules', did: ['Drums: muted', ''] })
  const rows = transcript()
  check('an exchange is kept with all three columns',
    rows.length === 1 && rows[0].said === 'mute the drums' && rows[0].reply === 'Drums muted.' && rows[0].did.length === 1, JSON.stringify(rows))
  clearTranscript()
  check('and can be cleared', transcript().length === 0)
}

// ── The card: side bar, minimize, off, two voices ──────────────────────────
{
  const panel = readFileSync('components/editor/daw/VoicePanel.tsx', 'utf8')
  const control = readFileSync('components/editor/daw/VoiceControl.tsx', 'utf8')
  check('the panel has a side bar with every button in it',
    /export type VoiceSide = 'none' \| 'settings' \| 'usage' \| 'macros' \| 'transcript' \| 'help'/.test(panel))
  check('and the bar renders beside the card, not instead of it',
    /data-voice-side=\{side\}/.test(panel) && /order: -1/.test(panel) && /data-voice-panel style=\{card\}/.test(panel))
  check('the transcript, the command list and the settings are side buttons',
    /data-voice-side-button=\{b\.key\}/.test(panel) && /key: 'transcript'/.test(panel) && /key: 'help'/.test(panel) && /key: 'settings'/.test(panel))
  check('the library opens embedded in the bar', /<VoiceLibrary\s+embedded/.test(panel))
  check('there is a minimize button', /data-voice-minimize/.test(panel))
  check('and the ✕ is labelled as turning voice off', /aria-label="Turn voice control off"/.test(panel))
  check('minimize only hides the card', /onMinimize=\{\(\) => setPanelOpen\(false\)\}/.test(control))
  check('✕ stops listening, the way the voice button does', /onClose=\{\(\) => \{ if \(listening\) finish\(\); setPanelOpen\(false\); setSide\('none'\) \}\}/.test(control))
  check('you and Light are two labelled rows', /data-voice-you/.test(panel) && /data-voice-light/.test(panel))
  check('the read-back keeps its hook', /data-voice-readback/.test(panel))
  check('every exchange is written to the transcript, with what it did',
    /recordExchange\(\{\s*\n\s*said: e\.said/.test(control) && /did: didRef\.current\.splice\(0\)/.test(control))
  check('and every action run is described into it', /didRef\.current\.push\(describeAction\(a,/.test(control))
  check('the voice can open its own bars by name', /v\.view === 'help' \|\| v\.view === 'transcript'/.test(control))
}

// ── The record, corrected ──────────────────────────────────────────────────
{
  const { interpret } = await importTs('lib/voice/interpret.ts')
  const { planVoiceCall } = await importTs('lib/voice/execute-music.ts')
  const ctx = { tracks: [{ id: 't1', name: 'Pad', volume: 0.8 }, { id: 't2', name: 'Stab', volume: 0.8 }], tempo: 120, clips: [{ id: 'c1', name: 'Pad intro', trackId: 't1' }] }
  const first = s => interpret(s, ctx).calls[0]

  // 16:40 — "Start a low pass on bar 5. Keep it at" → moved the playhead to bar 5.
  const lp = first('Start a low pass on bar 5. Keep it at')
  check('"start a low pass on bar 5" is not a locate', !lp || lp.name !== 'transport', JSON.stringify(lp))
  check('"go to bar 9" still is', first('go to bar 9')?.name === 'transport')

  // 20:20 — "Show me the automation lanes of Stab Effect" → the effects rack.
  const al = first('Show me the automation lanes of Stab Effect.')
  check('"show me the automation lanes of Stab" opens the automation, not the rack',
    al?.name === 'show_view' && al.input.view === 'automation', JSON.stringify(al))
  check('"open the Stab effects" still opens the rack', first('Open the Stab Effects.')?.input.view === 'devices')

  // 17:52 — "Open the list of commands that I can" → a spoken summary.
  const help = first('Open the list of commands that I can')
  check('"open the list of commands" opens the list', help?.name === 'show_view' && help.input.view === 'help', JSON.stringify(help))
  check('so does "what can I say"', first('what can I say')?.input.view === 'help')
  const tr = first('show me the transcript')
  check('"show me the transcript" opens the transcript', tr?.name === 'show_view' && tr.input.view === 'transcript', JSON.stringify(tr))
  check('so does "what did you do"', first('what did you do')?.input.view === 'transcript')
  check('but "what did you do to the pad" is not the log', first('what did you do to the pad')?.input?.view !== 'transcript')

  // 17:55 — "Where is the playhead right now?" → the loop.
  const pos = first('Where is the playhead right now?')
  check('"where is the playhead" is a position question', pos?.name === 'describe' && pos.input.topic === 'position', JSON.stringify(pos))
  const project = { id: 'p', tempo: 120, timeSignatureNum: 4, timeSignatureDen: 4, tracks: ctx.tracks, arrangementClips: [], loopStart: 0, loopEnd: 280, loopEnabled: false }
  const answer = planVoiceCall({ name: 'describe', input: { topic: 'position' } }, project, { atBeat: 41 })
  check('and it answers with the playhead, not the loop', /playhead is at bar 11/.test(answer.say ?? ''), answer.say)

  // 05:24 — "…goes to 50% instead of 20" → "Say what it should sweep from and to."
  const withLane = {
    ...project,
    tracks: [{ id: 't1', name: 'Pad', volume: 0.8, effects: [{ id: 'f1', type: 'filter', params: { enabled: true, type: 'lowpass', frequency: 18000, q: 1 } }] }],
    arrangementClips: [{ id: 'c1', kind: 'midi', trackId: 't1', name: 'Pad intro', startBeat: 0, durationBeats: 32, notes: [], isDrumClip: false }],
    automationLanes: [{ id: 'lane', trackId: 't1', parameter: 'fx:f1:frequency', label: 'Low-pass cutoff', min: 200, max: 18000, curve: 'log', defaultValue: 1, expanded: true,
      points: [{ id: 'a', beat: 8, value: 1 }, { id: 'b', beat: 24, value: 0.2 }] }],
  }
  const edit = planVoiceCall({ name: 'automate_parameter', input: { target: 'Pad', parameter: 'lowpass', to: '50%', start: { bar: 3 }, end: { bar: 7 } } }, withLane)
  check('changing one end of an existing sweep reads the other end off the lane',
    !edit.problem && (edit.actions ?? []).some(a => a.type === 'ADD_AUTOMATION_POINT' && a.point.value === 1) && (edit.actions ?? []).some(a => a.type === 'ADD_AUTOMATION_POINT' && Math.abs(a.point.value - 0.5) < 1e-9),
    JSON.stringify(edit))
  const fresh = planVoiceCall({ name: 'automate_parameter', input: { target: 'Pad', parameter: 'reverb', to: '50%', start: { bar: 3 }, end: { bar: 7 } } }, withLane)
  check('with no lane to read from, a missing end is still a question', /sweep from and to/.test(fresh.problem ?? ''), JSON.stringify(fresh))

  // 18:09 — "recreate that on the 1st bar" → insert_clip put a single hit on the Pad track.
  const synthPad = { ...withLane, tracks: [{ id: 't1', name: 'Pad', volume: 0.8, instrument: { type: 'poly', params: {} } }] }
  const ins = planVoiceCall({ name: 'insert_clip', input: { sound: 'Pad', at: { bar: 1 }, length: { bars: 1 } } }, synthPad)
  check('a drum hit is refused on a synth track, with the way to say it', /synth track/.test(ins.problem ?? '') && /duplicate/.test(ins.problem ?? ''), JSON.stringify(ins))
  const crash = planVoiceCall({ name: 'insert_clip', input: { sound: 'crash', at: { bar: 1 } } }, synthPad)
  check('a crash on a new track is still fine', !crash.problem && (crash.actions ?? []).some(a => a.type === 'ADD_CLIP'), JSON.stringify(crash))
}

// ── Loading: clips say when they are not here yet, the studio says when it is ──
{
  const clip = readFileSync('components/editor/daw/ClipView.tsx', 'utf8')
  const editor = readFileSync('components/editor/AudioEditor.tsx', 'utf8')
  const engine = readFileSync('lib/daw-engine.ts', 'utf8')
  check('the engine says which clips can sound', /clipReady\(clip: DawClip\): boolean/.test(engine) && /readiness\(\): \{ ready: number; total: number; waiting: string\[\] \}/.test(engine))
  check('and announces every change', /new CustomEvent\('load-change'\)/.test(engine) && /onApolloReady\(\(\) => this\._loadChanged\(\)\)/.test(engine))
  check('a clip draws its loading state until then', /data-clip-loading/.test(clip) && /engine\.addEventListener\('load-change', check\)/.test(clip))
  check('the studio says "Ready to play" once the last piece lands', /data-ui-el="ready-to-play"/.test(editor) && /Ready to play/.test(editor) && /wasWaiting\.current = true/.test(editor))
}

// ── Transitions: things that appear also disappear ─────────────────────────
{
  const css = readFileSync('app/globals.css', 'utf8')
  const appear = readFileSync('components/ui/Appear.tsx', 'utf8')
  for (const k of ['appear-fade', 'appear-rise', 'appear-drop', 'appear-grow']) {
    check(`${k} has an exit as well as an entrance`, new RegExp(`\\.${k}\\s`).test(css) && new RegExp(`\\.${k}-out`).test(css))
  }
  check('and honours reduced motion', /\.appear-fade, \.appear-rise, \.appear-drop, \.appear-grow \{ animation: none; \}/.test(css))
  check('Appear keeps the element mounted for the exit', /useMountTransition\(show, exitMs\)/.test(appear))
  const editor = readFileSync('components/editor/AudioEditor.tsx', 'utf8')
  check('the editor toasts use it', (editor.match(/<Appear show=/g) ?? []).length >= 5)
  const transport = readFileSync('components/editor/daw/Transport.tsx', 'utf8')
  check('the transport popovers use it', (transport.match(/useAppear\(/g) ?? []).length >= 4)
  const arr = readFileSync('components/editor/daw/ArrangementView.tsx', 'utf8')
  check('the arrangement menus have an exit now', (arr.match(/useAppear\(/g) ?? []).length >= 4 && !/className="menu-pop" style=\{\{ position: 'absolute', top: '100%', right: 0, marginTop: 2, background: 'var\(--bg-card\)'/.test(arr))
}

console.log(failures ? `\n${failures} failing` : '\nsaid, replied, did')
assert.equal(failures, 0)
