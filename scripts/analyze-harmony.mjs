#!/usr/bin/env node
// ── Harmony / dissonance checker ─────────────────────────────────────────────
// Reads a song (.cfproj or a composer spec .json) and checks whether the
// instruments actually agree HARMONICALLY — the thing you can't see in a
// waveform. A waveform is loudness-over-time; musical dissonance lives in the
// PITCHES sounding together, and for these MIDI-note songs we have those exactly,
// so we read the notes directly instead of guessing from audio.
//
// Two checks:
//   1. KEY FIT — infer the song's key (best-fit of all 24 major/minor scales,
//      duration-weighted) and report each melodic track's out-of-key %. A track
//      far above the rest is playing in the wrong scale (the loud failure).
//   2. VERTICAL CLASH — walk the timeline; wherever two DIFFERENT instruments
//      hold pitches a semitone apart (min-2nd / maj-7th, the harsh intervals),
//      score it, weighted by how long they overlap. Reports the worst bars and
//      which track PAIR is clashing.
//
//   node scripts/analyze-harmony.mjs <file.cfproj | spec.json> ...
//   node scripts/analyze-harmony.mjs content/Audio/**/*.cfproj

import { readFileSync } from 'node:fs'

const PC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const MAJOR = [0, 2, 4, 5, 7, 9, 11]
const MINOR = [0, 2, 3, 5, 7, 8, 10]
const isMelodic = (name) => /bass|pad|arp|lead|key|synth|pluck|guitar|piano|string|brass|chord/i.test(name) && !/drum|beat|perc|kick|snare|hat/i.test(name)

function loadProject(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  // .cfproj wraps { dawProject }, a composer spec is the project-ish object itself.
  const dp = raw.dawProject || raw
  const beatsPerBar = dp.timeSignatureNum || 4
  const tracks = dp.tracks || []
  const clips = dp.arrangementClips || dp.clips || []
  const byTrack = new Map(tracks.map(t => [t.id, { name: t.name || '?', notes: [] }]))
  for (const c of clips) {
    const tr = byTrack.get(c.trackId); if (!tr) continue
    const base = c.startBeat || 0
    for (const n of (c.notes || [])) {
      const s = base + (n.startBeat || 0)
      tr.notes.push({ p: n.pitch, s, e: s + (n.durationBeats || 0.25), v: n.velocity ?? 100 })
    }
  }
  return { name: dp.name || path, beatsPerBar, tracks: [...byTrack.values()].filter(t => t.notes.length && isMelodic(t.name)) }
}

// ── Key inference: best-fit major/minor scale for a pitch-class weight vector ──
function bestScale(weight) {
  let best = null
  for (let root = 0; root < 12; root++) {
    for (const [mode, ivs] of [['major', MAJOR], ['minor', MINOR]]) {
      const inScale = new Set(ivs.map(i => (root + i) % 12))
      // Tonic + dominant weighted a touch higher so relative maj/min don't tie.
      let score = 0
      for (let pc = 0; pc < 12; pc++) if (inScale.has(pc)) score += weight[pc] * (pc === root ? 1.5 : pc === (root + 7) % 12 ? 1.2 : 1)
      if (!best || score > best.score) best = { root, mode, score, inScale }
    }
  }
  return best
}
const weightOf = (notes) => { const w = new Array(12).fill(0); for (const n of notes) w[((n.p % 12) + 12) % 12] += (n.e - n.s); return w }

function analyze(path) {
  const { name, beatsPerBar, tracks } = loadProject(path)
  if (!tracks.length) { console.log(`\n${path}\n  (no melodic tracks)`); return }
  const allNotes = tracks.flatMap(t => t.notes)
  const end = Math.max(...allNotes.map(n => n.e))
  const globalKey = bestScale(weightOf(allNotes))
  const keyName = `${PC[globalKey.root]} ${globalKey.mode}`

  // WINDOWED local key — songs modulate (the composer supports key changes), so a
  // single global key falsely flags a coordinated modulation as "out of key".
  // Infer a key per 8-bar window from ALL tracks; a track is "out" only when it
  // disagrees with its OWN window's key (a genuinely wrong-scale part, like the
  // arp tritone bug, still fails everywhere; a part that follows the modulation
  // reads clean).
  const WIN = 8 * beatsPerBar
  const nWin = Math.max(1, Math.ceil(end / WIN))
  const winKey = []
  for (let w = 0; w < nWin; w++) {
    const wn = allNotes.filter(n => n.s >= w * WIN - 1e-6 && n.s < (w + 1) * WIN)
    winKey[w] = wn.length >= 8 ? bestScale(weightOf(wn)) : globalKey
  }
  const keyAt = (beat) => winKey[Math.min(nWin - 1, Math.floor(beat / WIN))] || globalKey

  // 1 · key fit per track (vs the LOCAL window key)
  const rows = tracks.map(t => {
    let out = 0, tot = 0
    for (const n of t.notes) { const d = n.e - n.s; tot += d; if (!keyAt(n.s).inScale.has(((n.p % 12) + 12) % 12)) out += d }
    return { name: t.name, pct: tot ? (100 * out / tot) : 0, notes: t.notes.length }
  })
  const median = [...rows.map(r => r.pct)].sort((a, b) => a - b)[Math.floor(rows.length / 2)]

  // 2 · vertical clash: sample every 1/4 beat, count cross-track semitone pairs
  const STEP = 0.25
  const barClash = new Map()   // bar -> { score, pairs:Map }
  for (let t = 0; t < end; t += STEP) {
    const sounding = tracks.map(tr => ({ name: tr.name, pcs: new Set(tr.notes.filter(n => n.s <= t + 1e-6 && n.e > t + 1e-6).map(n => ((n.p % 12) + 12) % 12)) }))
    for (let i = 0; i < sounding.length; i++) for (let j = i + 1; j < sounding.length; j++) {
      let clash = 0
      for (const a of sounding[i].pcs) for (const b of sounding[j].pcs) {
        const d = Math.min((a - b + 12) % 12, (b - a + 12) % 12)
        if (d === 1) clash++            // minor 2nd / major 7th — the harsh one
      }
      if (clash) {
        const bar = Math.floor(t / beatsPerBar) + 1
        const rec = barClash.get(bar) || { score: 0, pairs: new Map() }
        rec.score += clash * STEP
        const pk = `${sounding[i].name}×${sounding[j].name}`
        rec.pairs.set(pk, (rec.pairs.get(pk) || 0) + clash * STEP)
        barClash.set(bar, rec)
      }
    }
  }
  const totalClash = [...barClash.values()].reduce((a, r) => a + r.score, 0)
  const worst = [...barClash.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, 5)

  console.log(`\n${name}`)
  console.log(`  key: ${keyName}   ·   clash index: ${totalClash.toFixed(1)} (semitone-beats across the song)`)
  for (const r of rows) {
    const flag = r.pct > 20 && r.pct > median + 15 ? '  ⚠ OUT OF KEY vs the rest' : r.pct > 30 ? '  ⚠ high' : ''
    console.log(`    ${r.name.padEnd(8)} ${r.pct.toFixed(0).padStart(3)}% out-of-key${flag}`)
  }
  if (worst.length && totalClash > 2) {
    console.log('  worst clashing bars:')
    for (const [bar, rec] of worst) {
      const pair = [...rec.pairs.entries()].sort((a, b) => b[1] - a[1])[0]
      console.log(`    bar ${String(bar).padStart(3)}  ${rec.score.toFixed(1)}  (mainly ${pair[0]})`)
    }
  } else {
    console.log('  ✓ no significant cross-instrument clashing')
  }
}

const files = process.argv.slice(2)
if (!files.length) { console.log('usage: node scripts/analyze-harmony.mjs <file.cfproj | spec.json> ...'); process.exit(0) }
for (const f of files) { try { analyze(f) } catch (e) { console.log(`\n${f}\n  error: ${e.message}`) } }
