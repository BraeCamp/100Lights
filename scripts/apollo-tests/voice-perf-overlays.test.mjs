#!/usr/bin/env node
// A long session that does not slow down, and one list of overlays.
//
//   node --experimental-strip-types scripts/apollo-tests/voice-perf-overlays.test.mjs
//
// Brae: "I found that Light was slower to transcribe what I was saying the
// longer it ran. Is there some sort of memory leak? Also take existing overlay
// options and the recommendations and consolidate them."
//
// ⚠️ NOT A LEAK — A RATE. Nothing held on to memory; the level meter reported
// every 50 ms and each report set React state on the whole voice control, the
// card, and whatever bar sat beside it. The bar's contents grew all session
// (the transcript, the cost log), so each of those twenty re-renders a second
// cost more as time went on, the main thread got busier, and the recorder,
// the VAD and the transcription fetch queued behind it.

import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { importTs } from '../lib/ts-import.mjs'

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

// ── The meter no longer re-renders everything twenty times a second ────────
{
  const control = readFileSync('components/editor/daw/VoiceControl.tsx', 'utf8')
  // ⚠️ Measured before/after: 63% of the main thread with a 200-row transcript
  // open (old), 12.6% with paints throttled, and the level off React state
  // entirely leaves nothing per tick but a canvas and two style writes.
  check('the level is published on a bus, not set as state', /publishLevel\(l, bar\)/.test(control) && !/setLevel\(/.test(control) && !/setThreshold\(/.test(control))
  check('and the "you are talking" mark still uses every tick', /if \(l > bar\) userSpeakingUntil\.current = Date\.now\(\) \+ 700/.test(control))
  const bus = readFileSync('lib/voice/level-bus.ts', 'utf8')
  check('the bus is a reading and a set of painters', /export function publishLevel/.test(bus) && /export function subscribeLevel/.test(bus) && /export function readLevel/.test(bus))
  const panelSrc = readFileSync('components/editor/daw/VoicePanel.tsx', 'utf8')
  check('the meter paints itself from the bus', /function Meter\(\{ C \}/.test(panelSrc) && /f\.style\.width = /.test(panelSrc) && /return subscribeLevel\(paint\)/.test(panelSrc))
  check('the wave repaints once per frame from the bus, and takes no level prop', /raf = requestAnimationFrame\(\(\) => \{ raf = 0; setTick\(n => n \+ 1\) \}\)/.test(panelSrc) && /<Wave talking=\{talking\}/.test(panelSrc))
  const hud = readFileSync('components/editor/daw/VoiceHud.tsx', 'utf8')
  check('the HUD reads the bus into the ref its loop already used', /subscribeLevel\(r => \{ levelRef\.current = r\.level \}\)/.test(hud))
  check('the card gets one stable colours object', /const panelColors = useMemo\(/.test(control) && /colors=\{panelColors\}/.test(control))
  const panel = readFileSync('components/editor/daw/VoicePanel.tsx', 'utf8')
  check('the bar beside the card is memoised', /const TranscriptMemo = React\.memo\(VoiceTranscript\)/.test(panel) && /<TranscriptMemo C=\{C\} \/>/.test(panel) && /<LibraryMemo embedded onClose=\{closeSide\} colors=\{libColors\} \/>/.test(panel))
  check('with stable props for the library', /const closeSide = useCallback\(\(\) => onSide\('none'\), \[onSide\]\)/.test(panel) && /const libColors = React\.useMemo/.test(panel))
  const transcript = readFileSync('components/editor/daw/VoiceTranscript.tsx', 'utf8')
  check('the transcript draws a window, with the rest a click away', /const WINDOW = 60/.test(transcript) && /Show \{hidden\} earlier/.test(transcript))
  const record = readFileSync('lib/voice/record.ts', 'utf8')
  check('(the recorder itself never accumulates: chunks reset per utterance)', /chunks = \[\]\s*\n\s*vad = newVad\(\)/.test(record))
}

// ── One list of overlays, grouped, each naming what grey means ─────────────
{
  // daw-state pulls in the Apollo engine, which does not load under the
  // strip-types shim — so the list is read from the source, entry by entry.
  const state = readFileSync('lib/daw-state.ts', 'utf8')
  // (to the closing bracket on its own line — the type annotation has a `[]` of its own)
  const block = state.slice(state.indexOf('export const OVERLAYS'), state.indexOf('\n]', state.indexOf('export const OVERLAYS')))
  const OVERLAYS = [...block.matchAll(/kind: '([a-z]+)',\s*group: (null|'[A-Za-z]+'),\s*label: '[^']*',\s*what: '((?:[^'\\]|\\.)*)'/g)]
    .map(m => ({ kind: m[1], group: m[2] === 'null' ? null : m[2].slice(1, -1), what: m[3].replace(/\\'/g, "'") }))
  const kinds = OVERLAYS.map(o => o.kind)
  check('the list parses', OVERLAYS.length >= 12, String(OVERLAYS.length))
  for (const k of ['none', 'loading', 'sync', 'sections', 'tempo', 'key', 'automation', 'effects', 'frozen', 'loudness', 'collab', 'unused']) {
    check(`overlay "${k}" is in the list`, kinds.includes(k))
  }
  check('every overlay but Off belongs to a group', OVERLAYS.every(o => o.kind === 'none' || ['Ready', 'Structure', 'Sound', 'People'].includes(o.group)))
  check('and every description says what grey means', OVERLAYS.filter(o => o.kind !== 'none').every(o => /^Grey = /.test(o.what)))
  check('groups are contiguous, so the menu can head them', (() => {
    const seen = new Set(); let last = null
    for (const o of OVERLAYS) { if (o.group !== last) { if (o.group && seen.has(o.group)) return false; if (o.group) seen.add(o.group); last = o.group } }
    return true
  })())

  const clip = readFileSync('components/editor/daw/ClipView.tsx', 'utf8')
  for (const k of ['loading', 'sync', 'sections', 'tempo', 'key', 'automation', 'effects', 'frozen', 'loudness', 'collab', 'unused']) {
    check(`a clip answers "${k}"`, new RegExp(`case '${k}':`).test(clip))
  }
  check('the section overlay follows the playhead only while it is on', /if \(overlay !== 'sections'\) return/.test(clip) && /engine\.addEventListener\('transport', read\)/.test(clip))
  check('out-of-key uses the song\'s key and scale', /SCALE_INTERVALS\[\(project\.scale as ScaleType\)\]/.test(clip) && /project\.key \?\? 0/.test(clip))
  const arr = readFileSync('components/editor/daw/ArrangementView.tsx', 'utf8')
  check('the menu heads each group', /OVERLAYS\[i - 1\]\?\.group !== o\.group/.test(arr) && /data-overlay-kind=\{o\.kind\}/.test(arr))
}

console.log(failures ? `\n${failures} failing` : '\nno slower at the end than at the start')
assert.equal(failures, 0)
