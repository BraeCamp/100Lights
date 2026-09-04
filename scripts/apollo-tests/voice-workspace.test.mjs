#!/usr/bin/env node
// The workspace, by voice: view, zoom, scroll, snap, overlay, the Sound panel,
// a track brought into view, and the editor's own palette by name.
//
//   node --experimental-strip-types scripts/apollo-tests/voice-workspace.test.mjs
//
// Brae: "look at more navigation options that could be wired into voice
// control."

import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { importTs } from '../lib/ts-import.mjs'

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const { interpret } = await importTs('lib/voice/interpret.ts')
const { planVoiceCall } = await importTs('lib/voice/execute-music.ts')
const { viewOf, snapOf, overlayOf, matchCommand } = await importTs('lib/voice/workspace.ts')

const commands = [
  { id: 'audio.view.sidebar', label: 'Hide the sidebar', keywords: 'collapse panel wider room space', group: 'View' },
  { id: 'audio.library', label: 'Open Sound Library', keywords: 'instruments sounds browser', group: 'Audio' },
  { id: 'audio.transport.end', label: 'Go to the end of the song', keywords: 'last final', group: 'Transport' },
  { id: 'audio.project.marker', label: 'Drop a marker at the playhead', keywords: 'cue section name', group: 'Project' },
  { id: 'audio.import', label: 'Import an audio file', keywords: 'load wav mp3 upload', group: 'Audio' },
  { id: 'audio.view.pads', label: 'Show the pads', keywords: 'drums beat step sequencer trigger play', group: 'View' },
  { id: 'audio.project.section', label: 'Start a new section here', keywords: 'verse chorus bridge intro arrangement structure', group: 'Project' },
]
const project = {
  id: 'p', tempo: 120, timeSignatureNum: 4, timeSignatureDen: 4,
  tracks: [
    { id: 't1', name: 'Pad', volume: 0.8, effects: [] },
    { id: 't2', name: 'Drums', volume: 0.8, effects: [] },
  ],
  arrangementClips: [
    { id: 'c1', kind: 'midi', trackId: 't1', name: 'Pad intro', startBeat: 0, durationBeats: 16, isDrumClip: false, notes: [{ id: 'n1', pitch: 60, startBeat: 0, durationBeats: 4, velocity: 100 }] },
  ],
  cueMarkers: [{ id: 'm1', beat: 32, name: 'Chorus' }],
  automationLanes: [],
}
const ctx = {
  tracks: project.tracks.map(t => ({ id: t.id, name: t.name, volume: t.volume })),
  tempo: 120,
  clips: project.arrangementClips.map(c => ({ id: c.id, name: c.name, trackId: c.trackId, kind: c.kind })),
  markers: [{ name: 'Chorus', beat: 32 }],
  commands,
}
const first = s => interpret(s, ctx).calls[0]
const plan = (input) => planVoiceCall({ name: 'workspace', input }, project)
const act = p => (p.actions ?? []).find(a => a.type === 'WORKSPACE')

// ── The words ───────────────────────────────────────────────────────────────
{
  check('"the mixer" is the mixer', viewOf('show the mixer') === 'mixer')
  check('"the arrangement view"', viewOf('back to the arrangement view') === 'arrangement')
  check('"the mix is muddy" is no view', viewOf('the mix is muddy') === null)
  check('"bars" snaps to bars', snapOf('to bars') === 'bar')
  check('"eighths" snaps to 1/8', snapOf('to eighths') === '1/8')
  check('"off"', snapOf('off') === 'off')
  check('"not loaded" is the loading overlay', overlayOf("what's not loaded") === 'loading')
  check('"out of key"', overlayOf('out of key') === 'key')
  check('"clear" is off', overlayOf('clear') === 'none')
  const hit = matchCommand(commands, 'hide the sidebar')
  check('"hide the sidebar" finds Hide the sidebar', hit?.command.id === 'audio.view.sidebar' && hit.score > 0.9, JSON.stringify(hit))
  check('"can you go to the end of the song please" finds the end', matchCommand(commands, 'can you go to the end of the song please')?.command.id === 'audio.transport.end')
  check('"open the library" scores under the bar for Open Sound Library', (matchCommand(commands, 'open the library')?.score ?? 0) < 0.8, JSON.stringify(matchCommand(commands, 'open the library')))
  check('"mute the drums" finds nothing worth running', (matchCommand(commands, 'mute the drums')?.score ?? 0) < 0.6, JSON.stringify(matchCommand(commands, 'mute the drums')))
}

// ── The rules ───────────────────────────────────────────────────────────────
{
  const v = first('show the mixer')
  check('"show the mixer"', v?.name === 'workspace' && v.input.view === 'mixer', JSON.stringify(v))
  check('"back to the arrangement"', first('back to the arrangement')?.input.view === 'arrangement')
  check('"go to session view"', first('go to session view')?.input.view === 'session')
  check('"zoom in"', first('zoom in')?.input.zoom === 'in')
  check('"zoom out"', first('zoom out')?.input.zoom === 'out')
  check('"fit the song to the screen"', first('fit the song to the screen')?.input.zoom === 'fit')
  const s = first('show me bar 17')
  check('"show me bar 17" scrolls, and does not move the playhead', s?.name === 'workspace' && s.input.scrollTo?.bar === 17, JSON.stringify(s))
  check('"scroll to the chorus"', first('scroll to the chorus')?.input.scrollTo?.marker === 'chorus', JSON.stringify(first('scroll to the chorus')))
  check('"go to bar 9" is still the playhead', first('go to bar 9')?.name === 'transport')
  check('"snap to bars"', first('snap to bars')?.input.snap === 'bar')
  check('"turn snap off"', first('turn snap off')?.input.snap === 'off')
  check('"show the loading overlay"', first('show the loading overlay')?.input.overlay === 'loading', JSON.stringify(first('show the loading overlay')))
  check('"show what\'s not loaded"', first("show what's not loaded")?.input.overlay === 'loading')
  check('"clear the overlay"', first('clear the overlay')?.input.overlay === 'none')
  check('"overlay the sections"', first('overlay the sections')?.input.overlay === 'sections')
  const sp = first('open the sound settings for the pad intro clip')
  check('"open the sound settings for the pad intro clip"', sp?.name === 'workspace' && sp.input.soundPanel === true && /pad intro/.test(sp.input.target ?? ''), JSON.stringify(sp))
  const f = first('show me the drums track')
  check('"show me the drums track" brings it into view', f?.name === 'workspace' && f.input.focus === 'Drums', JSON.stringify(f))
  check('"take me to the pad"', first('take me to the pad')?.input.focus === 'Pad', JSON.stringify(first('take me to the pad')))
  const c = first('hide the sidebar')
  check('"hide the sidebar" is the palette command', c?.name === 'workspace' && c.input.command === 'Hide the sidebar', JSON.stringify(c))
  check('"drop a marker at the playhead"', first('drop a marker at the playhead')?.input.command === 'Drop a marker at the playhead', JSON.stringify(first('drop a marker at the playhead')))
  check('"import an audio file"', first('import an audio file')?.input.command === 'Import an audio file')
  check('"mute the drums" is still the mixer command', first('mute the drums')?.name === 'set_track')
  check('"show the effects on the drums" is still show_view', first('show the effects on the drums')?.name === 'show_view', JSON.stringify(first('show the effects on the drums')))
}

// ── The planner ─────────────────────────────────────────────────────────────
{
  const v = plan({ view: 'mixer' })
  check('a view plans to a WORKSPACE action', act(v)?.view === 'mixer' && v.say === 'Mixer view.', JSON.stringify(v))
  const z = plan({ zoom: 'fit' })
  check('zoom to fit', act(z)?.zoom === 'fit' && /Fitted the song/.test(z.say), z.say)
  const s = plan({ scrollTo: { bar: 17 } })
  check('scroll to bar 17 is a beat', act(s)?.scrollToBeat === 64 && /Showing bar 17/.test(s.say), s.say)
  const m = plan({ scrollTo: { marker: 'chorus' } })
  check('scroll to the chorus is its beat', act(m)?.scrollToBeat === 32, JSON.stringify(m))
  const sn = plan({ snap: 'eighths' })
  check('snap said as a word', act(sn)?.snap === '1/8' && /eighths/.test(sn.say), sn.say)
  const o = plan({ overlay: 'not loaded' })
  check('an overlay by name', act(o)?.overlay === 'loading' && /Not loaded overlay/.test(o.say), o.say)
  const off = plan({ overlay: 'off' })
  check('overlay off', act(off)?.overlay === 'none')
  const bad = plan({ overlay: 'purple' })
  check('an unknown overlay is refused', !!bad.problem, bad.problem)
  const sp = plan({ soundPanel: true, target: 'pad intro' })
  check('the sound panel names its clip', act(sp)?.soundPanelClipId === 'c1' && /Sound panel for Pad intro/.test(sp.say), sp.say)
  const sel = plan({ soundPanel: true })
  check('or the selection', act(sel)?.soundPanelClipId === null)
  const f = plan({ focus: 'drums' })
  check('focus resolves the track', act(f)?.focusTrackId === 't2' && /Showing "Drums"/.test(f.say), f.say)
  const c = plan({ command: 'Hide the sidebar' })
  check('a palette command passes through for the studio to run, named', act(c)?.command === 'Hide the sidebar' && c.say === 'Hide the sidebar.', JSON.stringify(c))
  const none = plan({})
  check('nothing named is a question', !!none.problem)
}

// ── Wired into the studio ───────────────────────────────────────────────────
{
  const control = readFileSync('components/editor/daw/VoiceControl.tsx', 'utf8')
  check('the studio handles WORKSPACE', /if \(act\.type === 'WORKSPACE'\)/.test(control) && /setView\?\.\(ws\.view\)/.test(control) && /setOverlay\?\.\(ws\.overlay\)/.test(control))
  check('zoom and snap go to the arrangement, which is brought up first', /requestArrangement\(\{ zoom: ws\.zoom, snap: ws\.snap \}\)/.test(control) && /if \(switching\) setView\?\.\('arrangement'\)/.test(control))
  check('scroll centres the beat', /centerOnBeat\(ws\.scrollToBeat!\)/.test(control))
  check('a palette command is matched and run', /matchCommand\(studioCommands\(\), ws\.command\)/.test(control) && /real\?\.run\(\)/.test(control))
  check('the rules see the palette', /commands: studioCommands\(\),/.test(control))
  check('and so does the assistant', /stateSummary: studioCommandsLine\(\) \+ musicStateSummary\(/.test(control))
  const arr = readFileSync('components/editor/daw/ArrangementView.tsx', 'utf8')
  check('the arrangement listens for zoom and snap', /onArrangementRequest\(r => \{/.test(arr) && /fitToWindowRef\.current\(\)/.test(arr) && /if \(r\.snap\) setSnap\(r\.snap\)/.test(arr))
  const cmds = readFileSync('lib/commands.ts', 'utf8')
  check('the command registry can be read outside React', /export function listCommands\(\)/.test(cmds))
}

console.log(failures ? `\n${failures} failing` : '\nthe workspace, by voice')
assert.equal(failures, 0)
