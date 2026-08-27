#!/usr/bin/env node
// Why does a track go quiet in the app when the offline render is fine?
//
// The renderer here builds each track's audio directly, so it cannot see a whole
// class of fault that only exists in the live studio. The DAW schedules notes
// 150 ms ahead (SCHEDULE_LOOKAHEAD), and an Apollo instrument is a persistent
// AudioWorklet engine looked up in a WeakMap KEYED BY THE NODE IT PLAYS INTO
// (apollo/daw-instrument.ts, `byDest`). A note whose destination node is new
// gets a NEW engine, and an engine comes up asynchronously: worklet module,
// patch upload, then restorePatchSamples, which awaits IndexedDB and can even
// fetch. A note due before its engine is ready is queued — and a queued note can
// only be brought in late if it is still sounding. A short one is simply missed.
//
// That is survivable once per play. It was NOT survivable per note, and per note
// is what used to happen: daw-engine built a fresh GainNode as the note's
// destination whenever an FX-lane bar overlapped it. For "i'd ruin it again"
// that was 440 engines for one song — on exactly the tracks carrying bars, which
// is what "the audio stops working on some tracks sometimes" looked like from
// the outside. Bar chains are now shared per (track, bar set); the same song
// asks for 17.
//
// This counts what the app will actually be asked to build, so the next project
// that reintroduces the shape is caught before anyone has to hear it.
//
//   node scripts/check-audio-path.mjs <project.cfproj>
//   npm run check:audiopath -- <project.cfproj>

import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

const file = process.argv[2]
if (!file) { console.error('usage: check-audio-path.mjs <project.cfproj>'); process.exit(2) }
const dp = JSON.parse(readFileSync(file, 'utf8')).dawProject ?? JSON.parse(readFileSync(file, 'utf8'))
const tracks = dp.tracks ?? []
const clips = dp.arrangementClips ?? []
const bars = dp.clipEffects ?? []
const byId = Object.fromEntries(tracks.map(t => [t.id, t]))

const findings = []
const add = (level, track, what, why) => findings.push({ level, track, what, why })

// Does this instrument end up on the Apollo worklet path? Legacy poly/wavetable
// instruments are translated to Apollo patches too (daw-engine _resolveInstrument).
const APOLLO_LIKE = new Set(['apollo', 'poly', 'wavetable', 'fm4op'])

console.log(`${dp.name ?? basename(file)} — ${tracks.length} tracks, ${clips.length} clips, ${bars.length} FX-lane bars\n`)

const rows = []
let worstEngines = 0
for (const t of tracks) {
  const inst = t.instrument?.type
  if (!inst || inst === 'none') continue
  const mine = clips.filter(c => c.trackId === t.id && (!c.kind || c.kind === 'midi'))
  const notes = mine.flatMap(c => (c.notes ?? []).map(n => ({
    start: c.startBeat + n.startBeat,
    end: c.startBeat + n.startBeat + n.durationBeats,
    dur: n.durationBeats,
    clip: c,
  })))
  if (!notes.length) continue

  const trackBars = bars.filter(b => b.trackId === t.id)
  // The app's own overlap test, per note (daw-engine.ts ~2082). Notes sharing a
  // bar set now share ONE chain — and therefore one engine — so what matters is
  // how many DISTINCT bar sets a track's notes see, not how many notes there are.
  const sigOf = n => trackBars
    .filter(b => b.startBeat < n.end && b.startBeat + b.durationBeats > n.start)
    .map(b => `${b.id}@${b.startBeat}:${b.durationBeats}`).sort().join('|')
  const sets = new Set(notes.map(sigOf))
  sets.delete('')                                  // notes under no bar use the track bus

  // A graph scoped to the NOTE still builds its own chain per note, by design.
  const perNoteScoped = mine
    .filter(c => c.fxMotion?.perNote || (c.fxGraphs && Object.values(c.fxGraphs).some(g => g?.perNote)))
    .reduce((a, c) => a + (c.notes?.length ?? 0), 0)

  const apollo = APOLLO_LIKE.has(inst)
  const perNoteDest = perNoteScoped
  const engines = apollo ? 1 + sets.size + perNoteScoped : 0
  worstEngines = Math.max(worstEngines, engines)
  const longest = Math.max(...notes.map(n => n.dur))

  rows.push({ name: t.name, inst, notes: notes.length, bars: trackBars.length, perNoteDest, apollo, engines, longest })

  if (apollo && engines > 8) {
    add('fail', t.name,
      `the app builds ${engines} separate Apollo engines for this track (${sets.size} bar set(s), ${perNoteScoped} per-note graph(s))`,
      'Each one is an AudioWorkletNode plus a patch upload plus restorePatchSamples (IndexedDB, sometimes a fetch). ' +
      'Notes due before their engine is ready are queued, and a queued note can only be brought in late if it is still ' +
      'sounding — a short one is simply missed. This is the shape of "that track just stopped".')
  } else if (apollo && perNoteScoped > 8) {
    add('warn', t.name,
      `${perNoteScoped} notes carry a per-note FX graph, so each builds its own chain and its own engine`,
      'Per-note fxMotion/fxGraphs are scoped to the note by design, so they cannot share a chain. On an Apollo track ' +
      'that means one worklet engine per note — prefer an FX-lane bar (track-scoped) where the shape does not need to restart per note.')
  }
  if (apollo && longest > 32) {
    add('warn', t.name,
      `its longest note is ${Math.round(longest)} beats`,
      'A dropped note is not retried until it would have ended (_scheduledNoteKeys holds the key for the note\'s ' +
      `duration), so losing this one costs ${Math.round(longest)} beats of silence, not a hit.`)
  }
  if (apollo && notes.length <= 2 && longest > 16) {
    add('warn', t.name,
      'the whole part is one or two very long notes',
      'There is no next note to recover on. If its noteOn is missed the track is silent for the rest of the section.')
  }
}

console.log('  track            instrument   notes   FX bars   per-note graphs   engines the app builds')
console.log('  ' + '─'.repeat(88))
for (const r of rows) {
  console.log('  ' + r.name.padEnd(16) + r.inst.padEnd(12) +
    String(r.notes).padStart(5) + String(r.bars).padStart(10) +
    String(r.perNoteDest).padStart(17) +
    (r.apollo ? String(r.engines).padStart(24) : '—'.padStart(24)))
}

console.log('')
if (!findings.length) {
  console.log('CLEAN — every track gets one stable engine.')
} else {
  const fails = findings.filter(f => f.level === 'fail').length
  const warns = findings.filter(f => f.level === 'warn').length
  console.log(`${fails ? 'NEEDS WORK' : 'CHECK'}   ${fails} fail · ${warns} warn\n`)
  for (const f of findings) {
    console.log(`  ${f.level === 'fail' ? '✗' : '!'} [${f.track}] ${f.what}`)
    console.log(`      → ${f.why}\n`)
  }
}
process.exit(findings.some(f => f.level === 'fail') ? 1 : 0)
