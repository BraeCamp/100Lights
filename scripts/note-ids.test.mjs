// Stripping note ids must lose the ids and NOTHING else. A note that comes back
// with a different pitch, time, or velocity is a silently broken song, so this
// compares every musical field of every note across the round trip.
//
//   npm run test:noteids

import assert from 'node:assert'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const { stripNoteIds, restoreNoteIds } = createRequire(import.meta.url)('../.test-build/note-ids.js')

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const musical = (n) => ({ pitch: n.pitch, startBeat: n.startBeat, durationBeats: n.durationBeats, velocity: n.velocity, fx: n.fx })
const allNotes = (dp) => [
  ...(dp.arrangementClips ?? []),
  ...Object.values(dp.sessionGrid ?? {}).flat().filter(Boolean),
].filter(c => Array.isArray(c.notes)).flatMap(c => c.notes)

// ── A real song ──────────────────────────────────────────────────────────────
const cf = JSON.parse(readFileSync(join(homedir(), 'Desktop', '100lights-ai-renders', 'Winter Drift.cfproj'), 'utf8'))
const dp = cf.dawProject

const stripped = stripNoteIds(dp)
const restored = restoreNoteIds(stripped)

const before = allNotes(dp), after = allNotes(restored)
check('note count survives', before.length === after.length, `${before.length} → ${after.length}`)
check('every musical field survives', JSON.stringify(before.map(musical)) === JSON.stringify(after.map(musical)))
check('ids are gone from the stored form', allNotes(stripped).every(n => n.id === undefined))
check('ids are back after restore', after.every(n => typeof n.id === 'string' && n.id.length > 0))
check('ids are unique within each clip', (restored.arrangementClips ?? [])
  .filter(c => Array.isArray(c.notes))
  .every(c => new Set(c.notes.map(n => n.id)).size === c.notes.length))

const size = (o) => JSON.stringify(o).length
const saved = 1 - size(stripped) / size(dp)
check('stored form is meaningfully smaller', saved > 0.2, `${(saved * 100).toFixed(1)}% smaller`)

// ── Determinism: two clients must agree, or collab edits address nothing ──────
const a = restoreNoteIds(stripNoteIds(dp)), b = restoreNoteIds(stripNoteIds(dp))
check('restore is deterministic', JSON.stringify(allNotes(a).map(n => n.id)) === JSON.stringify(allNotes(b).map(n => n.id)))

// ── Old projects (real UUIDs on disk) must pass through untouched ─────────────
const legacy = restoreNoteIds(dp)
check('a project that still has ids keeps them', JSON.stringify(allNotes(legacy).map(n => n.id)) === JSON.stringify(before.map(n => n.id)))

// ── Idempotence and edge shapes ──────────────────────────────────────────────
check('stripping twice is stable', JSON.stringify(stripNoteIds(stripped)) === JSON.stringify(stripped))
check('restoring twice is stable', JSON.stringify(restoreNoteIds(restored)) === JSON.stringify(restored))

const empty = { arrangementClips: [], sessionGrid: {} }
check('an empty project is fine', JSON.stringify(restoreNoteIds(stripNoteIds(empty))) === JSON.stringify(empty))

const audioOnly = { arrangementClips: [{ id: 'c1', kind: 'audio', name: 'x' }], sessionGrid: {} }
check('audio clips are left alone', JSON.stringify(stripNoteIds(audioOnly).arrangementClips[0]) === JSON.stringify(audioOnly.arrangementClips[0]))

const withGrid = {
  arrangementClips: [],
  sessionGrid: { t1: [null, { id: 'g1', kind: 'midi', notes: [{ id: 'zzz', pitch: 60, startBeat: 0, durationBeats: 1, velocity: 100 }] }] },
}
check('session-grid clips are covered', stripNoteIds(withGrid).sessionGrid.t1[1].notes[0].id === undefined)
check('session-grid nulls survive', stripNoteIds(withGrid).sessionGrid.t1[0] === null)

// A note carrying per-note FX must keep it — that data lives ON the note.
const withFx = { arrangementClips: [{ id: 'c', kind: 'midi', notes: [{ id: 'q', pitch: 60, startBeat: 0, durationBeats: 1, velocity: 90, fx: { drive: 0.4 } }] }], sessionGrid: {} }
check('per-note fx survives the round trip',
  restoreNoteIds(stripNoteIds(withFx)).arrangementClips[0].notes[0].fx.drive === 0.4)

assert.equal(failures, 0, `${failures} note-id case(s) failed`)
console.log('\nall note-id round-trip cases pass')
