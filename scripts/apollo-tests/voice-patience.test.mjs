#!/usr/bin/env node
// Not over the top of you, a dial for how long it waits, and one undo per request.
//
//   node --experimental-strip-types scripts/apollo-tests/voice-patience.test.mjs
//
// Brae: "Voice control is getting ahead of itself, it should start processing
// when it has something to focus on but it starts talking over me at some
// point. The user should be able to adjust the sensitivity of its hearing too,
// and it needs to be able to undo an entire request. If I ask it to do 4 things
// in one request, an undo request after that should undo the whole thing…
// For Light, we also need for it to wait to answer verbally if talking is
// still happening. We also need for it to stop saying 'I didn't catch that'
// just because it's still loading / processing."

import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { importTs } from '../lib/ts-import.mjs'

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

// ── One undo per request ───────────────────────────────────────────────────
{
  const { takeUndoGroup } = await importTs('lib/daw-undo.ts')
  const e = (n, group) => ({ before: n, action: { type: 'SET_TEMPO', tempo: n }, ...(group ? { group } : {}) })
  // A spoken request of four actions, after a click, after another request.
  const stack = [e(1), e(2, 'g1'), e(3, 'g1'), e(4), e(5, 'g2'), e(6, 'g2'), e(7, 'g2'), e(8, 'g2')]
  const first = takeUndoGroup(stack)
  check('undo takes the whole request off the top', first.length === 4 && first.map(x => x.before).join() === '8,7,6,5', JSON.stringify(first.map(x => x.before)))
  check('newest first, so the reverts apply in the right order', first[0].before === 8)
  const second = takeUndoGroup(stack)
  check('a lone click comes off alone', second.length === 1 && second[0].before === 4)
  const third = takeUndoGroup(stack)
  check('and the earlier request comes off as one', third.length === 2 && third.map(x => x.before).join() === '3,2')
  check('the ungrouped entry below is untouched', stack.length === 1 && stack[0].before === 1)
  check('an empty stack gives nothing', takeUndoGroup([]).length === 0)

  const editor = readFileSync('components/editor/AudioEditor.tsx', 'utf8')
  check('the editor tags every dispatch with the open group', /group: g\.id, label: g\.label/.test(editor))
  check('and undoes a group with N precise reverts', /const taken = takeUndoGroup\(historyRef\.current\)/.test(editor) && /for \(const entry of taken\)/.test(editor))
  check('redo takes the group back the same way', /const taken = takeUndoGroup\(redoRef\.current\)/.test(editor))
  // ⚠️ Was `return taken.length`. It now counts across the whole call, because
  // undo takes a `groups` argument: calling it twice in one tick used to
  // corrupt the redo stack (projectRef.current is only refreshed after a
  // render, so the second call started from the state before the first), and
  // the Undo History panel walks back several steps at once.
  check('and reports how many came off', /let done = 0/.test(editor) && /done\+\+/.test(editor) && /return done/.test(editor))
  check('and walks several groups inside ONE call, so the redo stack stays true',
    /const doUndo = useCallback\(\(groups = 1\)/.test(editor) && /const doRedo = useCallback\(\(groups = 1\)/.test(editor))
  // ⚠️ Seen on the real path: two reverts computed against the same stale
  // snapshot, and the second put the first's target back. Each is computed
  // against the state the one before it produced.
  check('each revert in a group is computed against the previous one', /cur = undoReducer\(cur, patchAction\)/.test(editor) && /computeRevertPatch\(entry\.before, cur, entry\.action\)/.test(editor))
  check('the context offers begin/end', /beginUndoGroup,\s*\n\s*endUndoGroup,/.test(editor))

  const control = readFileSync('components/editor/daw/VoiceControl.tsx', 'utf8')
  check('every spoken request opens a group', /beginUndoGroup\?\.\(spoken\)/.test(control))
  check('and closes it when the exchange is recorded', /endUndoGroup\?\.\(\)/.test(control))
  check('"undo" says how many changes came back', /Undone[^\n]*changes/.test(control))
  check('and never says "Undone." over an empty stack', !/did === false/.test(control) && /if \(!did\)/.test(control))
}

// ── How long it waits for you to finish ────────────────────────────────────
{
  const speak = readFileSync('lib/voice/speak.ts', 'utf8')
  check('patience is a setting of its own, beside sensitivity', /export function voicePatience\(\)/.test(speak) && /export function setVoicePatience/.test(speak))
  const vad = readFileSync('lib/voice/vad.ts', 'utf8')
  check('the silence tail stretches with it', /\(opts\.playing \? SILENCE_MS_PLAYING : SILENCE_MS\) \* patience/.test(vad))
  check('but a single word still ends quickly', /\? \(opts\.playing \? SILENCE_MS_SHORT_PLAYING : SILENCE_MS_SHORT\)\n/.test(vad))
  const record = readFileSync('lib/voice/record.ts', 'utf8')
  check('the recorder passes it through', /patience: o\.patience/.test(record))
  const panel = readFileSync('components/editor/daw/VoicePanel.tsx', 'utf8')
  check('and the card has a dial for it, in words', /data-voice-patience/.test(panel) && /Patient/.test(panel) && /Unhurried/.test(panel))
  const control = readFileSync('components/editor/daw/VoiceControl.tsx', 'utf8')
  check('the studio sends it with every take', /patience: patienceRef\.current/.test(control))
}

// ── Not over the top of you, and no "didn't catch that" mid-flight ─────────
{
  const control = readFileSync('components/editor/daw/VoiceControl.tsx', 'utf8')
  check('the microphone marks when you are talking', /if \(l > bar\) userSpeakingUntil\.current = Date\.now\(\) \+ 700/.test(control))
  check('so does the browser recogniser', /if \(t\) userSpeakingUntil\.current = Date\.now\(\) \+ 900/.test(control))
  check('a reply waits to be SPOKEN while you are still talking', /if \(Date\.now\(\) < userSpeakingUntil\.current && retry < 40\)/.test(control))
  check('but its words go on screen at once', /const mine = deferToken\.current\s*\n\s*window\.setTimeout\(\(\) => \{ if \(deferToken\.current === mine\) respond\(text, kind, retry \+ 1\) \}, 150\)/.test(control))
  check('a newer reply supersedes a waiting one', /deferToken\.current \+= 1/.test(control))
  check('an empty take mid-request is a pause, not a failure',
    /const midway = !!heldFragment\.current \|\| Date\.now\(\) < userSpeakingUntil\.current \+ 2500 \|\| talking/.test(control)
    && /if \(!askingRef\.current && !busyRef\.current && !settling && !midway\) setProblem/.test(control))
  check('and the recorder path checks the same before complaining',
    /const midway = busyRef\.current \|\| !!heldFragment\.current/.test(control) && /if \(!midway\) setProblem\('I didn\\'t catch that\.'\)/.test(control))
}

console.log(failures ? `\n${failures} failing` : '\nit waits for you')
assert.equal(failures, 0)
