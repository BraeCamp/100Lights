#!/usr/bin/env node
// Ingest a real drum sample pack into a built-in kit.
//
//   node scripts/ingest-drum-pack.mjs <packDir> --kit=vintage --name="Vintage" --desc="..."
//   [--map=map.json]   explicit { "<pitch>": "<file>" } mapping when filenames are odd
//   [--write]          also append the kit entry to lib/drum-presets.ts (else prints it)
//
// ⚠ LICENSING: only ingest packs whose license permits REDISTRIBUTION of the
// samples inside an application (OEM / content licensing, CC0, or CC-BY with
// attribution shipped in-app). A normal "royalty-free for use in your music"
// license does NOT cover shipping the samples to users. Keep the pack's
// license text next to the pack folder; CC-BY attributions belong in the app
// credits.
//
// What it does: classifies files by name → GM pitches, converts to 44.1k mono
// 16-bit WAV (trimmed, peak-normalized to −1 dB) in public/drum-kits/<kit>/,
// and emits the DRUM_KITS entry.
import { readdirSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname, basename, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const packDir = args.find(a => !a.startsWith('--'))
const flag = (n) => args.find(a => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=')
const kitId = flag('kit')
const kitName = flag('name') ?? kitId
const kitDesc = flag('desc') ?? `Imported pack: ${kitName}`
if (!packDir || !kitId) { console.error('usage: ingest-drum-pack.mjs <packDir> --kit=<id> [--name=] [--desc=] [--map=map.json] [--write]'); process.exit(1) }

// role → GM pitch, with filename patterns ordered most→least specific
const ROLES = [
  { pitch: 49, name: 'Crash',    re: /crash|cym(?!.*ride)|cr[_-]?\d/i },
  { pitch: 46, name: 'Open Hat', re: /open[\s_-]?h|ohh|o[_-]?hat|hat[\s_-]?open/i },
  { pitch: 42, name: 'Hat',      re: /clos|chh|c[_-]?hat|hi[\s_-]?hat|hihat|\bhat\b|hh\d/i },
  { pitch: 39, name: 'Clap',     re: /clap|\bcp\b|hand/i },
  { pitch: 51, name: 'Rim',      re: /rim|side[\s_-]?stick|\brs\b|stick/i },
  { pitch: 41, name: 'Low Tom',  re: /floor|low[\s_-]?tom|tom[\s_-]?(low|lo|3|f)|ft\d?/i },
  { pitch: 48, name: 'High Tom', re: /high[\s_-]?tom|hi[\s_-]?tom|tom[\s_-]?(high|hi|1)/i },
  { pitch: 45, name: 'Mid Tom',  re: /mid[\s_-]?tom|rack|tom[\s_-]?(mid|2)|\btom\b/i },
  { pitch: 38, name: 'Snare',    re: /snare|\bsd\b|\bsn\b/i },
  { pitch: 36, name: 'Kick',     re: /kick|\bbd\b|bass[\s_-]?drum/i },
]
const AUDIO = new Set(['.wav', '.aif', '.aiff', '.flac', '.mp3', '.ogg'])

function walk(dir) {
  const out = []
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (AUDIO.has(extname(f).toLowerCase())) out.push(p)
  }
  return out
}

const files = walk(packDir)
if (!files.length) { console.error('no audio files found in', packDir); process.exit(1) }

let mapping = {}
const mapFile = flag('map')
if (mapFile) {
  mapping = JSON.parse(readFileSync(mapFile, 'utf8'))
} else {
  const taken = new Set()
  for (const role of ROLES) {
    // prefer shallower paths and files with "1"/"01" (usually the primary hit)
    const cands = files.filter(f => !taken.has(f) && role.re.test(basename(f)))
      .sort((a, b) => (a.split('/').length - b.split('/').length) || (/\b0?1\b/.test(basename(b)) ? 1 : 0) - (/\b0?1\b/.test(basename(a)) ? 1 : 0) || a.localeCompare(b))
    if (cands.length) { mapping[role.pitch] = cands[0]; taken.add(cands[0]) }
  }
}
const unmapped = files.filter(f => !Object.values(mapping).includes(f))
console.log('mapping:')
for (const [pitch, f] of Object.entries(mapping)) console.log(`  ${pitch} ← ${f.replace(packDir + '/', '')}`)
if (unmapped.length) console.log(`(${unmapped.length} files unmapped — variants welcome later; use --map for manual control)`)

const outDir = join(ROOT, 'public', 'drum-kits', kitId)
mkdirSync(outDir, { recursive: true })
for (const [pitch, src] of Object.entries(mapping)) {
  const dst = join(outDir, `${pitch}.wav`)
  // trim leading silence, cap length, mono 44.1k 16-bit, normalize to −1 dB
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', src,
    '-af', 'silenceremove=start_periods=1:start_threshold=-45dB,atrim=0:4,volume=0dB,alimiter=limit=0.89:level=false',
    '-ar', '44100', '-ac', '1', '-sample_fmt', 's16', dst])
}
console.log(`\nwrote ${Object.keys(mapping).length} pads → public/drum-kits/${kitId}/`)

const ROLE_VOL = { 36: 1.0, 38: 0.95, 39: 0.9, 41: 0.85, 42: 0.6, 45: 0.85, 46: 0.6, 48: 0.85, 49: 0.65, 51: 0.8 }
const NAMES = Object.fromEntries(ROLES.map(r => [r.pitch, r.name]))
const pads = Object.keys(mapping).map(p => `      ${p}: sp('${kitId}', ${p}, '${NAMES[p]}', ${ROLE_VOL[p] ?? 0.85})`).join(',\n')
const entry = `  { id: '${kitId}', name: '${kitName}', desc: '${kitDesc}',
    instrument: { type: 'drum', params: { pack: 'synth', pads: {
${pads},
    } } },
    voices: { snare: 'acoustic', hat: 'normal' } },`

const presets = join(ROOT, 'lib', 'drum-presets.ts')
if (args.includes('--write')) {
  let s = readFileSync(presets, 'utf8')
  if (s.includes(`id: '${kitId}'`)) { console.log(`\nkit '${kitId}' already in DRUM_KITS — replace it manually with:\n\n${entry}`) }
  else {
    s = s.replace(/(export const DRUM_KITS: DrumKit\[\] = \[\n)/, `$1${entry}\n`)
    writeFileSync(presets, s)
    console.log(`\nappended kit '${kitId}' to lib/drum-presets.ts`)
  }
} else {
  console.log(`\nadd to DRUM_KITS in lib/drum-presets.ts (or re-run with --write):\n\n${entry}`)
}
