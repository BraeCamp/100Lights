// Build the demo WIP song used as the backdrop for tutorial screenshots.
//
//   npm run build-tutorial-song
//
// Pure + deterministic: starts from the app's own defaultProject() and appends
// four poly-synth tracks (bass, chords, arp, lead — an A-minor loop) built the
// same way the Code panel builds a track (ADD_TRACK poly instrument + a MIDI
// clip). The parts are plain MIDI note arrays — the studio's runPolyCode engine
// runs in a Web Worker (browser only), and only the notes matter for a
// screenshot backdrop. Output: public/tutorial/_fixtures/demo-song.json, loaded
// via /new?fixture=demo-song. Re-run if the project/track schema changes.

import dawTypes from '../.fixture-build/daw-types.js'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const { defaultProject, defaultPolyInstrument } = dawTypes
const ROOT = process.cwd()
const TRACK_COLORS = ['#3b82f6', '#22c55e', '#f97316', '#a855f7', '#ec4899', '#14b8a6', '#eab308', '#ef4444', '#6366f1', '#84cc16', '#06b6d4', '#f43f5e']
const DEFAULT_TRACK_HEIGHT = 64
const n = (pitch, startBeat, durationBeats, velocity) => ({ pitch, startBeat, durationBeats, velocity })

// A-minor, four bars: i (Am) – VI (F) – III (C) – VII (G).
const PARTS = [
  {
    name: 'Bass', dur: 16,
    notes: [
      n(33, 0, 0.5, 110), n(33, 1.5, 0.5, 96), n(40, 2.5, 0.5, 96), n(33, 3, 0.5, 100),
      n(29, 4, 0.5, 110), n(29, 5.5, 0.5, 96), n(36, 6.5, 0.5, 96), n(29, 7, 0.5, 100),
      n(36, 8, 0.5, 110), n(36, 9.5, 0.5, 96), n(43, 10.5, 0.5, 96), n(36, 11, 0.5, 100),
      n(31, 12, 0.5, 110), n(31, 13.5, 0.5, 96), n(38, 14.5, 0.5, 96), n(31, 15, 0.5, 100),
    ],
  },
  {
    name: 'Chords', dur: 16,
    notes: [
      ...[57, 60, 64].map(p => n(p, 0, 3.8, 66)),
      ...[53, 57, 60].map(p => n(p, 4, 3.8, 66)),
      ...[48, 52, 55].map(p => n(p, 8, 3.8, 66)),
      ...[43, 47, 50].map(p => n(p, 12, 3.8, 66)),
    ],
  },
  {
    name: 'Arp', dur: 16,
    notes: Array.from({ length: 32 }, (_, i) => {
      const shape = [69, 71, 72, 74, 76, 74, 72, 71]
      return n(shape[i % shape.length], i * 0.5, 0.45, 84)
    }),
  },
  {
    name: 'Lead', dur: 16,
    notes: [
      n(69, 0, 1.5, 96), n(72, 1.5, 0.5, 90), n(71, 2, 2, 96),
      n(76, 8, 1, 96), n(74, 9, 1, 92), n(72, 10, 1, 92), n(69, 11, 3, 96),
    ],
  },
]

const proj = defaultProject()
proj.name = 'Demo Song (WIP)'
const sceneCount = proj.scenes.length
const WAVES = ['sawtooth', 'sawtooth', 'square', 'triangle']

PARTS.forEach((part, i) => {
  const trackId = randomUUID()
  const params = { ...defaultPolyInstrument().params, waveform: WAVES[i] }
  proj.tracks.push({
    id: trackId, name: part.name, type: 'audio', color: TRACK_COLORS[i % TRACK_COLORS.length],
    volume: 0.8, pan: 0, mute: false, solo: false, armed: false, inputSource: null,
    height: DEFAULT_TRACK_HEIGHT, effects: [], instrument: { type: 'poly', params },
  })
  proj.sessionGrid[trackId] = Array(sceneCount).fill(null)
  proj.arrangementClips.push({
    kind: 'midi', id: randomUUID(), trackId, name: part.name, startBeat: 0,
    durationBeats: part.dur, isDrumClip: false,
    notes: part.notes.map(note => ({ id: randomUUID(), ...note })),
  })
})

const dir = join(ROOT, 'public', 'tutorial-fixtures')
mkdirSync(dir, { recursive: true })
writeFileSync(join(dir, 'demo-song.json'), JSON.stringify(proj))
console.log(`wrote demo-song.json — ${proj.tracks.length} tracks, ${proj.arrangementClips.length} clips, ${proj.arrangementClips.reduce((a, c) => a + c.notes.length, 0)} notes`)
