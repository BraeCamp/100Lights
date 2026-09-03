#!/usr/bin/env node
// Light survives the trip.
//
//   node --experimental-strip-types scripts/apollo-tests/light-mount.test.mjs
//
// Brae: "The primary thing is to help light survive the trip with the switch to
// layout."
//
// Light used to be rendered by the DAW's transport bar. That made it a child of
// the editor, so leaving the editor unmounted it and took the conversation with
// it — the history, a question it had just asked, what you had selected.
// "Open the video module" could never have worked: the thing being asked would
// stop existing on the way there.
//
// The mount is React structure, so most of what matters here is checked against
// the source rather than executed. What CAN be executed — that navigation
// resolves, that the studio commands still work, that Light refuses honestly
// when there is no project — is.

import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { importTs } from '../lib/ts-import.mjs'

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

// ── exactly one of it ──────────────────────────────────────────────────────
//
// ⚠️ Two instances would be two microphones, and the second would be listening
// to the first. The transport offers a slot; Light portals into it.
{
  const transport = readFileSync('components/editor/daw/Transport.tsx', 'utf8')
  const mount = readFileSync('components/LightMount.tsx', 'utf8')
  const layout = readFileSync('app/(app)/AppLayoutClient.tsx', 'utf8')
  const root = readFileSync('app/layout.tsx', 'utf8')

  check('the transport no longer mounts Light',
    !/<VoiceControl/.test(transport) && /setLightSlot/.test(transport))
  check('LightMount is the only thing that renders it', /<VoiceControl/.test(mount))

  // ⚠️ AT THE ROOT, NOT IN (app). Brae: "it still dies when the page changes."
  // community, apps, learn and store all live OUTSIDE the (app) group, and
  // Light's own navigation offers three of them — so obeying "go to the
  // community" walked Light off the edge of its own layout and ended it.
  check('the ROOT layout mounts LightMount', /<LightMount\s*\/>/.test(root))
  check('and the app layout no longer does too — one mount, not two',
    !/<LightMount\s*\/>/.test(layout))
  check('the desktop menu bridge moved with it, for the same reason',
    /<DesktopMenu\s*\/>/.test(root) && !/<DesktopMenu\s*\/>/.test(layout))

  // ⚠️ THE EARLIER FIX, STILL LOAD-BEARING. Each branch used to return its own
  // provider tree, and React reconciles by position — so moving between the
  // editor and the rest of the app swapped one tree for another and unmounted
  // everything inside. Light no longer lives in there, but the studio does.
  const returns = (layout.match(/\n  return \(/g) ?? []).length
  check('the app layout still has ONE return', returns === 1, `${returns} returns`)

  // ⚠️ Existing everywhere is not the same as being ON SCREEN everywhere.
  check('Light stays off the marketing and auth pages',
    /NO_LIGHT/.test(mount) && /path === '\/'/.test(mount))
  // The old guarantee came from the layout boundary, which is now gone.
  check('and a desktop module window still gets no microphone of its own',
    /desktop && path\.startsWith\('\/apps\/'\)/.test(mount))
}

// ── the studio is optional now ─────────────────────────────────────────────
{
  const dawState = readFileSync('lib/daw-state.ts', 'utf8')
  check('there is a non-throwing way to ask for the studio',
    /export function useOptionalDaw/.test(dawState))
  const useLight = readFileSync('lib/voice/use-light.ts', 'utf8')
  check('Light asks that way, and reports whether there is one',
    /useOptionalDaw/.test(useLight) && /inStudio/.test(useLight))
  // ⚠️ A dispatch that quietly did nothing would let a command report success
  // outside the studio — the exact failure this project keeps finding.
  check('and the dispatch throws rather than pretending, off the studio',
    /throw new Error\('Light: no studio is open/.test(useLight))

  const voice = readFileSync('components/editor/daw/VoiceControl.tsx', 'utf8')
  check('a song command with no project open says so',
    /There is no project open/.test(voice))
}

// ── going somewhere is a command now ───────────────────────────────────────
const { interpret } = await importTs('lib/voice/interpret.ts')
const { planVoiceCall } = await importTs('lib/voice/execute-music.ts')

const project = {
  id: 'p', name: 'T', tempo: 120, timeSignatureNum: 4, timeSignatureDen: 4, masterVolume: 0.8,
  tracks: [{ id: 'td', name: 'Drums', instrument: { type: 'drum', params: {} }, effects: [], volume: 0.8 }],
  arrangementClips: [{ id: 'c1', trackId: 'td', kind: 'midi', name: 'Drums 1', startBeat: 0, durationBeats: 8, isDrumClip: true, notes: [] }],
}
const ctx = { tracks: project.tracks, tempo: 120, clips: [{ id: 'c1', name: 'Drums 1', trackId: 'td' }] }
const run = line => {
  const call = interpret(line, ctx).calls[0]
  return { call, plan: call ? planVoiceCall(call, project) : null }
}
{
  const places = [
    ['open the video module', '/create?modules=video'],
    ['take me to my projects', '/projects'],
    ['open the library', '/library'],
    ['go to the community', '/community'],
    ['open the dashboard', '/dashboard'],
    ['switch to audio', '/create?modules=audio&audioMode=music'],
  ]
  const wrong = []
  for (const [line, to] of places) {
    const { call, plan } = run(line)
    const act = plan?.actions?.[0]
    if (call?.name !== 'open_editor' || act?.type !== 'NAVIGATE' || act.to !== to) {
      wrong.push(`"${line}" → ${call?.name ?? 'nothing'}/${act?.type ?? '-'} ${act?.to ?? ''}`)
    }
  }
  check('every place opens the right place', wrong.length === 0, wrong.join(' | '))

  // ⚠️ Said BEFORE the trip. Navigation is the one action whose result is a
  // different screen, so a read-back that arrives afterwards arrives somewhere
  // nobody is looking.
  check('and it says where it is going', /Opening the video module/.test(run('open the video module').plan?.say ?? ''))

  // The editors it has always opened must still open, not become places.
  const seq = run('open the sequencer')
  const roll = run('show me the piano roll')
  check('the sequencer is still an editor, not a destination',
    seq.plan?.actions?.some(a => a.type === 'OPEN_EDITOR'), seq.plan?.say ?? seq.plan?.problem)
  check('and so is the piano roll',
    roll.plan?.actions?.some(a => a.type === 'OPEN_EDITOR'), roll.plan?.say ?? roll.plan?.problem)
}

// ── and NAVIGATE is handled, like every other action ───────────────────────
//
// The guard from voice-actions.test.mjs, applied to the new one specifically:
// an action nothing handles is a command that reports success and does nothing.
{
  const voice = readFileSync('components/editor/daw/VoiceControl.tsx', 'utf8')
  check('NAVIGATE has a handler', /act\.type === 'NAVIGATE'/.test(voice))
  check('and it actually navigates', /router\.push\(to\)/.test(voice))

  // ⚠️ A NEW PROJECT LANDS IN THE STUDIO, NOT AT THE CHOOSER.
  // Brae: "when I say to add a new DAW project it opens a project from All
  // Projects so it isn't DAW specific and it needs naming which it can't do."
  // Bare /create asks which kind of project and waits at a name field Light
  // cannot type into, so the request stopped one step from done.
  check('a new project goes straight to the DAW',
    /modules: 'audio', audioMode: 'music'/.test(voice))
  check('and carries the spoken name with it', /q\.set\('name', a\.name\)/.test(voice))
  const create = readFileSync('app/(app)/create/NewProjectClient.tsx', 'utf8')
  // The other half: the parameter was being sent to something that read it.
  check('and /create actually reads that name',
    /searchParams\.get\('name'\)/.test(create) && /useState\(nameParam/.test(create))
}

console.log(failures ? `\n${failures} failing` : '\nLight goes where you go')
assert.equal(failures, 0)
