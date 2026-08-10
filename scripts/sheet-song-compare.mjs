#!/usr/bin/env node
// Sheet-melody comparison: take a FULL public-domain melody (the "music sheet song in an instrument")
// and build a backing AROUND it two ways, so the two backings can be compared with the melody constant:
//   v1 (el)      — ElevenLabs generates the backing (prompted with the piece's key/tempo/mood)
//   v2 (compose) — our compose engine builds the backing from the sheet's own key/tempo/genre
// In BOTH, the sheet melody is injected as the lead track (same notes), then the project is rendered to
// MP3 via hear-ai --project. Skeleton (key/tempo/chords) comes from the sheet itself, not ElevenLabs.
//
//   node scripts/sheet-song-compare.mjs --song=ode --version=compose
//   node scripts/sheet-song-compare.mjs --song=greensleeves --version=el
//   node scripts/sheet-song-compare.mjs --all           # all 4 renders (spends EL credits ×2)
//
// Outputs to ~/Desktop/100lights-ai-renders/ : "<Song> (<backing>).cfproj" + "... .mp3".

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir, homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(homedir(), 'Desktop', '100lights-ai-renders')
const uid = () => randomUUID()
const argv = process.argv.slice(2)
const flag = (n, d) => { const a = argv.find(x => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : d }
const has = n => argv.includes(`--${n}`)

// ── known-good lead track + clip templates (from spec-to-cfproj output) ───────
const LEAD_TRACK = { id: 'x', name: 'Lead', type: 'audio', color: '#f59e0b', volume: 0.62, pan: 0, mute: false, solo: false, armed: false, height: 64,
  effects: [{ id: 'e1', type: 'delay', params: { enabled: true, wet: 0.22, time: 0.375, feedback: 0.35, syncToTempo: true, syncBeats: 0.375 } },
            { id: 'e2', type: 'reverb', params: { enabled: true, wet: 0.3, decay: 2.4, preDelay: 0.02 } }],
  instrument: { type: 'none', params: {} } }
const LEAD_CLIP = { kind: 'midi', id: 'x', trackId: 'x', name: 'Melody (sheet)', startBeat: 0, durationBeats: 0, notes: [], isDrumClip: false, presetId: 'builtin-22', rollFx: { sustain: 0.45, gain: 1.7 } }

// ── the two melodies, transcribed from public-domain sheet music ──────────────
// Notes are [pitch, startBeat, durationBeats] relative to the clip start. One statement of the tune;
// injectMelody loops it to cover the backing length.
const M = (...t) => t   // readability

// Beethoven — Ode to Joy (main theme, C major, 4/4). PD. quarter = 1 beat.
const ODE = [
  [64,0,1],[64,1,1],[65,2,1],[67,3,1], [67,4,1],[65,5,1],[64,6,1],[62,7,1],
  [60,8,1],[60,9,1],[62,10,1],[64,11,1], [64,12,1.5],[62,13.5,0.5],[62,14,2],
  [64,16,1],[64,17,1],[65,18,1],[67,19,1], [67,20,1],[65,21,1],[64,22,1],[62,23,1],
  [60,24,1],[60,25,1],[62,26,1],[64,27,1], [62,28,1.5],[60,29.5,0.5],[60,30,2],
]
// Greensleeves (G Dorian, transcribed from the musicaviva Gdor ABC — B natural in the key is Bb=70,
// E is natural=Dorian 6th, ^F=F#66). 6-beat phrases; pickup G at 0.
const GREEN = [
  [67,0,1],
  [70,1,2],[72,3,1],[74,4,1.5],[76,5.5,0.5],[74,6,1],
  [72,7,2],[69,9,1],[65,10,1.5],[67,11.5,0.5],[69,12,1],
  [70,13,2],[69,15,1],[67,16,1.5],[66,17.5,0.5],[67,18,1],
  [69,19,2],[66,21,1],[62,22,2],[67,24,1],
  [70,25,2],[72,27,1],[74,28,1.5],[76,29.5,0.5],[74,30,1],
  [72,31,2],[69,33,1],[65,34,1.5],[67,35.5,0.5],[69,36,1],
  [70,37,1.5],[69,38.5,0.5],[67,39,1],[66,40,1.5],[64,41.5,0.5],[65,42,1],
  [67,43,3],[67,46,2],
  [77,49,3],[77,52,1.5],[76,53.5,0.5],[74,54,1],
  [72,55,2],[69,57,1],[65,58,1.5],[67,59.5,0.5],[69,60,1],
  [70,61,2],[67,63,1],[67,64,1.5],[66,65.5,0.5],[67,66,1],
  [69,67,2],[66,69,1],[62,70,2],
  [77,73,3],[77,76,1.5],[76,77.5,0.5],[74,78,1],
  [72,79,2],[69,81,1],[65,82,1.5],[67,83.5,0.5],[69,84,1],
  [70,85,1.5],[69,86.5,0.5],[67,87,1],[66,88,1.5],[64,89.5,0.5],[65,90,1],
  [67,91,3],[67,94,2],
]

const SONGS = {
  ode: {
    title: 'Ode to Joy', melody: ODE, key: 'C major', genre: 'synthwave', bpm: 100,
    elPrompt: 'triumphant uplifting synthwave anthem, bright analog arpeggios, driving gated drums, warm major-key pads, wide and hopeful, leave space for a lead melody, C major, 100 BPM',
    elLenMs: 80000,
  },
  greensleeves: {
    title: 'Greensleeves', melody: GREEN, key: 'G minor', genre: 'ambient', bpm: 84,
    elPrompt: 'dark cinematic ambient, slow evolving bowed strings and cold pads, sparse soft hand percussion, mournful renaissance minor mood, no strong lead, G minor, 84 BPM',
    elLenMs: 80000,
  },
}

// ── melody injection: add the sheet melody as the lead track, looped to length ─
function injectMelody(cf, triples, songLenBeats) {
  const dp = cf.dawProject
  const oneLen = Math.max(...triples.map(t => t[1] + t[2]))
  const GAP = 4
  const notes = []
  let base = 0
  do {
    for (const [p, s, d] of triples) notes.push({ id: uid(), pitch: p, startBeat: +(base + s).toFixed(4), durationBeats: d, velocity: 95 })
    base += oneLen + GAP
  } while (base < songLenBeats)
  const track = { ...structuredClone(LEAD_TRACK), id: uid(), name: 'Melody (sheet)' }
  const clip = { ...structuredClone(LEAD_CLIP), id: uid(), trackId: track.id, startBeat: 0, durationBeats: +base.toFixed(4), notes }
  dp.tracks.push(track)
  dp.arrangementClips.push(clip)
}

const songLenBeats = (cf) => Math.max(4, ...(cf.dawProject.arrangementClips || []).map(c => (c.startBeat || 0) + (c.durationBeats || 0)))
const safe = s => s.replace(/[^\w.\- ]+/g, '').replace(/\s+/g, ' ').trim()

// ── v2: compose backing ──────────────────────────────────────────────────────
function buildCompose(song, tmp) {
  console.log(`▸ [compose] generating backing (${song.genre}, ${song.key})…`)
  const specPath = join(tmp, 'spec.cfproj')
  execFileSync('node', ['scripts/compose.mjs', song.genre, song.key, '--seed=7', `--out=${specPath}`], { cwd: ROOT, stdio: 'ignore' })
  execFileSync('node', ['scripts/spec-to-cfproj.mjs', specPath, `--outdir=${tmp}`], { cwd: ROOT, stdio: 'ignore' })
  const cfPath = execFileSync('bash', ['-c', `ls "${tmp}"/*.cfproj | grep -v spec.cfproj | head -1`]).toString().trim()
  const cf = JSON.parse(readFileSync(cfPath, 'utf8'))
  // drop compose's own generated Lead — the sheet melody IS the lead now
  const dp = cf.dawProject
  const leadIds = dp.tracks.filter(t => /^lead$/i.test(t.name)).map(t => t.id)
  dp.tracks = dp.tracks.filter(t => !leadIds.includes(t.id))
  dp.arrangementClips = dp.arrangementClips.filter(c => !leadIds.includes(c.trackId))
  injectMelody(cf, song.melody, songLenBeats(cf))
  cf.name = `${song.title} (compose)`; dp.name = cf.name
  return cf
}

// ── v1: ElevenLabs backing ───────────────────────────────────────────────────
// The EL export hardcodes the project tempo to 120, but EL renders at the prompted BPM (song.bpm), so
// a melody left at 120 would run ~20–40% fast against the audio. Set the tempo to song.bpm and rescale
// the audio clips' beat-length to match (audio plays by real seconds, not stretched — this only fixes
// the beat grid the melody rides on). Pass --reuseEl=<file.cfproj> to skip regeneration.
function buildEl(song, tmp) {
  const reuse = flag('reuseEl', null)
  let cf
  if (reuse) {
    console.log(`▸ [el] reusing already-generated backing: ${reuse}`)
    cf = JSON.parse(readFileSync(reuse, 'utf8'))
  } else {
    console.log(`▸ [el] generating backing via ElevenLabs…`)
    const elCf = join(tmp, 'el.cfproj')
    execFileSync('node', ['scripts/elevenlabs-song.mjs', song.elPrompt, `--title=${song.title} EL backing`, `--length=${song.elLenMs}`, `--out=${elCf}`, '--no-learn'],
      { cwd: ROOT, stdio: 'inherit' })
    cf = JSON.parse(readFileSync(elCf, 'utf8'))
  }
  const dp = cf.dawProject
  const oldTempo = dp.tempo || 120
  const scale = song.bpm / oldTempo
  dp.tempo = song.bpm
  for (const c of dp.arrangementClips) { if (c.audioUrl) c.durationBeats = +(c.durationBeats * scale).toFixed(4) }  // beats now match song.bpm
  injectMelody(cf, song.melody, songLenBeats(cf))
  cf.name = `${song.title} (ElevenLabs)`; dp.name = cf.name
  return cf
}

// ── render a cfproj to MP3 via the browser DAW engine ────────────────────────
function render(cf, label, tmp) {
  const cfPath = join(tmp, `${safe(label)}.cfproj`)
  writeFileSync(cfPath, JSON.stringify(cf))
  const outCf = join(OUT_DIR, `${safe(label)}.cfproj`)
  writeFileSync(outCf, JSON.stringify(cf))
  console.log(`▸ rendering "${label}" → MP3…`)
  execFileSync('node', ['scripts/hear-ai.mjs', `--project=${cfPath}`, `--out=${join(OUT_DIR, safe(label) + '.mp3')}`], { cwd: ROOT, stdio: 'inherit' })
  // EL versions inline audio stems → shrink the saved .cfproj so it stays under the import cap (the MP3
  // was already rendered from the full-quality temp copy, so audio fidelity for listening is unaffected).
  if (cf.dawProject.arrangementClips.some(c => c.audioUrl)) {
    try { execFileSync('node', ['scripts/shrink-cfproj.mjs', outCf], { cwd: ROOT, stdio: 'inherit' }) }
    catch (e) { console.log('  (shrink skipped: ' + (e.message || e) + ')') }
  }
  console.log(`  ✓ ${join(OUT_DIR, safe(label) + '.mp3')}  (+ .cfproj)`)
}

async function one(songKey, version) {
  const song = SONGS[songKey]
  const tmp = mkdtempSync(join(tmpdir(), 'sheetcmp-'))
  try {
    const cf = version === 'el' ? buildEl(song, tmp) : buildCompose(song, tmp)
    render(cf, `${song.title} (${version === 'el' ? 'ElevenLabs' : 'compose'})`, tmp)
  } finally { rmSync(tmp, { recursive: true, force: true }) }
}

const songs = has('all') ? ['ode', 'greensleeves'] : [flag('song', 'ode')]
const versions = has('all') ? ['compose', 'el'] : [flag('version', 'compose')]
for (const s of songs) for (const v of versions) await one(s, v)
console.log('\n✓ done')
