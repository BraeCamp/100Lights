#!/usr/bin/env node
// The voice system on a desktop app and in a browser.
//
//   node --experimental-strip-types scripts/apollo-tests/voice-platforms.test.mjs
//
// Brae: "Test it under simulated desktop app conditions and browser
// conditions. Look for flaws and inconsistencies."
//
// The two differ in ways that decide whether Light works at all:
//
//   ⚠️ ELECTRON HAS NO SpeechRecognition. Chromium's implementation talks to a
//   Google service that is not in an Electron build, so the browser recogniser
//   is simply absent and everything must fall back to recording plus server
//   transcription. If that fallback is decided by an ERROR rather than by a
//   capability check, the FIRST command in the desktop app fails.
//
//   ⚠️ SPEAKING WHILE LISTENING is decided differently: with a recorder the
//   studio deafens itself and speaks; with the browser recogniser it must not
//   speak at all, or it transcribes its own read-back.
//
//   ⚠️ AND THE MENU ONLY EXISTS ON ONE OF THEM. Every command the menu bar and
//   the global shortcuts send must be answered by something, or the desktop
//   build has menu items that do nothing.

import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { importTs } from '../lib/ts-import.mjs'

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

// ── a browser, and an Electron build ───────────────────────────────────────
function asBrowser() {
  globalThis.window = {
    SpeechRecognition: function () {},          // Chrome/Safari have it
    localStorage: { getItem: () => null, setItem: () => {} },
  }
  setNavigator()
  globalThis.localStorage = globalThis.window.localStorage
}
function asDesktop() {
  globalThis.window = {
    // ⚠️ No SpeechRecognition and no webkitSpeechRecognition — the whole point.
    electronAPI: { isElectron: true, platform: 'darwin', onMenuCommand: () => () => {} },
    localStorage: { getItem: () => null, setItem: () => {} },
  }
  setNavigator()
  globalThis.localStorage = globalThis.window.localStorage
}

// ⚠️ `navigator` is a getter-only global in Node, so it has to be redefined
// rather than assigned — the plain assignment throws.
function setNavigator() {
  Object.defineProperty(globalThis, 'navigator', {
    value: { mediaDevices: { getUserMedia: async () => ({}) }, userAgent: 'test' },
    configurable: true, writable: true,
  })
}

const speech = await importTs('lib/voice/speech.ts')
const record = await importTs('lib/voice/record.ts')

// ── the recogniser each platform actually has ──────────────────────────────
{
  asBrowser()
  const inBrowser = speech.isSpeechAvailable()
  asDesktop()
  const onDesktop = speech.isSpeechAvailable()

  check('a browser reports its own recogniser', inBrowser === true, String(inBrowser))
  // ⚠️ Not a bug — a fact about Electron, and the reason the fallback exists.
  check('the desktop app reports NO browser recogniser', onDesktop === false, String(onDesktop))

  // ⚠️ THE FALLBACK MUST BE A CAPABILITY CHECK, NOT AN ERROR HANDLER. Deciding
  // it after a failure means the first thing anybody says in the desktop app is
  // lost, which reads as "the voice control does not work".
  const src = readFileSync('components/editor/daw/VoiceControl.tsx', 'utf8')
  check('and it chooses recording BEFORE trying, not after failing',
    /preferredTranscriber\(\) === 'server' \|\| !available\.current/.test(src))
}

// ── the studio must never transcribe its own voice ─────────────────────────
{
  const speak = await importTs('lib/voice/speak.ts')
  // With the browser recogniser open there is nothing to mute, so it stays
  // quiet. With a recorder it deafens itself instead and speaks normally.
  check('it will not speak into an open browser recogniser',
    speak.shouldSpeak('Bass muted.', { listening: true }) === false)
  check('but it does speak when nothing is listening',
    speak.shouldSpeak('Bass muted.', { listening: false }) === true)

  const src = readFileSync('components/editor/daw/VoiceControl.tsx', 'utf8')
  check('and on the recorder path it mutes the microphone while talking',
    /held\.setMuted\(true\)/.test(src))
  // ⚠️ The tail matters as much as the utterance: onended fires before the
  // sound has left the speaker, let alone stopped bouncing off the room.
  check('and stays deaf for a moment afterwards', /ECHO_TAIL_MS/.test(src))
}

// ── every menu command is answered by something ────────────────────────────
//
// ⚠️ A desktop-only surface is the easiest place to ship something inert: it
// cannot be exercised by clicking around in a browser, so nothing catches it.
{
  const menu = readFileSync('electron/src/menu.ts', 'utf8')
  const main = readFileSync('electron/src/main.ts', 'utf8')
  const bridge = readFileSync('components/DesktopMenu.tsx', 'utf8')
  const editor = readFileSync('components/editor/AudioEditor.tsx', 'utf8')
  const voice = readFileSync('components/editor/daw/VoiceControl.tsx', 'utf8')

  const sent = new Set([
    ...[...menu.matchAll(/send\('([a-z-]+)'/g)].map(m => m[1]),
    ...[...main.matchAll(/command: '([a-z-]+)'/g)].map(m => m[1]),
  ])
  const answered = new Set([
    ...[...bridge.matchAll(/'([a-z-]+)'/g)].map(m => m[1]),
    ...[...editor.matchAll(/command === '([a-z-]+)'/g)].map(m => m[1]),
    ...[...voice.matchAll(/=== '([a-z-]+)'/g)].map(m => m[1]),
  ])
  const orphans = [...sent].filter(c => !answered.has(c))
  check(`all ${sent.size} menu and shortcut commands are answered`,
    orphans.length === 0, orphans.join(', '))
  check('and the list is really being read', sent.size >= 6, `${sent.size} commands`)
}

// ── the desktop's own navigation rules still hold ──────────────────────────
//
// ⚠️ THE INCONSISTENCY THIS FILE WAS WRITTEN FOR. Electron closed a project
// window and surfaced the launcher by intercepting will-navigate — which fires
// only on a FULL PAGE LOAD. Turning the Home link into a <Link>, so that the
// browser keeps Light alive across it, silently ended that behaviour: a
// History-API navigation triggers no such event, so the project window simply
// became a dashboard and the launcher stayed hidden.
{
  const main = readFileSync('electron/src/main.ts', 'utf8')
  const editor = readFileSync('components/editor/AudioEditor.tsx', 'utf8')
  check('the desktop is ASKED to go home rather than intercepting a page load',
    /ipcMain\.handle\('window:goHome'/.test(main))
  check('and the launcher itself is not closed by it',
    /win === launcherWindow\) return false/.test(main))
  check('the editor asks when it is on the desktop', /api\?\.goHome/.test(editor))
  check('and leaves the browser to navigate normally',
    /if \(!api\?\.goHome\) return/.test(editor))
}

// ── one Light, not several ─────────────────────────────────────────────────
//
// ⚠️ A desktop app can have many windows, and every window that mounts Light
// mounts another microphone. Module windows load /apps/*; pop-outs are portals
// from the parent, not new apps.
//
// ⚠️ THIS GUARANTEE CHANGED HANDS. It used to come for free from the layout
// boundary — /apps/* sat outside the (app) group, which is where Light was
// mounted. Light now lives at the ROOT so it survives navigating to community,
// apps and learn, and that boundary no longer protects anything. LightMount
// has to exclude desktop module windows itself, or a five-window desktop
// session has five microphones in it, each able to hear the others.
{
  const main = readFileSync('electron/src/main.ts', 'utf8')
  check('module windows load /apps/<key>',
    /loadURL\(`\$\{APP_URL\}\/apps\/\$\{moduleKey\}`\)/.test(main))

  const mount = readFileSync('components/LightMount.tsx', 'utf8')
  check('and Light refuses to mount in a desktop module window',
    /desktop && path\.startsWith\('\/apps\/'\)/.test(mount))
  check('while a browser visiting the same page still gets it',
    /In a BROWSER/.test(mount))
  check('and a popped-out panel is a portal, not a second app',
    /createPortal/.test(mount) && !/loadURL|window\.open\('\/'/.test(mount))
}

// ── the microphone, which is the whole voice system on the desktop ─────────
//
// ⚠️ THE ONE THAT CRASHES A SHIPPED BUILD AND CANNOT BE SEEN IN DEV.
//
// Electron has no SpeechRecognition, so on the desktop the RECORDER is the only
// path Light has. macOS terminates a process that touches the microphone when
// its Info.plist carries no NSMicrophoneUsageDescription — and a dev run
// (`electron .`) inherits Electron's own Info.plist, which has the key. So this
// works every time it is tested by hand and dies the moment it is packaged.
{
  const pkg = JSON.parse(readFileSync('electron/package.json', 'utf8'))
  const info = pkg.build?.mac?.extendInfo ?? {}
  check('the packaged app declares why it wants the microphone',
    typeof info.NSMicrophoneUsageDescription === 'string' && info.NSMicrophoneUsageDescription.length > 10)
  // The entitlement and the usage string are two different gates and both are
  // required under a hardened runtime; the entitlement alone is the trap.
  const ents = readFileSync('build/entitlements.mac.plist', 'utf8')
  check('and holds the entitlement that goes with it',
    /com\.apple\.security\.device\.audio-input/.test(ents))
  check('and the camera entitlement is likewise declared, not bare',
    !/com\.apple\.security\.device\.camera/.test(ents) || typeof info.NSCameraUsageDescription === 'string')

  // ⚠️ And when it IS denied the two platforms need different answers: a
  // browser has shown a prompt and left a control in the address bar; macOS
  // asks once, ever, and then silently returns nothing forever.
  const rec = readFileSync('lib/voice/record.ts', 'utf8')
  check('a denied microphone is told apart from a missing one',
    /NotAllowedError/.test(rec) && /lastMicProblem/.test(rec))
  check('and the desktop answer names the settings pane',
    /Privacy & Security/.test(rec) && /Privacy & security/.test(rec))
  const voice = readFileSync('components/editor/daw/VoiceControl.tsx', 'utf8')
  check('and nothing still reports the bare "could not open" line',
    !/could not open the microphone\.', 'problem'/i.test(voice)
    && (voice.match(/micProblemMessage\(\)/g) ?? []).length >= 3)
}

// ── a shortcut that says "from anywhere" must work from anywhere ───────────
{
  const main = readFileSync('electron/src/main.ts', 'utf8')
  check('global shortcuts skip windows that cannot answer',
    /isModuleWindow\(focused\)/.test(main))
  check('and fall back to the last studio window rather than nothing',
    /lastAppWindow/.test(main))
  const voice = readFileSync('components/editor/daw/VoiceControl.tsx', 'utf8')
  check('and Light is really listening at the other end',
    /command !== 'voice-toggle'/.test(voice))
}

// ── a file the operating system hands us ───────────────────────────────────
//
// ⚠️ Desktop-only and therefore easy to ship inert: double-clicking a .cfproj
// brought the app to the front and then did nothing at all.
{
  const main = readFileSync('electron/src/main.ts', 'utf8')
  const bridge = readFileSync('components/DesktopMenu.tsx', 'utf8')
  check('the main process reads the file rather than handing over a path',
    /readFileSync\(filePath/.test(main) && !/arg: filePath/.test(main))
  check('and refuses one too large to be a project', /64 \* 1024 \* 1024/.test(main))
  check('the renderer opens it by the same door as the projects page',
    /cf_pending_cfproj_/.test(bridge) && /readProjectFile/.test(bridge))
}

console.log(failures ? `\n${failures} failing` : '\nboth platforms behave')
assert.equal(failures, 0)
