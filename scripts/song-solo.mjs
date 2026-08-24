// Solo-render one track of a project and report whether it actually made sound.
//
// Band analysis of a full mix cannot prove a quiet layer was there — a sampled
// preset can silently fail to load in a headless render and the mix just sounds
// slightly emptier. This mutes everything else, renders, and measures, so
// "did the organ play?" has a yes/no answer instead of an inference.
//
//   node scripts/song-solo.mjs <project.cfproj> --track="Church Organ" [--url=…]

import { readFileSync, writeFileSync, mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const file = argv.find(a => !a.startsWith('--'))
const flag = (n, d) => { const a = argv.find(x => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : d }
const want = flag('track', '')
if (!file || !want) { console.error('usage: song-solo.mjs <project.cfproj> --track="Name"'); process.exit(1) }

const proj = JSON.parse(readFileSync(file, 'utf8'))
const dp = proj.dawProject
const target = dp.tracks.find(t => t.name.toLowerCase() === want.toLowerCase())
if (!target) { console.error(`no track named "${want}". Have: ${dp.tracks.map(t => t.name).join(', ')}`); process.exit(1) }

for (const t of dp.tracks) { t.mute = t.id !== target.id; t.solo = false }
dp.masterVolume = 1
proj.name = `${proj.name} [solo ${target.name}]`

const tmp = mkdtempSync(join(tmpdir(), 'solo-'))
const cfPath = join(tmp, 'solo.cfproj')
const wavPath = join(tmp, 'solo.wav')
writeFileSync(cfPath, JSON.stringify(proj))

const clips = dp.arrangementClips.filter(c => c.trackId === target.id)
console.log(`soloing "${target.name}" — ${clips.length} clips, ${clips.reduce((n, c) => n + c.notes.length, 0)} notes authored`)
execFileSync('node', ['scripts/hear-ai.mjs', `--project=${cfPath}`, `--url=${flag('url', 'http://localhost:4618')}`,
  `--out=${join(tmp, 'solo.mp3')}`, '--keep'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] })

// Report the level over each authored clip's span — a clip that produced
// nothing is the failure this script exists to catch.
const bpb = dp.timeSignatureNum || 4
const spans = clips
  .map((c, i) => `clip${i + 1}:${(c.startBeat / bpb).toFixed(2)}:${((c.startBeat + c.durationBeats) / bpb).toFixed(2)}`)
  .join(',')
console.log(execFileSync('node',
  ['scripts/song-sections.mjs', wavPath, `--bpm=${dp.tempo}`, `--bpb=${bpb}`, `--sections=${spans}`],
  { cwd: ROOT }).toString())
