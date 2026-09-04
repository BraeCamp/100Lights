#!/usr/bin/env node
// Standby: a microphone left open that acts on nothing until "Hey Light" or
// "Voice Control".
//
//   node --experimental-strip-types scripts/apollo-tests/voice-standby.test.mjs
//
// Brae: "Can we have a standby mode that only listens for the user saying
// 'Hey Light' or 'Voice Control'."

import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { importTs } from '../lib/ts-import.mjs'

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const { wakePhraseIn, standbyControlIn, isAwake, WAKE_PHRASES } = await importTs('lib/voice/wake.ts')

// ── The call ────────────────────────────────────────────────────────────────
{
  const w = s => wakePhraseIn(s)
  check('"Hey Light, mute the drums" wakes and carries the command', (() => { const r = w('Hey Light, mute the drums'); return r?.phrase === 'hey light' && r?.rest === 'mute the drums' })(), JSON.stringify(w('Hey Light, mute the drums')))
  check('"voice control unmute the pad"', (() => { const r = w('voice control unmute the pad'); return r?.phrase === 'voice control' && r?.rest === 'unmute the pad' })())
  check('"Voice Control." alone wakes with nothing to do', (() => { const r = w('Voice Control.'); return r?.phrase === 'voice control' && r?.rest === '' })())
  check('"Hey Light" alone wakes with nothing to do', w('Hey Light')?.rest === '')
  check('"okay light, play" is a greeting too', w('okay light, play')?.rest === 'play')
  check('"um hey light stop" — the call can sit inside the sentence', w('um hey light stop')?.rest === 'stop')
  check('"hey late mute the drums" — a bent "light" after "hey" still wakes', w('hey late mute the drums')?.rest === 'mute the drums', JSON.stringify(w('hey late mute the drums')))
  check('"a light mute the drums" — the recogniser\'s "hey" as "a"', w('a light mute the drums')?.rest === 'mute the drums')
  check('"turn right at the lights" does not', w('turn right at the lights') === null)
  check('"the light is on" does not', w('the light is on') === null)
  check('"light, mute the drums" does not — one word is not the call', w('light, mute the drums') === null)
  check('"mute the drums" does not', w('mute the drums') === null)
  check('"voice controls are great" wakes (the recogniser adds the s)', w('voice controls are great')?.phrase === 'voice control')
  check('the phrases are vocabulary for the recorder', WAKE_PHRASES.includes('hey light') && WAKE_PHRASES.includes('voice control'))
}

// ── Back to sleep, and the setting by voice ─────────────────────────────────
{
  const c = s => standbyControlIn(s)
  check('"stand by" sleeps', c('stand by') === 'sleep')
  check('"Standby." sleeps', c('Standby.') === 'sleep')
  check('"go to standby" sleeps', c('go to standby') === 'sleep')
  check('"that\'s all" sleeps', c("that's all") === 'sleep')
  check('"thanks light" sleeps', c('thanks light') === 'sleep')
  check('"stop listening" sleeps', c('stop listening') === 'sleep')
  check('"hey light stand by" sleeps', c('hey light stand by') === 'sleep')
  check('"I\'ll stand by the door" is conversation', c("I'll stand by the door") === null)
  check('"standby off" turns the setting off', c('standby off') === 'standby-off')
  check('"stay awake" turns the setting off', c('stay awake') === 'standby-off')
  check('"only listen for hey light" turns it on', c('only listen for hey light') === 'standby-on')
  check('"mute the drums" is neither', c('mute the drums') === null)
}

// ── The awake window ────────────────────────────────────────────────────────
{
  const now = 10_000_000_000
  check('never called, never spoken to: asleep', isAwake(0, 0, 30, now) === false)
  check('called 10 s ago, 30 s window: awake', isAwake(now - 10_000, 0, 30, now) === true)
  check('called 40 s ago: asleep', isAwake(now - 40_000, 0, 30, now) === false)
  check('a command 5 s ago keeps it awake', isAwake(now - 40_000, now - 5_000, 30, now) === true)
  check('"until told" stays awake once called', isAwake(now - 3_600_000, 0, 0, now) === true)
  check('"until told" but never called: asleep', isAwake(0, now - 1000, 0, now) === false)
}

// ── Wired into the card ─────────────────────────────────────────────────────
{
  const control = readFileSync('components/editor/daw/VoiceControl.tsx', 'utf8')
  check('the gate reads microphone sentences in a kept-open session only', /const fromMic = !!heard && continuousRef\.current\n\s+if \(fromMic && standbyRef\.current\)/.test(control))
  check('and sits BEFORE the undo group opens', control.indexOf('if (fromMic && standbyRef.current)') < control.indexOf('beginUndoGroup?.(spoken)'))
  check('a dropped sentence runs nothing and says nothing', /else if \(!awake\) \{\n\s+ignoredRef\.current \+= 1\n\s+setIgnored\(ignoredRef\.current\)\n\s+setStandbyShown\('asleep'\)\n\s+return/.test(control))
  check('an answer to a question is never dropped', /const answering = !!pendingDoRef\.current \|\| !!askingRef\.current/.test(control) && /const awake = answering \|\| isAwake\(/.test(control))
  check('the call with a command runs the command', /spoken = wake\.rest/.test(control))
  check('"stand by" puts it to sleep, and turns standby on when it was off', /standbyWord === 'standby-on' \|\| standbyWord === 'sleep'/.test(control) && /setStandbyOn\(true\)/.test(control))
  check('the setting is read on mount and written from the panel', /const sb = standbyOn\(\)/.test(control) && /onStandby=\{on =>/.test(control))
  check('the recorder is told the call as vocabulary', /\.\.\.WAKE_PHRASES,/.test(control))
  check('the card says "Standing by" while asleep', /standbyState === 'asleep' \? 'Standing by'/.test(control))
  const hud = readFileSync('components/editor/daw/VoiceHud.tsx', 'utf8')
  check('so does the HUD', /p\.standby === 'asleep'\) return \{ label: 'Standing by'/.test(hud))
  const panel = readFileSync('components/editor/daw/VoicePanel.tsx', 'utf8')
  check('the panel has the toggle and the awake window', /Standby — wake on “Hey Light” or “Voice Control”/.test(panel) && /data-voice-awake-for/.test(panel))
  check('and says what it costs', /half a cent a minute/.test(panel))
}

console.log(failures ? `\n${failures} failing` : '\nstanding by')
assert.equal(failures, 0)
