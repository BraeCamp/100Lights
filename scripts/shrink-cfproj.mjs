#!/usr/bin/env node
// Shrink a self-contained .cfproj so it imports cleanly. Two problems it fixes on ElevenLabs stem
// exports: (1) SILENT stems (e.g. Guitar/Piano/Vocals on an instrumental) still inline ~0.4 MB of
// base64 each — dropped entirely; (2) 320-ish-kbps stems push the whole file past the ~4.5 MB body
// cap the signed-in "Open / Import Files" path (POST /api/projects) and the localStorage open path
// both hit. Re-encodes the surviving stems, stepping the bitrate down until the file fits a budget.
//
//   node scripts/shrink-cfproj.mjs "path/to/song.cfproj" [--budget=3.8] [--out=path] [--keepSilent]
//
// Overwrites in place by default (the original audio is preserved in the __full-mix.mp3 alongside).
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const flag = (n, d) => { const a = argv.find(x => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : d }
const has = n => argv.includes(`--${n}`)
const IN = argv.filter(a => !a.startsWith('--'))[0]
if (!IN) { console.error('usage: shrink-cfproj.mjs "<file.cfproj>" [--budget=3.8] [--out=path] [--keepSilent]'); process.exit(1) }
const OUT = flag('out', IN)
const BUDGET_MB = parseFloat(flag('budget', '3.8'))
const SILENCE_DB = -55            // a stem whose max volume is below this is treated as silent

const cf = JSON.parse(readFileSync(IN, 'utf8'))
const allClips = cf.dawProject?.arrangementClips || []
// Only audio clips carry inlined base64 (MIDI clips have `notes`, no audioUrl) — leave those untouched.
const clips = allClips.filter(cl => typeof cl.audioUrl === 'string' && cl.audioUrl.startsWith('data:'))
if (!clips.length) { console.error('No audio clips with inlined data found (nothing to shrink).'); process.exit(1) }
const tmp = mkdtempSync(join(tmpdir(), 'shrink-'))
const decode = (dataUrl, i) => {
  const b64 = dataUrl.split(',')[1] || ''
  const p = join(tmp, `stem${i}.mp3`); writeFileSync(p, Buffer.from(b64, 'base64')); return p
}
const maxVolumeDb = (mp3) => {
  // ffmpeg prints volumedetect stats to stderr and exits 0, so capture stderr regardless of exit code.
  const r = spawnSync('ffmpeg', ['-i', mp3, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' })
  const m = (r.stderr || '').match(/max_volume:\s*(-?[\d.]+) dB/)
  return m ? parseFloat(m[1]) : 0
}
const reencode = (mp3, kbps) => {
  const p = join(tmp, `re${kbps}-${mp3.split('/').pop()}`)
  execFileSync('ffmpeg', ['-y', '-i', mp3, '-b:a', `${kbps}k`, p], { stdio: 'ignore' })
  return `data:audio/mpeg;base64,${readFileSync(p).toString('base64')}`
}

// 1) decode + classify each stem
const stems = clips.map((cl, i) => {
  const mp3 = decode(cl.audioUrl, i)
  const db = maxVolumeDb(mp3)
  return { cl, mp3, db, silent: db < SILENCE_DB }
})
const kept = stems.filter(s => has('keepSilent') || !s.silent)
const dropped = stems.filter(s => !has('keepSilent') && s.silent)
console.log(`stems: ${stems.length} → keep ${kept.length}, drop ${dropped.length} silent [${dropped.map(s => clipName(s.cl)).join(', ') || 'none'}]`)

// 2) drop silent clips + their now-empty tracks
if (dropped.length) {
  const dropTrackIds = new Set(dropped.map(s => s.cl.trackId))
  // filter the FULL clip list (keeps MIDI clips) — only remove the dropped silent audio clips
  cf.dawProject.arrangementClips = allClips.filter(cl => !dropped.some(s => s.cl === cl))
  cf.dawProject.tracks = (cf.dawProject.tracks || []).filter(t => !dropTrackIds.has(t.id))
}

// 3) step the bitrate down until the whole file fits the budget
const budgetBytes = BUDGET_MB * 1e6
let chosen = null
for (const kbps of [160, 128, 112, 96, 80, 64]) {
  for (const s of kept) s.cl.audioUrl = reencode(s.mp3, kbps)
  const size = Buffer.byteLength(JSON.stringify(cf))
  console.log(`  @${kbps}kbps → ${(size / 1e6).toFixed(2)} MB`)
  if (size <= budgetBytes) { chosen = kbps; break }
}
if (!chosen) console.log('  ⚠ still over budget at 64kbps — writing smallest anyway')

writeFileSync(OUT, JSON.stringify(cf))
rmSync(tmp, { recursive: true, force: true })
console.log(`✓ wrote ${OUT} (${(Buffer.byteLength(readFileSync(OUT)) / 1e6).toFixed(2)} MB, stems @${chosen || 64}kbps)`)

function clipName(cl) { return cl.name || cl.trackId?.slice(0, 6) || '?' }
