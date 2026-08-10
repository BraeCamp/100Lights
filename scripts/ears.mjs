#!/usr/bin/env node
// EARS — Claude's objective listening. Hearing is signal processing: render what I authored, extract
// what's ACTUALLY sounding (onsets + pitch + spectrum), and compare it against the notes I wrote. So I
// can catch wrong pitches, off-beat timing, a buried melody, or a dark/quiet mix MYSELF — before asking
// Brae's ear. Closes the author→render→listen→fix loop.
//
//   node scripts/ears.mjs --project=<file.cfproj> [--track=melody] [--seconds=60] [--sr=22050]
//
// It solo-renders the target (melody) track, detects its notes with the local audio→MIDI hybrid, and
// scores them against the score. Also prints a mix read of the full bounce (loudness / balance / air /
// width / clipping). Verdict = how well the render matches intent.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const flag = (n, d) => { const a = argv.find(x => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : d }
const PROJECT = flag('project', null)
const TRACKQ = (flag('track', 'melody') || 'melody').toLowerCase()
const CAP = Number(flag('seconds', '60'))
const SR = Number(flag('sr', '22050'))
if (!PROJECT) { console.error('usage: ears.mjs --project=<file.cfproj> [--track=melody] [--seconds=60]'); process.exit(1) }

const NM = p => ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][((p % 12) + 12) % 12] + (Math.floor(p / 12) - 1)
const cf = JSON.parse(readFileSync(PROJECT, 'utf8'))
const dp = cf.dawProject
const tempo = dp.tempo || 120
const spb = 60 / tempo   // seconds per beat

// ── the score: authored notes on the target track, on the seconds timeline ────
const target = dp.tracks.find(t => t.name.toLowerCase().includes(TRACKQ)) || dp.tracks[0]
const targetClip = dp.arrangementClips.find(c => c.trackId === target.id && (c.notes || []).length)
if (!targetClip) { console.error(`No notes on a "${TRACKQ}" track.`); process.exit(1) }
const authored = targetClip.notes
  .map(n => ({ sec: (targetClip.startBeat + n.startBeat) * spb, midi: n.pitch }))
  .filter(n => n.sec < CAP).sort((a, b) => a.sec - b.sec)

// ── solo-render just the target track to a clean wav ──────────────────────────
const tmp = mkdtempSync(join(tmpdir(), 'ears-'))
const solo = structuredClone(cf)
for (const t of solo.dawProject.tracks) t.mute = (t.id !== target.id)
const soloPath = join(tmp, 'solo.cfproj'); writeFileSync(soloPath, JSON.stringify(solo))
console.log(`▸ solo-rendering "${target.name}" (${authored.length} authored notes, first ${CAP}s)…`)
execFileSync('node', ['scripts/hear-ai.mjs', `--project=${soloPath}`, `--seconds=${CAP}`, '--keep', `--out=${join(tmp, 'solo.mp3')}`], { cwd: ROOT, stdio: 'ignore' })
const wav = join(tmp, 'solo.wav')

// ── decode → mono float samples → detect notes (the local hybrid) ─────────────
const raw = join(tmp, 'solo.f32'); execFileSync('ffmpeg', ['-y', '-i', wav, '-ac', '1', '-ar', String(SR), '-f', 'f32le', raw], { stdio: 'ignore' })
const b = readFileSync(raw); const samples = new Float32Array(b.buffer, b.byteOffset, Math.floor(b.length / 4))
const { audioToNotes } = await import(join(ROOT, 'scripts/analyzers/audio-to-midi.mjs'))
const detected = (await audioToNotes(samples, SR, { sensitivity: 0.5 })).notes.sort((a, b) => a.startSec - b.startSec)

// ── match detected → authored (greedy, nearest onset within a tolerance) ──────
const TOL = Math.max(0.12, spb * 0.6)   // onset window: ~0.6 beat, min 120ms
const used = new Set()
let correct = 0, octave = 0, covered = 0, timingErr = 0
const wrong = [], missing = []
for (const a of authored) {
  let best = -1, bestDt = TOL
  for (let i = 0; i < detected.length; i++) {
    if (used.has(i)) continue
    const dt = Math.abs(detected[i].startSec - a.sec)
    if (dt <= bestDt) { bestDt = dt; best = i }
  }
  if (best >= 0) {
    used.add(best); const d = detected[best]
    if (d.midi === a.midi) { correct++; timingErr += bestDt }
    else if (((d.midi - a.midi) % 12 + 12) % 12 === 0) octave++   // right pitch class, wrong octave
    else wrong.push({ at: a.sec, want: a.midi, got: d.midi })
    continue
  }
  // No fresh onset — but a same-pitch note still SOUNDING here means the detector merged a repeat
  // (right pitch, onset not re-triggered), not a real miss.
  const held = detected.find(d => d.midi === a.midi && d.startSec <= a.sec + TOL && d.startSec + d.durSec >= a.sec - 0.05)
  if (held) covered++; else missing.push(a)
}
const extra = detected.length - used.size
const matchedForTiming = correct || 1
const pitchOk = correct + octave + covered
const pct = Math.round(pitchOk / authored.length * 100)

console.log(`\n── EARS: "${target.name}" note check ──`)
console.log(`  authored ${authored.length} · detected ${detected.length}`)
console.log(`  ✓ correct pitch+time: ${correct}   ↺ merged repeat (same pitch held): ${covered}   ~ wrong octave: ${octave}   → pitch-correct ${pct}%`)
console.log(`  ✗ wrong pitch: ${wrong.length}   ○ truly missing: ${missing.length}   + extra/detected-only: ${extra}`)
console.log(`  timing: mean onset error ${(timingErr / matchedForTiming * 1000).toFixed(0)} ms on matched notes`)
if (wrong.length) console.log('  wrong-pitch notes (authored → detected):\n' + wrong.slice(0, 12).map(w => `    @${w.at.toFixed(2)}s  ${NM(w.want)} → ${NM(w.got)}`).join('\n'))
if (missing.length) console.log('  not detected (buried / too short?): ' + missing.slice(0, 12).map(m => `${NM(m.midi)}@${m.sec.toFixed(1)}s`).join(', '))

// ── mix read of the FULL bounce ───────────────────────────────────────────────
console.log(`\n▸ rendering full mix for the mix read…`)
execFileSync('node', ['scripts/hear-ai.mjs', `--project=${PROJECT}`, `--seconds=${CAP}`, '--keep', `--out=${join(tmp, 'full.mp3')}`], { cwd: ROOT, stdio: 'ignore' })
const fullWav = join(tmp, 'full.wav')
try {
  const rep = execFileSync('python3', ['scripts/analyze-mix.py', fullWav, fullWav], { cwd: ROOT }).toString()
  const m = rep.split('\n').find(l => l.trim().startsWith('master'))
  console.log('  ' + (m ? m.trim() : '(mix read unavailable)'))
  const hints = rep.split('\n').filter(l => l.includes('⚠')).map(l => l.trim())
  if (hints.length) console.log('  ' + hints.join('\n  '))
} catch { console.log('  (analyze-mix unavailable)') }

// ── verdict ───────────────────────────────────────────────────────────────────
const good = pct >= 92 && wrong.length <= 1 && missing.length <= Math.ceil(authored.length * 0.08)
console.log(`\n  VERDICT: ${good ? '✅ render matches the score' : '⚠ discrepancies above — inspect before shipping'}`)
rmSync(tmp, { recursive: true, force: true })
